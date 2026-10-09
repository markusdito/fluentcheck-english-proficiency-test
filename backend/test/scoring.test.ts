import assert from "node:assert/strict";
import test from "node:test";
import {
  ScoreValidationError,
  aggregateExaminerScores,
  aggregateStoredScores,
  calculateRubricOverall,
  isValidRubricBand,
  validateAnswerCoverage,
  validateOverallBand,
  validateRubricValues,
} from "../src/utils/scoring.js";

test("submission result is the mean of the two examiners' entered bands", () => {
  const result = aggregateExaminerScores(
    [
      // overall bands are entered, not derived from the criteria
      { value: 4.5, pronunciation: 4, fluency: 4.5, vocabulary: 5, grammar: 3.5 },
      { value: 5, pronunciation: 4.5, fluency: 5, vocabulary: 4.5, grammar: 4 },
    ],
    "RUBRIC_6",
  );

  assert.deepEqual(result, {
    score: 4.75,
    rubric: {
      pronunciation: 4.25,
      fluency: 4.75,
      vocabulary: 4.75,
      grammar: 3.75,
      overall: 4.75,
    },
  });
});

test("requires a half-band overall band", () => {
  assert.equal(validateOverallBand(5.5), 5.5);
  for (const band of [undefined, 0.5, 4.25, 6.5, "5"]) {
    assert.throws(() => validateOverallBand(band), ScoreValidationError);
  }
});

test("accepts every half band from 1.0 through 6.0", () => {
  for (let band = 1; band <= 6; band += 0.5) {
    assert.equal(isValidRubricBand(band), true);
  }
});

test("rejects out-of-range and non-half rubric values", () => {
  for (const band of [0, 0.5, 1.25, 5.75, 6.5, Number.NaN, "4.5"]) {
    assert.equal(isValidRubricBand(band), false);
  }
});

test("requires all four rubric criteria", () => {
  assert.throws(
    () => validateRubricValues({ pronunciation: 4, fluency: 4.5 }),
    ScoreValidationError,
  );
});

test("requires every assignment answer exactly once", () => {
  assert.deepEqual(
    validateAnswerCoverage(["answer-1", "answer-2"], ["answer-1", "answer-2"]),
    ["answer-1", "answer-2"],
  );
  assert.throws(
    () => validateAnswerCoverage(["answer-1", "answer-2"], ["answer-1"]),
    /Every answer must be scored/,
  );
  assert.throws(
    () => validateAnswerCoverage(["answer-1"], ["answer-1", "answer-1"]),
    /only be scored once/,
  );
  assert.throws(
    () => validateAnswerCoverage(["answer-1"], ["different-answer"]),
    /outside this assignment/,
  );
});

test("calculates an examiner question average without early rounding", () => {
  assert.equal(
    calculateRubricOverall({
      pronunciation: 4,
      fluency: 4.5,
      vocabulary: 5,
      grammar: 3.5,
    }),
    4.25,
  );
});

test("averages examiner rubric values and composite scores", () => {
  const aggregate = aggregateStoredScores(
    [
      {
        value: 4.25,
        pronunciation: 4,
        fluency: 4.5,
        vocabulary: 5,
        grammar: 3.5,
      },
      {
        value: 4.5,
        pronunciation: 4.5,
        fluency: 5,
        vocabulary: 4.5,
        grammar: 4,
      },
    ],
    "RUBRIC_6",
  );

  assert.deepEqual(aggregate, {
    score: 4.38,
    rubric: {
      pronunciation: 4.25,
      fluency: 4.75,
      vocabulary: 4.75,
      grammar: 3.75,
      overall: 4.38,
    },
  });
});
