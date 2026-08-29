import net from "node:net";
import { createHash, createHmac } from "node:crypto";
import rateLimit, {
  ipKeyGenerator,
  MemoryStore,
  type Logger,
  type RateLimitRequestHandler,
  type Store,
} from "express-rate-limit";
import type { Request } from "express";
import {
  type RateLimitConfig,
  type RateLimitFailureMode,
  type RateLimitPolicy,
  type RateLimitScope,
  RATE_LIMIT_POLICY_REGISTRY,
} from "../config/rate-limit.js";

export interface RateLimitStoreFailureEvent {
  readonly policyName: string;
  readonly failureMode: RateLimitFailureMode;
  readonly operation: "init" | "get" | "increment" | "decrement" | "resetKey" | "resetAll" | "shutdown";
}

export type RateLimitStoreFactory = (policy: RateLimitPolicy) => Store;
export type RateLimitIdentityResolver = (request: Request) => string | undefined;
export type RateLimitFailureReporter = (event: RateLimitStoreFailureEvent) => void;

export interface RateLimitRuntimeOptions {
  readonly config: RateLimitConfig;
  readonly storeFactory?: RateLimitStoreFactory;
  readonly onStoreFailure?: RateLimitFailureReporter;
}

export interface RateLimitRuntime {
  readonly config: RateLimitConfig;
  createLimiter(
    policy: RateLimitPolicy,
    identityResolver?: RateLimitIdentityResolver,
  ): RateLimitRequestHandler;
  shutdown(): Promise<void>;
}

declare global {
  namespace Express {
    interface Locals {
      rateLimit?: RateLimitRuntime;
    }
  }
}

export class RateLimitStoreUnavailableError extends Error {
  readonly code = "RATE_LIMIT_STORE_UNAVAILABLE";

  constructor(
    readonly policyName: string,
    readonly failureMode: RateLimitFailureMode,
  ) {
    super("Rate-limit store unavailable");
    this.name = "RateLimitStoreUnavailableError";
  }
}

export class RateLimitKeyUnavailableError extends Error {
  readonly code = "RATE_LIMIT_KEY_UNAVAILABLE";

  constructor() {
    super("Rate-limit key unavailable");
    this.name = "RateLimitKeyUnavailableError";
  }
}

function notifyStoreFailure(
  reportFailure: RateLimitFailureReporter,
  event: RateLimitStoreFailureEvent,
) {
  try {
    reportFailure(event);
  } catch {
    // Observability must never change the configured fail-open/closed behavior.
  }
}

function normalizeIdentity(value: string, scope: RateLimitScope): string {
  const normalized = value.normalize("NFKC").trim().toLowerCase();
  if (!normalized) throw new RateLimitKeyUnavailableError();
  if (scope === "email" && !normalized.includes("@")) {
    throw new RateLimitKeyUnavailableError();
  }
  return normalized;
}

export function normalizeRateLimitIdentity(value: string, scope: RateLimitScope): string {
  if (scope === "ip") throw new RateLimitKeyUnavailableError();
  return normalizeIdentity(value, scope);
}

export function normalizeRateLimitIp(
  value: string,
  ipv6Subnet: number | false,
): string {
  if (net.isIP(value) === 0) throw new RateLimitKeyUnavailableError();
  return ipKeyGenerator(value, ipv6Subnet);
}

export function deriveRateLimitKey(
  policy: RateLimitPolicy,
  config: RateLimitConfig,
  value: string,
): string {
  const normalizedValue =
    policy.scope === "ip"
      ? normalizeRateLimitIp(value, config.ipv6Subnet)
      : normalizeRateLimitIdentity(value, policy.scope);
  const hmacDigest = createHmac("sha256", config.hmacSecret)
    .update(`${policy.prefix}\u0000${policy.scope}\u0000${normalizedValue}`)
    .digest("hex");
  const storageDigest = createHash("sha256").update(hmacDigest).digest("hex");
  return `${policy.prefix}:${storageDigest}`;
}

function createStoreUnavailableError(
  policy: RateLimitPolicy,
): RateLimitStoreUnavailableError {
  return new RateLimitStoreUnavailableError(policy.name, policy.failureMode);
}

function createSafeStore(
  store: Store,
  policy: RateLimitPolicy,
  reportFailure: RateLimitFailureReporter,
): Store {
  const call = async <T>(
    operation: RateLimitStoreFailureEvent["operation"],
    action: () => T | Promise<T>,
  ): Promise<T> => {
    try {
      return await action();
    } catch {
      notifyStoreFailure(reportFailure, {
        policyName: policy.name,
        failureMode: policy.failureMode,
        operation,
      });
      throw createStoreUnavailableError(policy);
    }
  };

  const safeStore: Store = {
    localKeys: store.localKeys,
    prefix: policy.prefix,
    increment: (key) => call("increment", () => store.increment(key)),
    decrement: (key) => call("decrement", () => store.decrement(key)),
    resetKey: (key) => call("resetKey", () => store.resetKey(key)),
  };

  if (store.init) {
    safeStore.init = (options) => call("init", () => store.init!.call(store, options));
  }
  if (store.get) {
    safeStore.get = (key) => call("get", () => store.get!.call(store, key));
  }
  if (store.resetAll) {
    safeStore.resetAll = () => call("resetAll", () => store.resetAll!.call(store));
  }
  if (store.shutdown) {
    safeStore.shutdown = () => call("shutdown", () => store.shutdown!.call(store));
  }

  return safeStore;
}

function resolvePolicyValue(
  request: Request,
  policy: RateLimitPolicy,
  identityResolver: RateLimitIdentityResolver | undefined,
): string {
  if (policy.scope === "ip") {
    if (!request.ip) throw new RateLimitKeyUnavailableError();
    return request.ip;
  }
  const identity = identityResolver?.(request);
  if (!identity) throw new RateLimitKeyUnavailableError();
  return identity;
}

function safeLogger(): Logger {
  return {
    error: () => undefined,
    warn: () => undefined,
  };
}

export function createRateLimitRuntime(
  options: RateLimitRuntimeOptions,
): RateLimitRuntime {
  const requiresSharedStore =
    options.config.storeType === "shared" ||
    options.config.topology !== "single-process";
  if (requiresSharedStore && !options.storeFactory) {
    throw new Error(
      "A shared rate-limit store factory is required for the configured topology",
    );
  }

  const storeFactory = options.storeFactory ?? (() => new MemoryStore());
  const reportFailure =
    options.onStoreFailure ??
    ((event: RateLimitStoreFailureEvent) => {
      console.warn("Rate-limit store unavailable", event);
    });
  const stores = new Map<string, Store>();
  const uniqueStores = new Set<Store>();
  const storePolicies = new Map<Store, RateLimitPolicy>();
  const limiters = new Map<
    string,
    { handler: RateLimitRequestHandler; identityResolver?: RateLimitIdentityResolver }
  >();

  return {
    config: options.config,
    createLimiter(policy, identityResolver) {
      const existing = limiters.get(policy.prefix);
      if (existing) {
        if (existing.identityResolver !== identityResolver) {
          throw new Error(
            `Rate-limit policy ${policy.name} must use one identity resolver per application`,
          );
        }
        return existing.handler;
      }

      let store = stores.get(policy.prefix);
      if (!store) {
        store = storeFactory(policy);
        stores.set(policy.prefix, store);
        uniqueStores.add(store);
        storePolicies.set(store, policy);
      }
      const safeStore = createSafeStore(store, policy, reportFailure);
      const handler = rateLimit({
        windowMs: policy.windowMs,
        limit: policy.limit,
        standardHeaders: "draft-8",
        legacyHeaders: false,
        identifier: "quota",
        passOnStoreError: policy.failureMode === "fail-open",
        store: safeStore,
        logger: safeLogger(),
        handler: (_request, response) => {
          response.status(429).json({ error: "Too many requests" });
        },
        keyGenerator: (request) =>
          deriveRateLimitKey(
            policy,
            options.config,
            resolvePolicyValue(request, policy, identityResolver),
          ),
      });
      limiters.set(policy.prefix, { handler, identityResolver });
      return handler;
    },
    async shutdown() {
      for (const store of uniqueStores) {
        if (!store.shutdown) continue;
        try {
          await store.shutdown.call(store);
        } catch {
          const policy = storePolicies.get(store);
          if (policy) {
            notifyStoreFailure(reportFailure, {
              policyName: policy.name,
              failureMode: policy.failureMode,
              operation: "shutdown",
            });
          }
        }
      }
      stores.clear();
      uniqueStores.clear();
      storePolicies.clear();
      limiters.clear();
    },
  };
}

export function policyByName(name: string): RateLimitPolicy {
  const policy = RATE_LIMIT_POLICY_REGISTRY.get(name);
  if (!policy) throw new Error(`Unknown rate-limit policy: ${name}`);
  return policy;
}
