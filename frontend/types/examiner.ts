import type {
  RubricValues,
  ScoringSystem,
} from "@/types/scoring";

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
  savedScore: {
    value: number;
    rubric: RubricValues | null;
    comment: string | null;
  } | null;
}

export interface AssignmentDetail {
  id: string;
  status: "ASSIGNED" | "IN_PROGRESS" | "COMPLETED";
  submissionId: string;
  studentName: string;
  submissionStatus: string;
  scoringSystem: ScoringSystem;
  answers: AssignmentAnswer[];
  createdAt: string;
  updatedAt: string;
}
