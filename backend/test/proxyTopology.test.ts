import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { Express, Request } from "express";
import { MemoryStore } from "express-rate-limit";
import { createApp } from "../src/server.js";
import { createRateLimitConfig } from "../src/config/rate-limit.js";

// Production topology (ops/compose/docker-compose.prod.yml): host nginx ->
// frontend container -> http://backend:5001, plus host nginx -> published
// 127.0.0.1:5001 (seen by the backend as the Docker gateway). Both hops sit
// in the pinned compose subnet, which must be the only trusted range.
const COMPOSE = readFileSync(
  new URL("../../ops/compose/docker-compose.prod.yml", import.meta.url),
  "utf8",
);
const HMAC_SECRET = "rate-limit-test-secret-0123456789";
const JWT_SECRET = "jwt-secret-that-is-different-0123456789";
const GATEWAY = "::ffff:172.31.250.1";
const FRONTEND = "::ffff:172.31.250.3";

function composeValue(pattern: RegExp): string | undefined {
  return COMPOSE.match(pattern)?.[1];
}

const pinnedSubnet = composeValue(/^\s+- subnet:\s*"?([^"\s]+)"?\s*$/mu);
const backendTrustProxy = composeValue(
  /^\s+RATE_LIMIT_TRUST_PROXY:\s*"?([^"\s]+)"?\s*$/mu,
);
const frontendBackendUrl = composeValue(/^\s+BACKEND_URL:\s*"?([^"\s]+)"?\s*$/mu);

function createTopologyApp(): Express {
  assert.ok(backendTrustProxy, "compose must set RATE_LIMIT_TRUST_PROXY");
  return createApp({
    rateLimit: {
      config: createRateLimitConfig({
        hmacSecret: HMAC_SECRET,
        jwtSecret: JWT_SECRET,
        trustProxy: backendTrustProxy,
      }),
      storeFactory: () => new MemoryStore(),
    },
  });
}

function resolveIp(
  app: Express,
  remoteAddress: string,
  forwardedFor: string,
): string | undefined {
  const request = Object.create(app.request) as Request;
  Object.defineProperties(request, {
    headers: { value: { "x-forwarded-for": forwardedFor } },
    socket: { value: { remoteAddress } },
  });
  return request.ip;
}

test("routes the frontend rewrite to the internal backend", () => {
  assert.equal(frontendBackendUrl, "http://backend:5001");
});

test("trusts exactly the pinned compose subnet", () => {
  assert.equal(pinnedSubnet, "172.31.250.0/24");
  assert.equal(backendTrustProxy, pinnedSubnet);
});

test("trusts the gateway and frontend hops and resolves the forwarded client", () => {
  const app = createTopologyApp();
  assert.equal(resolveIp(app, FRONTEND, "203.0.113.9"), "203.0.113.9");
  assert.equal(resolveIp(app, GATEWAY, "198.51.100.20"), "198.51.100.20");
  assert.equal(resolveIp(app, "172.31.250.3", "203.0.113.9"), "203.0.113.9");
  assert.equal(resolveIp(app, "172.31.250.1", "198.51.100.20"), "198.51.100.20");
});

test("ignores client-supplied forwarded entries left of the real client", () => {
  const app = createTopologyApp();
  assert.equal(resolveIp(app, FRONTEND, "1.2.3.4, 203.0.113.9"), "203.0.113.9");
});

test("does not trust addresses outside the pinned subnet", () => {
  const app = createTopologyApp();
  for (const peer of ["172.17.0.1", "::ffff:172.31.251.5", "127.0.0.1"]) {
    assert.equal(resolveIp(app, peer, "203.0.113.9"), peer);
  }
});
