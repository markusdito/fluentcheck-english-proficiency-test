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

export interface ScoringFinalizationResult {
  outcome: "COMPLETED" | "ALREADY_COMPLETED";
  assignmentStatus: string;
  submissionStatus: string;
}

interface ScoringFinalizationResponse {
  status: string;
  data: ScoringFinalizationResult;
}

export async function fetchExaminerAssignments(signal?: AbortSignal): Promise<ExaminerAssignmentSummary[]> {
  const res = await api.get<AssignmentsResponse>("/examiner/assignments", { signal });
  return res.data;
}

export async function fetchExaminerAssignmentDetail(
  assignmentId: string,
  signal?: AbortSignal,
): Promise<AssignmentDetail> {
  const res = await api.get<AssignmentDetailResponse>(
    `/examiner/assignments/${assignmentId}`,
    { signal },
  );
  return res.data;
}

export async function startExaminerAssignment(assignmentId: string): Promise<void> {
  await api.put(`/examiner/assignments/${assignmentId}/start`);
}

export async function saveExaminerScore(
  assignmentId: string,
  score: ScoreSubmissionInput,
): Promise<void> {
  await api.put(`/examiner/assignments/${assignmentId}/score`, score);
}

/** Raise an integrity concern on one Answer; scoring pauses for Admin review (PRD FR-4.5). */
export async function raiseIntegrityConcern(
  assignmentId: string,
  concern: { answerId: string; timestampSeconds?: number; note: string },
): Promise<void> {
  await api.post(`/examiner/assignments/${assignmentId}/integrity-concerns`, concern);
}

export async function completeExaminerScoring(
  assignmentId: string,
): Promise<ScoringFinalizationResult> {
  const response = await api.post<ScoringFinalizationResponse>(
    `/examiner/assignments/${assignmentId}/complete`,
  );
  return response.data;
}
