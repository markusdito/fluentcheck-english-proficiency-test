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
    const manifest = await tx.submissionManifest.create({
      data: { submissionId: submission.id, version: 1 },
    });
    const entries: Array<Prisma.ManifestEntryGetPayload<{}>> = [];

    for (const [index, category] of (["PART_1", "PART_2", "PART_3"] as const).entries()) {
      const question = await tx.question.create({
        data: {
          category,
          order: Math.floor(Math.random() * 1_000_000),
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

async function confirm(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  entryIndex = 0,
) {
  return request("POST", "/uploads/confirm", fixture.student.id, {
    submissionId: fixture.submission.id,
    manifestEntryId: fixture.entries[entryIndex]!.id,
    sizeBytes: 1,
    durationSeconds: 999,
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
    contentLength: 17,
    contentType: "video/webm",
    etag: '"observed-etag"',
    versionId: "version-1",
  });
  const response = await confirm(fixture);
  assert.equal(response.status, 200);

  const answer = await prisma.answer.findUniqueOrThrow({
    where: { manifestEntryId: fixture.entries[0]!.id },
    select: { uploadStatus: true, sizeBytes: true, durationSeconds: true, observedMimeType: true, proofVersion: true, verifiedAt: true },
  });
  assert.equal(answer.uploadStatus, "UPLOADED");
  assert.equal(answer.sizeBytes, 17);
  assert.equal(answer.durationSeconds, null);
  assert.equal(answer.observedMimeType, "video/webm");
  assert.equal(answer.proofVersion, 1);
  assert.ok(answer.verifiedAt);
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
    contentLength: 4,
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
    contentLength: 4,
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
