import { prisma } from "../config/db.js";
import {
  ASSESSMENT_SLOTS,
  CURRENT_MANIFEST_VERSION,
  ELIGIBLE_QUESTION_WHERE,
  PRACTICE_TEST_SET_WHERE,
} from "./assessmentSlots.js";
import { hasDeliverableContent } from "./questionContent.js";
import { createOptionIconViewUrl, createQuestionAudioViewUrlFromMetadata } from "./upload.service.js";
import {
  buildManifestDelivery,
  isValidPromptMediaUrl,
  ManifestEvidenceUnavailableError,
  type ManifestDeliveryFailure,
} from "./submissionManifestDelivery.service.js";

interface TestQuestionTask {
  id: string;
  promptText: string;
  order: number;
}

export interface TestQuestionRecord {
  id: string;
  category: string;
  testSetId: string;
  preparationSeconds: number;
  recordingSeconds: number;
  audioUploadStatus: string;
  audioStorageKey: string | null;
  audioMimeType: string | null;
  tasks: TestQuestionTask[];
}

type SignQuestionAudio = (
  storageKey: string,
  mimeType: string | null,
) => Promise<string>;

export async function buildTestQuestionDelivery(
  questions: TestQuestionRecord[],
  signQuestionAudio: SignQuestionAudio,
) {
  const attempts = await Promise.all(
    questions.map(async (question) => {
      const missingMedia =
        question.audioUploadStatus !== "UPLOADED" ||
        !question.audioStorageKey ||
        !question.audioMimeType;
      if (missingMedia) {
        return {
          question,
          failure: {
            entryId: question.id,
            category: question.category,
            reason: "MISSING_MEDIA_METADATA" as const,
          },
        };
      }

      try {
        const audioUrl = await signQuestionAudio(
          question.audioStorageKey!,
          question.audioMimeType!,
        );
        if (!isValidPromptMediaUrl(audioUrl)) {
          return {
            question,
            failure: {
              entryId: question.id,
              category: question.category,
              reason: "INVALID_SIGNED_URL" as const,
            },
          };
        }
        return { question, audioUrl };
      } catch {
        return {
          question,
          failure: {
            entryId: question.id,
            category: question.category,
            reason: "SIGNING_FAILED" as const,
          },
        };
      }
    }),
  );
  const failures = attempts.flatMap((attempt) =>
    attempt.failure ? [attempt.failure as ManifestDeliveryFailure] : [],
  );
  if (failures.length > 0) {
    throw new ManifestEvidenceUnavailableError("Prompt media unavailable", {
      operation: "prompt-media-signing",
      failureCount: failures.length,
      failures,
    });
  }

  return attempts.map((attempt) => {
    if (!attempt.audioUrl) {
      throw new ManifestEvidenceUnavailableError("Prompt media unavailable");
    }
    const { question } = attempt;
    return {
      id: question.id,
      category: question.category,
      testSetId: question.testSetId,
      preparationSeconds: question.preparationSeconds,
      recordingSeconds: question.recordingSeconds,
      audioUploadStatus: question.audioUploadStatus,
      audioUrl: attempt.audioUrl,
      tasks: question.tasks,
    };
  });
}

/**
 * Unscored practice run (PRD FR-3.3): the Practice Test Set delivered in the
 * real slot shape, without creating a Submission or manifest. Practice
 * recordings never leave the device, so nothing here is persisted.
 */
export async function buildPracticeDelivery(
  signPromptMedia: (storageKey: string, mimeType: string) => Promise<string> = createQuestionAudioViewUrlFromMetadata,
  signOptionIcon: (storageKey: string, mimeType: string) => Promise<string> = createOptionIconViewUrl,
) {
  const questions = (await prisma.question.findMany({
    where: { ...ELIGIBLE_QUESTION_WHERE, testSet: PRACTICE_TEST_SET_WHERE },
    orderBy: { id: "asc" },
    include: {
      testSet: { select: { id: true, code: true } },
      tasks: { where: { deletedAt: null }, orderBy: { order: "asc" } },
    },
  })).filter(hasDeliverableContent);

  const selected = ASSESSMENT_SLOTS.map((category) => questions.find((question) => question.category === category));
  if (selected.some((question) => !question)) {
    throw new ManifestEvidenceUnavailableError("Practice unavailable");
  }
  const entries = await buildManifestDelivery(
    {
      id: "practice",
      version: CURRENT_MANIFEST_VERSION,
      entries: selected.map((question, index) => ({
        id: question!.id,
        category: question!.category,
        deliveryPosition: index + 1,
        preparationSeconds: question!.preparationSeconds,
        recordingSeconds: question!.recordingSeconds,
        promptMediaStorageKey: question!.audioStorageKey!,
        promptMediaMimeType: question!.audioMimeType!,
        promptMediaSizeBytes: question!.audioSizeBytes!,
        tasks: question!.tasks.map((task, order) => ({ deliveredOrder: order + 1, deliveredText: task.promptText })),
        cueCard: question!.cueCard,
        options: question!.options,
      })),
    },
    signPromptMedia,
    signOptionIcon,
  );
  return { testSet: selected[0]!.testSet, entries };
}
