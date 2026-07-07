#!/usr/bin/env bash
# SmartStars CRM — pull latest + rebuild + restart the prod stack.
# Run from the repo root on the server:  ./deploy.sh
set -euo pipefail

export COMPOSE_FILE=compose.prod.yaml:compose.caddy.yaml
export COMPOSE_ENV_FILES=.env.docker

if [ ! -f .env.docker ]; then
	echo "error: .env.docker not found. Copy .env.docker.example and fill it in." >&2
	exit 1
fi

echo "==> git pull"
git pull --ff-only

echo "==> build app image (carries compiled assets)"
docker compose build app

echo "==> restart app + workers"
docker compose up -d app queue reverb scheduler

echo "==> status"
docker compose ps
echo "Done. If you changed docker/nginx/default.conf, also: docker compose up -d --build web"
