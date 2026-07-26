import { api } from "./api";
import type { ApiQuestion } from "@/types/test";

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

interface CreateSubmissionResponse {
  status: string;
  data: {
    id: string;
    status: string;
    createdAt: string;
  };
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
