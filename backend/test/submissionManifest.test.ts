import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertLegacyAnswerQuestion,
  assertLegacySubmissionEvidence,
  classifySubmissionEvidence,
} from "../src/service/submissionManifest.service.js";

test("Submission evidence classification keeps an absent manifest explicitly Legacy", () => {
  assert.deepEqual(classifySubmissionEvidence(null), { kind: "LEGACY" });
  assert.deepEqual(
    classifySubmissionEvidence({ id: "manifest-1", version: 1 }),
    {
      kind: "MANIFEST",
      manifest: { id: "manifest-1", version: 1 },
    },
  );
});

test("Legacy readers fail closed instead of substituting a current Question for manifest evidence", () => {
  assert.doesNotThrow(() => assertLegacySubmissionEvidence(null));
  assert.throws(
    () => assertLegacySubmissionEvidence({ id: "manifest-1", version: 1 }),
    /Legacy reader cannot interpret Manifest-backed Submission evidence/,
  );

  const legacyAnswer: { questionId: string | null; question: object | null } = {
    questionId: "question-1",
    question: { category: "PART_1" },
  };
  assert.doesNotThrow(() => assertLegacyAnswerQuestion(legacyAnswer));

  assert.throws(
    () => assertLegacyAnswerQuestion({ questionId: null, question: null }),
    /Legacy reader cannot interpret Manifest-backed Answer evidence/,
  );
});
