import { api } from "./api";
import type { ExaminerAssignmentSummary, AssignmentDetail } from "@/types/examiner";

interface AssignmentsResponse {
  status: string;
  data: ExaminerAssignmentSummary[];
}

interface AssignmentDetailResponse {
  status: string;
  data: AssignmentDetail;
}

export async function fetchExaminerAssignments(): Promise<ExaminerAssignmentSummary[]> {
  const res = await api.get<AssignmentsResponse>("/examiner/assignments");
  return res.data;
}

export async function fetchExaminerAssignmentDetail(
  assignmentId: string
): Promise<AssignmentDetail> {
  const res = await api.get<AssignmentDetailResponse>(
    `/examiner/assignments/${assignmentId}`
  );
  return res.data;
}

export async function startExaminerAssignment(assignmentId: string): Promise<void> {
  await api.put(`/examiner/assignments/${assignmentId}/start`);
}

export async function submitExaminerScores(
  assignmentId: string,
  scores: Array<{ answerId: string; value: number; comment?: string }>
): Promise<void> {
  await api.post(`/examiner/assignments/${assignmentId}/scores`, { scores });
}
