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
  return Promise.all(
    questions.map(async (question) => {
      let audioUrl: string | null = null;
      if (
        question.audioUploadStatus === "UPLOADED" &&
        question.audioStorageKey
      ) {
        try {
          audioUrl = await signQuestionAudio(
            question.audioStorageKey,
            question.audioMimeType,
          );
        } catch {
          audioUrl = null;
        }
      }

      return {
        id: question.id,
        category: question.category,
        order: question.order,
        preparationSeconds: question.preparationSeconds,
        recordingSeconds: question.recordingSeconds,
        audioUploadStatus: question.audioUploadStatus,
        audioUrl,
        tasks: question.tasks,
      };
    }),
  );
}
