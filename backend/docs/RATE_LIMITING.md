# Rate-limit foundation

Issue #115 owns the shared rate-limit contract consumed by the route-specific
children of #63. `src/config/rate-limit.ts` is the single source of truth for
validated policy names, prefixes, scopes, windows, and store failure modes.
`src/middleware/rate-limit.middleware.ts` owns key derivation, store
adaptation, response headers, and failure reporting.

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
`MemoryStore` is used when no factory is supplied. A shared external-store
implementation can be injected by returning its store from the same factory;
distributed topology validation remains owned by #110.

## Configuration and privacy

- `RATE_LIMIT_HMAC_SECRET` is required, at least 32 UTF-8 bytes, and must be
  different from `JWT_SECRET`.
- `RATE_LIMIT_TRUST_PROXY` is `none` or an explicit comma-separated CIDR
  allowlist. Production requires the setting to be explicit.
- `RATE_LIMIT_IPV6_SUBNET` is an integer from 1 through 128 and defaults to
  56.
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
