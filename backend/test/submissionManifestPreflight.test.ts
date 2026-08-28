import assert from "node:assert/strict";
import { test } from "node:test";
import { runSubmissionManifestPreflightCli } from "../src/cli/submissionManifestPreflight.js";
import type { SubmissionManifestPreflightResult } from "../src/service/submissionManifestPreflight.service.js";

const conflictReport: SubmissionManifestPreflightResult = {
  generatedAt: "2026-08-28T00:00:00.000Z",
  legacy: {
    submissionCount: 2,
    answerCount: 1,
    lifecycle: [
      { status: "IN_PROGRESS", submissionCount: 2, answerCount: 1 },
    ],
  },
  duplicateActiveLegacySubmissions: [
    { submissionIds: ["submission-1", "submission-2"] },
  ],
  brokenReferences: {
    submissionsWithoutStudents: 0,
    answersWithoutSubmissions: 0,
    legacyAnswersWithoutQuestions: 0,
    manifestEntriesWithoutManifests: 0,
    manifestEntriesWithoutQuestions: 0,
    manifestTasksWithoutEntries: 0,
    manifestTasksWithoutSourceTasks: 0,
    manifestAnswersWithoutEntries: 0,
  },
  laterEnforcementViolations: {
    activeLegacySubmissions: 2,
    answersWithNoIdentity: 0,
    answersWithCompetingIdentities: 0,
    manifestAnswersWithSubmissionMismatch: 0,
    invalidVersion1Manifests: 0,
  },
  exitCode: 1,
};

test("the Submission-manifest preflight CLI prints JSON and returns its report exit code", async () => {
  const output: string[] = [];
  const errors: string[] = [];
  const exitCode = await runSubmissionManifestPreflightCli(["--json"], {
    inspect: async () => conflictReport,
    writeOutput: (value) => output.push(value),
    writeError: (value) => errors.push(value),
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(errors, []);
  assert.deepEqual(JSON.parse(output.join("")), conflictReport);
});
