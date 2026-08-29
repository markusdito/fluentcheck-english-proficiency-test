import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, before, beforeEach, test } from "node:test";
import { once } from "node:events";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import type { Express } from "express";
import { Client } from "pg";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import type { Prisma, PrismaClient } from "../../src/generated/client.js";
import type { SubmissionStatus } from "../../src/generated/enums.js";

const execFileAsync = promisify(execFile);
const JWT_SECRET = crypto.randomBytes(32).toString("hex");
const TEST_PASSWORD_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: (() => Promise<void>) | undefined;
let app: Express;
let createApp: typeof import("../../src/server.js").createApp;
let server: Server;
let baseUrl: string;

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.JWT_SECRET = JWT_SECRET;
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
  ({ createApp } = await import("../../src/server.js"));
  app = createApp();
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Examiner scoring test server did not bind");
  }
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

beforeEach(async () => {
  await prisma.score.deleteMany();
  await prisma.examinerAssignment.deleteMany();
  await prisma.answer.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "ManifestEntry_immutable" ON "ManifestEntry"');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "ManifestTask_immutable" ON "ManifestTask"');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "SubmissionManifest_immutable" ON "SubmissionManifest"');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "ManifestEntry_v1_shape_check" ON "ManifestEntry"');
  await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "SubmissionManifest_v1_shape_check" ON "SubmissionManifest"');
  await prisma.$executeRawUnsafe('DELETE FROM "ManifestTask"');
  await prisma.$executeRawUnsafe('DELETE FROM "ManifestEntry"');
  await prisma.$executeRawUnsafe('DELETE FROM "SubmissionManifest"');
  await prisma.submission.deleteMany();
  await prisma.user.updateMany({ data: { deletedAt: new Date() } });
  await prisma.$executeRawUnsafe('CREATE CONSTRAINT TRIGGER "SubmissionManifest_v1_shape_check" AFTER INSERT OR UPDATE ON "SubmissionManifest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_submission_manifest_v1_shape()');
  await prisma.$executeRawUnsafe('CREATE CONSTRAINT TRIGGER "ManifestEntry_v1_shape_check" AFTER INSERT OR UPDATE OR DELETE ON "ManifestEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_submission_manifest_v1_shape()');
  await prisma.$executeRawUnsafe('CREATE TRIGGER "SubmissionManifest_immutable" BEFORE UPDATE OR DELETE ON "SubmissionManifest" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()');
  await prisma.$executeRawUnsafe('CREATE TRIGGER "ManifestEntry_immutable" BEFORE UPDATE OR DELETE ON "ManifestEntry" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()');
  await prisma.$executeRawUnsafe('CREATE TRIGGER "ManifestTask_immutable" BEFORE UPDATE OR DELETE ON "ManifestTask" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()');
});

async function createExaminer(prefix: string) {
  return prisma.user.create({
    data: {
      username: `${prefix}-${crypto.randomUUID()}`,
      email: `${crypto.randomUUID()}@example.test`,
      password: TEST_PASSWORD_HASH,
      role: "EXAMINER",
    },
  });
}

async function createScoringSubmission(status: SubmissionStatus = "SCORING") {
  const student = await prisma.user.create({
    data: {
      username: `student-${crypto.randomUUID()}`,
      email: `${crypto.randomUUID()}@example.test`,
      password: TEST_PASSWORD_HASH,
      role: "STUDENT",
    },
  });

  const { submission, entries } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const submission = await tx.submission.create({
      data: { studentId: student.id, status, scoringSystem: "RUBRIC_6" },
    });
    const manifest = await tx.submissionManifest.create({
      data: { submissionId: submission.id, version: 1 },
    });
    const entries = [];
    for (const [index, category] of (["PART_1", "PART_2", "PART_3"] as const).entries()) {
      const question = await tx.question.create({
        data: {
          category,
          order: Math.floor(Math.random() * 1_000_000),
          tasks: { create: { promptText: "Prompt", order: 1 } },
        },
      });
      entries.push(await tx.manifestEntry.create({
        data: {
          manifestId: manifest.id,
          submissionId: submission.id,
          category,
          deliveryPosition: index + 1,
          sourceQuestionId: question.id,
        },
      }));
    }
    return { submission, entries };
  });

  const answers = [];
  for (const entry of entries) {
    answers.push(await prisma.answer.create({
      data: {
        submissionId: submission.id,
        manifestEntryId: entry.id,
        storageKey: `submissions/${submission.id}/answers/${entry.id}.webm`,
        mimeType: "video/webm",
        uploadStatus: "UPLOADED",
      },
    }));
  }

  return { student, submission, answers };
}

async function createAssignmentSet(
  submissionId: string,
  one: { id: string },
  two: { id: string },
  statuses: ["ASSIGNED" | "IN_PROGRESS" | "COMPLETED", "ASSIGNED" | "IN_PROGRESS" | "COMPLETED"] = ["IN_PROGRESS", "ASSIGNED"],
) {
  const assignments = await prisma.examinerAssignment.createManyAndReturn({
    data: [
      { submissionId, examinerId: one.id, slot: 1, status: statuses[0] },
      { submissionId, examinerId: two.id, slot: 2, status: statuses[1] },
    ],
  });
  return assignments.sort((left, right) => left.slot - right.slot);
}

async function saveScores(assignmentId: string, answerIds: string[], count = answerIds.length) {
  await prisma.score.createMany({
    data: answerIds.slice(0, count).map((answerId) => ({
      assignmentId,
      answerId,
      value: 4,
      pronunciation: 4,
      fluency: 4,
      vocabulary: 4,
      grammar: 4,
    })),
  });
}

function examinerCookie(examinerId: string) {
  return `jwt=${jwt.sign({ id: examinerId }, JWT_SECRET)}`;
}

async function complete(assignmentId: string, examinerId: string) {
  return fetch(`${baseUrl}/api/examiner/assignments/${assignmentId}/complete`, {
    method: "POST",
    headers: { Cookie: examinerCookie(examinerId) },
  });
}

test("manual completion keeps the first assignment in SCORING and reaches SCORED after the second", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first, second] = await createAssignmentSet(submission.id, one, two);
  await saveScores(first.id, answers.map((answer) => answer.id));

  const firstResponse = await complete(first.id, one.id);
  assert.equal(firstResponse.status, 200);
  assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "COMPLETED");
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORING");

  await saveScores(second.id, answers.map((answer) => answer.id));
  const secondResponse = await complete(second.id, two.id);
  assert.equal(secondResponse.status, 200);
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORED");
});

test("concurrent manual completions serialize on the owning Submission", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first, second] = await createAssignmentSet(
    submission.id,
    one,
    two,
    ["IN_PROGRESS", "IN_PROGRESS"],
  );
  const answerIds = answers.map((answer) => answer.id);
  await saveScores(first.id, answerIds);
  await saveScores(second.id, answerIds);

  const responses = await Promise.all([
    complete(first.id, one.id),
    complete(second.id, two.id),
  ]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 200]);
  assert.deepEqual(
    (await prisma.examinerAssignment.findMany({
      where: { submissionId: submission.id },
      orderBy: { slot: "asc" },
      select: { status: true },
    })).map((assignment) => assignment.status),
    ["COMPLETED", "COMPLETED"],
  );
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORED");
});

test("manual completion never downgrades an already terminal Submission", async () => {
  for (const terminalStatus of ["SCORED", "CERTIFIED"] as const) {
    const one = await createExaminer("one");
    const two = await createExaminer("two");
    const { submission, answers } = await createScoringSubmission(terminalStatus);
    const [first] = await createAssignmentSet(submission.id, one, two);
    await saveScores(first.id, answers.map((answer) => answer.id));

    const response = await complete(first.id, one.id);
    assert.equal(response.status, 409);
    assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "IN_PROGRESS");
    assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, terminalStatus);
  }
});

test("manual completion rejects incomplete Score drafts without mutation", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first] = await createAssignmentSet(submission.id, one, two);
  await saveScores(first.id, answers.map((answer) => answer.id), answers.length - 1);

  const response = await complete(first.id, one.id);
  assert.equal(response.status, 400);
  assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "IN_PROGRESS");
  assert.equal(await prisma.score.count({ where: { assignmentId: first.id } }), answers.length - 1);
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORING");
});

test("manual completion rejects an invalid stored Score without mutation", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first] = await createAssignmentSet(submission.id, one, two);
  await saveScores(first.id, answers.map((answer) => answer.id));
  await prisma.score.updateMany({
    where: { assignmentId: first.id },
    data: { value: 99 },
  });

  const response = await complete(first.id, one.id);
  assert.equal(response.status, 400);
  assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "IN_PROGRESS");
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORING");
});

test("manual completion re-reads Score drafts after waiting for the Submission lock", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission();
  const [first] = await createAssignmentSet(submission.id, one, two);
  await saveScores(first.id, answers.map((answer) => answer.id));

  const client = new Client({ connectionString: container.getConnectionUri() });
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query('SELECT "id" FROM "Submission" WHERE "id" = $1 FOR UPDATE', [submission.id]);

    const responsePromise = complete(first.id, one.id);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await client.query('DELETE FROM "Score" WHERE "assignmentId" = $1', [first.id]);
    await client.query("COMMIT");

    const response = await responsePromise;
    assert.equal(response.status, 400);
    assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "IN_PROGRESS");
    assert.equal(await prisma.score.count({ where: { assignmentId: first.id } }), 0);
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
});

test("manual completion rejects a malformed assignment set without mutation", async () => {
  const one = await createExaminer("one");
  const { submission, answers } = await createScoringSubmission();
  const [first] = await prisma.examinerAssignment.createManyAndReturn({
    data: [{ submissionId: submission.id, examinerId: one.id, slot: 1, status: "IN_PROGRESS" }],
  });
  await saveScores(first.id, answers.map((answer) => answer.id));

  const response = await complete(first.id, one.id);
  assert.equal(response.status, 409);
  assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "IN_PROGRESS");
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "SCORING");
});

test("manual completion rejects an invalid Submission lifecycle without mutation", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const { submission, answers } = await createScoringSubmission("PAID");
  const [first] = await createAssignmentSet(submission.id, one, two);
  await saveScores(first.id, answers.map((answer) => answer.id));

  const response = await complete(first.id, one.id);
  assert.equal(response.status, 409);
  assert.equal((await prisma.examinerAssignment.findUnique({ where: { id: first.id } }))?.status, "IN_PROGRESS");
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } }))?.status, "PAID");
});
