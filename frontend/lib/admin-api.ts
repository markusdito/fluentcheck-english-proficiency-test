import { api } from "./api";
import type { CueCard } from "@/types/test";
import type {
  AdminExaminer,
  AdminQuestion,
  AdminSettings,
  AdminStats,
  AdminSubmission,
  AdminSubmissionDetail,
  AdminTask,
  AdminTestSet,
  AdminUser,
  Paginated,
  AssignSubmissionResult,
  AccountTransitionPreview,
  AccountTransitionResult,
  AdminOpenFlag,
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

interface AccountTransitionPreviewEnvelope {
  status: string;
  data: AccountTransitionPreview;
}

interface AccountTransitionResultEnvelope {
  status: string;
  data: AccountTransitionResult;
}

export async function fetchRoleTransitionPreview(
  id: string,
  role: string,
  signal?: AbortSignal,
): Promise<AccountTransitionPreview> {
  const params = new URLSearchParams({ role });
  const res = await api.get<AccountTransitionPreviewEnvelope>(
    `/admin/users/${id}/role-transition-preview?${params.toString()}`,
    { signal },
  );
  return res.data;
}

export async function updateUserRole(
  id: string,
  role: string,
  reassignmentMap?: Record<string, string>,
): Promise<AccountTransitionResult> {
  const res = await api.put<AccountTransitionResultEnvelope>(
    `/admin/users/${id}/role`,
    { role, ...(reassignmentMap ? { reassignmentMap } : {}) },
  );
  return res.data;
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

export interface FetchAdminQuestionsParams {
  includeRetired?: boolean;
}

export async function fetchAdminQuestions(
  params?: FetchAdminQuestionsParams,
  signal?: AbortSignal,
): Promise<AdminQuestion[]> {
  const endpoint = params?.includeRetired
    ? "/questions/admin?includeRetired=true"
    : "/questions/admin";
  const res = await api.get<ListEnvelope<AdminQuestion>>(endpoint, { signal });
  return res.data;
}

interface QuestionPayload {
  category: string;
  testSetId: string;
  preparationSeconds?: number;
  recordingSeconds?: number;
  cueCard?: CueCard | null;
  /** Option text only; icons are bound through the verified icon upload. */
  options?: Array<{ title: string; bullets: string[] }> | null;
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

/** Every Test Set with per-slot readiness (Draft vs deliverable). */
export async function fetchTestSets(signal?: AbortSignal): Promise<AdminTestSet[]> {
  const res = await api.get<ListEnvelope<AdminTestSet>>("/admin/test-sets", { signal });
  return res.data;
}

export async function createTestSet(code: string): Promise<Pick<AdminTestSet, "id" | "code" | "createdAt">> {
  const res = await api.post<{ status: string; data: Pick<AdminTestSet, "id" | "code" | "createdAt"> }>(
    "/admin/test-sets",
    { code },
  );
  return res.data;
}

export async function renameTestSet(id: string, code: string): Promise<Pick<AdminTestSet, "id" | "code" | "createdAt">> {
  const res = await api.put<{ status: string; data: Pick<AdminTestSet, "id" | "code" | "createdAt"> }>(
    `/admin/test-sets/${id}`,
    { code },
  );
  return res.data;
}

export async function retireQuestion(id: string): Promise<void> {
  await api.delete(`/questions/${id}`);
}

export async function restoreQuestion(id: string): Promise<AdminQuestion> {
  const res = await api.post<QuestionEnvelope>(`/questions/${id}/restore`);
  return res.data;
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

export async function restoreTask(
  questionId: string,
  taskId: string,
): Promise<AdminTask> {
  const res = await api.post<TaskEnvelope>(
    `/questions/${questionId}/tasks/${taskId}/restore`,
  );
  return res.data;
}

/** Upload one Part 3 option icon: presigned PUT to R2, then server-side verification. */
export async function uploadOptionIcon(
  questionId: string,
  optionIndex: number,
  file: File,
): Promise<void> {
  const base = `/questions/${questionId}/options/${optionIndex}/icon`;
  const { data } = await api.post<{ status: string; data: { presignedUrl: string; storageKey: string } }>(
    `${base}/presigned-url`,
    { mimeType: file.type },
  );
  const response = await fetch(data.presignedUrl, {
    method: "PUT",
    body: file,
    mode: "cors",
    headers: { "Content-Type": file.type },
  });
  if (!response.ok) throw new Error(`Icon upload failed (${response.status})`);
  await api.post(`${base}/confirm`, { storageKey: data.storageKey });
}

export async function fetchOpenFlags(signal?: AbortSignal): Promise<AdminOpenFlag[]> {
  const res = await api.get<ListEnvelope<AdminOpenFlag>>("/admin/flags", { signal });
  return res.data;
}

/** Confirm: the Submission is voided and its student gets one free retake. */
export async function confirmFlag(flagId: string, note: string): Promise<void> {
  await api.post(`/admin/flags/${flagId}/confirm`, { note });
}

/** Dismiss: false alarm; the Submission returns to its flow. */
export async function dismissFlag(flagId: string, note: string): Promise<void> {
  await api.post(`/admin/flags/${flagId}/dismiss`, { note });
}
