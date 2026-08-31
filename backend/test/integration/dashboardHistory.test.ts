import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import type { Server } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { after, before, beforeEach, test } from "node:test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import type { Prisma, PrismaClient } from "../../src/generated/client.js";
import type { SubmissionStatus } from "../../src/generated/enums.js";

const execFileAsync = promisify(execFile);

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: () => Promise<void>;
let server: Server;
let baseUrl: string;

async function migrateDatabase(databaseUrl: string) {
  await execFileAsync(
    "npx",
    ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
    {
      cwd: process.cwd(),
      env: { ...process.env, DATABASE_URL: databaseUrl },
      timeout: 120_000,
    },
  );
}

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.JWT_SECRET = "dashboard-history-integration-secret";
  process.env.R2_ACCOUNT_ID = "dashboard-history-test-account";
  process.env.R2_ACCESS_KEY_ID = "dashboard-history-test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "dashboard-history-test-secret-key";
  process.env.R2_BUCKET_NAME = "dashboard-history-test-bucket";
  process.env.FRONTEND_URL = "https://fluentcheck.example.test";

  await migrateDatabase(process.env.DATABASE_URL);

  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  const { createApp } = await import("../../src/server.js");
  const app: Express = createApp();
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, { timeout: 120_000 });

beforeEach(async () => {
  await prisma.score.deleteMany();
  await prisma.certificate.deleteMany();
  await prisma.answer.deleteMany();
  await prisma.examinerAssignment.deleteMany();
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS "ManifestEntry_immutable" ON "ManifestEntry"',
  );
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS "ManifestTask_immutable" ON "ManifestTask"',
  );
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS "SubmissionManifest_immutable" ON "SubmissionManifest"',
  );
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS "ManifestEntry_v1_shape_check" ON "ManifestEntry"',
  );
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS "SubmissionManifest_v1_shape_check" ON "SubmissionManifest"',
  );
  await prisma.$executeRawUnsafe('DELETE FROM "ManifestTask"');
  await prisma.$executeRawUnsafe('DELETE FROM "ManifestEntry"');
  await prisma.$executeRawUnsafe('DELETE FROM "SubmissionManifest"');
  await prisma.submission.deleteMany();
  await prisma.task.deleteMany();
  await prisma.question.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$executeRawUnsafe(
    'CREATE CONSTRAINT TRIGGER "SubmissionManifest_v1_shape_check" AFTER INSERT OR UPDATE ON "SubmissionManifest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_submission_manifest_v1_shape()',
  );
  await prisma.$executeRawUnsafe(
    'CREATE CONSTRAINT TRIGGER "ManifestEntry_v1_shape_check" AFTER INSERT OR UPDATE OR DELETE ON "ManifestEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_submission_manifest_v1_shape()',
  );
  await prisma.$executeRawUnsafe(
    'CREATE TRIGGER "SubmissionManifest_immutable" BEFORE UPDATE OR DELETE ON "SubmissionManifest" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()',
  );
  await prisma.$executeRawUnsafe(
    'CREATE TRIGGER "ManifestEntry_immutable" BEFORE UPDATE OR DELETE ON "ManifestEntry" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()',
  );
  await prisma.$executeRawUnsafe(
    'CREATE TRIGGER "ManifestTask_immutable" BEFORE UPDATE OR DELETE ON "ManifestTask" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()',
  );
});

after(async () => {
  server.close();
  await once(server, "close");
  await disconnectDB();
  await container.stop();
}, { timeout: 120_000 });

async function createStudent(username = "student") {
  const email = `${username}@example.test`;
  return prisma.user.create({
    data: {
      username,
      email,
      normalizedEmail: email,
      password: "unused",
    },
  });
}

async function createSubmission(
  studentId: string,
  createdAt: string,
  status: SubmissionStatus = "SCORED",
) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const submission = await tx.submission.create({
      data: {
        studentId,
        status,
        scoringSystem: "RUBRIC_6",
        createdAt: new Date(createdAt),
      },
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
}

function cookieFor(userId: string) {
  const token = jwt.sign({ id: userId }, process.env.JWT_SECRET!);
  return `jwt=${token}`;
}

function dashboardRequest(path: string, userId: string) {
  return fetch(`${baseUrl}/api${path}`, {
    headers: { Cookie: cookieFor(userId) },
  });
}

test("returns a bounded summary page with deterministic cursor metadata", async () => {
  const student = await createStudent();
  const newest = (await createSubmission(student.id, "2026-01-03T00:00:00.000Z")).submission;
  const middle = (await createSubmission(student.id, "2026-01-02T00:00:00.000Z")).submission;
  await createSubmission(student.id, "2026-01-01T00:00:00.000Z");
  await createSubmission(
    student.id,
    "2026-01-04T00:00:00.000Z",
    "IN_PROGRESS",
  );

  const response = await dashboardRequest("/submissions?limit=2", student.id);
  assert.equal(response.status, 200);
  const firstPage = (await response.json()).data;

  assert.equal(firstPage.totalTests, 3);
  assert.deepEqual(
    firstPage.submissions.map((submission: { id: string }) => submission.id),
    [newest.id, middle.id],
  );
  assert.deepEqual(firstPage.pagination, {
    limit: 2,
    hasMore: true,
    nextCursor: firstPage.pagination.nextCursor,
  });
  assert.equal(typeof firstPage.pagination.nextCursor, "string");
  assert.deepEqual(Object.keys(firstPage.submissions[0]).sort(), [
    "createdAt",
    "id",
    "score",
    "scoringSystem",
    "status",
  ]);

  const secondResponse = await dashboardRequest(
    `/submissions?limit=2&cursor=${encodeURIComponent(firstPage.pagination.nextCursor)}`,
    student.id,
  );
  assert.equal(secondResponse.status, 200);
  const secondPage = (await secondResponse.json()).data;
  assert.equal(secondPage.submissions.length, 1);
  assert.equal(secondPage.pagination.hasMore, false);
  assert.equal(secondPage.pagination.nextCursor, null);
});
