import assert from "node:assert/strict";
import type { Server } from "node:http";
import { once } from "node:events";
import { after, before, test } from "node:test";
import { MemoryStore } from "express-rate-limit";
import type { Express } from "express";
import { createApp } from "../src/server.js";
import {
  createGoogleAuthHandlers,
  type GoogleOAuthClient,
} from "../src/controllers/googleAuth.controller.js";
import { createRateLimitConfig } from "../src/config/rate-limit.js";
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

let server: Server;
let runtime: RateLimitRuntime;
let baseUrl: string;

before(async () => {
  const googleAuth = createGoogleAuthHandlers(
    {
      clientId: "123456789.apps.googleusercontent.com",
      clientSecret: "google-client-secret",
      redirectUri: "http://localhost:5001/api/auth/google/callback",
    },
    {
      client,
      frontendUrl: "https://fluentcheck.example.test",
      stateStore: memoryStateStore(),
    },
  );
  const app: Express = createApp({
    googleAuth,
    rateLimit: {
      config: createRateLimitConfig({
        hmacSecret: "google-oauth-rate-limit-hmac-secret",
        jwtSecret: "google-oauth-rate-limit-jwt-secret",
        trustProxy: "none",
      }),
      storeFactory: () => new MemoryStore(),
    },
  });
  runtime = app.locals.rateLimit as RateLimitRuntime;
  server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  server.close();
  await once(server, "close");
  await runtime.shutdown();
});

async function request(path: string) {
  return fetch(`${baseUrl}/api${path}`, { redirect: "manual" });
}

test("Google start and callback use independent central thresholds", async () => {
  const startStatuses: number[] = [];
  for (let index = 0; index < 21; index += 1) {
    startStatuses.push((await request("/auth/google/start?returnTo=login")).status);
  }
  assert.equal(startStatuses.slice(0, 20).every((status) => status === 302), true);
  assert.equal(startStatuses[20], 429);

  const callbackStatuses: number[] = [];
  for (let index = 0; index < 41; index += 1) {
    callbackStatuses.push((await request("/auth/google/callback")).status);
  }
  assert.equal(callbackStatuses.slice(0, 40).every((status) => status === 302), true);
  assert.equal(callbackStatuses[40], 429);
  const blocked = await request("/auth/google/callback");
  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), { error: "Too many requests" });
  assert.match(blocked.headers.get("retry-after") ?? "", /^\d+$/u);
  assert.match(blocked.headers.get("ratelimit") ?? "", /quota/u);
  assert.equal(blocked.headers.has("x-ratelimit-limit"), false);
});
