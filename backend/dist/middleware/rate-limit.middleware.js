import net from "node:net";
import { createHash, createHmac } from "node:crypto";
import rateLimit, { ipKeyGenerator, MemoryStore, } from "express-rate-limit";
import { RATE_LIMIT_POLICY_REGISTRY, } from "../config/rate-limit.js";
export class RateLimitStoreUnavailableError extends Error {
    policyName;
    failureMode;
    code = "RATE_LIMIT_STORE_UNAVAILABLE";
    constructor(policyName, failureMode) {
        super("Rate-limit store unavailable");
        this.policyName = policyName;
        this.failureMode = failureMode;
        this.name = "RateLimitStoreUnavailableError";
    }
}
export class RateLimitKeyUnavailableError extends Error {
    code = "RATE_LIMIT_KEY_UNAVAILABLE";
    constructor() {
        super("Rate-limit key unavailable");
        this.name = "RateLimitKeyUnavailableError";
    }
}
function notifyStoreFailure(reportFailure, event) {
    try {
        reportFailure(event);
    }
    catch {
        // Observability must never change the configured fail-open/closed behavior.
    }
}
function normalizeIdentity(value, scope) {
    const normalized = value.normalize("NFKC").trim().toLowerCase();
    if (!normalized)
        throw new RateLimitKeyUnavailableError();
    if (scope === "email" && !normalized.includes("@")) {
        throw new RateLimitKeyUnavailableError();
    }
    return normalized;
}
export function normalizeRateLimitIdentity(value, scope) {
    if (scope === "ip")
        throw new RateLimitKeyUnavailableError();
    return normalizeIdentity(value, scope);
}
export function normalizeRateLimitIp(value, ipv6Subnet) {
    if (net.isIP(value) === 0)
        throw new RateLimitKeyUnavailableError();
    return ipKeyGenerator(value, ipv6Subnet);
}
export function deriveRateLimitKey(policy, config, value) {
    const normalizedValue = policy.scope === "ip"
        ? normalizeRateLimitIp(value, config.ipv6Subnet)
        : normalizeRateLimitIdentity(value, policy.scope);
    const hmacDigest = createHmac("sha256", config.hmacSecret)
        .update(`${policy.prefix}\u0000${policy.scope}\u0000${normalizedValue}`)
        .digest("hex");
    const storageDigest = createHash("sha256").update(hmacDigest).digest("hex");
    return `${policy.prefix}:${storageDigest}`;
}
function createStoreUnavailableError(policy) {
    return new RateLimitStoreUnavailableError(policy.name, policy.failureMode);
}
function createSafeStore(store, policy, reportFailure) {
    const call = async (operation, action) => {
        try {
            return await action();
        }
        catch {
            notifyStoreFailure(reportFailure, {
                policyName: policy.name,
                failureMode: policy.failureMode,
                operation,
            });
            throw createStoreUnavailableError(policy);
        }
    };
    const safeStore = {
        localKeys: store.localKeys,
        prefix: policy.prefix,
        increment: (key) => call("increment", () => store.increment(key)),
        decrement: (key) => call("decrement", () => store.decrement(key)),
        resetKey: (key) => call("resetKey", () => store.resetKey(key)),
    };
    if (store.init) {
        safeStore.init = (options) => call("init", () => store.init.call(store, options));
    }
    if (store.get) {
        safeStore.get = (key) => call("get", () => store.get.call(store, key));
    }
    if (store.resetAll) {
        safeStore.resetAll = () => call("resetAll", () => store.resetAll.call(store));
    }
    if (store.shutdown) {
        safeStore.shutdown = () => call("shutdown", () => store.shutdown.call(store));
    }
    return safeStore;
}
function resolvePolicyValue(request, policy, identityResolver) {
    if (policy.scope === "ip") {
        if (!request.ip)
            throw new RateLimitKeyUnavailableError();
        return request.ip;
    }
    const identity = identityResolver?.(request);
    if (!identity)
        throw new RateLimitKeyUnavailableError();
    return identity;
}
function safeLogger() {
    return {
        error: () => undefined,
        warn: () => undefined,
    };
}
export function createRateLimitRuntime(options) {
    const requiresSharedStore = options.config.storeType === "shared" ||
        options.config.topology !== "single-process";
    if (requiresSharedStore && !options.storeFactory) {
        throw new Error("A shared rate-limit store factory is required for the configured topology");
    }
    const storeFactory = options.storeFactory ?? (() => new MemoryStore());
    const reportFailure = options.onStoreFailure ??
        ((event) => {
            console.warn("Rate-limit store unavailable", event);
        });
    const stores = new Map();
    const uniqueStores = new Set();
    const storePolicies = new Map();
    const limiters = new Map();
    return {
        config: options.config,
        createLimiter(policy, identityResolver, limiterOptions) {
            const existing = limiters.get(policy.prefix);
            if (existing) {
                if (existing.identityResolver !== identityResolver ||
                    existing.options?.skipSuccessfulRequests !==
                        limiterOptions?.skipSuccessfulRequests) {
                    throw new Error(`Rate-limit policy ${policy.name} must use one identity resolver and option set per application`);
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
                skipSuccessfulRequests: limiterOptions?.skipSuccessfulRequests ?? false,
                store: safeStore,
                logger: safeLogger(),
                handler: (_request, response) => {
                    response.status(429).json({ error: "Too many requests" });
                },
                keyGenerator: (request) => deriveRateLimitKey(policy, options.config, resolvePolicyValue(request, policy, identityResolver)),
            });
            limiters.set(policy.prefix, {
                handler,
                identityResolver,
                options: limiterOptions,
            });
            return handler;
        },
        async shutdown() {
            for (const store of uniqueStores) {
                if (!store.shutdown)
                    continue;
                try {
                    await store.shutdown.call(store);
                }
                catch {
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
export function policyByName(name) {
    const policy = RATE_LIMIT_POLICY_REGISTRY.get(name);
    if (!policy)
        throw new Error(`Unknown rate-limit policy: ${name}`);
    return policy;
}
