import { api } from "./api";
import type { ExaminerAssignmentSummary, AssignmentDetail } from "@/types/examiner";
import type { ScoreSubmissionInput } from "@/types/scoring";

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
  scores: ScoreSubmissionInput[]
): Promise<void> {
  await api.post(`/examiner/assignments/${assignmentId}/scores`, { scores });
}

export async function saveExaminerAnswerScore(
  assignmentId: string,
  score: ScoreSubmissionInput,
): Promise<void> {
  await api.put(
    `/examiner/assignments/${assignmentId}/scores/${score.answerId}`,
    score,
  );
}

export async function completeExaminerScoring(
  assignmentId: string,
): Promise<void> {
  await api.post(`/examiner/assignments/${assignmentId}/complete`);
}
