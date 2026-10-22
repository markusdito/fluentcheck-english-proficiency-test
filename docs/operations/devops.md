# DevOps guide

Start here for production operations. It covers how to get onto the VPS,
where everything lives (on the box, in this repo, and in external services),
how a commit reaches production, and the commands you'll need day to day.

For the one-time VPS bootstrap (installing Docker, creating the deploy key,
adding GitHub secrets), see [`ops/deploy/README.md`](../../ops/deploy/README.md).

> **This repository is public.** Never commit the VPS IP or hostname, SSH
> user, SSH port, private keys, or anything from `.env` / `backend.env`. This
> guide uses `<VPS_HOST>`, `<VPS_USER>`, `<VPS_PORT>` and `<VPS_DEPLOY_DIR>`
> as placeholders. The real values are the GitHub Actions secrets with the
> same names. GitHub never shows a secret again after it is saved, so also
> keep a copy in a private place your team shares, such as a password manager.

## Production at a glance

```text
                 https://fluentcheck.duckdns.org
                              |
                              v
  +-------------------------- VPS ---------------------------+
  |  nginx (TLS, public :443)                                |
  |     |                                                    |
  |     v                                                    |
  |  127.0.0.1:3000  frontend container (Next.js standalone) |
  |     |  /backend-api/* -> rewrite -> backend:5001/api/*   |
  |     v       (compose network 172.31.250.0/24)            |
  |  127.0.0.1:5001  backend container (Express + Prisma)    |
  +----------------------------------------------------------+
        |              |               |              |
        v              v               v              v
   Managed        Cloudflare R2   Grafana Cloud   iPaymu / Google
   PostgreSQL     (media)         Loki            OAuth
```

- The public domain is a DuckDNS name, `fluentcheck.duckdns.org`, pointed at
  the VPS IP.
- The VPS runs exactly two containers: `backend` and `frontend`, in the
  Docker Compose project `fluentcheck`. The database is **not** on the VPS.
  It is an external managed PostgreSQL that the backend reaches through
  `DATABASE_URL`.
- Both containers bind to `127.0.0.1` only. The host's nginx terminates TLS
  and is the only public listener. Docker never handles TLS or domains.
- The frontend's `/backend-api` rewrite goes straight to `http://backend:5001`
  on the compose network, so the backend sees one proxy hop. The compose file
  pins that network to `172.31.250.0/24` and sets the backend's
  `RATE_LIMIT_TRUST_PROXY` to the same range. That range covers the frontend
  container and the gateway that carries nginx traffic to `127.0.0.1:5001`.
  nginx must send `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;`
  on every location, or all users share one IP and one rate-limit bucket.
- Images come from GitHub Container Registry:
  `ghcr.io/markusdito/fluentcheck-backend` and
  `ghcr.io/markusdito/fluentcheck-frontend`.

## Accessing the VPS

### Get access

1. Generate a personal key if you don't have one:
   `ssh-keygen -t ed25519 -C "<your-name>@fluentcheck"`.
2. Send **only the public half** (`~/.ssh/id_ed25519.pub`) to someone who
   already has access. They append it to `~/.ssh/authorized_keys` of
   `<VPS_USER>` on the VPS.
3. Get the real host, user, port and deploy directory from your team's
   private store, not from this repo.

Use your own personal key. Don't use the CI deploy key (`VPS_SSH_KEY`) for
interactive logins: that key belongs to GitHub Actions. With personal keys,
each person's access can be revoked separately by removing one line from
`authorized_keys`.

### Connect

Add an alias to `~/.ssh/config` on your machine:

```sshconfig
Host fluentcheck-vps
    HostName <VPS_HOST>
    User <VPS_USER>
    Port <VPS_PORT>
    IdentityFile ~/.ssh/id_ed25519
    IdentitiesOnly yes
```

Then:

```sh
ssh fluentcheck-vps
cd <VPS_DEPLOY_DIR>        # e.g. /opt/fluentcheck
```

`<VPS_USER>` belongs to the `docker` group, so `docker` commands don't need
`sudo`. Host-level changes such as nginx, TLS, packages or the firewall do
need `sudo`.

### Reach the internal ports from your machine

The containers listen only on the VPS loopback. To call them directly, for
example to check the backend without going through nginx, open a tunnel:

```sh
ssh -N -L 5001:127.0.0.1:5001 -L 3001:127.0.0.1:3000 fluentcheck-vps
# in another terminal
curl -fsS http://localhost:5001/api/health     # -> {"ok":true}
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:3001/login
```

(Local port `3001` avoids clashing with a local `next dev` on `3000`.)

## Important folders and files

### On the VPS

| Path | What it is | Who writes it |
| --- | --- | --- |
| `<VPS_DEPLOY_DIR>/` | The deploy directory. Run every `docker compose` command from here. | — |
| `<VPS_DEPLOY_DIR>/docker-compose.prod.yml` | Production topology. A copy of `ops/compose/docker-compose.prod.yml`. | **CI, every deploy.** Local edits are overwritten. Change it in the repo. |
| `<VPS_DEPLOY_DIR>/deploy.sh` | Deploy, migrate and rollback script. A copy of `ops/deploy/deploy.sh`. | **CI, every deploy.** Same as above. |
| `<VPS_DEPLOY_DIR>/.env` | Compose variables: `BACKEND_IMAGE`, `FRONTEND_IMAGE`. The image tags show which commit is live. A leftover `BACKEND_URL` is ignored; the compose file sets it to `http://backend:5001`. | `deploy.sh` (image tags). |
| `<VPS_DEPLOY_DIR>/backend.env` | **All backend secrets and runtime config**: `DATABASE_URL`, `JWT_SECRET`, `R2_*`, `GOOGLE_*`, `IPAYMU_*`, `RATE_LIMIT_*`, `OBSERVABILITY_*`, `FRONTEND_URL`. `RATE_LIMIT_TRUST_PROXY` here is overridden by the compose file. | Humans only. CI never touches it. |
| `<VPS_DEPLOY_DIR>/.env.previous` | The pre-deploy `.env`. It only exists during a deploy, or if a rollback was interrupted. | `deploy.sh` |
| `~<VPS_USER>/.ssh/authorized_keys` | The CI deploy key plus every human's public key. | Humans |
| `~<VPS_USER>/.docker/config.json` | The `ghcr.io` login, needed only while the packages are private. | `docker login` |
| `/var/lib/docker/` | Docker's images, containers and logs. This grows on every deploy (see [Disk space](#disk-space)). | Docker |

The repo doesn't manage the host-level setup below. Check these paths on the
box before relying on them, and record any differences here:

| Path (typical) | What it is |
| --- | --- |
| `/etc/nginx/sites-available/`, `/etc/nginx/sites-enabled/` (or `/etc/nginx/conf.d/`) | The reverse-proxy site config that forwards to `127.0.0.1:3000` / `127.0.0.1:5001`. |
| `/var/log/nginx/access.log`, `/var/log/nginx/error.log` | Proxy logs. Check these first when the site returns 502/504. |
| `/etc/letsencrypt/live/fluentcheck.duckdns.org/` | TLS certificate, if it was issued with certbot. |

### Back up `.env` and `backend.env`

These two files are the only state on the VPS that you can't rebuild from
git. Keep an encrypted copy off the box. If the VPS is lost, a new box only
needs Docker, these two files and the steps in `ops/deploy/README.md`.

### In this repository

| Path | Purpose |
| --- | --- |
| `ops/compose/docker-compose.prod.yml` | Production Compose file: services, ports, healthchecks, restart policy. |
| `ops/deploy/deploy.sh` | Runs on the VPS: pins the image tags, pulls, migrates, swaps the containers behind healthchecks, and rolls back on failure. |
| `ops/deploy/README.md` | One-time VPS setup and the GitHub secrets. |
| `ops/grafana/` | Loki datasource, dashboard and alert rules for the assessment-initialization telemetry. |
| `.github/workflows/` | CI and CD pipelines (see below). |
| `backend/Dockerfile`, `frontend/Dockerfile` | Production images. |
| `frontend/docker/entrypoint.mjs` | Patches `BACKEND_URL` into the Next.js rewrites when the container starts. |
| `backend/prisma/migrations/` | Schema migrations. Applied automatically on every deploy. |
| `backend/scripts/` | Operational CLIs: preflights, prompt-media reconcile and cleanup, synthetic alert. |
| `docs/runbooks/`, `docs/operations/` | Incident and operational procedures. |
| `loadtest/` | k6 load tests. Run these from your own machine, never on the VPS. |

## How a change reaches production

```text
feature branch --PR--> dev --PR--> main --push--> Publish images --success--> Deploy to VPS
```

| Workflow | Trigger | What it does |
| --- | --- | --- |
| `ci.yml` (**CI**) | Every push and PR | Backend: Prisma validate/generate, build, critical suite, full tests. Frontend: lint, critical suite, tests, build. |
| `docker-build-backend.yml` / `docker-build-frontend.yml` | PRs that touch `backend/**` / `frontend/**` | Builds the image and runs a container smoke test. |
| `publish.yml` (**Publish images**) | Push to `main`, or manual dispatch | Builds **both** images and pushes them to ghcr with three tags: `<package.json version>`, `sha-<short>` and `latest`. |
| `deploy.yml` (**Deploy to VPS**) | A successful publish on `main`, or manual dispatch | Copies the Compose file and `deploy.sh` to the VPS over SCP, then runs `deploy.sh` over SSH with that commit's `sha-<short>` tags. |

What `deploy.sh` does, in order:

1. Copies `.env` to `.env.previous`.
2. Rewrites `BACKEND_IMAGE` / `FRONTEND_IMAGE` in `.env` to the new
   `sha-<short>` tags.
3. Runs `docker compose pull`.
4. Runs `prisma migrate deploy` in a throwaway backend container.
5. Runs `docker compose up -d --wait` (120s timeout), which gates on the
   healthchecks: backend `GET /api/health`, frontend `GET /login`.
6. Calls `curl http://127.0.0.1:5001/api/health`.
7. If any step fails, it restores `.env.previous`, brings the old containers
   back up, and exits non-zero. The Actions run goes red.

GitHub Actions secrets (Settings → Secrets and variables → Actions):
`VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_PORT`, `VPS_DEPLOY_DIR`.

## Day-to-day commands

Run these on the VPS from `<VPS_DEPLOY_DIR>`. The Compose file isn't named
`compose.yaml`, so a bare `docker compose ps` won't find it. Define an alias
first:

```sh
alias dc='docker compose -f docker-compose.prod.yml --env-file .env'
```

| Task | Command |
| --- | --- |
| What is running, and which commit | `dc ps` · `grep _IMAGE .env` |
| Follow the backend logs | `dc logs -f --tail=200 backend` |
| Follow the frontend logs | `dc logs -f --tail=200 frontend` |
| Health check | `curl -fsS http://127.0.0.1:5001/api/health` |
| Public health check (from anywhere) | `curl -fsS https://fluentcheck.duckdns.org/backend-api/health` |
| Restart one service | `dc restart backend` |
| Apply an edited `backend.env` | `dc up -d --force-recreate --wait backend` |
| Shell inside the backend container | `dc exec backend sh` |
| Prisma migration status | `dc run --rm backend npx prisma migrate status` |
| Container resource usage | `docker stats --no-stream` |

### Deploying and redeploying

- **Normal deploy**: merge to `main`. Nothing else is needed.
- **Redeploy without rebuilding**: Actions → *Deploy to VPS* → *Run workflow*
  on `main`. This redeploys the latest `main` commit's `sha-` tags, which must
  already be published.
- **Republish one image**: Actions → *Publish images* → *Run workflow*, and
  tick the backend and/or frontend boxes.

### Rolling back

Automatic rollback only covers a deploy whose containers never become
healthy. To go back to an older, known-good commit by hand:

```sh
./deploy.sh . \
  ghcr.io/markusdito/fluentcheck-backend:sha-<old> \
  ghcr.io/markusdito/fluentcheck-frontend:sha-<old>
```

This runs the same health-gated swap, with automatic rollback if it fails.

> **Migrations are forward-only.** Rolling back the images does **not** roll
> back the database schema. If the bad release included a migration, the old
> image runs against the new schema. Before rolling back across a migration,
> check that it was additive. If it wasn't, fix forward instead.

### Changing a secret or setting

1. `cp backend.env backend.env.bak-$(date +%F)` so you can undo the change.
2. Edit `backend.env`.
3. `dc up -d --force-recreate --wait backend`.
4. Watch `dc logs --tail=100 backend`. The backend validates its config at
   startup and refuses to boot when something is wrong. This catches
   incomplete Google OAuth settings, a `RATE_LIMIT_HMAC_SECRET` that reuses
   `JWT_SECRET`, a missing `RATE_LIMIT_TOPOLOGY`, or missing `OBSERVABILITY_*`
   values in production.
5. Delete the `.bak` file once the backend is healthy. It holds secrets.

`BACKEND_URL` and `RATE_LIMIT_TRUST_PROXY` are not settings here: the compose
file fixes them to the internal backend and the pinned network subnet. Change
them in the repo, and change the subnet and the trust value together.

### Disk space

Every deploy pulls two new images and keeps the old ones. Check usage and
prune now and then:

```sh
df -h /
docker system df
docker image prune -a --filter "until=168h"   # images unused for 7+ days
```

Pruned images are still on ghcr, so a rollback can pull them again.

## Running operational scripts

The production backend image contains only the compiled server: no
`backend/scripts/` and no `tsx`. So run the operational CLIs from a checkout
of the **deployed commit**, not from inside the container:

```sh
git checkout <deployed sha>
cd backend && npm ci
# Load the production values temporarily (DATABASE_URL, R2_*, ...) and
# unset them when you're done. Don't leave a production backend/.env behind.
npm run reconcile:prompt-media -- --json
```

| Script | Purpose | Doc |
| --- | --- | --- |
| `npm run preflight:*` | Data checks to run before specific migrations or cutovers | `docs/runbooks/submission-manifest-cutover.md` |
| `npm run reconcile:prompt-media` | Read-only check of Retired-question prompt media against R2 | `docs/operations/prompt-media-reconciliation.md` |
| `npm run cleanup:prompt-media` | Dry-run by default. `--execute` / `--finalize` require `RETENTION_CLEANUP_ENABLED=1` and approval evidence. | `docs/submission-retention-and-purge.md` |
| `npm run observability:synthetic-failure` | Pushes one synthetic failure event to verify the dashboard and alerts | `docs/runbooks/assessment-initialization-failures.md` |

The managed PostgreSQL may only accept connections from allow-listed IPs. If
the scripts can't connect from your machine, check the provider's network
rules before anything else.

## External services

| Service | What lives there | Linked through |
| --- | --- | --- |
| GitHub | Code, Actions, deploy secrets, ghcr packages | `.github/workflows/` |
| Managed PostgreSQL | All application data | `DATABASE_URL` in `backend.env` |
| Cloudflare R2 | Answer videos, prompt audio, option icons | `R2_*` in `backend.env` |
| Grafana Cloud (Loki) | Assessment-initialization telemetry, dashboard, alerts | `OBSERVABILITY_*` in `backend.env`, `ops/grafana/` |
| Google Cloud Console | OAuth client. The redirect URI must be exactly `https://fluentcheck.duckdns.org/backend-api/auth/google/callback`. | `GOOGLE_*` in `backend.env`, `backend/docs/GOOGLE_AUTH.md` |
| iPaymu | Payment checkout and callbacks. Every success callback triggers an outbound `POST /api/v2/transaction` check, so production needs the server's outbound IP registered in the iPaymu dashboard, the same as checkout. | `IPAYMU_*` in `backend.env` |
| DuckDNS | The `fluentcheck.duckdns.org` → VPS IP record. **Update it if the VPS IP changes.** | DuckDNS dashboard |

## Troubleshooting

| Symptom | Where to look |
| --- | --- |
| *Deploy to VPS* run is red | The run log. A `deploy: failure detected, rolling back` line means the old containers are still serving traffic. Look for the step that failed: pull, migrate, or the health wait. |
| `pull access denied` / `unauthorized` from ghcr | The packages are private and the VPS login expired. Run `docker login ghcr.io` with a token that has `read:packages`, or make the packages public. |
| Backend container keeps restarting | `dc logs --tail=200 backend`. Usually a config validation error at startup (see [Changing a secret or setting](#changing-a-secret-or-setting)) or an unreachable `DATABASE_URL`. |
| Site returns 502 / 504 | `dc ps` (are both containers healthy?), then the nginx error log. |
| Frontend loads but API calls fail | `dc logs frontend`. It should log `entrypoint: pointed N rewrite(s) at http://backend:5001` at startup, and `dc ps` should show the backend healthy. |
| Many users get 429 at once / rate limits feel global | `dc logs backend \| grep "Client IP check"`. `passed` means `req.ip` resolves to real clients. `failed` names the proxy address the backend saw: check that nginx appends `X-Forwarded-For` and that the compose subnet still matches `RATE_LIMIT_TRUST_PROXY`. The backend also logs `Rate-limit trust proxy: …` at startup. |
| Prompt media / assessment start failures | `docs/runbooks/assessment-initialization-failures.md` |
| `no space left on device` | [Disk space](#disk-space) |
| Payment stays PENDING after the student paid | `dc logs backend \| grep -i "transaction verification"`. `unavailable` means the check-transaction call failed (network, outbound IP not registered, wrong `IPAYMU_ENV`/key); iPaymu retries the callback. `failed transaction verification` with a reason means iPaymu reported a different transaction, reference, amount, or an unpaid status. |

## Offboarding and key rotation

- **Remove a person**: delete their line from `authorized_keys` on the VPS.
  If they had seen `backend.env`, rotate the secrets they could have copied:
  start with `JWT_SECRET`, the database password, and the R2 keys.
- **Rotate the CI deploy key**: generate a new keypair (see
  `ops/deploy/README.md`), add the new public key to `authorized_keys`,
  update the `VPS_SSH_KEY` secret, run *Deploy to VPS* manually to confirm,
  then remove the old public key.

## Related docs

- [`ops/deploy/README.md`](../../ops/deploy/README.md): one-time VPS setup
- [`ops/grafana/README.md`](../../ops/grafana/README.md): dashboards and alerts
- [`backend/docs/GOOGLE_AUTH.md`](../../backend/docs/GOOGLE_AUTH.md): OAuth deployment
- [`backend/docs/RATE_LIMITING.md`](../../backend/docs/RATE_LIMITING.md) and
  [ADR-0010](../adr/0010-rate-limit-topology-and-failure-mode.md): rate-limit
  settings for production
- [`docs/runbooks/`](../runbooks/): incident runbooks
- [`loadtest/README.md`](../../loadtest/README.md): load testing production
