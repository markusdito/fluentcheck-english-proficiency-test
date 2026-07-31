import { api } from "./api";

export interface SubmissionSummary {
  id: string;
  status: string;
  score: string | null;
  createdAt: string;
}

export interface DashboardStats {
  totalTests: number;
  bestScore: number | null;
  submissions: SubmissionSummary[];
}

export interface AnswerDetail {
  id: string;
  questionId: string;
  questionCategory: string;
  promptText: string;
  durationSeconds: number | null;
  videoUrl: string | null;
  score: number | null;
  comments: string[];
}

export interface SubmissionDetail {
  id: string;
  status: string;
  score: string | null;
  createdAt: string;
  answers: AnswerDetail[];
}

interface DashboardResponse {
  status: string;
  data: DashboardStats;
}

interface SubmissionDetailResponse {
  status: string;
  data: SubmissionDetail;
}

/**
 * Fetch dashboard stats and submission history for the authenticated user.
 * GET /api/submissions
 */
export async function fetchDashboardStats(): Promise<DashboardStats> {
  const res = await api.get<DashboardResponse>("/submissions");
  return res.data;
}

/**
 * Fetch a single submission with answers and presigned video URLs.
 * GET /api/submissions/:id
 */
export async function fetchSubmissionDetail(
  submissionId: string
): Promise<SubmissionDetail> {
  const res = await api.get<SubmissionDetailResponse>(
    `/submissions/${submissionId}`
  );
  return res.data;
}

/**
 * Simulate payment for a submission.
 * POST /api/payments/submissions/:id/pay
 */
export async function paySubmission(submissionId: string): Promise<void> {
  await api.post(`/payments/submissions/${submissionId}/pay`, {
    amount: 0,
    provider: "simulation",
  });
}
