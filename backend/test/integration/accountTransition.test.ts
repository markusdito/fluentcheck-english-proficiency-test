import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { once } from "node:events";
import { promisify } from "node:util";
import { after, before, beforeEach, test } from "node:test";
import type { Server } from "node:http";
import jwt from "jsonwebtoken";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import type { PrismaClient, Role } from "../../src/generated/client.js";

const execFileAsync = promisify(execFile);

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: () => Promise<void>;
let server: Server;
let baseUrl: string;

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
  process.env.JWT_SECRET = "account-transition-integration-secret";
  process.env.FRONTEND_URL = "https://fluentcheck.example.test";

  await migrateDatabase(process.env.DATABASE_URL);

  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  const { createApp } = await import("../../src/server.js");
  const app: Express = createApp();
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
}, { timeout: 120_000 });

beforeEach(async () => {
  await prisma.user.deleteMany();
});

after(async () => {
  server.close();
  await once(server, "close");
  await disconnectDB();
  await container.stop();
}, { timeout: 120_000 });

function uniqueUsername(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "")}`;
}

async function createUser(
  prefix: string,
  role: Role = "STUDENT",
) {
  const username = uniqueUsername(prefix);
  const email = `${username}@example.test`;
  return prisma.user.create({
    data: {
      username,
      email,
      normalizedEmail: email,
      password: await bcrypt.hash("password", 10),
      role,
    },
  });
}

function cookieFor(userId: string) {
  return `jwt=${jwt.sign({ id: userId }, process.env.JWT_SECRET!)}`;
}

async function requestRole(
  targetId: string,
  role: string,
  actorCookie: string,
) {
  return fetch(`${baseUrl}/api/admin/users/${targetId}/role`, {
    method: "PUT",
    headers: {
      Cookie: actorCookie,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ role }),
  });
}

test("role transitions reject invalid, missing, and self targets with stable errors", async () => {
  const admin = await createUser("admin", "ADMIN");
  const target = await createUser("target");
  const cookie = cookieFor(admin.id);

  const invalid = await requestRole(target.id, "OWNER", cookie);
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), {
    error: "Role must be one of STUDENT, EXAMINER, ADMIN",
    code: "INVALID_ROLE",
  });

  const missingId = crypto.randomUUID();
  const missing = await requestRole(missingId, "EXAMINER", cookie);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), {
    error: "User not found",
    code: "USER_NOT_FOUND",
    userId: missingId,
  });

  const self = await requestRole(admin.id, "STUDENT", cookie);
  assert.equal(self.status, 400);
  assert.deepEqual(await self.json(), {
    error: "Cannot change your own role",
    code: "SELF_ROLE_CHANGE",
  });
});

test("a valid demotion commits and replaying the desired role is explicit", async () => {
  const admin = await createUser("admin", "ADMIN");
  const target = await createUser("target", "ADMIN");
  const cookie = cookieFor(admin.id);

  const updated = await requestRole(target.id, "EXAMINER", cookie);
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).data.outcome, "UPDATED");

  const replay = await requestRole(target.id, "EXAMINER", cookie);
  assert.equal(replay.status, 200);
  assert.equal((await replay.json()).data.outcome, "ALREADY_APPLIED");
});

test("concurrent demotions cannot remove every active administrator", async () => {
  const actor = await createUser("actor", "ADMIN");
  const firstTarget = await createUser("first_target", "ADMIN");
  const secondTarget = await createUser("second_target", "ADMIN");

  const responses = await Promise.all([
    requestRole(firstTarget.id, "EXAMINER", cookieFor(actor.id)),
    requestRole(secondTarget.id, "STUDENT", cookieFor(actor.id)),
  ]);
  const outcomes = await Promise.all(
    responses.map(async (response) => ({
      status: response.status,
      payload: await response.json(),
    })),
  );

  assert.deepEqual(outcomes.map(({ status }) => status).sort(), [200, 200]);
  assert.equal(
    await prisma.user.count({ where: { role: "ADMIN", deletedAt: null } }),
    1,
  );
  assert.ok(outcomes.every(({ payload }) => payload.data?.outcome === "UPDATED"));
  assert.equal(
    (await prisma.user.findUniqueOrThrow({ where: { id: actor.id } })).role,
    "ADMIN",
  );
});

test("non-admin callers cannot execute a role transition", async () => {
  const student = await createUser("student", "STUDENT");
  const target = await createUser("target");

  const response = await requestRole(target.id, "EXAMINER", cookieFor(student.id));
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { error: "Insufficient permissions" });
});
