import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, before, beforeEach, test } from "node:test";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

const execFileAsync = promisify(execFile);
let container: StartedPostgreSqlContainer;
let prisma: any;
let disconnectDB: (() => Promise<void>) | undefined;
let createExaminerAssignmentSet: typeof import("../../src/service/examiner.service.js").createExaminerAssignmentSet;
let AssignmentSetError: typeof import("../../src/service/examiner.service.js").AssignmentSetError;

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.JWT_SECRET = "assignment-set-test-secret";
  await execFileAsync("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    timeout: 120_000,
  });
  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  const examinerService = await import("../../src/service/examiner.service.js");
  createExaminerAssignmentSet = examinerService.createExaminerAssignmentSet;
  AssignmentSetError = examinerService.AssignmentSetError;
}, { timeout: 120_000 });

after(async () => {
  if (disconnectDB) await disconnectDB();
  if (container) await container.stop();
}, { timeout: 120_000 });

beforeEach(async () => {
  await prisma.examinerAssignment.deleteMany();
  await prisma.payment.deleteMany();
  // Manifest evidence is immutable and shape-checked by deferred triggers;
  // drop them for the privileged test cleanup path and restore afterwards.
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

async function createAssignmentReadySubmission() {
  const student = await prisma.user.create({
    data: {
      username: `student-${crypto.randomUUID()}`,
      email: `${crypto.randomUUID()}@example.test`,
      password: "unused",
      role: "STUDENT",
    },
  });
  // The manifest shape trigger is deferred to commit, so the Submission and
  // its complete version-1 manifest must be created in one transaction.
  return prisma.$transaction(async (tx: any) => {
    const submission = await tx.submission.create({
      data: { studentId: student.id, status: "PAID", paymentRequired: true },
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

test("a committed set has exactly two distinct examiners in slots 1 and 2 and enters scoring", async () => {
  await createExaminer("one");
  await createExaminer("two");
  await createExaminer("three");
  const submission = await createAssignmentReadySubmission();

  const result = await createExaminerAssignmentSet(submission.id);

  assert.equal(result.outcome, "CREATED");
  assert.equal(result.status, "SCORING");
  assert.equal(result.assignments.length, 2);
  assert.deepEqual(
    result.assignedExaminers.map((examiner: any) => examiner.id).sort(),
    result.assignedExaminers.map((examiner: any) => examiner.id).sort(),
  );

  const rows = await prisma.examinerAssignment.findMany({
    where: { submissionId: submission.id },
    orderBy: { slot: "asc" },
  });
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((row: any) => row.slot), [1, 2]);
  assert.notEqual(rows[0].examinerId, rows[1].examinerId);
  assert.deepEqual(
    rows.map((row: any) => row.status),
    ["ASSIGNED", "ASSIGNED"],
  );
  assert.equal(
    (await prisma.submission.findUnique({ where: { id: submission.id } })).status,
    "SCORING",
  );
});

test("a repeated attempt after a committed set is an idempotent EXISTING replay", async () => {
  await createExaminer("one");
  await createExaminer("two");
  const submission = await createAssignmentReadySubmission();

  const first = await createExaminerAssignmentSet(submission.id);
  const replay = await createExaminerAssignmentSet(submission.id);

  assert.equal(first.outcome, "CREATED");
  assert.equal(replay.outcome, "EXISTING");
  assert.deepEqual(
    replay.assignments.map((assignment: any) => assignment.id).sort(),
    first.assignments.map((assignment: any) => assignment.id).sort(),
  );
  assert.equal(
    await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
    2,
  );
});

test("concurrent attempts commit exactly one set and converge on the same examiners", async () => {
  await createExaminer("one");
  await createExaminer("two");
  await createExaminer("three");
  const submission = await createAssignmentReadySubmission();

  const results = await Promise.allSettled([
    createExaminerAssignmentSet(submission.id),
    createExaminerAssignmentSet(submission.id),
    createExaminerAssignmentSet(submission.id),
    createExaminerAssignmentSet(submission.id),
  ]);

  const fulfilled = results
    .filter((result): result is PromiseFulfilledResult<any> => result.status === "fulfilled")
    .map((result) => result.value);
  assert.equal(fulfilled.length, 4);

  const created = fulfilled.filter((result) => result.outcome === "CREATED");
  assert.equal(created.length, 1);

  const assignmentIds = new Set(
    fulfilled.flatMap((result) => result.assignments.map((assignment: any) => assignment.id)),
  );
  assert.equal(assignmentIds.size, 2);

  assert.equal(
    await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
    2,
  );
  assert.equal(
    (await prisma.submission.findUnique({ where: { id: submission.id } })).status,
    "SCORING",
  );
});

test("fewer than two Eligible examiners fails with a retryable capacity error and leaves no state", async () => {
  await createExaminer("only");
  const submission = await createAssignmentReadySubmission();

  await assert.rejects(
    () => createExaminerAssignmentSet(submission.id),
    (error: any) => {
      assert.ok(error instanceof AssignmentSetError);
      assert.equal(error.code, "INSUFFICIENT_CAPACITY");
      assert.equal(error.retryable, true);
      assert.equal(error.eligibleExaminerCount, 1);
      return true;
    },
  );

  assert.equal(
    await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
    0,
  );
  assert.equal(
    (await prisma.submission.findUnique({ where: { id: submission.id } })).status,
    "PAID",
  );
});

test("soft-deleted examiners are not Eligible", async () => {
  await createExaminer("active-one");
  const deleted = await createExaminer("deleted");
  await prisma.user.update({
    where: { id: deleted.id },
    data: { deletedAt: new Date() },
  });
  const submission = await createAssignmentReadySubmission();

  await assert.rejects(
    () => createExaminerAssignmentSet(submission.id),
    (error: any) => {
      assert.equal(error.code, "INSUFFICIENT_CAPACITY");
      assert.equal(error.eligibleExaminerCount, 1);
      return true;
    },
  );
});

test("a non-Assignment-ready submission fails without creating assignments", async () => {
  await createExaminer("one");
  await createExaminer("two");
  const submission = await createAssignmentReadySubmission();
  await prisma.submission.update({
    where: { id: submission.id },
    data: { status: "AWAITING_PAYMENT" },
  });

  await assert.rejects(
    () => createExaminerAssignmentSet(submission.id),
    (error: any) => {
      assert.equal(error.code, "NOT_ASSIGNMENT_READY");
      assert.equal(error.retryable, false);
      return true;
    },
  );

  assert.equal(
    await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
    0,
  );
});

test("an unknown submission fails with SUBMISSION_NOT_FOUND", async () => {
  await createExaminer("one");
  await createExaminer("two");

  await assert.rejects(
    () => createExaminerAssignmentSet(crypto.randomUUID()),
    (error: any) => {
      assert.equal(error.code, "SUBMISSION_NOT_FOUND");
      return true;
    },
  );
});

test("a lifecycle-inconsistent existing set fails closed with INVARIANT_VIOLATION", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const submission = await createAssignmentReadySubmission();

  // Simulate corrupted history: a complete assignment pair on a
  // non-scoring Submission. The final schema rejects cardinality corruption;
  // this test covers the remaining lifecycle invariant at the service seam.
  await prisma.examinerAssignment.createMany({
    data: [
      { submissionId: submission.id, examinerId: one.id, slot: 1, status: "ASSIGNED" },
      { submissionId: submission.id, examinerId: two.id, slot: 2, status: "ASSIGNED" },
    ],
  });

  await assert.rejects(
    () => createExaminerAssignmentSet(submission.id),
    (error: any) => {
      assert.equal(error.code, "INVARIANT_VIOLATION");
      assert.equal(error.retryable, false);
      return true;
    },
  );

  assert.equal(
    await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
    2,
  );
});

test("an injectable selector determines the chosen pair deterministically", async () => {
  const one = await createExaminer("one");
  const two = await createExaminer("two");
  const three = await createExaminer("three");
  const submission = await createAssignmentReadySubmission();

  const result = await createExaminerAssignmentSet(submission.id, {
    selectCandidates: (eligibleExaminerIds) => {
      const sorted = [...eligibleExaminerIds].sort();
      return [sorted[0], sorted[1]];
    },
  });

  const chosen = result.assignedExaminers.map((examiner: any) => examiner.id).sort();
  const expected = [one.id, two.id, three.id].sort().slice(0, 2);
  assert.deepEqual(chosen, expected);
});
