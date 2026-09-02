import { initializeSubmission, resumeActiveSubmission } from "@/lib/test-api";
import { ApiError } from "@/lib/api";
import {
  getOrCreateAssessmentStartIntent,
  rotateAssessmentStartIntent,
} from "@/lib/assessment-start-intent";
import type { Prompt } from "@/types/test";

export interface InitializedTest {
  submissionId: string;
  questions: Prompt[];
  uploadedEntryIds: string[];
}

function mapInitializedTest(initialized: Awaited<ReturnType<typeof initializeSubmission>>): InitializedTest {
  return {
    submissionId: initialized.submissionId,
    uploadedEntryIds: initialized.uploadedEntryIds ?? [],
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

function isActiveSubmissionConflict(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.statusCode === 409 &&
    (error.code === "ACTIVE_SUBMISSION_EXISTS" || error.code === undefined)
  );
}

function isClosedOrForeignStartIntent(error: unknown): error is ApiError {
  return (
    error instanceof ApiError &&
    error.statusCode === 409 &&
    (error.code === "IDEMPOTENCY_KEY_CONFLICT" ||
      error.code === "ASSESSMENT_START_INTENT_CLOSED")
  );
}

async function resumeAfterConflict(originalError: ApiError): Promise<InitializedTest> {
  try {
    return mapInitializedTest(await resumeActiveSubmission());
  } catch (resumeError) {
    if (
      resumeError instanceof ApiError &&
      resumeError.statusCode === 503 &&
      resumeError.code === "ASSESSMENT_UNAVAILABLE"
    ) {
      throw resumeError;
    }
    throw originalError;
  }
}

export async function initializeTest(studentId: string): Promise<InitializedTest> {
  let key = getOrCreateAssessmentStartIntent(studentId);
  try {
    return mapInitializedTest(await initializeSubmission(key));
  } catch (error) {
    if (isActiveSubmissionConflict(error)) {
      return resumeAfterConflict(error);
    }

    if (isClosedOrForeignStartIntent(error)) {
      key = rotateAssessmentStartIntent(studentId);
      try {
        return mapInitializedTest(await initializeSubmission(key));
      } catch (retryError) {
        if (isActiveSubmissionConflict(retryError)) {
          return resumeAfterConflict(retryError);
        }
        throw retryError;
      }
    }

    throw error;
  }
}
