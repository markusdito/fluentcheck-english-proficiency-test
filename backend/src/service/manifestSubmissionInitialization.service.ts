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
  readonly code = "ACTIVE_SUBMISSION_EXISTS";
  readonly retryable = true;

  constructor(readonly submissionId: string) {
    super("An active Submission already exists");
    this.name = "ActiveSubmissionConflictError";
  }
}

/** A previous Submission is still moving through payment and Examiner scoring. */
export class SubmissionInReviewError extends Error {
  readonly code = "SUBMISSION_IN_REVIEW";
  readonly retryable = true;

  constructor(readonly submissionId: string) {
    super("A previous Submission is still in the review pipeline");
    this.name = "SubmissionInReviewError";
  }
}

/** Statuses between recording and scoring completion that block a new Assessment. */
const REVIEW_PIPELINE_STATUSES = ["AWAITING_PAYMENT", "PAID", "SCORING"] as const;

/** The same idempotency key cannot be used for another student's start intent. */
export class IdempotencyKeyConflictError extends Error {
  readonly code = "IDEMPOTENCY_KEY_CONFLICT";
  readonly retryable = false;

  constructor() {
    super("Idempotency-Key is already associated with another student");
    this.name = "IdempotencyKeyConflictError";
  }
}

/** A previously persisted start intent can no longer be replayed. */
export class AssessmentStartIntentClosedError extends Error {
  readonly code = "ASSESSMENT_START_INTENT_CLOSED";
  readonly retryable = false;

  constructor(readonly submissionStatus: string) {
    super("Assessment start intent is closed");
    this.name = "AssessmentStartIntentClosedError";
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

async function findActiveSubmissionId(studentId: string): Promise<string | undefined> {
  const active = await prisma.submission.findFirst({
    where: {
      studentId,
      status: "IN_PROGRESS",
      retentionStatus: "RETAINED",
    },
    select: { id: true },
  });
  return active?.id;
}

/**
 * An unfinished attempt may only be resumed while its manifest still matches
 * the current universal question bank. Retirement or edits of a delivered
 * Question make the attempt stale, so the next start supersedes it with a
 * fresh manifest instead of serving outdated (possibly retired) questions.
 */
async function activeManifestMatchesCurrentBank(submissionId: string): Promise<boolean> {
  const manifest = await prisma.submissionManifest.findFirst({
    where: { submissionId },
    include: { entries: { include: { tasks: { orderBy: { deliveredOrder: "asc" } } } } },
  });
  if (!manifest || manifest.entries.length !== CATEGORIES.length) return false;
  // Delivery binds one shared order across every category. An attempt whose
  // entries span different orders predates that rule and must be rebuilt.
  const deliveredOrders = new Set<number>();
  for (const entry of manifest.entries) {
    const question = await prisma.question.findUnique({
      where: { id: entry.sourceQuestionId },
      include: { tasks: { where: { deletedAt: null }, orderBy: { order: "asc" } } },
    });
    if (
      !question || question.deletedAt || question.category !== entry.category ||
      question.audioUploadStatus !== "UPLOADED" ||
      question.audioStorageKey !== entry.promptMediaStorageKey ||
      question.audioMimeType !== entry.promptMediaMimeType ||
      question.audioSizeBytes !== entry.promptMediaSizeBytes ||
      question.preparationSeconds !== entry.preparationSeconds ||
      question.recordingSeconds !== entry.recordingSeconds ||
      question.tasks.length !== entry.tasks.length || question.tasks.some((task, index) =>
        task.id !== entry.tasks[index]?.sourceTaskId ||
        task.promptText !== entry.tasks[index]?.deliveredText ||
        task.order !== entry.tasks[index]?.deliveredOrder)
    ) {
      return false;
    }
    deliveredOrders.add(question.order);
  }
  return deliveredOrders.size === 1;
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
    error instanceof IdempotencyKeyConflictError ||
    error instanceof AssessmentStartIntentClosedError
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
  if (existingIntent.submission.status !== "IN_PROGRESS") {
    throw new AssessmentStartIntentClosedError(existingIntent.submission.status);
  }
  if (
    existingIntent.submission.retentionStatus &&
    existingIntent.submission.retentionStatus !== "RETAINED"
  ) {
    throw new AssessmentUnavailableError();
  }
  if (!existingIntent.submission.manifest) throw new AssessmentUnavailableError();
  // A stale attempt (its bank was retired or edited) must not be replayed.
  // Fall through so the fresh start supersedes it and re-points this
  // idempotency key at a manifest built from the current question bank.
  if (!(await activeManifestMatchesCurrentBank(existingIntent.submission.id))) return undefined;
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
    if (active && (await activeManifestMatchesCurrentBank(active.id))) {
      // The unfinished attempt still matches the current bank: the student may
      // resume it, and its questions remain bound to their account.
      throw new ActiveSubmissionConflictError(active.id);
    }
    // A stale unfinished attempt (its delivered questions were retired or
    // edited) is superseded inside the final transaction so this start binds
    // the current universal question bank instead of outdated questions.
    const inReview = await prisma.submission.findFirst({
      where: {
        studentId,
        status: { in: [...REVIEW_PIPELINE_STATUSES] },
        retentionStatus: "RETAINED",
      },
      select: { id: true },
    });
    if (inReview) throw new SubmissionInReviewError(inReview.id);
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
    // `order` identifies a question set shared by every category. Delivery must
    // use one order across all categories, never a mix, so choose a single
    // order available in every category and take that order's question from each.
    const ordersByCategory = new Map(
      candidateSets.map(({ category, candidates }) => [
        category,
        new Map(candidates.map((question) => [question.order, question])),
      ]),
    );
    const commonOrders = [...ordersByCategory.get(CATEGORIES[0])!.keys()]
      .filter((order) => CATEGORIES.every((category) => ordersByCategory.get(category)!.has(order)))
      .sort((left, right) => left - right);
    if (commonOrders.length === 0) {
      throw new AssessmentUnavailableError("Assessment unavailable", {
        internalReason: "QUESTION_BANK_INCOMPLETE",
        failedCategories: [...CATEGORIES],
      });
    }
    const selectedOrder = commonOrders[chooseIndex(commonOrders.length)];
    const selected = CATEGORIES.map(
      (category) => ordersByCategory.get(category)!.get(selectedOrder)!,
    );

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
      // Supersede a stale unfinished attempt before creating its replacement:
      // the partial unique index allows only one IN_PROGRESS Submission per
      // student, and the row lock serializes against concurrent starts.
      if (active) {
        await tx.$queryRaw`SELECT "id" FROM "Submission" WHERE "id" = ${active.id}::uuid FOR UPDATE`;
        const superseded = await tx.submission.updateMany({
          where: { id: active.id, studentId, status: "IN_PROGRESS", retentionStatus: "RETAINED" },
          data: { status: "ABANDONED" },
        });
        if (superseded.count === 0) throw new ActiveSubmissionConflictError(active.id);
      }

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
        // Re-point a stale intent from a superseded answer-less attempt at the
        // new Submission so replaying the same key serves the fresh manifest.
        const rebound = await tx.submissionStartIntent.updateMany({
          where: { idempotencyKey, studentId },
          data: { submissionId: submission.id },
        });
        if (rebound.count === 0) {
          await tx.submissionStartIntent.create({
            data: { idempotencyKey, studentId, submissionId: submission.id },
          });
        }
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
    if (isUniqueViolation(error)) {
      // A concurrent request may have won the idempotency insert after the
      // initial lookup. Replay its committed result after the transaction rolls
      // back, preserving exactly one manifest for the key.
      if (idempotencyKey) {
        try {
          const replay = await replayStartIntent(studentId, idempotencyKey, signPromptMedia, deadline);
          if (replay) return replay;
        } catch (replayError) {
          observeInitializationFailure(replayError, observeFailure, {
            requestId,
            startedAt,
            now,
          });
          if (
            replayError instanceof IdempotencyKeyConflictError ||
            replayError instanceof AssessmentStartIntentClosedError
          ) {
            throw replayError;
          }
          if (isAssessmentInitializationUnavailable(replayError)) {
            throw new AssessmentUnavailableError();
          }
          throw replayError;
        }
      }

      // Prisma adapters may expose the single-active constraint as a generic
      // P2002 without the database constraint name. Check the committed
      // active row after replay lookup so concurrent starts converge to the
      // same typed conflict instead of becoming a 500 or key conflict.
      const activeId = await findActiveSubmissionId(studentId);
      if (activeId) throw new ActiveSubmissionConflictError(activeId);
      if (idempotencyKey) throw new IdempotencyKeyConflictError();
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
  // Never resume a stale unfinished attempt whose delivered Questions were
  // retired or edited; the client must start again against the current bank.
  if (!(await activeManifestMatchesCurrentBank(submission.id))) {
    throw new AssessmentUnavailableError("No active assessment");
  }
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
