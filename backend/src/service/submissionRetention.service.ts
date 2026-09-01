import { randomUUID } from "node:crypto";
import { env } from "../config/env.js";
import { prisma } from "../config/db.js";
import type { Prisma, PrismaClient } from "../generated/client.js";
import type {
  RetentionAuditAction,
  RetentionHoldType,
} from "../generated/enums.js";
import { lockPromptMediaStorageIdentity } from "./promptMediaLock.service.js";
import {
  deleteStorageObject,
  type StorageDeleteConfirmation,
} from "./retentionStorage.service.js";

export const RETENTION_POLICY_VERSION = "2026-08-31";
export const RETENTION_QUARANTINE_DAYS = 30;
export const RETENTION_QUARANTINE_MS =
  RETENTION_QUARANTINE_DAYS * 24 * 60 * 60 * 1000;

const PURGEABLE_STATUSES = [
  "IN_PROGRESS",
  "ABANDONED",
  "AWAITING_PAYMENT",
] as const;

type RetentionDatabase = PrismaClient;

export interface SubmissionRetentionStorage {
  deleteObject(
    storageKey: string,
    bucket: string,
  ): Promise<StorageDeleteConfirmation>;
}

export interface SubmissionRetentionDependencies {
  database?: RetentionDatabase;
  now?: () => Date;
  enabled?: boolean;
  storage?: SubmissionRetentionStorage;
}

export interface RetentionOperationOptions {
  authorizationId?: string;
  reason: string;
}

export class RetentionOperationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "RetentionOperationError";
  }
}

export class SubmissionPurgeNotEligibleError extends RetentionOperationError {
  constructor(readonly blockers: string[]) {
    super(
      "PURGE_NOT_ELIGIBLE",
      "Submission is not eligible for purge",
      { blockers },
    );
    this.name = "SubmissionPurgeNotEligibleError";
  }
}

export class RetentionCleanupDisabledError extends RetentionOperationError {
  constructor() {
    super(
      "RETENTION_CLEANUP_DISABLED",
      "Retention cleanup is disabled; set RETENTION_CLEANUP_ENABLED=1 for an authorized run",
    );
    this.name = "RetentionCleanupDisabledError";
  }
}

interface SubmissionPolicySnapshot {
  id: string;
  status: string;
  retentionStatus: string;
  payments: Array<{ status: string }>;
  assignments: Array<{ id: string }>;
  certificate: { id: string } | null;
  retentionHolds: Array<{ id: string; type: RetentionHoldType; reason: string }>;
}

interface AuditInput {
  targetSubmissionId?: string;
  submissionId?: string;
  purgeRequestId?: string;
  cleanupRunId?: string;
  actorId: string;
  action: RetentionAuditAction;
  authorizationId: string;
  reason: string;
  storageKey?: string;
  outcome?: string;
  metadata?: Record<string, unknown>;
}

function databaseOf(dependencies: SubmissionRetentionDependencies): RetentionDatabase {
  return dependencies.database ?? prisma;
}

function nowOf(dependencies: SubmissionRetentionDependencies): Date {
  return dependencies.now?.() ?? new Date();
}

function storageOf(
  dependencies: SubmissionRetentionDependencies,
): SubmissionRetentionStorage {
  return dependencies.storage ?? { deleteObject: deleteStorageObject };
}

function requireReason(reason: string): string {
  const normalized = reason.trim();
  if (!normalized) {
    throw new RetentionOperationError(
      "REASON_REQUIRED",
      "A non-empty retention reason is required",
    );
  }
  if (normalized.length > 2_000) {
    throw new RetentionOperationError(
      "REASON_TOO_LONG",
      "Retention reason must be 2,000 characters or fewer",
    );
  }
  return normalized;
}

function requireAuthorizationId(value: string | undefined, fallback: string): string {
  const normalized = value?.trim() || fallback;
  if (!normalized) {
    throw new RetentionOperationError(
      "AUTHORIZATION_REQUIRED",
      "Explicit authorization evidence is required",
    );
  }
  return normalized;
}

function requireExplicitAuthorizationId(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) {
    throw new RetentionOperationError(
      "AUTHORIZATION_REQUIRED",
      "Explicit authorization evidence is required for finalization",
    );
  }
  return normalized;
}

function assertCleanupEnabled(dependencies: SubmissionRetentionDependencies): void {
  if (!(dependencies.enabled ?? env.RETENTION_CLEANUP_ENABLED)) {
    throw new RetentionCleanupDisabledError();
  }
}

async function assertActiveAdmin(
  transaction: Prisma.TransactionClient,
  actorId: string,
): Promise<void> {
  const actor = await transaction.user.findFirst({
    where: { id: actorId, role: "ADMIN", deletedAt: null },
    select: { id: true },
  });
  if (!actor) {
    throw new RetentionOperationError(
      "ACTIVE_ADMIN_REQUIRED",
      "An active ADMIN account is required",
    );
  }
}

async function audit(
  transaction: Prisma.TransactionClient,
  input: AuditInput,
): Promise<void> {
  await transaction.retentionAuditEvent.create({
    data: {
      id: randomUUID(),
      targetSubmissionId: input.targetSubmissionId,
      submissionId: input.submissionId,
      purgeRequestId: input.purgeRequestId,
      cleanupRunId: input.cleanupRunId,
      actorId: input.actorId,
      action: input.action,
      authorizationId: input.authorizationId,
      policyVersion: RETENTION_POLICY_VERSION,
      reason: input.reason,
      storageKey: input.storageKey,
      outcome: input.outcome,
      metadata:
        input.metadata === undefined
          ? undefined
          : (input.metadata as Prisma.InputJsonValue),
    },
  });
}

async function loadSubmissionPolicy(
  transaction: Prisma.TransactionClient,
  submissionId: string,
): Promise<SubmissionPolicySnapshot | null> {
  return transaction.submission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      status: true,
      retentionStatus: true,
      payments: { select: { status: true } },
      assignments: { select: { id: true } },
      certificate: { select: { id: true } },
      retentionHolds: {
        where: { releasedAt: null },
        select: { id: true, type: true, reason: true },
      },
    },
  });
}

function purgeBlockers(snapshot: SubmissionPolicySnapshot): string[] {
  const blockers: string[] = [];
  if (snapshot.retentionStatus !== "RETAINED") {
    blockers.push(`Retention status is ${snapshot.retentionStatus}`);
  }
  if (!(PURGEABLE_STATUSES as readonly string[]).includes(snapshot.status)) {
    blockers.push(`Submission status ${snapshot.status} is retained by policy`);
  }
  const blockingPayments = snapshot.payments.filter(
    (payment) => payment.status !== "FAILED" && payment.status !== "REFUNDED",
  );
  if (blockingPayments.length > 0) {
    blockers.push("A payment obligation or payment history is still active");
  }
  if (snapshot.assignments.length > 0) {
    blockers.push("Examiner assignments exist");
  }
  if (snapshot.certificate) {
    blockers.push("A certificate exists");
  }
  for (const hold of snapshot.retentionHolds) {
    blockers.push(`Active ${hold.type} Retention hold: ${hold.reason}`);
  }
  return blockers;
}

function activeHoldBlockers(snapshot: SubmissionPolicySnapshot): string[] {
  return snapshot.retentionHolds.map(
    (hold) => `Active ${hold.type} Retention hold: ${hold.reason}`,
  );
}

async function findSharedAnswerMedia(
  transaction: Prisma.TransactionClient,
  targetSubmissionId: string,
  storageKey: string,
  bucket: string,
) {
  return transaction.answer.findFirst({
    where: {
      storageKey,
      submissionId: { not: targetSubmissionId },
      submission: { retentionStatus: { not: "PURGED" } },
      ...(bucket === env.R2_BUCKET_NAME
        ? { OR: [{ bucket }, { bucket: null }] }
        : { bucket }),
    },
    select: { id: true, submissionId: true },
  });
}

function requestAuthorizationId(requestId: string): string {
  return `purge-request:${requestId}`;
}

function approvalAuthorizationId(requestId: string): string {
  return `purge-approval:${requestId}`;
}

/** Request a purge without changing the Submission or touching storage. */
export async function requestSubmissionPurge(
  submissionId: string,
  requesterId: string,
  options: RetentionOperationOptions,
  dependencies: SubmissionRetentionDependencies = {},
) {
  const reason = requireReason(options.reason);
  const database = databaseOf(dependencies);
  return database.$transaction(async (transaction) => {
    await assertActiveAdmin(transaction, requesterId);
    await transaction.$queryRaw`
      SELECT "id" FROM "Submission" WHERE "id" = ${submissionId}::uuid FOR UPDATE
    `;
    const submission = await loadSubmissionPolicy(transaction, submissionId);
    if (!submission) {
      throw new RetentionOperationError("SUBMISSION_NOT_FOUND", "Submission not found");
    }

    const existing = await transaction.submissionPurgeRequest.findFirst({
      where: {
        targetSubmissionId: submissionId,
        status: { in: ["REQUESTED", "QUARANTINED", "FAILED"] },
      },
      orderBy: { requestedAt: "desc" },
    });
    if (existing) return existing;

    const blockers = purgeBlockers(submission);
    if (blockers.length > 0) throw new SubmissionPurgeNotEligibleError(blockers);

    const requestId = randomUUID();
    const authorizationId = requireAuthorizationId(
      options.authorizationId,
      requestAuthorizationId(requestId),
    );
    const request = await transaction.submissionPurgeRequest.create({
      data: {
        id: requestId,
        targetSubmissionId: submissionId,
        submissionId,
        requestedById: requesterId,
        status: "REQUESTED",
        reason,
        policyVersion: RETENTION_POLICY_VERSION,
      },
    });
    await audit(transaction, {
      targetSubmissionId: submissionId,
      submissionId,
      purgeRequestId: request.id,
      actorId: requesterId,
      action: "PURGE_REQUESTED",
      authorizationId,
      reason,
      outcome: "REQUESTED",
    });
    return request;
  });
}

/** Place an eligible Submission in its recoverable quarantine. */
export async function approveSubmissionPurge(
  requestId: string,
  approverId: string,
  options: RetentionOperationOptions,
  dependencies: SubmissionRetentionDependencies = {},
) {
  const reason = requireReason(options.reason);
  const database = databaseOf(dependencies);
  const now = nowOf(dependencies);
  return database.$transaction(async (transaction) => {
    await assertActiveAdmin(transaction, approverId);
    await transaction.$queryRaw`
      SELECT "id" FROM "SubmissionPurgeRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE
    `;
    const request = await transaction.submissionPurgeRequest.findUnique({
      where: { id: requestId },
      select: {
        id: true,
        targetSubmissionId: true,
        submissionId: true,
        requestedById: true,
        status: true,
      },
    });
    if (!request) {
      throw new RetentionOperationError("PURGE_REQUEST_NOT_FOUND", "Purge request not found");
    }
    if (request.status !== "REQUESTED") return request;
    if (request.requestedById === approverId) {
      throw new RetentionOperationError(
        "DUAL_CONTROL_REQUIRED",
        "The requester cannot approve the same purge request",
      );
    }
    await transaction.$queryRaw`
      SELECT "id" FROM "Submission" WHERE "id" = ${request.targetSubmissionId}::uuid FOR UPDATE
    `;
    const submission = await loadSubmissionPolicy(
      transaction,
      request.targetSubmissionId,
    );
    if (!submission) {
      throw new RetentionOperationError("SUBMISSION_NOT_FOUND", "Submission not found");
    }
    const blockers = purgeBlockers(submission);
    if (blockers.length > 0) throw new SubmissionPurgeNotEligibleError(blockers);

    const quarantineUntil = new Date(now.getTime() + RETENTION_QUARANTINE_MS);
    const approvalAuthorization = requireAuthorizationId(
      options.authorizationId,
      approvalAuthorizationId(request.id),
    );
    await transaction.submission.update({
      where: { id: request.targetSubmissionId },
      data: { retentionStatus: "QUARANTINED" },
    });
    await transaction.submissionPurgeRequest.update({
      where: { id: request.id },
      data: {
        status: "QUARANTINED",
        approvedById: approverId,
        approvedAt: now,
        quarantineUntil,
        lastError: null,
      },
    });

    const answers = await transaction.answer.findMany({
      where: { submissionId: request.targetSubmissionId },
      select: { storageKey: true, bucket: true },
      orderBy: { storageKey: "asc" },
    });
    const uniqueObjects = new Map<string, { storageKey: string; bucket: string }>();
    for (const answer of answers) {
      const bucket = answer.bucket ?? env.R2_BUCKET_NAME;
      uniqueObjects.set(`${bucket}\u0000${answer.storageKey}`, {
        storageKey: answer.storageKey,
        bucket,
      });
    }
    const capturedObjects = [...uniqueObjects.values()].sort((left, right) =>
      `${left.bucket}\u0000${left.storageKey}`.localeCompare(
        `${right.bucket}\u0000${right.storageKey}`,
      ),
    );
    for (const object of capturedObjects) {
      await lockPromptMediaStorageIdentity(transaction, object.storageKey);
      const sharedAnswer = await findSharedAnswerMedia(
        transaction,
        request.targetSubmissionId,
        object.storageKey,
        object.bucket,
      );
      if (sharedAnswer) {
        throw new SubmissionPurgeNotEligibleError([
          `Answer media storage identity ${object.bucket}/${object.storageKey} is shared by another retained Submission`,
        ]);
      }
      await transaction.submissionPurgeObject.create({
        data: {
          id: randomUUID(),
          requestId: request.id,
          targetSubmissionId: request.targetSubmissionId,
          submissionId: request.targetSubmissionId,
          kind: "ANSWER_MEDIA",
          storageKey: object.storageKey,
          bucket: object.bucket,
          status: "QUARANTINED",
          quarantineUntil,
        },
      });
    }
    await audit(transaction, {
      targetSubmissionId: request.targetSubmissionId,
      submissionId: request.targetSubmissionId,
      purgeRequestId: request.id,
      actorId: approverId,
      action: "PURGE_APPROVED",
      authorizationId: approvalAuthorization,
      reason,
      outcome: "QUARANTINED",
      metadata: {
        answerMediaObjectCount: capturedObjects.length,
        quarantineUntil: quarantineUntil.toISOString(),
      },
    });
    return transaction.submissionPurgeRequest.findUniqueOrThrow({
      where: { id: request.id },
      include: { objects: { orderBy: { storageKey: "asc" } } },
    });
  });
}

/** Add an explicit hold that prevents a Submission purge. */
export async function createRetentionHold(
  submissionId: string,
  actorId: string,
  type: RetentionHoldType,
  reasonInput: string,
  dependencies: SubmissionRetentionDependencies = {},
) {
  const reason = requireReason(reasonInput);
  const database = databaseOf(dependencies);
  return database.$transaction(async (transaction) => {
    await assertActiveAdmin(transaction, actorId);
    await transaction.$queryRaw`
      SELECT "id" FROM "Submission" WHERE "id" = ${submissionId}::uuid FOR UPDATE
    `;
    const submission = await loadSubmissionPolicy(transaction, submissionId);
    if (!submission) {
      throw new RetentionOperationError("SUBMISSION_NOT_FOUND", "Submission not found");
    }
    const hold = await transaction.submissionRetentionHold.create({
      data: {
        id: randomUUID(),
        targetSubmissionId: submissionId,
        submissionId,
        type,
        reason,
        createdById: actorId,
      },
    });
    await audit(transaction, {
      targetSubmissionId: submissionId,
      submissionId,
      actorId,
      action: "RETENTION_HOLD_CREATED",
      authorizationId: `retention-hold:${hold.id}`,
      reason,
      outcome: type,
      metadata: { holdId: hold.id },
    });
    return hold;
  });
}

/** Release a hold after the operator has addressed its reason. */
export async function releaseRetentionHold(
  holdId: string,
  actorId: string,
  reasonInput: string,
  dependencies: SubmissionRetentionDependencies = {},
) {
  const reason = requireReason(reasonInput);
  const database = databaseOf(dependencies);
  return database.$transaction(async (transaction) => {
    await assertActiveAdmin(transaction, actorId);
    await transaction.$queryRaw`
      SELECT "id" FROM "SubmissionRetentionHold" WHERE "id" = ${holdId}::uuid FOR UPDATE
    `;
    const hold = await transaction.submissionRetentionHold.findUnique({
      where: { id: holdId },
    });
    if (!hold) throw new RetentionOperationError("HOLD_NOT_FOUND", "Retention hold not found");
    if (hold.releasedAt) return hold;
    const releasedAt = nowOf(dependencies);
    const released = await transaction.submissionRetentionHold.update({
      where: { id: holdId },
      data: { releasedAt, releasedById: actorId },
    });
    await audit(transaction, {
      targetSubmissionId: hold.targetSubmissionId,
      submissionId: hold.submissionId ?? undefined,
      actorId,
      action: "RETENTION_HOLD_RELEASED",
      authorizationId: `retention-hold-release:${hold.id}`,
      reason,
      outcome: hold.type,
      metadata: { holdId: hold.id, releasedAt: releasedAt.toISOString() },
    });
    return released;
  });
}

/** Recover an approved purge before any storage deletion is confirmed. */
export async function cancelSubmissionPurge(
  requestId: string,
  actorId: string,
  options: RetentionOperationOptions,
  dependencies: SubmissionRetentionDependencies = {},
) {
  const reason = requireReason(options.reason);
  const database = databaseOf(dependencies);
  return database.$transaction(async (transaction) => {
    await assertActiveAdmin(transaction, actorId);
    await transaction.$queryRaw`
      SELECT "id" FROM "SubmissionPurgeRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE
    `;
    const request = await transaction.submissionPurgeRequest.findUnique({
      where: { id: requestId },
      include: { objects: true },
    });
    if (!request) {
      throw new RetentionOperationError("PURGE_REQUEST_NOT_FOUND", "Purge request not found");
    }
    if (request.status === "CANCELLED") return request;
    if (request.status !== "QUARANTINED") {
      throw new RetentionOperationError(
        "PURGE_NOT_RECOVERABLE",
        "Only an approved quarantined purge can be recovered",
      );
    }
    if (request.objects.some((object) => object.status !== "QUARANTINED")) {
      throw new RetentionOperationError(
        "PURGE_IRREVERSIBLE",
        "Recovery is unavailable after purge finalization begins",
      );
    }
    await transaction.$queryRaw`
      SELECT "id" FROM "Submission" WHERE "id" = ${request.targetSubmissionId}::uuid FOR UPDATE
    `;
    await transaction.submission.updateMany({
      where: { id: request.targetSubmissionId, retentionStatus: "QUARANTINED" },
      data: { retentionStatus: "RETAINED" },
    });
    await transaction.submissionPurgeObject.updateMany({
      where: { requestId: request.id, status: "QUARANTINED" },
      data: { status: "CANCELLED" },
    });
    const cancelled = await transaction.submissionPurgeRequest.update({
      where: { id: request.id },
      data: { status: "CANCELLED", lastError: null },
    });
    await audit(transaction, {
      targetSubmissionId: request.targetSubmissionId,
      submissionId: request.submissionId ?? undefined,
      purgeRequestId: request.id,
      actorId,
      action: "PURGE_CANCELLED",
      authorizationId: requireAuthorizationId(
        options.authorizationId,
        `purge-recovery:${request.id}`,
      ),
      reason,
      outcome: "RECOVERED",
    });
    await audit(transaction, {
      targetSubmissionId: request.targetSubmissionId,
      submissionId: request.submissionId ?? undefined,
      purgeRequestId: request.id,
      actorId,
      action: "PURGE_RECOVERED",
      authorizationId: `purge-recovery:${request.id}`,
      reason,
      outcome: "RETAINED",
    });
    return cancelled;
  });
}

interface PurgeObjectAttempt {
  id: string;
  requestId: string;
  submissionId: string;
  storageKey: string;
  bucket: string;
}

interface PurgeObjectProcessingResult {
  attempted: boolean;
  failed: boolean;
}

/** Reserve an Answer-media identity before calling the external storage API. */
async function preparePurgeObjectAttempt(
  requestId: string,
  objectId: string,
  actorId: string,
  reason: string,
  authorizationId: string,
  dependencies: SubmissionRetentionDependencies,
): Promise<PurgeObjectAttempt | null> {
  const database = databaseOf(dependencies);
  return database.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id" FROM "SubmissionPurgeRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE
    `;
    const request = await transaction.submissionPurgeRequest.findUnique({
      where: { id: requestId },
      select: { targetSubmissionId: true, status: true },
    });
    if (!request || (request.status !== "QUARANTINED" && request.status !== "FAILED")) {
      return null;
    }
    await transaction.$queryRaw`
      SELECT "id" FROM "Submission" WHERE "id" = ${request.targetSubmissionId}::uuid FOR UPDATE
    `;
    const submission = await loadSubmissionPolicy(
      transaction,
      request.targetSubmissionId,
    );
    if (!submission || submission.retentionStatus !== "QUARANTINED") return null;
    const holdBlockers = activeHoldBlockers(submission);
    if (holdBlockers.length > 0) {
      throw new SubmissionPurgeNotEligibleError(holdBlockers);
    }
    const object = await transaction.submissionPurgeObject.findUnique({
      where: { id: objectId },
    });
    if (
      !object ||
      object.requestId !== requestId ||
      (object.status !== "QUARANTINED" &&
        object.status !== "FAILED" &&
        object.status !== "DELETE_PENDING")
    ) {
      return null;
    }
    await lockPromptMediaStorageIdentity(transaction, object.storageKey);
    const sharedAnswer = await findSharedAnswerMedia(
      transaction,
      request.targetSubmissionId,
      object.storageKey,
      object.bucket,
    );
    if (sharedAnswer) {
      throw new SubmissionPurgeNotEligibleError([
        `Answer media storage identity ${object.bucket}/${object.storageKey} is shared by another retained Submission`,
      ]);
    }
    const attempted = await transaction.submissionPurgeObject.update({
      where: { id: object.id },
      data: {
        status: "DELETE_PENDING",
        attemptCount: { increment: 1 },
        lastError: null,
      },
    });
    await audit(transaction, {
      targetSubmissionId: object.targetSubmissionId,
      submissionId: object.submissionId ?? undefined,
      purgeRequestId: requestId,
      actorId,
      action: "PURGE_DELETE_ATTEMPTED",
      authorizationId,
      reason,
      storageKey: object.storageKey,
      outcome: "DELETE_REQUESTED",
      metadata: { attemptCount: attempted.attemptCount },
    });
    return {
      id: object.id,
      requestId,
      submissionId: object.targetSubmissionId,
      storageKey: object.storageKey,
      bucket: object.bucket,
    };
  }, { maxWait: 60_000, timeout: 10_000 });
}

/** Delete a reserved identity while the advisory lock remains held. */
async function confirmPurgeObjectAttempt(
  attempt: PurgeObjectAttempt,
  actorId: string,
  reason: string,
  authorizationId: string,
  dependencies: SubmissionRetentionDependencies,
): Promise<PurgeObjectProcessingResult> {
  const database = databaseOf(dependencies);
  const storage = storageOf(dependencies);
  try {
    return await database.$transaction(async (transaction) => {
      await transaction.$queryRaw`
        SELECT "id" FROM "SubmissionPurgeRequest" WHERE "id" = ${attempt.requestId}::uuid FOR UPDATE
      `;
      const request = await transaction.submissionPurgeRequest.findUnique({
        where: { id: attempt.requestId },
        select: { targetSubmissionId: true, status: true },
      });
      if (!request || (request.status !== "QUARANTINED" && request.status !== "FAILED")) {
        return { attempted: false, failed: false };
      }
      await transaction.$queryRaw`
        SELECT "id" FROM "Submission" WHERE "id" = ${request.targetSubmissionId}::uuid FOR UPDATE
      `;
      const submission = await loadSubmissionPolicy(
        transaction,
        request.targetSubmissionId,
      );
      if (!submission || submission.retentionStatus !== "QUARANTINED") {
        return { attempted: false, failed: false };
      }
      const holdBlockers = activeHoldBlockers(submission);
      if (holdBlockers.length > 0) {
        throw new SubmissionPurgeNotEligibleError(holdBlockers);
      }
      const object = await transaction.submissionPurgeObject.findUnique({
        where: { id: attempt.id },
      });
      if (!object || object.status !== "DELETE_PENDING") {
        return { attempted: false, failed: false };
      }
      await lockPromptMediaStorageIdentity(transaction, object.storageKey);
      const sharedAnswer = await findSharedAnswerMedia(
        transaction,
        request.targetSubmissionId,
        object.storageKey,
        object.bucket,
      );
      if (sharedAnswer) {
        const message = `Answer media storage identity ${object.bucket}/${object.storageKey} is shared by another retained Submission`;
        await transaction.submissionPurgeObject.update({
          where: { id: object.id },
          data: { status: "FAILED", lastError: message },
        });
        await transaction.submissionPurgeRequest.updateMany({
          where: { id: attempt.requestId, status: { in: ["QUARANTINED", "FAILED"] } },
          data: { status: "FAILED", lastError: message },
        });
        await audit(transaction, {
          targetSubmissionId: object.targetSubmissionId,
          submissionId: object.submissionId ?? undefined,
          purgeRequestId: attempt.requestId,
          actorId,
          action: "PURGE_DELETE_FAILED",
          authorizationId,
          reason,
          storageKey: object.storageKey,
          outcome: "PURGE_SHARED_STORAGE_IDENTITY",
          metadata: { sharedAnswerId: sharedAnswer.id, sharedSubmissionId: sharedAnswer.submissionId },
        });
        return { attempted: true, failed: true };
      }
      try {
        const confirmation = await storage.deleteObject(object.storageKey, object.bucket);
        const missing = confirmation.outcome === "ALREADY_ABSENT";
        await transaction.submissionPurgeObject.update({
          where: { id: object.id },
          data: {
            status: missing ? "MISSING" : "DELETED",
            deletedAt: missing ? null : nowOf(dependencies),
            lastError: null,
          },
        });
        await audit(transaction, {
          targetSubmissionId: object.targetSubmissionId,
          submissionId: object.submissionId ?? undefined,
          purgeRequestId: attempt.requestId,
          actorId,
          action: "PURGE_DELETE_CONFIRMED",
          authorizationId,
          reason,
          storageKey: object.storageKey,
          outcome: confirmation.outcome,
        });
        return { attempted: true, failed: false };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Storage deletion failed";
        await transaction.submissionPurgeObject.update({
          where: { id: object.id },
          data: { status: "FAILED", lastError: message },
        });
        await transaction.submissionPurgeRequest.updateMany({
          where: { id: attempt.requestId, status: { in: ["QUARANTINED", "FAILED"] } },
          data: { status: "FAILED", lastError: message },
        });
        await audit(transaction, {
          targetSubmissionId: object.targetSubmissionId,
          submissionId: object.submissionId ?? undefined,
          purgeRequestId: attempt.requestId,
          actorId,
          action: "PURGE_DELETE_FAILED",
          authorizationId,
          reason,
          storageKey: object.storageKey,
          outcome: message,
        });
        return { attempted: true, failed: true };
      }
    }, { maxWait: 60_000, timeout: 60_000 });
  } catch (error) {
    // The preparation transaction committed DELETE_PENDING before this
    // external call. If persistence fails after storage changed, leave that
    // durable state in place so recovery cannot incorrectly restore access.
    const message = error instanceof Error ? error.message : "Purge finalization failed";
    try {
      await database.$transaction(async (transaction) => {
        await transaction.submissionPurgeRequest.updateMany({
          where: { id: attempt.requestId, status: { in: ["QUARANTINED", "FAILED"] } },
          data: { status: "FAILED", lastError: message },
        });
        await audit(transaction, {
          targetSubmissionId: attempt.submissionId,
          submissionId: attempt.submissionId,
          purgeRequestId: attempt.requestId,
          actorId,
          action: "PURGE_DELETE_FAILED",
          authorizationId,
          reason,
          storageKey: attempt.storageKey,
          outcome: "DELETE_CONFIRMATION_PERSISTENCE_FAILED",
        });
      });
    } catch {
      // DELETE_PENDING remains the durable, non-recoverable retry signal.
    }
    return { attempted: true, failed: true };
  }
}

async function processPurgeObject(
  requestId: string,
  objectId: string,
  actorId: string,
  reason: string,
  authorizationId: string,
  dependencies: SubmissionRetentionDependencies,
): Promise<PurgeObjectProcessingResult> {
  const attempt = await preparePurgeObjectAttempt(
    requestId,
    objectId,
    actorId,
    reason,
    authorizationId,
    dependencies,
  );
  if (!attempt) return { attempted: false, failed: false };
  return confirmPurgeObjectAttempt(
    attempt,
    actorId,
    reason,
    authorizationId,
    dependencies,
  );
}

async function completeSubmissionPurge(
  requestId: string,
  actorId: string,
  reason: string,
  authorizationId: string,
  dependencies: SubmissionRetentionDependencies,
): Promise<void> {
  const database = databaseOf(dependencies);
  await database.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT "id" FROM "SubmissionPurgeRequest" WHERE "id" = ${requestId}::uuid FOR UPDATE
    `;
    const request = await transaction.submissionPurgeRequest.findUnique({
      where: { id: requestId },
      include: { objects: true },
    });
    if (!request || request.status === "CANCELLED" || request.status === "COMPLETED") return;
    if (request.objects.some((object) =>
      object.status !== "DELETED" && object.status !== "MISSING"
    )) {
      throw new RetentionOperationError(
        "PURGE_OBJECTS_INCOMPLETE",
        "Every captured Answer-media object must be storage-confirmed before database evidence is removed",
      );
    }
    for (const object of request.objects) {
      await lockPromptMediaStorageIdentity(transaction, object.storageKey);
      const sharedAnswer = await findSharedAnswerMedia(
        transaction,
        request.targetSubmissionId,
        object.storageKey,
        object.bucket,
      );
      if (sharedAnswer) {
        throw new RetentionOperationError(
          "PURGE_SHARED_STORAGE_IDENTITY",
          `Answer media storage identity ${object.bucket}/${object.storageKey} is shared by another retained Submission`,
        );
      }
    }
    await transaction.$queryRaw`
      SELECT "id" FROM "Submission" WHERE "id" = ${request.targetSubmissionId}::uuid FOR UPDATE
    `;
    const submission = await loadSubmissionPolicy(
      transaction,
      request.targetSubmissionId,
    );
    if (!submission) return;
    const blockers = [
      ...activeHoldBlockers(submission),
      ...(submission.payments.some(
        (payment) => payment.status !== "FAILED" && payment.status !== "REFUNDED",
      )
        ? ["A payment obligation appeared during purge finalization"]
        : []),
      ...(submission.assignments.length > 0 ? ["Examiner assignments appeared during purge finalization"] : []),
      ...(submission.certificate ? ["A certificate appeared during purge finalization"] : []),
    ];
    if (blockers.length > 0) throw new SubmissionPurgeNotEligibleError(blockers);

    // This setting is transaction-local and is accepted only while this
    // request is QUARANTINED. It is the sole escape hatch from the ordinary
    // manifest immutability triggers.
    await transaction.submissionPurgeRequest.update({
      where: { id: request.id },
      data: { status: "QUARANTINED", lastError: null },
    });
    await transaction.$executeRaw`
      SELECT set_config('fluentcheck.retention_purge_request_id', ${request.id}, true)
    `;
    await transaction.answer.deleteMany({ where: { submissionId: request.targetSubmissionId } });
    await transaction.$executeRaw`
      DELETE FROM "ManifestTask"
       WHERE "manifestEntryId" IN (
         SELECT "id" FROM "ManifestEntry" WHERE "submissionId" = ${request.targetSubmissionId}::uuid
       )
    `;
    await transaction.manifestEntry.deleteMany({
      where: { submissionId: request.targetSubmissionId },
    });
    await transaction.submissionManifest.deleteMany({
      where: { submissionId: request.targetSubmissionId },
    });
    await transaction.submissionStartIntent.deleteMany({
      where: { submissionId: request.targetSubmissionId },
    });
    await transaction.payment.deleteMany({
      where: {
        submissionId: request.targetSubmissionId,
        status: { in: ["FAILED", "REFUNDED"] },
      },
    });
    await transaction.submission.update({
      where: { id: request.targetSubmissionId },
      data: { retentionStatus: "PURGED" },
    });
    await audit(transaction, {
      targetSubmissionId: request.targetSubmissionId,
      submissionId: request.targetSubmissionId,
      purgeRequestId: request.id,
      actorId,
      action: "PURGE_COMPLETED",
      authorizationId,
      reason,
      outcome: "IRREVERSIBLE_EVIDENCE_REMOVED",
      metadata: { answerMediaObjectCount: request.objects.length },
    });
    await transaction.submissionPurgeRequest.update({
      where: { id: request.id },
      data: {
        status: "COMPLETED",
        completedAt: nowOf(dependencies),
        lastError: null,
      },
    });
    await transaction.submission.delete({ where: { id: request.targetSubmissionId } });
  });
}

/**
 * Delete captured Answer media only after quarantine and confirmation, then
 * remove the purgeable relational evidence in one authorized transaction.
 * Failed objects remain FAILED and can be retried by calling this operation.
 */
export async function finalizeSubmissionPurge(
  requestId: string,
  actorId: string,
  options: RetentionOperationOptions,
  dependencies: SubmissionRetentionDependencies = {},
) {
  assertCleanupEnabled(dependencies);
  const authorizationId = requireExplicitAuthorizationId(options.authorizationId);
  const reason = requireReason(options.reason);
  const database = databaseOf(dependencies);
  const now = nowOf(dependencies);
  await database.$transaction(async (transaction) => {
    await assertActiveAdmin(transaction, actorId);
    const request = await transaction.submissionPurgeRequest.findUnique({
      where: { id: requestId },
      include: { objects: true },
    });
    if (!request) {
      throw new RetentionOperationError("PURGE_REQUEST_NOT_FOUND", "Purge request not found");
    }
    if (request.status === "COMPLETED" || request.status === "CANCELLED") return;
    if (request.status === "REQUESTED") {
      throw new RetentionOperationError(
        "PURGE_NOT_APPROVED",
        "Purge approval is required before finalization",
      );
    }
    if (!request.quarantineUntil || request.quarantineUntil.getTime() > now.getTime()) {
      throw new RetentionOperationError(
        "PURGE_QUARANTINE_ACTIVE",
        "The Submission quarantine boundary has not elapsed",
        { quarantineUntil: request.quarantineUntil },
      );
    }
  });

  const request = await database.submissionPurgeRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { objects: { orderBy: { storageKey: "asc" } } },
  });
  let failed = false;
  let failure: unknown;
  for (const object of request.objects) {
    if (
      object.status === "DELETED" ||
      object.status === "MISSING" ||
      object.status === "CANCELLED"
    ) continue;
    try {
      const result = await processPurgeObject(
        requestId,
        object.id,
        actorId,
        reason,
        authorizationId,
        dependencies,
      );
      if (result.failed) failed = true;
    } catch (error) {
      failed = true;
      failure ??= error;
    }
  }
  if (failed) {
    return database.submissionPurgeRequest.findUniqueOrThrow({
      where: { id: requestId },
      include: { objects: { orderBy: { storageKey: "asc" } } },
    });
  }

  try {
    await completeSubmissionPurge(
      requestId,
      actorId,
      reason,
      authorizationId,
      dependencies,
    );
  } catch (error) {
    failure = error;
    const message = error instanceof Error ? error.message : "Purge finalization failed";
    await database.$transaction(async (transaction) => {
      await transaction.submissionPurgeRequest.updateMany({
        where: { id: requestId, status: { in: ["QUARANTINED", "FAILED"] } },
        data: { status: "FAILED", lastError: message },
      });
      const current = await transaction.submissionPurgeRequest.findUnique({
        where: { id: requestId },
        select: { targetSubmissionId: true, submissionId: true },
      });
      await audit(transaction, {
        targetSubmissionId: current?.targetSubmissionId,
        submissionId: current?.submissionId ?? undefined,
        purgeRequestId: requestId,
        actorId,
        action: "PURGE_DELETE_FAILED",
        authorizationId,
        reason,
        outcome: message,
      });
    });
  }

  // Keep the failure value available in a debugger without exposing storage
  // provider internals in the normal machine-readable return value.
  void failure;
  return database.submissionPurgeRequest.findUniqueOrThrow({
    where: { id: requestId },
    include: { objects: { orderBy: { storageKey: "asc" } } },
  });
}

export async function getSubmissionPurgeRequest(
  requestId: string,
  dependencies: SubmissionRetentionDependencies = {},
) {
  return databaseOf(dependencies).submissionPurgeRequest.findUnique({
    where: { id: requestId },
    include: { objects: { orderBy: { storageKey: "asc" } }, auditEvents: { orderBy: { createdAt: "asc" } } },
  });
}
