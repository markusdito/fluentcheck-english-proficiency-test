import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, before, beforeEach, test } from "node:test";
import { once } from "node:events";
import type { Server } from "node:http";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { Prisma, PrismaClient } from "../../src/generated/client.js";
import {
  installFakeR2Head,
  type FakeR2Object,
} from "../fixtures/fakeR2.js";
import {
  SLOTS,
  createFixtureTestSet,
  manifestTestSetData,
} from "../fixtures/testSets.js";

const execFileAsync = promisify(execFile);

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: (() => Promise<void>) | undefined;
let app: Express;
let server: Server;
let baseUrl: string;
let storage: ReturnType<typeof installFakeR2Head>;

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.JWT_SECRET = "answer-upload-integrity-secret";
  process.env.R2_ACCOUNT_ID = "answer-upload-test-account";
  process.env.R2_ACCESS_KEY_ID = "answer-upload-test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "answer-upload-test-secret-key";
  process.env.R2_BUCKET_NAME = "answer-upload-test-bucket";
  process.env.FRONTEND_URL = "https://fluentcheck.example.test";

  await execFileAsync(
    "npx",
    ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
      timeout: 120_000,
    },
  );

  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  const { r2Client } = await import("../../src/config/r2.js");
  storage = installFakeR2Head(r2Client);
  const { createApp } = await import("../../src/server.js");
  app = createApp();
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Answer-upload integration server did not bind");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}, { timeout: 120_000 });

beforeEach(() => {
  storage.clear();
});

after(async () => {
  storage.restore();
  if (server) {
    server.close();
    await once(server, "close");
  }
  if (disconnectDB) await disconnectDB();
  if (container) await container.stop();
}, { timeout: 120_000 });

function uniqueUsername(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

function cookieFor(userId: string) {
  return `jwt=${jwt.sign({ id: userId }, process.env.JWT_SECRET!)}`;
}

async function request(
  method: string,
  path: string,
  userId: string,
  body?: Record<string, unknown>,
) {
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      Cookie: cookieFor(userId),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function createFixture() {
  const email = `${crypto.randomUUID()}@example.test`;
  const student = await prisma.user.create({
    data: {
      username: uniqueUsername("student"),
      email,
      normalizedEmail: email,
      password: "unused",
    },
  });

  const { submission, entries } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const submission = await tx.submission.create({
      data: { studentId: student.id, status: "IN_PROGRESS" },
    });
    const testSet = await createFixtureTestSet(tx);
    const manifest = await tx.submissionManifest.create({
      data: { submissionId: submission.id, ...manifestTestSetData(testSet) },
    });
    const entries: Array<Prisma.ManifestEntryGetPayload<{}>> = [];

    for (const [index, category] of SLOTS.entries()) {
      const question = await tx.question.create({
        data: {
          category,
          testSetId: testSet.id,
          tasks: { create: { promptText: `${category} prompt`, order: 1 } },
        },
        include: { tasks: true },
      });
      const entry = await tx.manifestEntry.create({
        data: {
          manifestId: manifest.id,
          submissionId: submission.id,
          category,
          deliveryPosition: index + 1,
          sourceQuestionId: question.id,
          preparationSeconds: 20,
          recordingSeconds: 60,
          promptMediaStorageKey: `questions/${question.id}/prompt.webm`,
          promptMediaMimeType: "audio/webm",
          promptMediaSizeBytes: 128,
        },
      });
      await tx.manifestTask.create({
        data: {
          manifestEntryId: entry.id,
          sourceQuestionId: question.id,
          sourceTaskId: question.tasks[0]!.id,
          deliveredOrder: 1,
          deliveredText: `${category} prompt`,
        },
      });
      entries.push(entry);
    }

    return { submission, entries };
  });

  return { student, submission, entries };
}

async function presign(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  entryIndex = 0,
  mimeType = "video/webm",
) {
  const response = await request(
    "POST",
    "/uploads/presigned-url",
    fixture.student.id,
    {
      submissionId: fixture.submission.id,
      manifestEntryId: fixture.entries[entryIndex]!.id,
      mimeType,
    },
  );
  const body = await response.json() as {
    data?: { storageKey: string; answerId: string; presignedUrl: string };
    error?: string;
  };
  return { response, body };
}

const FULL_TAKE_BYTES = 8192;

async function confirm(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  entryIndex = 0,
  technicalFailure?: unknown,
) {
  return request("POST", "/uploads/confirm", fixture.student.id, {
    submissionId: fixture.submission.id,
    manifestEntryId: fixture.entries[entryIndex]!.id,
    sizeBytes: 1,
    durationSeconds: 999,
    ...(technicalFailure === undefined ? {} : { technicalFailure }),
  });
}

async function openFlags(submissionId: string) {
  return prisma.submissionFlag.findMany({
    where: { submissionId, resolution: null },
    select: { type: true, source: true, reason: true, answerId: true, manifestEntryId: true },
  });
}

test("answer presigning validates video type and binds the Answer to the student's manifest", async () => {
  const fixture = await createFixture();
  const other = await createFixture();

  const invalid = await presign(fixture, 0, "application/json");
  assert.equal(invalid.response.status, 400);
  assert.equal(
    await prisma.answer.count({ where: { submissionId: fixture.submission.id } }),
    0,
  );

  const foreign = await request("POST", "/uploads/presigned-url", fixture.student.id, {
    submissionId: fixture.submission.id,
    manifestEntryId: other.entries[0]!.id,
    mimeType: "video/webm",
  });
  assert.equal(foreign.status, 404);
  assert.equal(
    await prisma.answer.count({ where: { submissionId: fixture.submission.id } }),
    0,
  );

  const valid = await presign(fixture);
  assert.equal(valid.response.status, 201);
  assert.match(valid.body.data!.storageKey, /^submissions\/[0-9a-f-]{36}\/answers\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.webm$/u);
  assert.match(valid.body.data!.presignedUrl, /^https:\/\//u);
  assert.equal(
    (await prisma.answer.findUniqueOrThrow({ where: { manifestEntryId: fixture.entries[0]!.id } })).uploadStatus,
    "PENDING",
  );
});

test("confirmation rejects unproven objects and records server-observed metadata", async () => {
  const cases: Array<{ name: string; object?: FakeR2Object }> = [
    { name: "missing" },
    { name: "empty", object: { contentLength: 0, contentType: "video/webm" } },
    { name: "oversized", object: { contentLength: 100 * 1024 * 1024 + 1, contentType: "video/webm" } },
    { name: "wrong MIME", object: { contentLength: 10, contentType: "video/mp4" } },
  ];

  for (const testCase of cases) {
    const fixture = await createFixture();
    const signed = await presign(fixture);
    if (testCase.object) storage.put(signed.body.data!.storageKey, testCase.object);

    const response = await confirm(fixture);
    assert.equal(response.status, 409, testCase.name);
    const answer = await prisma.answer.findUniqueOrThrow({
      where: { manifestEntryId: fixture.entries[0]!.id },
      select: { uploadStatus: true, sizeBytes: true, verifiedAt: true, observedMimeType: true, proofVersion: true },
    });
    assert.deepEqual(answer, {
      uploadStatus: "PENDING",
      sizeBytes: null,
      verifiedAt: null,
      observedMimeType: null,
      proofVersion: null,
    }, testCase.name);
  }

  const fixture = await createFixture();
  const signed = await presign(fixture);
  storage.put(signed.body.data!.storageKey, {
    contentLength: FULL_TAKE_BYTES,
    contentType: "video/webm",
    etag: '"observed-etag"',
    versionId: "version-1",
  });
  const response = await confirm(fixture);
  assert.equal(response.status, 200);
  const body = await response.json() as { technicalFailure: boolean; technicalFailureReason: string | null };
  assert.equal(body.technicalFailure, false);
  assert.equal(body.technicalFailureReason, null);
  assert.deepEqual(await openFlags(fixture.submission.id), []);

  const answer = await prisma.answer.findUniqueOrThrow({
    where: { manifestEntryId: fixture.entries[0]!.id },
    select: { uploadStatus: true, sizeBytes: true, durationSeconds: true, observedMimeType: true, proofVersion: true, verifiedAt: true },
  });
  assert.equal(answer.uploadStatus, "UPLOADED");
  assert.equal(answer.sizeBytes, FULL_TAKE_BYTES);
  assert.equal(answer.durationSeconds, null);
  assert.equal(answer.observedMimeType, "video/webm");
  assert.equal(answer.proofVersion, 1);
  assert.ok(answer.verifiedAt);
});

test("concurrent confirmations converge on one verified Answer", async () => {
  const fixture = await createFixture();
  const signed = await presign(fixture);
  storage.put(signed.body.data!.storageKey, {
    contentLength: 17,
    contentType: "video/webm",
  });

  const responses = await Promise.all([confirm(fixture), confirm(fixture)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200]);

  const answer = await prisma.answer.findUniqueOrThrow({
    where: { manifestEntryId: fixture.entries[0]!.id },
    select: { uploadStatus: true, proofVersion: true, verifiedAt: true },
  });
  assert.equal(answer.uploadStatus, "UPLOADED");
  assert.equal(answer.proofVersion, 1);
  assert.ok(answer.verifiedAt);
  // The 17-byte take is auto-flagged exactly once despite two confirmations.
  assert.equal((await openFlags(fixture.submission.id)).length, 1);
});

test("pending retries receive a fresh storage key and verified Answers cannot be re-armed", async () => {
  const fixture = await createFixture();
  const first = await presign(fixture);
  const second = await presign(fixture);

  assert.notEqual(first.body.data!.storageKey, second.body.data!.storageKey);
  assert.equal(
    (await prisma.answer.findUniqueOrThrow({ where: { manifestEntryId: fixture.entries[0]!.id } })).storageKey,
    second.body.data!.storageKey,
  );

  storage.put(second.body.data!.storageKey, {
    contentLength: FULL_TAKE_BYTES,
    contentType: "video/webm",
  });
  assert.equal((await confirm(fixture)).status, 200);

  const rearm = await presign(fixture);
  assert.equal(rearm.response.status, 400);
  assert.equal(rearm.body.error, "Answer already uploaded");
});

test("completion rejects a partially proven manifest instead of accepting one uploaded Answer", async () => {
  const fixture = await createFixture();
  const signed = await presign(fixture);
  storage.put(signed.body.data!.storageKey, {
    contentLength: FULL_TAKE_BYTES,
    contentType: "video/webm",
  });
  assert.equal((await confirm(fixture)).status, 200);

  const completion = await request(
    "POST",
    `/submissions/${fixture.submission.id}/complete`,
    fixture.student.id,
  );
  assert.equal(completion.status, 400);
  assert.equal(
    (await prisma.submission.findUniqueOrThrow({ where: { id: fixture.submission.id } })).status,
    "IN_PROGRESS",
  );
});

test("a client-reported failure saves the partial Answer with one flag bound to it", async () => {
  const fixture = await createFixture();
  const signed = await presign(fixture, 2);
  storage.put(signed.body.data!.storageKey, { contentLength: 3000, contentType: "video/webm" });

  const failure = { type: "CAMERA_DROP", reason: "  Camera track ended while recording  " };
  const response = await confirm(fixture, 2, failure);
  assert.equal(response.status, 200);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.technicalFailure, true);
  assert.equal(body.technicalFailureReason, "Camera track ended while recording");

  const answer = await prisma.answer.findUniqueOrThrow({
    where: { manifestEntryId: fixture.entries[2]!.id },
    select: { id: true, uploadStatus: true, sizeBytes: true, technicalFailure: true, technicalFailureReason: true },
  });
  assert.deepEqual(
    { ...answer, id: undefined },
    { id: undefined, uploadStatus: "UPLOADED", sizeBytes: 3000, technicalFailure: true, technicalFailureReason: "Camera track ended while recording" },
  );
  assert.deepEqual(await openFlags(fixture.submission.id), [{
    type: "CAMERA_DROP",
    source: "STUDENT_DEVICE",
    reason: "Camera track ended while recording",
    answerId: answer.id,
    manifestEntryId: fixture.entries[2]!.id,
  }]);

  // A repeated confirmation is a no-op that reports the stored failure.
  const retry = await confirm(fixture, 2, failure);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json() as { technicalFailure: boolean }).technicalFailure, true);
  assert.equal((await openFlags(fixture.submission.id)).length, 1);
});

test("an object under 8 KB is flagged by the server even without a client failure", async () => {
  const fixture = await createFixture();
  const signed = await presign(fixture);
  storage.put(signed.body.data!.storageKey, { contentLength: FULL_TAKE_BYTES - 1, contentType: "video/webm" });

  const response = await confirm(fixture);
  assert.equal(response.status, 200);
  const reason = "Recording is shorter than 8 KB; it may be short or silent";
  assert.equal((await response.json() as { technicalFailureReason: string }).technicalFailureReason, reason);
  const flags = await openFlags(fixture.submission.id);
  assert.equal(flags.length, 1);
  assert.equal(flags[0]!.type, "TECHNICAL_FAILURE");
  assert.equal(flags[0]!.reason, reason);
  assert.ok(flags[0]!.answerId);
});

test("a zero-byte take is rejected unless the client reports a failure", async () => {
  const fixture = await createFixture();
  const signed = await presign(fixture);
  storage.put(signed.body.data!.storageKey, { contentLength: 0, contentType: "video/webm" });

  assert.equal((await confirm(fixture)).status, 409);
  assert.deepEqual(await openFlags(fixture.submission.id), []);

  const accepted = await confirm(fixture, 0, { type: "TECHNICAL_FAILURE", reason: "MediaRecorder error" });
  assert.equal(accepted.status, 200);
  const answer = await prisma.answer.findUniqueOrThrow({
    where: { manifestEntryId: fixture.entries[0]!.id },
    select: { uploadStatus: true, sizeBytes: true, technicalFailure: true },
  });
  assert.deepEqual(answer, { uploadStatus: "UPLOADED", sizeBytes: 0, technicalFailure: true });
  assert.equal((await openFlags(fixture.submission.id)).length, 1);
});

test("a malformed technicalFailure body is rejected before storage is inspected", async () => {
  const fixture = await createFixture();
  const signed = await presign(fixture);
  storage.put(signed.body.data!.storageKey, { contentLength: FULL_TAKE_BYTES, contentType: "video/webm" });

  for (const bad of [
    "CAMERA_DROP",
    [],
    { type: "INTEGRITY_CONCERN", reason: "x" },
    { type: "CAMERA_DROP" },
    { type: "CAMERA_DROP", reason: "   " },
    { type: "CAMERA_DROP", reason: "x".repeat(1001) },
  ]) {
    const response = await confirm(fixture, 0, bad);
    assert.equal(response.status, 400, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(storage.requests.length, 0);
  assert.equal(
    (await prisma.answer.findUniqueOrThrow({ where: { manifestEntryId: fixture.entries[0]!.id } })).uploadStatus,
    "PENDING",
  );
});

test("a flagged partial Answer counts toward completion and sends the Submission to flag review", async () => {
  const fixture = await createFixture();
  for (const index of fixture.entries.keys()) {
    const signed = await presign(fixture, index);
    // Slot 4 lost the connection mid-take; nothing was captured.
    storage.put(signed.body.data!.storageKey, {
      contentLength: index === 3 ? 0 : FULL_TAKE_BYTES,
      contentType: "video/webm",
    });
    const failure = index === 3 ? { type: "TECHNICAL_FAILURE", reason: "Connection lost while recording" } : undefined;
    assert.equal((await confirm(fixture, index, failure)).status, 200);
  }

  const completion = await request("POST", `/submissions/${fixture.submission.id}/complete`, fixture.student.id);
  assert.equal(completion.status, 200);
  assert.equal(
    (await prisma.submission.findUniqueOrThrow({ where: { id: fixture.submission.id } })).status,
    "FLAG_REVIEW",
  );

  const detail = await request("GET", `/submissions/${fixture.submission.id}`, fixture.student.id);
  assert.equal(detail.status, 200);
  const text = await detail.text();
  assert.match(text, /"technicalFailure":true,"technicalFailureReason":"Connection lost while recording"/u);
});

test("direct prompt media access remains outside the student's active manifest boundary", async () => {
  const fixture = await createFixture();
  const response = await request(
    "GET",
    `/questions/${fixture.entries[0]!.sourceQuestionId}/audio-url`,
    fixture.student.id,
  );

  assert.equal(response.status, 403);
  assert.equal((await response.text()).includes("storageKey"), false);
});
