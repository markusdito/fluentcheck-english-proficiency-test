import { api } from "./api";
import type {
  AdminExaminer,
  AdminQuestion,
  AdminSettings,
  AdminStats,
  AdminSubmission,
  AdminSubmissionDetail,
  AdminTask,
  AdminUser,
  Paginated,
  AssignSubmissionResult,
} from "@/types/admin";

interface PaginatedEnvelope<T> {
  status: string;
  data: Paginated<T>;
}

interface ListEnvelope<T> {
  status: string;
  data: T[];
}

interface AdminStatsEnvelope {
  status: string;
  data: AdminStats;
}

interface AdminSettingsEnvelope {
  status: string;
  data: AdminSettings;
}

interface QuestionEnvelope {
  status: string;
  data: AdminQuestion;
}

interface AdminSubmissionEnvelope {
  status: string;
  data: AdminSubmissionDetail;
}

interface TaskEnvelope {
  status: string;
  data: AdminTask;
}

function toQueryString(
  params?: Record<string, string | number | undefined> | object
): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params as Record<string, unknown>)) {
    if (value !== undefined && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

export interface FetchAdminUsersParams {
  page?: number;
  limit?: number;
  role?: string;
  q?: string;
}

export async function fetchAdminUsers(
  params?: FetchAdminUsersParams,
  signal?: AbortSignal,
): Promise<Paginated<AdminUser>> {
  const res = await api.get<PaginatedEnvelope<AdminUser>>(
    `/admin/users${toQueryString(params)}`,
    { signal },
  );
  return res.data;
}

export async function updateUserRole(id: string, role: string): Promise<void> {
  await api.put(`/admin/users/${id}/role`, { role });
}

export async function fetchAdminExaminers(signal?: AbortSignal): Promise<AdminExaminer[]> {
  const res = await api.get<ListEnvelope<AdminExaminer>>("/admin/examiners", { signal });
  return res.data;
}

export interface FetchAdminSubmissionsParams {
  page?: number;
  limit?: number;
  status?: string;
}

export async function fetchAdminSubmissions(
  params?: FetchAdminSubmissionsParams,
  signal?: AbortSignal,
): Promise<Paginated<AdminSubmission>> {
  const res = await api.get<PaginatedEnvelope<AdminSubmission>>(
    `/admin/submissions${toQueryString(params)}`,
    { signal },
  );
  return res.data;
}

export async function fetchAdminSubmissionDetail(
  submissionId: string,
  signal?: AbortSignal,
): Promise<AdminSubmissionDetail> {
  const res = await api.get<AdminSubmissionEnvelope>(
    `/admin/submissions/${submissionId}`,
    { signal },
  );
  return res.data;
}

export async function assignExaminers(
  submissionId: string,
): Promise<AssignSubmissionResult> {
  const res = await api.post<{ status: string; data: AssignSubmissionResult }>(
    `/admin/submissions/${submissionId}/assign`,
  );
  return res.data;
}

export async function fetchAdminStats(signal?: AbortSignal): Promise<AdminStats> {
  const res = await api.get<AdminStatsEnvelope>("/admin/stats", { signal });
  return res.data;
}

export async function fetchAdminSettings(signal?: AbortSignal): Promise<AdminSettings> {
  const res = await api.get<AdminSettingsEnvelope>("/admin/settings", {
    cache: "no-store",
    signal,
  });
  return res.data;
}

export async function updateAdminSettings(
  paymentEnabled: boolean
): Promise<AdminSettings> {
  const res = await api.put<AdminSettingsEnvelope>("/admin/settings", {
    paymentEnabled,
  });
  return res.data;
}

export async function fetchAdminQuestions(signal?: AbortSignal): Promise<AdminQuestion[]> {
  const res = await api.get<ListEnvelope<AdminQuestion>>("/questions/admin", { signal });
  return res.data;
}

interface QuestionPayload {
  category: string;
  order: number;
  preparationSeconds?: number;
  recordingSeconds?: number;
}

export async function createQuestion(
  payload: QuestionPayload
): Promise<AdminQuestion> {
  const res = await api.post<QuestionEnvelope>("/questions", payload);
  return res.data;
}

export async function updateQuestion(
  id: string,
  payload: Partial<QuestionPayload>
): Promise<AdminQuestion> {
  const res = await api.put<QuestionEnvelope>(`/questions/${id}`, payload);
  return res.data;
}

export async function retireQuestion(id: string): Promise<void> {
  await api.delete(`/questions/${id}`);
}

interface TaskPayload {
  promptText: string;
  order: number;
}

export async function createTask(
  questionId: string,
  payload: TaskPayload
): Promise<AdminTask> {
  const res = await api.post<TaskEnvelope>(
    `/questions/${questionId}/tasks`,
    payload
  );
  return res.data;
}

export async function updateTask(
  questionId: string,
  taskId: string,
  payload: Partial<TaskPayload>
): Promise<AdminTask> {
  const res = await api.put<TaskEnvelope>(
    `/questions/${questionId}/tasks/${taskId}`,
    payload
  );
  return res.data;
}

export async function deleteTask(
  questionId: string,
  taskId: string
): Promise<void> {
  await api.delete(`/questions/${questionId}/tasks/${taskId}`);
}
