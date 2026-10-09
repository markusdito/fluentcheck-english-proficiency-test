import type {
  RubricValues,
  ScoringSystem,
} from "@/types/scoring";
import type { TestSetRef } from "@/types/test";

export interface ExaminerTask {
  id: string;
  promptText: string;
  order: number;
}

export interface ExaminerAssignmentSummary {
  id: string;
  status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED";
  submissionId: string;
  studentName: string;
  submissionStatus: string;
  testSet: TestSetRef | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssignmentAnswer {
  id: string;
  questionId: string;
  questionCategory: string;
  preparationSeconds: number;
  recordingSeconds: number;
  audioUrl: string | null;
  tasks: ExaminerTask[];
  durationSeconds: number | null;
  videoUrl: string | null;
}

/** The Examiner's whole-Submission Score; `value` is the overall band. */
export interface SavedScore {
  value: number;
  rubric: RubricValues | null;
  comment: string | null;
}

export interface AssignmentDetail {
  id: string;
  status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED";
  submissionId: string;
  studentName: string;
  submissionStatus: string;
  scoringSystem: ScoringSystem;
  testSet: TestSetRef | null;
  answers: AssignmentAnswer[];
  savedScore: SavedScore | null;
  createdAt: string;
  updatedAt: string;
}
