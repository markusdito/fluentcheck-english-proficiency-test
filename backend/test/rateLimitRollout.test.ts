import assert from "node:assert/strict";
import type { Server } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { MemoryStore, type Store } from "express-rate-limit";
import express, { type Express } from "express";
import { unhandledRequestError } from "../src/server.js";
import {
  createRateLimitConfig,
  RATE_LIMIT_POLICIES,
  type RateLimitPolicy,
} from "../src/config/rate-limit.js";
import {
  createRateLimitRuntime,
  type RateLimitRuntime,
} from "../src/middleware/rate-limit.middleware.js";

const HMAC_SECRET = "rate-limit-rollout-test-hmac-secret-0123456789";
const JWT_SECRET = "rate-limit-rollout-test-jwt-secret-0123456789";

type PolicyContract = Pick<
  RateLimitPolicy,
  "name" | "prefix" | "scope" | "limit" | "windowMs" | "failureMode"
>;

const ACCEPTED_POLICY_MATRIX = {
  generalApi: {
    name: "general-api",
    prefix: "fc:rate-limit:general-api",
    scope: "ip",
    limit: 300,
    windowMs: 60_000,
    failureMode: "fail-open",
  },
  loginBurst: {
    name: "auth-login-burst",
    prefix: "fc:rate-limit:auth-login-burst",
    scope: "ip",
    limit: 120,
    windowMs: 60_000,
    failureMode: "fail-closed",
  },
  loginFailureAccount: {
    name: "auth-login-failure-account",
    prefix: "fc:rate-limit:auth-login-failure-account",
    scope: "account",
    limit: 10,
    windowMs: 15 * 60_000,
    failureMode: "fail-closed",
  },
  loginFailureIp: {
    name: "auth-login-failure-ip",
    prefix: "fc:rate-limit:auth-login-failure-ip",
    scope: "ip",
    limit: 100,
    windowMs: 15 * 60_000,
    failureMode: "fail-closed",
  },
  registrationBurst: {
    name: "auth-registration-burst",
    prefix: "fc:rate-limit:auth-registration-burst",
    scope: "ip",
    limit: 30,
    windowMs: 60_000,
    failureMode: "fail-closed",
  },
  registrationIp: {
    name: "auth-registration-ip",
    prefix: "fc:rate-limit:auth-registration-ip",
    scope: "ip",
    limit: 120,
    windowMs: 60 * 60_000,
    failureMode: "fail-closed",
  },
  registrationEmail: {
    name: "auth-registration-email",
    prefix: "fc:rate-limit:auth-registration-email",
    scope: "email",
    limit: 5,
    windowMs: 60 * 60_000,
    failureMode: "fail-closed",
  },
  googleStart: {
    name: "oauth-google-start",
    prefix: "fc:rate-limit:oauth-google-start",
    scope: "ip",
    limit: 20,
    windowMs: 10 * 60_000,
    failureMode: "fail-closed",
  },
  googleCallback: {
    name: "oauth-google-callback",
    prefix: "fc:rate-limit:oauth-google-callback",
    scope: "ip",
    limit: 40,
    windowMs: 10 * 60_000,
    failureMode: "fail-closed",
  },
  ipaymuCallback: {
    name: "payment-ipaymu-callback",
    prefix: "fc:rate-limit:payment-ipaymu-callback",
    scope: "ip",
    limit: 300,
    windowMs: 5 * 60_000,
    failureMode: "fail-closed",
  },
  submissionPaymentAccount: {
    name: "submission-payment-account",
    prefix: "fc:rate-limit:submission-payment-account",
    scope: "account",
    limit: 10,
    windowMs: 60 * 60_000,
    failureMode: "fail-closed",
  },
  submissionPaymentIp: {
    name: "submission-payment-ip",
    prefix: "fc:rate-limit:submission-payment-ip",
    scope: "ip",
    limit: 30,
    windowMs: 60 * 60_000,
    failureMode: "fail-closed",
  },
  answerStorageAccount: {
    name: "answer-storage-account",
    prefix: "fc:rate-limit:answer-storage-account",
    scope: "account",
    limit: 30,
    windowMs: 10 * 60_000,
    failureMode: "fail-closed",
  },
  answerStorageIp: {
    name: "answer-storage-ip",
    prefix: "fc:rate-limit:answer-storage-ip",
    scope: "ip",
    limit: 60,
    windowMs: 10 * 60_000,
    failureMode: "fail-closed",
  },
  questionAudioStorageAccount: {
    name: "question-audio-storage-account",
    prefix: "fc:rate-limit:question-audio-storage-account",
    scope: "account",
    limit: 60,
    windowMs: 60 * 60_000,
    failureMode: "fail-closed",
  },
  questionAudioStorageIp: {
    name: "question-audio-storage-ip",
    prefix: "fc:rate-limit:question-audio-storage-ip",
    scope: "ip",
    limit: 120,
    windowMs: 60 * 60_000,
    failureMode: "fail-closed",
  },
  submissionCreationAccount: {
    name: "submission-creation-account",
    prefix: "fc:rate-limit:submission-creation-account",
    scope: "account",
    limit: 5,
    windowMs: 60 * 60_000,
    failureMode: "fail-closed",
  },
  submissionCreationIp: {
    name: "submission-creation-ip",
    prefix: "fc:rate-limit:submission-creation-ip",
    scope: "ip",
    limit: 20,
    windowMs: 60 * 60_000,
    failureMode: "fail-closed",
  },
  submissionCompletionAccount: {
    name: "submission-completion-account",
    prefix: "fc:rate-limit:submission-completion-account",
    scope: "account",
    limit: 10,
    windowMs: 15 * 60_000,
    failureMode: "fail-closed",
  },
  submissionCompletionIp: {
    name: "submission-completion-ip",
    prefix: "fc:rate-limit:submission-completion-ip",
    scope: "ip",
    limit: 30,
    windowMs: 15 * 60_000,
    failureMode: "fail-closed",
  },
} satisfies Record<keyof typeof RATE_LIMIT_POLICIES, PolicyContract>;

type PolicyKey = keyof typeof RATE_LIMIT_POLICIES;
const POLICY_KEYS = Object.keys(ACCEPTED_POLICY_MATRIX) as PolicyKey[];

function contract(policy: RateLimitPolicy): PolicyContract {
  return {
    name: policy.name,
    prefix: policy.prefix,
    scope: policy.scope,
    limit: policy.limit,
    windowMs: policy.windowMs,
    failureMode: policy.failureMode,
  };
}

function createRolloutApp() {
  const stores = new Map<string, Store>();
  const config = createRateLimitConfig({
    hmacSecret: HMAC_SECRET,
    jwtSecret: JWT_SECRET,
    trustProxy: "127.0.0.1/32",
  });
  const runtime = createRateLimitRuntime({
    config,
    storeFactory: (policy) => {
      const store = new MemoryStore();
      stores.set(policy.name, store);
      return store;
    },
  });
  const app = express();
  app.set("trust proxy", config.trustProxy);

  for (const key of POLICY_KEYS) {
    const policy = RATE_LIMIT_POLICIES[key];
    const path = `/rollout/${policy.name}`;
    const route = key === "generalApi" ? `/api${path}` : path;
    const identityResolver =
      policy.scope === "ip"
        ? undefined
        : (request: import("express").Request) =>
            request.get("X-Rate-Limit-Identity");

    app.get(
      route,
      runtime.createLimiter(policy, identityResolver),
      (_request, response) => response.status(204).end(),
    );
  }

  app.use(unhandledRequestError);

  return { app, runtime, stores };
}

async function start(app: Express) {
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function stop(server: Server, runtime: RateLimitRuntime) {
  server.close();
  await once(server, "close");
  await runtime.shutdown();
}

function routeFor(key: PolicyKey): string {
  const suffix = `/rollout/${RATE_LIMIT_POLICIES[key].name}`;
  return key === "generalApi" ? `/api${suffix}` : suffix;
}

function requestHeaders(policy: RateLimitPolicy, independent: boolean) {
  if (policy.scope === "ip") {
    return {
      "X-Forwarded-For": independent ? "198.51.100.11" : "198.51.100.10",
    };
  }

  const identity = independent ? "rollout-b" : "rollout-a";
  return {
    "X-Rate-Limit-Identity":
      policy.scope === "email" ? `${identity}@example.test` : identity,
  };
}

test("the accepted policy matrix has exact native HTTP threshold, reset, and identity boundaries", async () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(RATE_LIMIT_POLICIES).map(([key, policy]) => [key, contract(policy)]),
    ),
    ACCEPTED_POLICY_MATRIX,
  );
  assert.equal(
    new Set(Object.values(RATE_LIMIT_POLICIES).map(({ prefix }) => prefix)).size,
    POLICY_KEYS.length,
  );

  const { app, runtime, stores } = createRolloutApp();
  const { server, url } = await start(app);

  try {
    for (const key of POLICY_KEYS) {
      const policy = RATE_LIMIT_POLICIES[key];
      const request = (independent: boolean) =>
        fetch(`${url}${routeFor(key)}`, {
          headers: requestHeaders(policy, independent),
        });

      for (let attempt = 0; attempt < policy.limit; attempt += 1) {
        assert.equal((await request(false)).status, 204, `${key} attempt ${attempt + 1}`);
      }

      assert.equal((await request(true)).status, 204, `${key} independent identity`);
      const blocked = await request(false);
      assert.equal(blocked.status, 429, `${key} over limit`);
      assert.deepEqual(await blocked.json(), { error: "Too many requests" });
      assert.match(blocked.headers.get("retry-after") ?? "", /^\d+$/u);
      assert.match(blocked.headers.get("ratelimit") ?? "", /quota/u);
      for (const header of [
        "x-ratelimit-limit",
        "x-ratelimit-remaining",
        "x-ratelimit-reset",
      ]) {
        assert.equal(blocked.headers.has(header), false, `${key} legacy ${header}`);
      }

      const store = stores.get(policy.name);
      if (!store?.resetAll) throw new Error(`Missing resetAll for ${key}`);
      await store.resetAll();
      assert.equal((await request(false)).status, 204, `${key} after reset`);
    }
  } finally {
    await stop(server, runtime);
  }
});
