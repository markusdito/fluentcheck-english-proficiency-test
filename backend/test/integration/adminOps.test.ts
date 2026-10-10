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
import { SLOTS, createFixtureTestSet, manifestTestSetData } from "../fixtures/testSets.js";

const execFileAsync = promisify(execFile);
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: (() => Promise<void>) | undefined;
let server: Server;
let baseUrl: string;

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.R2_BUCKET_NAME = "admin-ops-test-bucket";
  process.env.R2_ACCOUNT_ID = "admin-ops-test-account";
  process.env.R2_ACCESS_KEY_ID = "admin-ops-test-key";
  process.env.R2_SECRET_ACCESS_KEY = "admin-ops-test-secret";
  process.env.JWT_SECRET = "admin-ops-test-secret";
  await execFileAsync("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    timeout: 120_000,
  });
  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  const { createApp } = await import("../../src/server.js");
  server = createApp().listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Admin ops test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
  await prisma.appSettings.upsert({
    where: { id: 1 },
    create: { id: 1, paymentEnabled: true },
    update: { paymentEnabled: true },
  });
}, { timeout: 120_000 });

after(async () => {
  if (server) {
    server.close();
    await once(server, "close");
  }
  if (disconnectDB) await disconnectDB();
  if (container) await container.stop();
}, { timeout: 120_000 });

async function user(role: "STUDENT" | "EXAMINER" | "ADMIN") {
  const email = `${crypto.randomUUID()}@example.test`;
  return prisma.user.create({
    data: {
      username: `${role.toLowerCase()}_${crypto.randomUUID().replaceAll("-", "")}`,
      email,
      normalizedEmail: email,
      password: "unused",
      role,
    },
  });
}

/** An in-progress version 2 Submission with all five Answers verified. */
async function recordedSubmission(studentId: string) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const submission = await tx.submission.create({ data: { studentId } });
    const testSet = await createFixtureTestSet(tx);
    const manifest = await tx.submissionManifest.create({
      data: { submissionId: submission.id, ...manifestTestSetData(testSet) },
    });
    const entries = [];
    for (const [index, category] of SLOTS.entries()) {
      const question = await tx.question.create({ data: { category, testSetId: testSet.id } });
      const entry = await tx.manifestEntry.create({
        data: {
          manifestId: manifest.id,
          submissionId: submission.id,
          category,
          deliveryPosition: index + 1,
          sourceQuestionId: question.id,
          promptMediaStorageKey: `questions/${question.id}/prompt.webm`,
          promptMediaMimeType: "audio/webm",
          promptMediaSizeBytes: 10,
        },
      });
      entries.push(entry);
      await tx.answer.create({
        data: {
          submissionId: submission.id,
          manifestEntryId: entry.id,
          storageKey: `submissions/${submission.id}/answers/${entry.id}.webm`,
          mimeType: "video/webm",
          uploadStatus: "UPLOADED",
          sizeBytes: 10,
          verifiedAt: new Date(),
          observedMimeType: "video/webm",
          proofVersion: 1,
        },
      });
    }
    return { submission, entries };
  });
}

function request(method: string, path: string, userId: string, body?: unknown) {
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      Cookie: `jwt=${jwt.sign({ id: userId }, process.env.JWT_SECRET!)}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function status(submissionId: string) {
  return (await prisma.submission.findUniqueOrThrow({ where: { id: submissionId } })).status;
}

async function queues(adminId: string) {
  const response = await request("GET", "/admin/queues", adminId);
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

async function scoringSubmission(studentId: string, examinerIds: string[]) {
  const { submission } = await recordedSubmission(studentId);
  await prisma.submission.update({ where: { id: submission.id }, data: { status: "SCORING", paymentRequired: false } });
  const assignments = [];
  for (const [index, examinerId] of examinerIds.entries()) {
    assignments.push(
      await prisma.examinerAssignment.create({
        data: { submissionId: submission.id, examinerId, slot: index + 1 },
      }),
    );
  }
  return { submission, assignments };
}

// Runs first: no Examiner exists yet, so a waived Submission waits Assignment-ready.
test("an Admin waives payment for one Submission; it is audited and becomes Assignment-ready", async () => {
  const student = await user("STUDENT");
  const admin = await user("ADMIN");
  const { submission } = await recordedSubmission(student.id);
  assert.equal(
    (await request("POST", `/admin/submissions/${submission.id}/payment-waiver`, admin.id, { reason: "x" })).status,
    409,
    "an in-progress Submission cannot be waived",
  );
  assert.equal((await request("POST", `/submissions/${submission.id}/complete`, student.id)).status, 200);
  assert.equal(await status(submission.id), "AWAITING_PAYMENT");

  assert.equal(
    (await request("POST", `/admin/submissions/${submission.id}/payment-waiver`, student.id, { reason: "x" })).status,
    403,
  );
  assert.equal((await request("POST", `/admin/submissions/${submission.id}/payment-waiver`, admin.id, {})).status, 400);

  const waived = await request("POST", `/admin/submissions/${submission.id}/payment-waiver`, admin.id, {
    reason: "Scholarship candidate",
  });
  assert.equal(waived.status, 200);
  assert.equal((await waived.json()).data.status, "PAID");
  const row = await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } });
  assert.equal(row.status, "PAID");
  assert.equal(row.paymentRequired, false);
  const audit = await prisma.submissionPaymentWaiver.findUniqueOrThrow({ where: { submissionId: submission.id } });
  assert.equal(audit.adminId, admin.id);
  assert.equal(audit.reason, "Scholarship candidate");

  const again = await request("POST", `/admin/submissions/${submission.id}/payment-waiver`, admin.id, { reason: "again" });
  assert.equal(again.status, 409);
  assert.equal(await prisma.submissionPaymentWaiver.count({ where: { submissionId: submission.id } }), 1);

  const detail = (await (await request("GET", `/admin/submissions/${submission.id}`, admin.id)).json()).data;
  assert.equal(detail.paymentWaiver.reason, "Scholarship candidate");
  assert.equal(detail.paymentWaiver.adminName, admin.username);

  const ready = (await queues(admin.id)).assignmentReady.items;
  const queued = ready.find((item: { submissionId: string }) => item.submissionId === submission.id);
  assert.ok(queued, "a waived Submission with no Examiners yet is in the assignment-ready queue");
  assert.equal(queued.paymentWaived, true);

  await user("EXAMINER");
  await user("EXAMINER");
  assert.equal((await request("POST", `/admin/submissions/${submission.id}/assign`, admin.id)).status, 200);
  assert.equal(await status(submission.id), "SCORING");
  const after = (await queues(admin.id)).assignmentReady.items;
  assert.ok(!after.some((item: { submissionId: string }) => item.submissionId === submission.id));
});

test("an Admin reassigns an untouched ASSIGNED assignment, keeping its identity and history", async () => {
  const student = await user("STUDENT");
  const admin = await user("ADMIN");
  const [first, second, replacement, retired] = [
    await user("EXAMINER"),
    await user("EXAMINER"),
    await user("EXAMINER"),
    await user("EXAMINER"),
  ];
  await prisma.user.update({ where: { id: retired.id }, data: { deletedAt: new Date() } });
  const { submission, assignments } = await scoringSubmission(student.id, [first.id, second.id]);
  const path = `/admin/assignments/${assignments[0].id}/reassign`;

  assert.equal((await request("POST", path, first.id, { examinerId: replacement.id, reason: "x" })).status, 403);
  assert.equal((await request("POST", path, admin.id, { examinerId: replacement.id })).status, 400);
  for (const examinerId of [second.id, retired.id, student.id]) {
    const rejected = await request("POST", path, admin.id, { examinerId, reason: "Workload" });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).code, "INVALID_EXAMINER");
  }

  const moved = await request("POST", path, admin.id, { examinerId: replacement.id, reason: "Examiner on leave" });
  assert.equal(moved.status, 200);
  assert.equal((await moved.json()).data.outcome, "REASSIGNED");
  const assignment = await prisma.examinerAssignment.findUniqueOrThrow({ where: { id: assignments[0].id } });
  assert.equal(assignment.examinerId, replacement.id);
  assert.equal(assignment.slot, 1);
  assert.equal(assignment.status, "ASSIGNED");

  const repeat = await request("POST", path, admin.id, { examinerId: replacement.id, reason: "Examiner on leave" });
  assert.equal((await repeat.json()).data.outcome, "ALREADY_APPLIED");
  const history = await prisma.examinerAssignmentReassignment.findMany({ where: { assignmentId: assignments[0].id } });
  assert.equal(history.length, 1);
  assert.equal(history[0].previousExaminerId, first.id);
  assert.equal(history[0].newExaminerId, replacement.id);
  assert.equal(history[0].actingAdminId, admin.id);
  assert.equal(history[0].reason, "ADMIN_REASSIGNMENT");
  assert.equal(history[0].note, "Examiner on leave");

  // Work the Examiner has touched stays with them.
  const score = { rubric: { pronunciation: 4, fluency: 4, vocabulary: 4, grammar: 4 }, overall: 4 };
  assert.equal((await request("PUT", `/examiner/assignments/${assignments[1].id}/score`, second.id, score)).status, 200);
  const touched = await request("POST", `/admin/assignments/${assignments[1].id}/reassign`, admin.id, {
    examinerId: first.id,
    reason: "Workload",
  });
  assert.equal(touched.status, 409);
  assert.equal((await touched.json()).code, "NOT_REASSIGNABLE");

  const detail = (await (await request("GET", `/admin/submissions/${submission.id}`, admin.id)).json()).data;
  const [slotOne, slotTwo] = detail.assignments;
  assert.equal(slotOne.reassignable, true);
  assert.equal(slotOne.reassignmentHistory.length, 1);
  assert.equal(slotOne.reassignmentHistory[0].previousExaminerName, first.username);
  assert.equal(slotOne.reassignmentHistory[0].newExaminerName, replacement.username);
  assert.equal(slotTwo.reassignable, false);

  // A started assignment is not untouched either.
  assert.equal((await request("PUT", `/examiner/assignments/${assignments[0].id}/start`, replacement.id)).status, 200);
  assert.equal(
    (await request("POST", path, admin.id, { examinerId: first.id, reason: "Workload" })).status,
    409,
  );
});

test("the dashboard queues list open flags and ambiguous payment outcomes", async () => {
  const student = await user("STUDENT");
  const admin = await user("ADMIN");
  const hoursAgo = (hours: number) => new Date(Date.now() - hours * 60 * 60 * 1000);
  const payment = (submissionId: string, data: Partial<Prisma.PaymentUncheckedCreateInput>) =>
    prisma.payment.create({
      data: {
        submissionId,
        amount: 50000,
        provider: "ipaymu",
        merchantReference: `FC-PAY-${crypto.randomUUID()}`,
        ...data,
      },
    });

  const awaiting = (await recordedSubmission(student.id)).submission;
  await prisma.submission.update({ where: { id: awaiting.id }, data: { status: "AWAITING_PAYMENT" } });
  const unconfirmed = await payment(awaiting.id, { createdAt: hoursAgo(2) });
  const noOutcome = await payment(awaiting.id, { createdAt: hoursAgo(3), providerSessionId: crypto.randomUUID() });
  const fresh = await payment(awaiting.id, {});

  const doublePaid = (await recordedSubmission(student.id)).submission;
  await prisma.submission.update({ where: { id: doublePaid.id }, data: { status: "PAID" } });
  const paidTwice = [
    await payment(doublePaid.id, { status: "PAID", paidAt: new Date(), providerTransactionId: "111" + Date.now() }),
    await payment(doublePaid.id, { status: "PAID", paidAt: new Date(), providerTransactionId: "222" + Date.now() }),
  ];

  const waived = (await recordedSubmission(student.id)).submission;
  await prisma.submission.update({ where: { id: waived.id }, data: { status: "PAID", paymentRequired: false } });
  const paidAnyway = await payment(waived.id, { status: "PAID", paidAt: new Date(), providerTransactionId: "333" + Date.now() });

  const flagged = (await recordedSubmission(student.id)).submission;
  await prisma.submission.update({ where: { id: flagged.id }, data: { status: "FLAG_REVIEW" } });
  const flag = await prisma.submissionFlag.create({
    data: { submissionId: flagged.id, type: "CAMERA_DROP", source: "STUDENT_DEVICE", reason: "Camera ended" },
  });

  assert.equal((await request("GET", "/admin/queues", student.id)).status, 403);
  const data = await queues(admin.id);
  const reasons = new Map<string, string[]>();
  for (const item of data.paymentReconciliation.items) {
    reasons.set(item.paymentId, [...(reasons.get(item.paymentId) ?? []), item.reason]);
  }
  assert.deepEqual(reasons.get(unconfirmed.id), ["CHECKOUT_UNCONFIRMED"]);
  assert.deepEqual(reasons.get(noOutcome.id), ["NO_PROVIDER_OUTCOME"]);
  assert.equal(reasons.get(fresh.id), undefined, "a recent checkout still has time to settle");
  for (const paid of paidTwice) assert.deepEqual(reasons.get(paid.id), ["DUPLICATE_PAYMENT"]);
  assert.deepEqual(reasons.get(paidAnyway.id), ["PAID_WHILE_WAIVED"]);

  const queuedFlag = data.openFlags.items.find((item: { id: string }) => item.id === flag.id);
  assert.equal(queuedFlag.submissionId, flagged.id);
  assert.equal(queuedFlag.studentName, student.username);
  assert.ok(data.openFlags.total >= 1);
  assert.ok(
    !data.assignmentReady.items.some((item: { submissionId: string }) => item.submissionId === flagged.id),
    "a Submission in flag review is never Assignment-ready",
  );
});
