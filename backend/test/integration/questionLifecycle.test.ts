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
  order: number;
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
let positionCounter = 100_000;

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

function nextPosition() {
  positionCounter += 1;
  return positionCounter;
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

async function createQuestion(
  category: "PART_1" | "PART_2" | "PART_3",
  order: number,
  tasks: Array<{ promptText: string; order: number }> = [],
) {
  const response = await request("POST", "/questions", {
    category,
    order,
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

test("retiring a Question releases its position and preserves replacement history", async () => {
  const order = nextPosition();
  const original = await createQuestion("PART_1", order, [
    { promptText: "Original prompt", order: 1 },
  ]);

  const retirement = await request("DELETE", `/questions/${original.id}`);
  assert.equal(retirement.status, 200);

  const replacement = await createQuestion("PART_1", order, [
    { promptText: "Replacement prompt", order: 1 },
  ]);
  assert.notEqual(replacement.id, original.id);

  const retiredView = await listQuestions(true);
  const records = retiredView.filter(
    (question) => question.category === "PART_1" && question.order === order,
  );
  assert.equal(records.length, 2);
  assert.equal(records.find((question) => question.id === original.id)?.deletedAt !== null, true);
  assert.equal(records.find((question) => question.id === replacement.id)?.deletedAt, null);
  assert.equal(records.find((question) => question.id === original.id)?.tasks[0]?.promptText, "Original prompt");
  assert.equal(records.find((question) => question.id === replacement.id)?.tasks[0]?.promptText, "Replacement prompt");
  assert.equal((await listQuestions()).some((question) => question.id === original.id), false);
});

test("retiring a Task releases its Question/order position for repeated replacements", async () => {
  const question = await createQuestion("PART_2", nextPosition(), [
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
  const questionOrder = nextPosition();
  const first = await createQuestion("PART_3", questionOrder, [
    { promptText: "Stable task", order: 1 },
  ]);
  const duplicateQuestion = await request("POST", "/questions", {
    category: "PART_3",
    order: questionOrder,
  });
  assert.equal(duplicateQuestion.status, 409);
  assert.match((await duplicateQuestion.json()).error, /Question position PART_3\//);

  const second = await createQuestion("PART_3", nextPosition());
  const moveConflict = await request("PUT", `/questions/${second.id}`, {
    category: "PART_3",
    order: questionOrder,
  });
  assert.equal(moveConflict.status, 409);
  assert.match((await moveConflict.json()).error, /Question position PART_3\//);

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
  const order = nextPosition();
  const responses = await Promise.all([
    request("POST", "/questions", {
      category: "PART_1",
      order,
    }),
    request("POST", "/questions", {
      category: "PART_1",
      order,
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
      where: { category: "PART_1", order, deletedAt: null },
    }),
    1,
  );
});

test("concurrent Question updates at one active position admit exactly one winner", async () => {
  const first = await createQuestion("PART_1", nextPosition());
  const second = await createQuestion("PART_1", nextPosition());
  const targetOrder = nextPosition();
  const responses = await Promise.all([
    request("PUT", `/questions/${first.id}`, { order: targetOrder }),
    request("PUT", `/questions/${second.id}`, { order: targetOrder }),
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
      where: { category: "PART_1", order: targetOrder, deletedAt: null },
    }),
    1,
  );
});

test("concurrent Question restoration admits one original identity at a free position", async () => {
  const order = nextPosition();
  const first = await createQuestion("PART_2", order);
  assert.equal((await request("DELETE", `/questions/${first.id}`)).status, 200);
  const second = await createQuestion("PART_2", order);
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
      where: { category: "PART_2", order, deletedAt: null },
    }),
    1,
  );
  assert.equal(
    await prisma.question.count({
      where: { category: "PART_2", order },
    }),
    2,
  );
});

test("nested Question creation is atomic when a Task position conflicts", async () => {
  const order = nextPosition();
  const response = await request("POST", "/questions", {
    category: "PART_1",
    order,
    tasks: [
      { promptText: "Duplicate one", order: 1 },
      { promptText: "Duplicate two", order: 1 },
    ],
  });
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /Task order 1 is duplicated/);

  const records = await listQuestions(true);
  assert.equal(
    records.some((question) => question.category === "PART_1" && question.order === order),
    false,
  );
});

test("Question restoration is exact, idempotent, and conflict-safe", async () => {
  const order = nextPosition();
  const original = await createQuestion("PART_2", order, [
    { promptText: "Keep this child retired", order: 1 },
  ]);
  const originalTask = original.tasks[0]!;
  assert.equal(
    (await request("DELETE", `/questions/${original.id}/tasks/${originalTask.id}`)).status,
    200,
  );
  assert.equal((await request("DELETE", `/questions/${original.id}`)).status, 200);

  const replacement = await createQuestion("PART_2", order);
  const occupiedRestore = await request("POST", `/questions/${original.id}/restore`);
  assert.equal(occupiedRestore.status, 409);

  const unchangedRows = await prisma.question.findMany({
    where: { id: { in: [original.id, replacement.id] } },
    select: { id: true, category: true, order: true, deletedAt: true },
  });
  assert.equal(unchangedRows.find((row) => row.id === original.id)?.deletedAt !== null, true);
  assert.equal(unchangedRows.find((row) => row.id === replacement.id)?.deletedAt, null);

  assert.equal((await request("DELETE", `/questions/${replacement.id}`)).status, 200);
  const restored = await request("POST", `/questions/${original.id}/restore`);
  assert.equal(restored.status, 200);
  const restoredData = (await restored.json() as { data: QuestionResponse }).data;
  assert.equal(restoredData.id, original.id);
  assert.equal(restoredData.category, "PART_2");
  assert.equal(restoredData.order, order);
  assert.equal(restoredData.tasks[0]?.id, originalTask.id);
  assert.notEqual(restoredData.tasks[0]?.deletedAt, null);

  const repeated = await request("POST", `/questions/${original.id}/restore`);
  assert.equal(repeated.status, 200);
  assert.equal((await repeated.json() as { data: QuestionResponse }).data.id, original.id);
  assert.equal((await request("POST", "/questions/not-a-question/restore")).status, 404);
});

test("Question restoration cannot revive media after cleanup crosses the irreversible boundary", async () => {
  const question = await createQuestion("PART_3", nextPosition());
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

test("Task restoration is independent of its parent Question and ownership", async () => {
  const parent = await createQuestion("PART_3", nextPosition(), [
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

  const conflictParent = await createQuestion("PART_1", nextPosition(), [
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
  const deliveryOrder = nextPosition();
  for (const category of ["PART_1", "PART_2", "PART_3"] as const) {
    await prisma.question.create({
      data: {
        category,
        order: deliveryOrder,
        createdById: adminId,
        audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
        audioMimeType: "audio/webm",
        audioSizeBytes: 1_024,
        audioUploadStatus: "UPLOADED",
        tasks: { create: { promptText: "Eligible task", order: 1 } },
      },
    });
  }

  const incomplete = await createQuestion("PART_1", nextPosition());
  assert.equal((await request("DELETE", `/questions/${incomplete.id}`)).status, 200);
  assert.equal((await request("POST", `/questions/${incomplete.id}/restore`)).status, 200);

  const retiredParent = await createQuestion("PART_2", nextPosition(), [
    { promptText: "Parent retired", order: 1 },
  ]);
  assert.equal((await request("DELETE", `/questions/${retiredParent.id}`)).status, 200);

  const { retrieveTestQuestions } = await import("../../src/service/question.service.js");
  const delivered = await retrieveTestQuestions(deliveryOrder);
  assert.deepEqual(delivered.map((question) => question.category).sort(), ["PART_1", "PART_2", "PART_3"]);
  assert.equal(delivered.some((question) => question.id === incomplete.id), false);
  assert.equal(delivered.some((question) => question.id === retiredParent.id), false);
});

test("admin question listing is not limited to the legacy order-two position", async () => {
  const created = await Promise.all(
    (["PART_1", "PART_2", "PART_3"] as const).map((category) =>
      prisma.question.create({
        data: {
          category,
          order: nextPosition(),
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
    [true, true, true],
  );
});

test("restoring a Task resumes delivery only under an active eligible Question", async () => {
  const order = nextPosition();
  const question = await prisma.question.create({
    data: {
      category: "PART_3",
      order,
      createdById: adminId,
      audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
      audioMimeType: "audio/webm",
      audioSizeBytes: 1_024,
      audioUploadStatus: "UPLOADED",
      tasks: { create: { promptText: "Restored delivery task", order: 1 } },
    },
    include: { tasks: true },
  });
  const task = question.tasks[0]!;

  assert.equal((await request("DELETE", `/questions/${question.id}/tasks/${task.id}`)).status, 200);
  const { retrieveTestQuestions } = await import("../../src/service/question.service.js");
  const withoutTask = await retrieveTestQuestions(order);
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

  const withTask = await retrieveTestQuestions(order);
  assert.deepEqual(
    withTask.find((item) => item.id === question.id)?.tasks.map((item) => item.id),
    [task.id],
  );
});
