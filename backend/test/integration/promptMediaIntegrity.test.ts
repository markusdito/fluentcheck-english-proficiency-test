import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
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
import type { PrismaClient } from "../../src/generated/client.js";

const execFileAsync = promisify(execFile);

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: () => Promise<void>;
let app: Express;
let server: Server;
let baseUrl: string;
let storageRequests: unknown[];

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
  process.env.JWT_SECRET = "prompt-media-integration-secret";
  process.env.R2_ACCOUNT_ID = "prompt-media-test-account";
  process.env.R2_ACCESS_KEY_ID = "prompt-media-test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "prompt-media-test-secret-key";
  process.env.R2_BUCKET_NAME = "prompt-media-test-bucket";
  process.env.FRONTEND_URL = "https://fluentcheck.example.test";

  await migrateDatabase(process.env.DATABASE_URL);

  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  const { r2Client } = await import("../../src/config/r2.js");
  r2Client.send = (async (command: unknown) => {
    storageRequests.push(command);
    throw new Error("Unexpected live storage request in integration test");
  }) as typeof r2Client.send;

  const { createApp } = await import("../../src/server.js");
  app = createApp();
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Prompt media integration server did not bind to a TCP port");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;
}, { timeout: 120_000 });

beforeEach(async () => {
  storageRequests = [];
  await prisma.score.deleteMany();
  await prisma.examinerAssignment.deleteMany();
  await prisma.answer.deleteMany();
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
  await prisma.task.deleteMany();
  await prisma.question.deleteMany();
  await prisma.user.deleteMany();
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER "SubmissionManifest_v1_shape_check" AFTER INSERT OR UPDATE ON "SubmissionManifest" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_submission_manifest_v1_shape()`);
  await prisma.$executeRawUnsafe(`CREATE CONSTRAINT TRIGGER "ManifestEntry_v1_shape_check" AFTER INSERT OR UPDATE OR DELETE ON "ManifestEntry" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_submission_manifest_v1_shape()`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "SubmissionManifest_immutable" BEFORE UPDATE OR DELETE ON "SubmissionManifest" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "ManifestEntry_immutable" BEFORE UPDATE OR DELETE ON "ManifestEntry" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()`);
  await prisma.$executeRawUnsafe(`CREATE TRIGGER "ManifestTask_immutable" BEFORE UPDATE OR DELETE ON "ManifestTask" FOR EACH ROW EXECUTE FUNCTION reject_submission_manifest_evidence_mutation()`);
});

after(async () => {
  if (server) {
    server.close();
    await once(server, "close");
  }
  if (disconnectDB) await disconnectDB();
  if (container) await container.stop();
}, { timeout: 120_000 });

function cookieFor(userId: string) {
  return `jwt=${jwt.sign({ id: userId }, process.env.JWT_SECRET!)}`;
}

function userData(username: string, role: "ADMIN" | "STUDENT" | "EXAMINER") {
  const email = `${crypto.randomUUID()}@example.test`;
  return {
    username: `${username.replace(/[^a-z0-9_]/giu, "_").toLowerCase().slice(0, 13)}_${crypto.randomUUID().replaceAll("-", "")}`,
    email,
    normalizedEmail: email,
    password: "unused",
    role,
  };
}

async function request(
  method: string,
  path: string,
  cookie: string,
  body?: Record<string, unknown>,
) {
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      Cookie: cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function createRetirementFixture() {
  const [admin, student, examiner, otherStudent, otherExaminer] =
    await Promise.all([
      prisma.user.create({
        data: userData(`admin-${crypto.randomUUID()}`, "ADMIN"),
      }),
      prisma.user.create({
        data: userData(`student-${crypto.randomUUID()}`, "STUDENT"),
      }),
      prisma.user.create({
        data: userData(`examiner-${crypto.randomUUID()}`, "EXAMINER"),
      }),
      prisma.user.create({
        data: userData(`other-student-${crypto.randomUUID()}`, "STUDENT"),
      }),
      prisma.user.create({
        data: userData(`other-examiner-${crypto.randomUUID()}`, "EXAMINER"),
      }),
    ]);

  const questionId = crypto.randomUUID();
  const question = await prisma.question.create({
    data: {
      id: questionId,
      category: "PART_1",
      order: 987_654,
      createdById: admin.id,
      audioStorageKey: `questions/${questionId}/prompt.webm`,
      audioMimeType: "audio/webm",
      audioSizeBytes: 4_096,
      audioUploadStatus: "UPLOADED",
      tasks: {
        create: { promptText: "Describe the scene.", order: 1 },
      },
    },
    include: { tasks: true },
  });
  async function createSubmissionWithStatus(
    status: "IN_PROGRESS" | "AWAITING_PAYMENT" | "SCORING",
  ) {
    const submissionId = crypto.randomUUID();
    // The manifest shape trigger is deferred to commit, so the Submission and
    // its complete version-1 manifest must be created in one transaction. The
    // fixture's own question supplies the PART_1 entry so the answer can bind
    // to it, and each entry snapshots the question's prompt media metadata.
    return prisma.$transaction(async (tx: any) => {
      const submission = await tx.submission.create({
        data: {
          id: submissionId,
          studentId: student.id,
          status,
        },
      });
      const manifest = await tx.submissionManifest.create({
        data: { submissionId, version: 1 },
      });
      let part1EntryId: string | null = null;
      for (const [index, category] of (["PART_1", "PART_2", "PART_3"] as const).entries()) {
        const entryQuestion = category === "PART_1" ? question : await tx.question.create({
          data: { category, order: Math.floor(Math.random() * 1_000_000), tasks: { create: { promptText: "Prompt", order: 1 } } },
          include: { tasks: true },
        });
        const entry = await tx.manifestEntry.create({
          data: {
            manifestId: manifest.id,
            submissionId,
            category,
            deliveryPosition: index + 1,
            promptMediaStorageKey: `questions/${entryQuestion.id}/prompt.webm`,
            promptMediaMimeType: "audio/webm",
            promptMediaSizeBytes: 4_096,
            sourceQuestionId: entryQuestion.id,
          },
        });
        const sourceTask = entryQuestion.tasks[0];
        await tx.manifestTask.create({
          data: {
            manifestEntryId: entry.id,
            sourceTaskId: sourceTask.id,
            sourceQuestionId: entryQuestion.id,
            deliveredOrder: sourceTask.order,
            deliveredText: sourceTask.promptText,
          },
        });
        if (category === "PART_1") part1EntryId = entry.id;
      }
      await tx.answer.create({
        data: {
          submissionId,
          manifestEntryId: part1EntryId!,
          storageKey: `submissions/${submissionId}/answers/${question.id}.webm`,
        },
      });
      return submission;
    });
  }
  const [inProgressSubmission, awaitingPaymentSubmission, submission] =
    await Promise.all([
      createSubmissionWithStatus("IN_PROGRESS"),
      createSubmissionWithStatus("AWAITING_PAYMENT"),
      createSubmissionWithStatus("SCORING"),
    ]);
  const assignment = await prisma.examinerAssignment.create({
    data: {
      submissionId: submission.id,
      examinerId: examiner.id,
      slot: 1,
    },
  });

  return {
    admin,
    student,
    examiner,
    otherStudent,
    otherExaminer,
    question,
    submission,
    retainedSubmissions: [
      inProgressSubmission,
      awaitingPaymentSubmission,
      submission,
    ],
    assignment,
  };
}

test("retiring a Question is idempotent and preserves authorized retained submissions and Prompt media", async () => {
  const fixture = await createRetirementFixture();
  const submissionIds = fixture.retainedSubmissions.map((submission: { id: string }) => submission.id);
  const historicalBefore = {
    manifests: await prisma.submissionManifest.findMany({
      where: { submissionId: { in: submissionIds } },
      orderBy: { id: "asc" },
      select: { id: true, submissionId: true, version: true },
    }),
    entries: await prisma.manifestEntry.findMany({
      where: { submissionId: { in: submissionIds } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        manifestId: true,
        submissionId: true,
        category: true,
        deliveryPosition: true,
        preparationSeconds: true,
        recordingSeconds: true,
        promptMediaStorageKey: true,
        promptMediaMimeType: true,
        promptMediaSizeBytes: true,
        sourceQuestionId: true,
      },
    }),
    manifestTasks: await prisma.manifestTask.findMany({
      where: { manifestEntry: { submissionId: { in: submissionIds } } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        manifestEntryId: true,
        sourceTaskId: true,
        sourceQuestionId: true,
        deliveredOrder: true,
        deliveredText: true,
      },
    }),
    answers: await prisma.answer.findMany({
      where: { submissionId: { in: submissionIds } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        submissionId: true,
        questionId: true,
        manifestEntryId: true,
        storageKey: true,
        bucket: true,
        mimeType: true,
        sizeBytes: true,
        durationSeconds: true,
        uploadStatus: true,
        verifiedAt: true,
        observedMimeType: true,
        proofVersion: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  };
  const originalMetadata = {
    audioStorageKey: fixture.question.audioStorageKey,
    audioMimeType: fixture.question.audioMimeType,
    audioSizeBytes: fixture.question.audioSizeBytes,
    audioUploadStatus: fixture.question.audioUploadStatus,
  };

  const firstRetirement = await request(
    "DELETE",
    `/questions/${fixture.question.id}`,
    cookieFor(fixture.admin.id),
  );
  assert.equal(firstRetirement.status, 200);

  const retiredAt = (await prisma.question.findUniqueOrThrow({
    where: { id: fixture.question.id },
  })).deletedAt;
  assert.ok(retiredAt);

  const repeatedRetirement = await request(
    "DELETE",
    `/questions/${fixture.question.id}`,
    cookieFor(fixture.admin.id),
  );
  assert.equal(repeatedRetirement.status, 200);

  const retiredQuestion = await prisma.question.findUniqueOrThrow({
    where: { id: fixture.question.id },
  });
  assert.equal(retiredQuestion.deletedAt?.getTime(), retiredAt.getTime());
  assert.deepEqual(
    {
      audioStorageKey: retiredQuestion.audioStorageKey,
      audioMimeType: retiredQuestion.audioMimeType,
      audioSizeBytes: retiredQuestion.audioSizeBytes,
      audioUploadStatus: retiredQuestion.audioUploadStatus,
    },
    originalMetadata,
  );
  const historicalAfter = {
    manifests: await prisma.submissionManifest.findMany({
      where: { submissionId: { in: submissionIds } },
      orderBy: { id: "asc" },
      select: { id: true, submissionId: true, version: true },
    }),
    entries: await prisma.manifestEntry.findMany({
      where: { submissionId: { in: submissionIds } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        manifestId: true,
        submissionId: true,
        category: true,
        deliveryPosition: true,
        preparationSeconds: true,
        recordingSeconds: true,
        promptMediaStorageKey: true,
        promptMediaMimeType: true,
        promptMediaSizeBytes: true,
        sourceQuestionId: true,
      },
    }),
    manifestTasks: await prisma.manifestTask.findMany({
      where: { manifestEntry: { submissionId: { in: submissionIds } } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        manifestEntryId: true,
        sourceTaskId: true,
        sourceQuestionId: true,
        deliveredOrder: true,
        deliveredText: true,
      },
    }),
    answers: await prisma.answer.findMany({
      where: { submissionId: { in: submissionIds } },
      orderBy: { id: "asc" },
      select: {
        id: true,
        submissionId: true,
        questionId: true,
        manifestEntryId: true,
        storageKey: true,
        bucket: true,
        mimeType: true,
        sizeBytes: true,
        durationSeconds: true,
        uploadStatus: true,
        verifiedAt: true,
        observedMimeType: true,
        proofVersion: true,
        createdAt: true,
        updatedAt: true,
      },
    }),
  };
  assert.deepEqual(historicalAfter, historicalBefore);
  assert.equal(
    await prisma.answer.count({
      where: { submissionId: { in: fixture.retainedSubmissions.map((s: { id: string }) => s.id) } },
    }),
    3,
  );
  assert.deepEqual(storageRequests, []);

  const authorizedRequests = [
    ...fixture.retainedSubmissions.map((submission) =>
      request(
        "GET",
        `/submissions/${submission.id}`,
        cookieFor(fixture.student.id),
      ),
    ),
    request(
      "GET",
      `/examiner/assignments/${fixture.assignment.id}`,
      cookieFor(fixture.examiner.id),
    ),
    request(
      "GET",
      `/admin/submissions/${fixture.submission.id}`,
      cookieFor(fixture.admin.id),
    ),
  ];
  for (const response of await Promise.all(authorizedRequests)) {
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.match(payload.data.answers[0].audioUrl, /^https:\/\//);
  }

  const unauthorizedStudent = await request(
    "GET",
    `/submissions/${fixture.submission.id}`,
    cookieFor(fixture.otherStudent.id),
  );
  assert.equal(unauthorizedStudent.status, 404);
  const unauthorizedExaminer = await request(
    "GET",
    `/examiner/assignments/${fixture.assignment.id}`,
    cookieFor(fixture.otherExaminer.id),
  );
  assert.equal(unauthorizedExaminer.status, 403);

  const directPromptMedia = await request(
    "GET",
    `/questions/${fixture.question.id}/audio-url`,
    cookieFor(fixture.admin.id),
  );
  assert.equal(directPromptMedia.status, 404);
  const newUpload = await request(
    "POST",
    "/questions/audio/presigned-url",
    cookieFor(fixture.admin.id),
    { questionId: fixture.question.id, mimeType: "audio/webm" },
  );
  assert.equal(newUpload.status, 404);
  const confirmation = await request(
    "POST",
    "/questions/audio/confirm",
    cookieFor(fixture.admin.id),
    { questionId: fixture.question.id },
  );
  assert.equal(confirmation.status, 404);
  assert.deepEqual(storageRequests, []);
});

test("retirement during Prompt media inspection prevents confirmation mutation", async () => {
  const admin = await prisma.user.create({
    data: userData(`race-admin-${crypto.randomUUID()}`, "ADMIN"),
  });
  const { r2Client } = await import("../../src/config/r2.js");
  const originalStorageSend = r2Client.send;

  try {
    const confirmationQuestionId = crypto.randomUUID();
    const confirmationStorageKey =
      `questions/${confirmationQuestionId}/prompt.webm`;
    await prisma.question.create({
      data: {
        id: confirmationQuestionId,
        category: "PART_3",
        order: 900_001,
        createdById: admin.id,
        audioStorageKey: confirmationStorageKey,
        audioMimeType: "audio/webm",
        audioUploadStatus: "PENDING",
      },
    });
    r2Client.send = (async (command: unknown) => {
      storageRequests.push(command);
      await prisma.question.update({
        where: { id: confirmationQuestionId },
        data: { deletedAt: new Date() },
      });
      return { ContentLength: 2_048, ContentType: "audio/webm" };
    }) as typeof r2Client.send;

    const racedConfirmation = await request(
      "POST",
      "/questions/audio/confirm",
      cookieFor(admin.id),
      { questionId: confirmationQuestionId },
    );
    assert.equal(racedConfirmation.status, 404);
    assert.deepEqual(
      await prisma.question.findUniqueOrThrow({
        where: { id: confirmationQuestionId },
        select: {
          audioStorageKey: true,
          audioMimeType: true,
          audioSizeBytes: true,
          audioUploadStatus: true,
        },
      }),
      {
        audioStorageKey: confirmationStorageKey,
        audioMimeType: "audio/webm",
        audioSizeBytes: null,
        audioUploadStatus: "PENDING",
      },
    );
    assert.equal(storageRequests.length, 1);
  } finally {
    r2Client.send = originalStorageSend;
  }
});

test("reconciliation reports every Retired Question Prompt media state without mutation", async () => {
  const operator = await prisma.user.create({
    data: userData(`operator-${crypto.randomUUID()}`, "ADMIN"),
  });
  const student = await prisma.user.create({
    data: userData(`reconciliation-student-${crypto.randomUUID()}`, "STUDENT"),
  });

  async function createRetiredQuestion(
    order: number,
    metadata: {
      audioStorageKey?: string | null;
      audioMimeType?: string | null;
      audioSizeBytes?: number | null;
      audioUploadStatus?: "PENDING" | "UPLOADED" | "FAILED";
    },
    submissionStatus?:
      | "IN_PROGRESS"
      | "AWAITING_PAYMENT"
      | "PAID"
      | "SCORING"
      | "SCORED"
      | "CERTIFIED",
  ) {
    const questionId = crypto.randomUUID();
    const audioStorageKey = metadata.audioStorageKey
      ? `questions/${questionId}/prompt.${metadata.audioStorageKey.split(".").at(-1)}`
      : metadata.audioStorageKey;
    const question = await prisma.question.create({
      data: {
        id: questionId,
        category: "PART_2",
        order,
        createdById: operator.id,
        deletedAt: new Date("2026-08-25T00:00:00.000Z"),
        ...metadata,
        audioStorageKey,
      },
    });
    if (submissionStatus) {
      // The manifest shape trigger is deferred to commit, so the Submission
      // and its complete version-1 manifest must be created in one transaction.
      await prisma.$transaction(async (tx: any) => {
        const submission = await tx.submission.create({
          data: {
            studentId: student.id,
            status: submissionStatus,
            answers: {
              create: {
                questionId,
                storageKey: `submissions/${crypto.randomUUID()}/answers/${questionId}.webm`,
              },
            },
          },
        });
        const manifest = await tx.submissionManifest.create({
          data: { submissionId: submission.id, version: 1 },
        });
        for (const [index, category] of (["PART_1", "PART_2", "PART_3"] as const).entries()) {
          const entryQuestion = await tx.question.create({
            data: { category, order: Math.floor(Math.random() * 1_000_000), tasks: { create: { promptText: "Prompt", order: 1 } } },
          });
          await tx.manifestEntry.create({
            data: {
              manifestId: manifest.id,
              submissionId: submission.id,
              category,
              deliveryPosition: index + 1,
              sourceQuestionId: entryQuestion.id,
            },
          });
        }
        return submission;
      });
    }
    return question;
  }

  const referencedPresent = await createRetiredQuestion(
    1,
    {
      audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
      audioMimeType: "audio/webm",
      audioSizeBytes: 1_024,
      audioUploadStatus: "UPLOADED",
    },
    "IN_PROGRESS",
  );
  const referencedMissing = await createRetiredQuestion(
    2,
    {
      audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
      audioMimeType: "audio/webm",
      audioSizeBytes: 2_048,
      audioUploadStatus: "UPLOADED",
    },
    "CERTIFIED",
  );
  const unreferencedPresent = await createRetiredQuestion(3, {
    audioStorageKey: `questions/${crypto.randomUUID()}/prompt.mp3`,
    audioMimeType: "audio/mpeg",
    audioSizeBytes: 3_072,
    audioUploadStatus: "UPLOADED",
  });
  const invalidMetadata = await createRetiredQuestion(
    4,
    {
      audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
      audioMimeType: null,
      audioSizeBytes: null,
      audioUploadStatus: "UPLOADED",
    },
    "AWAITING_PAYMENT",
  );
  const noMedia = await createRetiredQuestion(5, {});
  const storageFailure = await createRetiredQuestion(
    6,
    {
      audioStorageKey: `questions/${crypto.randomUUID()}/prompt.ogg`,
      audioMimeType: "audio/ogg",
      audioSizeBytes: 4_096,
      audioUploadStatus: "UPLOADED",
    },
    "PAID",
  );
  const inconsistentStorage = await createRetiredQuestion(
    7,
    {
      audioStorageKey: `questions/${crypto.randomUUID()}/prompt.m4a`,
      audioMimeType: "audio/mp4",
      audioSizeBytes: 5_120,
      audioUploadStatus: "UPLOADED",
    },
    "SCORING",
  );

  const beforeRows = await prisma.question.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { id: "asc" },
  });
  const inspectedKeys: string[] = [];
  const { reconcileRetiredPromptMedia, formatHumanReconciliation } =
    await import("../../src/service/promptMediaReconciliation.service.js");
  const result = await reconcileRetiredPromptMedia({
    inspectPromptMedia: async (storageKey) => {
      inspectedKeys.push(storageKey);
      if (storageKey === storageFailure.audioStorageKey) {
        throw new Error("storage unavailable");
      }
      if (storageKey === referencedMissing.audioStorageKey) {
        return { exists: false, contentLength: null, contentType: null };
      }
      if (storageKey === inconsistentStorage.audioStorageKey) {
        return {
          exists: true,
          contentLength: 999,
          contentType: "audio/ogg",
        };
      }
      if (storageKey === invalidMetadata.audioStorageKey) {
        return {
          exists: true,
          contentLength: 777,
          contentType: "audio/webm",
        };
      }
      const question = [
        referencedPresent,
        unreferencedPresent,
      ].find(
        (candidate) => candidate.audioStorageKey === storageKey,
      );
      assert.ok(question);
      return {
        exists: true,
        contentLength: question.audioSizeBytes,
        contentType: question.audioMimeType,
      };
    },
  });

  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.totals, {
    questions: 7,
    referenced: 5,
    unreferenced: 2,
    present: 2,
    missing: 1,
    invalidMetadata: 1,
    noMedia: 1,
    inconsistent: 1,
    storageError: 1,
    mediaPresent: 4,
    mediaMissing: 1,
    mediaNotChecked: 1,
    mediaCheckFailed: 1,
  });
  assert.deepEqual(
    Object.fromEntries(
      result.records.map((record) => [
        record.questionId,
        record.classification.status,
      ]),
    ),
    {
      [referencedPresent.id]: "PRESENT",
      [referencedMissing.id]: "MISSING",
      [unreferencedPresent.id]: "PRESENT",
      [invalidMetadata.id]: "INVALID_METADATA",
      [noMedia.id]: "NO_MEDIA",
      [storageFailure.id]: "STORAGE_ERROR",
      [inconsistentStorage.id]: "INCONSISTENT",
    },
  );
  const invalidMetadataRecord = result.records.find(
    (record) => record.questionId === invalidMetadata.id,
  );
  assert.equal(
    invalidMetadataRecord?.classification.metadataStatus,
    "INVALID",
  );
  assert.equal(
    invalidMetadataRecord?.classification.existenceStatus,
    "PRESENT",
  );
  assert.equal(invalidMetadataRecord?.observedSizeBytes, 777);
  assert.deepEqual(inspectedKeys.sort(), [
    invalidMetadata.audioStorageKey,
    referencedMissing.audioStorageKey,
    referencedPresent.audioStorageKey,
    inconsistentStorage.audioStorageKey,
    storageFailure.audioStorageKey,
    unreferencedPresent.audioStorageKey,
  ].sort());
  assert.match(
    formatHumanReconciliation(result),
    new RegExp(`${referencedMissing.id}.*MISSING`),
  );
  assert.match(formatHumanReconciliation(result), /Referenced: 5/);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), result);

  const { runPromptMediaReconciliationCli } =
    await import("../../src/cli/reconcilePromptMedia.js");
  const humanOutput: string[] = [];
  assert.equal(
    await runPromptMediaReconciliationCli([], {
      runReconciliation: async () => result,
      writeOutput: (value) => humanOutput.push(value),
      writeError: () => assert.fail("human mode must not write an error"),
    }),
    1,
  );
  assert.match(humanOutput.join(""), /Referenced: 5/);

  const machineOutput: string[] = [];
  assert.equal(
    await runPromptMediaReconciliationCli(["--json"], {
      runReconciliation: async () => result,
      writeOutput: (value) => machineOutput.push(value),
      writeError: () => assert.fail("JSON mode must not write an error"),
    }),
    1,
  );
  assert.deepEqual(JSON.parse(machineOutput.join("")), result);

  const afterRows = await prisma.question.findMany({
    where: { deletedAt: { not: null } },
    orderBy: { id: "asc" },
  });
  assert.deepEqual(afterRows, beforeRows);
});
