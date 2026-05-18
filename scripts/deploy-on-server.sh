#!/usr/bin/env bash
# Запускается на сервере (вручную или из GitHub Actions).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Deploy from $ROOT"

if [ ! -f .env ]; then
  echo "ERROR: .env not found in $ROOT — create it on the server (do not commit to git)."
  exit 1
fi

echo "==> Disk space"
df -h / /var/lib/docker 2>/dev/null || df -h /

AVAIL_KB="$(df -Pk / | awk 'NR==2 {print $4}')"
if [ "${AVAIL_KB:-0}" -lt 2097152 ]; then
  echo "WARN: less than 2 GB free on /. Cleaning Docker cache..."
  docker builder prune -af 2>/dev/null || true
  docker image prune -af 2>/dev/null || true
  docker system prune -af 2>/dev/null || true
  df -h /
fi

echo "==> Docker build & restart"
docker compose -f docker-compose.prod.yaml build --pull=false
docker compose -f docker-compose.prod.yaml up -d

echo "==> Database migrations"
if command -v npx >/dev/null 2>&1; then
  npx prisma migrate deploy
else
  echo "WARN: npx not found — run 'npx prisma migrate deploy' manually on the server."
fi

echo "==> Health check"
sleep 3
curl -fsS "http://127.0.0.1:${PORT:-3000}/" || curl -fsS "http://127.0.0.1:3000/" || true

echo "==> Done. Container status:"
docker compose -f docker-compose.prod.yaml ps
