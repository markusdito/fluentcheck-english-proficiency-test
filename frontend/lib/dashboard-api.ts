import { api } from "./api";
import type {
  RubricBreakdown,
  ScoringSystem,
} from "@/types/scoring";

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

export interface DashboardStats {
  totalTests: number;
  bestScore: ScaleAwareScore | null;
  submissions: SubmissionSummary[];
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

export interface PaymentCheckout {
  paymentUrl: string;
  referenceId: string;
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
