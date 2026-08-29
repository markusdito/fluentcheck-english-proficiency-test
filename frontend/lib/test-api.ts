import { api } from "./api";
import type { ApiQuestion, TestQuestionWithAudio } from "@/types/test";

interface QuestionsResponse {
  status: string;
  data: ApiQuestion[];
}

/**
 * Fetch all active questions with their tasks, grouped or sorted by order.
 * GET /api/questions
 */
export async function fetchQuestions(): Promise<ApiQuestion[]> {
  const res = await api.get<QuestionsResponse>("/questions");
  return res.data;
}

export async function fetchTestQuestions(
  signal?: AbortSignal,
): Promise<TestQuestionWithAudio[]> {
  const res = await api.get<{
    status: string;
    data: TestQuestionWithAudio[];
  }>("/questions/test", { signal });
  return res.data;
}

interface CreateSubmissionResponse {
  status: string;
  data: {
    id: string;
    status: string;
    createdAt: string;
  };
}

export interface InitializedSubmission {
  submissionId: string;
  status: string;
  manifestId: string;
  version: number;
  entries: Array<{
    id: string;
    category: "PART_1" | "PART_2" | "PART_3";
    deliveryPosition: number;
    preparationSeconds: number;
    recordingSeconds: number;
    promptMediaMimeType: string;
    promptMediaSizeBytes: number;
    promptMediaUrl: string;
    tasks: Array<{ order: number; promptText: string }>;
  }>;
  uploadedEntryIds?: string[];
}

export async function initializeSubmission(idempotencyKey: string): Promise<InitializedSubmission> {
  const res = await api.post<{ status: string; data: InitializedSubmission }>(
    "/submissions",
    undefined,
    { headers: { "Idempotency-Key": idempotencyKey } },
  );
  return res.data;
}

/** Resume the student's current manifest when a fresh tab has lost its key. */
export async function resumeActiveSubmission(): Promise<InitializedSubmission> {
  const res = await api.get<{ status: string; data: InitializedSubmission }>("/submissions/active");
  return res.data;
}

/** Explicitly abandon an unfinished attempt before starting another one. */
export async function abandonSubmission(submissionId: string): Promise<void> {
  await api.post(`/submissions/${submissionId}/abandon`);
}

/**
 * Create a new test submission.
 * POST /api/submissions
 */
export async function createSubmission(): Promise<string> {
  const res = await api.post<CreateSubmissionResponse>("/submissions");
  return res.data.id;
}

/**
 * Mark a submission as complete after all answers have been uploaded.
 * POST /api/submissions/:id/complete
 */
export async function completeSubmission(submissionId: string): Promise<void> {
  await api.post(`/submissions/${submissionId}/complete`);
}
