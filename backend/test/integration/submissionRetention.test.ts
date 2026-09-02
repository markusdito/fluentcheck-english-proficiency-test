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
const TEST_PASSWORD_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: () => Promise<void>;
let requestSubmissionPurge: typeof import("../../src/service/submissionRetention.service.js")["requestSubmissionPurge"];
let approveSubmissionPurge: typeof import("../../src/service/submissionRetention.service.js")["approveSubmissionPurge"];
let cancelSubmissionPurge: typeof import("../../src/service/submissionRetention.service.js")["cancelSubmissionPurge"];
let finalizeSubmissionPurge: typeof import("../../src/service/submissionRetention.service.js")["finalizeSubmissionPurge"];
let RetentionCleanupDisabledError: typeof import("../../src/service/submissionRetention.service.js")["RetentionCleanupDisabledError"];
let RetentionOperationError: typeof import("../../src/service/submissionRetention.service.js")["RetentionOperationError"];
let SubmissionPurgeNotEligibleError: typeof import("../../src/service/submissionRetention.service.js")["SubmissionPurgeNotEligibleError"];
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
    RetentionOperationError,
    SubmissionPurgeNotEligibleError,
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
    password: TEST_PASSWORD_HASH,
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

async function createRetiredPromptQuestion() {
  const id = crypto.randomUUID();
  const question = await prisma.question.create({
    data: {
      id,
      category: "PART_1",
      order: Math.floor(Math.random() * 1_000_000),
      audioStorageKey: `questions/${id}/prompt.webm`,
      audioMimeType: "audio/webm",
      audioSizeBytes: 10,
      audioUploadStatus: "UPLOADED",
      tasks: { create: { promptText: "Prompt", order: 1 } },
    },
  });
  await prisma.question.update({
    where: { id },
    data: { deletedAt: new Date("2026-01-01T00:00:00.000Z") },
  });
  return question;
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
  await assert.rejects(
    prisma.answer.create({
      data: {
        submissionId: fixture.submission.id,
        questionId: fixture.question.id,
        storageKey: `submissions/${fixture.submission.id}/answers/quarantine-guard.webm`,
        bucket: "retention-test-bucket",
        mimeType: "video/webm",
        uploadStatus: "UPLOADED",
      },
    }),
    /Answer writes are blocked for a non-retained Submission/u,
  );
  const quarantinedManifest = await prisma.submissionManifest.findUniqueOrThrow({
    where: { submissionId: fixture.submission.id },
  });
  await assert.rejects(
    prisma.manifestEntry.create({
      data: {
        manifestId: quarantinedManifest.id,
        submissionId: fixture.submission.id,
        category: "PART_1",
        deliveryPosition: 99,
        sourceQuestionId: fixture.question.id,
        promptMediaStorageKey: fixture.question.audioStorageKey,
        promptMediaMimeType: "audio/webm",
        promptMediaSizeBytes: 10,
      },
    }),
    /Manifest evidence writes are blocked for a non-retained Submission/u,
  );
  const otherFixture = await createPurgeFixture(false);
  await assert.rejects(
    prisma.answer.create({
      data: {
        submissionId: otherFixture.submission.id,
        questionId: otherFixture.question.id,
        storageKey: fixture.answer!.storageKey,
        bucket: "retention-test-bucket",
        mimeType: "video/webm",
        uploadStatus: "UPLOADED",
      },
    }),
    /storage identity is reserved by a purge workflow/u,
  );
  const cancelled = await cancelSubmissionPurge(
    request.id,
    fixture.approver.id,
    { reason: "Recovery review" },
    { database: prisma },
  );
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal((await prisma.submission.findUniqueOrThrow({ where: { id: fixture.submission.id } })).retentionStatus, "RETAINED");
});

test("retention audit events cannot be rewritten or removed", async () => {
  const fixture = await createPurgeFixture();
  const request = await requestSubmissionPurge(
    fixture.submission.id,
    fixture.requester.id,
    { reason: "Audit immutability check" },
    { database: prisma },
  );
  const event = await prisma.retentionAuditEvent.findFirstOrThrow({
    where: { purgeRequestId: request.id },
  });

  await assert.rejects(
    prisma.retentionAuditEvent.update({
      where: { id: event.id },
      data: { reason: "tampered" },
    }),
  );
  await assert.rejects(
    prisma.retentionAuditEvent.delete({ where: { id: event.id } }),
  );
  assert.equal(
    (await prisma.retentionAuditEvent.findUniqueOrThrow({ where: { id: event.id } })).reason,
    "Audit immutability check",
  );
});

test("purge approval fails closed when an Answer-media identity is shared", async () => {
  const fixture = await createPurgeFixture();
  const otherFixture = await createPurgeFixture(false);
  await prisma.answer.create({
    data: {
      submissionId: otherFixture.submission.id,
      questionId: otherFixture.question.id,
      storageKey: fixture.answer!.storageKey,
      bucket: "retention-test-bucket",
      mimeType: "video/webm",
      uploadStatus: "UPLOADED",
    },
  });
  const request = await requestSubmissionPurge(
    fixture.submission.id,
    fixture.requester.id,
    { reason: "Shared identity check" },
    { database: prisma },
  );
  await assert.rejects(
    approveSubmissionPurge(
      request.id,
      fixture.approver.id,
      { reason: "Independent approval" },
      { database: prisma },
    ),
    (error: unknown) =>
      error instanceof SubmissionPurgeNotEligibleError &&
      error.blockers.some((blocker) => blocker.includes("shared by another retained Submission")),
  );
  assert.equal(
    (await prisma.submission.findUniqueOrThrow({ where: { id: fixture.submission.id } })).retentionStatus,
    "RETAINED",
  );
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

test("purge finalization requires explicit authorization before storage access", async () => {
  const fixture = await createPurgeFixture();
  const request = await requestSubmissionPurge(
    fixture.submission.id,
    fixture.requester.id,
    { reason: "Remove abandoned attempt" },
    { database: prisma, now: () => new Date("2026-01-01T00:00:00.000Z") },
  );
  await approveSubmissionPurge(
    request.id,
    fixture.approver.id,
    { reason: "Independent approval" },
    { database: prisma, now: () => new Date("2026-01-01T00:00:00.000Z") },
  );

  let deletes = 0;
  await assert.rejects(
    finalizeSubmissionPurge(
      request.id,
      fixture.approver.id,
      { reason: "Finalize without change record" },
      {
        database: prisma,
        enabled: true,
        now: () => new Date("2026-02-01T00:00:00.000Z"),
        storage: {
          deleteObject: async (): Promise<StorageDeleteConfirmation> => {
            deletes += 1;
            return { outcome: "DELETED" };
          },
        },
      },
    ),
    (error: unknown) =>
      error instanceof RetentionOperationError &&
      error.code === "AUTHORIZATION_REQUIRED",
  );
  assert.equal(deletes, 0);
  assert.equal(
    (await prisma.submission.findUniqueOrThrow({ where: { id: fixture.submission.id } })).retentionStatus,
    "QUARANTINED",
  );
});

test("already absent Answer media crosses the irreversible boundary as MISSING", async () => {
  const fixture = await createPurgeFixture();
  const request = await requestSubmissionPurge(
    fixture.submission.id,
    fixture.requester.id,
    { reason: "Remove abandoned attempt" },
    { database: prisma, now: () => new Date("2026-01-01T00:00:00.000Z") },
  );
  await approveSubmissionPurge(
    request.id,
    fixture.approver.id,
    { reason: "Independent approval" },
    { database: prisma, now: () => new Date("2026-01-01T00:00:00.000Z") },
  );
  const finalized = await finalizeSubmissionPurge(
    request.id,
    fixture.approver.id,
    { reason: "Finalize absent object", authorizationId: "absence-check" },
    {
      database: prisma,
      enabled: true,
      now: () => new Date("2026-02-01T00:00:00.000Z"),
      storage: {
        deleteObject: async (): Promise<StorageDeleteConfirmation> => ({
          outcome: "ALREADY_ABSENT",
        }),
      },
    },
  );
  assert.equal(finalized.status, "COMPLETED");
  assert.equal(finalized.objects[0]?.status, "MISSING");
  await assert.rejects(
    cancelSubmissionPurge(
      request.id,
      fixture.approver.id,
      { reason: "Too late" },
      { database: prisma },
    ),
    /Only an approved quarantined purge can be recovered/u,
  );
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

test("Prompt-media inventory reports active Questions sharing a retired identity", async () => {
  const fixture = await createPurgeFixture(false);
  await prisma.question.update({
    where: { id: fixture.question.id },
    data: { deletedAt: new Date("2026-01-01T00:00:00.000Z") },
  });
  const activeQuestion = await prisma.question.create({
    data: {
      category: "PART_1",
      order: Math.floor(Math.random() * 1_000_000),
      audioStorageKey: fixture.question.audioStorageKey,
      audioMimeType: "audio/webm",
      audioSizeBytes: 10,
      audioUploadStatus: "UPLOADED",
      tasks: { create: { promptText: "Prompt", order: 1 } },
    },
  });
  const result = await inventoryPromptMedia({
    database: prisma,
    inspectPromptMedia: async () => ({ exists: true, contentLength: 10, contentType: "audio/webm" }),
  });
  const candidate = result.candidates.find((item) => item.sourceQuestionId === fixture.question.id);
  assert.ok(candidate);
  assert.deepEqual(candidate.activeSourceQuestionIds, [activeQuestion.id]);
  assert.equal(candidate.eligible, false);
  assert.match(candidate.reasons.join("; "), /active Question uses/u);
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

  const repeated = await runPromptMediaCleanup(
    "QUARANTINE",
    {
      actorId: fixture.requester.id,
      authorizationId: "cleanup-repeat",
      reason: "Verify idempotent cleanup replay",
    },
    dependencies,
  );
  assert.equal(repeated.status, "COMPLETED");
  assert.equal(repeated.objects[0]?.status, "DELETED");
  assert.equal(repeated.objects[0]?.outcome, "ALREADY_FINALIZED");
  assert.equal(deletes, 1);
});

test("Prompt-media cleanup rejects a reference that waits behind finalization", async () => {
  const fixture = await createPurgeFixture(false);
  const cleanupQuestion = await createRetiredPromptQuestion();
  const now = new Date("2026-01-01T00:00:00.000Z");
  let signalDeleteStarted!: () => void;
  const deleteStarted = new Promise<void>((resolve) => {
    signalDeleteStarted = resolve;
  });
  let releaseDelete!: () => void;
  const deleteReleased = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  let deletes = 0;
  const dependencies = {
    database: prisma,
    enabled: true,
    now: () => now,
    inspectPromptMedia: async () => ({ exists: true, contentLength: 10, contentType: "audio/webm" }),
    storage: {
      deleteObject: async (): Promise<StorageDeleteConfirmation> => {
        deletes += 1;
        signalDeleteStarted();
        await deleteReleased;
        return { outcome: "DELETED" };
      },
    },
  };
  const quarantined = await runPromptMediaCleanup(
    "QUARANTINE",
    {
      actorId: fixture.requester.id,
      authorizationId: "cleanup-concurrent-quarantine",
      reason: "Retired media review",
    },
    dependencies,
  );
  assert.equal(quarantined.objects[0]?.status, "QUARANTINED");
  now.setUTCDate(now.getUTCDate() + 31);

  const finalizePromise = runPromptMediaCleanup(
    "FINALIZE",
    {
      actorId: fixture.requester.id,
      authorizationId: "cleanup-concurrent-finalize",
      reason: "Finalization after quarantine",
    },
    dependencies,
  );
  await deleteStarted;

  const answerAttempt = prisma.answer.create({
    data: {
      submissionId: fixture.submission.id,
      questionId: cleanupQuestion.id,
      storageKey: `submissions/${fixture.submission.id}/answers/${crypto.randomUUID()}.webm`,
      bucket: "retention-test-bucket",
      mimeType: "video/webm",
      uploadStatus: "PENDING",
    },
  });
  const answerState = await Promise.race([
    answerAttempt.then(() => "created", () => "rejected"),
    new Promise<string>((resolve) => setTimeout(() => resolve("pending"), 100)),
  ]);
  assert.equal(answerState, "pending");

  releaseDelete();
  await finalizePromise;
  await assert.rejects(
    answerAttempt,
    /Prompt-media storage identity is reserved by cleanup/u,
  );
  assert.equal(deletes, 1);
});

test("Prompt-media cleanup records failed deletion and retries after storage recovery", async () => {
  const fixture = await createPurgeFixture(false);
  await createRetiredPromptQuestion();
  const now = new Date("2026-01-01T00:00:00.000Z");
  let fail = true;
  let deletes = 0;
  const dependencies = {
    database: prisma,
    enabled: true,
    now: () => now,
    inspectPromptMedia: async () => ({ exists: true, contentLength: 10, contentType: "audio/webm" }),
    storage: {
      deleteObject: async (): Promise<StorageDeleteConfirmation> => {
        deletes += 1;
        if (fail) {
          fail = false;
          throw new Error("storage unavailable");
        }
        return { outcome: "DELETED" };
      },
    },
  };
  const quarantined = await runPromptMediaCleanup(
    "QUARANTINE",
    {
      actorId: fixture.requester.id,
      authorizationId: "cleanup-retry-quarantine",
      reason: "Retired media review",
    },
    dependencies,
  );
  assert.equal(quarantined.objects[0]?.status, "QUARANTINED");
  now.setUTCDate(now.getUTCDate() + 31);

  const failed = await runPromptMediaCleanup(
    "FINALIZE",
    {
      actorId: fixture.requester.id,
      authorizationId: "cleanup-retry-first-finalize",
      reason: "Attempt finalization",
    },
    dependencies,
  );
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.objects[0]?.status, "FAILED");
  assert.match(failed.objects[0]?.error ?? "", /storage unavailable/u);
  assert.ok(
    await prisma.retentionAuditEvent.findFirst({
      where: { cleanupRunId: failed.runId, action: "PROMPT_CLEANUP_DELETE_FAILED" },
    }),
  );

  const retried = await runPromptMediaCleanup(
    "FINALIZE",
    {
      actorId: fixture.requester.id,
      authorizationId: "cleanup-retry-second-finalize",
      reason: "Retry after storage recovery",
    },
    dependencies,
  );
  assert.equal(retried.status, "COMPLETED");
  assert.equal(retried.objects[0]?.status, "DELETED");
  assert.equal(deletes, 2);
  assert.ok(
    await prisma.retentionAuditEvent.findFirst({
      where: { cleanupRunId: retried.runId, action: "PROMPT_CLEANUP_DELETE_CONFIRMED" },
    }),
  );
});

test("Prompt-media cleanup marks quarantine inspection failures and retries them", async () => {
  const fixture = await createPurgeFixture(false);
  await createRetiredPromptQuestion();
  let inspections = 0;
  const dependencies = {
    database: prisma,
    enabled: true,
    inspectPromptMedia: async () => {
      inspections += 1;
      if (inspections === 2) throw new Error("storage inspection unavailable");
      return { exists: true, contentLength: 10, contentType: "audio/webm" };
    },
    storage: {
      deleteObject: async (): Promise<StorageDeleteConfirmation> => ({ outcome: "DELETED" }),
    },
  };

  const failed = await runPromptMediaCleanup(
    "QUARANTINE",
    {
      actorId: fixture.requester.id,
      authorizationId: "cleanup-inspection-failure",
      reason: "Inspect retired media",
    },
    dependencies,
  );
  assert.equal(failed.status, "FAILED");
  assert.equal(failed.objects[0]?.status, "FAILED");
  assert.ok(
    await prisma.retentionAuditEvent.findFirst({
      where: { cleanupRunId: failed.runId, action: "PROMPT_CLEANUP_SKIPPED" },
    }),
  );

  const retried = await runPromptMediaCleanup(
    "QUARANTINE",
    {
      actorId: fixture.requester.id,
      authorizationId: "cleanup-inspection-retry",
      reason: "Retry retired media inspection",
    },
    dependencies,
  );
  assert.equal(retried.status, "COMPLETED");
  assert.equal(retried.objects[0]?.status, "QUARANTINED");
  assert.equal(inspections, 4);
});

test("Prompt-media quarantine rechecks references after the dry-run snapshot", async () => {
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
  await prisma.question.update({
    where: { id: cleanupQuestion.id },
    data: { deletedAt: new Date("2026-01-01T00:00:00.000Z") },
  });

  let injected = false;
  let injectedAnswerId: string | undefined;
  const result = await runPromptMediaCleanup(
    "QUARANTINE",
    {
      actorId: fixture.requester.id,
      authorizationId: "cleanup-recheck",
      reason: "Reference race check",
    },
    {
      database: prisma,
      enabled: true,
      inspectPromptMedia: async () => {
        if (!injected) {
          injected = true;
          const answer = await prisma.answer.create({
            data: {
              submissionId: fixture.submission.id,
              questionId: cleanupQuestion.id,
              storageKey: `submissions/${fixture.submission.id}/answers/${crypto.randomUUID()}.webm`,
              bucket: "retention-test-bucket",
              mimeType: "video/webm",
              uploadStatus: "UPLOADED",
            },
          });
          injectedAnswerId = answer.id;
        }
        return { exists: true, contentLength: 10, contentType: "audio/webm" };
      },
    },
  );

  assert.equal(result.status, "COMPLETED");
  assert.equal(result.objects[0]?.status, "SKIPPED_REFERENCED");
  assert.match(result.objects[0]?.outcome ?? "", /Answer/u);
  assert.ok(injectedAnswerId);
  assert.equal(
    await prisma.answer.count({ where: { id: injectedAnswerId } }),
    1,
  );
});
