export const RUBRIC_CRITERIA = [
  "pronunciation",
  "fluency",
  "vocabulary",
  "grammar",
] as const;

export type RubricCriterion = (typeof RUBRIC_CRITERIA)[number];
export type ScoringSystemValue = "LEGACY_100" | "RUBRIC_6";

export interface RubricValues {
  pronunciation: number;
  fluency: number;
  vocabulary: number;
  grammar: number;
}

export interface RubricBreakdown extends RubricValues {
  overall: number;
}

export interface StoredScoreValues {
  value: unknown;
  pronunciation: unknown | null;
  fluency: unknown | null;
  vocabulary: unknown | null;
  grammar: unknown | null;
}

export class ScoreValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScoreValidationError";
  }
}

export function roundScore(value: number): number {
  return Number(value.toFixed(2));
}

export function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function isValidRubricBand(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 1 &&
    value <= 6 &&
    Number.isInteger(value * 2)
  );
}

export function validateRubricValues(value: unknown): RubricValues {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ScoreValidationError("A complete rubric is required for every answer");
  }

  const candidate = value as Record<string, unknown>;
  const rubric = {} as RubricValues;

  for (const criterion of RUBRIC_CRITERIA) {
    const band = candidate[criterion];
    if (!isValidRubricBand(band)) {
      throw new ScoreValidationError(
        `${criterion} must be a half-band value between 1.0 and 6.0`,
      );
    }
    rubric[criterion] = band;
  }

  return rubric;
}

export function validateLegacyScore(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 100
  ) {
    throw new ScoreValidationError("Legacy score value must be between 0 and 100");
  }
  return value;
}

export function validateAnswerCoverage(
  expectedAnswerIds: string[],
  receivedAnswerIds: unknown[],
): string[] {
  const expected = new Set(expectedAnswerIds);
  const received = new Set<string>();

  for (const answerId of receivedAnswerIds) {
    if (typeof answerId !== "string") {
      throw new ScoreValidationError("Every score must include an answerId");
    }
    if (received.has(answerId)) {
      throw new ScoreValidationError("Each answer can only be scored once");
    }
    if (!expected.has(answerId)) {
      throw new ScoreValidationError("A score references an answer outside this assignment");
    }
    received.add(answerId);
  }

  if (received.size !== expected.size) {
    throw new ScoreValidationError("Every answer must be scored before submission");
  }

  return [...received];
}

export function calculateRubricOverall(rubric: RubricValues): number {
  return RUBRIC_CRITERIA.reduce((total, criterion) => total + rubric[criterion], 0) /
    RUBRIC_CRITERIA.length;
}

export function readStoredRubric(score: StoredScoreValues): RubricValues | null {
  const values = RUBRIC_CRITERIA.map((criterion) => score[criterion]);
  if (values.some((value) => value == null)) return null;

  return {
    pronunciation: Number(score.pronunciation),
    fluency: Number(score.fluency),
    vocabulary: Number(score.vocabulary),
    grammar: Number(score.grammar),
  };
}

export function averageRubrics(rubrics: RubricValues[]): RubricBreakdown | null {
  if (rubrics.length === 0) return null;

  const averaged = {} as RubricValues;
  for (const criterion of RUBRIC_CRITERIA) {
    averaged[criterion] = roundScore(
      rubrics.reduce((total, rubric) => total + rubric[criterion], 0) /
        rubrics.length,
    );
  }

  return {
    ...averaged,
    overall: roundScore(calculateRubricOverall(averaged)),
  };
}

export function aggregateStoredScores(
  scores: StoredScoreValues[],
  scoringSystem: ScoringSystemValue,
): { score: number | null; rubric: RubricBreakdown | null } {
  const mean = average(scores.map((score) => Number(score.value)));
  const rubric =
    scoringSystem === "RUBRIC_6"
      ? averageRubrics(
          scores.flatMap((score) => {
            const stored = readStoredRubric(score);
            return stored ? [stored] : [];
          }),
        )
      : null;

  return {
    score: mean == null ? null : roundScore(mean),
    rubric,
  };
}
