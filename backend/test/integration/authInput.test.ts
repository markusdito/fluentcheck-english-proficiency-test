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

  await prisma.user.update({
    where: { id: user.id },
    data: { normalizedEmail: "legacy.user@example.com" },
  });
});

test("normalized identities take precedence over colliding legacy rows", async () => {
  const normalizedUser = await prisma.user.create({
    data: {
      username: "normalized_collision",
      email: "collision@example.com",
      normalizedEmail: "collision@example.com",
      password: await bcrypt.hash("normalized-password", 10),
    },
  });
  const legacyUser = await prisma.user.create({
    data: {
      username: "legacy_collision",
      email: "Collision@Example.COM",
      normalizedEmail: null,
      password: await bcrypt.hash("legacy-password", 10),
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

test("registration maps normalized-email conflicts to a generic 409 without a cookie", async () => {
  const first = await request("/auth/register", {
    username: "first_user",
    email: "First.User@Example.COM",
    password: "password-123",
  });
  assert.equal(first.status, 201);

  const duplicate = await request("/auth/register", {
    username: "second_user",
    email: " first.user@example.com ",
    password: "password-123",
  });
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { error: "Unable to create account" });
  assert.equal(duplicate.headers.get("set-cookie"), null);
  assert.equal(await prisma.user.count(), 1);
});

test("registration maps username conflicts to the same generic 409", async () => {
  const first = await request("/auth/register", {
    username: "same_user",
    email: "first@example.com",
    password: "password-123",
  });
  assert.equal(first.status, 201);

  const duplicate = await request("/auth/register", {
    username: " SAME_USER ",
    email: "second@example.com",
    password: "password-123",
  });
  assert.equal(duplicate.status, 409);
  assert.deepEqual(await duplicate.json(), { error: "Unable to create account" });
  assert.equal(duplicate.headers.get("set-cookie"), null);
  assert.equal(await prisma.user.count(), 1);
});

test("concurrent duplicate registrations have one database winner for each identity", async () => {
  const duplicateEmails = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      request("/auth/register", {
        username: `email_race_${index}`,
        email: "email-race@example.com",
        password: "password-123",
      }),
    ),
  );
  assert.deepEqual(
    duplicateEmails.map((response) => response.status).sort((a, b) => a - b),
    [201, 409, 409, 409, 409],
  );
  for (const response of duplicateEmails) {
    if (response.status === 409) assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal(await prisma.user.count(), 1);

  const userCountBeforeUsernameRace = await prisma.user.count();
  const duplicateUsernames = await Promise.all(
    Array.from({ length: 5 }, (_, index) =>
      request("/auth/register", {
        username: "username_race",
        email: `username-race-${index}@example.com`,
        password: "password-123",
      }),
    ),
  );
  assert.deepEqual(
    duplicateUsernames.map((response) => response.status).sort((a, b) => a - b),
    [201, 409, 409, 409, 409],
  );
  for (const response of duplicateUsernames) {
    if (response.status === 409) assert.equal(response.headers.get("set-cookie"), null);
  }
  assert.equal(await prisma.user.count(), userCountBeforeUsernameRace + 1);
});

test("deactivated accounts retain email identity and username registration conflicts", async () => {
  const account = await prisma.user.create({
    data: {
      username: "reserved_user",
      email: "Reserved@Example.COM",
      normalizedEmail: "reserved@example.com",
      password: await bcrypt.hash("password-123", 10),
      deletedAt: new Date(),
    },
  });
  assert.ok(account.deletedAt);

  const legacyAccount = await prisma.user.create({
    data: {
      username: "legacy_reserved_user",
      email: "Legacy.Reserved@Example.COM",
      normalizedEmail: null,
      password: await bcrypt.hash("password-123", 10),
      deletedAt: new Date(),
    },
  });
  assert.ok(legacyAccount.deletedAt);

  const emailConflict = await request("/auth/register", {
    username: "replacement_user",
    email: "reserved@example.com",
    password: "password-123",
  });
  const usernameConflict = await request("/auth/register", {
    username: " RESERVED_USER ",
    email: "replacement@example.com",
    password: "password-123",
  });
  const legacyEmailConflict = await request("/auth/register", {
    username: "legacy_replacement_user",
    email: " legacy.reserved@example.com ",
    password: "password-123",
  });
  const legacyUsernameAccount = await prisma.user.create({
    data: {
      username: "Legacy_Reserved",
      email: "legacy-username@example.com",
      normalizedEmail: "legacy-username@example.com",
      password: await bcrypt.hash("password-123", 10),
      deletedAt: new Date(),
    },
  });
  assert.ok(legacyUsernameAccount.deletedAt);
  const legacyUsernameConflict = await request("/auth/register", {
    username: " legacy_reserved ",
    email: "legacy-username-replacement@example.com",
    password: "password-123",
  });
  assert.equal(emailConflict.status, 409);
  assert.equal(usernameConflict.status, 409);
  assert.equal(legacyEmailConflict.status, 409);
  assert.equal(legacyUsernameConflict.status, 409);
  const genericConflict = await emailConflict.json();
  assert.deepEqual(genericConflict, await usernameConflict.json());
  assert.deepEqual(genericConflict, await legacyEmailConflict.json());
  assert.deepEqual(genericConflict, await legacyUsernameConflict.json());
  assert.equal(emailConflict.headers.get("set-cookie"), null);
  assert.equal(usernameConflict.headers.get("set-cookie"), null);
  assert.equal(legacyEmailConflict.headers.get("set-cookie"), null);
  assert.equal(legacyUsernameConflict.headers.get("set-cookie"), null);
  assert.equal(await prisma.user.count(), 3);
});

test("login uses normalized identity and keeps all invalid credential outcomes generic", async () => {
  const password = "exact password";
  const active = await prisma.user.create({
    data: {
      username: "login_user",
      email: "Login.User@Example.COM",
      normalizedEmail: "login.user@example.com",
      password: await bcrypt.hash(password, 10),
    },
  });
  const deactivated = await prisma.user.create({
    data: {
      username: "deactivated_user",
      email: "deactivated@example.com",
      normalizedEmail: "deactivated@example.com",
      password: await bcrypt.hash(password, 10),
      deletedAt: new Date(),
    },
  });
  assert.ok(deactivated.deletedAt);
  await prisma.user.create({
    data: {
      username: "provider_only_user",
      email: "provider-only@example.com",
      normalizedEmail: "provider-only@example.com",
      password: null,
    },
  });

  const successful = await request("/auth/login", {
    email: " login.user@example.com ",
    password,
  });
  assert.equal(successful.status, 200);
  assert.equal((await successful.json()).data.user.id, active.id);
  assert.ok(successful.headers.get("set-cookie")?.startsWith("jwt="));

  const originalCompare = bcrypt.compare;
  let comparisonCount = 0;
  const comparedHashes: string[] = [];
  const dummyPasswordHash =
    "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
  bcrypt.compare = async (candidate, hash) => {
    comparisonCount += 1;
    comparedHashes.push(hash);
    return originalCompare(candidate, hash);
  };

  let attempts: Response[];
  try {
    attempts = await Promise.all([
      request("/auth/login", { email: "missing@example.com", password }),
      request("/auth/login", { email: "login.user@example.com", password: "wrong-password" }),
      request("/auth/login", { email: "deactivated@example.com", password }),
      request("/auth/login", { email: "provider-only@example.com", password }),
    ]);
  } finally {
    bcrypt.compare = originalCompare;
  }
  assert.equal(comparisonCount, 4);
  assert.equal(
    comparedHashes.filter((hash) => hash === dummyPasswordHash).length,
    3,
  );
  for (const response of attempts) {
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Invalid email or password" });
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("login compares password input exactly as submitted", async () => {
  const password = "  exact password  ";
  await prisma.user.create({
    data: {
      username: "whitespace_password",
      email: "whitespace@example.com",
      normalizedEmail: "whitespace@example.com",
      password: await bcrypt.hash(password, 10),
    },
  });

  const exact = await request("/auth/login", {
    email: "whitespace@example.com",
    password,
  });
  const trimmed = await request("/auth/login", {
    email: "whitespace@example.com",
    password: password.trim(),
  });
  assert.equal(exact.status, 200);
  assert.equal(trimmed.status, 401);
});

test("authentication database failures use the generic 500 contract", async () => {
  const originalCompare = bcrypt.compare;
  const originalFindFirst = prisma.user.findFirst;
  const originalQueryRaw = prisma.$queryRaw;
  let comparisonCount = 0;
  const comparedHashes: string[] = [];
  const dummyPasswordHash =
    "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";
  bcrypt.compare = async (candidate, hash) => {
    comparisonCount += 1;
    comparedHashes.push(hash);
    return originalCompare(candidate, hash);
  };

  (prisma.user as { findFirst: typeof originalFindFirst }).findFirst = async () => {
    throw new Error("simulated database failure");
  };

  const responses: Response[] = [];
  try {
    responses.push(await request("/auth/login", {
      email: "database-failure@example.com",
      password: "password-123",
    }));

    (prisma.user as { findFirst: typeof originalFindFirst }).findFirst =
      originalFindFirst;
    (prisma as { $queryRaw: typeof originalQueryRaw }).$queryRaw = async () => {
      throw new Error("simulated legacy lookup failure");
    };
    responses.push(await request("/auth/login", {
      email: "legacy-database-failure@example.com",
      password: "password-123",
    }));
  } finally {
    bcrypt.compare = originalCompare;
    (prisma.user as { findFirst: typeof originalFindFirst }).findFirst = originalFindFirst;
    (prisma as { $queryRaw: typeof originalQueryRaw }).$queryRaw = originalQueryRaw;
  }
  assert.equal(comparisonCount, 2);
  assert.deepEqual(comparedHashes, [dummyPasswordHash, dummyPasswordHash]);
  for (const response of responses) {
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "Internal server error" });
  }
});
