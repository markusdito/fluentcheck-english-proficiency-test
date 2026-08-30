import net from "node:net";
import tls from "node:tls";
import { URL } from "node:url";
import { env } from "./env.js";
import { assertPositiveInteger, } from "./rate-limit.js";
const INCREMENT_SCRIPT = `
local totalHits = redis.call("INCR", KEYS[1])
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  ttl = tonumber(ARGV[1])
  redis.call("PEXPIRE", KEYS[1], ttl)
end
return { totalHits, ttl }
`;
const GET_SCRIPT = `
local totalHits = redis.call("GET", KEYS[1])
if not totalHits then
  return nil
end
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  return nil
end
return { totalHits, ttl }
`;
const DECREMENT_SCRIPT = `
local totalHits = redis.call("DECR", KEYS[1])
if totalHits <= 0 then
  redis.call("DEL", KEYS[1])
end
return totalHits
`;
function genericStoreError() {
    return new Error("Rate-limit shared store command failed");
}
function replyArray(reply, label) {
    if (!Array.isArray(reply))
        throw genericStoreError();
    if (reply.length < 2)
        throw new Error(`${label} returned an incomplete response`);
    return reply;
}
function replyInteger(reply, label) {
    const value = typeof reply === "number" ? reply : Number(reply);
    if (!Number.isSafeInteger(value) || value < 0) {
        throw new Error(`${label} returned an invalid integer`);
    }
    return value;
}
function resetTimeFromTtl(ttl) {
    const milliseconds = typeof ttl === "number" ? ttl : Number(ttl);
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) {
        throw genericStoreError();
    }
    return new Date(Date.now() + milliseconds);
}
export class RedisRateLimitStore {
    client;
    windowMs;
    timeoutMs;
    closeClient;
    localKeys = false;
    prefix = "";
    constructor(client, windowMs, timeoutMs, closeClient = () => client.close()) {
        this.client = client;
        this.windowMs = windowMs;
        this.timeoutMs = timeoutMs;
        this.closeClient = closeClient;
        assertPositiveInteger(windowMs, "Rate-limit store windowMs");
        assertPositiveInteger(timeoutMs, "Rate-limit store timeoutMs");
    }
    init(options) {
        this.windowMs = options.windowMs;
    }
    async get(key) {
        const reply = await this.sendCommand([
            "EVAL",
            GET_SCRIPT,
            "1",
            key,
        ]);
        if (reply === null)
            return undefined;
        const values = replyArray(reply, "GET");
        return {
            totalHits: replyInteger(values[0], "GET totalHits"),
            resetTime: resetTimeFromTtl(values[1]),
        };
    }
    async increment(key) {
        const reply = await this.sendCommand([
            "EVAL",
            INCREMENT_SCRIPT,
            "1",
            key,
            String(this.windowMs),
        ]);
        const values = replyArray(reply, "INCREMENT");
        return {
            totalHits: replyInteger(values[0], "INCREMENT totalHits"),
            resetTime: resetTimeFromTtl(values[1]),
        };
    }
    async decrement(key) {
        await this.sendCommand(["EVAL", DECREMENT_SCRIPT, "1", key]);
    }
    async resetKey(key) {
        await this.sendCommand(["DEL", key]);
    }
    async shutdown() {
        await this.closeClient();
    }
    sendCommand(command) {
        return new Promise((resolve, reject) => {
            let settled = false;
            const controller = new AbortController();
            const timer = setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                controller.abort();
                reject(genericStoreError());
            }, this.timeoutMs);
            Promise.resolve()
                .then(() => this.client.sendCommand(command, controller.signal))
                .then((reply) => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                resolve(reply);
            }, () => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(timer);
                reject(genericStoreError());
            });
        });
    }
}
export function createRedisRateLimitStoreFactory(options) {
    assertPositiveInteger(options.timeoutMs, "Rate-limit store timeoutMs");
    const client = options.client ??
        createRedisRateLimitClient({
            url: options.url,
            timeoutMs: options.timeoutMs,
        });
    let closed = false;
    const closeClient = async () => {
        if (closed)
            return;
        closed = true;
        await client.close();
    };
    return (policy) => new RedisRateLimitStore(client, policy.windowMs, options.timeoutMs, closeClient);
}
export function createConfiguredRateLimitStoreFactory(config, sharedStoreUrl = env.RATE_LIMIT_SHARED_STORE_URL) {
    if (config.storeType === "memory")
        return undefined;
    if (!sharedStoreUrl) {
        throw new Error("RATE_LIMIT_SHARED_STORE_URL is required when RATE_LIMIT_STORE is shared");
    }
    return createRedisRateLimitStoreFactory({
        url: sharedStoreUrl,
        timeoutMs: config.storeTimeoutMs,
    });
}
function parseRedisConnectionOptions(rawUrl, timeoutMs) {
    if (!rawUrl) {
        throw new Error("RATE_LIMIT_SHARED_STORE_URL is required for a shared store");
    }
    let parsed;
    try {
        parsed = new URL(rawUrl);
    }
    catch {
        throw new Error("RATE_LIMIT_SHARED_STORE_URL must be a valid Redis URL");
    }
    if (parsed.protocol !== "redis:" && parsed.protocol !== "rediss:") {
        throw new Error("RATE_LIMIT_SHARED_STORE_URL must use redis or rediss");
    }
    if (parsed.search || parsed.hash || (parsed.pathname !== "" && parsed.pathname !== "/" && !/^\/\d+$/u.test(parsed.pathname))) {
        throw new Error("RATE_LIMIT_SHARED_STORE_URL contains unsupported Redis URL parts");
    }
    const database = parsed.pathname && parsed.pathname !== "/"
        ? Number(parsed.pathname.slice(1))
        : undefined;
    if (database !== undefined && (!Number.isSafeInteger(database) || database < 0)) {
        throw new Error("RATE_LIMIT_SHARED_STORE_URL database must be a non-negative integer");
    }
    if (parsed.username && !parsed.password) {
        throw new Error("RATE_LIMIT_SHARED_STORE_URL username requires a password");
    }
    if (!parsed.hostname) {
        throw new Error("RATE_LIMIT_SHARED_STORE_URL must include a host");
    }
    let username;
    let password;
    try {
        username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
        password = parsed.password ? decodeURIComponent(parsed.password) : undefined;
    }
    catch {
        throw new Error("RATE_LIMIT_SHARED_STORE_URL contains invalid credentials");
    }
    return {
        host: parsed.hostname.replace(/^\[|\]$/gu, ""),
        port: parsed.port ? Number(parsed.port) : 6379,
        database,
        username,
        password,
        secure: parsed.protocol === "rediss:",
        timeoutMs,
    };
}
class NativeRedisRateLimitClient {
    options;
    socket;
    connecting;
    buffer = Buffer.alloc(0);
    pending = [];
    closed = false;
    constructor(options) {
        this.options = options;
    }
    async sendCommand(command, signal) {
        if (this.closed || signal?.aborted)
            throw genericStoreError();
        await this.ensureConnected(signal);
        if (signal?.aborted)
            throw genericStoreError();
        return this.enqueue(command, signal);
    }
    async close() {
        this.closed = true;
        const socket = this.socket;
        this.failSocket();
        socket?.destroy();
        this.socket = undefined;
    }
    async ensureConnected(signal) {
        if (this.connecting) {
            await this.connecting;
            return;
        }
        if (this.socket?.writable)
            return;
        const connecting = this.openConnection(signal);
        this.connecting = connecting;
        try {
            await connecting;
        }
        finally {
            if (this.connecting === connecting)
                this.connecting = undefined;
        }
    }
    openConnection(signal) {
        const { host, port, secure, timeoutMs } = this.options;
        const socket = secure
            ? tls.connect({
                host,
                port,
                servername: host,
                rejectUnauthorized: true,
            })
            : net.createConnection({ host, port });
        this.socket = socket;
        this.buffer = Buffer.alloc(0);
        socket.setNoDelay(true);
        socket.on("data", (chunk) => this.handleData(typeof chunk === "string" ? Buffer.from(chunk) : chunk));
        socket.on("error", () => this.failSocket());
        socket.on("close", () => this.failSocket());
        return new Promise((resolve, reject) => {
            let settled = false;
            let removeAbortListener = () => undefined;
            const timer = setTimeout(() => {
                if (settled)
                    return;
                settled = true;
                removeAbortListener();
                socket.destroy();
                reject(genericStoreError());
            }, timeoutMs);
            const cleanup = () => {
                clearTimeout(timer);
                removeAbortListener();
            };
            const fail = () => {
                if (settled)
                    return;
                settled = true;
                cleanup();
                reject(genericStoreError());
            };
            const abort = () => {
                if (settled)
                    return;
                socket.destroy();
                fail();
            };
            if (signal) {
                removeAbortListener = () => signal.removeEventListener("abort", abort);
                signal.addEventListener("abort", abort, { once: true });
                if (signal.aborted) {
                    abort();
                    return;
                }
            }
            const connected = async () => {
                try {
                    if (this.options.password) {
                        const authentication = this.options.username
                            ? ["AUTH", this.options.username, this.options.password]
                            : ["AUTH", this.options.password];
                        await this.enqueue(authentication, signal);
                    }
                    if (this.options.database !== undefined) {
                        await this.enqueue(["SELECT", String(this.options.database)], signal);
                    }
                    if (!settled) {
                        settled = true;
                        cleanup();
                        resolve();
                    }
                }
                catch {
                    fail();
                    socket.destroy();
                }
            };
            socket.once(secure ? "secureConnect" : "connect", connected);
            socket.once("error", fail);
            socket.once("close", fail);
        });
    }
    enqueue(command, signal) {
        const socket = this.socket;
        if (!socket?.writable)
            return Promise.reject(genericStoreError());
        return new Promise((resolve, reject) => {
            let removeAbortListener = () => undefined;
            const timer = setTimeout(() => {
                if (pending.settled)
                    return;
                pending.settled = true;
                pending.cleanup();
                reject(genericStoreError());
                this.failSocket();
                socket.destroy();
            }, this.options.timeoutMs);
            const pending = {
                resolve,
                reject,
                settled: false,
                timer,
                cleanup: () => {
                    clearTimeout(timer);
                    removeAbortListener();
                },
            };
            const abort = () => {
                if (pending.settled)
                    return;
                pending.settled = true;
                pending.cleanup();
                reject(genericStoreError());
                this.failSocket();
                socket.destroy();
            };
            if (signal) {
                removeAbortListener = () => signal.removeEventListener("abort", abort);
                signal.addEventListener("abort", abort, { once: true });
            }
            this.pending.push(pending);
            if (signal?.aborted) {
                abort();
                return;
            }
            try {
                socket.write(encodeRedisCommand(command));
            }
            catch {
                this.failSocket();
            }
        });
    }
    handleData(chunk) {
        this.buffer = Buffer.concat([this.buffer, chunk]);
        let offset = 0;
        while (offset < this.buffer.length) {
            let parsed;
            try {
                parsed = parseRedisReply(this.buffer, offset);
            }
            catch {
                this.failSocket();
                return;
            }
            if (!parsed)
                break;
            offset = parsed.nextOffset;
            const pending = this.pending.shift();
            if (!pending || pending.settled)
                continue;
            pending.settled = true;
            pending.cleanup();
            if (parsed.error)
                pending.reject(parsed.error);
            else
                pending.resolve(parsed.value);
        }
        if (offset > 0)
            this.buffer = this.buffer.subarray(offset);
    }
    failSocket() {
        const socket = this.socket;
        this.socket = undefined;
        this.buffer = Buffer.alloc(0);
        socket?.destroy();
        const error = genericStoreError();
        while (this.pending.length > 0) {
            const pending = this.pending.shift();
            if (pending.settled)
                continue;
            pending.settled = true;
            pending.cleanup();
            pending.reject(error);
        }
    }
}
function encodeRedisCommand(command) {
    const parts = [`*${command.length}\r\n`];
    for (const argument of command) {
        const value = Buffer.from(argument, "utf8");
        parts.push(`$${value.length}\r\n`, value.toString("utf8"), "\r\n");
    }
    return Buffer.from(parts.join(""), "utf8");
}
function parseRedisReply(buffer, offset) {
    if (offset >= buffer.length)
        return undefined;
    const type = buffer[offset];
    const lineEnd = buffer.indexOf("\r\n", offset + 1);
    if (lineEnd < 0)
        return undefined;
    const line = buffer.subarray(offset + 1, lineEnd).toString("utf8");
    const bodyStart = lineEnd + 2;
    if (type === 43)
        return { nextOffset: bodyStart, value: line };
    if (type === 45) {
        return {
            nextOffset: bodyStart,
            value: null,
            error: genericStoreError(),
        };
    }
    if (type === 58) {
        const value = Number(line);
        if (!Number.isSafeInteger(value))
            throw genericStoreError();
        return { nextOffset: bodyStart, value };
    }
    if (type === 36) {
        const length = Number(line);
        if (!Number.isSafeInteger(length) || length < -1)
            throw genericStoreError();
        if (length === -1)
            return { nextOffset: bodyStart, value: null };
        const bodyEnd = bodyStart + length;
        if (buffer.length < bodyEnd + 2)
            return undefined;
        if (buffer[bodyEnd] !== 13 || buffer[bodyEnd + 1] !== 10) {
            throw genericStoreError();
        }
        return {
            nextOffset: bodyEnd + 2,
            value: buffer.subarray(bodyStart, bodyEnd).toString("utf8"),
        };
    }
    if (type === 42) {
        const count = Number(line);
        if (!Number.isSafeInteger(count) || count < -1)
            throw genericStoreError();
        if (count === -1)
            return { nextOffset: bodyStart, value: null };
        const values = [];
        let nextOffset = bodyStart;
        for (let index = 0; index < count; index += 1) {
            const item = parseRedisReply(buffer, nextOffset);
            if (!item)
                return undefined;
            nextOffset = item.nextOffset;
            if (item.error)
                return item;
            values.push(item.value);
        }
        return { nextOffset, value: values };
    }
    throw genericStoreError();
}
function createRedisRateLimitClient(options) {
    return new NativeRedisRateLimitClient(parseRedisConnectionOptions(options.url, options.timeoutMs));
}
