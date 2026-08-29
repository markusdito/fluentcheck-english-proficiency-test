import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, before, beforeEach, test } from "node:test";
import { once } from "node:events";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import type { Express } from "express";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

const execFileAsync = promisify(execFile);
let container: StartedPostgreSqlContainer;
let prisma: any;
let disconnectDB: (() => Promise<void>) | undefined;
let app: Express;
let server: Server;
let baseUrl: string;

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.JWT_SECRET = "admin-assignment-test-secret";
  await execFileAsync("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    timeout: 120_000,
  });
  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  const { createApp } = await import("../../src/server.js");
  app = createApp();
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Admin test server did not bind");
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
  await prisma.examinerAssignment.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "ManifestEntry_immutable" ON "ManifestEntry"`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "ManifestTask_immutable" ON "ManifestTask"`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "SubmissionManifest_immutable" ON "SubmissionManifest"`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "ManifestEntry_v1_shape_check" ON "ManifestEntry"`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "SubmissionManifest_v1_shape_check" ON "SubmissionManifest"`);
  await prisma.$executeRawUnsafe(`DELETE FROM "ManifestTask"`);
  await prisma.$executeRawUnsafe(`DELETE FROM "ManifestEntry"`);
  await prisma.$executeRawUnsafe(`DELETE FROM "SubmissionManifest"`);
  await prisma.submission.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER "SubmissionManifest_v1_shape_check" AFTER INSERT OR UPDATE ON "SubmissionManifest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_submission_manifest_v1_shape()`);
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER "ManifestEntry_v1_shape_check" AFTER INSERT OR UPDATE OR DELETE ON "ManifestEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_submission_manifest_v1_shape()`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "SubmissionManifest_immutable" BEFORE UPDATE OR DELETE ON "SubmissionManifest" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "ManifestEntry_immutable" BEFORE UPDATE OR DELETE ON "ManifestEntry" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "ManifestTask_immutable" BEFORE UPDATE OR DELETE ON "ManifestTask" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()`);
});

async function createExaminer(prefix: string) {
  return prisma.user.create({
    data: {
      username: `${prefix}-${crypto.randomUUID()}`,
      email: `${crypto.randomUUID()}@example.test`,
      password: "unused",
      role: "EXAMINER",
    },
  });
}

async function createAdmin() {
  const admin = await prisma.user.create({
    data: {
      username: `admin-${crypto.randomUUID()}`,
      email: `${crypto.randomUUID()}@example.test`,
      password: "unused",
      role: "ADMIN",
    },
  });
  return `jwt=${jwt.sign({ id: admin.id }, process.env.JWT_SECRET!)}`;
}

async function createAssignmentReadySubmission(status = "PAID") {
  const student = await prisma.user.create({
    data: {
      username: `student-${crypto.randomUUID()}`,
      email: `${crypto.randomUUID()}@example.test`,
      password: "unused",
      role: "STUDENT",
    },
  });
  return prisma.$transaction(async (tx: any) => {
    const submission = await tx.submission.create({
      data: { studentId: student.id, status, paymentRequired: true },
    });
    const manifest = await tx.submissionManifest.create({
      data: { submissionId: submission.id, version: 1 },
    });
    for (const [index, category] of (["PART_1", "PART_2", "PART_3"] as const).entries()) {
      const question = await tx.question.create({
        data: { category, order: Math.floor(Math.random() * 1_000_000), tasks: { create: { promptText: "Prompt", order: 1 } } },
      });
      await tx.manifestEntry.create({
        data: {
          manifestId: manifest.id,
          submissionId: submission.id,
          category,
          deliveryPosition: index + 1,
          sourceQuestionId: question.id,
        },
      });
    }
    return submission;
  });
}

function assignUrl(submissionId: string) {
  return `${baseUrl}/api/admin/submissions/${submissionId}/assign`;
}

test("admin assignment creates a set and reports the CREATED outcome with two examiner names", async () => {
  await createExaminer("one");
  await createExaminer("two");
  const submission = await createAssignmentReadySubmission();
  const cookie = await createAdmin();

  const response = await fetch(assignUrl(submission.id), {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const payload = await response.json();

  assert.equal(response.status, 200);
  assert.equal(payload.data.outcome, "CREATED");
  assert.equal(payload.data.status, "SCORING");
  assert.equal(payload.data.assignments.length, 2);
  assert.equal(payload.data.assignedExaminers.length, 2);
  assert.equal(
    new Set(payload.data.assignedExaminers.map((e: any) => e.id)).size,
    2,
  );
  assert.equal(
    await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
    2,
  );
});

test("a repeated admin assignment reports the EXISTING outcome without new rows", async () => {
  await createExaminer("one");
  await createExaminer("two");
  const submission = await createAssignmentReadySubmission();
  const cookie = await createAdmin();

  const first = await fetch(assignUrl(submission.id), {
    method: "POST",
    headers: { Cookie: cookie },
  });
  assert.equal(first.status, 200);
  const firstPayload = (await first.json()).data;

  const replay = await fetch(assignUrl(submission.id), {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const replayPayload = (await replay.json()).data;

  assert.equal(replay.status, 200);
  assert.equal(replayPayload.outcome, "EXISTING");
  assert.deepEqual(
    replayPayload.assignments.map((a: any) => a.id).sort(),
    firstPayload.assignments.map((a: any) => a.id).sort(),
  );
  assert.equal(
    await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
    2,
  );
});

test("concurrent admin recovery converges on one set with one CREATED and one EXISTING outcome", async () => {
  await createExaminer("one");
  await createExaminer("two");
  await createExaminer("three");
  const submission = await createAssignmentReadySubmission();
  const cookie = await createAdmin();

  const [first, second] = await Promise.all([
    fetch(assignUrl(submission.id), { method: "POST", headers: { Cookie: cookie } }),
    fetch(assignUrl(submission.id), { method: "POST", headers: { Cookie: cookie } }),
  ]);
  const firstPayload = (await first.json()).data;
  const secondPayload = (await second.json()).data;

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  const outcomes = [firstPayload.outcome, secondPayload.outcome].sort();
  assert.deepEqual(outcomes, ["CREATED", "EXISTING"]);
  assert.equal(
    await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
    2,
  );
});

test("a missing submission returns 404 with SUBMISSION_NOT_FOUND", async () => {
  await createExaminer("one");
  await createExaminer("two");
  const cookie = await createAdmin();

  const response = await fetch(assignUrl(crypto.randomUUID()), {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const payload = await response.json();

  assert.equal(response.status, 404);
  assert.equal(payload.code, "SUBMISSION_NOT_FOUND");
});

test("a non-Assignment-ready submission returns 409 with NOT_ASSIGNMENT_READY", async () => {
  await createExaminer("one");
  await createExaminer("two");
  const submission = await createAssignmentReadySubmission("AWAITING_PAYMENT");
  const cookie = await createAdmin();

  const response = await fetch(assignUrl(submission.id), {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.code, "NOT_ASSIGNMENT_READY");
  assert.equal(payload.retryable, false);
  assert.equal(
    await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
    0,
  );
});

test("insufficient capacity returns 409 with retryable metadata and observed count", async () => {
  await createExaminer("only");
  const submission = await createAssignmentReadySubmission();
  const cookie = await createAdmin();

  const response = await fetch(assignUrl(submission.id), {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.code, "INSUFFICIENT_CAPACITY");
  assert.equal(payload.retryable, true);
  assert.equal(payload.eligibleExaminerCount, 1);
  assert.equal(
    (await prisma.submission.findUnique({ where: { id: submission.id } })).status,
    "PAID",
  );
});

test("an invariant violation returns 409 and identifies repair-required data", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const three = await createExaminer("three");
  const submission = await createAssignmentReadySubmission("SCORING");
  for (const [index, examiner] of [one, two, three].entries()) {
    await prisma.examinerAssignment.create({
      data: {
        submissionId: submission.id,
        examinerId: examiner.id,
        slot: index < 2 ? index + 1 : null,
        status: "ASSIGNED",
      },
    });
  }
  const cookie = await createAdmin();

  const response = await fetch(assignUrl(submission.id), {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const payload = await response.json();

  assert.equal(response.status, 409);
  assert.equal(payload.code, "INVARIANT_VIOLATION");
  assert.equal(payload.retryable, false);
});

test("the admin endpoint rejects unauthenticated and non-admin callers", async () => {
  const submission = await createAssignmentReadySubmission();

  const anonymous = await fetch(assignUrl(submission.id), { method: "POST" });
  assert.equal(anonymous.status, 401);
});

test("automatic payment failure preserves the committed payment and later admin recovery succeeds", async () => {
  // No examiners: automatic assignment after payment cannot proceed.
  const student = await prisma.user.create({
    data: {
      username: `student-${crypto.randomUUID()}`,
      email: `${crypto.randomUUID()}@example.test`,
      password: "unused",
      role: "STUDENT",
    },
  });
  const submission = await prisma.$transaction(async (tx: any) => {
    const created = await tx.submission.create({
      data: { studentId: student.id, status: "AWAITING_PAYMENT", paymentRequired: true },
    });
    const manifest = await tx.submissionManifest.create({
      data: { submissionId: created.id, version: 1 },
    });
    for (const [index, category] of (["PART_1", "PART_2", "PART_3"] as const).entries()) {
      const question = await tx.question.create({
        data: { category, order: Math.floor(Math.random() * 1_000_000), tasks: { create: { promptText: "Prompt", order: 1 } } },
      });
      await tx.manifestEntry.create({
        data: {
          manifestId: manifest.id,
          submissionId: created.id,
          category,
          deliveryPosition: index + 1,
          sourceQuestionId: question.id,
        },
      });
    }
    return created;
  });

  // Simulate the automatic handoff: payment commits, assignment fails.
  await prisma.submission.update({
    where: { id: submission.id },
    data: { status: "PAID" },
  });

  // The submission remains Assignment-ready and visible to admin recovery.
  const cookie = await createAdmin();
  await createExaminer("late-one");
  await createExaminer("late-two");

  const recovery = await fetch(assignUrl(submission.id), {
    method: "POST",
    headers: { Cookie: cookie },
  });
  const recoveryPayload = await recovery.json();

  assert.equal(recovery.status, 200);
  assert.equal(recoveryPayload.data.outcome, "CREATED");
  assert.equal(recoveryPayload.data.assignments.length, 2);
  assert.equal(
    (await prisma.submission.findUnique({ where: { id: submission.id } })).status,
    "SCORING",
  );
});
