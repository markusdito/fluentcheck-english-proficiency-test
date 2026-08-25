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
  await prisma.submission.deleteMany();
  await prisma.task.deleteMany();
  await prisma.question.deleteMany();
  await prisma.user.deleteMany();
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
        data: {
          username: `admin-${crypto.randomUUID()}`,
          email: `${crypto.randomUUID()}@example.test`,
          password: "unused",
          role: "ADMIN",
        },
      }),
      prisma.user.create({
        data: {
          username: `student-${crypto.randomUUID()}`,
          email: `${crypto.randomUUID()}@example.test`,
          password: "unused",
          role: "STUDENT",
        },
      }),
      prisma.user.create({
        data: {
          username: `examiner-${crypto.randomUUID()}`,
          email: `${crypto.randomUUID()}@example.test`,
          password: "unused",
          role: "EXAMINER",
        },
      }),
      prisma.user.create({
        data: {
          username: `other-student-${crypto.randomUUID()}`,
          email: `${crypto.randomUUID()}@example.test`,
          password: "unused",
          role: "STUDENT",
        },
      }),
      prisma.user.create({
        data: {
          username: `other-examiner-${crypto.randomUUID()}`,
          email: `${crypto.randomUUID()}@example.test`,
          password: "unused",
          role: "EXAMINER",
        },
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
  });
  async function createSubmissionWithStatus(
    status: "IN_PROGRESS" | "AWAITING_PAYMENT" | "SCORING",
  ) {
    const submissionId = crypto.randomUUID();
    return prisma.submission.create({
      data: {
        id: submissionId,
        studentId: student.id,
        status,
        answers: {
          create: {
            questionId: question.id,
            storageKey: `submissions/${submissionId}/answers/${question.id}.webm`,
            uploadStatus: "PENDING",
          },
        },
      },
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
  assert.equal(
    await prisma.answer.count({
      where: { questionId: fixture.question.id },
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
    data: {
      username: `race-admin-${crypto.randomUUID()}`,
      email: `${crypto.randomUUID()}@example.test`,
      password: "unused",
      role: "ADMIN",
    },
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
    data: {
      username: `operator-${crypto.randomUUID()}`,
      email: `${crypto.randomUUID()}@example.test`,
      password: "unused",
      role: "ADMIN",
    },
  });
  const student = await prisma.user.create({
    data: {
      username: `reconciliation-student-${crypto.randomUUID()}`,
      email: `${crypto.randomUUID()}@example.test`,
      password: "unused",
      role: "STUDENT",
    },
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
      await prisma.submission.create({
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
