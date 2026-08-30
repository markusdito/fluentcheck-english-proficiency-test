import assert from "node:assert/strict";
import type { Server } from "node:http";
import { once } from "node:events";
import net from "node:net";
import { test } from "node:test";
import type { Express } from "express";
import { MemoryStore, type Store } from "express-rate-limit";
import { createApp, unhandledRequestError } from "../src/server.js";
import {
  createRateLimitConfig,
  defineRateLimitPolicy,
} from "../src/config/rate-limit.js";
import {
  createConfiguredRateLimitStoreFactory,
  createRedisRateLimitStoreFactory,
  type RateLimitSharedStoreClient,
  type RedisReply,
} from "../src/config/rateLimitStore.js";
import {
  type RateLimitRuntime,
  createRateLimitRuntime,
} from "../src/middleware/rate-limit.middleware.js";

const HMAC_SECRET = "rate-limit-shared-store-secret-0123456789";
const JWT_SECRET = "jwt-secret-that-is-different-0123456789";

function policy(
  overrides: Partial<Parameters<typeof defineRateLimitPolicy>[0]> = {},
) {
  return defineRateLimitPolicy({
    name: "shared-store-test",
    prefix: "fc:test:shared-store",
    scope: "ip",
    limit: 2,
    windowMs: 60_000,
    failureMode: "fail-closed",
    ...overrides,
  });
}

function sharedConfig() {
  return createRateLimitConfig({
    hmacSecret: HMAC_SECRET,
    jwtSecret: JWT_SECRET,
    trustProxy: "none",
    topology: "multi-instance",
    storeType: "shared",
    storeTimeoutMs: 250,
  });
}

type Entry = { hits: number; expiresAt: number };

class FakeRedisClient implements RateLimitSharedStoreClient {
  readonly commands: string[][] = [];
  private readonly entries = new Map<string, Entry>();
  private operation = Promise.resolve();
  private closed = false;
  private now = 0;

  async sendCommand(command: readonly string[]): Promise<RedisReply> {
    this.commands.push([...command]);
    const result = this.operation.then(() => this.execute(command));
    this.operation = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  advance(milliseconds: number): void {
    this.now += milliseconds;
  }

  private execute(command: readonly string[]): RedisReply {
    if (this.closed) throw new Error("raw redis connection detail");
    const operation = command[0];
    if (operation === "DEL") {
      return this.entries.delete(command[1] ?? "") ? 1 : 0;
    }

    const script = command[1] ?? "";
    const key = command[3] ?? "";
    this.expire(key);
    if (script.includes("INCR")) {
      const entry = this.entries.get(key) ?? {
        hits: 0,
        expiresAt: this.now + Number(command[4]),
      };
      entry.hits += 1;
      if (entry.expiresAt <= this.now) {
        entry.expiresAt = this.now + Number(command[4]);
      }
      this.entries.set(key, entry);
      return [entry.hits, entry.expiresAt - this.now];
    }
    if (script.includes("DECR")) {
      const entry = this.entries.get(key);
      if (!entry) return 0;
      entry.hits -= 1;
      if (entry.hits <= 0) this.entries.delete(key);
      return entry.hits;
    }
    if (script.includes("GET")) {
      const entry = this.entries.get(key);
      return entry ? [entry.hits, entry.expiresAt - this.now] : null;
    }
    throw new Error("unsupported redis command");
  }

  private expire(key: string): void {
    const entry = this.entries.get(key);
    if (entry && entry.expiresAt <= this.now) this.entries.delete(key);
  }
}

class FailingRedisClient implements RateLimitSharedStoreClient {
  async sendCommand(): Promise<RedisReply> {
    throw new Error("raw redis endpoint and credential detail");
  }

  async close(): Promise<void> {}
}

class AbortAwareRedisClient implements RateLimitSharedStoreClient {
  mutated = false;
  private resolveAbort!: () => void;
  private releaseCommand: () => void = () => undefined;
  readonly abortObserved = new Promise<void>((resolve) => {
    this.resolveAbort = resolve;
  });

  release(): void {
    this.releaseCommand();
  }

  async sendCommand(
    _command: readonly string[],
    signal?: AbortSignal,
  ): Promise<RedisReply> {
    return new Promise<RedisReply>((resolve, reject) => {
      let aborted = false;
      this.releaseCommand = () => {
        if (aborted) return;
        this.mutated = true;
        resolve([1, 100]);
      };
      const abort = () => {
        aborted = true;
        signal?.removeEventListener("abort", abort);
        this.resolveAbort();
        reject(new Error("command aborted"));
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
    });
  }

  async close(): Promise<void> {}
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

async function stop(server: Server, runtime: RateLimitRuntime): Promise<void> {
  server.close();
  await once(server, "close");
  await runtime.shutdown();
}

test("rejects a local store factory for distributed topology", () => {
  assert.throws(
    () =>
      createApp({
        rateLimit: {
          config: sharedConfig(),
          storeFactory: () => new MemoryStore(),
        },
      }),
    /local rate-limit store is not allowed for multi-process or multi-instance topology/,
  );
});

function createLimitedApp(
  configuredPolicy: ReturnType<typeof policy>,
  storeFactory: (policy: ReturnType<typeof policy>) => Store,
  onStoreFailure?: (event: unknown) => void,
) {
  const app = createApp({
    rateLimit: {
      config: sharedConfig(),
      storeFactory,
      onStoreFailure,
    },
  });
  const runtime = app.locals.rateLimit as RateLimitRuntime;
  app.get(
    "/limited",
    runtime.createLimiter(configuredPolicy),
    (_request, response) => response.json({ ok: true }),
  );
  return { app, runtime };
}

test("requires an explicit shared store for distributed topology", () => {
  assert.throws(
    () =>
      createRateLimitConfig({
        hmacSecret: HMAC_SECRET,
        jwtSecret: JWT_SECRET,
        trustProxy: "none",
        topology: "multi-process",
        storeType: "memory",
      }),
    /must be shared for multi-process or multi-instance/,
  );
  assert.throws(
    () =>
      createRateLimitRuntime({
        config: sharedConfig(),
      }),
    /shared rate-limit store factory is required/,
  );
  assert.throws(
    () =>
      createRateLimitConfig({
        hmacSecret: HMAC_SECRET,
        jwtSecret: JWT_SECRET,
        trustProxy: "none",
        topology: "multi-instance",
        storeType: "shared",
        storeTimeoutMs: 0,
      }),
    /STORE_TIMEOUT_MS must be a positive integer/,
  );
  assert.throws(
    () =>
      createRedisRateLimitStoreFactory({
        timeoutMs: 250,
        url: "https://not-redis.example",
      }),
    /must use redis or rediss/,
  );
  assert.throws(
    () =>
      createRedisRateLimitStoreFactory({
        timeoutMs: 250,
      }),
    /required for a shared store/,
  );
  assert.throws(
    () =>
      createConfiguredRateLimitStoreFactory(sharedConfig(), ""),
    /required when RATE_LIMIT_STORE is shared/,
  );
  assert.throws(
    () =>
      createRateLimitConfig({
        hmacSecret: HMAC_SECRET,
        jwtSecret: JWT_SECRET,
        trustProxy: "none",
        nodeEnv: "production",
      }),
    /RATE_LIMIT_TOPOLOGY must be explicitly set/,
  );
});

test("shared store keeps counters atomic, isolated, and expiring", async () => {
  const client = new FakeRedisClient();
  const storeFactory = createRedisRateLimitStoreFactory({
    client,
    timeoutMs: 250,
  });
  const firstStore = storeFactory(policy({ windowMs: 100 }));
  const secondStore = storeFactory(
    policy({ name: "other-policy", prefix: "fc:test:other", windowMs: 200 }),
  );

  const increments = await Promise.all(
    Array.from({ length: 40 }, () => firstStore.increment("fc:test:shared:key")),
  );
  assert.deepEqual(
    increments.map(({ totalHits }) => totalHits).sort((left, right) => left - right),
    Array.from({ length: 40 }, (_, index) => index + 1),
  );
  assert.equal((await firstStore.get("fc:test:shared:key"))?.totalHits, 40);
  assert.equal((await secondStore.increment("fc:test:other:key")).totalHits, 1);

  client.advance(101);
  assert.equal((await firstStore.increment("fc:test:shared:key")).totalHits, 1);
  assert.equal((await secondStore.get("fc:test:other:key"))?.totalHits, 1);
  await firstStore.resetKey("fc:test:shared:key");
  assert.equal(await firstStore.get("fc:test:shared:key"), undefined);
  await firstStore.shutdown();
  await secondStore.shutdown();
});

test("two native HTTP applications share counters and retain stable headers", async () => {
  const client = new FakeRedisClient();
  const storeFactory = createRedisRateLimitStoreFactory({
    client,
    timeoutMs: 250,
  });
  const configuredPolicy = policy({ limit: 2, windowMs: 1_000 });
  const firstApp = createLimitedApp(configuredPolicy, storeFactory);
  const secondApp = createLimitedApp(configuredPolicy, storeFactory);
  const first = await start(firstApp.app);
  const second = await start(secondApp.app);
  try {
    assert.equal((await fetch(`${first.url}/limited`)).status, 200);
    assert.equal((await fetch(`${second.url}/limited`)).status, 200);
    const blocked = await fetch(`${first.url}/limited`);
    assert.equal(blocked.status, 429);
    assert.deepEqual(await blocked.json(), { error: "Too many requests" });
    assert.match(blocked.headers.get("retry-after") ?? "", /^\d+$/);
    assert.match(blocked.headers.get("ratelimit") ?? "", /quota/);
    assert.equal(blocked.headers.has("x-ratelimit-limit"), false);
  } finally {
    await stop(first.server, firstApp.runtime);
    await stop(second.server, secondApp.runtime);
  }
});

test("shared-store outages fail closed without exposing store details", async () => {
  const events: unknown[] = [];
  const storeFactory = createRedisRateLimitStoreFactory({
    client: new FailingRedisClient(),
    timeoutMs: 250,
  });
  const configuredPolicy = policy({ limit: 1 });
  const { app, runtime } = createLimitedApp(
    configuredPolicy,
    storeFactory,
    (event) => events.push(event),
  );
  app.use(unhandledRequestError);
  const { server, url } = await start(app);
  try {
    const response = await fetch(`${url}/limited`);
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: "Service temporarily unavailable",
    });
    assert.equal(JSON.stringify(events).includes("raw redis endpoint"), false);
    assert.deepEqual(events, [
      {
        policyName: "shared-store-test",
        failureMode: "fail-closed",
        operation: "increment",
      },
    ]);
  } finally {
    await stop(server, runtime);
  }
});

test("store timeouts abort in-flight commands before a late mutation", async () => {
  const client = new AbortAwareRedisClient();
  const store = createRedisRateLimitStoreFactory({
    client,
    timeoutMs: 10,
  })(policy());

  await assert.rejects(
    store.increment("fc:test:late-mutation:key"),
    /shared store command failed/,
  );
  await client.abortObserved;
  client.release();
  assert.equal(client.mutated, false);
  await store.shutdown();
});

test("native shared-store commands have a bounded timeout", async () => {
  const blackHole = net.createServer((socket) => {
    socket.on("data", () => undefined);
  });
  blackHole.listen(0);
  await once(blackHole, "listening");
  const address = blackHole.address();
  assert.ok(address && typeof address !== "string");
  const store = createRedisRateLimitStoreFactory({
    url: `redis://127.0.0.1:${address.port}`,
    timeoutMs: 25,
  })(policy());

  try {
    await assert.rejects(
      store.increment("fc:test:timeout:key"),
      /shared store command failed/,
    );
  } finally {
    await store.shutdown();
    blackHole.close();
    await once(blackHole, "close");
  }
});

test("malformed shared-store replies fail safely", async () => {
  const malformed = net.createServer((socket) => {
    socket.on("data", () => socket.write("!malformed\\r\\n"));
  });
  malformed.listen(0);
  await once(malformed, "listening");
  const address = malformed.address();
  assert.ok(address && typeof address !== "string");
  const store = createRedisRateLimitStoreFactory({
    url: `redis://127.0.0.1:${address.port}`,
    timeoutMs: 250,
  })(policy());

  try {
    await assert.rejects(
      store.increment("fc:test:malformed:key"),
      /shared store command failed/,
    );
  } finally {
    await store.shutdown();
    malformed.close();
    await once(malformed, "close");
  }
});
