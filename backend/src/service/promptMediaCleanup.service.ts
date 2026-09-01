import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { prisma } from "../config/db.js";
import type { Prisma, PrismaClient } from "../generated/client.js";
import type { RetentionAuditAction } from "../generated/enums.js";
import {
  AUDIO_KEY_RE,
  inspectPromptMedia,
  type PromptMediaInspection,
} from "./upload.service.js";
import { lockPromptMediaStorageIdentity } from "./promptMediaLock.service.js";
import {
  RETENTION_POLICY_VERSION,
  RETENTION_QUARANTINE_MS,
  RetentionCleanupDisabledError,
  type SubmissionRetentionStorage,
} from "./submissionRetention.service.js";
import {
  deleteStorageObject,
  type StorageDeleteConfirmation,
} from "./retentionStorage.service.js";

export type PromptMediaCleanupMode = "QUARANTINE" | "FINALIZE";

export interface PromptMediaReference {
  id: string;
  submissionId: string;
}

export interface PromptMediaCleanupCandidate {
  sourceQuestionId: string;
  sourceQuestionIds: string[];
  activeSourceQuestionIds: string[];
  storageKey: string | null;
  bucket: string;
  storage: PromptMediaInspection | null;
  storageError: string | null;
  answerReferences: PromptMediaReference[];
  manifestReferences: PromptMediaReference[];
  eligible: boolean;
  reasons: string[];
}

export interface PromptMediaCleanupInventory {
  generatedAt: string;
  candidates: PromptMediaCleanupCandidate[];
  totals: {
    candidates: number;
    eligible: number;
    blocked: number;
    present: number;
    missing: number;
    storageErrors: number;
  };
  exitCode: 0 | 1;
}

export interface PromptMediaCleanupDependencies {
  database?: PrismaClient;
  now?: () => Date;
  enabled?: boolean;
  inspectPromptMedia?: (
    storageKey: string,
    bucket: string,
  ) => Promise<PromptMediaInspection>;
  storage?: SubmissionRetentionStorage;
}

export interface PromptMediaCleanupOptions {
  actorId: string;
  authorizationId: string;
  reason: string;
}

export interface PromptMediaCleanupRunResult {
  runId: string;
  mode: PromptMediaCleanupMode;
  status: "COMPLETED" | "FAILED";
  inventory: PromptMediaCleanupInventory;
  objects: Array<{
    storageKey: string;
    status: string;
    outcome: string;
    error?: string;
  }>;
}

function databaseOf(dependencies: PromptMediaCleanupDependencies): PrismaClient {
  return dependencies.database ?? prisma;
}

function nowOf(dependencies: PromptMediaCleanupDependencies): Date {
  return dependencies.now?.() ?? new Date();
}

function inspectionOf(
  dependencies: PromptMediaCleanupDependencies,
): NonNullable<PromptMediaCleanupDependencies["inspectPromptMedia"]> {
  return (
    dependencies.inspectPromptMedia ??
    (async (storageKey: string) => inspectPromptMedia(storageKey))
  );
}

function storageOf(
  dependencies: PromptMediaCleanupDependencies,
): SubmissionRetentionStorage {
  return dependencies.storage ?? { deleteObject: deleteStorageObject };
}

function requireReason(reason: string): string {
  const normalized = reason.trim();
  if (!normalized) throw new Error("A non-empty cleanup reason is required");
  return normalized;
}

function requireAuthorizationId(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("Explicit cleanup authorization is required");
  return normalized;
}

async function assertActiveAdmin(
  transaction: Prisma.TransactionClient,
  actorId: string,
): Promise<void> {
  const actor = await transaction.user.findFirst({
    where: { id: actorId, role: "ADMIN", deletedAt: null },
    select: { id: true },
  });
  if (!actor) throw new Error("An active ADMIN account is required");
}

async function audit(
  transaction: Prisma.TransactionClient,
  input: {
    actorId: string;
    action: RetentionAuditAction;
    authorizationId: string;
    reason: string;
    cleanupRunId: string;
    storageKey?: string;
    outcome?: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  await transaction.retentionAuditEvent.create({
    data: {
      id: randomUUID(),
      actorId: input.actorId,
      action: input.action,
      authorizationId: input.authorizationId,
      policyVersion: RETENTION_POLICY_VERSION,
      reason: input.reason,
      cleanupRunId: input.cleanupRunId,
      storageKey: input.storageKey,
      outcome: input.outcome,
      metadata:
        input.metadata === undefined
          ? undefined
          : (input.metadata as Prisma.InputJsonValue),
    },
  });
}

interface ReferenceSnapshot {
  answerReferences: PromptMediaReference[];
  manifestReferences: PromptMediaReference[];
}

async function readReferences(
  database: PrismaClient | Prisma.TransactionClient,
  storageKey: string,
  sourceQuestionIds: string[],
): Promise<ReferenceSnapshot> {
  const [manifestEntries, answers] = await Promise.all([
    database.manifestEntry.findMany({
      where: {
        manifest: { submission: { retentionStatus: { not: "PURGED" } } },
        promptMediaStorageKey: storageKey,
      },
      select: { id: true, submissionId: true },
      orderBy: { id: "asc" },
    }),
    database.answer.findMany({
      where: {
        submission: { retentionStatus: { not: "PURGED" } },
        OR: [
          { questionId: { in: sourceQuestionIds } },
          { manifestEntry: { promptMediaStorageKey: storageKey } },
        ],
      },
      select: { id: true, submissionId: true },
      orderBy: { id: "asc" },
    }),
  ]);
  return {
    manifestReferences: manifestEntries,
    answerReferences: answers,
  };
}

function referenceSnapshotValue(snapshot: ReferenceSnapshot) {
  return {
    answerReferences: snapshot.answerReferences,
    manifestReferences: snapshot.manifestReferences,
  };
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

async function readSourceQuestionGroups(database: PrismaClient) {
  const questions = await database.question.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { id: "asc" },
    select: { id: true, audioStorageKey: true },
  });
  const groups = new Map<
    string,
    { sourceQuestionIds: string[]; storageKey: string | null }
  >();
  for (const question of questions) {
    const groupKey = question.audioStorageKey ?? `__missing__${question.id}`;
    const existing = groups.get(groupKey);
    if (existing) existing.sourceQuestionIds.push(question.id);
    else {
      groups.set(groupKey, {
        sourceQuestionIds: [question.id],
        storageKey: question.audioStorageKey,
      });
    }
  }
  return groups;
}

/**
 * Read-only, dry-run-first Prompt-media inventory. It derives candidates from
 * Retired Questions only and includes both retained Answer and manifest-only
 * references in the machine-readable output.
 */
export async function inventoryPromptMedia(
  dependencies: PromptMediaCleanupDependencies = {},
): Promise<PromptMediaCleanupInventory> {
  const database = databaseOf(dependencies);
  const inspect = inspectionOf(dependencies);
  const groups = await readSourceQuestionGroups(database);
  const candidates: PromptMediaCleanupCandidate[] = [];

  for (const group of groups.values()) {
    const bucket = env.R2_BUCKET_NAME;
    if (!group.storageKey) {
      candidates.push({
        sourceQuestionId: group.sourceQuestionIds[0]!,
        sourceQuestionIds: group.sourceQuestionIds,
        activeSourceQuestionIds: [],
        storageKey: null,
        bucket,
        storage: null,
        storageError: null,
        answerReferences: [],
        manifestReferences: [],
        eligible: false,
        reasons: ["Prompt media storage identity is missing"],
      });
      continue;
    }
    const reasons: string[] = [];
    if (!AUDIO_KEY_RE.test(group.storageKey)) {
      reasons.push("Prompt media storage identity is invalid");
    }
    if (!group.storageKey.startsWith(`questions/${group.sourceQuestionIds[0]}/`)) {
      reasons.push("Prompt media storage identity does not match the source Question");
    }
    const activeSourceQuestions = await database.question.findMany({
      where: { audioStorageKey: group.storageKey, deletedAt: null },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    const activeSourceQuestionIds = activeSourceQuestions.map((question) => question.id);
    if (activeSourceQuestionIds.length > 0) {
      reasons.push("An active Question uses this Prompt-media identity");
    }
    const references = await readReferences(
      database,
      group.storageKey,
      group.sourceQuestionIds,
    );
    if (references.answerReferences.length > 0) {
      reasons.push("A non-purged Answer references this Prompt media");
    }
    if (references.manifestReferences.length > 0) {
      reasons.push("A non-purged Delivered prompt snapshot references this Prompt media");
    }

    let storage: PromptMediaInspection | null = null;
    let storageError: string | null = null;
    try {
      storage = await inspect(group.storageKey, bucket);
      if (!storage.exists) reasons.push("Prompt media is already absent from storage");
    } catch (error) {
      storageError = error instanceof Error ? error.message : "Prompt media inspection failed";
      reasons.push(storageError);
    }
    const eligible =
      reasons.length === 0 && storage?.exists === true && storageError === null;
    candidates.push({
      sourceQuestionId: group.sourceQuestionIds[0]!,
      sourceQuestionIds: group.sourceQuestionIds,
      activeSourceQuestionIds,
      storageKey: group.storageKey,
      bucket,
      storage,
      storageError,
      answerReferences: references.answerReferences,
      manifestReferences: references.manifestReferences,
      eligible,
      reasons,
    });
  }

  const totals = candidates.reduce<PromptMediaCleanupInventory["totals"]>(
    (summary, candidate) => {
      summary.candidates += 1;
      if (candidate.eligible) summary.eligible += 1;
      else summary.blocked += 1;
      if (candidate.storage?.exists) summary.present += 1;
      if (candidate.storage && !candidate.storage.exists) summary.missing += 1;
      if (candidate.storageError) summary.storageErrors += 1;
      return summary;
    },
    { candidates: 0, eligible: 0, blocked: 0, present: 0, missing: 0, storageErrors: 0 },
  );
  return {
    generatedAt: new Date().toISOString(),
    candidates,
    totals,
    exitCode: totals.storageErrors > 0 ? 1 : 0,
  };
}

async function createCleanupRun(
  mode: PromptMediaCleanupMode,
  options: PromptMediaCleanupOptions,
  dependencies: PromptMediaCleanupDependencies,
): Promise<string> {
  const database = databaseOf(dependencies);
  const runId = randomUUID();
  const authorizationId = requireAuthorizationId(options.authorizationId);
  const reason = requireReason(options.reason);
  await database.$transaction(async (transaction) => {
    await assertActiveAdmin(transaction, options.actorId);
    await transaction.promptMediaCleanupRun.create({
      data: {
        id: runId,
        mode,
        actorId: options.actorId,
        authorizationId,
        reason,
        policyVersion: RETENTION_POLICY_VERSION,
        status: "RUNNING",
      },
    });
    await audit(transaction, {
      actorId: options.actorId,
      action: "PROMPT_CLEANUP_AUTHORIZED",
      authorizationId,
      reason,
      cleanupRunId: runId,
      outcome: mode,
    });
  });
  return runId;
}

function candidateReason(candidate: PromptMediaCleanupCandidate): string {
  return candidate.reasons.length > 0
    ? candidate.reasons.join("; ")
    : "No retained references; source Question is Retired and storage is present";
}

async function quarantineCandidate(
  runId: string,
  candidate: PromptMediaCleanupCandidate,
  options: PromptMediaCleanupOptions,
  dependencies: PromptMediaCleanupDependencies,
): Promise<{ storageKey: string; status: string; outcome: string }> {
  const database = databaseOf(dependencies);
  const now = nowOf(dependencies);
  return database.$transaction(async (transaction) => {
    if (!candidate.storageKey) {
      return { storageKey: "", status: "MISSING", outcome: "NO_STORAGE_IDENTITY" };
    }
    await lockPromptMediaStorageIdentity(transaction, candidate.storageKey);
    let storage: PromptMediaInspection;
    try {
      storage = await inspectionOf(dependencies)(candidate.storageKey, candidate.bucket);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Prompt media inspection failed";
      const existing = await transaction.promptMediaCleanupObject.findUnique({
        where: { storageKey: candidate.storageKey },
        select: { id: true, status: true },
      });
      if (!existing || existing.status !== "DELETED") {
        await transaction.promptMediaCleanupObject.upsert({
          where: { storageKey: candidate.storageKey },
          update: {
            sourceQuestionId: candidate.sourceQuestionId,
            bucket: candidate.bucket,
            answerReferenceCount: 0,
            manifestReferenceCount: 0,
            referenceSnapshot: asJson({ answerReferences: [], manifestReferences: [] }),
            eligibilityReason: message,
            status: "FAILED",
            lastRunId: runId,
            quarantineUntil: null,
            lastError: message,
          },
          create: {
            id: randomUUID(),
            sourceQuestionId: candidate.sourceQuestionId,
            storageKey: candidate.storageKey,
            bucket: candidate.bucket,
            answerReferenceCount: 0,
            manifestReferenceCount: 0,
            referenceSnapshot: asJson({ answerReferences: [], manifestReferences: [] }),
            eligibilityReason: message,
            status: "FAILED",
            lastRunId: runId,
            lastError: message,
          },
        });
      }
      await audit(transaction, {
        actorId: options.actorId,
        action: "PROMPT_CLEANUP_SKIPPED",
        authorizationId: options.authorizationId,
        reason: options.reason,
        cleanupRunId: runId,
        storageKey: candidate.storageKey,
        outcome: message,
      });
      return { storageKey: candidate.storageKey, status: "FAILED", outcome: message };
    }
    const activeSourceQuestions = await transaction.question.count({
      where: {
        audioStorageKey: candidate.storageKey,
        deletedAt: null,
      },
    });
    const references = await readReferences(
      transaction,
      candidate.storageKey,
      candidate.sourceQuestionIds,
    );
    const exists = storage.exists;
    const eligible =
      AUDIO_KEY_RE.test(candidate.storageKey) &&
      activeSourceQuestions === 0 &&
      references.answerReferences.length === 0 &&
      references.manifestReferences.length === 0 &&
      exists;
    const quarantineUntil = new Date(now.getTime() + RETENTION_QUARANTINE_MS);
    const status = eligible
      ? "QUARANTINED"
      : !storage.exists
        ? "MISSING"
        : "SKIPPED_REFERENCED";
    const outcome = eligible
      ? "QUARANTINED"
      : !storage.exists
        ? "Prompt media is already absent from storage"
        : activeSourceQuestions > 0
          ? "An active Question now uses this Prompt-media identity"
          : references.answerReferences.length > 0
            ? "A non-purged Answer references this Prompt media"
            : references.manifestReferences.length > 0
              ? "A non-purged Delivered prompt snapshot references this Prompt media"
              : candidateReason(candidate);
    const snapshot = referenceSnapshotValue(references);
    const existing = await transaction.promptMediaCleanupObject.findUnique({
      where: { storageKey: candidate.storageKey },
      select: { id: true, status: true },
    });
    if (!existing || existing.status !== "DELETED") {
      await transaction.promptMediaCleanupObject.upsert({
        where: { storageKey: candidate.storageKey },
        update: {
          sourceQuestionId: candidate.sourceQuestionId,
          bucket: candidate.bucket,
          answerReferenceCount: references.answerReferences.length,
          manifestReferenceCount: references.manifestReferences.length,
          referenceSnapshot: asJson(snapshot),
          eligibilityReason: outcome,
          status,
          lastRunId: runId,
          quarantineUntil: eligible ? quarantineUntil : null,
          lastError: null,
        },
        create: {
          id: randomUUID(),
          sourceQuestionId: candidate.sourceQuestionId,
          storageKey: candidate.storageKey,
          bucket: candidate.bucket,
          answerReferenceCount: references.answerReferences.length,
          manifestReferenceCount: references.manifestReferences.length,
          referenceSnapshot: asJson(snapshot),
          eligibilityReason: outcome,
          status,
          lastRunId: runId,
          quarantineUntil: eligible ? quarantineUntil : null,
        },
      });
    }
    await audit(transaction, {
      actorId: options.actorId,
      action: eligible
        ? "PROMPT_CLEANUP_QUARANTINED"
        : "PROMPT_CLEANUP_SKIPPED",
      authorizationId: options.authorizationId,
      reason: options.reason,
      cleanupRunId: runId,
      storageKey: candidate.storageKey,
      outcome,
      metadata: {
        answerReferences: references.answerReferences,
        manifestReferences: references.manifestReferences,
        quarantineUntil: eligible ? quarantineUntil.toISOString() : null,
      },
    });
    return { storageKey: candidate.storageKey, status, outcome };
  });
}

interface FinalizeCandidate {
  id: string;
  storageKey: string;
  bucket: string;
  sourceQuestionId: string;
  quarantineUntil: Date | null;
  status: string;
}

async function finalizeCandidate(
  runId: string,
  object: FinalizeCandidate,
  options: PromptMediaCleanupOptions,
  dependencies: PromptMediaCleanupDependencies,
): Promise<{ storageKey: string; status: string; outcome: string; error?: string }> {
  const database = databaseOf(dependencies);
  const now = nowOf(dependencies);
  const storage = storageOf(dependencies);
  try {
    return await database.$transaction(async (transaction) => {
      await lockPromptMediaStorageIdentity(transaction, object.storageKey);
      const current = await transaction.promptMediaCleanupObject.findUniqueOrThrow({
        where: { id: object.id },
      });
      if (["DELETED", "MISSING", "CANCELLED"].includes(current.status)) {
        return {
          storageKey: object.storageKey,
          status: current.status,
          outcome: "ALREADY_FINALIZED",
        };
      }
      if (
        !current.quarantineUntil ||
        current.quarantineUntil.getTime() > now.getTime()
      ) {
        return {
          storageKey: object.storageKey,
          status: current.status,
          outcome: "QUARANTINE_ACTIVE",
        };
      }
      const sourceQuestions = await transaction.question.findMany({
        where: { audioStorageKey: object.storageKey },
        select: { id: true, deletedAt: true },
      });
      const sourceQuestionIds = sourceQuestions.map((question) => question.id);
      const activeSourceQuestions = sourceQuestions.filter(
        (question) => question.deletedAt === null,
      );
      const references = await readReferences(
        transaction,
        object.storageKey,
        sourceQuestionIds.length > 0 ? sourceQuestionIds : [object.sourceQuestionId],
      );
      if (
        sourceQuestions.length === 0 ||
        activeSourceQuestions.length > 0 ||
        references.answerReferences.length > 0 ||
        references.manifestReferences.length > 0
      ) {
        await transaction.promptMediaCleanupObject.update({
          where: { id: object.id },
          data: {
            status: "SKIPPED_REFERENCED",
            answerReferenceCount: references.answerReferences.length,
            manifestReferenceCount: references.manifestReferences.length,
            referenceSnapshot: asJson(referenceSnapshotValue(references)),
            eligibilityReason: activeSourceQuestions.length > 0
              ? "An active Question now uses this Prompt-media identity"
              : sourceQuestions.length === 0
                ? "The retired source Question no longer exists"
              : "A non-purged Submission now references this Prompt media",
            lastRunId: runId,
            quarantineUntil: null,
          },
        });
        await audit(transaction, {
          actorId: options.actorId,
          action: "PROMPT_CLEANUP_SKIPPED",
          authorizationId: options.authorizationId,
          reason: options.reason,
          cleanupRunId: runId,
          storageKey: object.storageKey,
          outcome: "REFERENCE_RECHECK_BLOCKED",
          metadata: referenceSnapshotValue(references),
        });
        return {
          storageKey: object.storageKey,
          status: "SKIPPED_REFERENCED",
          outcome: "REFERENCE_RECHECK_BLOCKED",
        };
      }
      const pending = await transaction.promptMediaCleanupObject.update({
        where: { id: current.id },
        data: {
          status: "DELETE_PENDING",
          attemptCount: { increment: 1 },
          lastRunId: runId,
          lastError: null,
        },
      });
      await audit(transaction, {
        actorId: options.actorId,
        action: "PROMPT_CLEANUP_DELETE_ATTEMPTED",
        authorizationId: options.authorizationId,
        reason: options.reason,
        cleanupRunId: runId,
        storageKey: object.storageKey,
        outcome: "DELETE_REQUESTED",
        metadata: { attemptCount: pending.attemptCount },
      });
      try {
        // Keep the interactive transaction open while the exact storage
        // identity is deleted and its absence is confirmed.
        const confirmation: StorageDeleteConfirmation = await storage.deleteObject(
          object.storageKey,
          object.bucket,
        );
        const missing = confirmation.outcome === "ALREADY_ABSENT";
        await transaction.promptMediaCleanupObject.update({
          where: { id: current.id },
          data: {
            status: missing ? "MISSING" : "DELETED",
            deletedAt: missing ? null : nowOf(dependencies),
            lastError: null,
            quarantineUntil: null,
          },
        });
        await audit(transaction, {
          actorId: options.actorId,
          action: missing
            ? "PROMPT_CLEANUP_ALREADY_ABSENT"
            : "PROMPT_CLEANUP_DELETE_CONFIRMED",
          authorizationId: options.authorizationId,
          reason: options.reason,
          cleanupRunId: runId,
          storageKey: object.storageKey,
          outcome: confirmation.outcome,
        });
        return {
          storageKey: object.storageKey,
          status: missing ? "MISSING" : "DELETED",
          outcome: confirmation.outcome,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Storage deletion failed";
        await transaction.promptMediaCleanupObject.update({
          where: { id: current.id },
          data: { status: "FAILED", lastError: message },
        });
        await audit(transaction, {
          actorId: options.actorId,
          action: "PROMPT_CLEANUP_DELETE_FAILED",
          authorizationId: options.authorizationId,
          reason: options.reason,
          cleanupRunId: runId,
          storageKey: object.storageKey,
          outcome: message,
        });
        return {
          storageKey: object.storageKey,
          status: "FAILED",
          outcome: message,
          error: message,
        };
      }
    }, { maxWait: 60_000, timeout: 60_000 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Cleanup finalization failed";
    try {
      await database.promptMediaCleanupObject.update({
        where: { id: object.id },
        data: { status: "FAILED", lastError: message, lastRunId: runId },
      });
    } catch {
      // The failed run itself remains the durable signal if the row cannot be updated.
    }
    return {
      storageKey: object.storageKey,
      status: "FAILED",
      outcome: message,
      error: message,
    };
  }
}

/** Execute an authorized Prompt-media quarantine or finalization run. */
export async function runPromptMediaCleanup(
  mode: PromptMediaCleanupMode,
  options: PromptMediaCleanupOptions,
  dependencies: PromptMediaCleanupDependencies = {},
): Promise<PromptMediaCleanupRunResult> {
  if (!(dependencies.enabled ?? env.RETENTION_CLEANUP_ENABLED)) {
    throw new RetentionCleanupDisabledError();
  }
  const normalizedOptions: PromptMediaCleanupOptions = {
    ...options,
    authorizationId: requireAuthorizationId(options.authorizationId),
    reason: requireReason(options.reason),
  };
  const runId = await createCleanupRun(mode, normalizedOptions, dependencies);
  const database = databaseOf(dependencies);
  try {
    const inventory = await inventoryPromptMedia(dependencies);
    const objects: PromptMediaCleanupRunResult["objects"] = [];
    let failed = inventory.totals.storageErrors > 0;

    if (mode === "QUARANTINE") {
      for (const candidate of inventory.candidates) {
        const result = await quarantineCandidate(
          runId,
          candidate,
          normalizedOptions,
          dependencies,
        );
        objects.push(result);
      }
    } else {
      const now = nowOf(dependencies);
      const due = await database.promptMediaCleanupObject.findMany({
        where: {
          status: { in: ["QUARANTINED", "FAILED", "DELETE_PENDING"] },
          quarantineUntil: { lte: now },
        },
        orderBy: { storageKey: "asc" },
        select: {
          id: true,
          storageKey: true,
          bucket: true,
          sourceQuestionId: true,
          quarantineUntil: true,
          status: true,
        },
      });
      for (const object of due) {
        const result = await finalizeCandidate(
          runId,
          object,
          normalizedOptions,
          dependencies,
        );
        objects.push(result);
        if (result.status === "FAILED") failed = true;
      }
    }

    const status = failed ? "FAILED" : "COMPLETED";
    await database.promptMediaCleanupRun.update({
      where: { id: runId },
      data: { status, completedAt: nowOf(dependencies) },
    });
    return { runId, mode, status, inventory, objects };
  } catch (error) {
    await database.promptMediaCleanupRun.updateMany({
      where: { id: runId, status: "RUNNING" },
      data: { status: "FAILED", completedAt: nowOf(dependencies) },
    });
    throw error;
  }
}
