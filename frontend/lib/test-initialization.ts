import { createSubmission, fetchTestQuestions } from "@/lib/test-api";
import type { Prompt } from "@/types/test";

export interface InitializedTest {
  submissionId: string;
  questions: Prompt[];
}

export async function initializeTest(): Promise<InitializedTest> {
  const [submissionId, questions] = await Promise.all([
    createSubmission(),
    fetchTestQuestions(),
  ]);

  return {
    submissionId,
    questions: questions.map((question) => ({
      id: question.id,
      audioUrl: question.audioUrl,
      tasks: question.tasks.map((task) => task.promptText),
      task: question.tasks.map((task) => task.promptText).join("\n"),
      prepTime: question.preparationSeconds,
      recordingDuration: question.recordingSeconds,
      order: question.order,
    })),
  };
}
