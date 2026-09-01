import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import { once } from "node:events";
import { promisify } from "node:util";
import { after, before, beforeEach, test } from "node:test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { PrismaClient } from "../../src/generated/client.js";
import type { StorageDeleteConfirmation } from "../../src/service/retentionStorage.service.js";

const execFileAsync = promisify(execFile);
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: () => Promise<void>;
let requestSubmissionPurge: typeof import("../../src/service/submissionRetention.service.js")["requestSubmissionPurge"];
let approveSubmissionPurge: typeof import("../../src/service/submissionRetention.service.js")["approveSubmissionPurge"];
let cancelSubmissionPurge: typeof import("../../src/service/submissionRetention.service.js")["cancelSubmissionPurge"];
let finalizeSubmissionPurge: typeof import("../../src/service/submissionRetention.service.js")["finalizeSubmissionPurge"];
let RetentionCleanupDisabledError: typeof import("../../src/service/submissionRetention.service.js")["RetentionCleanupDisabledError"];
let inventoryPromptMedia: typeof import("../../src/service/promptMediaCleanup.service.js")["inventoryPromptMedia"];
let runPromptMediaCleanup: typeof import("../../src/service/promptMediaCleanup.service.js")["runPromptMediaCleanup"];

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
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.JWT_SECRET = "retention-integration-secret";
  process.env.R2_ACCOUNT_ID = "retention-test-account";
  process.env.R2_ACCESS_KEY_ID = "retention-test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "retention-test-secret";
  process.env.R2_BUCKET_NAME = "retention-test-bucket";
  process.env.FRONTEND_URL = "https://fluentcheck.example.test";
  await migrateDatabase(process.env.DATABASE_URL);
  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  ({
    requestSubmissionPurge,
    approveSubmissionPurge,
    cancelSubmissionPurge,
    finalizeSubmissionPurge,
    RetentionCleanupDisabledError,
  } = await import("../../src/service/submissionRetention.service.js"));
  ({ inventoryPromptMedia, runPromptMediaCleanup } = await import(
    "../../src/service/promptMediaCleanup.service.js"
  ));
}, { timeout: 120_000 });

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "RetentionAuditEvent_immutable" ON "RetentionAuditEvent"`);
  await prisma.retentionAuditEvent.deleteMany();
  await prisma.promptMediaCleanupObject.deleteMany();
  await prisma.promptMediaCleanupRun.deleteMany();
  await prisma.submissionPurgeObject.deleteMany();
  await prisma.submissionPurgeRequest.deleteMany();
  await prisma.submissionRetentionHold.deleteMany();
  await prisma.score.deleteMany();
  await prisma.examinerAssignment.deleteMany();
  await prisma.answer.deleteMany();
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
  await prisma.task.deleteMany();
  await prisma.question.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER "SubmissionManifest_v1_shape_check" AFTER INSERT OR UPDATE ON "SubmissionManifest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_submission_manifest_v1_shape()`);
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER "ManifestEntry_v1_shape_check" AFTER INSERT OR UPDATE OR DELETE ON "ManifestEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_submission_manifest_v1_shape()`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "SubmissionManifest_immutable" BEFORE UPDATE OR DELETE ON "SubmissionManifest" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "ManifestEntry_immutable" BEFORE UPDATE OR DELETE ON "ManifestEntry" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "ManifestTask_immutable" BEFORE UPDATE OR DELETE ON "ManifestTask" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "RetentionAuditEvent_immutable" BEFORE UPDATE OR DELETE ON "RetentionAuditEvent" FOR EACH ROW EXECUTE FUNCTION reject_retention_audit_mutation()`);
}, { timeout: 120_000 });

after(async () => {
  if (disconnectDB) await disconnectDB();
  if (container) await container.stop();
}, { timeout: 120_000 });

function userData(role: "ADMIN" | "STUDENT") {
  const suffix = crypto.randomUUID().replaceAll("-", "");
  const email = `${suffix}@example.test`;
  return {
    username: `${role.toLowerCase()}_${suffix}`,
    email,
    normalizedEmail: email,
    password: "unused",
    role,
  } as const;
}

async function createAdmin() {
  return prisma.user.create({ data: userData("ADMIN") });
}

async function createPurgeFixture(withAnswer = true) {
  const [requester, approver, student] = await Promise.all([
    createAdmin(),
    createAdmin(),
    prisma.user.create({ data: userData("STUDENT") }),
  ]);
  const questionId = crypto.randomUUID();
  const question = await prisma.question.create({
    data: {
      id: questionId,
      category: "PART_1",
      order: Math.floor(Math.random() * 1_000_000),
      audioStorageKey: `questions/${questionId}/prompt.webm`,
      audioMimeType: "audio/webm",
      audioSizeBytes: 10,
      audioUploadStatus: "UPLOADED",
      tasks: { create: { promptText: "Prompt", order: 1 } },
    },
  });
  const otherQuestions = await Promise.all([
    prisma.question.create({
      data: {
        category: "PART_2",
        order: Math.floor(Math.random() * 1_000_000),
        tasks: { create: { promptText: "Prompt", order: 1 } },
      },
    }),
    prisma.question.create({
      data: {
        category: "PART_3",
        order: Math.floor(Math.random() * 1_000_000),
        tasks: { create: { promptText: "Prompt", order: 1 } },
      },
    }),
  ]);
  const submission = await prisma.$transaction(async (tx) => {
    const created = await tx.submission.create({
      data: { studentId: student.id, status: "ABANDONED" },
    });
    const manifest = await tx.submissionManifest.create({
      data: { submissionId: created.id, version: 1 },
    });
    const entries = [];
    for (const [index, entryQuestion] of [question, ...otherQuestions].entries()) {
      entries.push(await tx.manifestEntry.create({
        data: {
          manifestId: manifest.id,
          submissionId: created.id,
          category: entryQuestion.category,
          deliveryPosition: index + 1,
          sourceQuestionId: entryQuestion.id,
          promptMediaStorageKey: entryQuestion.audioStorageKey ?? `questions/${entryQuestion.id}/prompt.webm`,
          promptMediaMimeType: "audio/webm",
          promptMediaSizeBytes: entryQuestion.audioSizeBytes ?? 10,
        },
      }));
    }
    if (withAnswer) {
      await tx.answer.create({
        data: {
          submissionId: created.id,
          manifestEntryId: entries[0]!.id,
          storageKey: `submissions/${created.id}/answers/${question.id}.webm`,
          bucket: "retention-test-bucket",
          mimeType: "video/webm",
          uploadStatus: "UPLOADED",
        },
      });
    }
    return created;
  });
  const answer = await prisma.answer.findFirst({
    where: { submissionId: submission.id },
  });
  return { requester, approver, student, question, submission, answer };
}

test("purge approval requires dual control and creates a recoverable quarantine", async () => {
  const fixture = await createPurgeFixture();
  const request = await requestSubmissionPurge(
    fixture.submission.id,
    fixture.requester.id,
    { reason: "Student requested removal" },
    { database: prisma, now: () => new Date("2026-01-01T00:00:00.000Z") },
  );
  assert.equal(request.status, "REQUESTED");
  assert.equal((await prisma.submission.findUniqueOrThrow({ where: { id: fixture.submission.id } })).retentionStatus, "RETAINED");
  await assert.rejects(
    approveSubmissionPurge(request.id, fixture.requester.id, { reason: "Self approval" }, { database: prisma }),
    (error: unknown) => error instanceof Error && error.message.includes("requester cannot approve"),
  );
  const approved = await approveSubmissionPurge(
    request.id,
    fixture.approver.id,
    { reason: "Independent approval", authorizationId: "approval-1" },
    { database: prisma, now: () => new Date("2026-01-01T00:00:00.000Z") },
  );
  assert.equal(approved.status, "QUARANTINED");
  assert.equal(approved.objects.length, 1);
  assert.equal((await prisma.submission.findUniqueOrThrow({ where: { id: fixture.submission.id } })).retentionStatus, "QUARANTINED");
  assert.equal(await prisma.retentionAuditEvent.count({ where: { purgeRequestId: request.id } }), 2);
  const cancelled = await cancelSubmissionPurge(
    request.id,
    fixture.approver.id,
    { reason: "Recovery review" },
    { database: prisma },
  );
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal((await prisma.submission.findUniqueOrThrow({ where: { id: fixture.submission.id } })).retentionStatus, "RETAINED");
});

test("purge storage failures remain visible and retryable until absence is confirmed", async () => {
  const fixture = await createPurgeFixture();
  const request = await requestSubmissionPurge(fixture.submission.id, fixture.requester.id, { reason: "Remove abandoned attempt" }, { database: prisma, now: () => new Date("2026-01-01T00:00:00.000Z") });
  await approveSubmissionPurge(request.id, fixture.approver.id, { reason: "Independent approval" }, { database: prisma, now: () => new Date("2026-01-01T00:00:00.000Z") });
  const calls: string[] = [];
  let fail = true;
  const storage = {
    deleteObject: async (storageKey: string): Promise<StorageDeleteConfirmation> => {
      calls.push(storageKey);
      if (fail) {
        fail = false;
        throw new Error("storage unavailable");
      }
      return { outcome: "DELETED" };
    },
  };
  await assert.rejects(
    finalizeSubmissionPurge(request.id, fixture.approver.id, { reason: "Finalize", authorizationId: "change-1" }, { database: prisma, enabled: false, now: () => new Date("2026-02-01T00:00:00.000Z"), storage }),
    (error: unknown) => error instanceof RetentionCleanupDisabledError,
  );
  const failed = await finalizeSubmissionPurge(request.id, fixture.approver.id, { reason: "Finalize", authorizationId: "change-1" }, { database: prisma, enabled: true, now: () => new Date("2026-02-01T00:00:00.000Z"), storage });
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.objects[0]?.status, "FAILED");
  assert.match(failed.objects[0]?.lastError ?? "", /storage unavailable/u);
  const completed = await finalizeSubmissionPurge(request.id, fixture.approver.id, { reason: "Retry after recovery", authorizationId: "change-2" }, { database: prisma, enabled: true, now: () => new Date("2026-02-02T00:00:00.000Z"), storage });
  assert.equal(completed.status, "COMPLETED");
  assert.equal(calls.length, 2);
  assert.equal(await prisma.submission.findUnique({ where: { id: fixture.submission.id } }), null);
  assert.equal(await prisma.answer.findUnique({ where: { id: fixture.answer!.id } }), null);
  assert.ok(await prisma.retentionAuditEvent.count({ where: { targetSubmissionId: fixture.submission.id, action: "PURGE_COMPLETED" } }));
});

test("Prompt-media inventory blocks a manifest-only reference", async () => {
  const fixture = await createPurgeFixture(false);
  const promptQuestion = fixture.question;
  await prisma.question.update({ where: { id: promptQuestion.id }, data: { deletedAt: new Date("2026-01-01T00:00:00.000Z") } });
  const result = await inventoryPromptMedia({
    database: prisma,
    inspectPromptMedia: async () => ({ exists: true, contentLength: 10, contentType: "audio/webm" }),
  });
  const candidate = result.candidates.find((item) => item.sourceQuestionId === promptQuestion.id);
  assert.ok(candidate);
  assert.equal(candidate.answerReferences.length, 0);
  assert.equal(candidate.manifestReferences.length, 1);
  assert.equal(candidate.eligible, false);
  assert.match(candidate.reasons.join("; "), /Delivered prompt snapshot/u);
});

test("Prompt-media cleanup quarantines and finalizes an unreferenced retired identity", async () => {
  const fixture = await createPurgeFixture(false);
  const cleanupQuestionId = crypto.randomUUID();
  const cleanupQuestion = await prisma.question.create({
    data: {
      id: cleanupQuestionId,
      category: "PART_1",
      order: Math.floor(Math.random() * 1_000_000),
      audioStorageKey: `questions/${cleanupQuestionId}/prompt.webm`,
      audioMimeType: "audio/webm",
      audioSizeBytes: 10,
      audioUploadStatus: "UPLOADED",
      tasks: { create: { promptText: "Prompt", order: 1 } },
    },
  });
  await prisma.question.update({ where: { id: cleanupQuestion.id }, data: { deletedAt: new Date("2026-01-01T00:00:00.000Z") } });
  const now = new Date("2026-01-01T00:00:00.000Z");
  let deletes = 0;
  const dependencies = {
    database: prisma,
    enabled: true,
    now: () => now,
    inspectPromptMedia: async () => ({ exists: true, contentLength: 10, contentType: "audio/webm" }),
    storage: {
      deleteObject: async (): Promise<StorageDeleteConfirmation> => {
        deletes += 1;
        return { outcome: "DELETED" };
      },
    },
  };
  const quarantined = await runPromptMediaCleanup("QUARANTINE", { actorId: fixture.requester.id, authorizationId: "cleanup-1", reason: "Retired media review" }, dependencies);
  assert.equal(quarantined.status, "COMPLETED");
  assert.equal(quarantined.objects[0]?.status, "QUARANTINED");
  assert.equal(deletes, 0);
  now.setUTCDate(now.getUTCDate() + 31);
  const finalized = await runPromptMediaCleanup("FINALIZE", { actorId: fixture.requester.id, authorizationId: "cleanup-2", reason: "Finalization after quarantine" }, dependencies);
  assert.equal(finalized.status, "COMPLETED");
  assert.equal(finalized.objects[0]?.status, "DELETED");
  assert.equal(deletes, 1);
});
