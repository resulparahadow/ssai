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
echo "    deploying $(git rev-parse --abbrev-ref HEAD) @ $(git rev-parse --short HEAD)"

# Build all three images every time. They share the `build` stage, so when nothing
# in them changed Docker's layer cache makes web/engine near-instant — cheap enough
# that it isn't worth trading for the risk of shipping a stale one. Each bakes
# something the app image does NOT carry:
#   app    -> PHP code + compiled assets (published into the `assets` volume on boot)
#   web    -> docker/nginx/default.conf  (e.g. fastcgi_read_timeout for DRM downloads)
#   engine -> engine/ + legacy/js        (the generation pipeline)
echo "==> build images (app, web, engine)"
docker compose build app web engine

echo "==> restart services"
docker compose up -d app queue reverb scheduler web engine

echo "==> status"
docker compose ps
