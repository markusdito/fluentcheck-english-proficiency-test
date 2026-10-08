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
import { SLOTS, deliverableContent, type Slot } from "../fixtures/testSets.js";

const execFileAsync = promisify(execFile);
const TEST_PASSWORD_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

type SlotResponse = { category: string; questionId: string | null; eligible: boolean };
type TestSetResponse = {
  id: string;
  code: string;
  status: "DELIVERABLE" | "DRAFT";
  slots: SlotResponse[];
  createdAt: string;
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

async function createUser(role: "ADMIN" | "STUDENT" | "EXAMINER") {
  const email = `${crypto.randomUUID()}@example.test`;
  return prisma.user.create({
    data: {
      username: `test_set_${role.toLowerCase()}_${crypto.randomUUID().replaceAll("-", "")}`,
      email,
      normalizedEmail: email,
      password: TEST_PASSWORD_HASH,
      role,
    },
  });
}

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.JWT_SECRET = "test-set-integration-secret";
  process.env.R2_ACCOUNT_ID = "test-set-test-account";
  process.env.R2_ACCESS_KEY_ID = "test-set-test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "test-set-test-secret-key";
  process.env.R2_BUCKET_NAME = "test-set-test-bucket";
  process.env.FRONTEND_URL = "https://fluentcheck.example.test";

  await migrateDatabase(process.env.DATABASE_URL);

  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  const { createApp } = await import("../../src/server.js");
  app = createApp();
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Test Set integration server did not bind");
  }
  baseUrl = `http://127.0.0.1:${address.port}`;

  adminId = (await createUser("ADMIN")).id;
}, { timeout: 120_000 });

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

async function requestAs(
  userId: string,
  method: string,
  path: string,
  body?: Record<string, unknown>,
) {
  return fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      Cookie: cookieFor(userId),
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function uniqueCode(prefix: string) {
  return `${prefix}-${crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase()}`;
}

async function createTestSetViaApi(code: string) {
  const response = await requestAs(adminId, "POST", "/admin/test-sets", { code });
  const body = await response.json() as {
    status?: string;
    data?: { id: string; code: string; createdAt: string };
    error?: string;
  };
  assert.equal(response.status, 201, JSON.stringify(body));
  assert.equal(body.status, "success");
  return body.data!;
}

async function listTestSetsViaApi() {
  const response = await requestAs(adminId, "GET", "/admin/test-sets");
  assert.equal(response.status, 200);
  const body = await response.json() as { status: string; data: TestSetResponse[] };
  assert.equal(body.status, "success");
  return body.data;
}

async function findListedTestSet(id: string) {
  const listed = (await listTestSetsViaApi()).find((testSet) => testSet.id === id);
  assert.ok(listed, `Test Set ${id} should be listed`);
  return listed;
}

/** Create a question in a Test Set slot; eligible unless its audio is not uploaded. */
async function createSlotQuestion(
  testSetId: string,
  category: Slot,
  { uploaded = true }: { uploaded?: boolean } = {},
) {
  return prisma.question.create({
    data: {
      category,
      testSetId,
      ...(uploaded
        ? {
            audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
            audioMimeType: "audio/webm",
            audioSizeBytes: 128,
            audioUploadStatus: "UPLOADED" as const,
            ...deliverableContent(category),
          }
        : {}),
      tasks: { create: [{ promptText: `${category} prompt`, order: 1 }] },
    },
  });
}

async function createDeliverableTestSet(prefix: string) {
  const testSet = await createTestSetViaApi(uniqueCode(prefix));
  const questions: Array<{ id: string }> = [];
  for (const category of SLOTS) {
    questions.push(await createSlotQuestion(testSet.id, category));
  }
  return { testSet, questions };
}

test("Test Set admin endpoints reject non-admin users", async () => {
  for (const role of ["STUDENT", "EXAMINER"] as const) {
    const user = await createUser(role);
    const list = await requestAs(user.id, "GET", "/admin/test-sets");
    assert.equal(list.status, 403, `${role} list`);
    const create = await requestAs(user.id, "POST", "/admin/test-sets", { code: uniqueCode("NOPE") });
    assert.equal(create.status, 403, `${role} create`);
    const rename = await requestAs(user.id, "PUT", `/admin/test-sets/${crypto.randomUUID()}`, {
      code: uniqueCode("NOPE"),
    });
    assert.equal(rename.status, 403, `${role} rename`);
  }
  assert.equal(await prisma.testSet.count({ where: { code: { startsWith: "NOPE-" } } }), 0);

  const anonymous = await fetch(`${baseUrl}/api/admin/test-sets`);
  assert.equal(anonymous.status, 401);
});

test("creating a Test Set trims and uppercases its code", async () => {
  const created = await createTestSetViaApi(" a1 ");
  assert.equal(created.code, "A1");
  assert.ok(created.id);
  assert.ok(created.createdAt);
  const stored = await prisma.testSet.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.code, "A1");
});

test("creating a Test Set rejects invalid codes", async () => {
  for (const code of ["", "   ", "-A", "_A", "A B", "A.B", "A".repeat(33), "ÄB"]) {
    const response = await requestAs(adminId, "POST", "/admin/test-sets", { code });
    assert.equal(response.status, 400, `code ${JSON.stringify(code)}`);
  }
  for (const body of [{}, { code: 42 }, { code: null }]) {
    const response = await requestAs(adminId, "POST", "/admin/test-sets", body);
    assert.equal(response.status, 400, `body ${JSON.stringify(body)}`);
  }
  // 32 characters is the longest accepted code.
  const longest = `L${crypto.randomUUID().replaceAll("-", "").slice(0, 31).toUpperCase()}`;
  assert.equal((await createTestSetViaApi(longest)).code, longest);
});

test("creating a Test Set with a duplicate code returns 409", async () => {
  const code = uniqueCode("DUP");
  await createTestSetViaApi(code);
  const duplicate = await requestAs(adminId, "POST", "/admin/test-sets", {
    code: ` ${code.toLowerCase()} `,
  });
  assert.equal(duplicate.status, 409);
  assert.equal(await prisma.testSet.count({ where: { code } }), 1);
});

test("a new empty Test Set is listed as a Draft with five empty slots", async () => {
  const created = await createTestSetViaApi(uniqueCode("EMPTY"));
  const listed = await findListedTestSet(created.id);
  assert.equal(listed.code, created.code);
  assert.equal(listed.status, "DRAFT");
  assert.deepEqual(listed.slots, SLOTS.map((category) => ({
    category,
    questionId: null,
    eligible: false,
  })));
});

test("a Test Set with an Eligible question in every slot is Deliverable", async () => {
  const { testSet, questions } = await createDeliverableTestSet("FULL");
  const listed = await findListedTestSet(testSet.id);
  assert.equal(listed.status, "DELIVERABLE");
  assert.deepEqual(listed.slots, SLOTS.map((category, index) => ({
    category,
    questionId: questions[index]!.id,
    eligible: true,
  })));
});

test("a Test Set whose slot question lacks uploaded audio stays a Draft", async () => {
  const testSet = await createTestSetViaApi(uniqueCode("NOAUDIO"));
  const questions: Array<{ id: string }> = [];
  for (const category of SLOTS) {
    questions.push(await createSlotQuestion(testSet.id, category, { uploaded: category !== "PART_3" }));
  }
  const listed = await findListedTestSet(testSet.id);
  assert.equal(listed.status, "DRAFT");
  assert.deepEqual(listed.slots, SLOTS.map((category, index) => ({
    category,
    questionId: questions[index]!.id,
    eligible: category !== "PART_3",
  })));
});

test("a retired slot question or one without active Tasks is not Eligible", async () => {
  const { testSet, questions } = await createDeliverableTestSet("RETIRE");
  await prisma.question.update({
    where: { id: questions[0]!.id },
    data: { deletedAt: new Date() },
  });
  await prisma.task.updateMany({
    where: { questionId: questions[4]!.id },
    data: { deletedAt: new Date() },
  });
  const listed = await findListedTestSet(testSet.id);
  assert.equal(listed.status, "DRAFT");
  assert.deepEqual(listed.slots[0], { category: "PART_1A", questionId: null, eligible: false });
  assert.deepEqual(listed.slots[4], {
    category: "PART_4",
    questionId: questions[4]!.id,
    eligible: false,
  });
});

test("renaming a Test Set normalizes the code, and unknown ids return 404", async () => {
  const created = await createTestSetViaApi(uniqueCode("OLD"));
  const newCode = uniqueCode("NEW");
  const response = await requestAs(adminId, "PUT", `/admin/test-sets/${created.id}`, {
    code: ` ${newCode.toLowerCase()} `,
  });
  assert.equal(response.status, 200);
  const body = await response.json() as { status: string; data: { id: string; code: string } };
  assert.equal(body.status, "success");
  assert.equal(body.data.id, created.id);
  assert.equal(body.data.code, newCode);
  assert.equal((await findListedTestSet(created.id)).code, newCode);

  const unknown = await requestAs(adminId, "PUT", `/admin/test-sets/${crypto.randomUUID()}`, {
    code: uniqueCode("GHOST"),
  });
  assert.equal(unknown.status, 404);
  const malformed = await requestAs(adminId, "PUT", "/admin/test-sets/not-a-uuid", {
    code: uniqueCode("GHOST"),
  });
  assert.equal(malformed.status, 404);

  const invalid = await requestAs(adminId, "PUT", `/admin/test-sets/${created.id}`, { code: "bad code" });
  assert.equal(invalid.status, 400);

  const other = await createTestSetViaApi(uniqueCode("TAKEN"));
  const conflict = await requestAs(adminId, "PUT", `/admin/test-sets/${created.id}`, {
    code: other.code,
  });
  assert.equal(conflict.status, 409);
  assert.equal((await prisma.testSet.findUniqueOrThrow({ where: { id: created.id } })).code, newCode);
});

test("renaming a delivered Test Set keeps the delivered code on the Submission", async () => {
  const { initializeManifestSubmission } = await import(
    "../../src/service/manifestSubmissionInitialization.service.js"
  );
  const { testSet, questions } = await createDeliverableTestSet("DELIVERED");
  const deliverableIds = (await listTestSetsViaApi())
    .filter((item) => item.status === "DELIVERABLE")
    .map((item) => item.id)
    .sort();
  const selectedIndex = deliverableIds.indexOf(testSet.id);
  assert.ok(selectedIndex >= 0);

  const student = await createUser("STUDENT");
  const started = await initializeManifestSubmission(student.id, crypto.randomUUID(), {
    chooseIndex: () => selectedIndex,
    signPromptMedia: async (key) => `https://media.example/${encodeURIComponent(key)}`,
  });
  assert.equal(started.version, 2);
  assert.deepEqual(started.testSet, { id: testSet.id, code: testSet.code });
  assert.equal(started.entries.length, 5);

  const manifest = await prisma.submissionManifest.findUniqueOrThrow({
    where: { submissionId: started.submissionId },
    include: { entries: { orderBy: { deliveryPosition: "asc" } } },
  });
  assert.equal(manifest.testSetId, testSet.id);
  assert.equal(manifest.testSetCode, testSet.code);
  assert.deepEqual(
    manifest.entries.map((entry) => [entry.deliveryPosition, entry.category, entry.sourceQuestionId]),
    SLOTS.map((category, index) => [index + 1, category, questions[index]!.id]),
  );

  const renamedCode = uniqueCode("RENAMED");
  const rename = await requestAs(adminId, "PUT", `/admin/test-sets/${testSet.id}`, {
    code: renamedCode,
  });
  assert.equal(rename.status, 200);
  assert.equal((await findListedTestSet(testSet.id)).code, renamedCode);

  const persisted = await prisma.submissionManifest.findUniqueOrThrow({
    where: { submissionId: started.submissionId },
  });
  assert.equal(persisted.testSetId, testSet.id);
  assert.equal(persisted.testSetCode, testSet.code);

  const studentDetail = await requestAs(student.id, "GET", `/submissions/${started.submissionId}`);
  const studentBody = await studentDetail.json() as {
    data?: { testSet: { id: string; code: string } | null };
    error?: string;
  };
  assert.equal(studentDetail.status, 200, JSON.stringify(studentBody));
  assert.deepEqual(studentBody.data!.testSet, { id: testSet.id, code: testSet.code });

  const adminDetail = await requestAs(adminId, "GET", `/admin/submissions/${started.submissionId}`);
  const adminBody = await adminDetail.json() as {
    data?: { testSet: { id: string; code: string } | null };
    error?: string;
  };
  assert.equal(adminDetail.status, 200, JSON.stringify(adminBody));
  assert.deepEqual(adminBody.data!.testSet, { id: testSet.id, code: testSet.code });
});
