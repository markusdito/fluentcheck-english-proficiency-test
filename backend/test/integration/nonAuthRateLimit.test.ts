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
import type { RateLimitPolicy } from "../../src/config/rate-limit.js";
import type { RateLimitRuntime } from "../../src/middleware/rate-limit.middleware.js";
import type { GoogleAuthRouteHandlers } from "../../src/routes/google-auth.routes.js";

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
  storeFactory: (policy: RateLimitPolicy) => Store = () => new MemoryStore(),
  trustProxy = "none",
  googleAuth?: GoogleAuthRouteHandlers,
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
    googleAuth,
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

function trackingStoreFactory(
  policyHits: Map<string, number>,
  keysByPolicy: Map<string, Set<string>>,
) {
  return (configuredPolicy: RateLimitPolicy): Store => {
    const keyHits = new Map<string, number>();
    return {
      localKeys: false,
      increment: async (key) => {
        const totalHits = (keyHits.get(key) ?? 0) + 1;
        keyHits.set(key, totalHits);
        policyHits.set(
          configuredPolicy.name,
          (policyHits.get(configuredPolicy.name) ?? 0) + 1,
        );
        const keys = keysByPolicy.get(configuredPolicy.name) ?? new Set<string>();
        keys.add(key);
        keysByPolicy.set(configuredPolicy.name, keys);
        return {
          totalHits,
          resetTime: new Date(Date.now() + configuredPolicy.windowMs),
        };
      },
      decrement: async () => {},
      resetKey: async () => {},
    };
  };
}

function nearLimitStoreFactory(targetScope: "account" | "ip") {
  const stores = new Map<string, Store>();
  const policyHits = new Map<string, number>();

  const factory = (configuredPolicy: RateLimitPolicy): Store => {
    const keyHits = new Map<string, number>();
    const startsNearLimit = configuredPolicy.scope === targetScope;
    const store: Store = {
      localKeys: false,
      increment: async (key) => {
        const initialHits = startsNearLimit ? configuredPolicy.limit - 1 : 0;
        const totalHits = (keyHits.get(key) ?? initialHits) + 1;
        keyHits.set(key, totalHits);
        policyHits.set(
          configuredPolicy.name,
          (policyHits.get(configuredPolicy.name) ?? 0) + 1,
        );
        return {
          totalHits,
          resetTime: new Date(Date.now() + configuredPolicy.windowMs),
        };
      },
      decrement: async () => {},
      resetKey: async () => {},
      resetAll: async () => {
        keyHits.clear();
      },
    };
    stores.set(configuredPolicy.name, store);
    return store;
  };

  return { factory, stores, policyHits };
}

async function resetRateLimitStores(stores: Map<string, Store>) {
  await Promise.all(
    [...stores.values()].map((store) => store.resetAll?.()),
  );
}

async function assertActualThreshold(
  label: string,
  request: () => Promise<Response>,
  stores: Map<string, Store>,
  independentRequest?: () => Promise<Response>,
) {
  const accepted = await request();
  assert.notEqual(accepted.status, 429, `${label} threshold request`);
  const blocked = await request();
  assert.equal(blocked.status, 429, `${label} over-limit request`);
  if (independentRequest) {
    const independent = await independentRequest();
    assert.notEqual(independent.status, 429, `${label} independent identity`);
  }
  await resetRateLimitStores(stores);
  const reset = await request();
  assert.notEqual(reset.status, 429, `${label} reset request`);
  await resetRateLimitStores(stores);
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

test("mounted route boundaries use dedicated policies without charging the baseline", async () => {
  const student = await createUser();
  const otherStudent = await createUser();
  const admin = await createUser("ADMIN");
  const policyHits = new Map<string, number>();
  const keysByPolicy = new Map<string, Set<string>>();
  const googleAuth: GoogleAuthRouteHandlers = {
    start: (_req, res) => res.status(204).end(),
    callback: (_req, res) => res.status(204).end(),
  };
  const { server, runtime, url } = await startRateLimitedApp(
    trackingStoreFactory(policyHits, keysByPolicy),
    "none",
    googleAuth,
  );

  try {
    await fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    await fetch(`${url}/api/auth/google/start`);
    await fetch(`${url}/api/auth/google/callback`);
    await fetch(`${url}/api/payments/ipaymu/notify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    await fetch(`${url}/api/payments/submissions/${crypto.randomUUID()}/pay`, {
      method: "POST",
      headers: { Cookie: cookie(student.id) },
    });
    await fetch(`${url}/api/payments/submissions/${crypto.randomUUID()}/pay`, {
      method: "POST",
      headers: { Cookie: cookie(otherStudent.id) },
    });
    await fetch(`${url}/api/uploads/presigned-url`, {
      method: "POST",
      headers: {
        Cookie: cookie(student.id),
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    await fetch(`${url}/api/questions/audio/presigned-url`, {
      method: "POST",
      headers: {
        Cookie: cookie(admin.id),
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    await fetch(`${url}/api/submissions`, {
      method: "POST",
      headers: { Cookie: cookie(student.id) },
    });
    await fetch(`${url}/api/submissions/${crypto.randomUUID()}/complete`, {
      method: "POST",
      headers: { Cookie: cookie(student.id) },
    });

    assert.equal(policyHits.get("general-api") ?? 0, 0);
    assert.equal(policyHits.get("auth-login-burst"), 1);
    assert.equal(policyHits.get("oauth-google-start"), 1);
    assert.equal(policyHits.get("oauth-google-callback"), 1);
    assert.equal(policyHits.get("payment-ipaymu-callback"), 1);
    assert.equal(policyHits.get("submission-payment-account"), 2);
    assert.equal(policyHits.get("submission-payment-ip"), 2);
    assert.equal(policyHits.get("answer-storage-account"), 1);
    assert.equal(policyHits.get("answer-storage-ip"), 1);
    assert.equal(policyHits.get("question-audio-storage-account"), 1);
    assert.equal(policyHits.get("question-audio-storage-ip"), 1);
    assert.equal(policyHits.get("submission-creation-account"), 1);
    assert.equal(policyHits.get("submission-creation-ip"), 1);
    assert.equal(policyHits.get("submission-completion-account"), 1);
    assert.equal(policyHits.get("submission-completion-ip"), 1);
    assert.equal(keysByPolicy.get("submission-payment-account")?.size, 2);
    assert.equal(keysByPolicy.get("submission-payment-ip")?.size, 1);
  } finally {
    await stopRateLimitedApp(server, runtime);
  }
});

test("real mounted routes enforce paired thresholds, identity boundaries, and reset", async () => {
  const student = await createUser();
  const otherStudent = await createUser();
  const admin = await createUser("ADMIN");
  const googleAuth: GoogleAuthRouteHandlers = {
    start: (_req, res) => res.status(204).end(),
    callback: (_req, res) => res.status(204).end(),
  };

  for (const targetScope of ["account", "ip"] as const) {
    const { factory, stores, policyHits } = nearLimitStoreFactory(targetScope);
    const { server, runtime, url } = await startRateLimitedApp(
      factory,
      "none",
      googleAuth,
    );

    const payment = (userId: string) =>
      fetch(`${url}/api/payments/submissions/${crypto.randomUUID()}/pay`, {
        method: "POST",
        headers: { Cookie: cookie(userId) },
      });
    const answerUpload = () =>
      fetch(`${url}/api/uploads/presigned-url`, {
        method: "POST",
        headers: {
          Cookie: cookie(student.id),
          "Content-Type": "application/json",
        },
        body: "{}",
      });
    const questionAudio = () =>
      fetch(`${url}/api/questions/audio/presigned-url`, {
        method: "POST",
        headers: {
          Cookie: cookie(admin.id),
          "Content-Type": "application/json",
        },
        body: "{}",
      });
    const createSubmission = () =>
      fetch(`${url}/api/submissions`, {
        method: "POST",
        headers: { Cookie: cookie(student.id) },
      });
    const completeSubmission = () =>
      fetch(`${url}/api/submissions/${crypto.randomUUID()}/complete`, {
        method: "POST",
        headers: { Cookie: cookie(student.id) },
      });

    try {
      const baseline = await fetch(`${url}/api/not-found`);
      const baselineRepeat = await fetch(`${url}/api/not-found`);
      assert.notEqual(baseline.status, 429);
      if (targetScope === "ip") {
        assert.equal(baselineRepeat.status, 429);
      } else {
        assert.notEqual(baselineRepeat.status, 429);
      }

      await resetRateLimitStores(stores);
      await assertActualThreshold(
        `${targetScope} payment`,
        () => payment(student.id),
        stores,
        targetScope === "account" ? () => payment(otherStudent.id) : undefined,
      );
      await assertActualThreshold(
        `${targetScope} Answer upload`,
        answerUpload,
        stores,
      );
      await assertActualThreshold(
        `${targetScope} question audio`,
        questionAudio,
        stores,
      );
      await assertActualThreshold(
        `${targetScope} Submission creation`,
        createSubmission,
        stores,
      );
      await assertActualThreshold(
        `${targetScope} Submission completion`,
        completeSubmission,
        stores,
      );

      if (targetScope === "ip") {
        await assertActualThreshold(
          "IP authentication burst",
          () =>
            fetch(`${url}/api/auth/login`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{",
            }),
          stores,
        );
        await assertActualThreshold(
          "IP registration burst",
          () =>
            fetch(`${url}/api/auth/register`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{",
            }),
          stores,
        );
        await assertActualThreshold(
          "IP Google start",
          () => fetch(`${url}/api/auth/google/start`),
          stores,
        );
        await assertActualThreshold(
          "IP Google callback",
          () => fetch(`${url}/api/auth/google/callback`),
          stores,
        );
        await assertActualThreshold(
          "IP iPaymu callback",
          () =>
            fetch(`${url}/api/payments/ipaymu/notify`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: "{}",
            }),
          stores,
        );
      }

      assert.equal(policyHits.get("general-api"), 2);
    } finally {
      await stopRateLimitedApp(server, runtime);
    }
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
