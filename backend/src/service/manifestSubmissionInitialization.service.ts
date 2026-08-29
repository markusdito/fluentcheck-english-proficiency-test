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

/** Select, snapshot, and persist one complete manifest atomically. */
export async function initializeManifestSubmission(
  studentId: string,
  dependencies: InitializationDependencies = {},
) {
  const chooseIndex = dependencies.chooseIndex ?? ((length: number) => randomInt(length));
  const signPromptMedia = dependencies.signPromptMedia ?? createQuestionAudioViewUrlFromMetadata;
  const deadline = (dependencies.now ?? Date.now)() + INITIALIZATION_DEADLINE_MS;

  try {
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
        const promptMediaUrl = await withDeadline(
          signPromptMedia(question.audioStorageKey, question.audioMimeType),
          deadline,
        );
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
          current.tasks.length !== item.question.tasks.length || current.tasks.some((task, index) =>
            task.id !== item.question.tasks[index]?.id || task.promptText !== item.question.tasks[index]?.promptText ||
            task.order !== item.question.tasks[index]?.order)
        ) {
          throw new AssessmentUnavailableError();
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
    if (error instanceof AssessmentUnavailableError || error instanceof ManifestEvidenceUnavailableError) {
      throw new AssessmentUnavailableError();
    }
    throw error;
  }
}
