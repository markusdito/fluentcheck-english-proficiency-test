#!/usr/bin/env bash
# Deploys pinned image versions to the VPS and rolls back automatically if
# the new containers never become healthy.
#
# Usage: ./deploy.sh <deploy-dir> <backend-image> <frontend-image>
#
# The deploy dir must contain docker-compose.prod.yml, .env (with BACKEND_URL,
# BACKEND_IMAGE, FRONTEND_IMAGE) and backend.env (DATABASE_URL and the rest of
# the backend runtime configuration).
#
# Sequence: pin previous images aside -> rewrite .env to the new sha tags ->
# pull -> prisma migrate deploy -> up -d --wait -> verify /api/health.
# On any failure, .env is restored to the previous images and the old
# containers are brought back up before the script exits non-zero.
set -euo pipefail

DEPLOY_DIR="${1:?usage: deploy.sh <deploy-dir> <backend-image> <frontend-image>}"
BACKEND_IMAGE="${2:?usage: deploy.sh <deploy-dir> <backend-image> <frontend-image>}"
FRONTEND_IMAGE="${3:?usage: deploy.sh <deploy-dir> <backend-image> <frontend-image>}"

cd "$DEPLOY_DIR"

for file in docker-compose.prod.yml .env backend.env; do
  if [[ ! -f $file ]]; then
    echo "deploy: missing $file in $DEPLOY_DIR" >&2
    exit 1
  fi
done

COMPOSE=(docker compose -f docker-compose.prod.yml --env-file .env)

set_env_value() {
  local key=$1 value=$2
  if grep -q "^${key}=" .env; then
    sed -i "s|^${key}=.*|${key}=${value}|" .env
  else
    printf '%s=%s\n' "$key" "$value" >> .env
  fi
}

cp .env .env.previous

rollback() {
  echo "deploy: failure detected, rolling back to previous images" >&2
  cp .env.previous .env
  "${COMPOSE[@]}" up -d --wait --wait-timeout 120 || true
  echo "deploy: rolled back; previous containers are serving traffic" >&2
  exit 1
}
trap rollback ERR

set_env_value BACKEND_IMAGE "$BACKEND_IMAGE"
set_env_value FRONTEND_IMAGE "$FRONTEND_IMAGE"

"${COMPOSE[@]}" pull

"${COMPOSE[@]}" run --rm backend npx prisma migrate deploy

"${COMPOSE[@]}" up -d --wait --wait-timeout 120

if command -v curl >/dev/null 2>&1; then
  curl -fsS http://127.0.0.1:5001/api/health >/dev/null
else
  wget -qO- http://127.0.0.1:5001/api/health >/dev/null
fi

trap - ERR
rm -f .env.previous

echo "deploy: backend=$BACKEND_IMAGE frontend=$FRONTEND_IMAGE"
echo "deploy: done"
