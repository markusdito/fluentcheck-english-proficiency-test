import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import crypto from "node:crypto";
import type { Server } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import type { Express } from "express";
import jwt from "jsonwebtoken";
import type { PrismaClient } from "../../src/generated/client.js";
import { SLOTS, createFixtureTestSet, deliverableContent, type Slot } from "../fixtures/testSets.js";

const execFileAsync = promisify(execFile);
const TEST_PASSWORD_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

type TaskResponse = {
  id: string;
  questionId?: string;
  promptText: string;
  order: number;
  deletedAt: string | null;
};

type QuestionResponse = {
  id: string;
  category: string;
  testSetId: string;
  testSet?: { id: string; code: string };
  preparationSeconds: number;
  recordingSeconds: number;
  deletedAt: string | null;
  tasks: TaskResponse[];
};

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: () => Promise<void>;
let app: Express;
let server: Server;
let baseUrl: string;
let adminId: string;

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
  process.env.JWT_SECRET = "question-lifecycle-integration-secret";
  process.env.R2_ACCOUNT_ID = "question-lifecycle-test-account";
  process.env.R2_ACCESS_KEY_ID = "question-lifecycle-test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "question-lifecycle-test-secret-key";
  process.env.R2_BUCKET_NAME = "question-lifecycle-test-bucket";
  process.env.FRONTEND_URL = "https://fluentcheck.example.test";

  await migrateDatabase(process.env.DATABASE_URL);

  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  const { createApp } = await import("../../src/server.js");
  app = createApp();
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Question lifecycle integration server did not bind");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  const email = `${crypto.randomUUID()}@example.test`;
  const admin = await prisma.user.create({
    data: {
      username: `question_admin_${crypto.randomUUID().replaceAll("-", "")}`,
      email,
      normalizedEmail: email,
      password: TEST_PASSWORD_HASH,
      role: "ADMIN",
    },
  });
  adminId = admin.id;
}, { timeout: 120_000 });

after(async () => {
  if (server) {
    server.close();
    await once(server, "close");
  }
  if (disconnectDB) await disconnectDB();
  if (container) await container.stop();
}, { timeout: 120_000 });

function cookieFor(userId = adminId) {
  return `jwt=${jwt.sign({ id: userId }, process.env.JWT_SECRET!)}`;
}

async function request(
  method: string,
  path: string,
  body?: Record<string, unknown>,
) {
  return requestAs(adminId, method, path, body);
}

async function requestAs(
  userId: string | undefined,
  method: string,
  path: string,
  body?: Record<string, unknown>,
) {
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      ...(userId ? { Cookie: cookieFor(userId) } : {}),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}


function newTestSet() {
  return createFixtureTestSet(prisma, "QL");
}

async function createQuestion(
  category: Slot,
  testSetId: string,
  tasks: Array<{ promptText: string; order: number }> = [],
) {
  const response = await request("POST", "/questions", {
    category,
    testSetId,
    tasks,
  });
  const body = await response.json() as { data?: QuestionResponse; error?: string };
  assert.equal(response.status, 201, JSON.stringify(body));
  return body.data!;
}

async function listQuestions(includeRetired = false) {
  const query = includeRetired ? "?includeRetired=true" : "";
  const response = await request("GET", `/questions/admin${query}`);
  assert.equal(response.status, 200);
  return (await response.json() as { data: QuestionResponse[] }).data;
}

function eligibleQuestionData(category: Slot, testSetId: string, promptText: string) {
  return {
    category,
    testSetId,
    createdById: adminId,
    audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
    audioMimeType: "audio/webm",
    audioSizeBytes: 1_024,
    audioUploadStatus: "UPLOADED" as const,
    ...deliverableContent(category),
    tasks: { create: { promptText, order: 1 } },
  };
}

test("Question creation without timings applies the slot defaults", async () => {
  const testSet = await newTestSet();
  const expected: Record<Slot, [number, number]> = {
    PART_1A: [10, 45],
    PART_1B: [10, 45],
    PART_2: [60, 90],
    PART_3: [60, 90],
    PART_4: [15, 60],
  };
  for (const slot of SLOTS) {
    const created = await createQuestion(slot, testSet.id);
    assert.equal(created.testSetId, testSet.id);
    assert.deepEqual(
      [created.preparationSeconds, created.recordingSeconds],
      expected[slot],
      slot,
    );
  }

  const overridden = await createQuestion("PART_4", (await newTestSet()).id);
  assert.deepEqual([overridden.preparationSeconds, overridden.recordingSeconds], [15, 60]);
  const explicitResponse = await request("POST", "/questions", {
    category: "PART_2",
    testSetId: (await newTestSet()).id,
    preparationSeconds: 30,
    recordingSeconds: 120,
  });
  assert.equal(explicitResponse.status, 201);
  const explicit = (await explicitResponse.json() as { data: QuestionResponse }).data;
  assert.deepEqual([explicit.preparationSeconds, explicit.recordingSeconds], [30, 120]);

  const listed = (await listQuestions()).filter((question) => question.testSetId === testSet.id);
  assert.deepEqual(listed.map((question) => question.category), [...SLOTS]);
  assert.ok(listed.every((question) =>
    question.testSet?.id === testSet.id && question.testSet.code === testSet.code));
});

test("a second active Question in the same Test Set slot returns 409", async () => {
  const testSet = await newTestSet();
  const first = await createQuestion("PART_1B", testSet.id);

  const duplicate = await request("POST", "/questions", {
    category: "PART_1B",
    testSetId: testSet.id,
  });
  assert.equal(duplicate.status, 409);
  assert.match(
    (await duplicate.json() as { error: string }).error,
    new RegExp(`Question position ${testSet.id}/PART_1B`),
  );

  // The same slot in another Test Set, and another slot in this Test Set, are free.
  await createQuestion("PART_1B", (await newTestSet()).id);
  await createQuestion("PART_1A", testSet.id);

  assert.deepEqual(
    (await prisma.question.findMany({
      where: { testSetId: testSet.id, category: "PART_1B", deletedAt: null },
      select: { id: true },
    })).map((row) => row.id),
    [first.id],
  );
});

test("Question creation with an unknown Test Set returns 404", async () => {
  for (const testSetId of [crypto.randomUUID(), "not-a-test-set"]) {
    const response = await request("POST", "/questions", {
      category: "PART_3",
      testSetId,
    });
    assert.equal(response.status, 404, testSetId);
    assert.equal((await response.json() as { error: string }).error, "Test Set not found");
  }

  const missing = await request("POST", "/questions", { category: "PART_3" });
  assert.equal(missing.status, 400);

  const question = await createQuestion("PART_3", (await newTestSet()).id);
  const move = await request("PUT", `/questions/${question.id}`, {
    testSetId: crypto.randomUUID(),
  });
  assert.equal(move.status, 404);
  assert.equal((await move.json() as { error: string }).error, "Test Set not found");
});

test("retiring a Question releases its position and preserves replacement history", async () => {
  const testSet = await newTestSet();
  const original = await createQuestion("PART_1A", testSet.id, [
    { promptText: "Original prompt", order: 1 },
  ]);

  const retirement = await request("DELETE", `/questions/${original.id}`);
  assert.equal(retirement.status, 200);

  const replacement = await createQuestion("PART_1A", testSet.id, [
    { promptText: "Replacement prompt", order: 1 },
  ]);
  assert.notEqual(replacement.id, original.id);

  const retiredView = await listQuestions(true);
  const records = retiredView.filter(
    (question) => question.category === "PART_1A" && question.testSetId === testSet.id,
  );
  assert.equal(records.length, 2);
  assert.equal(records.find((question) => question.id === original.id)?.deletedAt !== null, true);
  assert.equal(records.find((question) => question.id === replacement.id)?.deletedAt, null);
  assert.equal(records.find((question) => question.id === original.id)?.tasks[0]?.promptText, "Original prompt");
  assert.equal(records.find((question) => question.id === replacement.id)?.tasks[0]?.promptText, "Replacement prompt");
  assert.equal((await listQuestions()).some((question) => question.id === original.id), false);
});

test("retiring a Task releases its Question/order position for repeated replacements", async () => {
  const question = await createQuestion("PART_2", (await newTestSet()).id, [
    { promptText: "First task", order: 1 },
  ]);
  const firstTask = question.tasks[0]!;

  const firstRetirement = await request(
    "DELETE",
    `/questions/${question.id}/tasks/${firstTask.id}`,
  );
  assert.equal(firstRetirement.status, 200);

  const firstReplacement = await request(
    "POST",
    `/questions/${question.id}/tasks`,
    { promptText: "Second task", order: 1 },
  );
  assert.equal(firstReplacement.status, 201);
  const secondTask = (await firstReplacement.json() as { data: TaskResponse }).data;

  const secondRetirement = await request(
    "DELETE",
    `/questions/${question.id}/tasks/${secondTask.id}`,
  );
  assert.equal(secondRetirement.status, 200);

  const secondReplacement = await request(
    "POST",
    `/questions/${question.id}/tasks`,
    { promptText: "Third task", order: 1 },
  );
  assert.equal(secondReplacement.status, 201);

  const retiredView = await listQuestions(true);
  const visibleQuestion = retiredView.find((item) => item.id === question.id)!;
  assert.deepEqual(
    visibleQuestion.tasks
      .filter((task) => task.order === 1)
      .map((task) => ({ text: task.promptText, retired: task.deletedAt !== null }))
      .sort((left, right) => left.text.localeCompare(right.text)),
    [
      { text: "First task", retired: true },
      { text: "Second task", retired: true },
      { text: "Third task", retired: false },
    ],
  );
});

test("active Question and Task conflicts return 409 without changing existing records", async () => {
  const occupiedSet = await newTestSet();
  const first = await createQuestion("PART_3", occupiedSet.id, [
    { promptText: "Stable task", order: 1 },
  ]);
  const duplicateQuestion = await request("POST", "/questions", {
    category: "PART_3",
    testSetId: occupiedSet.id,
  });
  assert.equal(duplicateQuestion.status, 409);
  assert.match((await duplicateQuestion.json()).error, /Question position [0-9a-f-]+\/PART_3/);

  const second = await createQuestion("PART_3", (await newTestSet()).id);
  const moveConflict = await request("PUT", `/questions/${second.id}`, {
    category: "PART_3",
    testSetId: occupiedSet.id,
  });
  assert.equal(moveConflict.status, 409);
  assert.match((await moveConflict.json()).error, new RegExp(`Question position ${occupiedSet.id}/PART_3`));
  assert.notEqual(
    (await prisma.question.findUniqueOrThrow({ where: { id: second.id }, select: { testSetId: true } })).testSetId,
    occupiedSet.id,
  );

  const duplicateTask = await request(
    "POST",
    `/questions/${first.id}/tasks`,
    { promptText: "Conflict task", order: 1 },
  );
  assert.equal(duplicateTask.status, 409);
  assert.match((await duplicateTask.json()).error, /Task position/);

  const movableTask = await request(
    "POST",
    `/questions/${first.id}/tasks`,
    { promptText: "Movable task", order: 2 },
  );
  assert.equal(movableTask.status, 201);
  const movableTaskData = (await movableTask.json() as { data: TaskResponse }).data;
  const taskMoveConflict = await request(
    "PUT",
    `/questions/${first.id}/tasks/${movableTaskData.id}`,
    { order: 1 },
  );
  assert.equal(taskMoveConflict.status, 409);
  assert.match((await taskMoveConflict.json()).error, /Task position/);

  const unchanged = await prisma.task.findUniqueOrThrow({
    where: { id: movableTaskData.id },
    select: { order: true, promptText: true },
  });
  assert.deepEqual(unchanged, { order: 2, promptText: "Movable task" });
});

test("concurrent Question creation at one active position admits exactly one record", async () => {
  const testSet = await newTestSet();
  const responses = await Promise.all([
    request("POST", "/questions", {
      category: "PART_1A",
      testSetId: testSet.id,
    }),
    request("POST", "/questions", {
      category: "PART_1A",
      testSetId: testSet.id,
    }),
  ]);
  const bodies = await Promise.all(
    responses.map((response) => response.json() as Promise<{ data?: QuestionResponse; error?: string }>),
  );

  assert.deepEqual(
    responses.map((response) => response.status).sort((left, right) => left - right),
    [201, 409],
  );
  assert.equal(bodies.filter((body) => body.data !== undefined).length, 1);
  assert.equal(
    await prisma.question.count({
      where: { category: "PART_1A", testSetId: testSet.id, deletedAt: null },
    }),
    1,
  );
});

test("concurrent Question updates at one active position admit exactly one winner", async () => {
  const first = await createQuestion("PART_1A", (await newTestSet()).id);
  const second = await createQuestion("PART_1A", (await newTestSet()).id);
  const target = await newTestSet();
  const responses = await Promise.all([
    request("PUT", `/questions/${first.id}`, { testSetId: target.id }),
    request("PUT", `/questions/${second.id}`, { testSetId: target.id }),
  ]);
  const bodies = await Promise.all(
    responses.map((response) => response.json() as Promise<{ data?: QuestionResponse; error?: string }>),
  );

  assert.deepEqual(
    responses.map((response) => response.status).sort((left, right) => left - right),
    [200, 409],
  );
  assert.equal(bodies.filter((body) => body.data !== undefined).length, 1);
  assert.equal(
    await prisma.question.count({
      where: { category: "PART_1A", testSetId: target.id, deletedAt: null },
    }),
    1,
  );
});

test("concurrent Question restoration admits one original identity at a free position", async () => {
  const testSet = await newTestSet();
  const first = await createQuestion("PART_2", testSet.id);
  assert.equal((await request("DELETE", `/questions/${first.id}`)).status, 200);
  const second = await createQuestion("PART_2", testSet.id);
  assert.equal((await request("DELETE", `/questions/${second.id}`)).status, 200);

  const responses = await Promise.all([
    request("POST", `/questions/${first.id}/restore`),
    request("POST", `/questions/${second.id}/restore`),
  ]);
  const bodies = await Promise.all(
    responses.map((response) => response.json() as Promise<{ data?: QuestionResponse; error?: string }>),
  );

  assert.deepEqual(
    responses.map((response) => response.status).sort((left, right) => left - right),
    [200, 409],
  );
  assert.equal(bodies.filter((body) => body.data !== undefined).length, 1);
  assert.equal(
    await prisma.question.count({
      where: { category: "PART_2", testSetId: testSet.id, deletedAt: null },
    }),
    1,
  );
  assert.equal(
    await prisma.question.count({
      where: { category: "PART_2", testSetId: testSet.id },
    }),
    2,
  );
});

test("nested Question creation is atomic when a Task position conflicts", async () => {
  const testSet = await newTestSet();
  const response = await request("POST", "/questions", {
    category: "PART_1A",
    testSetId: testSet.id,
    tasks: [
      { promptText: "Duplicate one", order: 1 },
      { promptText: "Duplicate two", order: 1 },
    ],
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Task order 1 is duplicated/);

  const records = await listQuestions(true);
  assert.equal(
    records.some((question) => question.testSetId === testSet.id),
    false,
  );
});

test("Question restoration is exact, idempotent, and conflict-safe", async () => {
  const testSet = await newTestSet();
  const original = await createQuestion("PART_2", testSet.id, [
    { promptText: "Keep this child retired", order: 1 },
  ]);
  const originalTask = original.tasks[0]!;
  assert.equal(
    (await request("DELETE", `/questions/${original.id}/tasks/${originalTask.id}`)).status,
    200,
  );
  assert.equal((await request("DELETE", `/questions/${original.id}`)).status, 200);

  const replacement = await createQuestion("PART_2", testSet.id);
  const occupiedRestore = await request("POST", `/questions/${original.id}/restore`);
  assert.equal(occupiedRestore.status, 409);

  const unchangedRows = await prisma.question.findMany({
    where: { id: { in: [original.id, replacement.id] } },
    select: { id: true, category: true, testSetId: true, deletedAt: true },
  });
  assert.equal(unchangedRows.find((row) => row.id === original.id)?.deletedAt !== null, true);
  assert.equal(unchangedRows.find((row) => row.id === replacement.id)?.deletedAt, null);

  assert.equal((await request("DELETE", `/questions/${replacement.id}`)).status, 200);
  const restored = await request("POST", `/questions/${original.id}/restore`);
  assert.equal(restored.status, 200);
  const restoredData = (await restored.json() as { data: QuestionResponse }).data;
  assert.equal(restoredData.id, original.id);
  assert.equal(restoredData.category, "PART_2");
  assert.equal(restoredData.testSetId, testSet.id);
  assert.equal(restoredData.tasks[0]?.id, originalTask.id);
  assert.notEqual(restoredData.tasks[0]?.deletedAt, null);

  const repeated = await request("POST", `/questions/${original.id}/restore`);
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json() as { data: QuestionResponse }).data.id, original.id);
  assert.equal((await request("POST", "/questions/not-a-question/restore")).status, 404);
});

test("Question restoration cannot revive media after cleanup crosses the irreversible boundary", async () => {
  const question = await createQuestion("PART_3", (await newTestSet()).id);
  const storageKey = `questions/${question.id}/prompt.webm`;
  await prisma.question.update({
    where: { id: question.id },
    data: {
      audioStorageKey: storageKey,
      audioMimeType: "audio/webm",
      audioSizeBytes: 10,
      audioUploadStatus: "UPLOADED",
      deletedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  const cleanupRun = await prisma.promptMediaCleanupRun.create({
    data: {
      mode: "FINALIZE",
      actorId: adminId,
      authorizationId: "cleanup-irreversible-boundary",
      reason: "Prompt media was deleted",
      policyVersion: "2026-08-31",
      status: "COMPLETED",
      completedAt: new Date("2026-02-01T00:00:00.000Z"),
    },
  });
  await prisma.promptMediaCleanupObject.create({
    data: {
      sourceQuestionId: question.id,
      storageKey,
      bucket: "question-lifecycle-test-bucket",
      eligibilityReason: "No retained references",
      status: "DELETED",
      lastRunId: cleanupRun.id,
      deletedAt: new Date("2026-02-01T00:00:00.000Z"),
    },
  });

  const restore = await request("POST", `/questions/${question.id}/restore`);
  assert.equal(restore.status, 409);
  assert.match((await restore.json() as { error: string }).error, /irreversible Prompt-media cleanup boundary/u);
  assert.notEqual(
    (await prisma.question.findUniqueOrThrow({ where: { id: question.id }, select: { deletedAt: true } })).deletedAt,
    null,
  );
});

test("Question restoration waits for unresolved Prompt-media cleanup recovery", async () => {
  const question = await createQuestion("PART_1A", (await newTestSet()).id);
  const storageKey = `questions/${question.id}/prompt.webm`;
  await prisma.question.update({
    where: { id: question.id },
    data: {
      audioStorageKey: storageKey,
      audioMimeType: "audio/webm",
      audioSizeBytes: 10,
      audioUploadStatus: "UPLOADED",
      deletedAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  });
  const cleanupRun = await prisma.promptMediaCleanupRun.create({
    data: {
      mode: "FINALIZE",
      actorId: adminId,
      authorizationId: "cleanup-unresolved-state",
      reason: "Prompt media deletion requires retry",
      policyVersion: "2026-08-31",
      status: "FAILED",
    },
  });
  await prisma.promptMediaCleanupObject.create({
    data: {
      sourceQuestionId: question.id,
      storageKey,
      bucket: "question-lifecycle-test-bucket",
      eligibilityReason: "Storage deletion failed",
      status: "FAILED",
      lastRunId: cleanupRun.id,
      quarantineUntil: new Date("2026-02-01T00:00:00.000Z"),
      lastError: "Storage unavailable",
    },
  });

  const restore = await request("POST", `/questions/${question.id}/restore`);
  assert.equal(restore.status, 409);
  assert.match((await restore.json() as { error: string }).error, /Prompt-media cleanup is unresolved/u);
  assert.notEqual(
    (await prisma.question.findUniqueOrThrow({ where: { id: question.id }, select: { deletedAt: true } })).deletedAt,
    null,
  );
});

test("Task restoration is independent of its parent Question and ownership", async () => {
  const parent = await createQuestion("PART_3", (await newTestSet()).id, [
    { promptText: "Restore independently", order: 1 },
  ]);
  const task = parent.tasks[0]!;
  assert.equal((await request("DELETE", `/questions/${parent.id}/tasks/${task.id}`)).status, 200);
  assert.equal((await request("DELETE", `/questions/${parent.id}`)).status, 200);

  const restoredTask = await request(
    "POST",
    `/questions/${parent.id}/tasks/${task.id}/restore`,
  );
  assert.equal(restoredTask.status, 200);
  assert.equal((await restoredTask.json() as { data: TaskResponse }).data.id, task.id);
  assert.notEqual(
    (await prisma.question.findUniqueOrThrow({ where: { id: parent.id }, select: { deletedAt: true } })).deletedAt,
    null,
  );
  assert.equal((await listQuestions()).some((question) => question.id === parent.id), false);

  const conflictParent = await createQuestion("PART_1A", (await newTestSet()).id, [
    { promptText: "Old task", order: 1 },
  ]);
  const oldTask = conflictParent.tasks[0]!;
  assert.equal((await request("DELETE", `/questions/${conflictParent.id}/tasks/${oldTask.id}`)).status, 200);
  const newTaskResponse = await request(
    "POST",
    `/questions/${conflictParent.id}/tasks`,
    { promptText: "New task", order: 1 },
  );
  assert.equal(newTaskResponse.status, 201);
  const newTask = (await newTaskResponse.json() as { data: TaskResponse }).data;

  const occupiedRestore = await request(
    "POST",
    `/questions/${conflictParent.id}/tasks/${oldTask.id}/restore`,
  );
  assert.equal(occupiedRestore.status, 409);
  assert.equal(
    (await prisma.task.findUniqueOrThrow({ where: { id: oldTask.id }, select: { deletedAt: true } })).deletedAt !== null,
    true,
  );
  assert.equal(
    (await prisma.task.findUniqueOrThrow({ where: { id: newTask.id }, select: { deletedAt: true } })).deletedAt,
    null,
  );

  const invalidOwner = await request(
    "POST",
    `/questions/${parent.id}/tasks/${newTask.id}/restore`,
  );
  assert.equal(invalidOwner.status, 404);
  assert.equal((await request("POST", `/questions/${conflictParent.id}/tasks/not-a-task/restore`)).status, 404);
});

test("Question and Task restoration remain restricted to administrators", async () => {
  const questionId = crypto.randomUUID();
  const taskId = crypto.randomUUID();
  const noAuth = await requestAs(undefined, "POST", `/questions/${questionId}/restore`);
  assert.equal(noAuth.status, 401);

  const email = `${crypto.randomUUID()}@example.test`;
  const student = await prisma.user.create({
    data: {
      username: `question_student_${crypto.randomUUID().replaceAll("-", "")}`,
      email,
      normalizedEmail: email,
      password: TEST_PASSWORD_HASH,
      role: "STUDENT",
    },
  });
  for (const path of [
    `/questions/${questionId}/restore`,
    `/questions/${questionId}/tasks/${taskId}/restore`,
  ]) {
    const forbidden = await requestAs(student.id, "POST", path);
    assert.equal(forbidden.status, 403);
  }
});

test("restored incomplete or retired content remains outside test delivery", async () => {
  const deliverySet = await newTestSet();
  for (const category of SLOTS) {
    await prisma.question.create({
      data: eligibleQuestionData(category, deliverySet.id, "Eligible task"),
    });
  }

  const incomplete = await createQuestion("PART_1A", (await newTestSet()).id);
  assert.equal((await request("DELETE", `/questions/${incomplete.id}`)).status, 200);
  assert.equal((await request("POST", `/questions/${incomplete.id}/restore`)).status, 200);

  const retiredParent = await createQuestion("PART_2", (await newTestSet()).id, [
    { promptText: "Parent retired", order: 1 },
  ]);
  assert.equal((await request("DELETE", `/questions/${retiredParent.id}`)).status, 200);

  const { retrieveTestQuestions } = await import("../../src/service/question.service.js");
  const delivered = await retrieveTestQuestions();
  assert.deepEqual(
    delivered
      .filter((question) => question.testSetId === deliverySet.id)
      .map((question) => question.category),
    [...SLOTS],
  );
  assert.equal(delivered.some((question) => question.id === incomplete.id), false);
  assert.equal(delivered.some((question) => question.id === retiredParent.id), false);
});

test("admin question listing spans every Test Set and slot", async () => {
  const created = await Promise.all(
    SLOTS.map(async (category) =>
      prisma.question.create({
        data: {
          category,
          testSetId: (await newTestSet()).id,
          createdById: adminId,
          tasks: { create: { promptText: `${category} admin listing`, order: 1 } },
        },
      }),
    ),
  );

  const response = await request("GET", "/questions");
  assert.equal(response.status, 200);
  const body = await response.json() as { data: QuestionResponse[] };
  const returnedIds = new Set(body.data.map((question) => question.id));
  assert.deepEqual(
    created.map((question) => returnedIds.has(question.id)),
    SLOTS.map(() => true),
  );
});

test("restoring a Task resumes delivery only under an active eligible Question", async () => {
  const testSet = await newTestSet();
  const question = await prisma.question.create({
    data: eligibleQuestionData("PART_3", testSet.id, "Restored delivery task"),
    include: { tasks: true },
  });
  const task = question.tasks[0]!;

  assert.equal((await request("DELETE", `/questions/${question.id}/tasks/${task.id}`)).status, 200);
  const { retrieveTestQuestions } = await import("../../src/service/question.service.js");
  const withoutTask = await retrieveTestQuestions();
  assert.equal(withoutTask.some((item) => item.id === question.id), false);

  const restored = await request(
    "POST",
    `/questions/${question.id}/tasks/${task.id}/restore`,
  );
  assert.equal(restored.status, 200);
  const restoredBody = (await restored.json() as { data: TaskResponse }).data;
  assert.equal(restoredBody.id, task.id);
  assert.equal(restoredBody.order, task.order);

  const repeated = await request(
    "POST",
    `/questions/${question.id}/tasks/${task.id}/restore`,
  );
  assert.equal(repeated.status, 200);
  const repeatedBody = (await repeated.json() as { data: TaskResponse }).data;
  assert.equal(repeatedBody.id, task.id);
  assert.equal(repeatedBody.order, task.order);

  const withTask = await retrieveTestQuestions();
  assert.deepEqual(
    withTask.find((item) => item.id === question.id)?.tasks.map((item) => item.id),
    [task.id],
  );
});
