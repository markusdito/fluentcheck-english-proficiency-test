import assert from "node:assert/strict";
import { test } from "node:test";
import { runExaminerAssignmentPreflightCli } from "../src/cli/examinerAssignmentPreflight.js";
import type { ExaminerAssignmentPreflightResult } from "../src/service/examinerAssignmentPreflight.service.js";

const conflictReport: ExaminerAssignmentPreflightResult = {
  generatedAt: "2026-08-29T00:00:00.000Z",
  assignmentGroups: [
    {
      submissionId: "submission-1",
      submissionStatus: "SCORING",
      assignmentCount: 1,
      unpopulatedSlots: 1,
      invalidSlots: 0,
      duplicateSlots: 0,
      duplicateExaminers: 0,
      lifecycleInconsistent: 0,
    },
  ],
  conflicts: {
    oneAssignmentSubmissions: 1,
    excessAssignmentSubmissions: 0,
    unpopulatedSlotAssignments: 1,
    invalidSlotAssignments: 0,
    duplicateSlotSubmissions: 0,
    duplicateExaminerSubmissions: 0,
    lifecycleInconsistentSubmissions: 0,
  },
  exitCode: 1,
};

test("the Examiner-assignment preflight CLI prints JSON and returns its report exit code", async () => {
  const output: string[] = [];
  const errors: string[] = [];
  const exitCode = await runExaminerAssignmentPreflightCli(["--json"], {
    inspect: async () => conflictReport,
    writeOutput: (value) => output.push(value),
    writeError: (value) => errors.push(value),
  });

  assert.equal(exitCode, 1);
  assert.deepEqual(errors, []);
  assert.deepEqual(JSON.parse(output.join("")), conflictReport);
});

test("the Examiner-assignment preflight CLI rejects unknown arguments", async () => {
  const errors: string[] = [];
  const exitCode = await runExaminerAssignmentPreflightCli(["--yaml"], {
    inspect: async () => conflictReport,
    writeOutput: () => {},
    writeError: (value) => errors.push(value),
  });

  assert.equal(exitCode, 1);
  assert.match(errors.join(""), /Unknown argument/);
});
