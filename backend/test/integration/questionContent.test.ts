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
import jwt from "jsonwebtoken";
import type { PrismaClient } from "../../src/generated/client.js";
import { installFakeR2Head } from "../fixtures/fakeR2.js";
import { SLOTS, createFixtureTestSet, deliverableContent } from "../fixtures/testSets.js";

const execFileAsync = promisify(execFile);

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: () => Promise<void>;
let server: Server;
let baseUrl: string;
let adminId: string;
let storage: ReturnType<typeof installFakeR2Head>;

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.JWT_SECRET = "question-content-integration-secret";
  process.env.R2_ACCOUNT_ID = "question-content-test-account";
  process.env.R2_ACCESS_KEY_ID = "question-content-test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "question-content-test-secret-key";
  process.env.R2_BUCKET_NAME = "question-content-test-bucket";
  process.env.FRONTEND_URL = "https://fluentcheck.example.test";

  await execFileAsync(
    "npx",
    ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"],
    { cwd: process.cwd(), env: { ...process.env }, timeout: 120_000 },
  );

  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  const { r2Client } = await import("../../src/config/r2.js");
  storage = installFakeR2Head(r2Client);
  const { createApp } = await import("../../src/server.js");
  server = createApp().listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;

  const email = `${crypto.randomUUID()}@example.test`;
  adminId = (await prisma.user.create({
    data: {
      username: `content_admin_${crypto.randomUUID().replaceAll("-", "")}`,
      email,
      normalizedEmail: email,
      password: "unused",
      role: "ADMIN",
    },
  })).id;
}, { timeout: 120_000 });

after(async () => {
  storage?.restore();
  if (server) {
    server.close();
    await once(server, "close");
  }
  if (disconnectDB) await disconnectDB();
  if (container) await container.stop();
}, { timeout: 120_000 });

async function request(method: string, path: string, body?: unknown) {
  const response = await fetch(`${baseUrl}/api${path}`, {
    method,
    headers: {
      Cookie: `jwt=${jwt.sign({ id: adminId }, process.env.JWT_SECRET!)}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() as Record<string, any> };
}

const OPTIONS = [0, 1, 2, 3].map((index) => ({
  title: `Option ${index + 1}`,
  bullets: [`Pro ${index + 1}`, `Con ${index + 1}`],
}));

/** A deliverable Test Set whose Part 3 Question has option text but no icons yet. */
async function testSetWithIconlessPart3() {
  const testSet = await createFixtureTestSet(prisma, "QC");
  const questions = [];
  for (const category of SLOTS) {
    questions.push(await prisma.question.create({
      data: {
        category,
        testSetId: testSet.id,
        audioStorageKey: `questions/${crypto.randomUUID()}/prompt.webm`,
        audioMimeType: "audio/webm",
        audioSizeBytes: 128,
        audioUploadStatus: "UPLOADED",
        ...(category === "PART_3" ? {} : deliverableContent(category)),
        tasks: { create: [{ promptText: `${category} task`, order: 1 }] },
      },
    }));
  }
  return { testSet, part3: questions[3]!, part2: questions[2]! };
}

async function readiness(testSetId: string) {
  const { body } = await request("GET", "/admin/test-sets");
  return (body.data as Array<{ id: string; status: string }>).find((set) => set.id === testSetId)!;
}

async function uploadIcon(questionId: string, index: number) {
  const presigned = await request(
    "POST",
    `/questions/${questionId}/options/${index}/icon/presigned-url`,
    { mimeType: "image/png" },
  );
  assert.equal(presigned.status, 201, JSON.stringify(presigned.body));
  const { storageKey } = presigned.body.data;
  storage.put(storageKey, { contentLength: 64, contentType: "image/png" });
  return request("POST", `/questions/${questionId}/options/${index}/icon/confirm`, { storageKey });
}

test("admin API validates cue card and options per slot", async () => {
  const testSet = await createFixtureTestSet(prisma, "QCV");
  const part2 = await request("POST", "/questions", {
    category: "PART_2",
    testSetId: testSet.id,
    cueCard: { topic: "A trip", points: ["Where", "Who", "Why"] },
  });
  assert.equal(part2.status, 201);
  assert.deepEqual(part2.body.data.cueCard, { topic: "A trip", points: ["Where", "Who", "Why"] });

  const badPoints = await request("PUT", `/questions/${part2.body.data.id}`, {
    cueCard: { topic: "A trip", points: ["Where"] },
  });
  assert.equal(badPoints.status, 400);

  const wrongSlot = await request("PUT", `/questions/${part2.body.data.id}`, { options: OPTIONS });
  assert.equal(wrongSlot.status, 400);

  const threeOptions = await request("POST", "/questions", {
    category: "PART_3",
    testSetId: testSet.id,
    options: OPTIONS.slice(1),
  });
  assert.equal(threeOptions.status, 400);
});

test("a Part 3 Question without all four option icons is not deliverable", async () => {
  const { testSet, part3 } = await testSetWithIconlessPart3();
  assert.equal((await readiness(testSet.id)).status, "DRAFT");

  // Icons need the option texts first.
  const early = await request("POST", `/questions/${part3.id}/options/0/icon/presigned-url`, {
    mimeType: "image/png",
  });
  assert.equal(early.status, 409);

  const saved = await request("PUT", `/questions/${part3.id}`, { options: OPTIONS });
  assert.equal(saved.status, 200);
  for (const index of [0, 1, 2]) {
    assert.equal((await uploadIcon(part3.id, index)).status, 200);
  }
  assert.equal((await readiness(testSet.id)).status, "DRAFT", "three icons are not enough");

  // A confirmed key must have been issued for this question and option.
  const forged = await request("POST", `/questions/${part3.id}/options/3/icon/confirm`, {
    storageKey: `questions/${part3.id}/options/2/${crypto.randomUUID()}.png`,
  });
  assert.equal(forged.status, 400);
  const missing = await request("POST", `/questions/${part3.id}/options/3/icon/confirm`, {
    storageKey: `questions/${part3.id}/options/3/${crypto.randomUUID()}.png`,
  });
  assert.equal(missing.status, 400);

  assert.equal((await uploadIcon(part3.id, 3)).status, 200);
  assert.equal((await readiness(testSet.id)).status, "DELIVERABLE");

  // Editing option text keeps the verified icons.
  const edited = await request("PUT", `/questions/${part3.id}`, {
    options: OPTIONS.map((option) => ({ ...option, title: `${option.title}!` })),
  });
  assert.equal(edited.status, 200);
  assert.ok(edited.body.data.options.every((option: { icon: unknown; iconUrl: string }) =>
    option.icon && option.iconUrl.startsWith("https://")));
  assert.equal((await readiness(testSet.id)).status, "DELIVERABLE");
});

test("the delivered prompt snapshot keeps cue card and options after later edits", async () => {
  // Only this Test Set may be deliverable for a deterministic start.
  await prisma.question.updateMany({ where: { deletedAt: null }, data: { deletedAt: new Date() } });
  const { part3, part2 } = await testSetWithIconlessPart3();
  await request("PUT", `/questions/${part3.id}`, { options: OPTIONS });
  for (const index of [0, 1, 2, 3]) await uploadIcon(part3.id, index);

  const email = `${crypto.randomUUID()}@example.test`;
  const student = await prisma.user.create({
    data: { username: `content_student_${crypto.randomUUID().replaceAll("-", "")}`, email, normalizedEmail: email, password: "unused" },
  });
  const { initializeManifestSubmission } = await import(
    "../../src/service/manifestSubmissionInitialization.service.js"
  );
  const sign = async (key: string) => `https://media.example/${encodeURIComponent(key)}`;
  const started = await initializeManifestSubmission(student.id, undefined, {
    chooseIndex: () => 0,
    signPromptMedia: sign,
    signOptionIcon: sign,
  });
  const delivered2 = started.entries.find((entry) => entry.category === "PART_2")!;
  const delivered3 = started.entries.find((entry) => entry.category === "PART_3")!;
  assert.deepEqual(delivered2.cueCard, deliverableContent("PART_2").cueCard);
  assert.deepEqual(delivered3.options?.map((option) => option.title), OPTIONS.map((option) => option.title));
  assert.ok(delivered3.options?.every((option) => option.iconUrl?.startsWith("https://")));

  await request("PUT", `/questions/${part2.id}`, {
    cueCard: { topic: "Changed", points: ["x", "y", "z"] },
  });
  await request("PUT", `/questions/${part3.id}`, {
    options: OPTIONS.map((option) => ({ ...option, title: "Changed" })),
  });

  const entries = await prisma.manifestEntry.findMany({
    where: { manifestId: started.manifestId },
    orderBy: { deliveryPosition: "asc" },
  });
  assert.deepEqual(entries[2]!.cueCard, deliverableContent("PART_2").cueCard);
  assert.deepEqual(
    (entries[3]!.options as Array<{ title: string }>).map((option) => option.title),
    OPTIONS.map((option) => option.title),
  );
  // The snapshot is immutable evidence.
  await assert.rejects(
    prisma.manifestEntry.update({ where: { id: entries[3]!.id }, data: { options: [] } }),
  );
});
