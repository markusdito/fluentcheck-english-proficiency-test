# VPS deployment

How the Docker-based CI/CD pipeline ships FluentCheck to the VPS, and the
one-time setup it requires. The pipeline is: push to `main` → **Publish
images** workflow builds and pushes both images to ghcr.io → **Deploy to
VPS** workflow SSHes in and runs `deploy.sh`.

## Files

- `ops/compose/docker-compose.prod.yml` — the production topology: backend +
  frontend containers only, PostgreSQL is external/managed. Ports bind to
  `127.0.0.1` only; the host reverse proxy terminates TLS and forwards to
  `127.0.0.1:3000` (frontend) and `127.0.0.1:5001` (backend).
- `ops/deploy/deploy.sh` — runs on the VPS: rewrites `.env` to the new
  immutable `sha-<short>` image tags, pulls, applies `prisma migrate deploy`
  through the backend image, swaps containers behind healthchecks
  (`/api/health` for the backend, `GET /login` for the frontend), verifies
  the health endpoint, and automatically restores the previous image tags if
  anything fails.
- `.github/workflows/publish.yml` — builds both images on every push to
  `main` and tags them `version`, `sha-<short>`, and `latest`. Manual
  dispatch still allows republishing a single app ad hoc.
- `.github/workflows/deploy.yml` — runs after a successful publish and on
  manual dispatch (redeploy of the current `main` commit without a rebuild).

## One-time VPS setup

1. **Install Docker Engine** with the compose plugin
   (<https://docs.docker.com/engine/install/>). All deployment happens
   through `docker compose`; nothing else is needed on the host.

2. **Create the deploy directory** (this is the `VPS_DEPLOY_DIR` secret, e.g.
   `/opt/fluentcheck`). CI copies `docker-compose.prod.yml` and `deploy.sh`
   into it on every deploy, but it must already contain the two files CI
   never touches:

   - `.env` — compose variables:

     ```
     BACKEND_URL=https://<public backend origin>
     BACKEND_IMAGE=ghcr.io/markusdito/fluentcheck-backend:latest
     FRONTEND_IMAGE=ghcr.io/markusdito/fluentcheck-frontend:latest
     ```

     `BACKEND_URL` is the browser-facing origin the Next.js rewrites point
     at (see `frontend/docker/entrypoint.mjs`). The image variables get
     rewritten to `sha-<short>` tags on the first deploy.

   - `backend.env` — the backend runtime configuration: `DATABASE_URL`
     (managed PostgreSQL), `JWT_SECRET`, `FRONTEND_URL`, the `R2_*` media
     credentials, the Google OAuth variables, the `RATE_LIMIT_*` topology
     settings, and the observability variables. See the env notes in the
     backend README and `docs/adr/0010-rate-limit-topology-and-failure-mode.md`
     for the rate-limit constraints.

3. **Give the VPS read access to ghcr.io.** Either flip both packages to
   public (Packages → fluentcheck-backend/frontend → Package settings), or
   `docker login ghcr.io` once with a PAT that has `read:packages`. The
   credential is stored by Docker's credential store and reused by every
   subsequent `docker compose pull`.

4. **Create the deploy keypair.** On your machine:

   ```
   ssh-keygen -t ed25519 -f deploy-key -N "" -C "fluentcheck-deploy"
   ```

   Append `deploy-key.pub` to the VPS user's `~/.ssh/authorized_keys`. Put
   the contents of `deploy-key` (the private half) into GitHub as the
   `VPS_SSH_KEY` secret.

5. **Add the GitHub repository secrets** (Settings → Secrets and variables →
   Actions):

   | Secret           | Value                                            |
   | ---------------- | ------------------------------------------------ |
   | `VPS_HOST`       | VPS hostname or IP                               |
   | `VPS_USER`       | SSH user (must run `docker` without sudo)        |
   | `VPS_SSH_KEY`    | contents of the private deploy key from step 4   |
   | `VPS_PORT`       | SSH port                                         |
   | `VPS_DEPLOY_DIR` | the deploy directory from step 2                 |

   Add the deploy user to the `docker` group (`usermod -aG docker <user>`)
   so the workflow never needs root.

6. **Verify the reverse proxy** still points at `127.0.0.1:3000` and
   `127.0.0.1:5001`. Docker never handles TLS or domains; the existing
   proxy config keeps working unchanged.

## Day-to-day operation

- **Deploy**: merge to `main`. Everything else is automatic.
- **Check what is running**: `docker compose ps` in the deploy dir — the
  image tags name the exact commit.
- **Redeploy a commit without rebuilding**: dispatch *Deploy to VPS* from
  the Actions tab.
- **Rollback**: automatic when the new containers never become healthy. To
  roll back to an older commit manually, set the previous `sha-` tags in
  `.env` (`BACKEND_IMAGE`, `FRONTEND_IMAGE`) and run
  `docker compose up -d --wait`.
- **Failed deploy**: check the *Deploy to VPS* run logs; the deploy script
  prints the rollback notice. `.env.previous` is only kept between failure
  and the rollback completing.
