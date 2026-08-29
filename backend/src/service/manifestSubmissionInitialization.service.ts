import { randomInt } from "node:crypto";
import { prisma } from "../config/db.js";
import { createQuestionAudioViewUrlFromMetadata } from "./upload.service.js";
import {
  buildManifestDelivery,
  ManifestEvidenceUnavailableError,
  type ManifestDeliveryManifest,
} from "./submissionManifestDelivery.service.js";

const CATEGORIES = ["PART_1", "PART_2", "PART_3"] as const;
const INITIALIZATION_DEADLINE_MS = 10_000;

export class AssessmentUnavailableError extends Error {
  readonly code = "ASSESSMENT_UNAVAILABLE";
  readonly retryable = true;
  readonly retryAfterSeconds = 5;

  constructor(message = "Assessment unavailable") {
    super(message);
    this.name = "AssessmentUnavailableError";
  }
}

interface InitializationDependencies {
  chooseIndex?: (length: number) => number;
  signPromptMedia?: (storageKey: string, mimeType: string) => Promise<string>;
  now?: () => number;
  deadline?: number;
  attempt?: number;
  observeFailure?: (event: {
    classification: "BANK" | "PREPARATION" | "TIMEOUT" | "ELIGIBILITY_CONFLICT" | "UNKNOWN";
    categoryCount: number;
    failureCount: number;
  }) => void;
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
  if (remaining <= 0) return Promise.reject(new AssessmentUnavailableError());
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new AssessmentUnavailableError()), remaining),
    ),
  ]);
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

async function replayStartIntent(
  studentId: string,
  idempotencyKey: string,
  signPromptMedia: NonNullable<InitializationDependencies["signPromptMedia"]>,
) {
  const existingIntent = await prisma.submissionStartIntent.findUnique({
    where: { idempotencyKey },
    include: { submission: { include: { manifest: { include: { entries: { include: { tasks: true } } } } } } },
  });
  if (!existingIntent) return undefined;
  if (existingIntent.studentId !== studentId) throw new IdempotencyKeyConflictError();
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
      tasks: entry.tasks.map((task) => ({ deliveredOrder: task.deliveredOrder, deliveredText: task.deliveredText })),
    })),
  };
  const entries = await buildManifestDelivery(manifest, signPromptMedia);
  return { submissionId: existingIntent.submissionId, status: existingIntent.submission.status, manifestId: manifest.id, version: manifest.version, entries };
}

/** Select, snapshot, and persist one complete manifest atomically. */
export async function initializeManifestSubmission(
  studentId: string,
  idempotencyKey?: string,
  dependencies: InitializationDependencies = {},
) {
  const chooseIndex = dependencies.chooseIndex ?? ((length: number) => randomInt(length));
  const signPromptMedia = dependencies.signPromptMedia ?? createQuestionAudioViewUrlFromMetadata;
  const deadline = dependencies.deadline ?? (dependencies.now ?? Date.now)() + INITIALIZATION_DEADLINE_MS;

  try {
    if (idempotencyKey) {
      const replay = await replayStartIntent(studentId, idempotencyKey, signPromptMedia);
      if (replay) return replay;
    }
    const active = await prisma.submission.findFirst({
      where: { studentId, status: "IN_PROGRESS" },
      select: { id: true },
    });
    if (active) throw new ActiveSubmissionConflictError(active.id);
    const selected = await Promise.all(
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
        if (candidates.length === 0) throw new AssessmentUnavailableError();
        return candidates[chooseIndex(candidates.length)];
      }),
    );

    const prepared = await Promise.all(
      selected.map(async (question, index) => {
        if (!question.audioStorageKey || !question.audioMimeType || question.audioSizeBytes === null) {
          throw new AssessmentUnavailableError();
        }
        let promptMediaUrl: string;
        try {
          promptMediaUrl = await withDeadline(
            signPromptMedia(question.audioStorageKey, question.audioMimeType),
            deadline,
          );
        } catch {
          throw new AssessmentUnavailableError();
        }
        if (!promptMediaUrl || !/^https:\/\//.test(promptMediaUrl)) {
          throw new AssessmentUnavailableError();
        }
        return {
          question,
          promptMediaUrl,
          deliveryPosition: index + 1,
        };
      }),
    );

    const result = await prisma.$transaction(async (tx) => {
      const submission = await tx.submission.create({
        data: { studentId, status: "IN_PROGRESS" },
      });
      const manifest = await tx.submissionManifest.create({
        data: { submissionId: submission.id, version: 1 },
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

    const delivery: ManifestDeliveryManifest = {
      id: result.manifest.id,
      version: result.manifest.version,
      entries: prepared.map((item) => ({
        id: "",
        category: item.question.category,
        deliveryPosition: item.deliveryPosition,
        preparationSeconds: item.question.preparationSeconds,
        recordingSeconds: item.question.recordingSeconds,
        promptMediaStorageKey: item.question.audioStorageKey!,
        promptMediaMimeType: item.question.audioMimeType!,
        promptMediaSizeBytes: item.question.audioSizeBytes!,
        tasks: item.question.tasks.map((task) => ({ deliveredOrder: task.order, deliveredText: task.promptText })),
      })),
    };
    const persistedEntries = await prisma.manifestEntry.findMany({
      where: { manifestId: result.manifest.id },
      orderBy: { deliveryPosition: "asc" },
      select: { id: true, category: true, deliveryPosition: true, preparationSeconds: true, recordingSeconds: true,
        promptMediaStorageKey: true, promptMediaMimeType: true, promptMediaSizeBytes: true,
        tasks: { orderBy: { deliveredOrder: "asc" }, select: { deliveredOrder: true, deliveredText: true } } },
    });
    delivery.entries = persistedEntries;
    const safe = await buildManifestDelivery(delivery, async (key, mime) => {
      if (key === prepared.find((item) => item.question.audioStorageKey === key)?.question.audioStorageKey) {
        return prepared.find((item) => item.question.audioStorageKey === key)?.promptMediaUrl ?? signPromptMedia(key, mime);
      }
      return signPromptMedia(key, mime);
    });
    return { submissionId: result.submission.id, status: result.submission.status, manifestId: result.manifest.id, version: result.manifest.version, entries: safe };
  } catch (error) {
    if (error instanceof EligibilityConflictError && (dependencies.attempt ?? 0) < 2) {
      return initializeManifestSubmission(studentId, idempotencyKey, {
        ...dependencies,
        attempt: (dependencies.attempt ?? 0) + 1,
        deadline,
      });
    }
    if (error instanceof Error && error.message.includes("Submission_one_active_per_student_key")) {
      const active = await prisma.submission.findFirst({
        where: { studentId, status: "IN_PROGRESS" },
        select: { id: true },
      });
      if (active) throw new ActiveSubmissionConflictError(active.id);
    }
    if (idempotencyKey && isUniqueViolation(error)) {
      // A concurrent request may have won the idempotency insert after the
      // initial lookup. Replay its committed result after the transaction rolls
      // back, preserving exactly one manifest for the key.
      const replay = await replayStartIntent(studentId, idempotencyKey, signPromptMedia);
      if (replay) return replay;
      throw new IdempotencyKeyConflictError();
    }
    if (dependencies.observeFailure && !(error instanceof ActiveSubmissionConflictError)) {
      const classification = error instanceof EligibilityConflictError
        ? "ELIGIBILITY_CONFLICT"
        : error instanceof AssessmentUnavailableError || error instanceof ManifestEvidenceUnavailableError
          ? "PREPARATION"
          : "UNKNOWN";
      try {
        dependencies.observeFailure({
          classification,
          categoryCount: CATEGORIES.length,
          failureCount: 1,
        });
      } catch {
        // Observability failures must never alter initialization behavior.
      }
    }
    if (error instanceof AssessmentUnavailableError || error instanceof ManifestEvidenceUnavailableError || error instanceof EligibilityConflictError) {
      throw new AssessmentUnavailableError();
    }
    throw error;
  }
}

export async function resumeManifestSubmission(
  studentId: string,
  dependencies: InitializationDependencies = {},
) {
  const signPromptMedia = dependencies.signPromptMedia ?? createQuestionAudioViewUrlFromMetadata;
  const submission = await prisma.submission.findFirst({
    where: { studentId, status: "IN_PROGRESS" },
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
      tasks: entry.tasks.map((task) => ({ deliveredOrder: task.deliveredOrder, deliveredText: task.deliveredText })),
    })),
  };
  const entries = await buildManifestDelivery(manifest, signPromptMedia);
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
