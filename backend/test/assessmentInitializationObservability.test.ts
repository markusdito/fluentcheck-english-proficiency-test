import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import {
  createAssessmentInitializationObserver,
  type AssessmentInitializationFailureEvent,
} from "../src/service/assessmentInitializationObservability.service.js";

async function startReceiver() {
  let request: { headers: IncomingMessage["headers"]; body: string } | undefined;
  const server = createServer((incoming, response) => {
    const chunks: Buffer[] = [];
    incoming.on("data", (chunk: Buffer) => chunks.push(chunk));
    incoming.on("end", () => {
      request = {
        headers: incoming.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      };
      response.statusCode = 204;
      response.end();
    });
  });
  server.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    getRequest: () => request,
  };
}

async function stopReceiver(server: Server) {
  server.close();
  await once(server, "close");
}

test("publishes a sanitized Prompt-media failure to the Loki HTTP seam", async () => {
  const receiver = await startReceiver();
  const observer = createAssessmentInitializationObserver({
    lokiUrl: receiver.url,
    username: "grafana-instance",
    token: "grafana-token",
    serviceName: "fluentcheck-backend",
    environment: "production",
    runbookUrl: "https://runbooks.example/assessment-initialization",
    requestTimeoutMs: 1_000,
  });
  const event: AssessmentInitializationFailureEvent = {
    eventName: "submission_initialization_failed",
    classification: "PREPARATION",
    internalReason: "PROMPT_MEDIA_SIGNING_FAILED",
    requestId: "request-123",
    failureCount: 2,
    failedQuestionIds: ["question-1"],
    failedCategories: ["PART_1"],
    preparationDurationMs: 42,
    categoryCount: 3,
    failedEntries: [
      {
        entryId: "entry-1",
        category: "PART_1",
        reason: "SIGNING_FAILED",
        questionId: "question-1",
        storageKey: "questions/secret/prompt.webm",
      },
    ],
    studentId: "student-secret",
    idempotencyKey: "idempotency-secret",
    signedUrl: "https://signed.example/secret",
    providerMessage: "provider secret",
  } as AssessmentInitializationFailureEvent & Record<string, unknown>;

  try {
    observer.reportFailure(event);
    await observer.flush();

    const request = receiver.getRequest();
    assert.ok(request);
    assert.equal(request.headers.authorization, "Basic Z3JhZmFuYS1pbnN0YW5jZTpncmFmYW5hLXRva2Vu");
    assert.equal(request.headers["content-type"], "application/json");
    const payload = JSON.parse(request.body) as {
      streams: Array<{
        stream: Record<string, string>;
        values: Array<[string, string]>;
      }>;
    };
    assert.deepEqual(payload.streams[0]?.stream, {
      service: "fluentcheck-backend",
      environment: "production",
      event: "PROMPT_MEDIA_PREPARATION_FAILED",
      source: "submission_initialization_failed",
    });
    const line = JSON.parse(payload.streams[0]?.values[0]?.[1] ?? "null");
    assert.deepEqual(line, {
      event: "PROMPT_MEDIA_PREPARATION_FAILED",
      sourceEvent: "submission_initialization_failed",
      internalReason: "PROMPT_MEDIA_SIGNING_FAILED",
      requestId: "request-123",
      failureCount: 2,
      failedQuestionIds: ["question-1"],
      failedCategories: ["PART_1"],
      failureClass: "PREPARATION",
      preparationDurationMs: 42,
    });
    assert.equal(request.body.includes("student-secret"), false);
    assert.equal(request.body.includes("idempotency-secret"), false);
    assert.equal(request.body.includes("questions/secret"), false);
    assert.equal(request.body.includes("signed.example"), false);
    assert.equal(request.body.includes("provider secret"), false);
    assert.equal(request.body.includes("grafana-token"), false);
  } finally {
    await stopReceiver(receiver.server);
  }
});

test("swallows a failed telemetry destination without rejecting flush", async () => {
  const deliveryFailures: unknown[] = [];
  const observer = createAssessmentInitializationObserver({
    lokiUrl: "http://127.0.0.1:1",
    serviceName: "fluentcheck-backend",
    environment: "test",
    runbookUrl: "https://runbooks.example/assessment-initialization",
    requestTimeoutMs: 10,
    fetchImplementation: async () => {
      throw new Error("telemetry endpoint secret");
    },
    onDeliveryFailure: (error) => deliveryFailures.push(error),
  });

  observer.reportFailure({
    eventName: "submission_initialization_failed",
    classification: "PREPARATION",
    internalReason: "PROMPT_MEDIA_SIGNING_FAILED",
    requestId: "request-456",
    failureCount: 1,
    failedQuestionIds: [],
    failedCategories: ["PART_2"],
    preparationDurationMs: 10,
    categoryCount: 3,
  });
  await observer.flush();

  assert.equal(deliveryFailures.length, 1);
  assert.equal(String(deliveryFailures[0]).includes("telemetry endpoint secret"), true);
});

test("publishes attempt and success events for dashboard denominators", async () => {
  const bodies: string[] = [];
  const observer = createAssessmentInitializationObserver({
    lokiUrl: "http://telemetry.example",
    serviceName: "fluentcheck-backend",
    environment: "test",
    runbookUrl: "https://runbooks.example/assessment-initialization",
    requestTimeoutMs: 1_000,
    fetchImplementation: async (_input, init) => {
      bodies.push(String(init?.body));
      return new Response(null, { status: 204 });
    },
  });

  observer.reportAttempt({ requestId: "request-789" });
  observer.reportSuccess({ requestId: "request-789", preparationDurationMs: 21 });
  await observer.flush();

  assert.deepEqual(
    bodies.map((body) => {
      const payload = JSON.parse(body) as { streams: Array<{ stream: Record<string, string> }> };
      return payload.streams[0]?.stream.event;
    }),
    ["SUBMISSION_INITIALIZATION_ATTEMPTED", "SUBMISSION_INITIALIZATION_SUCCEEDED"],
  );
});
