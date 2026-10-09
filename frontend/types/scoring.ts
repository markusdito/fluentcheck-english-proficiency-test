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

/** An Examiner's one Score for the whole Submission: 4 criteria + their own overall band. */
export interface RubricScoreInput {
  rubric: RubricValues;
  overall: number;
  comment?: string;
}

export interface LegacyScoreInput {
  value: number;
  comment?: string;
}

export type ScoreSubmissionInput = RubricScoreInput | LegacyScoreInput;

export function scoreMaximum(scoringSystem: ScoringSystem): number {
  return scoringSystem === "RUBRIC_6" ? 6 : 100;
}
