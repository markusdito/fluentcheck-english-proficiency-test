import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { after, before, beforeEach, test } from "node:test";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import type { Prisma, PrismaClient, Role } from "../../src/generated/client.js";

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
  process.env.JWT_SECRET = "account-transition-integration-secret";
  process.env.FRONTEND_URL = "https://fluentcheck.example.test";
  process.env.R2_ACCOUNT_ID = "account-transition-test-account";
  process.env.R2_ACCESS_KEY_ID = "account-transition-test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "account-transition-test-secret-key";
  process.env.R2_BUCKET_NAME = "account-transition-test-bucket";

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
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE "ExaminerAssignmentReassignment"`);
  await prisma.examinerAssignment.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "ManifestEntry_immutable" ON "ManifestEntry"`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "ManifestTask_immutable" ON "ManifestTask"`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "SubmissionManifest_immutable" ON "SubmissionManifest"`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "ManifestEntry_v1_shape_check" ON "ManifestEntry"`);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "SubmissionManifest_v1_shape_check" ON "SubmissionManifest"`);
  await prisma.answer.deleteMany();
  await prisma.$executeRawUnsafe(`DELETE FROM "ManifestTask"`);
  await prisma.$executeRawUnsafe(`DELETE FROM "ManifestEntry"`);
  await prisma.$executeRawUnsafe(`DELETE FROM "SubmissionManifest"`);
  await prisma.submission.deleteMany();
  await prisma.user.updateMany({
    where: { deletedAt: null },
    data: { deletedAt: new Date() },
  });
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER "SubmissionManifest_v1_shape_check" AFTER INSERT OR UPDATE ON "SubmissionManifest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_submission_manifest_v1_shape()`);
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER "ManifestEntry_v1_shape_check" AFTER INSERT OR UPDATE OR DELETE ON "ManifestEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_submission_manifest_v1_shape()`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "SubmissionManifest_immutable" BEFORE UPDATE OR DELETE ON "SubmissionManifest" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "ManifestEntry_immutable" BEFORE UPDATE OR DELETE ON "ManifestEntry" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "ManifestTask_immutable" BEFORE UPDATE OR DELETE ON "ManifestTask" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()`);
});

after(async () => {
  server.close();
  await once(server, "close");
  await disconnectDB();
  await container.stop();
}, { timeout: 120_000 });

function uniqueUsername(prefix: string) {
  const safePrefix = prefix.replace(/[^a-z0-9_]/giu, "_").slice(0, 17);
  return `${safePrefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

async function createUser(
  prefix: string,
  role: Role = "STUDENT",
) {
  const username = uniqueUsername(prefix);
  const email = `${username}@example.test`;
  return prisma.user.create({
    data: {
      username,
      email,
      normalizedEmail: email,
      password: await bcrypt.hash("password", 10),
      role,
    },
  });
}

function cookieFor(userId: string) {
  return `jwt=${jwt.sign({ id: userId }, process.env.JWT_SECRET!)}`;
}

async function requestRole(
  targetId: string,
  role: string,
  actorCookie: string,
  reassignmentMap?: Record<string, string>,
) {
  return fetch(`${baseUrl}/api/admin/users/${targetId}/role`, {
    method: "PUT",
    headers: {
      Cookie: actorCookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role, ...(reassignmentMap ? { reassignmentMap } : {}) }),
  });
}

async function createLegacyScoringAssignment(
  examinerId: string,
  secondExaminerId: string,
) {
  const student = await createUser("student", "STUDENT");
  const { submission, answers } = await createManifestSubmission(
    student.id,
    "SCORING",
  );
  const assignments = await prisma.examinerAssignment.createManyAndReturn({
    data: [
      { submissionId: submission.id, examinerId, slot: 1, status: "ASSIGNED" },
      { submissionId: submission.id, examinerId: secondExaminerId, slot: 2, status: "ASSIGNED" },
    ],
  });

  return { answers, assignments };
}

async function createManifestSubmission(
  studentId: string,
  status: "PAID" | "SCORING",
) {
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const submission = await tx.submission.create({
      data: {
        studentId,
        status,
        scoringSystem: "LEGACY_100",
        paymentRequired: false,
      },
    });
    const manifest = await tx.submissionManifest.create({
      data: { submissionId: submission.id, version: 1 },
    });
    const answers = [];
    for (const [index, category] of (["PART_1", "PART_2", "PART_3"] as const).entries()) {
      const question = await tx.question.create({
        data: {
          category,
          order: Math.floor(Math.random() * 1_000_000),
          preparationSeconds: 30,
          recordingSeconds: 120,
        },
      });
      const entry = await tx.manifestEntry.create({
        data: {
          manifestId: manifest.id,
          submissionId: submission.id,
          category,
          deliveryPosition: index + 1,
          preparationSeconds: 30,
          recordingSeconds: 120,
          promptMediaStorageKey: `questions/${question.id}/prompt.mp3`,
          promptMediaMimeType: "audio/mpeg",
          promptMediaSizeBytes: 10,
          sourceQuestionId: question.id,
        },
      });
      answers.push(await tx.answer.create({
        data: {
          submissionId: submission.id,
          manifestEntryId: entry.id,
          storageKey: `unused/${entry.id}`,
          uploadStatus: "PENDING",
        },
      }));
    }
    return { submission, answers };
  });
}

test("role transitions reject invalid, missing, and self targets with stable errors", async () => {
  const admin = await createUser("admin", "ADMIN");
  const target = await createUser("target");
  const cookie = cookieFor(admin.id);

  const invalid = await requestRole(target.id, "OWNER", cookie);
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), {
    error: "Role must be one of STUDENT, EXAMINER, ADMIN",
    code: "INVALID_ROLE",
  });

  const missingId = crypto.randomUUID();
  const missing = await requestRole(missingId, "EXAMINER", cookie);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {
    error: "User not found",
    code: "USER_NOT_FOUND",
    userId: missingId,
  });

  const self = await requestRole(admin.id, "STUDENT", cookie);
  assert.equal(self.status, 400);
  assert.deepEqual(await self.json(), {
    error: "Cannot change your own role",
    code: "SELF_ROLE_CHANGE",
  });
});

test("a valid demotion commits and replaying the desired role is explicit", async () => {
  const admin = await createUser("admin", "ADMIN");
  const target = await createUser("target", "ADMIN");
  const cookie = cookieFor(admin.id);

  const updated = await requestRole(target.id, "EXAMINER", cookie);
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).data.outcome, "UPDATED");

  const replay = await requestRole(target.id, "EXAMINER", cookie);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).data.outcome, "ALREADY_APPLIED");
});

test("supported role transitions cover the complete role matrix", async () => {
  const admin = await createUser("admin", "ADMIN");
  const target = await createUser("target", "STUDENT");
  const roles = ["ADMIN", "EXAMINER", "ADMIN", "STUDENT", "EXAMINER", "STUDENT"];

  for (const role of roles) {
    const response = await requestRole(target.id, role, cookieFor(admin.id));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).data.outcome, "UPDATED");
  }
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role,
    "STUDENT",
  );
});

test("admin user listing exposes active state for deactivated accounts", async () => {
  const admin = await createUser("admin", "ADMIN");
  const active = await createUser("active", "STUDENT");
  const deactivated = await createUser("deactivated", "STUDENT");
  await prisma.user.update({
    where: { id: deactivated.id },
    data: { deletedAt: new Date() },
  });

  const response = await fetch(`${baseUrl}/api/admin/users?limit=20`, {
    headers: { Cookie: cookieFor(admin.id) },
  });
  assert.equal(response.status, 200);
  const payload = await response.json();
  const users = payload.data.items as Array<{ id: string; deletedAt: string | null }>;
  assert.equal(users.find((user) => user.id === active.id)?.deletedAt, null);
  assert.ok(users.find((user) => user.id === deactivated.id)?.deletedAt);
});

test("concurrent demotions cannot remove every active administrator", async () => {
  const firstTarget = await createUser("first_target", "ADMIN");
  const secondTarget = await createUser("second_target", "ADMIN");

  const responses = await Promise.all([
    requestRole(firstTarget.id, "EXAMINER", cookieFor(secondTarget.id)),
    requestRole(secondTarget.id, "STUDENT", cookieFor(firstTarget.id)),
  ]);
  const outcomes = await Promise.all(
    responses.map(async (response) => ({
      status: response.status,
      payload: await response.json(),
    })),
  );

  assert.equal(outcomes.filter(({ status }) => status === 200).length, 1);
  assert.ok(outcomes.some(({ status }) => status === 403 || status === 409));
  assert.equal(
    await prisma.user.count({ where: { role: "ADMIN", deletedAt: null } }),
    1,
  );
});

test("non-admin callers cannot execute a role transition", async () => {
  const student = await createUser("student", "STUDENT");
  const target = await createUser("target");

  const response = await requestRole(target.id, "EXAMINER", cookieFor(student.id));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Insufficient permissions" });
});

test("an Examiner promoted to ADMIN keeps access to existing work while new assignment selection excludes ADMIN", async () => {
  const admin = await createUser("admin", "ADMIN");
  const promoted = await createUser("promoted", "EXAMINER");
  const secondExaminer = await createUser("second_examiner", "EXAMINER");
  const thirdExaminer = await createUser("third_examiner", "EXAMINER");
  const { answers, assignments } = await createLegacyScoringAssignment(
    promoted.id,
    secondExaminer.id,
  );

  const promotion = await requestRole(
    promoted.id,
    "ADMIN",
    cookieFor(admin.id),
  );
  assert.equal(promotion.status, 200);

  const promotedCookie = cookieFor(promoted.id);
  const workList = await fetch(`${baseUrl}/api/examiner/assignments`, {
    headers: { Cookie: promotedCookie },
  });
  assert.equal(workList.status, 200);
  assert.equal((await workList.json()).data[0].id, assignments[0].id);

  const detail = await fetch(
    `${baseUrl}/api/examiner/assignments/${assignments[0].id}`,
    { headers: { Cookie: promotedCookie } },
  );
  assert.equal(detail.status, 200);

  for (const answer of answers) {
    const score = await fetch(
      `${baseUrl}/api/examiner/assignments/${assignments[0].id}/scores/${answer.id}`,
      {
        method: "PUT",
        headers: {
          Cookie: promotedCookie,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ value: 88 }),
      },
    );
    assert.equal(score.status, 200);
  }

  const completion = await fetch(
    `${baseUrl}/api/examiner/assignments/${assignments[0].id}/complete`,
    { method: "POST", headers: { Cookie: promotedCookie } },
  );
  assert.equal(completion.status, 200);
  assert.equal(
    (await prisma.examinerAssignment.findUniqueOrThrow({ where: { id: assignments[0].id } })).status,
    "COMPLETED",
  );

  const nextStudent = await createUser("next_student", "STUDENT");
  const { submission: nextSubmission } = await createManifestSubmission(
    nextStudent.id,
    "PAID",
  );
  const assignmentSet = await import("../../src/service/examiner.service.js");
  const result = await assignmentSet.createExaminerAssignmentSet(nextSubmission.id, {
    selectCandidates: (ids) => {
      const eligible = ids.filter((id) => id !== promoted.id).sort();
      return [eligible[0], eligible[1]];
    },
  });
  assert.equal(result.outcome, "CREATED");
  assert.equal(
    result.assignedExaminers.some((examiner) => examiner.id === promoted.id),
    false,
  );
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: promoted.id } })).role,
    "ADMIN",
  );
  assert.equal(thirdExaminer.role, "EXAMINER");
});

test("role-transition preview drives an exact reassignment and replay is idempotent", async () => {
  const admin = await createUser("admin", "ADMIN");
  const target = await createUser("target", "EXAMINER");
  const currentPeer = await createUser("current_peer", "EXAMINER");
  const replacement = await createUser("replacement", "EXAMINER");
  const { answers, assignments } = await createLegacyScoringAssignment(
    target.id,
    currentPeer.id,
  );
  const before = await prisma.examinerAssignment.findUniqueOrThrow({
    where: { id: assignments[0].id },
  });

  const previewResponse = await fetch(
    `${baseUrl}/api/admin/users/${target.id}/role-transition-preview?role=STUDENT`,
    { headers: { Cookie: cookieFor(admin.id) } },
  );
  assert.equal(previewResponse.status, 200);
  const preview = (await previewResponse.json()).data;
  assert.equal(preview.requestedRole, "STUDENT");
  assert.equal(preview.assignments.length, 1);
  assert.equal(preview.assignments[0].transferEligible, true);
  assert.equal(preview.assignments[0].currentExaminer.id, target.id);
  assert.equal(
    preview.assignments[0].candidates.some(
      (candidate: { id: string }) => candidate.id === replacement.id,
    ),
    true,
  );
  assert.equal(
    preview.assignments[0].candidates.some(
      (candidate: { id: string }) => candidate.id === currentPeer.id,
    ),
    false,
  );

  const reassignmentMap = { [assignments[0].id]: replacement.id };
  const updated = await requestRole(
    target.id,
    "STUDENT",
    cookieFor(admin.id),
    reassignmentMap,
  );
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).data.outcome, "UPDATED");

  const after = await prisma.examinerAssignment.findUniqueOrThrow({
    where: { id: assignments[0].id },
  });
  assert.deepEqual(
    {
      id: after.id,
      submissionId: after.submissionId,
      slot: after.slot,
      status: after.status,
      createdAt: after.createdAt.toISOString(),
    },
    {
      id: before.id,
      submissionId: before.submissionId,
      slot: before.slot,
      status: before.status,
      createdAt: before.createdAt.toISOString(),
    },
  );
  assert.equal(after.examinerId, replacement.id);
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role, "STUDENT");

  const history = await prisma.examinerAssignmentReassignment.findMany({
    where: { assignmentId: assignments[0].id },
  });
  assert.equal(history.length, 1);
  assert.equal(history[0].previousExaminerId, target.id);
  assert.equal(history[0].newExaminerId, replacement.id);
  assert.equal(history[0].actingAdminId, admin.id);
  assert.equal(history[0].reason, "ACCOUNT_ROLE_TRANSITION");

  const replay = await requestRole(
    target.id,
    "STUDENT",
    cookieFor(admin.id),
    reassignmentMap,
  );
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).data.outcome, "ALREADY_APPLIED");
  assert.equal(
    await prisma.examinerAssignmentReassignment.count({
      where: { assignmentId: assignments[0].id },
    }),
    1,
  );

  const replacementList = await fetch(`${baseUrl}/api/examiner/assignments`, {
    headers: { Cookie: cookieFor(replacement.id) },
  });
  assert.equal(replacementList.status, 200);
  assert.equal((await replacementList.json()).data[0].id, assignments[0].id);

  const oldOwnerList = await fetch(`${baseUrl}/api/examiner/assignments`, {
    headers: { Cookie: cookieFor(target.id) },
  });
  assert.equal(oldOwnerList.status, 403);
  assert.deepEqual(await oldOwnerList.json(), { error: "Insufficient permissions" });

  const start = await fetch(
    `${baseUrl}/api/examiner/assignments/${assignments[0].id}/start`,
    { method: "PUT", headers: { Cookie: cookieFor(replacement.id) } },
  );
  assert.equal(start.status, 200);
  const score = await fetch(
    `${baseUrl}/api/examiner/assignments/${assignments[0].id}/scores/${answers[0].id}`,
    {
      method: "PUT",
      headers: {
        Cookie: cookieFor(replacement.id),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ value: 91 }),
    },
  );
  assert.equal(score.status, 200);
});

test("invalid reassignment maps fail atomically without changing role or ownership", async () => {
  const admin = await createUser("admin", "ADMIN");
  const target = await createUser("target", "EXAMINER");
  const currentPeer = await createUser("current_peer", "EXAMINER");
  const { assignments } = await createLegacyScoringAssignment(
    target.id,
    currentPeer.id,
  );

  const response = await requestRole(
    target.id,
    "STUDENT",
    cookieFor(admin.id),
    { [assignments[0].id]: currentPeer.id },
  );
  assert.equal(response.status, 400);
  assert.equal((await response.json()).code, "INVALID_REASSIGNMENT");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role, "EXAMINER");
  assert.equal(
    (await prisma.examinerAssignment.findUniqueOrThrow({ where: { id: assignments[0].id } })).examinerId,
    target.id,
  );
  assert.equal(await prisma.examinerAssignmentReassignment.count(), 0);
});

test("reassignment replays require the complete map and reject stale owners", async () => {
  const admin = await createUser("admin", "ADMIN");
  const target = await createUser("target", "EXAMINER");
  const currentPeer = await createUser("current_peer", "EXAMINER");
  const firstReplacement = await createUser("first_replacement", "EXAMINER");
  const secondReplacement = await createUser("second_replacement", "EXAMINER");
  const sequentialReplacement = await createUser("sequential_replacement", "EXAMINER");
  const laterReplacement = await createUser("later_replacement", "EXAMINER");
  const first = await createLegacyScoringAssignment(target.id, currentPeer.id);
  const second = await createLegacyScoringAssignment(target.id, currentPeer.id);
  const assignmentMap = {
    [first.assignments[0].id]: firstReplacement.id,
    [second.assignments[0].id]: secondReplacement.id,
  };

  const updated = await requestRole(
    target.id,
    "STUDENT",
    cookieFor(admin.id),
    assignmentMap,
  );
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).data.outcome, "UPDATED");

  const partialReplay = await requestRole(
    target.id,
    "STUDENT",
    cookieFor(admin.id),
    { [first.assignments[0].id]: firstReplacement.id },
  );
  assert.equal(partialReplay.status, 400);
  assert.equal((await partialReplay.json()).code, "INVALID_REASSIGNMENT");
  assert.equal(await prisma.examinerAssignmentReassignment.count(), 2);

  const sequential = await requestRole(
    firstReplacement.id,
    "STUDENT",
    cookieFor(admin.id),
    { [first.assignments[0].id]: sequentialReplacement.id },
  );
  assert.equal(sequential.status, 200);
  assert.equal((await sequential.json()).data.outcome, "UPDATED");

  const promote = await requestRole(
    target.id,
    "EXAMINER",
    cookieFor(admin.id),
  );
  assert.equal(promote.status, 200);
  const later = await createLegacyScoringAssignment(target.id, currentPeer.id);
  const laterMap = { [later.assignments[0].id]: laterReplacement.id };
  const laterUpdated = await requestRole(
    target.id,
    "STUDENT",
    cookieFor(admin.id),
    laterMap,
  );
  assert.equal(laterUpdated.status, 200);
  assert.equal((await laterUpdated.json()).data.outcome, "UPDATED");

  const laterReplay = await requestRole(
    target.id,
    "STUDENT",
    cookieFor(admin.id),
    laterMap,
  );
  assert.equal(laterReplay.status, 200);
  assert.equal((await laterReplay.json()).data.outcome, "ALREADY_APPLIED");

  const staleReplay = await requestRole(
    target.id,
    "STUDENT",
    cookieFor(admin.id),
    assignmentMap,
  );
  assert.equal(staleReplay.status, 409);
  assert.equal((await staleReplay.json()).code, "REASSIGNMENT_CONFLICT");
  assert.equal(await prisma.examinerAssignmentReassignment.count(), 4);
});

test("capability removal fails closed for malformed assignment sets", async () => {
  const admin = await createUser("admin", "ADMIN");
  const target = await createUser("target", "EXAMINER");
  const currentPeer = await createUser("current_peer", "EXAMINER");
  const { assignments } = await createLegacyScoringAssignment(
    target.id,
    currentPeer.id,
  );
  await prisma.examinerAssignment.delete({ where: { id: assignments[1].id } });

  const response = await requestRole(target.id, "STUDENT", cookieFor(admin.id));
  assert.equal(response.status, 409);
  const body = await response.json();
  assert.equal(body.code, "REASSIGNMENT_CONFLICT");
  assert.deepEqual(body.assignmentIds, [assignments[0].id]);
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role,
    "EXAMINER",
  );
  assert.equal(await prisma.examinerAssignmentReassignment.count(), 0);
});

test("replacement maps reject missing, extra, duplicate, deleted, and non-Examiner targets", async () => {
  const admin = await createUser("admin", "ADMIN");
  const target = await createUser("target", "EXAMINER");
  const currentPeer = await createUser("current_peer", "EXAMINER");
  const replacement = await createUser("replacement", "EXAMINER");
  const deletedReplacement = await createUser("deleted_replacement", "EXAMINER");
  const studentReplacement = await createUser("student_replacement", "STUDENT");
  const { assignments } = await createLegacyScoringAssignment(
    target.id,
    currentPeer.id,
  );
  await prisma.user.update({
    where: { id: deletedReplacement.id },
    data: { deletedAt: new Date() },
  });

  const invalidMaps = [
    undefined,
    { [assignments[0].id]: crypto.randomUUID() },
    { [assignments[0].id]: deletedReplacement.id },
    { [assignments[0].id]: studentReplacement.id },
  ];
  for (const reassignmentMap of invalidMaps) {
    const response = await requestRole(
      target.id,
      "STUDENT",
      cookieFor(admin.id),
      reassignmentMap,
    );
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, "INVALID_REASSIGNMENT");
  }

  const second = await createLegacyScoringAssignment(target.id, currentPeer.id);
  const duplicateTarget = await requestRole(
    target.id,
    "STUDENT",
    cookieFor(admin.id),
    {
      [assignments[0].id]: replacement.id,
      [second.assignments[0].id]: replacement.id,
    },
  );
  assert.equal(duplicateTarget.status, 400);
  assert.equal((await duplicateTarget.json()).code, "INVALID_REASSIGNMENT");
  assert.equal(await prisma.examinerAssignmentReassignment.count(), 0);
});

test("in-progress and score-bearing assignments fail closed during capability removal", async () => {
  const admin = await createUser("admin", "ADMIN");
  const inProgressTarget = await createUser("in_progress_target", "EXAMINER");
  const inProgressPeer = await createUser("in_progress_peer", "EXAMINER");
  const inProgress = await createLegacyScoringAssignment(
    inProgressTarget.id,
    inProgressPeer.id,
  );
  await prisma.examinerAssignment.update({
    where: { id: inProgress.assignments[0].id },
    data: { status: "IN_PROGRESS" },
  });

  const inProgressResponse = await requestRole(
    inProgressTarget.id,
    "STUDENT",
    cookieFor(admin.id),
  );
  assert.equal(inProgressResponse.status, 409);
  assert.equal((await inProgressResponse.json()).code, "EXAMINER_ASSIGNMENTS_IN_PROGRESS");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: inProgressTarget.id } })).role, "EXAMINER");

  const scoredTarget = await createUser("scored_target", "EXAMINER");
  const scoredPeer = await createUser("scored_peer", "EXAMINER");
  const scored = await createLegacyScoringAssignment(scoredTarget.id, scoredPeer.id);
  await prisma.score.create({
    data: {
      assignmentId: scored.assignments[0].id,
      answerId: scored.answers[0].id,
      value: 88,
    },
  });

  const scoredResponse = await requestRole(
    scoredTarget.id,
    "STUDENT",
    cookieFor(admin.id),
  );
  assert.equal(scoredResponse.status, 409);
  assert.equal((await scoredResponse.json()).code, "EXAMINER_HAS_OPEN_ASSIGNMENTS");
  assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: scoredTarget.id } })).role, "EXAMINER");
  assert.equal(await prisma.examinerAssignmentReassignment.count(), 0);
});

test("the shared deactivation boundary transfers eligible work and replays safely", async () => {
  const admin = await createUser("admin", "ADMIN");
  const target = await createUser("target", "EXAMINER");
  const currentPeer = await createUser("current_peer", "EXAMINER");
  const replacement = await createUser("replacement", "EXAMINER");
  const { assignments } = await createLegacyScoringAssignment(target.id, currentPeer.id);
  const { deactivateAccount } = await import("../../src/service/accountTransition.service.js");
  const reassignmentMap = { [assignments[0].id]: replacement.id };

  const result = await deactivateAccount(target.id, admin.id, { reassignmentMap });
  assert.equal(result.outcome, "UPDATED");
  assert.equal(result.assignments.length, 1);
  const deactivated = await prisma.user.findUniqueOrThrow({ where: { id: target.id } });
  assert.equal(deactivated.role, "EXAMINER");
  assert.ok(deactivated.deletedAt);
  assert.equal(
    (await prisma.examinerAssignment.findUniqueOrThrow({ where: { id: assignments[0].id } })).examinerId,
    replacement.id,
  );
  const history = await prisma.examinerAssignmentReassignment.findFirstOrThrow({
    where: { assignmentId: assignments[0].id },
  });
  assert.equal(history.reason, "ACCOUNT_DEACTIVATION");
  await assert.rejects(
    prisma.examinerAssignmentReassignment.update({
      where: { id: history.id },
      data: { reason: "tampered" },
    }),
    /immutable/,
  );
  await assert.rejects(
    prisma.examinerAssignmentReassignment.delete({ where: { id: history.id } }),
    /immutable/,
  );

  const replay = await deactivateAccount(target.id, admin.id, { reassignmentMap });
  assert.equal(replay.outcome, "ALREADY_APPLIED");
  assert.equal(await prisma.examinerAssignmentReassignment.count(), 1);
});

test("concurrent deactivations cannot remove every active administrator", async () => {
  const firstAdmin = await createUser("first_admin", "ADMIN");
  const secondAdmin = await createUser("second_admin", "ADMIN");
  const { deactivateAccount } = await import("../../src/service/accountTransition.service.js");

  const results = await Promise.allSettled([
    deactivateAccount(firstAdmin.id, secondAdmin.id),
    deactivateAccount(secondAdmin.id, firstAdmin.id),
  ]);

  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
  );
  assert.equal(
    await prisma.user.count({ where: { role: "ADMIN", deletedAt: null } }),
    1,
  );
});

test("deactivating the final active administrator returns a stable conflict", async () => {
  const admin = await createUser("admin", "ADMIN");
  const { AccountTransitionError, deactivateAccount } = await import(
    "../../src/service/accountTransition.service.js"
  );

  await assert.rejects(
    deactivateAccount(admin.id, admin.id),
    (error: unknown) => {
      assert.ok(error instanceof AccountTransitionError);
      assert.equal(error.code, "LAST_ACTIVE_ADMIN");
      return true;
    },
  );
  const unchanged = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
  assert.equal(unchanged.role, "ADMIN");
  assert.equal(unchanged.deletedAt, null);
});

test("assignment start and account deactivation serialize on ownership", async () => {
  const admin = await createUser("admin", "ADMIN");
  const target = await createUser("target", "EXAMINER");
  const currentPeer = await createUser("current_peer", "EXAMINER");
  const replacement = await createUser("replacement", "EXAMINER");
  const { assignments } = await createLegacyScoringAssignment(target.id, currentPeer.id);
  const { AccountTransitionError, deactivateAccount } = await import(
    "../../src/service/accountTransition.service.js"
  );
  const { ScoringFinalizationError, startExaminerAssignment } = await import(
    "../../src/service/examiner.service.js"
  );

  const startAttempt = startExaminerAssignment(assignments[0].id, target.id);
  const transitionAttempt = deactivateAccount(target.id, admin.id, {
    reassignmentMap: { [assignments[0].id]: replacement.id },
  });
  const [startResult, transitionResult] = await Promise.allSettled([
    startAttempt,
    transitionAttempt,
  ]);

  if (transitionResult.status === "fulfilled") {
    assert.equal(startResult.status, "rejected");
    assert.ok(startResult.reason instanceof ScoringFinalizationError);
    assert.equal(startResult.reason.code, "UNAUTHORIZED");
    assert.equal(
      (await prisma.examinerAssignment.findUniqueOrThrow({ where: { id: assignments[0].id } })).examinerId,
      replacement.id,
    );
    assert.ok((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).deletedAt);
  } else {
    assert.equal(startResult.status, "fulfilled");
    assert.ok(transitionResult.reason instanceof AccountTransitionError);
    assert.equal(transitionResult.reason.code, "EXAMINER_ASSIGNMENTS_IN_PROGRESS");
    assert.equal(
      (await prisma.examinerAssignment.findUniqueOrThrow({ where: { id: assignments[0].id } })).status,
      "IN_PROGRESS",
    );
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role, "EXAMINER");
  }
});

test("score saving and account deactivation serialize on ownership", async () => {
  const admin = await createUser("admin", "ADMIN");
  const target = await createUser("target", "EXAMINER");
  const currentPeer = await createUser("current_peer", "EXAMINER");
  const replacement = await createUser("replacement", "EXAMINER");
  const { answers, assignments } = await createLegacyScoringAssignment(
    target.id,
    currentPeer.id,
  );
  const { AccountTransitionError, deactivateAccount } = await import(
    "../../src/service/accountTransition.service.js"
  );
  const { ScoringFinalizationError, saveExaminerScore } = await import(
    "../../src/service/examiner.service.js"
  );

  const [saveResult, transitionResult] = await Promise.allSettled([
    saveExaminerScore(assignments[0].id, target.id, {
      answerId: answers[0].id,
      value: 91,
    }),
    deactivateAccount(target.id, admin.id, {
      reassignmentMap: { [assignments[0].id]: replacement.id },
    }),
  ]);

  if (saveResult.status === "fulfilled") {
    assert.equal(transitionResult.status, "rejected");
    assert.ok(transitionResult.reason instanceof AccountTransitionError);
    assert.equal(transitionResult.reason.code, "EXAMINER_ASSIGNMENTS_IN_PROGRESS");
    assert.equal(
      (await prisma.examinerAssignment.findUniqueOrThrow({ where: { id: assignments[0].id } })).status,
      "IN_PROGRESS",
    );
  } else {
    assert.equal(transitionResult.status, "fulfilled");
    assert.ok(saveResult.reason instanceof ScoringFinalizationError);
    assert.equal(saveResult.reason.code, "UNAUTHORIZED");
    assert.equal(
      (await prisma.examinerAssignment.findUniqueOrThrow({ where: { id: assignments[0].id } })).examinerId,
      replacement.id,
    );
  }
});

test("bulk scoring and account transition serialize without stale finalization", async () => {
  const admin = await createUser("admin", "ADMIN");
  const target = await createUser("target", "EXAMINER");
  const currentPeer = await createUser("current_peer", "EXAMINER");
  const replacement = await createUser("replacement", "EXAMINER");
  const { answers, assignments } = await createLegacyScoringAssignment(
    target.id,
    currentPeer.id,
  );
  const { AccountTransitionError, transitionAccountRole } = await import(
    "../../src/service/accountTransition.service.js"
  );
  const { ScoringFinalizationError, submitExaminerScores } = await import(
    "../../src/service/examiner.service.js"
  );
  const scores = answers.map((answer) => ({ answerId: answer.id, value: 91 }));

  const [finalizeResult, transitionResult] = await Promise.allSettled([
    submitExaminerScores(assignments[0].id, target.id, scores),
    transitionAccountRole(target.id, admin.id, "STUDENT", {
      reassignmentMap: { [assignments[0].id]: replacement.id },
    }),
  ]);

  if (finalizeResult.status === "fulfilled") {
    assert.equal(transitionResult.status, "rejected");
    assert.ok(transitionResult.reason instanceof AccountTransitionError);
    assert.equal(transitionResult.reason.code, "INVALID_REASSIGNMENT");
    const assignment = await prisma.examinerAssignment.findUniqueOrThrow({ where: { id: assignments[0].id } });
    assert.equal(assignment.status, "COMPLETED");
    assert.equal(assignment.examinerId, target.id);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role, "EXAMINER");
  } else {
    assert.equal(transitionResult.status, "fulfilled");
    assert.ok(finalizeResult.reason instanceof ScoringFinalizationError);
    assert.equal(finalizeResult.reason.code, "UNAUTHORIZED");
    const assignment = await prisma.examinerAssignment.findUniqueOrThrow({ where: { id: assignments[0].id } });
    assert.equal(assignment.examinerId, replacement.id);
    assert.equal((await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role, "STUDENT");
  }
});

test("assignment creation and role removal share one candidate snapshot", async () => {
  const admin = await createUser("admin", "ADMIN");
  const target = await createUser("target", "EXAMINER");
  const peer = await createUser("peer", "EXAMINER");
  const student = await createUser("student", "STUDENT");
  const { submission } = await createManifestSubmission(student.id, "PAID");
  const { AccountTransitionError, transitionAccountRole } = await import(
    "../../src/service/accountTransition.service.js"
  );
  const { AssignmentSetError, createExaminerAssignmentSet } = await import(
    "../../src/service/examiner.service.js"
  );

  const [assignmentResult, transitionResult] = await Promise.allSettled([
    createExaminerAssignmentSet(submission.id, {
      selectCandidates: () => [target.id, peer.id],
    }),
    transitionAccountRole(target.id, admin.id, "STUDENT"),
  ]);

  if (assignmentResult.status === "fulfilled") {
    assert.equal(transitionResult.status, "rejected");
    assert.ok(transitionResult.reason instanceof AccountTransitionError);
    assert.equal(transitionResult.reason.code, "INVALID_REASSIGNMENT");
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role,
      "EXAMINER",
    );
    assert.equal(
      await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
      2,
    );
  } else {
    assert.equal(transitionResult.status, "fulfilled");
    assert.ok(assignmentResult.reason instanceof AssignmentSetError);
    assert.equal(assignmentResult.reason.code, "INSUFFICIENT_CAPACITY");
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: target.id } })).role,
      "STUDENT",
    );
    assert.equal(
      await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
      0,
    );
  }
});
