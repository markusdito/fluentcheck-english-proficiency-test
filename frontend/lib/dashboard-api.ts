import { api } from "./api";

export interface SubmissionSummary {
  id: string;
  status: string;
  score: string | null;
  createdAt: string;
}

export interface DashboardStats {
  totalTests: number;
  averageScore: number | null;
  bestScore: number | null;
  submissions: SubmissionSummary[];
}

interface DashboardResponse {
  status: string;
  data: DashboardStats;
}

/**
 * Fetch dashboard stats and submission history for the authenticated user.
 * GET /api/submissions
 */
export async function fetchDashboardStats(): Promise<DashboardStats> {
  const res = await api.get<DashboardResponse>("/submissions");
  return res.data;
}