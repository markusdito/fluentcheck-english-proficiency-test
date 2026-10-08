import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import { once } from "node:events";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import type { Express } from "express";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";

const execFileAsync = promisify(execFile);
let container: StartedPostgreSqlContainer;
let prisma: any;
let disconnectDB: (() => Promise<void>) | undefined;
let initializeManifestSubmission: typeof import("../../src/service/manifestSubmissionInitialization.service.js").initializeManifestSubmission;
let resumeManifestSubmission: typeof import("../../src/service/manifestSubmissionInitialization.service.js").resumeManifestSubmission;
let AssessmentUnavailableError: typeof import("../../src/service/manifestSubmissionInitialization.service.js").AssessmentUnavailableError;
let IdempotencyKeyConflictError: typeof import("../../src/service/manifestSubmissionInitialization.service.js").IdempotencyKeyConflictError;
let ActiveSubmissionConflictError: typeof import("../../src/service/manifestSubmissionInitialization.service.js").ActiveSubmissionConflictError;
let AssessmentStartIntentClosedError: typeof import("../../src/service/manifestSubmissionInitialization.service.js").AssessmentStartIntentClosedError;
let app: Express;
let server: Server;
let baseUrl: string;

function uniqueUsername(prefix: string) {
  return `${prefix.replace(/[^a-z0-9_]/giu, "_")}_${crypto.randomUUID().replaceAll("-", "")}`;
}

let sharedOrderCounter = 10_000_000;

/** Next question-set order shared across every category. */
function nextSharedOrder() {
  return ++sharedOrderCounter;
}

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.R2_BUCKET_NAME = "initialization-test-bucket";
  process.env.R2_ACCOUNT_ID = "initialization-test-account";
  process.env.R2_ACCESS_KEY_ID = "initialization-test-key";
  process.env.R2_SECRET_ACCESS_KEY = "initialization-test-secret";
  process.env.JWT_SECRET = "manifest-initialization-secret";
  await execFileAsync("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    timeout: 120_000,
  });
  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  ({
    initializeManifestSubmission,
    resumeManifestSubmission,
    AssessmentUnavailableError,
    IdempotencyKeyConflictError,
    ActiveSubmissionConflictError,
    AssessmentStartIntentClosedError,
  } = await import("../../src/service/manifestSubmissionInitialization.service.js"));
  const { createApp } = await import("../../src/server.js");
  app = createApp();
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Initialization test server did not bind");
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

async function createStudent() {
  const email = `${crypto.randomUUID()}@example.test`;
  return prisma.user.create({
    data: {
      username: uniqueUsername("student"),
      email,
      normalizedEmail: email,
      password: "unused",
    },
  });
}

test("initialization selects one eligible question per category and persists a complete manifest", async () => {
  const student = await createStudent();
  const order = nextSharedOrder();
  for (const category of ["PART_1", "PART_2", "PART_3"] as const) {
    const question = await prisma.question.create({
      data: {
        category,
        order,
        preparationSeconds: 20,
        recordingSeconds: 60,
        audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
        audioMimeType: "audio/webm",
        audioSizeBytes: 128,
        audioUploadStatus: "UPLOADED",
        tasks: { create: [{ promptText: `${category} task`, order: 1 }] },
      },
    });
    assert.ok(question.id);
  }

  const result = await initializeManifestSubmission(student.id, "start-key-1", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  assert.equal(result.entries.length, 3);
  assert.deepEqual(result.entries.map((entry) => entry.deliveryPosition), [1, 2, 3]);
  assert.equal(await prisma.submission.count({ where: { id: result.submissionId } }), 1);
  assert.equal(await prisma.manifestEntry.count({ where: { manifestId: result.manifestId } }), 3);
  assert.equal(await prisma.manifestTask.count({ where: { manifestEntry: { manifestId: result.manifestId } } }), 3);
});

test("a failed telemetry delivery cannot turn successful initialization into failure", async () => {
  const student = await createStudent();
  const result = await initializeManifestSubmission(student.id, "telemetry-success-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
    observeAttempt: () => {
      throw new Error("telemetry unavailable");
    },
    observeSuccess: () => {
      throw new Error("telemetry unavailable");
    },
    observeFailure: () => {
      throw new Error("telemetry unavailable");
    },
  });
  assert.equal(result.entries.length, 3);
});

test("unavailable assessment persists no Submission", async () => {
  const student = await createStudent();
  const activeQuestionIds = (
    await prisma.question.findMany({
      where: { deletedAt: null },
      select: { id: true },
    })
  ).map(({ id }: { id: string }) => id);
  if (activeQuestionIds.length > 0) {
    await prisma.question.updateMany({
      where: { id: { in: activeQuestionIds } },
      data: { deletedAt: new Date() },
    });
  }
  const failures: unknown[] = [];
  await assert.rejects(
    initializeManifestSubmission(student.id, "start-key-empty", {
      signPromptMedia: async () => {
        throw new Error("signer unavailable");
      },
      observeFailure: (event) => failures.push(event),
    }),
    AssessmentUnavailableError,
  );
  assert.equal(await prisma.submission.count({ where: { studentId: student.id } }), 0);
  assert.equal(failures.length, 1);
  const failure = failures[0] as {
    eventName: string;
    classification: string;
    internalReason: string;
    requestId: string;
    categoryCount: number;
    failureCount: number;
    failedQuestionIds: string[];
    failedCategories: string[];
    preparationDurationMs: number;
  };
  assert.deepEqual(
    {
      eventName: failure.eventName,
      classification: failure.classification,
      internalReason: failure.internalReason,
      categoryCount: failure.categoryCount,
      failureCount: failure.failureCount,
      failedQuestionIds: failure.failedQuestionIds,
      failedCategories: failure.failedCategories,
    },
    {
      eventName: "submission_initialization_failed",
      classification: "BANK",
      internalReason: "QUESTION_BANK_INCOMPLETE",
      categoryCount: 3,
      failureCount: 1,
      failedQuestionIds: [],
      failedCategories: ["PART_1", "PART_2", "PART_3"],
    },
  );
  assert.match(failure.requestId, /^[0-9a-f-]{36}$/u);
  assert.equal(Number.isSafeInteger(failure.preparationDurationMs), true);
  assert.equal(failure.preparationDurationMs >= 0, true);

  const response = await fetch(`${baseUrl}/api/submissions`, {
    method: "POST",
    headers: {
      Cookie: `jwt=${jwt.sign({ id: student.id }, process.env.JWT_SECRET!)}`,
      "Idempotency-Key": "http-empty-key",
    },
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("retry-after"), "5");
  assert.deepEqual(await response.json(), {
    error: "Assessment unavailable",
    code: "ASSESSMENT_UNAVAILABLE",
    retryable: true,
    retryAfterSeconds: 5,
  });
});

test("a failed telemetry delivery cannot alter the stable unavailable response", async () => {
  const student = await createStudent();
  await assert.rejects(
    initializeManifestSubmission(student.id, "telemetry-failure-key", {
      observeFailure: () => {
        throw new Error("telemetry unavailable");
      },
    }),
    AssessmentUnavailableError,
  );
  assert.equal(await prisma.submission.count({ where: { studentId: student.id } }), 0);
});

test("retries once when selected source evidence changes before persistence", async () => {
  const student = await createStudent();
  const questionIds: string[] = [];
  const order = nextSharedOrder();
  for (const category of ["PART_1", "PART_2", "PART_3"] as const) {
    const question = await prisma.question.create({
      data: {
        category,
        order,
        preparationSeconds: 20,
        recordingSeconds: 60,
        audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
        audioMimeType: "audio/webm",
        audioSizeBytes: 128,
        audioUploadStatus: "UPLOADED",
        tasks: { create: [{ promptText: `${category} task`, order: 1 }] },
      },
    });
    questionIds.push(question.id);
  }
  let mutated = false;
  const failures: unknown[] = [];
  const result = await initializeManifestSubmission(student.id, "retry-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => {
      if (!mutated) {
        mutated = true;
        await prisma.question.update({ where: { id: questionIds[0] }, data: { preparationSeconds: 99 } });
      }
      return `https://media.example/${encodeURIComponent(key)}`;
    },
    observeFailure: (event) => failures.push(event),
  });
  assert.equal(mutated, true);
  assert.equal(result.entries.length, 3);
  assert.equal(result.entries[0]?.preparationSeconds, 99);
});

test("aggregates selected signing failures and retries the same start intent", async () => {
  const student = await createStudent();
  const order = nextSharedOrder();
  for (const category of ["PART_1", "PART_2", "PART_3"] as const) {
    const storageKey = `questions/${crypto.randomUUID()}/prompt.webm`;
    await prisma.question.create({
      data: {
        category,
        order,
        preparationSeconds: 20,
        recordingSeconds: 60,
        audioStorageKey: storageKey,
        audioMimeType: "audio/webm",
        audioSizeBytes: 128,
        audioUploadStatus: "UPLOADED",
        tasks: { create: [{ promptText: `${category} task`, order: 1 }] },
      },
    });
  }
  let recovered = false;
  const failures: unknown[] = [];
  const signPromptMedia = async (key: string) => {
    if (!recovered) throw new Error(`signer secret for ${key}`);
    return `https://media.example/${encodeURIComponent(key)}`;
  };

  await assert.rejects(
    initializeManifestSubmission(student.id, "signing-retry-key", {
      chooseIndex: () => 0,
      signPromptMedia,
      observeFailure: (event) => failures.push(event),
    }),
    AssessmentUnavailableError,
  );
  assert.equal(await prisma.submission.count({ where: { studentId: student.id } }), 0);
  assert.equal(await prisma.submissionStartIntent.count({ where: { idempotencyKey: "signing-retry-key" } }), 0);
  assert.equal(failures.length, 1);
  const signingFailure = failures[0] as {
    failureCount: number;
    internalReason: string;
    failedQuestionIds: string[];
    failedCategories: string[];
  };
  assert.equal(signingFailure.failureCount, 3);
  assert.equal(signingFailure.internalReason, "PROMPT_MEDIA_SIGNING_FAILED");
  assert.equal(signingFailure.failedQuestionIds.length, 3);
  assert.deepEqual(signingFailure.failedCategories, ["PART_1", "PART_2", "PART_3"]);
  assert.deepEqual(
    (failures[0] as { failedEntries: Array<{ category: string; reason: string }> }).failedEntries
      .map(({ category, reason }) => ({ category, reason })),
    [
      { category: "PART_1", reason: "SIGNING_FAILED" },
      { category: "PART_2", reason: "SIGNING_FAILED" },
      { category: "PART_3", reason: "SIGNING_FAILED" },
    ],
  );

  recovered = true;
  const result = await initializeManifestSubmission(student.id, "signing-retry-key", {
    chooseIndex: () => 0,
    signPromptMedia,
  });
  assert.equal(result.entries.length, 3);
  assert.equal(await prisma.submission.count({ where: { studentId: student.id } }), 1);
});

test("resume maps Prompt media signing failure to Assessment unavailable", async () => {
  const student = await createStudent();
  const order = nextSharedOrder();
  for (const category of ["PART_1", "PART_2", "PART_3"] as const) {
    await prisma.question.create({
      data: {
        category,
        order,
        preparationSeconds: 20,
        recordingSeconds: 60,
        audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
        audioMimeType: "audio/webm",
        audioSizeBytes: 128,
        audioUploadStatus: "UPLOADED",
        tasks: { create: [{ promptText: `${category} task`, order: 1 }] },
      },
    });
  }
  await initializeManifestSubmission(student.id, "resume-failure-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });

  await assert.rejects(
    resumeManifestSubmission(student.id, {
      signPromptMedia: async () => {
        throw new Error("signer unavailable");
      },
    }),
    AssessmentUnavailableError,
  );
  await assert.rejects(
    resumeManifestSubmission(student.id, {
      deadline: Date.now() + 20,
      signPromptMedia: async () => new Promise<string>(() => {}),
    }),
    AssessmentUnavailableError,
  );
});

test("student prompt media is limited to the active submission manifest", async () => {
  const adminEmail = `${crypto.randomUUID()}@example.test`;
  const [student, otherStudent, admin] = await Promise.all([
    createStudent(),
    createStudent(),
    prisma.user.create({
      data: {
        username: uniqueUsername("admin"),
        email: adminEmail,
        normalizedEmail: adminEmail,
        password: "unused",
        role: "ADMIN",
      },
    }),
  ]);
  const questions = await Promise.all(([
    "PART_1", "PART_2", "PART_3",
  ] as const).map((category) => prisma.question.create({
    data: {
      category,
      order: nextSharedOrder(),
      createdById: admin.id,
      audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
      audioMimeType: "audio/webm",
      audioSizeBytes: 128,
      audioUploadStatus: "UPLOADED",
      tasks: { create: { promptText: "Describe the scene.", order: 1 } },
    },
  })));
  const tasks = await Promise.all(questions.map((question) =>
    prisma.task.findFirstOrThrow({ where: { questionId: question.id } }),
  ));
  const entryIds: string[] = [];
  const submission = await prisma.$transaction(async (tx: any) => {
    const created = await tx.submission.create({
      data: { studentId: student.id, status: "IN_PROGRESS" },
    });
    const manifest = await tx.submissionManifest.create({
      data: { submissionId: created.id, version: 1 },
    });
    for (const [index, question] of questions.entries()) {
      const entry = await tx.manifestEntry.create({
        data: {
          manifestId: manifest.id,
          submissionId: created.id,
          category: question.category,
          deliveryPosition: index + 1,
          sourceQuestionId: question.id,
          preparationSeconds: 20,
          recordingSeconds: 60,
          promptMediaStorageKey: question.audioStorageKey!,
          promptMediaMimeType: question.audioMimeType!,
          promptMediaSizeBytes: question.audioSizeBytes!,
        },
      });
      await tx.manifestTask.create({
        data: {
          manifestEntryId: entry.id,
          sourceQuestionId: question.id,
          sourceTaskId: tasks[index]!.id,
          deliveredOrder: 1,
          deliveredText: "Describe the scene.",
        },
      });
      entryIds.push(entry.id);
    }
    return created;
  });
  const cookie = (id: string) => `jwt=${jwt.sign({ id }, process.env.JWT_SECRET!)}`;
  const anonymousQuestionBank = await fetch(`${baseUrl}/api/questions`);
  assert.equal(anonymousQuestionBank.status, 401);
  const studentQuestionBank = await fetch(`${baseUrl}/api/questions`, { headers: { Cookie: cookie(student.id) } });
  assert.equal(studentQuestionBank.status, 403);
  const anonymousAdminBank = await fetch(`${baseUrl}/api/questions/admin`);
  assert.equal(anonymousAdminBank.status, 401);
  const anonymous = await fetch(`${baseUrl}/api/submissions/${submission.id}/prompts/${entryIds[0]}`);
  assert.equal(anonymous.status, 401);
  const crossAttempt = await fetch(`${baseUrl}/api/submissions/${submission.id}/prompts/${entryIds[0]}`, { headers: { Cookie: cookie(otherStudent.id) } });
  assert.equal(crossAttempt.status, 404);
  const unassigned = await fetch(`${baseUrl}/api/submissions/${submission.id}/prompts/${crypto.randomUUID()}`, { headers: { Cookie: cookie(student.id) } });
  assert.equal(unassigned.status, 404);
  const valid = await fetch(`${baseUrl}/api/submissions/${submission.id}/prompts/${entryIds[0]}`, { headers: { Cookie: cookie(student.id) } });
  assert.equal(valid.status, 200);
  const payload = await valid.json();
  assert.match(payload.data.url, /^https:\/\//);
  assert.equal(JSON.stringify(payload).includes("storageKey"), false);
});

test("a closed idempotency key cannot replay an abandoned Submission", async () => {
  const student = await createStudent();
  const first = await initializeManifestSubmission(student.id, "replay-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  const abandoned = await (await import("../../src/service/submission.service.js")).abandonSubmission(
    first.submissionId,
    student.id,
  );
  assert.equal(abandoned.status, "ABANDONED");
  const repeated = await (await import("../../src/service/submission.service.js")).abandonSubmission(
    first.submissionId,
    student.id,
  );
  assert.equal(repeated.status, "ABANDONED");

  await assert.rejects(
    initializeManifestSubmission(student.id, "replay-key", {
      signPromptMedia: async () => {
        throw new Error("closed intents must not sign prompt media");
      },
    }),
    (error: unknown) => error instanceof AssessmentStartIntentClosedError && error.submissionStatus === "ABANDONED",
  );

  const fresh = await initializeManifestSubmission(student.id, "fresh-replay-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/fresh/${encodeURIComponent(key)}`,
  });
  assert.notEqual(fresh.submissionId, first.submissionId);
  assert.equal(await prisma.submission.count({ where: { studentId: student.id } }), 2);
});

test("allows a new start while earlier Submissions are in payment or scoring", async () => {
  const student = await createStudent();
  const order = nextSharedOrder();
  for (const category of ["PART_1", "PART_2", "PART_3"] as const) {
    await prisma.question.create({
      data: {
        category,
        order,
        preparationSeconds: 20,
        recordingSeconds: 60,
        audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
        audioMimeType: "audio/webm",
        audioSizeBytes: 128,
        audioUploadStatus: "UPLOADED",
        tasks: { create: [{ promptText: `${category} task`, order: 1 }] },
      },
    });
  }
  const first = await initializeManifestSubmission(student.id, "pipeline-first-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });

  const ids = [first.submissionId];
  for (const status of ["AWAITING_PAYMENT", "PAID", "SCORING"] as const) {
    await prisma.submission.update({
      where: { id: ids[ids.length - 1] },
      data: { status },
    });
    const next = await initializeManifestSubmission(student.id, `retake-key-${status}`, {
      chooseIndex: () => 0,
      signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
    });
    assert.ok(!ids.includes(next.submissionId));
    ids.push(next.submissionId);
  }

  // The latest start is IN_PROGRESS: another intent resumes it, never duplicates it.
  await assert.rejects(
    initializeManifestSubmission(student.id, "retake-while-active", {
      chooseIndex: () => 0,
      signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
    }),
    (error: unknown) =>
      error instanceof ActiveSubmissionConflictError &&
      error.submissionId === ids[ids.length - 1],
  );
  assert.equal(await prisma.submission.count({ where: { studentId: student.id } }), 4);
});

test("rejects reuse of an idempotency key by another student", async () => {
  const other = await createStudent();
  await assert.rejects(
    initializeManifestSubmission(other.id, "replay-key", {
      signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
    }),
    IdempotencyKeyConflictError,
  );
});

test("classifies a concurrent different-key start as an active Submission conflict", async () => {
  const student = await createStudent();
  const start = (key: string) => initializeManifestSubmission(student.id, key, {
    chooseIndex: () => 0,
    signPromptMedia: async (storageKey) => `https://media.example/${encodeURIComponent(storageKey)}`,
  });

  const results = await Promise.allSettled([start("concurrent-key-a"), start("concurrent-key-b")]);
  const fulfilled = results.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof start>>> => result.status === "fulfilled");
  const rejected = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0]?.reason instanceof ActiveSubmissionConflictError, true);
  assert.equal(await prisma.submission.count({ where: { studentId: student.id, status: "IN_PROGRESS" } }), 1);
});

/**
 * Create one question per category for each given order. `order` identifies a
 * question set shared across categories, so every order here exists in all
 * three categories unless a test deliberately omits one.
 */
async function createUploadedBank(taskText: string, orders: number[] = [nextSharedOrder()]) {
  // The bank is shared across the whole test file; retire everything first so
  // each new test binds deterministically to the questions it creates.
  await prisma.question.updateMany({ data: { deletedAt: new Date() } });
  for (const order of orders) {
    for (const category of ["PART_1", "PART_2", "PART_3"] as const) {
      await prisma.question.create({
        data: {
          category,
          order,
          preparationSeconds: 20,
          recordingSeconds: 60,
          audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
          audioMimeType: "audio/webm",
          audioSizeBytes: 128,
          audioUploadStatus: "UPLOADED",
          tasks: { create: [{ promptText: `${category} ${taskText}`, order: 1 }] },
        },
      });
    }
  }
}

async function editBankTasks(manifestId: string, promptText: string) {
  const entries = await prisma.manifestEntry.findMany({
    where: { manifestId },
    select: { sourceQuestionId: true },
  });
  await prisma.task.updateMany({
    where: { questionId: { in: entries.map((entry) => entry.sourceQuestionId) } },
    data: { promptText },
  });
}

async function manifestTaskTexts(manifestId: string) {
  const tasks = await prisma.manifestTask.findMany({
    where: { manifestEntry: { manifestId } },
    orderBy: { deliveredOrder: "asc" },
    select: { deliveredText: true },
  });
  return tasks.map((task) => task.deliveredText);
}

async function manifestSourceOrders(manifestId: string) {
  const entries = await prisma.manifestEntry.findMany({
    where: { manifestId },
    select: { sourceQuestion: { select: { order: true } } },
  });
  return entries.map((entry) => entry.sourceQuestion.order);
}

test("delivery uses one shared order across every category", async () => {
  const firstOrder = ++sharedOrderCounter;
  const secondOrder = ++sharedOrderCounter;
  await createUploadedBank("bank task", [firstOrder, secondOrder]);

  const lowest = await initializeManifestSubmission((await createStudent()).id, "shared-order-low-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  assert.deepEqual(await manifestSourceOrders(lowest.manifestId), [firstOrder, firstOrder, firstOrder]);

  const highest = await initializeManifestSubmission((await createStudent()).id, "shared-order-high-key", {
    chooseIndex: (length) => length - 1,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  assert.deepEqual(await manifestSourceOrders(highest.manifestId), [secondOrder, secondOrder, secondOrder]);
});

test("an order missing from any category is not eligible for delivery", async () => {
  const commonOrder = ++sharedOrderCounter;
  const partialOrder = ++sharedOrderCounter;
  await createUploadedBank("bank task", [commonOrder]);
  // Add a second order that exists in only two of the three categories.
  for (const category of ["PART_1", "PART_2"] as const) {
    await prisma.question.create({
      data: {
        category,
        order: partialOrder,
        preparationSeconds: 20,
        recordingSeconds: 60,
        audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
        audioMimeType: "audio/webm",
        audioSizeBytes: 128,
        audioUploadStatus: "UPLOADED",
        tasks: { create: [{ promptText: `${category} partial`, order: 1 }] },
      },
    });
  }

  // The highest index would pick partialOrder if a category-mixed set were
  // allowed; only the common order is eligible, so it must be chosen instead.
  const result = await initializeManifestSubmission((await createStudent()).id, "partial-order-key", {
    chooseIndex: (length) => length - 1,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  assert.deepEqual(
    await manifestSourceOrders(result.manifestId),
    [commonOrder, commonOrder, commonOrder],
  );
});

test("no order shared by every category makes the assessment unavailable", async () => {
  const student = await createStudent();
  const firstOrder = ++sharedOrderCounter;
  const secondOrder = ++sharedOrderCounter;
  await createUploadedBank("bank task", [firstOrder]);
  // Only PART_3 gets the second order, so no order spans all categories.
  await prisma.question.updateMany({ where: { order: firstOrder, category: "PART_3" }, data: { deletedAt: new Date() } });
  await prisma.question.create({
    data: {
      category: "PART_3",
      order: secondOrder,
      preparationSeconds: 20,
      recordingSeconds: 60,
      audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
      audioMimeType: "audio/webm",
      audioSizeBytes: 128,
      audioUploadStatus: "UPLOADED",
      tasks: { create: [{ promptText: "PART_3 second", order: 1 }] },
    },
  });

  await assert.rejects(
    initializeManifestSubmission(student.id, "no-common-order-key", {
      chooseIndex: () => 0,
      signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
    }),
    AssessmentUnavailableError,
  );
  assert.equal(await prisma.submission.count({ where: { studentId: student.id } }), 0);
});

test("a stale attempt is superseded so the next start delivers the edited question bank", async () => {
  const student = await createStudent();
  await createUploadedBank("original task");
  const first = await initializeManifestSubmission(student.id, "universal-first-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  assert.deepEqual(
    await manifestTaskTexts(first.manifestId),
    ["PART_1 original task", "PART_2 original task", "PART_3 original task"],
  );

  // The admin edits the universal bank after the student's empty attempt.
  await editBankTasks(first.manifestId, "PART_X edited task");

  const second = await initializeManifestSubmission(student.id, "universal-second-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  assert.notEqual(second.submissionId, first.submissionId);
  assert.deepEqual(
    await manifestTaskTexts(second.manifestId),
    ["PART_X edited task", "PART_X edited task", "PART_X edited task"],
  );
  assert.equal(
    (await prisma.submission.findUnique({ where: { id: first.submissionId }, select: { status: true } }))?.status,
    "ABANDONED",
  );
  assert.equal(await prisma.submission.count({ where: { studentId: student.id, status: "IN_PROGRESS" } }), 1);
});

test("an unfinished attempt stays resumable while the question bank is unchanged", async () => {
  const student = await createStudent();
  await createUploadedBank("original task");
  const first = await initializeManifestSubmission(student.id, "tied-first-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  const entry = await prisma.manifestEntry.findFirstOrThrow({ where: { manifestId: first.manifestId } });
  await prisma.answer.create({
    data: { submissionId: first.submissionId, manifestEntryId: entry.id, storageKey: `answers/${crypto.randomUUID()}.webm` },
  });

  await assert.rejects(
    initializeManifestSubmission(student.id, "tied-second-key", {
      chooseIndex: () => 0,
      signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
    }),
    (error: unknown) => error instanceof ActiveSubmissionConflictError && error.submissionId === first.submissionId,
  );
  assert.equal(
    (await prisma.submission.findUnique({ where: { id: first.submissionId }, select: { status: true } }))?.status,
    "IN_PROGRESS",
  );
  const resumed = await resumeManifestSubmission(student.id, {
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  assert.equal(resumed.submissionId, first.submissionId);
  assert.deepEqual(
    resumed.entries.flatMap((entry) => entry.tasks.map((task) => task.promptText)),
    ["PART_1 original task", "PART_2 original task", "PART_3 original task"],
  );
});

test("a retired question supersedes a partially answered attempt with the current bank", async () => {
  const student = await createStudent();
  await createUploadedBank("original task");
  const first = await initializeManifestSubmission(student.id, "retired-first-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  const boundEntry = await prisma.manifestEntry.findFirstOrThrow({ where: { manifestId: first.manifestId } });
  const retiredQuestionId = boundEntry.sourceQuestionId;
  const retiredQuestion = await prisma.question.findUniqueOrThrow({
    where: { id: retiredQuestionId },
    select: { order: true },
  });
  await prisma.answer.create({
    data: {
      submissionId: first.submissionId,
      manifestEntryId: boundEntry.id,
      storageKey: `answers/${crypto.randomUUID()}.webm`,
    },
  });

  // The admin retires a delivered question and publishes its replacement in
  // the same order so that order remains available across every category.
  await prisma.question.update({
    where: { id: retiredQuestionId },
    data: { deletedAt: new Date() },
  });
  await prisma.question.create({
    data: {
      category: boundEntry.category,
      order: retiredQuestion.order,
      preparationSeconds: 20,
      recordingSeconds: 60,
      audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
      audioMimeType: "audio/webm",
      audioSizeBytes: 128,
      audioUploadStatus: "UPLOADED",
      tasks: { create: [{ promptText: "replacement task", order: 1 }] },
    },
  });

  const second = await initializeManifestSubmission(student.id, "retired-second-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  assert.notEqual(second.submissionId, first.submissionId);
  const secondSources = await prisma.manifestEntry.findMany({
    where: { manifestId: second.manifestId },
    select: { sourceQuestionId: true },
  });
  assert.equal(secondSources.some((entry) => entry.sourceQuestionId === retiredQuestionId), false);
  assert.equal(
    (await prisma.submission.findUnique({ where: { id: first.submissionId }, select: { status: true } }))?.status,
    "ABANDONED",
  );
  // The superseded attempt keeps its recorded evidence as retained history.
  assert.equal(await prisma.answer.count({ where: { submissionId: first.submissionId } }), 1);
  assert.equal(await prisma.submission.count({ where: { studentId: student.id, status: "IN_PROGRESS" } }), 1);
});

test("a stale idempotent replay of an answer-less attempt delivers the edited bank", async () => {
  const student = await createStudent();
  await createUploadedBank("original task");
  const first = await initializeManifestSubmission(student.id, "stale-replay-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });

  await editBankTasks(first.manifestId, "PART_X edited task");

  const replayed = await initializeManifestSubmission(student.id, "stale-replay-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  assert.notEqual(replayed.submissionId, first.submissionId);
  assert.deepEqual(
    await manifestTaskTexts(replayed.manifestId),
    ["PART_X edited task", "PART_X edited task", "PART_X edited task"],
  );
  const intent = await prisma.submissionStartIntent.findUniqueOrThrow({
    where: { idempotencyKey: "stale-replay-key" },
    select: { submissionId: true },
  });
  assert.equal(intent.submissionId, replayed.submissionId);
  assert.equal(
    (await prisma.submission.findUnique({ where: { id: first.submissionId }, select: { status: true } }))?.status,
    "ABANDONED",
  );
});

test("an unchanged bank replays the same attempt for a repeated start key", async () => {
  const student = await createStudent();
  await createUploadedBank("original task");
  const first = await initializeManifestSubmission(student.id, "resume-replay-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  const replayed = await initializeManifestSubmission(student.id, "resume-replay-key", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  assert.equal(replayed.submissionId, first.submissionId);
  assert.equal(replayed.manifestId, first.manifestId);
  assert.equal(await prisma.submission.count({ where: { studentId: student.id } }), 1);
});

test("http start supersedes a stale unfinished attempt and active serves the edited bank", async () => {
  const student = await createStudent();
  await createUploadedBank("original task");
  const cookie = `jwt=${jwt.sign({ id: student.id }, process.env.JWT_SECRET!)}`;
  const start = (key: string) =>
    fetch(`${baseUrl}/api/submissions`, {
      method: "POST",
      headers: { Cookie: cookie, "Idempotency-Key": key, "Content-Type": "application/json" },
    });

  const firstResponse = await start("http-stale-key");
  assert.equal(firstResponse.status, 201);
  const first = (await firstResponse.json()).data;
  const boundEntry = await prisma.manifestEntry.findFirstOrThrow({ where: { manifestId: first.manifestId } });
  const boundQuestion = await prisma.question.findUniqueOrThrow({
    where: { id: boundEntry.sourceQuestionId },
    select: { order: true },
  });
  // The student has already recorded one answer but has not finished the test.
  await prisma.answer.create({
    data: {
      submissionId: first.submissionId,
      manifestEntryId: boundEntry.id,
      storageKey: `answers/${crypto.randomUUID()}.webm`,
    },
  });

  // The admin retires a delivered question and replaces it in the same order.
  await prisma.question.update({ where: { id: boundEntry.sourceQuestionId }, data: { deletedAt: new Date() } });
  await prisma.question.create({
    data: {
      category: boundEntry.category,
      order: boundQuestion.order,
      preparationSeconds: 20,
      recordingSeconds: 60,
      audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
      audioMimeType: "audio/webm",
      audioSizeBytes: 128,
      audioUploadStatus: "UPLOADED",
      tasks: { create: [{ promptText: "replacement task", order: 1 }] },
    },
  });

  const secondResponse = await start("http-stale-key-2");
  assert.equal(secondResponse.status, 201);
  const second = (await secondResponse.json()).data;
  assert.notEqual(second.submissionId, first.submissionId);
  const secondSources = await prisma.manifestEntry.findMany({
    where: { manifestId: second.manifestId },
    select: { sourceQuestionId: true },
  });
  assert.equal(secondSources.length, 3);
  assert.equal(secondSources.some((entry) => entry.sourceQuestionId === boundEntry.sourceQuestionId), false);

  const activeResponse = await fetch(`${baseUrl}/api/submissions/active`, { headers: { Cookie: cookie } });
  assert.equal(activeResponse.status, 200);
  assert.equal((await activeResponse.json()).data.submissionId, second.submissionId);
});

