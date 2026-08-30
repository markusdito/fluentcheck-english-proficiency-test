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

function googleAuth() {
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
    googleAuth: googleAuth(),
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

test("Google start and callback use independent central thresholds", async () => {
  const { server, runtime, baseUrl } = await startOAuthApp();

  try {
    const startStatuses: number[] = [];
    for (let index = 0; index < 21; index += 1) {
      startStatuses.push(
        (
          await fetch(`${baseUrl}/api/auth/google/start?returnTo=login`, {
            redirect: "manual",
          })
        ).status,
      );
    }
    assert.equal(
      startStatuses.slice(0, 20).every((status) => status === 302),
      true,
    );
    assert.equal(startStatuses[20], 429);

    const callbackStatuses: number[] = [];
    for (let index = 0; index < 41; index += 1) {
      callbackStatuses.push(
        (
          await fetch(`${baseUrl}/api/auth/google/callback`, {
            redirect: "manual",
          })
        ).status,
      );
    }
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
    assert.match(blocked.headers.get("ratelimit") ?? "", /quota/u);
    assert.equal(blocked.headers.has("x-ratelimit-limit"), false);
  } finally {
    await stopOAuthApp(server, runtime);
  }
});

test("OAuth limits normalize IPv4 and IPv6 addresses from a trusted proxy", async () => {
  const { server, runtime, baseUrl } = await startOAuthApp({
    trustProxy: "127.0.0.1/32",
  });

  try {
    const requestStart = (ip: string) =>
      fetch(`${baseUrl}/api/auth/google/start?returnTo=login`, {
        headers: { "X-Forwarded-For": ip },
        redirect: "manual",
      });

    for (let index = 0; index < 20; index += 1) {
      assert.equal((await requestStart("198.51.100.10")).status, 302);
    }
    assert.equal((await requestStart("198.51.100.10")).status, 429);
    assert.equal((await requestStart("198.51.100.11")).status, 302);

    for (let index = 0; index < 20; index += 1) {
      assert.equal((await requestStart("2001:db8:1234:5600::1")).status, 302);
    }
    assert.equal((await requestStart("2001:db8:1234:56ff::2")).status, 429);
    assert.equal((await requestStart("2001:db8:1234:5700::1")).status, 302);
  } finally {
    await stopOAuthApp(server, runtime);
  }
});

test("OAuth limits ignore spoofed forwarding headers without explicit proxy trust", async () => {
  const { server, runtime, baseUrl } = await startOAuthApp();

  try {
    for (let index = 0; index < 20; index += 1) {
      const response = await fetch(
        `${baseUrl}/api/auth/google/start?returnTo=login`,
        {
          headers: { "X-Forwarded-For": `198.51.100.${index + 1}` },
          redirect: "manual",
        },
      );
      assert.equal(response.status, 302);
    }

    const spoofedDifferentIp = await fetch(
      `${baseUrl}/api/auth/google/start?returnTo=login`,
      {
        headers: { "X-Forwarded-For": "203.0.113.99" },
        redirect: "manual",
      },
    );
    assert.equal(spoofedDifferentIp.status, 429);
  } finally {
    await stopOAuthApp(server, runtime);
  }
});

test("resetting the central OAuth start store key allows the route again", async () => {
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
