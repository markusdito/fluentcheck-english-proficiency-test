import assert from "node:assert/strict";
import test from "node:test";
import { runQuestionPositionPreflightCli } from "../src/cli/questionPositionPreflight.js";
import type {
  QuestionPositionPreflightResult,
} from "../src/cli/questionPositionPreflight.js";

const cleanResult: QuestionPositionPreflightResult = {
  generatedAt: "2026-08-31T00:00:00.000Z",
  activeQuestionConflicts: [],
  activeTaskConflicts: [],
  exitCode: 0,
};

test("question-position preflight CLI emits JSON and returns its report status", async () => {
  let output = "";
  const exitCode = await runQuestionPositionPreflightCli(["--json"], {
    inspect: async () => cleanResult,
    writeOutput: (value) => {
      output += value;
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(JSON.parse(output), cleanResult);
});

test("question-position preflight CLI prints active conflict identities", async () => {
  let output = "";
  const conflictResult: QuestionPositionPreflightResult = {
    ...cleanResult,
    activeQuestionConflicts: [
      {
        category: "PART_1",
        order: 2,
        questionIds: ["question-a", "question-b"],
      },
    ],
    activeTaskConflicts: [
      {
        questionId: "question-a",
        order: 1,
        taskIds: ["task-a", "task-b"],
      },
    ],
    exitCode: 1,
  };

  const exitCode = await runQuestionPositionPreflightCli([], {
    inspect: async () => conflictResult,
    writeOutput: (value) => {
      output += value;
    },
  });

  assert.equal(exitCode, 1);
  assert.match(output, /Active Question position conflicts:/);
  assert.match(output, /PART_1\/2: question-a, question-b/);
  assert.match(output, /Active Task position conflicts:/);
  assert.match(output, /question-a\/1: task-a, task-b/);
  assert.match(output, /operator remediation required/);
});

test("question-position preflight CLI rejects unknown arguments", async () => {
  let error = "";
  const exitCode = await runQuestionPositionPreflightCli(["--repair"], {
    writeError: (value) => {
      error += value;
    },
  });

  assert.equal(exitCode, 1);
  assert.match(error, /Unknown argument: --repair/);
});
