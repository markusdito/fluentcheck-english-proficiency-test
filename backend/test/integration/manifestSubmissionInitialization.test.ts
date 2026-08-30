import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { once } from "node:events";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import type { Express } from "express";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

const execFileAsync = promisify(execFile);
let container: StartedPostgreSqlContainer;
let prisma: any;
let disconnectDB: (() => Promise<void>) | undefined;
let initializeManifestSubmission: typeof import("../../src/service/manifestSubmissionInitialization.service.js").initializeManifestSubmission;
let AssessmentUnavailableError: typeof import("../../src/service/manifestSubmissionInitialization.service.js").AssessmentUnavailableError;
let IdempotencyKeyConflictError: typeof import("../../src/service/manifestSubmissionInitialization.service.js").IdempotencyKeyConflictError;
let app: Express;
let server: Server;
let baseUrl: string;

function uniqueUsername(prefix: string) {
  return `${prefix.replace(/[^a-z0-9_]/giu, "_")}_${crypto.randomUUID().replaceAll("-", "")}`;
}

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.R2_BUCKET_NAME = "initialization-test-bucket";
  process.env.R2_ACCOUNT_ID = "initialization-test-account";
  process.env.R2_ACCESS_KEY_ID = "initialization-test-key";
  process.env.R2_SECRET_ACCESS_KEY = "initialization-test-secret";
  process.env.JWT_SECRET = "manifest-initialization-secret";
  await execFileAsync("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    timeout: 120_000,
  });
  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  ({ initializeManifestSubmission, AssessmentUnavailableError, IdempotencyKeyConflictError } = await import("../../src/service/manifestSubmissionInitialization.service.js"));
  const { createApp } = await import("../../src/server.js");
  app = createApp();
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Initialization test server did not bind");
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

async function createStudent() {
  const email = `${crypto.randomUUID()}@example.test`;
  return prisma.user.create({
    data: {
      username: uniqueUsername("student"),
      email,
      normalizedEmail: email,
      password: "unused",
    },
  });
}

test("initialization selects one eligible question per category and persists a complete manifest", async () => {
  const student = await createStudent();
  for (const category of ["PART_1", "PART_2", "PART_3"] as const) {
    const question = await prisma.question.create({
      data: {
        category,
        order: Math.floor(Math.random() * 1000000),
        preparationSeconds: 20,
        recordingSeconds: 60,
        audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
        audioMimeType: "audio/webm",
        audioSizeBytes: 128,
        audioUploadStatus: "UPLOADED",
        tasks: { create: [{ promptText: `${category} task`, order: 1 }] },
      },
    });
    assert.ok(question.id);
  }

  const result = await initializeManifestSubmission(student.id, "start-key-1", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  assert.equal(result.entries.length, 3);
  assert.deepEqual(result.entries.map((entry) => entry.deliveryPosition), [1, 2, 3]);
  assert.equal(await prisma.submission.count({ where: { id: result.submissionId } }), 1);
  assert.equal(await prisma.manifestEntry.count({ where: { manifestId: result.manifestId } }), 3);
  assert.equal(await prisma.manifestTask.count({ where: { manifestEntry: { manifestId: result.manifestId } } }), 3);
});

test("unavailable assessment persists no Submission", async () => {
  const student = await createStudent();
  const failures: unknown[] = [];
  await assert.rejects(
    initializeManifestSubmission(student.id, "start-key-empty", {
      signPromptMedia: async () => {
        throw new Error("signer unavailable");
      },
      observeFailure: (event) => failures.push(event),
    }),
    AssessmentUnavailableError,
  );
  assert.equal(await prisma.submission.count({ where: { studentId: student.id } }), 0);
  assert.deepEqual(failures, [{ classification: "PREPARATION", categoryCount: 3, failureCount: 1 }]);

  await prisma.question.updateMany({ data: { deletedAt: new Date() } });
  const response = await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: {
      Cookie: `jwt=${jwt.sign({ id: student.id }, process.env.JWT_SECRET!)}`,
      "Idempotency-Key": "http-empty-key",
    },
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "5");
  assert.deepEqual(await response.json(), {
    error: "Assessment unavailable",
    code: "ASSESSMENT_UNAVAILABLE",
    retryable: true,
    retryAfterSeconds: 5,
  });
});

test("retries once when selected source evidence changes before persistence", async () => {
  const student = await createStudent();
  const questionIds: string[] = [];
  for (const category of ["PART_1", "PART_2", "PART_3"] as const) {
    const question = await prisma.question.create({
      data: {
        category,
        order: Math.floor(Math.random() * 1000000),
        preparationSeconds: 20,
        recordingSeconds: 60,
        audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
        audioMimeType: "audio/webm",
        audioSizeBytes: 128,
        audioUploadStatus: "UPLOADED",
        tasks: { create: [{ promptText: `${category} task`, order: 1 }] },
      },
    });
    questionIds.push(question.id);
  }
  let mutated = false;
  const failures: unknown[] = [];
  const result = await initializeManifestSubmission(student.id, "retry-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => {
      if (!mutated) {
        mutated = true;
        await prisma.question.update({ where: { id: questionIds[0] }, data: { preparationSeconds: 99 } });
      }
      return `https://media.example/${encodeURIComponent(key)}`;
    },
    observeFailure: (event) => failures.push(event),
  });
  assert.equal(mutated, true);
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries[0]?.preparationSeconds, 99);
});

test("student prompt media is limited to the active submission manifest", async () => {
  const adminEmail = `${crypto.randomUUID()}@example.test`;
  const [student, otherStudent, admin] = await Promise.all([
    createStudent(),
    createStudent(),
    prisma.user.create({
      data: {
        username: uniqueUsername("admin"),
        email: adminEmail,
        normalizedEmail: adminEmail,
        password: "unused",
        role: "ADMIN",
      },
    }),
  ]);
  const questions = await Promise.all(([
    "PART_1", "PART_2", "PART_3",
  ] as const).map((category) => prisma.question.create({
    data: {
      category,
      order: Math.floor(Math.random() * 1000000),
      createdById: admin.id,
      audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
      audioMimeType: "audio/webm",
      audioSizeBytes: 128,
      audioUploadStatus: "UPLOADED",
      tasks: { create: { promptText: "Describe the scene.", order: 1 } },
    },
  })));
  const tasks = await Promise.all(questions.map((question) =>
    prisma.task.findFirstOrThrow({ where: { questionId: question.id } }),
  ));
  const entryIds: string[] = [];
  const submission = await prisma.$transaction(async (tx: any) => {
    const created = await tx.submission.create({
      data: { studentId: student.id, status: "IN_PROGRESS" },
    });
    const manifest = await tx.submissionManifest.create({
      data: { submissionId: created.id, version: 1 },
    });
    for (const [index, question] of questions.entries()) {
      const entry = await tx.manifestEntry.create({
        data: {
          manifestId: manifest.id,
          submissionId: created.id,
          category: question.category,
          deliveryPosition: index + 1,
          sourceQuestionId: question.id,
          preparationSeconds: 20,
          recordingSeconds: 60,
          promptMediaStorageKey: question.audioStorageKey!,
          promptMediaMimeType: question.audioMimeType!,
          promptMediaSizeBytes: question.audioSizeBytes!,
        },
      });
      await tx.manifestTask.create({
        data: {
          manifestEntryId: entry.id,
          sourceQuestionId: question.id,
          sourceTaskId: tasks[index]!.id,
          deliveredOrder: 1,
          deliveredText: "Describe the scene.",
        },
      });
      entryIds.push(entry.id);
    }
    return created;
  });
  const cookie = (id: string) => `jwt=${jwt.sign({ id }, process.env.JWT_SECRET!)}`;
  const anonymousQuestionBank = await fetch(`${baseUrl}/api/questions`);
  assert.equal(anonymousQuestionBank.status, 401);
  const studentQuestionBank = await fetch(`${baseUrl}/api/questions`, { headers: { Cookie: cookie(student.id) } });
  assert.equal(studentQuestionBank.status, 403);
  const anonymousAdminBank = await fetch(`${baseUrl}/api/questions/admin`);
  assert.equal(anonymousAdminBank.status, 401);
  const anonymous = await fetch(`${baseUrl}/api/submissions/${submission.id}/prompts/${entryIds[0]}`);
  assert.equal(anonymous.status, 401);
  const crossAttempt = await fetch(`${baseUrl}/api/submissions/${submission.id}/prompts/${entryIds[0]}`, { headers: { Cookie: cookie(otherStudent.id) } });
  assert.equal(crossAttempt.status, 404);
  const unassigned = await fetch(`${baseUrl}/api/submissions/${submission.id}/prompts/${crypto.randomUUID()}`, { headers: { Cookie: cookie(student.id) } });
  assert.equal(unassigned.status, 404);
  const valid = await fetch(`${baseUrl}/api/submissions/${submission.id}/prompts/${entryIds[0]}`, { headers: { Cookie: cookie(student.id) } });
  assert.equal(valid.status, 200);
  const payload = await valid.json();
  assert.match(payload.data.url, /^https:\/\//);
  assert.equal(JSON.stringify(payload).includes("storageKey"), false);
});

test("replaying an idempotency key converges on the same retained manifest", async () => {
  const student = await createStudent();
  const first = await initializeManifestSubmission(student.id, "replay-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  await prisma.submission.update({ where: { id: first.submissionId }, data: { status: "ABANDONED" } });
  const replay = await initializeManifestSubmission(student.id, "replay-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/replay/${encodeURIComponent(key)}`,
  });
  assert.equal(replay.submissionId, first.submissionId);
  assert.equal(replay.manifestId, first.manifestId);
  assert.equal(replay.status, "ABANDONED");
  assert.equal(await prisma.submission.count({ where: { studentId: student.id } }), 1);
});

test("rejects reuse of an idempotency key by another student", async () => {
  const other = await createStudent();
  await assert.rejects(
    initializeManifestSubmission(other.id, "replay-key", {
      signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
    }),
    IdempotencyKeyConflictError,
  );
});
