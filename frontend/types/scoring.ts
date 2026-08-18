export type ScoringSystem = "LEGACY_100" | "RUBRIC_6";

export const RUBRIC_CRITERIA = [
  "pronunciation",
  "fluency",
  "vocabulary",
  "grammar",
] as const;

export type RubricCriterion = (typeof RUBRIC_CRITERIA)[number];

export interface RubricValues {
  pronunciation: number;
  fluency: number;
  vocabulary: number;
  grammar: number;
}

export interface RubricBreakdown extends RubricValues {
  overall: number;
}

export interface RubricScoreInput {
  answerId: string;
  rubric: RubricValues;
  comment?: string;
}

export interface LegacyScoreInput {
  answerId: string;
  value: number;
  comment?: string;
}

export type ScoreSubmissionInput = RubricScoreInput | LegacyScoreInput;

export function scoreMaximum(scoringSystem: ScoringSystem): number {
  return scoringSystem === "RUBRIC_6" ? 6 : 100;
}
