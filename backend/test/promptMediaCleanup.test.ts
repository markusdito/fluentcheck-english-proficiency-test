import assert from "node:assert/strict";
import { test } from "node:test";
import {
  runCleanupPromptMediaCli,
} from "../src/cli/cleanupPromptMedia.js";
import type {
  PromptMediaCleanupInventory,
  PromptMediaCleanupRunResult,
} from "../src/service/promptMediaCleanup.service.js";

function inventory(): PromptMediaCleanupInventory {
  return {
    generatedAt: "2026-09-01T00:00:00.000Z",
    candidates: [
      {
        sourceQuestionId: "question-1",
        sourceQuestionIds: ["question-1"],
        storageKey: "questions/question-1/prompt.webm",
        bucket: "test-bucket",
        storage: { exists: true, contentLength: 12, contentType: "audio/webm" },
        storageError: null,
        answerReferences: [{ id: "answer-1", submissionId: "submission-1" }],
        manifestReferences: [{ id: "entry-1", submissionId: "submission-1" }],
        eligible: false,
        reasons: ["A non-purged Delivered prompt snapshot references this Prompt media"],
      },
    ],
    totals: {
      candidates: 1,
      eligible: 0,
      blocked: 1,
      present: 1,
      missing: 0,
      storageErrors: 0,
    },
    exitCode: 0,
  };
}

test("cleanup CLI defaults to a read-only machine-readable inventory", async () => {
  const output: string[] = [];
  let runCalled = false;
  const exitCode = await runCleanupPromptMediaCli(["--json"], {
    inventory: async () => inventory(),
    run: async () => {
      runCalled = true;
      throw new Error("destructive run should not be called");
    },
    writeOutput: (value) => output.push(value),
  });

  assert.equal(exitCode, 0);
  assert.equal(runCalled, false);
  const parsed = JSON.parse(output.join("")) as PromptMediaCleanupInventory;
  assert.equal(parsed.candidates[0]?.storageKey, "questions/question-1/prompt.webm");
  assert.equal(parsed.candidates[0]?.manifestReferences[0]?.id, "entry-1");
});

test("cleanup CLI requires explicit authorization fields for destructive modes", async () => {
  const errors: string[] = [];
  const exitCode = await runCleanupPromptMediaCli(["--execute", "--actor-id", "admin-1"], {
    writeError: (value) => errors.push(value),
  });

  assert.equal(exitCode, 1);
  assert.match(errors.join(""), /requires --actor-id, --authorization-id, and --reason/u);
});

test("cleanup CLI forwards an authorized quarantine run", async () => {
  const output: string[] = [];
  let received: unknown;
  const result: PromptMediaCleanupRunResult = {
    runId: "run-1",
    mode: "QUARANTINE",
    status: "COMPLETED",
    inventory: inventory(),
    objects: [
      {
        storageKey: "questions/question-1/prompt.webm",
        status: "SKIPPED_REFERENCED",
        outcome: "REFERENCE_RECHECK_BLOCKED",
      },
    ],
  };
  const exitCode = await runCleanupPromptMediaCli(
    [
      "--execute",
      "--actor-id",
      "admin-1",
      "--authorization-id",
      "change-1",
      "--reason",
      "Approved cleanup",
      "--json",
    ],
    {
      run: async (mode, options) => {
        received = { mode, options };
        return result;
      },
      writeOutput: (value) => output.push(value),
    },
  );

  assert.equal(exitCode, 0);
  assert.deepEqual(received, {
    mode: "QUARANTINE",
    options: {
      actorId: "admin-1",
      authorizationId: "change-1",
      reason: "Approved cleanup",
    },
  });
  assert.equal((JSON.parse(output.join("")) as PromptMediaCleanupRunResult).runId, "run-1");
});
