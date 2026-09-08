# Load tests (k6)

Stress-test the production API with simulated read traffic. Scripts run from
your **local machine** — never on the VPS itself (that would load the VPS, not
measure the app).

## Prerequisites

Install k6 locally:

- macOS: `brew install k6`
- Linux (deb): see https://grafana.com/docs/k6/latest/set-up/install-k6/
- Or via Docker: `docker run --rm -i grafana/k6 run - <loadtest/k6/smoke.js` (env vars differ, see k6 docs)

## 1. Pick the API base URL

`BASE_URL` is the API root **including** the `/api` path prefix. Two valid
shapes:

- Direct backend origin: `https://api.yourdomain.com/api`
- Through the frontend rewrite: `https://fluentcheck.duckdns.org/backend-api`

Verify it before testing (run on your local machine, paste as one line):

```
curl -fsS https://fluentcheck.duckdns.org/backend-api/health
```

Expected output: `{"ok":true}`. If that 404s while
`https://fluentcheck.duckdns.org/backend-api/api/health` works, drop the
duplicate prefix from your `BASE_URL`.

## 2. Seed load-test accounts

Run on your local machine, paste as one line:

```
BASE_URL=https://fluentcheck.duckdns.org/backend-api node loadtest/seed-accounts.mjs
```

- Creates `ACCOUNTS` (default 50) accounts named `loadtest_001@…` with password
  `Loadtest-123!` (override with `LOADTEST_PASSWORD`).
- Idempotent: existing accounts (409) count as done.
- Self-throttled to ~27 req/min to stay under the registration rate limits
  (30/min/IP, 120/h/IP). Seeding 120+ accounts in one hour will hit the hourly
  cap and the seeder waits it out.

## 3. Run the tests

Smoke test — 1 user, 3 requests, sanity check (run on your local machine):

```
BASE_URL=https://fluentcheck.duckdns.org/backend-api k6 run loadtest/k6/smoke.js
```

Read stress — ramps to 4 concurrent users for ~5 minutes (run on your local
machine, paste as one line):

```
BASE_URL=https://fluentcheck.duckdns.org/backend-api k6 run loadtest/k6/read-stress.js
```

Accounts are matched by VU number (`VU 1` → `loadtest_001@…`), so seed at
least as many accounts as peak VUs.

Frontend stress — same ramp, but against the Next.js pages `/`, `/login`,
`/dashboard` (run on your local machine, paste as one line):

```
FRONTEND_URL=https://fluentcheck.duckdns.org k6 run loadtest/k6/frontend-stress.js
```

k6 does not execute JavaScript, so the frontend test measures HTML shell
delivery (nginx + Next.js SSR/static serving), not what a browser renders or
how fast the page becomes interactive. For browser-side rendering quality,
run Lighthouse (also from your local machine, paste as one line):

```
npx lighthouse https://fluentcheck.duckdns.org --output-path=stdout --only-categories=performance --quiet
```

## Scale stress (100+ users)

`scale-stress.js` ramps to a configurable user count (default 100) and holds
it — the same shape as `read-stress.js` but at real traffic scale. Run on your
local machine, paste as one line:

```
BASE_URL=https://fluentcheck.duckdns.org/backend-api k6 run loadtest/k6/scale-stress.js
```

Two prerequisites:

- **Raise the general API limit on the backend first** (`RATE_LIMIT_GENERAL_API_LIMIT=10000`
  in the backend env, then redeploy). All VUs come from one source IP, and the
  default 300 req/min/IP would 429 almost everything — you would be measuring
  the rate limiter, not the app. Logins need no override: the 2-minute ramp
  keeps them under the 120/min burst cap. Lower the env back to the default
  after testing.
- **Seed at least as many accounts as peak VUs**: `ACCOUNTS=100` (or
  `TARGET_VUS`) in step 2. Accounts match VU numbers, so missing accounts fail
  their VU's login.

Scale further with `TARGET_VUS=200`, `500`, `1000` — each tier needs the same
number of seeded accounts.

## Reading the results

- `http_req_duration` `p(95)` is the headline number: 95% of requests finished
  faster than this. The default threshold is 800ms.
- `checks` failing means non-200 responses. A run "fails" its thresholds when
  latency or errors breach the limits — that's the verdict, not the graph.
- `429` responses mean you hit the app's rate limiter
  (`backend/src/config/rate-limit.ts`), not a real capacity problem: the
  general API allows 300 req/min/IP, so a single-IP test tops out around
  5 req/s no matter what. Raising VUs past that measures the limiter, not the
  app — expect it and don't panic.
- `503` responses mean the rate-limit store became unavailable (fail-closed) —
  stop the test; that's real prod impact.
- Login failures on first iteration: accounts aren't seeded (run step 2) or
  `LOADTEST_PASSWORD` differs from the seeded value.

## Safety notes

- Default volumes are deliberately small (≤4 VUs, ~4 req/s). Prod is live —
  run off-peak and increase gradually if at all.
- Write-heavy paths (submission create/complete → scoring) are intentionally
  excluded: they're per-account capped (30 submissions/h) and trigger real
  scoring/payment side effects in prod.
- Only read paths are exercised: `/health`, `/auth/me`, `/submissions`.
