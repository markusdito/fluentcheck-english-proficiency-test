import assert from "node:assert/strict";
import type { Server } from "node:http";
import { once } from "node:events";
import { test } from "node:test";
import express from "express";
import type { Express } from "express";
import { MemoryStore, type Store } from "express-rate-limit";
import { createApp, unhandledRequestError } from "../src/server.js";
import { createPaymentRouter } from "../src/routes/payment.routes.js";
import {
  createRateLimitConfig,
  createRateLimitPolicyRegistry,
  defineRateLimitPolicy,
  RATE_LIMIT_POLICIES,
} from "../src/config/rate-limit.js";
import {
  type RateLimitRuntime,
  createAccountAndIpRateLimiters,
  createRateLimitRuntime,
  deriveRateLimitKey,
} from "../src/middleware/rate-limit.middleware.js";

const HMAC_SECRET = "rate-limit-test-secret-0123456789";
const JWT_SECRET = "jwt-secret-that-is-different-0123456789";

function policy(
  overrides: Partial<Parameters<typeof defineRateLimitPolicy>[0]> = {},
) {
  return defineRateLimitPolicy({
    name: "contract-test",
    prefix: "fc:test:contract",
    scope: "ip",
    limit: 1,
    windowMs: 60_000,
    failureMode: "fail-closed",
    ...overrides,
  });
}

function memoryStoreFactory(): (_policy: ReturnType<typeof policy>) => Store {
  return () => new MemoryStore();
}

function createContractApp(
  configuredPolicy: ReturnType<typeof policy>,
  options: {
    trustProxy?: string;
    storeFactory?: (policy: ReturnType<typeof policy>) => Store;
    onStoreFailure?: (event: unknown) => void;
  } = {},
) {
  const app = createApp({
    rateLimit: {
      config: createRateLimitConfig({
        hmacSecret: HMAC_SECRET,
        jwtSecret: JWT_SECRET,
        trustProxy: options.trustProxy ?? "none",
      }),
      storeFactory: options.storeFactory ?? memoryStoreFactory(),
      onStoreFailure: options.onStoreFailure,
    },
  });
  const runtime = app.locals.rateLimit as RateLimitRuntime;
  app.get(
    "/contract",
    runtime.createLimiter(configuredPolicy),
    (req, res) => res.json({ ok: true, ip: req.ip, ips: req.ips }),
  );
  return app;
}

async function start(app: Express) {
  const server = app.listen(0);
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
  };
}

async function stop(server: Server) {
  server.close();
  await once(server, "close");
}

test("validates rate-limit secrets, proxy trust, windows, and policy identity", () => {
  assert.throws(
    () => createRateLimitConfig({ hmacSecret: "too-short" }),
    /at least 32 bytes/,
  );
  assert.throws(
    () => createRateLimitConfig({ hmacSecret: HMAC_SECRET, jwtSecret: HMAC_SECRET }),
    /distinct from JWT_SECRET/,
  );
  assert.throws(
    () => createRateLimitConfig({ hmacSecret: HMAC_SECRET, jwtSecret: "" }),
    /JWT_SECRET must be configured/,
  );
  assert.throws(
    () => createRateLimitConfig({ hmacSecret: HMAC_SECRET, trustProxy: "true" }),
    /none or an explicit CIDR allowlist/,
  );
  assert.throws(
    () => createRateLimitConfig({ hmacSecret: HMAC_SECRET, nodeEnv: "production" }),
    /must be explicitly set.*production/,
  );
  assert.throws(
    () => createRateLimitConfig({ hmacSecret: HMAC_SECRET, trustProxy: "10.0.0.1/33" }),
    /valid CIDR/,
  );
  assert.throws(
    () => createRateLimitConfig({ hmacSecret: HMAC_SECRET, ipv6Subnet: 0 }),
    /between 1 and 128/,
  );
  assert.throws(
    () => defineRateLimitPolicy({
      name: "bad",
      prefix: "fc:test:bad",
      scope: "ip",
      limit: 0,
      windowMs: 1_000,
      failureMode: "fail-closed",
    }),
    /positive integer/,
  );
  assert.throws(
    () => defineRateLimitPolicy({
      name: "bad-window",
      prefix: "fc:test:bad-window",
      scope: "ip",
      limit: 1,
      windowMs: 1.5,
      failureMode: "fail-closed",
    }),
    /positive integer/,
  );
  assert.throws(
    () => createRateLimitPolicyRegistry([policy(), policy()]),
    /unique policy names and prefixes/,
  );

  const config = createRateLimitConfig({
    hmacSecret: HMAC_SECRET,
    jwtSecret: JWT_SECRET,
    trustProxy: "none",
  });
  const emailPolicy = policy({ name: "email", prefix: "fc:test:email", scope: "email" });
  const firstKey = deriveRateLimitKey(emailPolicy, config, "  User@Example.COM ");
  const secondKey = deriveRateLimitKey(emailPolicy, config, "user@example.com");
  const otherPolicyKey = deriveRateLimitKey(
    policy({ name: "other", prefix: "fc:test:other", scope: "email" }),
    config,
    "user@example.com",
  );

  assert.equal(firstKey, secondKey);
  assert.notEqual(firstKey, otherPolicyKey);
  assert.equal(firstKey.includes("user@example.com"), false);
  assert.equal(firstKey.includes(HMAC_SECRET), false);
  assert.equal(Object.keys(RATE_LIMIT_POLICIES).length > 1, true);
  assert.deepEqual(
    {
      loginBurst: RATE_LIMIT_POLICIES.loginBurst,
      loginFailureAccount: RATE_LIMIT_POLICIES.loginFailureAccount,
      loginFailureIp: RATE_LIMIT_POLICIES.loginFailureIp,
      registrationBurst: RATE_LIMIT_POLICIES.registrationBurst,
      registrationIp: RATE_LIMIT_POLICIES.registrationIp,
      registrationEmail: RATE_LIMIT_POLICIES.registrationEmail,
    },
    {
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
    },
  );
});

test("uses one injected store per policy across route mounts and app instances", async () => {
  const configuredPolicy = policy({ name: "shared", prefix: "fc:test:shared" });
  const config = createRateLimitConfig({
    hmacSecret: HMAC_SECRET,
    jwtSecret: JWT_SECRET,
    trustProxy: "none",
  });
  const sharedStore = new MemoryStore();
  let factoryCalls = 0;
  const storeFactory = () => {
    factoryCalls += 1;
    return sharedStore;
  };
  const firstApp = createApp({ rateLimit: { config, storeFactory } });
  const firstRuntime = firstApp.locals.rateLimit as RateLimitRuntime;
  firstApp.get("/one", firstRuntime.createLimiter(configuredPolicy), (_req, res) => res.json({ ok: true }));
  firstApp.get("/two", firstRuntime.createLimiter(configuredPolicy), (_req, res) => res.json({ ok: true }));
  const secondApp = createApp({ rateLimit: { config, storeFactory } });
  const secondRuntime = secondApp.locals.rateLimit as RateLimitRuntime;
  secondApp.get("/three", secondRuntime.createLimiter(configuredPolicy), (_req, res) => res.json({ ok: true }));

  const first = await start(firstApp);
  const second = await start(secondApp);
  try {
    assert.equal((await fetch(`${first.url}/one`)).status, 200);
    assert.equal((await fetch(`${first.url}/two`)).status, 429);
    assert.equal((await fetch(`${second.url}/three`)).status, 429);
    assert.equal(factoryCalls, 38);
  } finally {
    await stop(first.server);
    await stop(second.server);
    await firstRuntime.shutdown();
    await secondRuntime.shutdown();
  }
});

test("returns generic draft-8 headers and independently limits named policies", async () => {
  const app = createApp({
    rateLimit: {
      config: createRateLimitConfig({
        hmacSecret: HMAC_SECRET,
        jwtSecret: JWT_SECRET,
        trustProxy: "none",
      }),
      storeFactory: memoryStoreFactory(),
    },
  });
  const runtime = app.locals.rateLimit as RateLimitRuntime;
  const firstPolicy = policy();
  const secondPolicy = policy({ name: "second", prefix: "fc:test:second" });
  app.get("/first", runtime.createLimiter(firstPolicy), (_req, res) => res.json({ route: "first" }));
  app.get("/second", runtime.createLimiter(secondPolicy), (_req, res) => res.json({ route: "second" }));

  const { server, url } = await start(app);
  try {
    const first = await fetch(`${url}/first`);
    assert.equal(first.status, 200);
    assert.match(first.headers.get("ratelimit") ?? "", /quota/);

    const blocked = await fetch(`${url}/first`);
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: "Too many requests" });
    assert.match(blocked.headers.get("retry-after") ?? "", /^\d+$/);
    assert.match(blocked.headers.get("ratelimit") ?? "", /quota/);
    assert.equal(blocked.headers.has("x-ratelimit-limit"), false);
    assert.equal(blocked.headers.has("x-ratelimit-remaining"), false);

    const independent = await fetch(`${url}/second`);
    assert.equal(independent.status, 200);
  } finally {
    await stop(server);
  }
});

test("mounts the general API baseline before route handling", async () => {
  const app = createApp({
    rateLimit: {
      config: createRateLimitConfig({
        hmacSecret: HMAC_SECRET,
        jwtSecret: JWT_SECRET,
        trustProxy: "none",
      }),
      storeFactory: memoryStoreFactory(),
    },
  });
  const runtime = app.locals.rateLimit as RateLimitRuntime;
  const { server, url } = await start(app);

  try {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 301; attempt += 1) {
      statuses.push((await fetch(`${url}/api/not-found`)).status);
    }

    assert.equal(statuses.slice(0, 300).every((status) => status === 404), true);
    assert.equal(statuses[300], 429);
  } finally {
    await stop(server);
    await runtime.shutdown();
  }
});

test("does not charge dedicated routes to the general API baseline", async () => {
  const increments = new Map<string, number>();
  const app = createApp({
    rateLimit: {
      config: createRateLimitConfig({
        hmacSecret: HMAC_SECRET,
        jwtSecret: JWT_SECRET,
        trustProxy: "none",
      }),
      storeFactory: (configuredPolicy) =>
        ({
          localKeys: false,
          increment: async () => {
            const count = (increments.get(configuredPolicy.name) ?? 0) + 1;
            increments.set(configuredPolicy.name, count);
            return {
              totalHits: count,
              resetTime: new Date(Date.now() + configuredPolicy.windowMs),
            };
          },
          decrement: async () => {},
          resetKey: async () => {},
        }) as Store,
    },
  });
  const runtime = app.locals.rateLimit as RateLimitRuntime;
  const { server, url } = await start(app);

  try {
    const response = await fetch(`${url}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{",
    });
    assert.equal(response.status, 400);
    assert.equal(increments.get("general-api") ?? 0, 0);
    assert.equal(increments.get("auth-login-burst"), 1);
  } finally {
    await stop(server);
    await runtime.shutdown();
  }
});

test("keeps unmounted Google OAuth paths on the general API baseline", async () => {
  const increments = new Map<string, number>();
  const app = createApp({
    rateLimit: {
      config: createRateLimitConfig({
        hmacSecret: HMAC_SECRET,
        jwtSecret: JWT_SECRET,
        trustProxy: "none",
      }),
      storeFactory: (configuredPolicy) =>
        ({
          localKeys: false,
          increment: async () => {
            const count = (increments.get(configuredPolicy.name) ?? 0) + 1;
            increments.set(configuredPolicy.name, count);
            return {
              totalHits: count,
              resetTime: new Date(Date.now() + configuredPolicy.windowMs),
            };
          },
          decrement: async () => {},
          resetKey: async () => {},
        }) as Store,
    },
  });
  const runtime = app.locals.rateLimit as RateLimitRuntime;
  const { server, url } = await start(app);

  try {
    const response = await fetch(`${url}/api/auth/google/start`);
    assert.equal(response.status, 404);
    assert.equal(increments.get("general-api"), 1);
  } finally {
    await stop(server);
    await runtime.shutdown();
  }
});

test("limits the iPaymu callback independently at its route boundary", async () => {
  const app = express();
  const runtime = createRateLimitRuntime({
    config: createRateLimitConfig({
      hmacSecret: HMAC_SECRET,
      jwtSecret: JWT_SECRET,
      trustProxy: "none",
    }),
    storeFactory: memoryStoreFactory(),
  });
  app.use(express.json());
  app.use("/api/payments", createPaymentRouter(undefined, runtime));
  app.use(unhandledRequestError);
  const { server, url } = await start(app);

  try {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 301; attempt += 1) {
      const response = await fetch(`${url}/api/payments/ipaymu/notify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      statuses.push(response.status);
    }

    assert.equal(statuses.slice(0, 300).every((status) => status === 400), true);
    assert.equal(statuses[300], 429);
  } finally {
    await stop(server);
    await runtime.shutdown();
  }
});

test("keeps Google OAuth start and callback budgets independent", async () => {
  const app = createApp({
    rateLimit: {
      config: createRateLimitConfig({
        hmacSecret: HMAC_SECRET,
        jwtSecret: JWT_SECRET,
        trustProxy: "none",
      }),
      storeFactory: memoryStoreFactory(),
    },
    googleAuth: {
      start: (_req, res) => res.status(302).end(),
      callback: (_req, res) => res.status(302).end(),
    },
  });
  const runtime = app.locals.rateLimit as RateLimitRuntime;
  const { server, url } = await start(app);

  try {
    const startStatuses: number[] = [];
    for (let attempt = 0; attempt < 21; attempt += 1) {
      startStatuses.push((await fetch(`${url}/api/auth/google/start`)).status);
    }
    assert.equal(startStatuses.slice(0, 20).every((status) => status === 302), true);
    assert.equal(startStatuses[20], 429);

    const callbackStatuses: number[] = [];
    for (let attempt = 0; attempt < 41; attempt += 1) {
      callbackStatuses.push((await fetch(`${url}/api/auth/google/callback`)).status);
    }
    assert.equal(callbackStatuses.slice(0, 40).every((status) => status === 302), true);
    assert.equal(callbackStatuses[40], 429);
  } finally {
    await stop(server);
    await runtime.shutdown();
  }
});

test("derives account and IP limits after the active account boundary", async () => {
  const app = express();
  const runtime = createRateLimitRuntime({
    config: createRateLimitConfig({
      hmacSecret: HMAC_SECRET,
      jwtSecret: JWT_SECRET,
      trustProxy: "127.0.0.1/32",
    }),
    storeFactory: memoryStoreFactory(),
  });
  const accountPolicy = policy({
    name: "account-boundary",
    prefix: "fc:test:account-boundary",
    scope: "account",
    limit: 2,
  });
  const ipPolicy = policy({
    name: "ip-boundary",
    prefix: "fc:test:ip-boundary",
    limit: 3,
  });

  app.use((req, _res, next) => {
    req.user = {
      id: req.header("X-Test-User") ?? "user-a",
      username: "test-user",
      email: "test@example.test",
      role: "STUDENT",
      createdAt: new Date(),
    };
    next();
  });
  app.get(
    "/resource",
    ...createAccountAndIpRateLimiters(runtime, accountPolicy, ipPolicy),
    (_req, res) => res.json({ ok: true }),
  );
  app.use(unhandledRequestError);
  const { server, url } = await start(app);

  try {
    const request = (user: string) =>
      fetch(`${url}/resource`, {
        headers: {
          "X-Test-User": user,
          "X-Forwarded-For": "198.51.100.10",
        },
      });

    assert.equal((await request("user-a")).status, 200);
    assert.equal((await request("user-a")).status, 200);
    assert.equal((await request("user-a")).status, 429);
    assert.equal((await request("user-b")).status, 200);
    assert.equal((await request("user-b")).status, 429);
  } finally {
    await stop(server);
    await runtime.shutdown();
  }
});

test("uses only trusted forwarded IPs and normalizes IPv6 keys", async () => {
  const app = createContractApp(policy(), {
    trustProxy: "127.0.0.1/32,::1/128,::ffff:127.0.0.1/128",
  });
  app.get("/debug-ip", (req, res) => res.json({ ip: req.ip, ips: req.ips }));
  const { server, url } = await start(app);
  try {
    const debug = await fetch(`${url}/debug-ip`, {
      headers: { "X-Forwarded-For": "2001:db8:abcd:12::1" },
    });
    assert.deepEqual(await debug.json(), {
      ip: "2001:db8:abcd:12::1",
      ips: ["2001:db8:abcd:12::1"],
    });
    const first = await fetch(`${url}/contract`, {
      headers: { "X-Forwarded-For": "2001:db8:abcd:12::1" },
    });
    const sameSubnet = await fetch(`${url}/contract`, {
      headers: { "X-Forwarded-For": "2001:db8:abcd:34::2" },
    });
    const second = await fetch(`${url}/contract`, {
      headers: { "X-Forwarded-For": "2001:db8:abce:22::2" },
    });
    const repeatFirst = await fetch(`${url}/contract`, {
      headers: { "X-Forwarded-For": "2001:db8:abcd:12::1" },
    });

    assert.equal(first.status, 200);
    assert.equal(sameSubnet.status, 429);
    assert.equal(second.status, 200);
    assert.equal(repeatFirst.status, 429);
    const forwarded = await fetch(`${url}/debug-ip`, {
      headers: { "X-Forwarded-For": "2001:db8:abcd:32::3" },
    });
    const forwardedBody = (await forwarded.json()) as {
      ip: string;
      ips: string[];
    };
    assert.equal(forwardedBody.ip, "2001:db8:abcd:32::3");
    assert.deepEqual(forwardedBody.ips, ["2001:db8:abcd:32::3"]);
  } finally {
    await stop(server);
  }
});

test("does not trust spoofed forwarded IPs when proxy trust is none", async () => {
  const app = createContractApp(policy());
  const { server, url } = await start(app);
  try {
    const first = await fetch(`${url}/contract`, {
      headers: { "X-Forwarded-For": "198.51.100.10" },
    });
    const spoofed = await fetch(`${url}/contract`, {
      headers: { "X-Forwarded-For": "198.51.100.11" },
    });
    assert.equal(first.status, 200);
    assert.equal(spoofed.status, 429);
  } finally {
    await stop(server);
  }
});

test("fails closed with a generic 503 and fails open only when the policy says so", async () => {
  const rawFailure = `${HMAC_SECRET} 203.0.113.10 user@example.com`;
  const failingStoreFactory = () =>
    ({
      localKeys: false,
      increment: async () => {
        throw new Error(rawFailure);
      },
      decrement: async () => {},
      resetKey: async () => {},
    }) as Store;
  const events: unknown[] = [];

  const createFailureApp = (configuredPolicy: ReturnType<typeof policy>) => {
    const app = express();
    const runtime = createRateLimitRuntime({
      config: createRateLimitConfig({
        hmacSecret: HMAC_SECRET,
        jwtSecret: JWT_SECRET,
        trustProxy: "none",
      }),
      storeFactory: failingStoreFactory,
      onStoreFailure: (event) => events.push(event),
    });
    app.get(
      "/contract",
      runtime.createLimiter(configuredPolicy),
      (_req, res) => res.json({ ok: true }),
    );
    app.use(unhandledRequestError);
    return app;
  };
  const failClosedApp = createFailureApp(policy());
  const failOpenApp = createFailureApp(
    policy({
      name: "read-only-baseline",
      prefix: "fc:test:read-only-baseline",
      failureMode: "fail-open",
    }),
  );

  const closed = await start(failClosedApp);
  const open = await start(failOpenApp);
  try {
    const closedResponse = await fetch(`${closed.url}/contract`);
    const openResponse = await fetch(`${open.url}/contract`);
    assert.equal(closedResponse.status, 503);
    assert.deepEqual(await closedResponse.json(), { error: "Service temporarily unavailable" });
    assert.equal(openResponse.status, 200);
    assert.deepEqual(await openResponse.json(), { ok: true });
    assert.equal(JSON.stringify(events).includes(rawFailure), false);
    assert.equal(JSON.stringify(events).includes(HMAC_SECRET), false);
  } finally {
    await stop(closed.server);
    await stop(open.server);
  }
});

test("the mounted read-only baseline fails open with an observable safe event", async () => {
  const rawFailure = `${HMAC_SECRET} 203.0.113.10 user@example.com`;
  const events: unknown[] = [];
  const app = createApp({
    rateLimit: {
      config: createRateLimitConfig({
        hmacSecret: HMAC_SECRET,
        jwtSecret: JWT_SECRET,
        trustProxy: "none",
      }),
      storeFactory: () =>
        ({
          localKeys: false,
          increment: async () => {
            throw new Error(rawFailure);
          },
          decrement: async () => {},
          resetKey: async () => {},
        }) as Store,
      onStoreFailure: (event) => events.push(event),
    },
  });
  const runtime = app.locals.rateLimit as RateLimitRuntime;
  const { server, url } = await start(app);

  try {
    const response = await fetch(`${url}/api/not-found`);
    assert.equal(response.status, 404);
    assert.deepEqual(events, [
      {
        policyName: "general-api",
        failureMode: "fail-open",
        operation: "increment",
      },
    ]);
    assert.equal(JSON.stringify(events).includes(rawFailure), false);
    assert.equal(JSON.stringify(events).includes(HMAC_SECRET), false);
  } finally {
    await stop(server);
    await runtime.shutdown();
  }
});

test("applies the login burst before parsing malformed authentication bodies", async () => {
  const app = createApp({
    rateLimit: {
      config: createRateLimitConfig({
        hmacSecret: HMAC_SECRET,
        jwtSecret: JWT_SECRET,
        trustProxy: "none",
      }),
      storeFactory: memoryStoreFactory(),
    },
  });
  const runtime = app.locals.rateLimit as RateLimitRuntime;
  const { server, url } = await start(app);

  try {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 121; attempt += 1) {
      const response = await fetch(`${url}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      });
      statuses.push(response.status);
    }

    assert.equal(statuses.slice(0, 120).every((status) => status === 400), true);
    assert.equal(statuses[120], 429);
  } finally {
    await stop(server);
    await runtime.shutdown();
  }
});
