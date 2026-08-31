import {
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
  order: number;
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
      order: question.order,
      preparationSeconds: question.preparationSeconds,
      recordingSeconds: question.recordingSeconds,
      audioUploadStatus: question.audioUploadStatus,
      audioUrl: attempt.audioUrl,
      tasks: question.tasks,
    };
  });
}
