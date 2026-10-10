import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { once } from "node:events";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Prisma, PrismaClient } from "../../src/generated/client.js";
import { SLOTS, createFixtureTestSet, deliverableContent, manifestTestSetData } from "../fixtures/testSets.js";

const execFileAsync = promisify(execFile);
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: (() => Promise<void>) | undefined;
let abandonStaleSubmissions: (graceSeconds: number, now?: Date) => Promise<number>;
let CONSENT_TEXT_VERSION: string;
let server: Server;
let baseUrl: string;

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.R2_BUCKET_NAME = "heartbeat-test-bucket";
  process.env.R2_ACCOUNT_ID = "heartbeat-test-account";
  process.env.R2_ACCESS_KEY_ID = "heartbeat-test-key";
  process.env.R2_SECRET_ACCESS_KEY = "heartbeat-test-secret";
  process.env.JWT_SECRET = "heartbeat-test-secret";
  await execFileAsync("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    timeout: 120_000,
  });
  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  ({ abandonStaleSubmissions } = await import("../../src/service/submission.service.js"));
  ({ CONSENT_TEXT_VERSION } = await import("../../src/service/manifestSubmissionInitialization.service.js"));
  const { createApp } = await import("../../src/server.js");
  server = createApp().listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Heartbeat test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, { timeout: 120_000 });

after(async () => {
  if (server) {
    server.close();
    await once(server, "close");
  }
  if (disconnectDB) await disconnectDB();
  if (container) await container.stop();
}, { timeout: 120_000 });

async function student() {
  const email = `${crypto.randomUUID()}@example.test`;
  return prisma.user.create({
    data: {
      username: `student_${crypto.randomUUID().replaceAll("-", "")}`,
      email,
      normalizedEmail: email,
      password: "unused",
    },
  });
}

/** A Submission with its complete version 2 manifest (required at commit). */
async function submission(studentId: string, data: Prisma.SubmissionUncheckedCreateInput | object = {}) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const created = await tx.submission.create({ data: { studentId, ...data } });
    const testSet = await createFixtureTestSet(tx);
    const manifest = await tx.submissionManifest.create({
      data: { submissionId: created.id, ...manifestTestSetData(testSet) },
    });
    for (const [index, category] of SLOTS.entries()) {
      const question = await tx.question.create({ data: { category, testSetId: testSet.id } });
      await tx.manifestEntry.create({
        data: {
          manifestId: manifest.id,
          submissionId: created.id,
          category,
          deliveryPosition: index + 1,
          sourceQuestionId: question.id,
          promptMediaStorageKey: `questions/${question.id}/prompt.webm`,
          promptMediaMimeType: "audio/webm",
          promptMediaSizeBytes: 10,
        },
      });
    }
    return created;
  });
}

function post(path: string, userId: string, init: { headers?: Record<string, string>; body?: string } = {}) {
  return fetch(`${baseUrl}/api${path}`, {
    method: "POST",
    headers: { Cookie: `jwt=${jwt.sign({ id: userId }, process.env.JWT_SECRET!)}`, ...init.headers },
    body: init.body,
  });
}

const status = async (id: string) => (await prisma.submission.findUniqueOrThrow({ where: { id } })).status;

test("heartbeat records lastHeartbeatAt for the owner only, and reports a non-active Submission", async () => {
  const owner = await student();
  const other = await student();
  const created = await submission(owner.id);

  const ok = await post(`/submissions/${created.id}/heartbeat`, owner.id);
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.status, "success");
  assert.equal(body.data.submissionId, created.id);
  assert.equal(body.data.status, "IN_PROGRESS");
  const stored = await prisma.submission.findUniqueOrThrow({ where: { id: created.id } });
  assert.ok(stored.lastHeartbeatAt);
  assert.equal(stored.lastHeartbeatAt.toISOString(), body.data.lastHeartbeatAt);

  assert.equal((await post(`/submissions/${created.id}/heartbeat`, other.id)).status, 404);
  assert.equal((await post(`/submissions/${crypto.randomUUID()}/heartbeat`, owner.id)).status, 404);
  assert.equal((await post(`/submissions/not-a-uuid/heartbeat`, owner.id)).status, 400);

  // navigator.sendBeacon: empty text/plain body.
  const beacon = await post(`/submissions/${created.id}/abandon`, owner.id, {
    headers: { "Content-Type": "text/plain;charset=UTF-8" },
    body: "",
  });
  assert.equal(beacon.status, 200);
  assert.equal(await status(created.id), "ABANDONED");

  const closed = await post(`/submissions/${created.id}/heartbeat`, owner.id);
  assert.equal(closed.status, 409);
  assert.deepEqual(await closed.json(), {
    error: "Submission is not in progress",
    code: "SUBMISSION_NOT_IN_PROGRESS",
    retryable: false,
    submissionStatus: "ABANDONED",
  });
});

test("the sweep abandons only IN_PROGRESS Submissions whose heartbeat stopped beyond the grace period", async () => {
  const now = new Date();
  const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);
  const create = async (data: Record<string, unknown>) =>
    submission((await student()).id, data);

  const staleHeartbeat = await create({ createdAt: ago(3600), lastHeartbeatAt: ago(121) });
  const neverBeat = await create({ createdAt: ago(121) });
  const fresh = await create({ createdAt: ago(3600), lastHeartbeatAt: ago(30) });
  const freshNoBeat = await create({ createdAt: ago(30) });
  const completed = await create({ status: "AWAITING_PAYMENT", createdAt: ago(3600), lastHeartbeatAt: ago(3600) });
  const quarantined = await create({ createdAt: ago(3600) });
  await prisma.submission.update({ where: { id: quarantined.id }, data: { retentionStatus: "QUARANTINED" } });

  assert.equal(await abandonStaleSubmissions(120, now), 2);
  assert.equal(await status(staleHeartbeat.id), "ABANDONED");
  assert.equal(await status(neverBeat.id), "ABANDONED");
  assert.equal(await status(fresh.id), "IN_PROGRESS");
  assert.equal(await status(freshNoBeat.id), "IN_PROGRESS");
  assert.equal(await status(completed.id), "AWAITING_PAYMENT");
  assert.equal(await status(quarantined.id), "IN_PROGRESS");
  assert.equal(await abandonStaleSubmissions(120, now), 0, "idempotent");
});

test("after the sweep the old start intent is closed and a new one starts a new Submission", async () => {
  const testSet = await createFixtureTestSet(prisma, "HB");
  for (const category of SLOTS) {
    await prisma.question.create({
      data: {
        category,
        testSetId: testSet.id,
        preparationSeconds: 20,
        recordingSeconds: 60,
        audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
        audioMimeType: "audio/webm",
        audioSizeBytes: 128,
        audioUploadStatus: "UPLOADED",
        ...deliverableContent(category),
        tasks: { create: [{ promptText: `${category} task`, order: 1 }] },
      },
    });
  }
  const owner = await student();
  const start = (key: string) =>
    post("/submissions", owner.id, {
      headers: { "Idempotency-Key": key, "Content-Type": "application/json" },
      body: JSON.stringify({ consentVersion: CONSENT_TEXT_VERSION }),
    });

  const first = await start("heartbeat-key");
  assert.equal(first.status, 201);
  const firstId = (await first.json()).data.submissionId;

  assert.ok((await abandonStaleSubmissions(120, new Date(Date.now() + 121_000))) >= 1);
  assert.equal(await status(firstId), "ABANDONED");

  const replay = await start("heartbeat-key");
  assert.equal(replay.status, 409);
  const replayBody = await replay.json();
  assert.equal(replayBody.code, "ASSESSMENT_START_INTENT_CLOSED");
  assert.equal(replayBody.submissionStatus, "ABANDONED");

  const next = await start("heartbeat-key-2");
  assert.equal(next.status, 201);
  assert.notEqual((await next.json()).data.submissionId, firstId);
});
