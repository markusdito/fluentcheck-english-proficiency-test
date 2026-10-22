import assert from "node:assert/strict";
import type { Server } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import type { Express } from "express";
import { MemoryStore } from "express-rate-limit";
import { createApp, type AppDependencies } from "../src/server.js";
import { createRateLimitConfig } from "../src/config/rate-limit.js";
import { isPublicClientAddress } from "../src/middleware/client-ip-check.middleware.js";

const HMAC_SECRET = "rate-limit-test-secret-0123456789";
const JWT_SECRET = "jwt-secret-that-is-different-0123456789";
const LOOPBACK_TRUST = "127.0.0.1/32,::1/128,::ffff:127.0.0.1/128";

function recordingLogger() {
  const info: string[] = [];
  const warn: string[] = [];
  return {
    info,
    warn,
    logger: {
      info: (message: string) => info.push(message),
      warn: (message: string) => warn.push(message),
    },
  };
}

function createCheckedApp(
  trustProxy: string,
  clientIpCheck: AppDependencies["clientIpCheck"],
) {
  return createApp({
    rateLimit: {
      config: createRateLimitConfig({
        hmacSecret: HMAC_SECRET,
        jwtSecret: JWT_SECRET,
        trustProxy,
      }),
      storeFactory: () => new MemoryStore(),
    },
    clientIpCheck,
  });
}

async function start(app: Express) {
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, url: `http://127.0.0.1:${address.port}` };
}

async function stop(server: Server) {
  server.close();
  await once(server, "close");
}

async function forwarded(url: string, path = "/") {
  const response = await fetch(`${url}${path}`, {
    headers: { "X-Forwarded-For": "203.0.113.9" },
  });
  await response.arrayBuffer();
  return response;
}

test("logs one pass line when forwarded requests resolve to public addresses", async () => {
  const log = recordingLogger();
  const { server, url } = await start(
    createCheckedApp(LOOPBACK_TRUST, { logger: log.logger }),
  );
  try {
    await forwarded(url);
    await forwarded(url);
  } finally {
    await stop(server);
  }
  assert.equal(log.info.length, 1);
  assert.match(log.info[0], /^Client IP check passed/u);
  assert.equal(log.warn.length, 0);
  assert.ok(!log.info[0].includes("203.0.113.9"));
});

test("warns with the resolved address when the proxy hop is not trusted", async () => {
  const log = recordingLogger();
  const { server, url } = await start(
    createCheckedApp("none", { logger: log.logger }),
  );
  try {
    await forwarded(url);
  } finally {
    await stop(server);
  }
  assert.equal(log.warn.length, 1);
  assert.match(log.warn[0], /Client IP check failed/u);
  assert.match(log.warn[0], /127\.0\.0\.1/u);
  assert.match(log.warn[0], /currently none/u);
  assert.ok(!log.warn[0].includes("203.0.113.9"));
  assert.equal(log.info.length, 0);
});

test("throttles repeated warnings to one per interval", async () => {
  const log = recordingLogger();
  let now = 0;
  const { server, url } = await start(
    createCheckedApp("none", {
      logger: log.logger,
      now: () => now,
      warnIntervalMs: 1000,
    }),
  );
  try {
    await forwarded(url);
    now = 500;
    await forwarded(url);
    now = 1000;
    await forwarded(url);
  } finally {
    await stop(server);
  }
  assert.equal(log.warn.length, 2);
});

test("ignores the health endpoint", async () => {
  const log = recordingLogger();
  const { server, url } = await start(
    createCheckedApp("none", { logger: log.logger }),
  );
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await fetch(`${url}/api/health`);
      assert.equal(response.status, 200);
      await response.arrayBuffer();
    }
  } finally {
    await stop(server);
  }
  assert.deepEqual(log.info, []);
  assert.deepEqual(log.warn, []);
});

test("is off unless clientIpCheck is configured", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const info = t.mock.method(console, "info", () => {});
  const { server, url } = await start(createCheckedApp("none", undefined));
  try {
    await forwarded(url);
  } finally {
    await stop(server);
  }
  const messages = [...warn.mock.calls, ...info.mock.calls].map((call) =>
    String(call.arguments[0]),
  );
  assert.ok(!messages.some((message) => message.includes("Client IP check")));
});

test("classifies addresses", () => {
  for (const address of ["203.0.113.9", "2001:db8::1", "::ffff:203.0.113.9"]) {
    assert.equal(isPublicClientAddress(address), true, address);
  }
  for (const address of [
    "127.0.0.1",
    "::1",
    "::ffff:172.31.250.1",
    "10.1.2.3",
    "100.64.0.1",
    "192.168.1.1",
    "fd00::1",
    "fe80::1",
    "",
    undefined,
  ]) {
    assert.equal(isPublicClientAddress(address), false, String(address));
  }
});
