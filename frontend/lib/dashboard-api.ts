import { api } from "./api";
import type {
  RubricBreakdown,
  ScoringSystem,
} from "@/types/scoring";

export const DASHBOARD_PAGE_SIZE = 10;

export interface SubmissionSummary {
  id: string;
  status: string;
  score: string | null;
  scoringSystem: ScoringSystem;
  createdAt: string;
}

export interface ScaleAwareScore {
  value: number;
  scoringSystem: ScoringSystem;
}

export interface DashboardPageParams {
  limit?: number;
  cursor?: string;
}

export interface DashboardPagination {
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface DashboardStats {
  totalTests: number;
  bestScore: ScaleAwareScore | null;
  submissions: SubmissionSummary[];
  pagination: DashboardPagination;
}

export interface AnswerDetail {
  id: string;
  questionId: string;
  questionCategory: string;
  audioUrl: string | null;
  durationSeconds: number | null;
  videoUrl: string | null;
  score: number | null;
  rubric: RubricBreakdown | null;
  comments: string[];
}

export interface SubmissionDetail {
  id: string;
  status: string;
  score: string | null;
  scoringSystem: ScoringSystem;
  rubric: RubricBreakdown | null;
  createdAt: string;
  answers: AnswerDetail[];
}

export interface SubmissionStatusSnapshot {
  id: string;
  status: string;
  updatedAt: string;
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
 * GET /api/submissions?limit={limit}&cursor={cursor}
 */
export async function fetchDashboardStats(
  params: DashboardPageParams = {},
  signal?: AbortSignal,
): Promise<DashboardStats> {
  const query = new URLSearchParams();
  if (params.limit !== undefined) query.set("limit", String(params.limit));
  if (params.cursor !== undefined) query.set("cursor", params.cursor);
  const queryString = query.toString();
  const endpoint = queryString ? `/submissions?${queryString}` : "/submissions";
  const res = await api.get<DashboardResponse>(endpoint, { signal });
  return res.data;
}

/**
 * Fetch a single submission with answers and presigned video URLs.
 * GET /api/submissions/:id
 */
export async function fetchSubmissionDetail(
  submissionId: string,
  signal?: AbortSignal,
): Promise<SubmissionDetail> {
  const res = await api.get<SubmissionDetailResponse>(
    `/submissions/${submissionId}`,
    { signal },
  );
  return res.data;
}

export async function fetchSubmissionStatus(
  submissionId: string,
  signal?: AbortSignal,
): Promise<SubmissionStatusSnapshot> {
  const res = await api.get<{
    status: string;
    data: SubmissionStatusSnapshot;
  }>(`/submissions/${submissionId}/status`, { signal });
  return res.data;
}

export interface PaymentCheckout {
  paymentUrl: string;
  merchantReference: string;
  amount: number;
  currency: string;
}

/**
 * Create an iPaymu hosted checkout for a submission.
 * POST /api/payments/submissions/:id/pay
 */
export async function paySubmission(
  submissionId: string
): Promise<PaymentCheckout> {
  const res = await api.post<{ status: string; data: PaymentCheckout }>(
    `/payments/submissions/${submissionId}/pay`
  );
  return res.data;
}
