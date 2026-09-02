import { randomInt, randomUUID } from "node:crypto";
import { prisma } from "../config/db.js";
import { createQuestionAudioViewUrlFromMetadata } from "./upload.service.js";
import { lockPromptMediaStorageIdentity } from "./promptMediaLock.service.js";
import {
  buildManifestDelivery,
  ManifestEvidenceUnavailableError,
  PromptMediaPreparationTimeoutError,
  type ManifestDeliveryFailure,
  type ManifestDeliveryManifest,
} from "./submissionManifestDelivery.service.js";
import {
  reportAssessmentInitializationAttempt,
  reportAssessmentInitializationFailure,
  reportAssessmentInitializationSuccess,
  type AssessmentInitializationFailureClass,
  type AssessmentInitializationFailureEvent,
  type AssessmentInitializationFailureReason,
} from "./assessmentInitializationObservability.service.js";

const CATEGORIES = ["PART_1", "PART_2", "PART_3"] as const;
const INITIALIZATION_DEADLINE_MS = 10_000;

export class AssessmentUnavailableError extends Error {
  readonly code = "ASSESSMENT_UNAVAILABLE";
  readonly retryable = true;
  readonly retryAfterSeconds = 5;
  readonly internalReason: AssessmentInitializationFailureReason;
  readonly failedCategories: string[];

  constructor(
    message = "Assessment unavailable",
    details: {
      internalReason?: AssessmentInitializationFailureReason;
      failedCategories?: string[];
    } = {},
  ) {
    super(message);
    this.name = "AssessmentUnavailableError";
    this.internalReason = details.internalReason ?? "UNKNOWN";
    this.failedCategories = details.failedCategories ?? [];
  }
}

export interface AssessmentInitializationDependencies {
  chooseIndex?: (length: number) => number;
  signPromptMedia?: (storageKey: string, mimeType: string) => Promise<string>;
  now?: () => number;
  deadline?: number;
  attempt?: number;
  requestId?: string;
  startedAt?: number;
  suppressAttemptObservation?: boolean;
  suppressFailureObservation?: boolean;
  observeAttempt?: (event: { requestId: string }) => void;
  observeFailure?: (event: AssessmentInitializationFailureEvent) => void;
  observeSuccess?: (event: { requestId: string; preparationDurationMs: number }) => void;
}

export class ActiveSubmissionConflictError extends Error {
  constructor(readonly submissionId: string) {
    super("An active Submission already exists");
    this.name = "ActiveSubmissionConflictError";
  }
}

/** The same idempotency key cannot be used for another student's start intent. */
export class IdempotencyKeyConflictError extends Error {
  constructor() {
    super("Idempotency-Key is already associated with another student");
    this.name = "IdempotencyKeyConflictError";
  }
}

class EligibilityConflictError extends Error {
  constructor() {
    super("Selected assessment evidence changed during initialization");
    this.name = "EligibilityConflictError";
  }
}

function withDeadline<T>(promise: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - Date.now();
  if (remaining <= 0) return Promise.reject(new PromptMediaPreparationTimeoutError());
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new PromptMediaPreparationTimeoutError()),
      remaining,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

function isAssessmentInitializationUnavailable(error: unknown): boolean {
  return (
    error instanceof AssessmentUnavailableError ||
    error instanceof ManifestEvidenceUnavailableError ||
    error instanceof EligibilityConflictError
  );
}

function safeDuration(now: () => number, startedAt: number): number {
  const duration = now() - startedAt;
  return Number.isFinite(duration) && duration >= 0 ? Math.round(duration) : 0;
}

function failureReason(
  error: unknown,
  diagnostics: { failures: ManifestDeliveryFailure[] } | undefined,
): AssessmentInitializationFailureReason {
  if (error instanceof EligibilityConflictError) return "ELIGIBILITY_CONFLICT";
  if (error instanceof AssessmentUnavailableError) return error.internalReason;
  const reasons = diagnostics?.failures.map((failure) => failure.reason) ?? [];
  if (reasons.includes("DEADLINE_EXCEEDED")) {
    return "INITIALIZATION_DEADLINE_EXCEEDED";
  }
  if (reasons.includes("INVALID_SIGNED_URL")) return "PROMPT_MEDIA_INVALID_URL";
  if (reasons.includes("MISSING_MEDIA_METADATA")) {
    return "PROMPT_MEDIA_MISSING_METADATA";
  }
  if (reasons.includes("SIGNING_FAILED")) return "PROMPT_MEDIA_SIGNING_FAILED";
  return "UNKNOWN";
}

function failureClass(
  error: unknown,
  diagnostics: { failures: ManifestDeliveryFailure[] } | undefined,
): AssessmentInitializationFailureClass {
  if (error instanceof EligibilityConflictError) return "ELIGIBILITY_CONFLICT";
  if (error instanceof AssessmentUnavailableError) {
    if (error.internalReason === "QUESTION_BANK_INCOMPLETE") return "BANK";
    if (error.internalReason === "INITIALIZATION_DEADLINE_EXCEEDED") return "TIMEOUT";
    return "PREPARATION";
  }
  if (diagnostics?.failures.some((failure) => failure.reason === "DEADLINE_EXCEEDED")) {
    return "TIMEOUT";
  }
  if (diagnostics) return "PREPARATION";
  return "UNKNOWN";
}

function observeInitializationFailure(
  error: unknown,
  observeFailure: (event: AssessmentInitializationFailureEvent) => void,
  context: {
    requestId: string;
    startedAt: number;
    now: () => number;
  },
): void {
  if (
    error instanceof ActiveSubmissionConflictError ||
    error instanceof IdempotencyKeyConflictError
  ) {
    return;
  }
  const diagnostics = error instanceof ManifestEvidenceUnavailableError
    ? error.diagnostics
    : undefined;
  try {
    observeFailure({
      eventName: "submission_initialization_failed",
      classification: failureClass(error, diagnostics),
      internalReason: failureReason(error, diagnostics),
      requestId: context.requestId,
      categoryCount: CATEGORIES.length,
      failureCount: diagnostics?.failureCount ?? 1,
      failedQuestionIds: [...new Set(
        diagnostics?.failures
          .map((failure) => failure.questionId)
          .filter((questionId): questionId is string => Boolean(questionId)) ?? [],
      )],
      failedCategories: [...new Set(
        diagnostics?.failures.map((failure) => failure.category) ??
          (error instanceof AssessmentUnavailableError ? error.failedCategories : []),
      )],
      preparationDurationMs: safeDuration(context.now, context.startedAt),
      ...(diagnostics ? { failedEntries: diagnostics.failures } : {}),
    });
  } catch {
    // Observability failures must never alter initialization behavior.
  }
}

function observeAttempt(
  observer: (event: { requestId: string }) => void,
  requestId: string,
): void {
  try {
    observer({ requestId });
  } catch {
    // Observability failures must never alter initialization behavior.
  }
}

function observeSuccess(
  observer: (event: { requestId: string; preparationDurationMs: number }) => void,
  context: { requestId: string; startedAt: number; now: () => number },
): void {
  try {
    observer({
      requestId: context.requestId,
      preparationDurationMs: safeDuration(context.now, context.startedAt),
    });
  } catch {
    // Observability failures must never alter initialization behavior.
  }
}

async function replayStartIntent(
  studentId: string,
  idempotencyKey: string,
  signPromptMedia: NonNullable<AssessmentInitializationDependencies["signPromptMedia"]>,
  deadline: number,
) {
  const existingIntent = await prisma.submissionStartIntent.findUnique({
    where: { idempotencyKey },
    include: { submission: { include: { manifest: { include: { entries: { include: { tasks: true } } } } } } },
  });
  if (!existingIntent) return undefined;
  if (existingIntent.studentId !== studentId) throw new IdempotencyKeyConflictError();
  if (
    existingIntent.submission.retentionStatus &&
    existingIntent.submission.retentionStatus !== "RETAINED"
  ) {
    throw new AssessmentUnavailableError();
  }
  if (!existingIntent.submission.manifest) throw new AssessmentUnavailableError();
  const manifest: ManifestDeliveryManifest = {
    id: existingIntent.submission.manifest.id,
    version: existingIntent.submission.manifest.version,
    entries: existingIntent.submission.manifest.entries.map((entry) => ({
      id: entry.id,
      category: entry.category,
      deliveryPosition: entry.deliveryPosition,
      preparationSeconds: entry.preparationSeconds,
      recordingSeconds: entry.recordingSeconds,
      promptMediaStorageKey: entry.promptMediaStorageKey,
      promptMediaMimeType: entry.promptMediaMimeType,
      promptMediaSizeBytes: entry.promptMediaSizeBytes,
      sourceQuestionId: entry.sourceQuestionId,
      tasks: entry.tasks.map((task) => ({ deliveredOrder: task.deliveredOrder, deliveredText: task.deliveredText })),
    })),
  };
  const entries = await buildManifestDelivery(
    manifest,
    (key, mime) => withDeadline(signPromptMedia(key, mime), deadline),
  );
  return { submissionId: existingIntent.submissionId, status: existingIntent.submission.status, manifestId: manifest.id, version: manifest.version, entries };
}

/** Select, snapshot, and persist one complete manifest atomically. */
export async function initializeManifestSubmission(
  studentId: string,
  idempotencyKey?: string,
  dependencies: AssessmentInitializationDependencies = {},
) {
  const chooseIndex = dependencies.chooseIndex ?? ((length: number) => randomInt(length));
  const signPromptMedia = dependencies.signPromptMedia ?? createQuestionAudioViewUrlFromMetadata;
  const now = dependencies.now ?? Date.now;
  const startedAt = dependencies.startedAt ?? now();
  const requestId = dependencies.requestId ?? randomUUID();
  const deadline = dependencies.deadline ?? startedAt + INITIALIZATION_DEADLINE_MS;
  const observeFailure = dependencies.observeFailure ?? reportAssessmentInitializationFailure;
  const observeAttemptCallback = dependencies.observeAttempt ?? reportAssessmentInitializationAttempt;
  const observeSuccessCallback = dependencies.observeSuccess ?? reportAssessmentInitializationSuccess;

  if (!dependencies.suppressAttemptObservation) {
    observeAttempt(observeAttemptCallback, requestId);
  }

  try {
    if (idempotencyKey) {
      const replay = await replayStartIntent(studentId, idempotencyKey, signPromptMedia, deadline);
      if (replay) {
        observeSuccess(observeSuccessCallback, { requestId, startedAt, now });
        return replay;
      }
    }
    const active = await prisma.submission.findFirst({
      where: {
        studentId,
        status: "IN_PROGRESS",
        retentionStatus: "RETAINED",
      },
      select: { id: true },
    });
    if (active) throw new ActiveSubmissionConflictError(active.id);
    const candidateSets = await Promise.all(
      CATEGORIES.map(async (category) => {
        const candidates = await prisma.question.findMany({
          where: {
            category,
            deletedAt: null,
            audioUploadStatus: "UPLOADED",
            audioStorageKey: { not: null },
            audioMimeType: { not: null },
            audioSizeBytes: { not: null },
            tasks: { some: { deletedAt: null } },
          },
          orderBy: { id: "asc" },
          include: {
            tasks: {
              where: { deletedAt: null },
              orderBy: { order: "asc" },
            },
          },
        });
        return { category, candidates };
      }),
    );
    const unavailableCategories = candidateSets
      .filter(({ candidates }) => candidates.length === 0)
      .map(({ category }) => category);
    if (unavailableCategories.length > 0) {
      throw new AssessmentUnavailableError("Assessment unavailable", {
        internalReason: "QUESTION_BANK_INCOMPLETE",
        failedCategories: unavailableCategories,
      });
    }
    const selected = candidateSets.map(({ candidates }) => candidates[chooseIndex(candidates.length)]);

    const manifestId = randomUUID();
    const prepared = selected.map((question, index) => {
      if (
        !question.audioStorageKey ||
        !question.audioMimeType ||
        question.audioSizeBytes === null ||
        question.audioSizeBytes <= 0
      ) {
        throw new AssessmentUnavailableError("Assessment unavailable", {
          internalReason: "PROMPT_MEDIA_MISSING_METADATA",
          failedCategories: [question.category],
        });
      }
      return {
        question,
        deliveryPosition: index + 1,
        manifestEntryId: randomUUID(),
      };
    });
    const safe = await buildManifestDelivery(
      {
        id: manifestId,
        version: 1,
          entries: prepared.map((item) => ({
            id: item.manifestEntryId,
            category: item.question.category,
            deliveryPosition: item.deliveryPosition,
          preparationSeconds: item.question.preparationSeconds,
          recordingSeconds: item.question.recordingSeconds,
          promptMediaStorageKey: item.question.audioStorageKey!,
            promptMediaMimeType: item.question.audioMimeType!,
            promptMediaSizeBytes: item.question.audioSizeBytes!,
            sourceQuestionId: item.question.id,
            tasks: item.question.tasks.map((task) => ({
            deliveredOrder: task.order,
            deliveredText: task.promptText,
          })),
        })),
      },
      (key, mime) => withDeadline(signPromptMedia(key, mime), deadline),
    );

    const result = await prisma.$transaction(async (tx) => {
      // Lock all selected Prompt-media identities in a stable order before
      // validating and creating the manifest references. This serializes
      // initialization with retirement and cleanup without introducing a
      // category-order deadlock between concurrent starts.
      for (const item of [...prepared].sort((left, right) =>
        left.question.audioStorageKey!.localeCompare(right.question.audioStorageKey!),
      )) {
        await lockPromptMediaStorageIdentity(tx, item.question.audioStorageKey!);
      }

      const submission = await tx.submission.create({
        data: { studentId, status: "IN_PROGRESS" },
      });
      const manifest = await tx.submissionManifest.create({
        data: { id: manifestId, submissionId: submission.id, version: 1 },
      });
      for (const item of prepared) {
        const current = await tx.question.findUnique({
          where: { id: item.question.id },
          include: { tasks: { where: { deletedAt: null }, orderBy: { order: "asc" } } },
        });
        if (
          !current || current.deletedAt || current.audioStorageKey !== item.question.audioStorageKey ||
          current.audioMimeType !== item.question.audioMimeType || current.audioSizeBytes !== item.question.audioSizeBytes ||
          current.preparationSeconds !== item.question.preparationSeconds ||
          current.recordingSeconds !== item.question.recordingSeconds ||
          current.tasks.length !== item.question.tasks.length || current.tasks.some((task, index) =>
            task.id !== item.question.tasks[index]?.id || task.promptText !== item.question.tasks[index]?.promptText ||
            task.order !== item.question.tasks[index]?.order)
        ) {
          throw new EligibilityConflictError();
        }
        const entry = await tx.manifestEntry.create({
          data: {
            id: item.manifestEntryId,
            manifestId: manifest.id,
            submissionId: submission.id,
            category: item.question.category,
            deliveryPosition: item.deliveryPosition,
            sourceQuestionId: item.question.id,
            preparationSeconds: item.question.preparationSeconds,
            recordingSeconds: item.question.recordingSeconds,
            promptMediaStorageKey: item.question.audioStorageKey!,
            promptMediaMimeType: item.question.audioMimeType!,
            promptMediaSizeBytes: item.question.audioSizeBytes!,
          },
        });
        for (const task of item.question.tasks) {
          await tx.manifestTask.create({
            data: {
              manifestEntryId: entry.id,
              sourceQuestionId: item.question.id,
              sourceTaskId: task.id,
              deliveredOrder: task.order,
              deliveredText: task.promptText,
            },
          });
        }
      }
      if (idempotencyKey) {
        await tx.submissionStartIntent.create({
          data: { idempotencyKey, studentId, submissionId: submission.id },
        });
      }
      return { submission, manifest };
    });
    const response = {
      submissionId: result.submission.id,
      status: result.submission.status,
      manifestId: result.manifest.id,
      version: result.manifest.version,
      entries: safe,
    };
    observeSuccess(observeSuccessCallback, { requestId, startedAt, now });
    return response;
  } catch (error) {
    if (error instanceof EligibilityConflictError && (dependencies.attempt ?? 0) < 2) {
      return initializeManifestSubmission(studentId, idempotencyKey, {
        ...dependencies,
        attempt: (dependencies.attempt ?? 0) + 1,
        deadline,
        requestId,
        startedAt,
        suppressAttemptObservation: true,
        suppressFailureObservation: true,
      });
    }
    if (error instanceof Error && error.message.includes("Submission_one_active_per_student_key")) {
      const active = await prisma.submission.findFirst({
        where: {
          studentId,
          status: "IN_PROGRESS",
          retentionStatus: "RETAINED",
        },
        select: { id: true },
      });
      if (active) throw new ActiveSubmissionConflictError(active.id);
    }
    if (idempotencyKey && isUniqueViolation(error)) {
      // A concurrent request may have won the idempotency insert after the
      // initial lookup. Replay its committed result after the transaction rolls
      // back, preserving exactly one manifest for the key.
      try {
        const replay = await replayStartIntent(studentId, idempotencyKey, signPromptMedia, deadline);
        if (replay) return replay;
      } catch (replayError) {
        observeInitializationFailure(replayError, observeFailure, {
          requestId,
          startedAt,
          now,
        });
        if (isAssessmentInitializationUnavailable(replayError)) {
          throw new AssessmentUnavailableError();
        }
        throw replayError;
      }
      throw new IdempotencyKeyConflictError();
    }
    if (!dependencies.suppressFailureObservation) {
      observeInitializationFailure(error, observeFailure, {
        requestId,
        startedAt,
        now,
      });
    }
    if (isAssessmentInitializationUnavailable(error)) {
      throw new AssessmentUnavailableError();
    }
    throw error;
  }
}

export async function resumeManifestSubmission(
  studentId: string,
  dependencies: AssessmentInitializationDependencies = {},
) {
  const signPromptMedia = dependencies.signPromptMedia ?? createQuestionAudioViewUrlFromMetadata;
  const now = dependencies.now ?? Date.now;
  const startedAt = dependencies.startedAt ?? now();
  const requestId = dependencies.requestId ?? randomUUID();
  const deadline = dependencies.deadline ?? startedAt + INITIALIZATION_DEADLINE_MS;
  const submission = await prisma.submission.findFirst({
    where: { studentId, status: "IN_PROGRESS", retentionStatus: "RETAINED" },
    orderBy: { createdAt: "desc" },
    include: {
      manifest: { include: { entries: { include: { tasks: true } } } },
      answers: { select: { manifestEntryId: true, uploadStatus: true } },
    },
  });
  if (!submission?.manifest) throw new AssessmentUnavailableError("No active assessment");
  const manifest: ManifestDeliveryManifest = {
    id: submission.manifest.id,
    version: submission.manifest.version,
    entries: submission.manifest.entries.map((entry) => ({
      id: entry.id,
      category: entry.category,
      deliveryPosition: entry.deliveryPosition,
      preparationSeconds: entry.preparationSeconds,
      recordingSeconds: entry.recordingSeconds,
      promptMediaStorageKey: entry.promptMediaStorageKey,
      promptMediaMimeType: entry.promptMediaMimeType,
      promptMediaSizeBytes: entry.promptMediaSizeBytes,
      sourceQuestionId: entry.sourceQuestionId,
      tasks: entry.tasks.map((task) => ({ deliveredOrder: task.deliveredOrder, deliveredText: task.deliveredText })),
    })),
  };
  let entries;
  try {
    entries = await buildManifestDelivery(
      manifest,
      (key, mime) => withDeadline(signPromptMedia(key, mime), deadline),
    );
  } catch (error) {
    if (!(error instanceof ManifestEvidenceUnavailableError)) throw error;
    observeInitializationFailure(
      error,
      dependencies.observeFailure ?? reportAssessmentInitializationFailure,
      { requestId, startedAt, now },
    );
    throw new AssessmentUnavailableError();
  }
  return {
    submissionId: submission.id,
    status: submission.status,
    manifestId: manifest.id,
    version: manifest.version,
    entries,
    uploadedEntryIds: submission.answers
      .filter((answer) => answer.uploadStatus === "UPLOADED" && answer.manifestEntryId)
      .map((answer) => answer.manifestEntryId as string),
  };
}
