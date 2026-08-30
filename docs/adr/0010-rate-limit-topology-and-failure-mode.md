# Rate-limit topology and failure modes

Rate limiting is a route-boundary concern with named, independently keyed policies. Authentication policies are delivered first with express-rate-limit MemoryStore for one Express process; non-authentication policies reuse the same configuration and application-factory seam. Production deployments with more than one process or instance require a shared external store and must not silently fall back to MemoryStore.

## Decision

- Keep limiter policy mechanics in centralized middleware and configuration. Controllers do not know about stores, prefixes, windows, or rate-limit response headers.
- Apply the general API baseline and tighter route-specific policies at the route boundary. IP-only policies may run before body parsing; authenticated user policies run only after the active-account boundary resolves the current user.
- Derive privacy-preserving keys from normalized IPv4/IPv6 addresses, active account IDs, or normalized email values. HMAC them with a dedicated secret that is at least 32 bytes and is not the JWT secret. Never log raw identifiers or HMAC values.
- Treat `RATE_LIMIT_TRUST_PROXY` as `none` or an explicit CIDR allowlist. Reject permissive boolean trust and ambiguous production configuration. IPv6 keys use the configured subnet normalization.
- Return generic HTTP 429 JSON with `Retry-After` and draft-8 `RateLimit` headers. Legacy `X-RateLimit-*` headers remain disabled.
- Fail closed for authentication, OAuth, payment, upload, and submission mutation policies when their store is unavailable. A read-only baseline may fail open only when that behavior is explicit and observable.
- Count each request attempt against every applicable independent policy. Authentication retains its special classification rules: malformed requests consume only the applicable IP burst, classified credential failures consume account and IP failure policies, and successful login resets only the account-failure counter.
- Use the built-in MemoryStore only for the one-process phase, local development, and deterministic native tests. A production multi-process or multi-instance topology without a configured shared store fails startup.

## Policy ownership

- Issue #83 owns authentication limits, validation, keying, proxy configuration, response contracts, and the injectable store seam.
- Issue #109 owns non-authentication route composition and native HTTP coverage for payment callbacks and payment operations.
- Issue #110 owns the shared external store, topology gate, atomic cross-instance counters, and distributed failure tests.
- Issue #111 owns Answer and question-audio mutations, #112 owns Submission mutations, and #113 owns the Google OAuth route adapter.
- OAuth issue #56 owns provider configuration only. OAuth hardening in #61 consumes the central policy implementation and does not create a second limiter.

## Initial route thresholds

| Scope | Limit |
|---|---|
| General `/api` baseline | 300 per minute per normalized IP |
| Google start | 20 per 10 minutes per normalized IP |
| Google callback | 40 per 10 minutes per normalized IP |
| iPaymu callback | 300 per 5 minutes per normalized IP |
| Submission payment | 10 per hour per active user and 30 per hour per IP |
| Answer presign/confirmation | 30 per 10 minutes per active user and 60 per 10 minutes per IP |
| Question-audio presign/confirmation | 60 per hour per active user and 120 per hour per IP |
| Submission creation | 5 per hour per active user and 20 per hour per IP |
| Submission completion | 10 per 15 minutes per active user and 30 per 15 minutes per IP |

Logout, abandon, ordinary reads, admin, and examiner routes use only the general baseline in the initial phase. The iPaymu callback threshold is configurable and operationally tunable because provider retry timing is not specified numerically by the provider documentation.

## Consequences

- The first authentication implementation is intentionally single-process and its counters reset on restart.
- Route policies remain testable without private controller or ORM helpers because the application factory accepts deterministic security configuration and fresh stores.
- Multi-instance correctness is a release gate for #63, not an implicit property of #83 or #109.
- Adding a Redis or Valkey-compatible store does not change route policy code, but deployment must provide and monitor that store before enabling a multi-instance topology.
- Store outage behavior can trade availability for abuse resistance on sensitive operations; the response and telemetry contract makes that tradeoff explicit.
