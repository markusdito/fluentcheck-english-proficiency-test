# Remembered authentication persistence

**Status:** Proposed

> Ticket #73 proposed ADR-0002, but the repository already contains two
> ADR-0002 records. This decision uses the next available ADR number so that
> neither existing decision is renamed or conflated with authentication
> persistence.

## Context

FluentCheck's local login needs a deliberate choice between a browser-session
authentication cookie and a cookie that survives a browser restart. A stored
JWT must not outlive its usable token, and a longer-lived token must not bypass
the active-account authorization boundary established by #42.

Registration and Google OAuth do not currently provide an explicit persistence
choice. They therefore need a safe session-only default until a future flow
deliberately obtains that consent.

The terms used here describe general authentication technology rather than a
FluentCheck-specific domain concept, so the root domain glossary intentionally
remains unchanged.

## Decision

Authentication persistence is represented inside the authentication module as
one of two explicit modes:

- **Session:** a one-hour JWT in a browser-session cookie. The cookie has no
  `Max-Age` or `Expires` attribute.
- **Remembered:** a JWT and persistent cookie whose lifetime is derived from
  `REMEMBERED_SESSION_SECONDS`, defaulting to `604800` seconds (seven days).

The login request may provide the boolean `rememberMe`. An omitted value is
equivalent to `false`; a present non-boolean value is invalid. The request is
translated once into the explicit `session` or `remembered` mode before token
issuance. Token generation remains centralized so the JWT lifetime and cookie
attributes cannot drift between implementations.

Registration explicitly selects session mode. Future Google OAuth also selects
session mode unless that flow later adds its own explicit persistence choice.
The existing authentication cookie name, `httpOnly` setting, production
`secure` setting, `SameSite=Lax` policy, root path, and compatible logout
clearing behavior remain unchanged.

Remembered authentication remains stateless: it uses the existing signed JWT
cookie and introduces no refresh tokens, refresh-token rotation, server-side
session store, device/session management, or per-device revocation. Those
mechanisms are deferred because they would expand this focused persistence
change into a separate session-lifecycle design and operational system.

The #42 shared authentication validation and current active-account
authorization are prerequisites for remembered mode. A longer-lived JWT must
still be rejected immediately when its account is deactivated or its current
authorization changes.

## Consequences

Users on shared devices receive session-only authentication by default, while
users who explicitly opt in can remain signed in for up to seven days. The
remembered JWT and cookie expire together, avoiding a persistent cookie that
only carries an unusable token.

Because the design is stateless, an individual remembered token cannot be
revoked before expiry without a later server-side revocation or session
versioning decision. The active-account check from #42 limits deactivated or
otherwise unauthorized accounts, and the seven-day lifetime bounds the
remaining token exposure. A future refresh-token design must preserve explicit
consent and revisit rotation, revocation, device management, and operational
storage as a separate decision.

This record is future-facing until the runtime implementation is delivered;
it does not by itself change current authentication behavior or production
configuration.
