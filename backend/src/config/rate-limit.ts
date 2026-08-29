import net from "node:net";
import { env } from "./env.js";

export type RateLimitFailureMode = "fail-closed" | "fail-open";
export type RateLimitScope = "ip" | "account" | "email";

export interface RateLimitPolicy {
  readonly name: string;
  readonly prefix: string;
  readonly scope: RateLimitScope;
  readonly limit: number;
  readonly windowMs: number;
  readonly failureMode: RateLimitFailureMode;
}

export interface RateLimitPolicyInput {
  name: string;
  prefix: string;
  scope: RateLimitScope;
  limit: number;
  windowMs: number;
  failureMode: RateLimitFailureMode;
}

export interface RateLimitConfig {
  readonly hmacSecret: string;
  readonly trustProxy: false | readonly string[];
  readonly ipv6Subnet: number | false;
}

export interface RateLimitConfigInput {
  readonly hmacSecret?: string;
  readonly jwtSecret?: string;
  readonly trustProxy?: string;
  readonly ipv6Subnet?: number | string | false;
  readonly nodeEnv?: string;
}

const IPV6_SUBNET_DEFAULT = 56;
const RATE_LIMIT_SECRET_MIN_BYTES = 32;
const MAX_MEMORY_STORE_WINDOW_MS = 2 ** 32 - 1;

function assertPositiveInteger(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertSafeToken(value: string, label: string) {
  if (!value || value.length > 128 || /[\u0000-\u001f\u007f\s]/u.test(value)) {
    throw new Error(`${label} must be a non-empty token without whitespace`);
  }
}

function parseCidr(value: string): string {
  const separator = value.lastIndexOf("/");
  if (separator <= 0 || separator === value.length - 1) {
    throw new Error(`RATE_LIMIT_TRUST_PROXY contains an invalid CIDR: ${value}`);
  }

  const address = value.slice(0, separator).trim();
  const prefixValue = value.slice(separator + 1);
  const prefix = Number(prefixValue);
  const version = net.isIP(address);
  const maxPrefix = version === 4 ? 32 : version === 6 ? 128 : undefined;
  if (
    maxPrefix === undefined ||
    !/^\d+$/u.test(prefixValue) ||
    !Number.isInteger(prefix) ||
    prefix <= 0 ||
    prefix > maxPrefix
  ) {
    throw new Error(`RATE_LIMIT_TRUST_PROXY contains an invalid CIDR: ${value}`);
  }

  return `${address}/${prefix}`;
}

export function parseRateLimitTrustProxy(
  value: string | undefined,
  nodeEnv = process.env.NODE_ENV ?? "development",
): false | readonly string[] {
  if (value === undefined) {
    if (nodeEnv === "production") {
      throw new Error(
        "RATE_LIMIT_TRUST_PROXY must be explicitly set to none or an explicit CIDR allowlist in production",
      );
    }
    return false;
  }

  const normalized = value.trim();
  if (normalized === "none") return false;
  if (normalized === "" || normalized === "true" || normalized === "false") {
    throw new Error("RATE_LIMIT_TRUST_PROXY must be none or an explicit CIDR allowlist");
  }

  const cidrs = normalized.split(",").map((cidr) => parseCidr(cidr.trim()));
  if (cidrs.length === 0) {
    throw new Error("RATE_LIMIT_TRUST_PROXY must be none or an explicit CIDR allowlist");
  }
  return Object.freeze(cidrs);
}

function parseIpv6Subnet(value: number | string | false | undefined): number | false {
  if (value === false) return false;
  const subnetValue = value === undefined ? String(IPV6_SUBNET_DEFAULT) : String(value);
  const subnet = Number(subnetValue);
  if (!/^\d+$/u.test(subnetValue) || !Number.isInteger(subnet) || subnet < 1 || subnet > 128) {
    throw new Error("RATE_LIMIT_IPV6_SUBNET must be an integer between 1 and 128");
  }
  return subnet;
}

export function createRateLimitConfig(input: RateLimitConfigInput = {}): RateLimitConfig {
  const hmacSecret = input.hmacSecret ?? env.RATE_LIMIT_HMAC_SECRET;
  if (!hmacSecret || Buffer.byteLength(hmacSecret, "utf8") < RATE_LIMIT_SECRET_MIN_BYTES) {
    throw new Error("RATE_LIMIT_HMAC_SECRET must be at least 32 bytes");
  }

  const jwtSecret = input.jwtSecret ?? env.JWT_SECRET;
  if (jwtSecret && hmacSecret === jwtSecret) {
    throw new Error("RATE_LIMIT_HMAC_SECRET must be distinct from JWT_SECRET");
  }

  const nodeEnv = input.nodeEnv ?? env.NODE_ENV;
  return Object.freeze({
    hmacSecret,
    trustProxy: parseRateLimitTrustProxy(
      input.trustProxy ?? env.RATE_LIMIT_TRUST_PROXY,
      nodeEnv,
    ),
    ipv6Subnet: parseIpv6Subnet(
      input.ipv6Subnet ?? env.RATE_LIMIT_IPV6_SUBNET,
    ),
  });
}

export function defineRateLimitPolicy(input: RateLimitPolicyInput): RateLimitPolicy {
  assertSafeToken(input.name, "Rate-limit policy name");
  assertSafeToken(input.prefix, "Rate-limit policy prefix");
  assertPositiveInteger(input.limit, "Rate-limit policy limit");
  assertPositiveInteger(input.windowMs, "Rate-limit policy windowMs");
  if (input.windowMs > MAX_MEMORY_STORE_WINDOW_MS) {
    throw new Error(
      `Rate-limit policy windowMs must not exceed ${MAX_MEMORY_STORE_WINDOW_MS} milliseconds`,
    );
  }
  if (!["ip", "account", "email"].includes(input.scope)) {
    throw new Error(`Unsupported rate-limit policy scope: ${input.scope}`);
  }
  if (![
    "fail-closed",
    "fail-open",
  ].includes(input.failureMode)) {
    throw new Error(`Unsupported rate-limit failure mode: ${input.failureMode}`);
  }

  return Object.freeze({ ...input });
}

export function createRateLimitPolicyRegistry(
  policies: readonly RateLimitPolicy[],
): ReadonlyMap<string, RateLimitPolicy> {
  const registry = new Map<string, RateLimitPolicy>();
  const prefixes = new Set<string>();
  for (const policy of policies) {
    if (registry.has(policy.name) || prefixes.has(policy.prefix)) {
      throw new Error("Rate-limit policies must have unique policy names and prefixes");
    }
    registry.set(policy.name, policy);
    prefixes.add(policy.prefix);
  }
  return registry;
}

const policyDefinitions = {
  generalApi: defineRateLimitPolicy({
    name: "general-api",
    prefix: "fc:rate-limit:general-api",
    scope: "ip",
    limit: 300,
    windowMs: 60 * 1_000,
    failureMode: "fail-open",
  }),
  loginBurst: defineRateLimitPolicy({
    name: "auth-login-burst",
    prefix: "fc:rate-limit:auth-login-burst",
    scope: "ip",
    limit: 120,
    windowMs: 60 * 1_000,
    failureMode: "fail-closed",
  }),
  loginFailureAccount: defineRateLimitPolicy({
    name: "auth-login-failure-account",
    prefix: "fc:rate-limit:auth-login-failure-account",
    scope: "account",
    limit: 10,
    windowMs: 15 * 60 * 1_000,
    failureMode: "fail-closed",
  }),
  loginFailureIp: defineRateLimitPolicy({
    name: "auth-login-failure-ip",
    prefix: "fc:rate-limit:auth-login-failure-ip",
    scope: "ip",
    limit: 100,
    windowMs: 15 * 60 * 1_000,
    failureMode: "fail-closed",
  }),
  registrationBurst: defineRateLimitPolicy({
    name: "auth-registration-burst",
    prefix: "fc:rate-limit:auth-registration-burst",
    scope: "ip",
    limit: 30,
    windowMs: 60 * 1_000,
    failureMode: "fail-closed",
  }),
  registrationIp: defineRateLimitPolicy({
    name: "auth-registration-ip",
    prefix: "fc:rate-limit:auth-registration-ip",
    scope: "ip",
    limit: 120,
    windowMs: 60 * 60 * 1_000,
    failureMode: "fail-closed",
  }),
  registrationEmail: defineRateLimitPolicy({
    name: "auth-registration-email",
    prefix: "fc:rate-limit:auth-registration-email",
    scope: "email",
    limit: 5,
    windowMs: 60 * 60 * 1_000,
    failureMode: "fail-closed",
  }),
  googleStart: defineRateLimitPolicy({
    name: "oauth-google-start",
    prefix: "fc:rate-limit:oauth-google-start",
    scope: "ip",
    limit: 20,
    windowMs: 10 * 60 * 1_000,
    failureMode: "fail-closed",
  }),
  googleCallback: defineRateLimitPolicy({
    name: "oauth-google-callback",
    prefix: "fc:rate-limit:oauth-google-callback",
    scope: "ip",
    limit: 40,
    windowMs: 10 * 60 * 1_000,
    failureMode: "fail-closed",
  }),
  ipaymuCallback: defineRateLimitPolicy({
    name: "payment-ipaymu-callback",
    prefix: "fc:rate-limit:payment-ipaymu-callback",
    scope: "ip",
    limit: 300,
    windowMs: 5 * 60 * 1_000,
    failureMode: "fail-closed",
  }),
  submissionPaymentAccount: defineRateLimitPolicy({
    name: "submission-payment-account",
    prefix: "fc:rate-limit:submission-payment-account",
    scope: "account",
    limit: 10,
    windowMs: 60 * 60 * 1_000,
    failureMode: "fail-closed",
  }),
  submissionPaymentIp: defineRateLimitPolicy({
    name: "submission-payment-ip",
    prefix: "fc:rate-limit:submission-payment-ip",
    scope: "ip",
    limit: 30,
    windowMs: 60 * 60 * 1_000,
    failureMode: "fail-closed",
  }),
  answerStorageAccount: defineRateLimitPolicy({
    name: "answer-storage-account",
    prefix: "fc:rate-limit:answer-storage-account",
    scope: "account",
    limit: 30,
    windowMs: 10 * 60 * 1_000,
    failureMode: "fail-closed",
  }),
  answerStorageIp: defineRateLimitPolicy({
    name: "answer-storage-ip",
    prefix: "fc:rate-limit:answer-storage-ip",
    scope: "ip",
    limit: 60,
    windowMs: 10 * 60 * 1_000,
    failureMode: "fail-closed",
  }),
  questionAudioStorageAccount: defineRateLimitPolicy({
    name: "question-audio-storage-account",
    prefix: "fc:rate-limit:question-audio-storage-account",
    scope: "account",
    limit: 60,
    windowMs: 60 * 60 * 1_000,
    failureMode: "fail-closed",
  }),
  questionAudioStorageIp: defineRateLimitPolicy({
    name: "question-audio-storage-ip",
    prefix: "fc:rate-limit:question-audio-storage-ip",
    scope: "ip",
    limit: 120,
    windowMs: 60 * 60 * 1_000,
    failureMode: "fail-closed",
  }),
  submissionCreationAccount: defineRateLimitPolicy({
    name: "submission-creation-account",
    prefix: "fc:rate-limit:submission-creation-account",
    scope: "account",
    limit: 5,
    windowMs: 60 * 60 * 1_000,
    failureMode: "fail-closed",
  }),
  submissionCreationIp: defineRateLimitPolicy({
    name: "submission-creation-ip",
    prefix: "fc:rate-limit:submission-creation-ip",
    scope: "ip",
    limit: 20,
    windowMs: 60 * 60 * 1_000,
    failureMode: "fail-closed",
  }),
  submissionCompletionAccount: defineRateLimitPolicy({
    name: "submission-completion-account",
    prefix: "fc:rate-limit:submission-completion-account",
    scope: "account",
    limit: 10,
    windowMs: 15 * 60 * 1_000,
    failureMode: "fail-closed",
  }),
  submissionCompletionIp: defineRateLimitPolicy({
    name: "submission-completion-ip",
    prefix: "fc:rate-limit:submission-completion-ip",
    scope: "ip",
    limit: 30,
    windowMs: 15 * 60 * 1_000,
    failureMode: "fail-closed",
  }),
} as const;

export const RATE_LIMIT_POLICIES = Object.freeze(policyDefinitions);

export const RATE_LIMIT_POLICY_REGISTRY = createRateLimitPolicyRegistry(
  Object.values(RATE_LIMIT_POLICIES),
);
