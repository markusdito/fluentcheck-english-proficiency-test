import net from "node:net";
import type { RequestHandler } from "express";

export interface ClientIpCheckLogger {
  info(message: string): void;
  warn(message: string): void;
}

export interface ClientIpCheckOptions {
  readonly trustProxy: false | readonly string[];
  readonly logger?: ClientIpCheckLogger;
  readonly now?: () => number;
  readonly warnIntervalMs?: number;
}

const WARN_INTERVAL_DEFAULT_MS = 5 * 60_000;
const IPV4_MAPPED_PREFIX = "::ffff:";

// Infrastructure ranges a real internet client can never arrive from. A
// request that resolves to one of these is reporting a proxy hop instead of
// the client, so every client behind that hop shares one rate-limit key.
const NON_PUBLIC_ADDRESSES = new net.BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
] as const) {
  NON_PUBLIC_ADDRESSES.addSubnet(address, prefix, "ipv4");
}
for (const [address, prefix] of [
  ["::", 128],
  ["::1", 128],
  ["fc00::", 7],
  ["fe80::", 10],
] as const) {
  NON_PUBLIC_ADDRESSES.addSubnet(address, prefix, "ipv6");
}

export function isPublicClientAddress(address: string | undefined): boolean {
  if (!address) return false;
  const lowered = address.toLowerCase();
  const unmapped =
    lowered.startsWith(IPV4_MAPPED_PREFIX) &&
    net.isIPv4(lowered.slice(IPV4_MAPPED_PREFIX.length))
      ? lowered.slice(IPV4_MAPPED_PREFIX.length)
      : lowered;
  const version = net.isIP(unmapped);
  if (version === 0) return false;
  return !NON_PUBLIC_ADDRESSES.check(unmapped, version === 4 ? "ipv4" : "ipv6");
}

export function describeTrustProxy(trustProxy: false | readonly string[]): string {
  return trustProxy === false ? "none" : trustProxy.join(",");
}

/**
 * Reports whether req.ip resolves to real clients behind the deployment's
 * proxies. A non-public address is printed because it is always a proxy or
 * container address; a public client address is never logged.
 */
export function createClientIpCheck(options: ClientIpCheckOptions): RequestHandler {
  const logger = options.logger ?? console;
  const now = options.now ?? Date.now;
  const warnIntervalMs = options.warnIntervalMs ?? WARN_INTERVAL_DEFAULT_MS;
  const trustProxy = describeTrustProxy(options.trustProxy);
  let passed = false;
  let lastWarnAt: number | undefined;

  return (req, _res, next) => {
    try {
      const address = req.ip;
      if (isPublicClientAddress(address)) {
        if (!passed) {
          passed = true;
          logger.info(
            `Client IP check passed: requests resolve to public client addresses (trust proxy: ${trustProxy})`,
          );
        }
      } else {
        const currentTime = now();
        if (lastWarnAt === undefined || currentTime - lastWarnAt >= warnIntervalMs) {
          lastWarnAt = currentTime;
          logger.warn(
            `Client IP check failed: a request resolved to non-public address ${address ?? "unknown"}, so per-IP rate limits are shared by every client behind it. List the proxy hop in RATE_LIMIT_TRUST_PROXY (currently ${trustProxy}) and make sure the reverse proxy appends X-Forwarded-For.`,
          );
        }
      }
    } catch {
      // Diagnostics must never affect the request.
    }
    next();
  };
}
