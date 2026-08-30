# Google OAuth deployment guide

FluentCheck implements Google sign-in as a backend-owned OAuth 2.0
Authorization Code flow with PKCE. The browser starts the flow through the
same-origin Next.js rewrite, and the Express API exchanges the authorization
code, verifies the Google ID token, resolves the application account, and
issues the normal `jwt` cookie. Google access or ID tokens are never returned
to or stored by the browser.

## Google Cloud configuration

Create an OAuth client in Google Cloud Console with application type **Web
application**. Add exactly these values to the client configuration:

| Environment | Authorized JavaScript origin | Authorized redirect URI |
| --- | --- | --- |
| Local | `http://localhost:3000` | `http://localhost:5001/api/auth/google/callback` |
| Production | `https://<frontend-host>` | `https://<api-host>/api/auth/google/callback` |

The production placeholders must be replaced with the actual public hosts.
The redirect URI is an exact match: scheme, host, port, and the
`/api/auth/google/callback` path must agree with the backend environment. Do
not add query parameters, credentials, or an alternate path.

The frontend starts OAuth at
`/backend-api/auth/google/start?returnTo=login` or
`/backend-api/auth/google/start?returnTo=signup`. The Next.js rewrite maps
that browser path to `/api/auth/...` on the backend. Do not expose the client
secret through `NEXT_PUBLIC_*` variables.

## Backend environment

Copy `backend/.env.example` and set the existing database, JWT, storage, and
rate-limit values. Add these Google values without committing the secret:

```env
GOOGLE_CLIENT_ID=123456789.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=<server-only-client-secret>
GOOGLE_REDIRECT_URI=http://localhost:5001/api/auth/google/callback
```

`FRONTEND_URL` remains the single allowed post-auth origin. For local
development it is normally `http://localhost:3000`; production must use the
HTTPS frontend origin. Google configuration is optional outside production,
so the API can start with Google routes disabled. When any Google value is
provided, all three must be provided together. Production startup rejects
missing, partial, non-HTTPS, or incorrectly pathed Google configuration before
the database connection is opened.

## Account and session policy

1. The verified Google `sub` claim is the stable identity key. A returning
   active account is found by `googleSubject` before its email is considered.
2. A new verified email creates one `STUDENT` account with a null local
   password. Username collisions receive deterministic `_2`, `_3`, and later
   suffixes.
3. An existing local account is linked only when Google is authoritative for
   the verified email: Gmail/Googlemail addresses or a matching verified
   Workspace `hd` claim. Existing username, role, email, password, and other
   account data are preserved.
4. Other email conflicts return `account_conflict`; they never silently link.
   Deactivated accounts return `account_inactive` and are never reactivated.
5. Google uses the existing JWT payload and cookie security flags, but the
   Google-issued session is session-only: one-hour JWT expiry, no persistent
   cookie lifetime, `httpOnly`, `SameSite=Lax`, and `Secure` in production.

## Cookie and error behavior

The state, PKCE verifier, and `returnTo` value are short-lived,
`httpOnly`, `SameSite=Lax` cookies scoped to `/api/auth/google`. `returnTo`
accepts only `login` or `signup`; successful callbacks always redirect to the
fixed `/dashboard` path. Failure redirects return to the originating fixed
auth page with one of the allowlisted `google_error` values:

`cancelled`, `invalid_request`, `state_mismatch`, `provider_error`,
`invalid_identity`, `account_conflict`, or `account_inactive`.

Temporary OAuth cookies are cleared after every success and failure. Provider
error descriptions, authorization codes, ID tokens, client credentials, and
raw database errors are not copied into redirects, API responses, or logs.

## Verification

The automated suite uses a fake Google client and disposable PostgreSQL; it
does not require real Google credentials:

```bash
cd backend
npx prisma validate --schema prisma/schema.prisma
npx prisma generate --schema prisma/schema.prisma
npm run build
npx tsx --test test/googleOAuth.test.ts test/googleOAuthRateLimit.test.ts
npx tsx --test test/integration/googleAccountResolution.test.ts test/integration/googleAuthFlow.test.ts
```

For a configured environment, manually verify both `/login` and `/signup`:

- a successful consent redirects to `/dashboard`, creates or reuses the
  expected account, and keeps local roles intact;
- cancelling or denying consent returns to the originating page with safe
  copy and no provider details in the URL;
- logout clears the JWT cookie; and
- a subsequent login works without reusing the previous OAuth cookies.
