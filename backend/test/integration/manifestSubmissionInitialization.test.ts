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
import { SLOTS, createFixtureTestSet, deliverableContent, manifestTestSetData, type Slot } from "../fixtures/testSets.js";

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

/** Create one Eligible question in the given Test Set slot. */
async function createEligibleQuestion(testSetId: string, category: Slot, promptText: string) {
  return prisma.question.create({
    data: {
      category,
      testSetId,
      preparationSeconds: 20,
      recordingSeconds: 60,
      audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
      audioMimeType: "audio/webm",
      audioSizeBytes: 128,
      audioUploadStatus: "UPLOADED",
      ...deliverableContent(category),
      tasks: { create: [{ promptText, order: 1 }] },
    },
  });
}

/**
 * Create a fresh Test Set with one Eligible question in each given slot
 * (every slot by default, which makes the Test Set deliverable).
 */
async function createTestSetQuestions(taskText: string, slots: readonly Slot[] = SLOTS) {
  const testSet = await createFixtureTestSet(prisma, "INIT");
  const questions: Array<{ id: string; category: Slot }> = [];
  for (const category of slots) {
    questions.push(await createEligibleQuestion(testSet.id, category, `${category} ${taskText}`));
  }
  return { testSet, questions };
}

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

test("initialization selects one eligible question per slot and persists a complete manifest", async () => {
  const student = await createStudent();
  const { questions } = await createTestSetQuestions("task");
  assert.equal(questions.length, 5);

  const result = await initializeManifestSubmission(student.id, "start-key-1", {
    chooseIndex: () => 0,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  assert.equal(result.entries.length, 5);
  assert.deepEqual(result.entries.map((entry) => entry.deliveryPosition), [1, 2, 3, 4, 5]);
  assert.equal(await prisma.submission.count({ where: { id: result.submissionId } }), 1);
  assert.equal(await prisma.manifestEntry.count({ where: { manifestId: result.manifestId } }), 5);
  assert.equal(await prisma.manifestTask.count({ where: { manifestEntry: { manifestId: result.manifestId } } }), 5);
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
  assert.equal(result.entries.length, 5);
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
      categoryCount: 5,
      failureCount: 1,
      failedQuestionIds: [],
      failedCategories: [...SLOTS],
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
  const questionIds = (await createTestSetQuestions("task")).questions.map(({ id }) => id);
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
  assert.equal(result.entries.length, 5);
  assert.equal(result.entries[0]?.preparationSeconds, 99);
});

test("aggregates selected signing failures and retries the same start intent", async () => {
  const student = await createStudent();
  await createTestSetQuestions("task");
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
  assert.equal(signingFailure.failureCount, 5);
  assert.equal(signingFailure.internalReason, "PROMPT_MEDIA_SIGNING_FAILED");
  assert.equal(signingFailure.failedQuestionIds.length, 5);
  assert.deepEqual(signingFailure.failedCategories, [...SLOTS]);
  assert.deepEqual(
    (failures[0] as { failedEntries: Array<{ category: string; reason: string }> }).failedEntries
      .map(({ category, reason }) => ({ category, reason })),
    SLOTS.map((category) => ({ category, reason: "SIGNING_FAILED" })),
  );

  recovered = true;
  const result = await initializeManifestSubmission(student.id, "signing-retry-key", {
    chooseIndex: () => 0,
    signPromptMedia,
  });
  assert.equal(result.entries.length, 5);
  assert.equal(await prisma.submission.count({ where: { studentId: student.id } }), 1);
});

test("resume maps Prompt media signing failure to Assessment unavailable", async () => {
  const student = await createStudent();
  await createTestSetQuestions("task");
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
  const testSet = await createFixtureTestSet(prisma, "MEDIA");
  const questions = await Promise.all(SLOTS.map((category) => prisma.question.create({
    data: {
      category,
      testSetId: testSet.id,
      createdById: admin.id,
      audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
      audioMimeType: "audio/webm",
      audioSizeBytes: 128,
      audioUploadStatus: "UPLOADED",
      ...deliverableContent(category),
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
      data: { submissionId: created.id, ...manifestTestSetData(testSet) },
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
  await createTestSetQuestions("task");
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
 * Retire the whole shared bank, then create `count` fresh deliverable Test
 * Sets, so each test binds deterministically to the questions it creates.
 */
async function createUploadedBank(taskText: string, count = 1) {
  await prisma.question.updateMany({ data: { deletedAt: new Date() } });
  const testSets: Array<{ id: string; code: string }> = [];
  for (let index = 0; index < count; index += 1) {
    testSets.push((await createTestSetQuestions(taskText)).testSet);
  }
  return testSets;
}

const signPromptMedia = async (key: string) => `https://media.example/${encodeURIComponent(key)}`;

async function editBankTasks(manifestId: string, promptText: string) {
  const entries = await prisma.manifestEntry.findMany({
    where: { manifestId },
    select: { sourceQuestionId: true },
  });
  await prisma.task.updateMany({
    where: { questionId: { in: entries.map((entry: { sourceQuestionId: string }) => entry.sourceQuestionId) } },
    data: { promptText },
  });
}

async function manifestTaskTexts(manifestId: string) {
  const tasks = await prisma.manifestTask.findMany({
    where: { manifestEntry: { manifestId } },
    orderBy: { manifestEntry: { deliveryPosition: "asc" } },
    select: { deliveredText: true },
  });
  return tasks.map((task: { deliveredText: string }) => task.deliveredText);
}

/** Test Set of each delivered source question, in delivery order. */
async function manifestSourceTestSetIds(manifestId: string) {
  const entries = await prisma.manifestEntry.findMany({
    where: { manifestId },
    orderBy: { deliveryPosition: "asc" },
    select: { sourceQuestion: { select: { testSetId: true } } },
  });
  return entries.map((entry: { sourceQuestion: { testSetId: string } }) => entry.sourceQuestion.testSetId);
}

const editedTexts = SLOTS.map(() => "PART_X edited task");
const originalTexts = SLOTS.map((category) => `${category} original task`);

test("a deliverable Test Set yields a version 2 manifest with all five slots in delivery order", async () => {
  const [testSet] = await createUploadedBank("five slot task");
  const result = await initializeManifestSubmission((await createStudent()).id, "five-slot-key", {
    chooseIndex: () => 0,
    signPromptMedia,
  });
  assert.equal(result.version, 2);
  assert.deepEqual(result.testSet, { id: testSet!.id, code: testSet!.code });
  assert.deepEqual(result.entries.map((entry) => entry.category), [...SLOTS]);
  assert.deepEqual(result.entries.map((entry) => entry.deliveryPosition), [1, 2, 3, 4, 5]);

  const manifest = await prisma.submissionManifest.findUniqueOrThrow({
    where: { id: result.manifestId },
    select: { version: true, testSetId: true, testSetCode: true },
  });
  assert.deepEqual(manifest, { version: 2, testSetId: testSet!.id, testSetCode: testSet!.code });
  const persisted = await prisma.manifestEntry.findMany({
    where: { manifestId: result.manifestId },
    orderBy: { deliveryPosition: "asc" },
    select: { category: true, deliveryPosition: true },
  });
  assert.deepEqual(persisted, SLOTS.map((category, index) => ({ category, deliveryPosition: index + 1 })));
  assert.deepEqual(await manifestSourceTestSetIds(result.manifestId), SLOTS.map(() => testSet!.id));
});

test("delivery uses one Test Set across every slot", async () => {
  const testSets = await createUploadedBank("bank task", 2);
  const [lowId, highId] = testSets.map(({ id }) => id).sort();

  const lowest = await initializeManifestSubmission((await createStudent()).id, "test-set-low-key", {
    chooseIndex: () => 0,
    signPromptMedia,
  });
  assert.equal(lowest.testSet?.id, lowId);
  assert.deepEqual(await manifestSourceTestSetIds(lowest.manifestId), SLOTS.map(() => lowId));

  const highest = await initializeManifestSubmission((await createStudent()).id, "test-set-high-key", {
    chooseIndex: (length) => length - 1,
    signPromptMedia,
  });
  assert.equal(highest.testSet?.id, highId);
  assert.deepEqual(await manifestSourceTestSetIds(highest.manifestId), SLOTS.map(() => highId));
});

test("a Test Set missing one slot is never delivered while a complete Test Set is", async () => {
  const [complete] = await createUploadedBank("bank task");
  // A second Test Set fills every slot except PART_4.
  const partial = await createTestSetQuestions("partial", SLOTS.filter((slot) => slot !== "PART_4"));

  for (const [key, chooseIndex] of [
    ["partial-test-set-low-key", () => 0],
    ["partial-test-set-high-key", (length: number) => length - 1],
  ] as const) {
    const lengths: number[] = [];
    const result = await initializeManifestSubmission((await createStudent()).id, key, {
      chooseIndex: (length) => {
        lengths.push(length);
        return chooseIndex(length);
      },
      signPromptMedia,
    });
    // Only the complete Test Set is a delivery candidate.
    assert.deepEqual(lengths, [1]);
    assert.equal(result.testSet?.id, complete!.id);
    assert.notEqual(result.testSet?.id, partial.testSet.id);
    assert.deepEqual(await manifestSourceTestSetIds(result.manifestId), SLOTS.map(() => complete!.id));
  }
});

test("questions from different Test Sets are never mixed to cover every slot", async () => {
  const student = await createStudent();
  await prisma.question.updateMany({ data: { deletedAt: new Date() } });
  // Together these two Test Sets cover all five slots, but neither alone does.
  await createTestSetQuestions("first", SLOTS.filter((slot) => slot !== "PART_4"));
  await createTestSetQuestions("second", ["PART_4"]);

  const failures: unknown[] = [];
  await assert.rejects(
    initializeManifestSubmission(student.id, "mixed-test-set-key", {
      chooseIndex: () => 0,
      signPromptMedia,
      observeFailure: (event) => failures.push(event),
    }),
    AssessmentUnavailableError,
  );
  assert.equal(await prisma.submission.count({ where: { studentId: student.id } }), 0);
  assert.equal(failures.length, 1);
  assert.equal((failures[0] as { internalReason: string }).internalReason, "QUESTION_BANK_INCOMPLETE");
});

test("a stale attempt is superseded so the next start delivers the edited question bank", async () => {
  const student = await createStudent();
  await createUploadedBank("original task");
  const first = await initializeManifestSubmission(student.id, "universal-first-key", {
    chooseIndex: () => 0,
    signPromptMedia,
  });
  assert.deepEqual(await manifestTaskTexts(first.manifestId), originalTexts);

  // The admin edits the bank after the student's empty attempt.
  await editBankTasks(first.manifestId, "PART_X edited task");

  const second = await initializeManifestSubmission(student.id, "universal-second-key", {
    chooseIndex: () => 0,
    signPromptMedia,
  });
  assert.notEqual(second.submissionId, first.submissionId);
  assert.deepEqual(await manifestTaskTexts(second.manifestId), editedTexts);
  assert.equal(
    (await prisma.submission.findUnique({ where: { id: first.submissionId }, select: { status: true } }))?.status,
    "ABANDONED",
  );
  assert.equal(await prisma.submission.count({ where: { studentId: student.id, status: "IN_PROGRESS" } }), 1);
});

test("an unfinished attempt stays resumable while the question bank is unchanged", async () => {
  const student = await createStudent();
  const [testSet] = await createUploadedBank("original task");
  const first = await initializeManifestSubmission(student.id, "tied-first-key", {
    chooseIndex: () => 0,
    signPromptMedia,
  });
  const entry = await prisma.manifestEntry.findFirstOrThrow({ where: { manifestId: first.manifestId } });
  await prisma.answer.create({
    data: { submissionId: first.submissionId, manifestEntryId: entry.id, storageKey: `answers/${crypto.randomUUID()}.webm` },
  });

  await assert.rejects(
    initializeManifestSubmission(student.id, "tied-second-key", {
      chooseIndex: () => 0,
      signPromptMedia,
    }),
    (error: unknown) => error instanceof ActiveSubmissionConflictError && error.submissionId === first.submissionId,
  );
  assert.equal(
    (await prisma.submission.findUnique({ where: { id: first.submissionId }, select: { status: true } }))?.status,
    "IN_PROGRESS",
  );
  const resumed = await resumeManifestSubmission(student.id, { signPromptMedia });
  assert.equal(resumed.submissionId, first.submissionId);
  assert.deepEqual(resumed.testSet, { id: testSet!.id, code: testSet!.code });
  assert.deepEqual(
    resumed.entries.flatMap((entry) => entry.tasks.map((task) => task.promptText)),
    originalTexts,
  );
});

test("an attempt whose delivered question moved to another Test Set is superseded, not resumed", async () => {
  const student = await createStudent();
  const [testSet] = await createUploadedBank("original task");
  const first = await initializeManifestSubmission(student.id, "moved-first-key", {
    chooseIndex: () => 0,
    signPromptMedia,
  });
  const movedEntry = await prisma.manifestEntry.findFirstOrThrow({
    where: { manifestId: first.manifestId, category: "PART_2" },
  });
  await prisma.answer.create({
    data: {
      submissionId: first.submissionId,
      manifestEntryId: movedEntry.id,
      storageKey: `answers/${crypto.randomUUID()}.webm`,
    },
  });
  // Unchanged so far: the attempt is resumable.
  assert.equal((await resumeManifestSubmission(student.id, { signPromptMedia })).submissionId, first.submissionId);

  // The admin moves the delivered PART_2 question into another Test Set and
  // fills the vacated slot so the original Test Set stays deliverable.
  const otherTestSet = await createFixtureTestSet(prisma, "MOVED");
  await prisma.question.update({
    where: { id: movedEntry.sourceQuestionId },
    data: { testSetId: otherTestSet.id },
  });
  await createEligibleQuestion(testSet!.id, "PART_2", "PART_2 replacement task");

  await assert.rejects(resumeManifestSubmission(student.id, { signPromptMedia }), AssessmentUnavailableError);

  const second = await initializeManifestSubmission(student.id, "moved-second-key", {
    chooseIndex: () => 0,
    signPromptMedia,
  });
  assert.notEqual(second.submissionId, first.submissionId);
  assert.equal(second.testSet?.id, testSet!.id);
  assert.deepEqual(await manifestSourceTestSetIds(second.manifestId), SLOTS.map(() => testSet!.id));
  const secondSources = await prisma.manifestEntry.findMany({
    where: { manifestId: second.manifestId },
    select: { sourceQuestionId: true },
  });
  assert.equal(
    secondSources.some((entry: { sourceQuestionId: string }) => entry.sourceQuestionId === movedEntry.sourceQuestionId),
    false,
  );
  assert.equal(
    (await prisma.submission.findUnique({ where: { id: first.submissionId }, select: { status: true } }))?.status,
    "ABANDONED",
  );
  assert.equal(await prisma.submission.count({ where: { studentId: student.id, status: "IN_PROGRESS" } }), 1);
});

test("a retired question supersedes a partially answered attempt with the current bank", async () => {
  const student = await createStudent();
  await createUploadedBank("original task");
  const first = await initializeManifestSubmission(student.id, "retired-first-key", {
    chooseIndex: () => 0,
    signPromptMedia,
  });
  const boundEntry = await prisma.manifestEntry.findFirstOrThrow({ where: { manifestId: first.manifestId } });
  const retiredQuestionId = boundEntry.sourceQuestionId;
  const retiredQuestion = await prisma.question.findUniqueOrThrow({
    where: { id: retiredQuestionId },
    select: { testSetId: true },
  });
  await prisma.answer.create({
    data: {
      submissionId: first.submissionId,
      manifestEntryId: boundEntry.id,
      storageKey: `answers/${crypto.randomUUID()}.webm`,
    },
  });

  // The admin retires a delivered question and publishes its replacement in
  // the same Test Set so that Test Set remains deliverable.
  await prisma.question.update({
    where: { id: retiredQuestionId },
    data: { deletedAt: new Date() },
  });
  await createEligibleQuestion(retiredQuestion.testSetId, boundEntry.category, "replacement task");

  const second = await initializeManifestSubmission(student.id, "retired-second-key", {
    chooseIndex: () => 0,
    signPromptMedia,
  });
  assert.notEqual(second.submissionId, first.submissionId);
  const secondSources = await prisma.manifestEntry.findMany({
    where: { manifestId: second.manifestId },
    select: { sourceQuestionId: true },
  });
  assert.equal(
    secondSources.some((entry: { sourceQuestionId: string }) => entry.sourceQuestionId === retiredQuestionId),
    false,
  );
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
    signPromptMedia,
  });

  await editBankTasks(first.manifestId, "PART_X edited task");

  const replayed = await initializeManifestSubmission(student.id, "stale-replay-key", {
    chooseIndex: () => 0,
    signPromptMedia,
  });
  assert.notEqual(replayed.submissionId, first.submissionId);
  assert.deepEqual(await manifestTaskTexts(replayed.manifestId), editedTexts);
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
  const [testSet] = await createUploadedBank("original task");
  const first = await initializeManifestSubmission(student.id, "resume-replay-key", {
    chooseIndex: () => 0,
    signPromptMedia,
  });
  const replayed = await initializeManifestSubmission(student.id, "resume-replay-key", {
    chooseIndex: () => 0,
    signPromptMedia,
  });
  assert.equal(replayed.submissionId, first.submissionId);
  assert.equal(replayed.manifestId, first.manifestId);
  assert.deepEqual(replayed.testSet, { id: testSet!.id, code: testSet!.code });
  assert.equal(await prisma.submission.count({ where: { studentId: student.id } }), 1);
});

test("http start supersedes a stale unfinished attempt and active serves the edited bank", async () => {
  const student = await createStudent();
  const [testSet] = await createUploadedBank("original task");
  const cookie = `jwt=${jwt.sign({ id: student.id }, process.env.JWT_SECRET!)}`;
  const start = (key: string) =>
    fetch(`${baseUrl}/api/submissions`, {
      method: "POST",
      headers: { Cookie: cookie, "Idempotency-Key": key, "Content-Type": "application/json" },
    });

  const firstResponse = await start("http-stale-key");
  assert.equal(firstResponse.status, 201);
  const first = (await firstResponse.json()).data;
  assert.deepEqual(first.testSet, { id: testSet!.id, code: testSet!.code });
  const boundEntry = await prisma.manifestEntry.findFirstOrThrow({ where: { manifestId: first.manifestId } });
  const boundQuestion = await prisma.question.findUniqueOrThrow({
    where: { id: boundEntry.sourceQuestionId },
    select: { testSetId: true },
  });
  // The student has already recorded one answer but has not finished the test.
  await prisma.answer.create({
    data: {
      submissionId: first.submissionId,
      manifestEntryId: boundEntry.id,
      storageKey: `answers/${crypto.randomUUID()}.webm`,
    },
  });

  // The admin retires a delivered question and replaces it in the same Test Set.
  await prisma.question.update({ where: { id: boundEntry.sourceQuestionId }, data: { deletedAt: new Date() } });
  await createEligibleQuestion(boundQuestion.testSetId, boundEntry.category, "replacement task");

  const secondResponse = await start("http-stale-key-2");
  assert.equal(secondResponse.status, 201);
  const second = (await secondResponse.json()).data;
  assert.notEqual(second.submissionId, first.submissionId);
  const secondSources = await prisma.manifestEntry.findMany({
    where: { manifestId: second.manifestId },
    select: { sourceQuestionId: true },
  });
  assert.equal(secondSources.length, 5);
  assert.equal(
    secondSources.some((entry: { sourceQuestionId: string }) => entry.sourceQuestionId === boundEntry.sourceQuestionId),
    false,
  );

  const activeResponse = await fetch(`${baseUrl}/api/submissions/active`, { headers: { Cookie: cookie } });
  assert.equal(activeResponse.status, 200);
  assert.equal((await activeResponse.json()).data.submissionId, second.submissionId);
});
