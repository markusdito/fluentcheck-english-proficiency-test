import assert from "node:assert/strict";
import type { Server } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import { MemoryStore, type Store } from "express-rate-limit";
import type { Express } from "express";
import { createApp } from "../src/server.js";
import {
  createGoogleAuthHandlers,
  type GoogleOAuthClient,
} from "../src/controllers/googleAuth.controller.js";
import {
  createRateLimitConfig,
  RATE_LIMIT_POLICIES,
  type RateLimitPolicy,
} from "../src/config/rate-limit.js";
import type { RateLimitRuntime } from "../src/middleware/rate-limit.middleware.js";
import type { GoogleOAuthStateStore } from "../src/service/googleAuth.service.js";

function memoryStateStore(): GoogleOAuthStateStore {
  const states = new Map<string, string>();
  return {
    async create(state, returnTo) {
      states.set(state, returnTo);
    },
    async consume(state, returnTo) {
      if (states.get(state) !== returnTo) return false;
      states.delete(state);
      return true;
    },
  };
}

const client: GoogleOAuthClient = {
  generateAuthUrl: () => "https://accounts.google.test/authorize",
  getToken: async () => ({ tokens: { id_token: "id-token" } }),
  verifyIdToken: async () => ({ getPayload: () => undefined }),
};

const OAUTH_ROUTE_CASES = [
  { path: "start?returnTo=login", limit: 20 },
  { path: "callback", limit: 40 },
] as const;

function createTestGoogleAuthHandlers() {
  return createGoogleAuthHandlers(
    {
      clientId: "123456789.apps.googleusercontent.com",
      clientSecret: "google-client-secret",
      redirectUri: "http://localhost:3000/backend-api/auth/google/callback",
    },
    {
      client,
      frontendUrl: "https://fluentcheck.example.test",
      stateStore: memoryStateStore(),
    },
  );
}

async function startOAuthApp(
  options: {
    trustProxy?: string;
    storeFactory?: (policy: RateLimitPolicy) => Store;
    onStoreFailure?: (event: unknown) => void;
  } = {},
) {
  const config = createRateLimitConfig({
    hmacSecret: "google-oauth-rate-limit-hmac-secret",
    jwtSecret: "google-oauth-rate-limit-jwt-secret",
    trustProxy: options.trustProxy ?? "none",
  });
  const app: Express = createApp({
    googleAuth: createTestGoogleAuthHandlers(),
    rateLimit: {
      config,
      storeFactory: options.storeFactory ?? (() => new MemoryStore()),
      onStoreFailure: options.onStoreFailure,
    },
  });
  const runtime = app.locals.rateLimit as RateLimitRuntime;
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    runtime,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function stopOAuthApp(server: Server, runtime: RateLimitRuntime) {
  server.close();
  await once(server, "close");
  await runtime.shutdown();
}

async function requestStatuses(
  count: number,
  request: () => Promise<Response>,
) {
  const statuses: number[] = [];
  for (let index = 0; index < count; index += 1) {
    statuses.push((await request()).status);
  }
  return statuses;
}

test("Google start and callback use independent central thresholds", async () => {
  const { server, runtime, baseUrl } = await startOAuthApp();

  try {
    const startStatuses = await requestStatuses(21, () =>
      fetch(`${baseUrl}/api/auth/google/start?returnTo=login`, {
        redirect: "manual",
      }),
    );
    assert.equal(
      startStatuses.slice(0, 20).every((status) => status === 302),
      true,
    );
    assert.equal(startStatuses[20], 429);
    const startBlocked = await fetch(
      `${baseUrl}/api/auth/google/start?returnTo=login`,
      { redirect: "manual" },
    );
    assert.equal(startBlocked.status, 429);
    assert.deepEqual(await startBlocked.json(), { error: "Too many requests" });
    assert.match(startBlocked.headers.get("retry-after") ?? "", /^\d+$/u);
    assert.match(
      startBlocked.headers.get("ratelimit") ?? "",
      /^"quota"; r=0; t=\d+$/u,
    );
    for (const header of [
      "x-ratelimit-limit",
      "x-ratelimit-remaining",
      "x-ratelimit-reset",
    ]) {
      assert.equal(startBlocked.headers.has(header), false);
    }

    const callbackStatuses = await requestStatuses(41, () =>
      fetch(`${baseUrl}/api/auth/google/callback`, {
        redirect: "manual",
      }),
    );
    assert.equal(
      callbackStatuses.slice(0, 40).every((status) => status === 302),
      true,
    );
    assert.equal(callbackStatuses[40], 429);
    const blocked = await fetch(`${baseUrl}/api/auth/google/callback`, {
      redirect: "manual",
    });
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: "Too many requests" });
    assert.match(blocked.headers.get("retry-after") ?? "", /^\d+$/u);
    assert.match(
      blocked.headers.get("ratelimit") ?? "",
      /^"quota"; r=0; t=\d+$/u,
    );
    for (const header of [
      "x-ratelimit-limit",
      "x-ratelimit-remaining",
      "x-ratelimit-reset",
    ]) {
      assert.equal(blocked.headers.has(header), false);
    }
  } finally {
    await stopOAuthApp(server, runtime);
  }
});

test("Google OAuth policies preserve the central ten-minute contract", () => {
  assert.deepEqual(
    {
      start: {
        limit: RATE_LIMIT_POLICIES.googleStart.limit,
        windowMs: RATE_LIMIT_POLICIES.googleStart.windowMs,
      },
      callback: {
        limit: RATE_LIMIT_POLICIES.googleCallback.limit,
        windowMs: RATE_LIMIT_POLICIES.googleCallback.windowMs,
      },
    },
    {
      start: { limit: 20, windowMs: 10 * 60 * 1_000 },
      callback: { limit: 40, windowMs: 10 * 60 * 1_000 },
    },
  );
  assert.notEqual(
    RATE_LIMIT_POLICIES.googleStart.prefix,
    RATE_LIMIT_POLICIES.googleCallback.prefix,
  );
});

test("OAuth limits normalize IPv4 and IPv6 addresses from a trusted proxy", async () => {
  const { server, runtime, baseUrl } = await startOAuthApp({
    trustProxy: "127.0.0.1/32",
  });

  try {
    const requestRoute = (path: string, ip: string) =>
      fetch(`${baseUrl}/api/auth/google/${path}`, {
        headers: { "X-Forwarded-For": ip },
        redirect: "manual",
      });

    for (const { path, limit } of OAUTH_ROUTE_CASES) {
      const sameIpv4 = await requestStatuses(limit, () =>
        requestRoute(path, "198.51.100.10"),
      );
      assert.equal(sameIpv4.every((status) => status === 302), true);
      assert.equal((await requestRoute(path, "198.51.100.10")).status, 429);
      assert.equal((await requestRoute(path, "198.51.100.11")).status, 302);

      const sameIpv6 = await requestStatuses(limit, () =>
        requestRoute(path, "2001:db8:1234:5600::1"),
      );
      assert.equal(sameIpv6.every((status) => status === 302), true);
      assert.equal(
        (await requestRoute(path, "2001:db8:1234:56ff::2")).status,
        429,
      );
      assert.equal(
        (await requestRoute(path, "2001:db8:1234:5700::1")).status,
        302,
      );
    }
  } finally {
    await stopOAuthApp(server, runtime);
  }
});

test("OAuth limits ignore spoofed forwarding headers without explicit proxy trust", async () => {
  const { server, runtime, baseUrl } = await startOAuthApp();

  try {
    for (const { path, limit } of OAUTH_ROUTE_CASES) {
      const statuses = await requestStatuses(limit, () =>
        fetch(`${baseUrl}/api/auth/google/${path}`, {
          headers: { "X-Forwarded-For": "198.51.100.10" },
          redirect: "manual",
        }),
      );
      assert.equal(statuses.every((status) => status === 302), true);

      const spoofedDifferentIp = await fetch(
        `${baseUrl}/api/auth/google/${path}`,
        {
          headers: { "X-Forwarded-For": "203.0.113.99" },
          redirect: "manual",
        },
      );
      assert.equal(spoofedDifferentIp.status, 429);
    }
  } finally {
    await stopOAuthApp(server, runtime);
  }
});

test("trusted proxy boundaries ignore spoofed earlier forwarding hops", async () => {
  const { server, runtime, baseUrl } = await startOAuthApp({
    trustProxy: "127.0.0.1/32,203.0.113.8/32",
  });

  try {
    const requestCallback = (ipChain: string) =>
      fetch(`${baseUrl}/api/auth/google/callback`, {
        headers: { "X-Forwarded-For": ipChain },
        redirect: "manual",
      });

    for (let index = 0; index < 40; index += 1) {
      assert.equal(
        (await requestCallback("198.51.100.10, 203.0.113.8")).status,
        302,
      );
    }
    assert.equal(
      (await requestCallback("198.51.100.11, 203.0.113.8")).status,
      302,
    );

    for (let index = 0; index < 40; index += 1) {
      assert.equal(
        (await requestCallback("198.51.100.20, 203.0.113.99")).status,
        302,
      );
    }
    assert.equal(
      (await requestCallback("198.51.100.21, 203.0.113.99")).status,
      429,
    );
  } finally {
    await stopOAuthApp(server, runtime);
  }
});

test("resetting either central OAuth store key allows its route again", async () => {
  const stores = new Map<string, Store>();
  const { server, runtime, baseUrl } = await startOAuthApp({
    storeFactory: (policy) => {
      const store = new MemoryStore();
      stores.set(policy.name, store);
      return store;
    },
  });

  try {
    for (let index = 0; index < 20; index += 1) {
      const response = await fetch(
        `${baseUrl}/api/auth/google/start?returnTo=login`,
        { redirect: "manual" },
      );
      assert.equal(response.status, 302);
    }
    const blocked = await fetch(
      `${baseUrl}/api/auth/google/start?returnTo=login`,
      { redirect: "manual" },
    );
    assert.equal(blocked.status, 429);

    const startStore = stores.get(RATE_LIMIT_POLICIES.googleStart.name);
    assert.ok(startStore?.resetAll);
    await startStore.resetAll();

    const reset = await fetch(
      `${baseUrl}/api/auth/google/start?returnTo=login`,
      { redirect: "manual" },
    );
    assert.equal(reset.status, 302);

    const callbackStatuses = await requestStatuses(40, () =>
      fetch(`${baseUrl}/api/auth/google/callback`, { redirect: "manual" }),
    );
    assert.equal(callbackStatuses.every((status) => status === 302), true);
    const callbackBlocked = await fetch(
      `${baseUrl}/api/auth/google/callback`,
      { redirect: "manual" },
    );
    assert.equal(callbackBlocked.status, 429);

    const callbackStore = stores.get(RATE_LIMIT_POLICIES.googleCallback.name);
    assert.ok(callbackStore?.resetAll);
    await callbackStore.resetAll();

    const callbackReset = await fetch(
      `${baseUrl}/api/auth/google/callback`,
      { redirect: "manual" },
    );
    assert.equal(callbackReset.status, 302);
  } finally {
    await stopOAuthApp(server, runtime);
  }
});

test("OAuth store outages fail closed with generic responses for both routes", async () => {
  const leakedDetails =
    "redis://oauth-user:oauth-password@private.example.test authorization-code id-token";
  const failures: Array<Record<string, unknown>> = [];
  const { server, runtime, baseUrl } = await startOAuthApp({
    storeFactory: () =>
      ({
        localKeys: false,
        increment: async () => {
          throw new Error(leakedDetails);
        },
        decrement: async () => {},
        resetKey: async () => {},
      }) as Store,
    onStoreFailure: (event) => failures.push(event as Record<string, unknown>),
  });

  try {
    for (const path of [
      "/auth/google/start?returnTo=login",
      "/auth/google/callback",
    ]) {
      const response = await fetch(`${baseUrl}/api${path}`, {
        redirect: "manual",
      });
      assert.equal(response.status, 503);
      const body = await response.text();
      assert.deepEqual(JSON.parse(body), {
        error: "Service temporarily unavailable",
      });
      assert.equal(body.includes(leakedDetails), false);
    }
    assert.deepEqual(
      failures.map(({ policyName, failureMode, operation }) => ({
        policyName,
        failureMode,
        operation,
      })),
      [
        {
          policyName: RATE_LIMIT_POLICIES.googleStart.name,
          failureMode: "fail-closed",
          operation: "increment",
        },
        {
          policyName: RATE_LIMIT_POLICIES.googleCallback.name,
          failureMode: "fail-closed",
          operation: "increment",
        },
      ],
    );
  } finally {
    await stopOAuthApp(server, runtime);
  }
});
