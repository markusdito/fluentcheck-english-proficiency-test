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
import jwt from "jsonwebtoken";
import type { PrismaClient } from "../../src/generated/client.js";

const execFileAsync = promisify(execFile);
const JWT_SECRET = "remember-me-integration-secret";
const SESSION_SECONDS = 60 * 60;
const REMEMBERED_SESSION_SECONDS = 7 * 24 * 60 * 60;

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: () => Promise<void>;
let createApplication: typeof import("../../src/server.js").createApp;
let app: Express;
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
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.JWT_EXPIRES_IN = `${SESSION_SECONDS}s`;
  process.env.REMEMBERED_SESSION_SECONDS = `${REMEMBERED_SESSION_SECONDS}`;
  process.env.R2_ACCOUNT_ID = "remember-me-test-account";
  process.env.R2_ACCESS_KEY_ID = "remember-me-test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "remember-me-test-secret-key";
  process.env.R2_BUCKET_NAME = "remember-me-test-bucket";
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

async function createUser(username: string) {
  const email = `${username}@example.test`;
  return prisma.user.create({
    data: {
      username,
      email,
      normalizedEmail: email,
      password: await bcrypt.hash("password-123", 10),
    },
  });
}

async function request(path: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function setCookieValues(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  return headers.getSetCookie?.() ??
    (headers.get("set-cookie") ?? "").split(/,(?=[^;]+=)/u).filter(Boolean);
}

function authCookie(response: Response) {
  const cookie = setCookieValues(response).find((value) => value.startsWith("jwt="));
  assert.ok(cookie);
  return cookie;
}

function tokenFromCookie(cookie: string) {
  return cookie.slice("jwt=".length).split(";", 1)[0];
}

function assertCookieSecurity(cookie: string) {
  assert.match(cookie, /^jwt=[^;]+;/u);
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /SameSite=Lax/u);
  assert.match(cookie, /Path=\//u);
  assert.doesNotMatch(cookie, /Secure/u);
}

function assertSessionCookie(cookie: string) {
  assertCookieSecurity(cookie);
  assert.doesNotMatch(cookie, /Max-Age=/u);
  assert.doesNotMatch(cookie, /Expires=/u);
}

function assertRememberedCookie(cookie: string) {
  assertCookieSecurity(cookie);
  assert.match(cookie, new RegExp(`Max-Age=${REMEMBERED_SESSION_SECONDS}`));
  assert.match(cookie, /Expires=/u);
}

function assertJwtLifetime(cookie: string, expectedSeconds: number) {
  const decoded = jwt.decode(tokenFromCookie(cookie));
  assert.ok(decoded && typeof decoded === "object");
  const { exp, iat } = decoded;
  assert.equal(typeof iat, "number");
  assert.equal(typeof exp, "number");
  if (typeof iat !== "number" || typeof exp !== "number") {
    assert.fail("JWT is missing numeric iat and exp claims");
  }
  const lifetime = exp - iat;
  assert.ok(
    lifetime >= expectedSeconds - 1 && lifetime <= expectedSeconds + 1,
    `expected JWT lifetime near ${expectedSeconds}s, got ${lifetime}s`,
  );
}

test("omitted rememberMe selects a session cookie and one-hour JWT", async () => {
  const user = await createUser("omitted_remember_me");
  const response = await request("/auth/login", {
    email: user.email,
    password: "password-123",
  });

  assert.equal(response.status, 200);
  const cookie = authCookie(response);
  assertSessionCookie(cookie);
  assertJwtLifetime(cookie, SESSION_SECONDS);
});

test("false rememberMe selects a session cookie and one-hour JWT", async () => {
  const user = await createUser("false_remember_me");
  const response = await request("/auth/login", {
    email: user.email,
    password: "password-123",
    rememberMe: false,
  });

  assert.equal(response.status, 200);
  const cookie = authCookie(response);
  assertSessionCookie(cookie);
  assertJwtLifetime(cookie, SESSION_SECONDS);
});

test("true rememberMe selects a persistent cookie and configured seven-day JWT", async () => {
  const user = await createUser("true_remember_me");
  const response = await request("/auth/login", {
    email: user.email,
    password: "password-123",
    rememberMe: true,
  });

  assert.equal(response.status, 200);
  const cookie = authCookie(response);
  assertRememberedCookie(cookie);
  assertJwtLifetime(cookie, REMEMBERED_SESSION_SECONDS);
});

test("a non-boolean rememberMe is rejected through the public HTTP contract", async () => {
  const user = await createUser("invalid_remember_me");
  const response = await request("/auth/login", {
    email: user.email,
    password: "password-123",
    rememberMe: "true",
  });

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Invalid request",
    errors: { rememberMe: ["rememberMe must be a boolean"] },
  });
  assert.equal(response.headers.get("set-cookie"), null);
});

test("registration always selects a session cookie and one-hour JWT", async () => {
  const response = await request("/auth/register", {
    username: "session_registration",
    email: "session-registration@example.test",
    password: "password-123",
  });

  assert.equal(response.status, 201);
  const cookie = authCookie(response);
  assertSessionCookie(cookie);
  assertJwtLifetime(cookie, SESSION_SECONDS);
});
