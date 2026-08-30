# Google Authentication Plan

Status: Implemented — the runtime contract is implemented in `backend/` and
the deployment details are maintained in
[`backend/docs/GOOGLE_AUTH.md`](../backend/docs/GOOGLE_AUTH.md).

## Objective

Add a secure “Continue with Google” flow to both the sign-in and sign-up screens while preserving the existing email/password authentication flow, JWT session cookie, user roles, and dashboard redirect behavior.

## Decisions

- Use a backend-owned OAuth 2.0 Authorization Code flow with PKCE.
- Keep Google client credentials and token verification on the backend.
- Use Google’s stable `sub` claim as the external identity key; do not use email as the primary Google identity key.
- Reuse the application’s existing JWT cookie and session semantics after Google authentication succeeds.
- Redirect successful Google authentication to `/dashboard`.
- Redirect failures to the originating `/login` or `/signup` page with a short, allowlisted error code rather than provider details or tokens.
- Do not add a second frontend authentication SDK or store Google tokens in browser storage.

## Implementation steps

### 1. Inspect and protect existing work

- Confirm the current authentication routes, JWT cookie settings, Prisma user model, and login/signup UI.
- Keep unrelated working-tree changes intact, including the existing landing-page slideshow work.
- Check whether repository-specific generated-file or migration instructions apply before editing Prisma artifacts.

### 2. Backend dependencies and configuration

- Add `google-auth-library` for authorization-code exchange and ID-token verification.
- Add `express-rate-limit` for public OAuth start/callback throttling.
- Add these backend environment variables without logging their values:

  - `GOOGLE_CLIENT_ID`
  - `GOOGLE_CLIENT_SECRET`
  - `GOOGLE_REDIRECT_URI`

- Use the existing `FRONTEND_URL` for the post-auth redirect and CORS origin.
- Document the required Google Cloud setup: a Web application OAuth client, authorized JavaScript origins, and the exact authorized redirect URI.

### 3. Database and account model

- Change `User.password` to nullable so Google-only accounts do not receive a fake password.
- Add nullable, unique `User.googleSubject` for the Google `sub` claim.
- Create the Prisma migration and regenerate the Prisma client using Prisma tooling; do not hand-edit generated client files.
- Preserve existing users and local credentials.

### 4. OAuth start and callback endpoints

Add public routes under the existing auth router:

- `GET /api/auth/google/start?returnTo=login|signup`
- `GET /api/auth/google/callback`

The start route will:

- Validate `returnTo` against the two allowed values.
- Generate a cryptographically random state value and PKCE verifier/challenge.
- Store state, verifier, and return location in short-lived, `httpOnly`, `secure`-in-production, `SameSite=Lax` cookies scoped to the OAuth path.
- Redirect to Google with `openid email profile` scopes and PKCE parameters.

The callback route will:

- Require a valid `code`, state cookie, verifier cookie, and saved return location.
- Compare state values using a timing-safe comparison.
- Exchange the authorization code with Google using the PKCE verifier.
- Verify the returned ID token’s audience, issuer, expiration, subject, email, and `email_verified` claims.
- Find or create/link the application user, issue the existing JWT cookie, clear all temporary OAuth cookies, and redirect to `/dashboard`.
- Clear temporary cookies and redirect to an allowlisted auth page on failure.
- Never place authorization codes, ID tokens, provider error descriptions, or secrets in logs or query strings.

### 5. Account-linking policy

- If `googleSubject` already exists, authenticate that user.
- If no matching subject exists and the verified Google email is new, create a student account.
- Derive a normalized, unique username from the Google name or email local-part, adding a deterministic suffix when needed.
- If the email belongs to an existing local account, link only when Google is authoritative for that email (`@gmail.com` or a verified Google Workspace hosted domain).
- Otherwise return a safe account-conflict error and require the user to sign in locally before linking can be added.
- Preserve an existing user’s role, username, email, and other account data when linking.
- Treat local accounts with a nullable password as invalid for password login and return the same generic invalid-credentials response.
- Handle unique-constraint races without exposing database details.

### 6. Frontend sign-in and sign-up UI

- Add a reusable Google button component with the existing auth-page styling and an inline Google “G” mark.
- Place it on both login and signup forms above the email/password fields with a clear divider.
- Link to the backend start endpoint with the correct `returnTo` value.
- Read only the allowlisted `google_error` codes after a failed callback and show friendly copy.
- Remove the error query parameter from the visible URL after reading it.
- Keep existing form validation, loading states, error handling, and post-login behavior unchanged.

### 7. Security hardening

- Keep OAuth state and PKCE verifier server-managed in `httpOnly` cookies.
- Atomically consume the persisted OAuth state before exchanging a callback code.
- Restrict redirect destinations to the known frontend origin and fixed auth/dashboard paths; do not accept arbitrary `returnTo` URLs.
- Apply rate limits to OAuth start and callback routes.
- Reuse the existing JWT cookie security flags and verify that production uses HTTPS and a correctly scoped cookie domain.
- Validate the configured redirect URI and Google client ID at startup in production.
- Avoid account takeover through unsafe email auto-linking.
- Review logs and error responses for token, code, email, and secret leakage.

### 8. Verification

- Run Prisma validation, migration/generation checks, backend type-check/build, and frontend lint/type-check/build where supported.
- Add focused tests for:

  - Invalid or mismatched OAuth state.
  - Missing PKCE verifier or authorization code.
  - Invalid audience, issuer, expiration, subject, or unverified email.
  - New Google account creation.
  - Existing Google identity login.
  - Safe and unsafe email-linking cases.
  - Username collision handling.
  - Allowlisted error redirects and temporary-cookie cleanup.

- Perform a manual browser smoke test for both `/login` and `/signup`, including a cancelled Google consent screen and a successful dashboard redirect.
- Run a secret scan and dependency audit, then review the final diff for unrelated changes.

## Expected files

- `backend/package.json` and `backend/package-lock.json`
- `backend/src/config/env.ts`
- `backend/src/config/server.ts` or the existing server entrypoint
- `backend/src/controllers/auth.controller.ts`
- `backend/src/routes/auth.routes.ts`
- `backend/src/service/auth.service.ts` and/or a new Google auth service
- New OAuth utility/middleware files under `backend/src/`
- `backend/prisma/schema.prisma`
- New Prisma migration under `backend/prisma/migrations/`
- Re-generated Prisma client under `backend/src/generated/`
- `frontend/lib/auth.ts` or the existing auth API helper
- New reusable Google auth button component under `frontend/components/auth/`
- Existing login and signup pages/forms
- This document: `docs/google-auth-plan.md`

## Configuration checklist

Before deploying, configure the same redirect URI in both the backend environment and Google Cloud Console. For local development, use the project’s actual backend origin and callback path, for example:

```text
http://localhost:5001/api/auth/google/callback
```

For production, use the HTTPS API callback URL and add the production frontend origin to the OAuth client’s authorized origins. Keep `GOOGLE_CLIENT_SECRET` server-only.

## References

- [Google: Verify the Google ID token](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token)
- [Google: Configure an OAuth client ID](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid)
- [Google: OpenID Connect](https://developers.google.com/identity/openid-connect/openid-connect)
- [google-auth-library-nodejs](https://github.com/googleapis/google-auth-library-nodejs)

## Implementation record

- Google Auth issues 1/7 through 6/7 are implemented across the backend
  configuration, Prisma `googleSubject` identity, PKCE handlers, account
  resolution policy, central rate limits, and auth-page UI.
- Automated coverage uses fake provider clients and disposable PostgreSQL;
  real Google credentials are not required for the test suite.
- Deployment configuration, exact callback/origin values, cookie policy,
  account-linking policy, and manual smoke steps live in
  [`backend/docs/GOOGLE_AUTH.md`](../backend/docs/GOOGLE_AUTH.md).
