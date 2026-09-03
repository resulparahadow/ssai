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

# ---- preflight: VITE_* are baked into the JS bundle at BUILD time --------------
# A wrong value here fails SILENTLY at runtime — no error in any log. A bad
# VITE_REVERB_HOST ships a bundle whose websocket dials a host that doesn't exist,
# so the browser never receives a broadcast and Conversations only updates on a
# manual refresh. That shipped once already; catch it here instead.
env_val() {
	local v
	v="$(sed -n "s/^$1=//p" .env.docker | tail -1)"
	v="${v%\"}"
	v="${v#\"}"
	v="${v%\'}"
	v="${v#\'}"
	printf '%s' "$v"
}

site_address="$(env_val SITE_ADDRESS)"
reverb_host="$(env_val VITE_REVERB_HOST)"
reverb_host="${reverb_host//\$\{SITE_ADDRESS\}/$site_address}"

if [ -z "$site_address" ]; then
	echo "error: SITE_ADDRESS is unset in .env.docker." >&2
	exit 1
fi

case "$reverb_host" in
"" | your-domain.com | localhost | example.com | 127.0.0.1)
	echo "error: VITE_REVERB_HOST is '${reverb_host:-<unset>}' — a placeholder, not a real host." >&2
	echo "       Echo dials wss://\$VITE_REVERB_HOST/app, so realtime dies silently." >&2
	echo "       Set it to \"\${SITE_ADDRESS}\" ($site_address) in .env.docker." >&2
	exit 1
	;;
esac

if [ "$reverb_host" != "$site_address" ]; then
	echo "warning: VITE_REVERB_HOST ($reverb_host) != SITE_ADDRESS ($site_address)." >&2
	echo "         Intentional only if Reverb is served from its own hostname." >&2
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
