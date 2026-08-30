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
let rateLimitPolicies: typeof import("../../src/config/rate-limit.js").RATE_LIMIT_POLICIES;

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
  ({ createRateLimitConfig, RATE_LIMIT_POLICIES: rateLimitPolicies } =
    await import("../../src/config/rate-limit.js"));
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

function exactStoreFactory(
  policyHits: Map<string, number>,
  stores: Map<string, Store>,
) {
  return (configuredPolicy: RateLimitPolicy): Store => {
    const keyHits = new Map<string, number>();
    const store: Store = {
      localKeys: false,
      increment: async (key) => {
        const totalHits = (keyHits.get(key) ?? 0) + 1;
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
}

async function resetRateLimitStores(stores: Map<string, Store>) {
  await Promise.all(
    [...stores.values()].map((store) => store.resetAll?.()),
  );
}

function assertPolicyOwnership(
  label: string,
  beforePolicyHits: Map<string, number>,
  policyHits: Map<string, number>,
  expectedPolicyNames: readonly string[],
) {
  const observedPolicyNames = [...policyHits.keys()].filter(
    (policyName) =>
      (policyHits.get(policyName) ?? 0) -
        (beforePolicyHits.get(policyName) ?? 0) >
      0,
  );
  assert.deepEqual(
    observedPolicyNames.sort(),
    [...expectedPolicyNames].sort(),
    `${label} policy ownership`,
  );
}

async function assertActualThreshold(
  label: string,
  request: (attempt: number) => Promise<Response>,
  limit: number,
  stores: Map<string, Store>,
  independentRequest?: () => Promise<Response>,
  policyHits?: Map<string, number>,
  expectedPolicyNames: readonly string[] = [],
) {
  const beforePolicyHits = policyHits ? new Map(policyHits) : undefined;
  for (let attempt = 0; attempt < limit; attempt += 1) {
    const accepted = await request(attempt);
    assert.notEqual(
      accepted.status,
      429,
      `${label} request ${attempt + 1}/${limit}`,
    );
  }
  const blocked = await request(limit);
  assert.equal(blocked.status, 429, `${label} over-limit request`);
  if (independentRequest) {
    const independent = await independentRequest();
    assert.notEqual(independent.status, 429, `${label} independent identity`);
  }
  await resetRateLimitStores(stores);
  const reset = await request(0);
  assert.notEqual(reset.status, 429, `${label} reset request`);
  await resetRateLimitStores(stores);
  if (policyHits && beforePolicyHits) {
    assertPolicyOwnership(
      label,
      beforePolicyHits,
      policyHits,
      expectedPolicyNames,
    );
  }
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
  const otherAdmin = await createUser("ADMIN");
  const ipStudents = await Promise.all(
    Array.from({ length: 120 }, () => createUser()),
  );
  const ipAdmins = await Promise.all(
    Array.from({ length: 120 }, () => createUser("ADMIN")),
  );
  const googleAuth: GoogleAuthRouteHandlers = {
    start: (_req, res) => res.status(204).end(),
    callback: (_req, res) => res.status(204).end(),
  };
  const primaryIp = "198.51.100.10";
  const alternateIp = "198.51.100.11";

  for (const targetScope of ["account", "ip"] as const) {
    const policyHits = new Map<string, number>();
    const stores = new Map<string, Store>();
    const { server, runtime, url } = await startRateLimitedApp(
      exactStoreFactory(policyHits, stores),
      "127.0.0.1/32",
      googleAuth,
    );

    const studentForAttempt = (attempt: number) =>
      targetScope === "account"
        ? student.id
        : ipStudents[attempt % ipStudents.length]!.id;
    const adminForAttempt = (attempt: number) =>
      targetScope === "account"
        ? admin.id
        : ipAdmins[attempt % ipAdmins.length]!.id;

    const payment = (userId: string, ip = primaryIp) =>
      fetch(`${url}/api/payments/submissions/${crypto.randomUUID()}/pay`, {
        method: "POST",
        headers: { Cookie: cookie(userId), "X-Forwarded-For": ip },
      });
    const answerUpload = (userId: string, ip = primaryIp) =>
      fetch(`${url}/api/uploads/presigned-url`, {
        method: "POST",
        headers: {
          Cookie: cookie(userId),
          "X-Forwarded-For": ip,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
    const answerConfirmation = (userId: string, ip = primaryIp) =>
      fetch(`${url}/api/uploads/confirm`, {
        method: "POST",
        headers: {
          Cookie: cookie(userId),
          "X-Forwarded-For": ip,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
    const questionAudio = (userId: string, ip = primaryIp) =>
      fetch(`${url}/api/questions/audio/presigned-url`, {
        method: "POST",
        headers: {
          Cookie: cookie(userId),
          "X-Forwarded-For": ip,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
    const questionAudioConfirmation = (userId: string, ip = primaryIp) =>
      fetch(`${url}/api/questions/audio/confirm`, {
        method: "POST",
        headers: {
          Cookie: cookie(userId),
          "X-Forwarded-For": ip,
          "Content-Type": "application/json",
        },
        body: "{}",
      });
    const createSubmission = (userId: string, ip = primaryIp) =>
      fetch(`${url}/api/submissions`, {
        method: "POST",
        headers: { Cookie: cookie(userId), "X-Forwarded-For": ip },
      });
    const completeSubmission = (userId: string, ip = primaryIp) =>
      fetch(`${url}/api/submissions/${crypto.randomUUID()}/complete`, {
        method: "POST",
        headers: { Cookie: cookie(userId), "X-Forwarded-For": ip },
      });

    try {
      const beforeBaselinePolicyHits = new Map(policyHits);
      const baseline = await fetch(`${url}/api/not-found`, {
        headers: { "X-Forwarded-For": primaryIp },
      });
      const baselineRepeat = await fetch(`${url}/api/not-found`, {
        headers: { "X-Forwarded-For": primaryIp },
      });
      assert.notEqual(baseline.status, 429);
      assert.notEqual(baselineRepeat.status, 429);
      assertPolicyOwnership(
        `${targetScope} baseline`,
        beforeBaselinePolicyHits,
        policyHits,
        ["general-api"],
      );

      await resetRateLimitStores(stores);
      await assertActualThreshold(
        `${targetScope} payment`,
        (attempt) => payment(studentForAttempt(attempt)),
        targetScope === "account"
          ? rateLimitPolicies.submissionPaymentAccount.limit
          : rateLimitPolicies.submissionPaymentIp.limit,
        stores,
        targetScope === "account"
          ? () => payment(otherStudent.id)
          : () => payment(student.id, alternateIp),
        policyHits,
        ["submission-payment-account", "submission-payment-ip"],
      );
      await assertActualThreshold(
        `${targetScope} Answer upload`,
        (attempt) => answerUpload(studentForAttempt(attempt)),
        targetScope === "account"
          ? rateLimitPolicies.answerStorageAccount.limit
          : rateLimitPolicies.answerStorageIp.limit,
        stores,
        targetScope === "account"
          ? () => answerUpload(otherStudent.id)
          : () => answerUpload(student.id, alternateIp),
        policyHits,
        ["answer-storage-account", "answer-storage-ip"],
      );
      await assertActualThreshold(
        `${targetScope} Answer confirmation`,
        (attempt) => answerConfirmation(studentForAttempt(attempt)),
        targetScope === "account"
          ? rateLimitPolicies.answerStorageAccount.limit
          : rateLimitPolicies.answerStorageIp.limit,
        stores,
        targetScope === "account"
          ? () => answerConfirmation(otherStudent.id)
          : () => answerConfirmation(student.id, alternateIp),
        policyHits,
        ["answer-storage-account", "answer-storage-ip"],
      );
      await assertActualThreshold(
        `${targetScope} question audio`,
        (attempt) => questionAudio(adminForAttempt(attempt)),
        targetScope === "account"
          ? rateLimitPolicies.questionAudioStorageAccount.limit
          : rateLimitPolicies.questionAudioStorageIp.limit,
        stores,
        targetScope === "account"
          ? () => questionAudio(otherAdmin.id)
          : () => questionAudio(admin.id, alternateIp),
        policyHits,
        [
          "question-audio-storage-account",
          "question-audio-storage-ip",
        ],
      );
      await assertActualThreshold(
        `${targetScope} question audio confirmation`,
        (attempt) => questionAudioConfirmation(adminForAttempt(attempt)),
        targetScope === "account"
          ? rateLimitPolicies.questionAudioStorageAccount.limit
          : rateLimitPolicies.questionAudioStorageIp.limit,
        stores,
        targetScope === "account"
          ? () => questionAudioConfirmation(otherAdmin.id)
          : () => questionAudioConfirmation(admin.id, alternateIp),
        policyHits,
        [
          "question-audio-storage-account",
          "question-audio-storage-ip",
        ],
      );
      await assertActualThreshold(
        `${targetScope} Submission creation`,
        (attempt) => createSubmission(studentForAttempt(attempt)),
        targetScope === "account"
          ? rateLimitPolicies.submissionCreationAccount.limit
          : rateLimitPolicies.submissionCreationIp.limit,
        stores,
        targetScope === "account"
          ? () => createSubmission(otherStudent.id)
          : () => createSubmission(student.id, alternateIp),
        policyHits,
        ["submission-creation-account", "submission-creation-ip"],
      );
      await assertActualThreshold(
        `${targetScope} Submission completion`,
        (attempt) => completeSubmission(studentForAttempt(attempt)),
        targetScope === "account"
          ? rateLimitPolicies.submissionCompletionAccount.limit
          : rateLimitPolicies.submissionCompletionIp.limit,
        stores,
        targetScope === "account"
          ? () => completeSubmission(otherStudent.id)
          : () => completeSubmission(student.id, alternateIp),
        policyHits,
        ["submission-completion-account", "submission-completion-ip"],
      );

      if (targetScope === "ip") {
        await assertActualThreshold(
          "IP authentication burst",
          (_attempt) =>
            fetch(`${url}/api/auth/login`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Forwarded-For": primaryIp,
              },
              body: "{",
            }),
          rateLimitPolicies.loginBurst.limit,
          stores,
          () =>
            fetch(`${url}/api/auth/login`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Forwarded-For": alternateIp,
              },
              body: "{",
            }),
        );
        await assertActualThreshold(
          "IP registration burst",
          (_attempt) =>
            fetch(`${url}/api/auth/register`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Forwarded-For": primaryIp,
              },
              body: "{",
            }),
          rateLimitPolicies.registrationBurst.limit,
          stores,
          () =>
            fetch(`${url}/api/auth/register`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Forwarded-For": alternateIp,
              },
              body: "{",
            }),
        );
        await assertActualThreshold(
          "IP Google start",
          (_attempt) =>
            fetch(`${url}/api/auth/google/start`, {
              headers: { "X-Forwarded-For": primaryIp },
            }),
          rateLimitPolicies.googleStart.limit,
          stores,
          () =>
            fetch(`${url}/api/auth/google/start`, {
              headers: { "X-Forwarded-For": alternateIp },
            }),
          policyHits,
          ["oauth-google-start"],
        );
        await assertActualThreshold(
          "IP Google callback",
          (_attempt) =>
            fetch(`${url}/api/auth/google/callback`, {
              headers: { "X-Forwarded-For": primaryIp },
            }),
          rateLimitPolicies.googleCallback.limit,
          stores,
          () =>
            fetch(`${url}/api/auth/google/callback`, {
              headers: { "X-Forwarded-For": alternateIp },
            }),
          policyHits,
          ["oauth-google-callback"],
        );
        await assertActualThreshold(
          "IP iPaymu callback",
          (_attempt) =>
            fetch(`${url}/api/payments/ipaymu/notify`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Forwarded-For": primaryIp,
              },
              body: "{}",
            }),
          rateLimitPolicies.ipaymuCallback.limit,
          stores,
          () =>
            fetch(`${url}/api/payments/ipaymu/notify`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "X-Forwarded-For": alternateIp,
              },
              body: "{}",
            }),
          policyHits,
          ["payment-ipaymu-callback"],
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
