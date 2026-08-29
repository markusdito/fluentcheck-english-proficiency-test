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
let app: Express;
let server: Server;
let baseUrl: string;

before(async () => {
  container = await new PostgreSqlContainer("postgres:17-alpine").start();
  process.env.DATABASE_URL = container.getConnectionUri();
  process.env.R2_BUCKET_NAME = "completion-test-bucket";
  process.env.R2_ACCOUNT_ID = "completion-test-account";
  process.env.R2_ACCESS_KEY_ID = "completion-test-key";
  process.env.R2_SECRET_ACCESS_KEY = "completion-test-secret";
  process.env.JWT_SECRET = "completion-test-secret";
  await execFileAsync("npx", ["prisma", "migrate", "deploy", "--schema", "prisma/schema.prisma"], {
    cwd: process.cwd(),
    env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    timeout: 120_000,
  });
  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  ({ createApp: appFactory } = await import("../../src/server.js"));
  app = appFactory();
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Completion test server did not bind");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, { timeout: 120_000 });

let appFactory: typeof import("../../src/server.js").createApp;

after(async () => {
  if (server) {
    server.close();
    await once(server, "close");
  }
  if (disconnectDB) await disconnectDB();
  if (container) await container.stop();
}, { timeout: 120_000 });

async function fixture() {
  const student = await prisma.user.create({
    data: {
      username: `completion-${crypto.randomUUID()}`,
      email: `${crypto.randomUUID()}@example.test`,
      password: "unused",
    },
  });
  const { submission, entries } = await prisma.$transaction(async (tx: any) => {
    const submission = await tx.submission.create({ data: { studentId: student.id } });
    const manifest = await tx.submissionManifest.create({ data: { submissionId: submission.id, version: 1 } });
    const entries: any[] = [];
    for (const [index, category] of (["PART_1", "PART_2", "PART_3"] as const).entries()) {
      const question = await tx.question.create({
        data: { category, order: Math.floor(Math.random() * 1_000_000), tasks: { create: { promptText: "Prompt", order: 1 } } },
      });
      entries.push(await tx.manifestEntry.create({
        data: {
          manifestId: manifest.id,
          submissionId: submission.id,
          category,
          deliveryPosition: index + 1,
          sourceQuestionId: question.id,
        },
      }));
    }
    return { submission, entries };
  });
  return { student, submission, entries };
}

function cookie(studentId: string) {
  return `jwt=${jwt.sign({ id: studentId }, process.env.JWT_SECRET!)}`;
}

test("completion requires exact server proofs and is idempotent after the atomic transition", async () => {
  const { student, submission, entries } = await fixture();
  for (const entry of entries) {
    await prisma.answer.create({
      data: {
        submissionId: submission.id,
        manifestEntryId: entry.id,
        storageKey: `submissions/${submission.id}/answers/${entry.id}.webm`,
        mimeType: "video/webm",
        uploadStatus: "UPLOADED",
        sizeBytes: 10,
        verifiedAt: new Date(),
        observedMimeType: "video/webm",
        proofVersion: 1,
      },
    });
  }

  const complete = () => fetch(`${baseUrl}/api/submissions/${submission.id}/complete`, {
    method: "POST",
    headers: { Cookie: cookie(student.id) },
  });
  const first = await complete();
  assert.equal(first.status, 200);
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } })).status, "AWAITING_PAYMENT");

  const replay = await complete();
  assert.equal(replay.status, 200);
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } })).status, "AWAITING_PAYMENT");
});

test("pending or invalidated evidence leaves the submission in progress", async () => {
  const { student, submission, entries } = await fixture();
  for (const entry of entries) {
    await prisma.answer.create({
      data: {
        submissionId: submission.id,
        manifestEntryId: entry.id,
        storageKey: `submissions/${submission.id}/answers/${entry.id}.webm`,
        mimeType: "video/webm",
        uploadStatus: "UPLOADED",
        sizeBytes: 10,
        verifiedAt: new Date(),
        observedMimeType: "video/webm",
        proofVersion: 1,
      },
    });
  }
  await prisma.answer.update({ where: { manifestEntryId: entries[1].id }, data: { proofVersion: 2 } });
  const response = await fetch(`${baseUrl}/api/submissions/${submission.id}/complete`, {
    method: "POST",
    headers: { Cookie: cookie(student.id) },
  });
  assert.equal(response.status, 400);
  assert.equal((await prisma.submission.findUnique({ where: { id: submission.id } })).status, "IN_PROGRESS");
});

async function provisionVerifiedAnswers(entries: any[], submissionId: string) {
  for (const entry of entries) {
    await prisma.answer.create({
      data: {
        submissionId,
        manifestEntryId: entry.id,
        storageKey: `submissions/${submissionId}/answers/${entry.id}.webm`,
        mimeType: "video/webm",
        uploadStatus: "UPLOADED",
        sizeBytes: 10,
        verifiedAt: new Date(),
        observedMimeType: "video/webm",
        proofVersion: 1,
      },
    });
  }
}

test("waived completion dispatches automatic assignment and commits exactly two examiners", async () => {
  await prisma.appSettings.update({ where: { id: 1 }, data: { paymentEnabled: false } });
  try {
    await prisma.user.createMany({
      data: [
        {
          username: `waived-examiner-${crypto.randomUUID()}`,
          email: `${crypto.randomUUID()}@example.test`,
          password: "unused",
          role: "EXAMINER",
        },
        {
          username: `waived-examiner-${crypto.randomUUID()}`,
          email: `${crypto.randomUUID()}@example.test`,
          password: "unused",
          role: "EXAMINER",
        },
      ],
    });
    const { student, submission, entries } = await fixture();
    await provisionVerifiedAnswers(entries, submission.id);

    const response = await fetch(`${baseUrl}/api/submissions/${submission.id}/complete`, {
      method: "POST",
      headers: { Cookie: cookie(student.id) },
    });

    assert.equal(response.status, 200);
    assert.equal(
      (await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })).status,
      "SCORING",
    );
    assert.equal(
      await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
      2,
    );
  } finally {
    await prisma.appSettings.update({ where: { id: 1 }, data: { paymentEnabled: true } });
  }
});

test("waived completion stays successful when assignment fails and admin recovery assigns two examiners", async () => {
  await prisma.appSettings.update({ where: { id: 1 }, data: { paymentEnabled: false } });
  try {
    // No examiners: automatic assignment after waived completion cannot proceed.
    await prisma.examinerAssignment.deleteMany();
    await prisma.user.deleteMany({ where: { role: "EXAMINER" } });
    const { student, submission, entries } = await fixture();
    await provisionVerifiedAnswers(entries, submission.id);

    const response = await fetch(`${baseUrl}/api/submissions/${submission.id}/complete`, {
      method: "POST",
      headers: { Cookie: cookie(student.id) },
    });

    assert.equal(response.status, 200);
    assert.equal(
      (await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })).status,
      "PAID",
    );
    assert.equal(
      await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
      0,
    );

    // The submission remains Assignment-ready and visible to admin recovery.
    await prisma.user.createMany({
      data: [
        {
          username: `recovery-examiner-${crypto.randomUUID()}`,
          email: `${crypto.randomUUID()}@example.test`,
          password: "unused",
          role: "EXAMINER",
        },
        {
          username: `recovery-examiner-${crypto.randomUUID()}`,
          email: `${crypto.randomUUID()}@example.test`,
          password: "unused",
          role: "EXAMINER",
        },
      ],
    });
    const admin = await prisma.user.create({
      data: {
        username: `recovery-admin-${crypto.randomUUID()}`,
        email: `${crypto.randomUUID()}@example.test`,
        password: "unused",
        role: "ADMIN",
      },
    });
    const recovery = await fetch(`${baseUrl}/api/admin/submissions/${submission.id}/assign`, {
      method: "POST",
      headers: { Cookie: `jwt=${jwt.sign({ id: admin.id }, process.env.JWT_SECRET!)}` },
    });
    const recoveryPayload = await recovery.json();

    assert.equal(recovery.status, 200);
    assert.equal(recoveryPayload.data.outcome, "CREATED");
    assert.equal(recoveryPayload.data.assignments.length, 2);
    assert.equal(
      (await prisma.submission.findUniqueOrThrow({ where: { id: submission.id } })).status,
      "SCORING",
    );
    assert.equal(
      await prisma.examinerAssignment.count({ where: { submissionId: submission.id } }),
      2,
    );
  } finally {
    await prisma.appSettings.update({ where: { id: 1 }, data: { paymentEnabled: true } });
  }
});
