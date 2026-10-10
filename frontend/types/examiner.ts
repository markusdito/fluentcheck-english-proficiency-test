import type {
  RubricValues,
  ScoringSystem,
} from "@/types/scoring";
import type { CueCard, DeliveredOption, TestSetRef } from "@/types/test";

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
  /** Manifest delivery position (1-5); null for a Submission without a manifest. */
  deliveryPosition: number | null;
  preparationSeconds: number;
  recordingSeconds: number;
  audioUrl: string | null;
  tasks: ExaminerTask[];
  /** Delivered prompt snapshot content; null when the slot has none. */
  cueCard: CueCard | null;
  options: DeliveredOption[] | null;
  durationSeconds: number | null;
  technicalFailure: boolean;
  technicalFailureReason: string | null;
  /** Signed, time-limited and audited on every detail fetch. */
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
  /** Scoring is paused while a flag is under Admin review (FLAG_REVIEW). */
  paused: boolean;
  answers: AssignmentAnswer[];
  savedScore: SavedScore | null;
  createdAt: string;
  updatedAt: string;
}
