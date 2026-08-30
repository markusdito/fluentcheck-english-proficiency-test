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
import { MemoryStore } from "express-rate-limit";
import type { PrismaClient } from "../../src/generated/client.js";
import type { RateLimitRuntime } from "../../src/middleware/rate-limit.middleware.js";

const execFileAsync = promisify(execFile);
const HMAC_SECRET = "auth-rate-limit-test-secret-0123456789";
const JWT_SECRET = "auth-rate-limit-jwt-secret-0123456789";

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
  process.env.R2_ACCOUNT_ID = "auth-rate-limit-test-account";
  process.env.R2_ACCESS_KEY_ID = "auth-rate-limit-test-access-key";
  process.env.R2_SECRET_ACCESS_KEY = "auth-rate-limit-test-secret-key";
  process.env.R2_BUCKET_NAME = "auth-rate-limit-test-bucket";
  process.env.FRONTEND_URL = "https://fluentcheck.example.test";

  await migrateDatabase(process.env.DATABASE_URL);

  ({ prisma, disconnectDB } = await import("../../src/config/db.js"));
  ({ createRateLimitConfig } = await import("../../src/config/rate-limit.js"));
  ({ createApp: createApplication } = await import("../../src/server.js"));
}, { timeout: 120_000 });

beforeEach(async () => {
  await prisma.user.deleteMany();
});

after(async () => {
  await disconnectDB();
  await container.stop();
}, { timeout: 120_000 });

async function startRateLimitedApp(trustProxy = "none") {
  const app: Express = createApplication({
    rateLimit: {
      config: createRateLimitConfig({
        hmacSecret: HMAC_SECRET,
        jwtSecret: JWT_SECRET,
        trustProxy,
      }),
      storeFactory: () => new MemoryStore(),
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

async function postJson(
  baseUrl: string,
  path: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
) {
  return fetch(`${baseUrl}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

async function postMalformedJson(baseUrl: string, path: string, headers = {}) {
  return fetch(`${baseUrl}/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: "{",
  });
}

async function createUser(
  email: string,
  password = "correct-password",
  rounds = 4,
) {
  return prisma.user.create({
    data: {
      username: email
        .split("@")[0]
        .replace(/[^a-z0-9_]/giu, "_")
        .toLowerCase(),
      email,
      normalizedEmail: email.trim().toLowerCase(),
      password: await bcrypt.hash(password, rounds),
    },
  });
}

test("login and registration bursts run before body parsing and remain independent", async () => {
  const { server, runtime, url } = await startRateLimitedApp();
  try {
    const loginStatuses: number[] = [];
    for (let attempt = 0; attempt < 121; attempt += 1) {
      loginStatuses.push((await postMalformedJson(url, "/auth/login")).status);
    }
    assert.equal(loginStatuses.slice(0, 120).every((status) => status === 400), true);
    assert.equal(loginStatuses[120], 429);

    const registrationStatuses: number[] = [];
    for (let attempt = 0; attempt < 31; attempt += 1) {
      registrationStatuses.push((await postMalformedJson(url, "/auth/register")).status);
    }
    assert.equal(
      registrationStatuses.slice(0, 30).every((status) => status === 400),
      true,
    );
    assert.equal(registrationStatuses[30], 429);
  } finally {
    await stopRateLimitedApp(server, runtime);
  }
});

test("validated registration attempts share an independent normalized-email budget", async () => {
  const { server, runtime, url } = await startRateLimitedApp();
  try {
    const responses: Response[] = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      responses.push(
        await postJson(url, "/auth/register", {
          username: `email_limit_${attempt}`,
          email: attempt === 0 ? "Target@Example.COM" : " target@example.com ",
          password: "password-123",
        }),
      );
    }

    assert.deepEqual(
      responses.map((response) => response.status),
      [201, 409, 409, 409, 409],
    );
    const blocked = await postJson(url, "/auth/register", {
      username: "email_limit_blocked",
      email: "TARGET@example.com",
      password: "password-123",
    });
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: "Too many requests" });
    assert.match(blocked.headers.get("retry-after") ?? "", /^\d+$/);
    assert.match(blocked.headers.get("ratelimit") ?? "", /quota/);
    assert.equal(blocked.headers.has("x-ratelimit-limit"), false);
  } finally {
    await stopRateLimitedApp(server, runtime);
  }
});

test("schema-invalid login requests consume only the IP burst budget", async () => {
  const { server, runtime, url } = await startRateLimitedApp();
  try {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt += 1) {
      statuses.push(
        (
          await postJson(url, "/auth/login", {
            email: "not-an-email",
          })
        ).status,
      );
    }

    assert.equal(statuses.every((status) => status === 400), true);
  } finally {
    await stopRateLimitedApp(server, runtime);
  }
});

test("wrong-password failures use normalized account keys and successful login resets only that account", async () => {
  const user = await createUser("Reset.Target@Example.COM");
  const otherUser = await createUser("other-target@example.com");
  const { server, runtime, url } = await startRateLimitedApp();
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const failed = await postJson(url, "/auth/login", {
        email: attempt % 2 === 0 ? "reset.target@example.com" : "RESET.TARGET@EXAMPLE.COM",
        password: "wrong-password",
      });
      assert.equal(failed.status, 401);
      assert.deepEqual(await failed.json(), { error: "Invalid email or password" });
    }

    const successful = await postJson(url, "/auth/login", {
      email: " reset.target@example.com ",
      password: "correct-password",
    });
    assert.equal(successful.status, 200);
    assert.equal((await successful.json()).data.user.id, user.id);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const failed = await postJson(url, "/auth/login", {
        email: "reset.target@example.com",
        password: "wrong-password",
      });
      assert.equal(failed.status, 401);
    }
    const blocked = await postJson(url, "/auth/login", {
      email: "RESET.TARGET@EXAMPLE.COM",
      password: "wrong-password",
    });
    assert.equal(blocked.status, 429);

    const independentAccount = await postJson(url, "/auth/login", {
      email: otherUser.email,
      password: "wrong-password",
    });
    assert.equal(independentAccount.status, 401);
  } finally {
    await stopRateLimitedApp(server, runtime);
  }
});

test("nonexistent, deactivated, provider-only, and wrong-password outcomes stay generic", async () => {
  const storedPasswordHash = await bcrypt.hash("stored-password", 4);
  await prisma.user.create({
    data: {
      username: "deactivated_rate_limit_user",
      email: "deactivated-rate-limit@example.com",
      normalizedEmail: "deactivated-rate-limit@example.com",
      password: storedPasswordHash,
      deletedAt: new Date(),
    },
  });
  await prisma.user.create({
    data: {
      username: "provider_rate_limit_user",
      email: "provider-rate-limit@example.com",
      normalizedEmail: "provider-rate-limit@example.com",
      password: null,
    },
  });
  await createUser("wrong-password-rate-limit@example.com", "stored-password");
  const { server, runtime, url } = await startRateLimitedApp();
  try {
    for (const email of [
      "missing-rate-limit@example.com",
      "deactivated-rate-limit@example.com",
      "provider-rate-limit@example.com",
      "wrong-password-rate-limit@example.com",
    ]) {
      const response = await postJson(url, "/auth/login", {
        email,
        password: "wrong-password",
      });
      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), { error: "Invalid email or password" });
    }
  } finally {
    await stopRateLimitedApp(server, runtime);
  }
});

test("successful login does not reset the exact 100-failure IP boundary", async () => {
  const successfulLoginPasswordHash = await bcrypt.hash("correct-password", 4);
  const failedLoginPasswordHash = await bcrypt.hash("stored-password", 4);
  await prisma.user.createMany({
    data: Array.from({ length: 101 }, (_, index) => ({
      username: `ip_limit_user_${index}`,
      email: `ip-limit-${index}@example.com`,
      normalizedEmail: `ip-limit-${index}@example.com`,
      password: index === 99 ? successfulLoginPasswordHash : failedLoginPasswordHash,
    })),
  });
  const { server, runtime, url } = await startRateLimitedApp();
  try {
    for (let attempt = 0; attempt < 99; attempt += 1) {
      const failed = await postJson(url, "/auth/login", {
        email: `ip-limit-${attempt}@example.com`,
        password: "wrong-password",
      });
      assert.equal(failed.status, 401);
    }

    const successful = await postJson(url, "/auth/login", {
      email: "ip-limit-99@example.com",
      password: "correct-password",
    });
    assert.equal(successful.status, 200);
    await successful.json();

    const hundredthFailure = await postJson(url, "/auth/login", {
      email: "ip-limit-100@example.com",
      password: "wrong-password",
    });
    assert.equal(hundredthFailure.status, 401);
    await hundredthFailure.json();

    const blocked = await postJson(url, "/auth/login", {
      email: "ip-limit-99@example.com",
      password: "wrong-password",
    });
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: "Too many requests" });
  } finally {
    await stopRateLimitedApp(server, runtime);
  }
});

test("trusted proxy IPs participate in authentication keys with IPv6 subnet grouping", async () => {
  const { server, runtime, url } = await startRateLimitedApp(
    "127.0.0.1/32,::ffff:127.0.0.1/128",
  );
  try {
    const firstStatuses: number[] = [];
    for (let attempt = 0; attempt < 120; attempt += 1) {
      firstStatuses.push(
        (
          await postMalformedJson(url, "/auth/login", {
            "X-Forwarded-For": "2001:db8:abcd:12::1",
          })
        ).status,
      );
    }
    const sameSubnet = await postMalformedJson(url, "/auth/login", {
      "X-Forwarded-For": "2001:db8:abcd:34::2",
    });
    const differentSubnet = await postMalformedJson(url, "/auth/login", {
      "X-Forwarded-For": "2001:db8:abce:12::1",
    });

    assert.equal(firstStatuses.every((status) => status === 400), true);
    assert.equal(sameSubnet.status, 429);
    assert.equal(differentSubnet.status, 400);
  } finally {
    await stopRateLimitedApp(server, runtime);
  }
});
