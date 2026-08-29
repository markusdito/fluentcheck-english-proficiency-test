import { initializeSubmission, resumeActiveSubmission } from "@/lib/test-api";
import { ApiError } from "@/lib/api";
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
  let initialized;
  try {
    initialized = await initializeSubmission(key);
  } catch (error) {
    // A new tab/session has no previous idempotency key. Recover the existing
    // active attempt rather than presenting a dead-end 409 to the student.
    if (!(error instanceof ApiError) || error.statusCode !== 409) throw error;
    try {
      initialized = await resumeActiveSubmission();
    } catch {
      // Preserve the original conflict when there is no resumable attempt
      // (for example, an idempotency key belongs to a different account).
      throw error;
    }
  }

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
