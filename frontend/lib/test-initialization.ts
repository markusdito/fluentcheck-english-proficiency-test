import { initializeSubmission } from "@/lib/test-api";
import type { Prompt } from "@/types/test";

export interface InitializedTest {
  submissionId: string;
  questions: Prompt[];
}

export async function initializeTest(): Promise<InitializedTest> {
  const keyStorage = "fluentcheck.assessment-start-key";
  const key = typeof window !== "undefined"
    ? window.sessionStorage.getItem(keyStorage) ?? crypto.randomUUID()
    : crypto.randomUUID();
  if (typeof window !== "undefined") window.sessionStorage.setItem(keyStorage, key);
  const initialized = await initializeSubmission(key);

  return {
    submissionId: initialized.submissionId,
    questions: initialized.entries.map((entry) => ({
      id: entry.id,
      audioUrl: entry.promptMediaUrl,
      tasks: entry.tasks.map((task) => task.promptText),
      task: entry.tasks.map((task) => task.promptText).join("\n"),
      prepTime: entry.preparationSeconds,
      recordingDuration: entry.recordingSeconds,
      order: entry.deliveryPosition,
    })),
  };
}
