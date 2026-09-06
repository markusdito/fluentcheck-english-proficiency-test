import assert from "node:assert/strict";
import { test } from "node:test";
import { runSyntheticInitializationFailureCli } from "../src/cli/emitSyntheticInitializationFailure.js";
import type {
  AssessmentInitializationFailureEvent,
  AssessmentInitializationObservabilityConfig,
} from "../src/service/assessmentInitializationObservability.service.js";

function stubConfig(): AssessmentInitializationObservabilityConfig {
  return {
    lokiUrl: "http://telemetry.example",
    username: "stack-user",
    token: "stack-token",
    serviceName: "fluentcheck-backend",
    environment: "staging",
    runbookUrl: "https://runbooks.example/assessment-initialization",
    requestTimeoutMs: 1_000,
  };
}

interface RecordedDelivery {
  config: AssessmentInitializationObservabilityConfig;
  event: AssessmentInitializationFailureEvent;
}

test("delivers a sanitized synthetic Prompt media preparation failure", async () => {
  const output: string[] = [];
  const deliveries: RecordedDelivery[] = [];
  let flushCalls = 0;
  const exitCode = await runSyntheticInitializationFailureCli({
    loadConfig: stubConfig,
    createObserver: (config) => ({
      reportFailure: (event) => deliveries.push({ config, event }),
      reportAttempt: () => undefined,
      reportSuccess: () => undefined,
      async flush() {
        flushCalls += 1;
      },
    }),
    requestId: "synthetic-fixed-request",
    writeOutput: (value) => output.push(value),
    writeError: (value) => output.push(`ERROR: ${value}`),
  });

  assert.equal(exitCode, 0);
  assert.equal(deliveries.length, 1);
  assert.equal(flushCalls, 1);
  const { config, event } = deliveries[0]!;
  assert.equal(config.lokiUrl, "http://telemetry.example");
  assert.equal(event.eventName, "submission_initialization_failed");
  assert.equal(event.classification, "PREPARATION");
  assert.equal(event.internalReason, "PROMPT_MEDIA_SIGNING_FAILED");
  assert.equal(event.failureCount, 1);
  assert.deepEqual(event.failedCategories, ["PART_1"]);
  assert.ok(output.join("\n").includes("synthetic-fixed-request"));

  const serialized = JSON.stringify(event);
  for (const excluded of ["studentId", "idempotencyKey", "storageKey", "signedUrl", "token"]) {
    assert.equal(serialized.includes(excluded), false, `synthetic event must not carry ${excluded}`);
  }
});

test("delivers one event per requested count with distinct request ids", async () => {
  const deliveries: RecordedDelivery[] = [];
  const exitCode = await runSyntheticInitializationFailureCli({
    loadConfig: stubConfig,
    createObserver: () => ({
      reportFailure: (event) => deliveries.push({ config: stubConfig(), event }),
      reportAttempt: () => undefined,
      reportSuccess: () => undefined,
      flush: async () => undefined,
    }),
    requestId: "synthetic-shared-request",
    count: 3,
    writeOutput: () => undefined,
    writeError: () => undefined,
  });

  assert.equal(exitCode, 0);
  assert.equal(deliveries.length, 3);
  const requestIds = deliveries.map((delivery) => delivery.event.requestId);
  assert.equal(new Set(requestIds).size, 3, "burst events must not share a request id");
  for (const requestId of requestIds) {
    assert.match(requestId, /^synthetic-/u);
  }
});

test("fails without a configured telemetry destination", async () => {
  const errors: string[] = [];
  const exitCode = await runSyntheticInitializationFailureCli({
    loadConfig: () => ({ ...stubConfig(), lokiUrl: undefined }),
    writeOutput: () => undefined,
    writeError: (value) => errors.push(value),
  });

  assert.equal(exitCode, 1);
  assert.equal(errors.length, 1);
});

test("reports delivery failure without throwing", async () => {
  const errors: string[] = [];
  const exitCode = await runSyntheticInitializationFailureCli({
    loadConfig: stubConfig,
    createObserver: () => ({
      reportFailure: () => undefined,
      reportAttempt: () => undefined,
      reportSuccess: () => undefined,
      async flush() {
        throw new Error("delivery failed");
      },
    }),
    writeOutput: () => undefined,
    writeError: (value) => errors.push(value),
  });

  assert.equal(exitCode, 1);
  assert.equal(errors.length, 1);
});
