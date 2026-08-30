import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import type { Server } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import jwt from "jsonwebtoken";
import { MemoryStore, type Store } from "express-rate-limit";
import type { Express } from "express";
import type { PrismaClient } from "../../src/generated/client.js";
import type { RateLimitRuntime } from "../../src/middleware/rate-limit.middleware.js";

const execFileAsync = promisify(execFile);
const HMAC_SECRET = "non-auth-rate-limit-test-secret-0123456789";
const JWT_SECRET = "non-auth-rate-limit-jwt-secret-0123456789";
const TEST_PASSWORD_HASH =
  "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

let container: StartedPostgreSqlContainer;
let prisma: PrismaClient;
let disconnectDB: () => Promise<void>;
let createApplication: typeof import("../../src/server.js").createApp;
let createRateLimitConfig: typeof import("../../src/config/rate-limit.js").createRateLimitConfig;

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
  process.env.R2_ACCOUNT_ID = "non-auth-rate-limit-test-account";
  process.env.R2_ACCESS_KEY_ID = "non-auth-rate-limit-test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "non-auth-rate-limit-test-secret";
  process.env.R2_BUCKET_NAME = "non-auth-rate-limit-test-bucket";
  process.env.FRONTEND_URL = "https://fluentcheck.example.test";

  await migrateDatabase(process.env.DATABASE_URL);

  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  ({ createApp: createApplication } = await import("../../src/server.js"));
  ({ createRateLimitConfig } = await import("../../src/config/rate-limit.js"));
}, { timeout: 120_000 });

after(async () => {
  await disconnectDB();
  await container.stop();
}, { timeout: 120_000 });

async function startRateLimitedApp(
  storeFactory: () => Store = () => new MemoryStore(),
  trustProxy = "none",
) {
  const app: Express = createApplication({
    rateLimit: {
      config: createRateLimitConfig({
        hmacSecret: HMAC_SECRET,
        jwtSecret: JWT_SECRET,
        trustProxy,
      }),
      storeFactory,
    },
  });
  const runtime = app.locals.rateLimit as RateLimitRuntime;
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    server,
    runtime,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function stopRateLimitedApp(server: Server, runtime: RateLimitRuntime) {
  server.close();
  await once(server, "close");
  await runtime.shutdown();
}

async function createUser(role: "STUDENT" | "ADMIN" = "STUDENT") {
  const id = crypto.randomUUID();
  const email = `${id}@example.test`;
  return prisma.user.create({
    data: {
      username: `rate_limit_${id.replaceAll("-", "")}`,
      email,
      normalizedEmail: email,
      password: TEST_PASSWORD_HASH,
      role,
    },
  });
}

function cookie(userId: string) {
  return `jwt=${jwt.sign({ id: userId }, JWT_SECRET)}`;
}

async function statuses(
  count: number,
  request: () => Promise<Response>,
) {
  const result: number[] = [];
  for (let attempt = 0; attempt < count; attempt += 1) {
    result.push((await request()).status);
  }
  return result;
}

test("protects payment checkout, Answer, question-audio, and Submission mutations", async () => {
  const student = await createUser();
  const admin = await createUser("ADMIN");
  const { server, runtime, url } = await startRateLimitedApp();

  try {
    const payStatuses = await statuses(11, () =>
      fetch(`${url}/api/payments/submissions/${crypto.randomUUID()}/pay`, {
        method: "POST",
        headers: { Cookie: cookie(student.id) },
      }),
    );
    assert.equal(payStatuses.slice(0, 10).every((status) => status !== 429), true);
    assert.equal(payStatuses[10], 429);

    const uploadStatuses = await statuses(29, () =>
      fetch(`${url}/api/uploads/presigned-url`, {
        method: "POST",
        headers: {
          Cookie: cookie(student.id),
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
    );
    assert.equal(uploadStatuses.every((status) => status === 400), true);
    const uploadConfirmation = await fetch(`${url}/api/uploads/confirm`, {
      method: "POST",
      headers: {
        Cookie: cookie(student.id),
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(uploadConfirmation.status, 400);
    const uploadBlocked = await fetch(`${url}/api/uploads/presigned-url`, {
      method: "POST",
      headers: {
        Cookie: cookie(student.id),
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(uploadBlocked.status, 429);

    const questionAudioStatuses = await statuses(59, () =>
      fetch(`${url}/api/questions/audio/presigned-url`, {
        method: "POST",
        headers: {
          Cookie: cookie(admin.id),
          "Content-Type": "application/json",
        },
        body: "{}",
      }),
    );
    assert.equal(
      questionAudioStatuses.every((status) => status === 400),
      true,
    );
    const questionAudioConfirmation = await fetch(`${url}/api/questions/audio/confirm`, {
      method: "POST",
      headers: {
        Cookie: cookie(admin.id),
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    assert.equal(questionAudioConfirmation.status, 400);
    const questionAudioBlocked = await fetch(
      `${url}/api/questions/audio/presigned-url`,
      {
        method: "POST",
        headers: {
          Cookie: cookie(admin.id),
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
    assert.equal(questionAudioBlocked.status, 429);

    const creationStatuses = await statuses(6, () =>
      fetch(`${url}/api/submissions`, {
        method: "POST",
        headers: { Cookie: cookie(student.id) },
      }),
    );
    assert.equal(creationStatuses.slice(0, 5).every((status) => status !== 429), true);
    assert.equal(creationStatuses[5], 429);

    const completionStatuses = await statuses(11, () =>
      fetch(`${url}/api/submissions/${crypto.randomUUID()}/complete`, {
        method: "POST",
        headers: { Cookie: cookie(student.id) },
      }),
    );
    assert.equal(
      completionStatuses.slice(0, 10).every((status) => status !== 429),
      true,
    );
    assert.equal(completionStatuses[10], 429);
  } finally {
    await stopRateLimitedApp(server, runtime);
  }
});

test("fails closed with a generic response on sensitive route store failure", async () => {
  const student = await createUser();
  const failingStoreFactory = () =>
    ({
      localKeys: false,
      increment: async () => {
        throw new Error("redis://user:password@private.example.test");
      },
      decrement: async () => {},
      resetKey: async () => {},
    }) as Store;
  const { server, runtime, url } = await startRateLimitedApp(failingStoreFactory);

  try {
    const response = await fetch(
      `${url}/api/submissions/${crypto.randomUUID()}/complete`,
      {
        method: "POST",
        headers: { Cookie: cookie(student.id) },
      },
    );
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Service temporarily unavailable",
    });
  } finally {
    await stopRateLimitedApp(server, runtime);
  }
});
