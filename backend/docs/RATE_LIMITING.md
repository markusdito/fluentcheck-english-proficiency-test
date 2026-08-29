# Rate-limit foundation and topology

Issue #115 owns the shared rate-limit contract consumed by the route-specific
children of #63. `src/config/rate-limit.ts` is the single source of truth for
validated policy names, prefixes, scopes, windows, store failure modes, and
deployment topology. `src/middleware/rate-limit.middleware.ts` owns key
derivation, store adaptation, response headers, and failure reporting.

## Application seam

The application factory accepts one `rateLimit` dependency:

```ts
const app = createApp({
  rateLimit: {
    config: createRateLimitConfig(),
    storeFactory: (policy) => createStoreForPolicy(policy),
  },
});

const limiter = app.locals.rateLimit.createLimiter(
  RATE_LIMIT_POLICIES.loginBurst,
);
```

The factory is called once per policy within an application. A default
`MemoryStore` is used only for the `single-process` topology when no factory is
supplied. A shared external-store implementation is injected by returning its
store from the same factory; route policies do not know which store is in use.

## Deployment contract

`RATE_LIMIT_TOPOLOGY` is explicit in production and accepts:

- `single-process`: `MemoryStore` is allowed and counters reset on process
  restart. This mode is suitable for local development and deterministic
  native tests as well as an intentionally one-process deployment.
- `multi-process` or `multi-instance`: `RATE_LIMIT_STORE=shared` and an
  injected shared-store factory are required. The application never silently
  falls back to `MemoryStore`.

The production entry point creates the shared factory from
`RATE_LIMIT_SHARED_STORE_URL`. The URL must use `redis://` or `rediss://` and
point to an existing Redis- or Valkey-compatible service; provisioning that
service is outside the application. A missing URL, malformed URL, unsupported
scheme, or missing factory fails startup before the database connection is
opened.

The adapter speaks the Redis wire protocol directly and uses atomic Lua
commands. Incrementing a key performs `INCR` and establishes its `PEXPIRE` in
one server-side operation; reads return the same reset window, and decrement,
reset, and expiry are bounded by the configured store timeout. Separate policy
prefixes remain separate keys even when all policies share one Redis client.

`RATE_LIMIT_STORE_TIMEOUT_MS` defaults to 1000 ms and is bounded to 60 seconds.
An outage or timeout is reported through the safe failure reporter without
including the endpoint, credentials, raw identifier, IP address, query data,
JWT, cookie, secret, or HMAC material. Sensitive policies fail closed with a
generic 503. A read-only baseline may explicitly use `fail-open`, preserving
the existing observable event contract.

Operational monitoring should count the safe failure events by policy,
failure mode, and operation; alert on sustained fail-closed events and Redis
latency or availability degradation; and verify that shared-store keyspace and
expiry behavior remain bounded. The event payload intentionally contains no
request identity or provider error text.

## Configuration and privacy

- `RATE_LIMIT_HMAC_SECRET` is required, at least 32 UTF-8 bytes, and must be
  different from `JWT_SECRET`.
- `RATE_LIMIT_TRUST_PROXY` is `none` or an explicit comma-separated CIDR
  allowlist. Production requires the setting to be explicit.
- `RATE_LIMIT_IPV6_SUBNET` is an integer from 1 through 128 and defaults to
  56.
- `RATE_LIMIT_TOPOLOGY` is required in production and must be one of
  `single-process`, `multi-process`, or `multi-instance`.
- `RATE_LIMIT_STORE` is `memory` or `shared`; distributed topologies require
  `shared`.
- `RATE_LIMIT_STORE_TIMEOUT_MS` is a positive integer no greater than 60000.
- `RATE_LIMIT_SHARED_STORE_URL` is required for the configured production
  shared store.
- IP addresses and account/email identities are normalized before being HMAC'd
  with the dedicated secret; the exposed store key is a second one-way digest
  of that HMAC. Raw identifiers, intermediate HMACs, and secrets are not
  included in failure telemetry.

Every limiter uses draft-8 `RateLimit` headers, `Retry-After`, and no legacy
`X-RateLimit-*` headers. A blocked request receives `{ "error": "Too many
requests" }` with status 429.

Sensitive policies fail closed with a generic 503 when their store is
unavailable. A read-only policy may explicitly use `fail-open`; the shared
failure reporter makes that decision observable without exposing store error
details.

## Verification

`test/rateLimitStore.test.ts` verifies the public store and application seams:

- two application instances share counters and draft-8 response headers;
- policy keys are isolated, concurrent increments are atomic, and expiry/reset
  behavior is bounded without fixed sleeps;
- malformed topology, store, URL, and timeout configuration is rejected;
- missing shared-store configuration is rejected instead of falling back;
- a store outage or black-hole timeout returns the stable generic 503 contract
  without exposing client error details.
