import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import type { Server } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { after, before, beforeEach, test } from "node:test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import bcrypt from "bcryptjs";
import type { Express } from "express";
import type { PrismaClient } from "../../src/generated/client.js";

const execFileAsync = promisify(execFile);

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: () => Promise<void>;
let app: Express;
let server: Server;
let baseUrl: string;
let createApplication: typeof import("../../src/server.js").createApp;

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
  process.env.JWT_SECRET = "auth-input-integration-secret";
  process.env.R2_ACCOUNT_ID = "auth-input-test-account";
  process.env.R2_ACCESS_KEY_ID = "auth-input-test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "auth-input-test-secret-key";
  process.env.R2_BUCKET_NAME = "auth-input-test-bucket";
  process.env.FRONTEND_URL = "https://fluentcheck.example.test";

  await migrateDatabase(process.env.DATABASE_URL);

  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  ({ createApp: createApplication } = await import("../../src/server.js"));
  app = createApplication();
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

async function request(path: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

test("registration dual-writes trimmed display email and normalized identity", async () => {
  const response = await request("/auth/register", {
    username: "  Jane_Doe9  ",
    email: "  Jane.Doe+tag@Example.COM  ",
    password: "password",
  });

  assert.equal(response.status, 201);
  const payload = await response.json();
  assert.equal(payload.data.user.email, "Jane.Doe+tag@Example.COM");
  assert.ok(response.headers.get("set-cookie")?.startsWith("jwt="));

  const user = await prisma.user.findUnique({
    where: { email: "Jane.Doe+tag@Example.COM" },
  });
  assert.ok(user);
  assert.equal(user.username, "jane_doe9");
  assert.equal(user.email, "Jane.Doe+tag@Example.COM");
  assert.equal(user.normalizedEmail, "jane.doe+tag@example.com");
});

test("legacy accounts remain readable through the explicit null-key fallback", async () => {
  const password = "legacy-password";
  const user = await prisma.user.create({
    data: {
      username: "legacy_user",
      email: "  Legacy.User@Example.COM  ",
      normalizedEmail: null,
      password: await bcrypt.hash(password, 10),
    },
  });

  const response = await request("/auth/login", {
    email: "legacy.user@example.com",
    password,
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.user.id, user.id);
  assert.ok(response.headers.get("set-cookie")?.startsWith("jwt="));
});

test("normalized identities take precedence over colliding legacy rows", async () => {
  const legacyUser = await prisma.user.create({
    data: {
      username: "legacy_collision",
      email: "Collision@Example.COM",
      normalizedEmail: null,
      password: await bcrypt.hash("legacy-password", 10),
    },
  });
  const normalizedUser = await prisma.user.create({
    data: {
      username: "normalized_collision",
      email: "collision@example.com",
      normalizedEmail: "collision@example.com",
      password: await bcrypt.hash("normalized-password", 10),
    },
  });

  const response = await request("/auth/login", {
    email: "COLLISION@example.com",
    password: "normalized-password",
  });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.user.id, normalizedUser.id);
  assert.notEqual(normalizedUser.id, legacyUser.id);
});
