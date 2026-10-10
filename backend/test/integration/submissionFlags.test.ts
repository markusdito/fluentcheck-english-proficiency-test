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
  process.env.R2_BUCKET_NAME = "flag-test-bucket";
  process.env.R2_ACCOUNT_ID = "flag-test-account";
  process.env.R2_ACCESS_KEY_ID = "flag-test-key";
  process.env.R2_SECRET_ACCESS_KEY = "flag-test-secret";
  process.env.JWT_SECRET = "flag-test-secret";
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
  if (!address || typeof address === "string") throw new Error("Flag test server did not bind");
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

test("a flag raised during the test goes to review before payment; confirming voids it and the next Submission is free", async () => {
  const student = await user("STUDENT");
  const other = await user("STUDENT");
  const admin = await user("ADMIN");
  const { submission, entries } = await recordedSubmission(student.id);

  const flagged = await request("POST", `/submissions/${submission.id}/flags`, student.id, {
    type: "CAMERA_DROP",
    reason: "Camera track ended while recording",
    manifestEntryId: entries[2].id,
  });
  assert.equal(flagged.status, 201);
  assert.equal(
    (await request("POST", `/submissions/${submission.id}/flags`, other.id, { type: "CAMERA_DROP", reason: "x" })).status,
    404,
    "only the owner can flag",
  );

  assert.equal((await request("POST", `/submissions/${submission.id}/complete`, student.id)).status, 200);
  assert.equal(await status(submission.id), "FLAG_REVIEW");
  assert.equal(await prisma.payment.count({ where: { submissionId: submission.id } }), 0);

  // Open flags block assignment.
  const assign = await request("POST", `/admin/submissions/${submission.id}/assign`, admin.id);
  assert.equal(assign.status, 409);
  assert.equal((await assign.json()).code, "NOT_ASSIGNMENT_READY");

  const queue = (await (await request("GET", "/admin/flags", admin.id)).json()).data;
  const queued = queue.find((flag: { submissionId: string }) => flag.submissionId === submission.id);
  assert.equal(queued.type, "CAMERA_DROP");
  assert.equal(queued.slot, "PART_2");
  assert.equal(typeof queued.videoUrl, "string", "the flagged slot's Answer video is the evidence");

  assert.equal((await request("POST", `/admin/flags/${queued.id}/confirm`, student.id, { note: "x" })).status, 403);
  assert.equal((await request("POST", `/admin/flags/${queued.id}/confirm`, admin.id, {})).status, 400);
  const confirmed = await request("POST", `/admin/flags/${queued.id}/confirm`, admin.id, {
    note: "Camera was off for most of Part 2",
  });
  assert.equal(confirmed.status, 200);
  assert.equal(await status(submission.id), "VOIDED");
  assert.equal(
    (await request("POST", `/admin/flags/${queued.id}/dismiss`, admin.id, { note: "again" })).status,
    409,
  );

  const audited = await prisma.submissionFlag.findUniqueOrThrow({ where: { id: queued.id } });
  assert.equal(audited.resolution, "CONFIRMED");
  assert.equal(audited.resolvedById, admin.id);
  assert.ok(audited.resolvedAt);

  const detail = (await (await request("GET", `/submissions/${submission.id}`, student.id)).json()).data;
  assert.equal(detail.status, "VOIDED");
  assert.equal(detail.voidReason, "Camera was off for most of Part 2");
  assert.equal(detail.retakeCreditAvailable, true);
  const dashboard = (await (await request("GET", "/submissions", student.id)).json()).data;
  assert.equal(dashboard.retakeCreditAvailable, true);

  // The credit is not transferable: another student still pays.
  const othersAttempt = await recordedSubmission(other.id);
  await request("POST", `/submissions/${othersAttempt.submission.id}/complete`, other.id);
  assert.equal(await status(othersAttempt.submission.id), "AWAITING_PAYMENT");

  // The student's next Submission skips payment through the credit.
  const retake = await recordedSubmission(student.id);
  await request("POST", `/submissions/${retake.submission.id}/complete`, student.id);
  const retaken = await prisma.submission.findUniqueOrThrow({ where: { id: retake.submission.id } });
  assert.equal(retaken.status, "PAID", "no Eligible examiners yet, so it waits Assignment-ready");
  assert.equal(retaken.paymentRequired, false);
  const credit = await prisma.retakeCredit.findUniqueOrThrow({ where: { voidedSubmissionId: submission.id } });
  assert.equal(credit.redeemedSubmissionId, retake.submission.id);

  // One credit per voided Submission: the one after that pays again.
  const third = await recordedSubmission(student.id);
  await request("POST", `/submissions/${third.submission.id}/complete`, student.id);
  assert.equal(await status(third.submission.id), "AWAITING_PAYMENT");
  const after = (await (await request("GET", `/submissions/${submission.id}`, student.id)).json()).data;
  assert.equal(after.retakeCreditAvailable, false);

  // Voided Submissions cannot become a second credit.
  assert.equal(await prisma.retakeCredit.count({ where: { voidedSubmissionId: submission.id } }), 1);
});

test("dismissing a test-time flag returns the Submission to the payment flow", async () => {
  const student = await user("STUDENT");
  const admin = await user("ADMIN");
  const { submission } = await recordedSubmission(student.id);
  await request("POST", `/submissions/${submission.id}/flags`, student.id, {
    type: "TECHNICAL_FAILURE",
    reason: "Upload connection dropped",
  });
  await request("POST", `/submissions/${submission.id}/complete`, student.id);
  assert.equal(await status(submission.id), "FLAG_REVIEW");

  const flag = await prisma.submissionFlag.findFirstOrThrow({ where: { submissionId: submission.id } });
  const dismissed = await request("POST", `/admin/flags/${flag.id}/dismiss`, admin.id, {
    note: "Speech is complete; brief glitch",
  });
  assert.equal(dismissed.status, 200);
  assert.equal(await status(submission.id), "AWAITING_PAYMENT");
  assert.equal(await prisma.retakeCredit.count({ where: { voidedSubmissionId: submission.id } }), 0);
});

test("an Examiner integrity concern pauses scoring until an Admin decides", async () => {
  const student = await user("STUDENT");
  const admin = await user("ADMIN");
  const examiners = [await user("EXAMINER"), await user("EXAMINER")];
  const { submission } = await recordedSubmission(student.id);
  await prisma.submission.update({ where: { id: submission.id }, data: { status: "SCORING", paymentRequired: false } });
  const assignments = await Promise.all(
    examiners.map((examiner, index) =>
      prisma.examinerAssignment.create({
        data: { submissionId: submission.id, examinerId: examiner.id, slot: index + 1 },
      }),
    ),
  );
  const answer = await prisma.answer.findFirstOrThrow({ where: { submissionId: submission.id } });
  const score = { rubric: { pronunciation: 4, fluency: 4, vocabulary: 4, grammar: 4 }, overall: 4 };
  assert.equal((await request("PUT", `/examiner/assignments/${assignments[0].id}/score`, examiners[0].id, score)).status, 200);

  assert.equal(
    (await request("POST", `/examiner/assignments/${assignments[0].id}/integrity-concerns`, examiners[1].id, {
      answerId: answer.id,
      note: "x",
    })).status,
    403,
    "only the assigned Examiner can raise it",
  );
  const concern = await request("POST", `/examiner/assignments/${assignments[1].id}/integrity-concerns`, examiners[1].id, {
    answerId: answer.id,
    timestampSeconds: 42,
    note: "Someone else seems to be speaking",
  });
  assert.equal(concern.status, 201);
  assert.equal(await status(submission.id), "FLAG_REVIEW");

  // Open flags block scoring finalization.
  const blocked = await request("POST", `/examiner/assignments/${assignments[0].id}/complete`, examiners[0].id);
  assert.equal(blocked.status, 409);
  assert.equal((await blocked.json()).code, "OPEN_FLAG");

  const flag = await prisma.submissionFlag.findFirstOrThrow({ where: { submissionId: submission.id } });
  assert.equal(flag.source, "EXAMINER");
  assert.equal(flag.timestampSeconds, 42);
  await request("POST", `/admin/flags/${flag.id}/dismiss`, admin.id, { note: "Background TV only" });
  assert.equal(await status(submission.id), "SCORING");
  assert.equal((await request("POST", `/examiner/assignments/${assignments[0].id}/complete`, examiners[0].id)).status, 200);
});
