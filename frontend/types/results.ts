import type { RubricBreakdown } from "@/types/scoring";

export type ScoreBreakdown = RubricBreakdown;

export interface Feedback {
  pronunciation: string;
  fluency: string;
  vocabulary: string;
  grammar: string;
  overall: string;
}

export interface TestResult {
  id: string;
  testName: string;
  completedAt: string;
  score: ScoreBreakdown;
  feedback: Feedback;
  status: "pending" | "graded";
}
