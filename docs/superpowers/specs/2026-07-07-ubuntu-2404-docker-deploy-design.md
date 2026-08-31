# Deploy SmartStars CRM to Ubuntu 24.04 (Docker + Caddy TLS)

**Date:** 2026-07-07
**Status:** Design approved — ready for implementation plan

## Purpose

Provide a repeatable, documented way to stand up the existing production Docker
stack on a **fresh, empty Ubuntu 24.04 (noble)** server, terminating HTTPS with a
new **Caddy** service (automatic Let's Encrypt) that fronts the existing nginx
`web` service. Fill the one gap the shipped stack deliberately leaves open — TLS
termination — and ship a runbook the operator follows end to end.

Non-goal: reworking the app, the images, or the compose topology. The stack
(`Dockerfile` + `compose.prod.yaml` + `docker/`) already builds and runs; this
adds only the public-edge TLS layer, the proxy trust it requires, and the guide.

## Context (what already exists)

- **`Dockerfile`** — multi-stage, three targets: `app` (PHP-FPM; also runs
  queue/reverb/scheduler), `web` (nginx serving `public/` + proxying PHP to
  `app:9000` and the `/app` websocket to `reverb:8080`), `engine` (Node sidecar).
- **`compose.prod.yaml`** — 8 services: `web`, `app`, `queue`, `reverb`,
  `scheduler`, `engine`, `mysql`, `redis`. `web` publishes `${WEB_PORT:-80}:80`.
  The header comment states: *"Put TLS termination in front of `web`."*
- **`docker/entrypoint.sh`** — on the `app` service: waits for MySQL, runs
  `migrate --force` (gated by `RUN_MIGRATIONS=true`), optional `ProductionSeeder`
  (`RUN_SEEDERS=true`), `storage:link`, `php artisan optimize`.
- **`docker/nginx/default.conf`** — already routes `location /app` → `reverb:8080`
  with the `Upgrade`/`Connection` websocket headers. **Consequence: an edge proxy
  only needs to forward everything to `web`; the `/app` split is internal.**
- **`.env.docker.example`** — full prod env template. `VITE_REVERB_*` are compiled
  into the browser bundle at **build time** (documented in `docker/README.md`).
- **`docs/DEPLOY-ubuntu.md`** — does not exist yet (this spec creates it).

## Decisions (from brainstorming)

- **Run mode:** existing Docker stack, unchanged. No bare-metal install.
- **TLS:** dedicated domain + **auto-HTTPS via Caddy** (Let's Encrypt).
- **Build location:** build the images **on the server** (simplest; a 4 GB box
  handles `npm run build`). Registry/build-elsewhere is noted as a future path,
  not implemented.
- **Deliverable:** the runbook **plus** the missing production bits (Caddy service
  + Caddyfile + proxy-trust wiring + optional deploy helper).

## Architecture

Public request path:

```
Browser ──HTTPS/WSS:443──▶ caddy ──HTTP:80──▶ web (nginx)
                                                 ├─ FastCGI ─▶ app:9000  (Laravel)
                                                 └─ /app     ─▶ reverb:8080 (websocket)
                            (app ──▶ engine:8787, mysql:3306, redis:6379 — internal)
```

- Only `caddy` publishes host ports (**80, 443**). `web` stops publishing to the
  host (`ports: []`) and is reached by Caddy over the internal `ssai` network.
- Caddy handles ACME challenges on :80/:443, terminates TLS, and reverse-proxies
  **all** paths to `web:80`. It upgrades websockets transparently, so the existing
  nginx `/app` → `reverb` rule keeps working with no extra Caddy config.
- Caddy sends `X-Forwarded-Proto: https`; nginx forwards request headers to
  PHP-FPM, so Laravel sees the original scheme **iff it trusts the proxy**.

## Components / changes

### 1. `docker/caddy/Caddyfile`
```caddyfile
{$SITE_ADDRESS} {
	encode zstd gzip
	reverse_proxy web:80
}
```
- `SITE_ADDRESS` comes from the environment (the domain, e.g. `crm.example.com`).
  Automatic HTTPS is on by default for a hostname site address — no `tls`
  directive needed for a normal Let's Encrypt cert.
- A commented block documents the **staging CA** toggle for test runs
  (`acme_ca https://acme-staging-v02.api.letsencrypt.org/directory`) to avoid
  hitting production rate limits while validating DNS.

### 2. `compose.caddy.yaml` (overlay, applied alongside `compose.prod.yaml`)
Adds:
```yaml
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443", "443:443/udp"]  # udp = HTTP/3
    environment:
      SITE_ADDRESS: "${SITE_ADDRESS:?set SITE_ADDRESS in .env.docker}"
    volumes:
      - ./docker/caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data      # persists issued certs — DO NOT lose this
      - caddy-config:/config
    depends_on: [web]
    networks: [ssai]
  web:
    ports: !reset []          # stop publishing :80 to the host; Caddy fronts it
volumes:
  caddy-data:
  caddy-config:
```
Applied as: `-f compose.prod.yaml -f compose.caddy.yaml`. **Compose merge caveat:**
multi-value keys such as `ports` are *concatenated* across files, so a plain
`ports: []` would keep the base `${WEB_PORT:-80}:80`. The `!reset []` tag (Compose
v2.24+) erases the base list so nothing but Caddy is exposed. `web` is still
reachable by Caddy as `web:80` over the internal `ssai` network (publishing only
affects host↔container). Validate the merged result with
`docker compose … config | grep -A3 ' web:'` before first launch.

### 3. `.env.docker` wiring (documented in the runbook; template stays generic)
Operator sets, for their domain:
- `APP_URL=https://<domain>`
- `SITE_ADDRESS=<domain>`
- `VITE_REVERB_HOST=<domain>`, `VITE_REVERB_PORT=443`, `VITE_REVERB_SCHEME=https`
  (**build-time**; changing them requires rebuilding `app` + `web`).
- `REVERB_HOST=reverb`, `REVERB_PORT=8080`, `REVERB_SCHEME=http` stay internal
  (server → reverb container) — must NOT be collapsed into the VITE_* values.

### 4. Trusted proxies (`bootstrap/app.php`)
Laravel 12 trusts no proxies by default, so behind Caddy it would generate
`http://` URLs and mis-set secure cookies. Add in the `withMiddleware` closure:
```php
$middleware->trustProxies(at: '*');
```
Justified because `app`/`web` are only reachable over the internal Docker network
(never directly from the internet), so the forwarded headers can only originate
from our own edge. The runbook notes how to scope it to the bridge subnet instead
if preferred.

### 5. `docs/DEPLOY-ubuntu.md` — the runbook
Ordered sections:
- **A. Provision** — Ubuntu 24.04; **≥ 2 vCPU / 4 GB RAM / 25 GB disk** (build runs
  `npm run build` + `composer install` on the box); create a sudo non-root user;
  `ufw allow OpenSSH, 80/tcp, 443/tcp` then enable. Note the Docker/ufw caveat: we
  only publish 80/443 (both intended public); MySQL/Redis are never published.
- **B. DNS** — `A` (and `AAAA` if IPv6) record `<domain>` → server IP. Must resolve
  and ports 80/443 be reachable **before** first `up`, or ACME fails.
- **C. Install Docker** — official apt repo (GPG key + `docker.sources`), install
  `docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`,
  `usermod -aG docker <user>`, verify `docker run hello-world`.
- **D. Get code** — `git clone` into `/opt/ssai` (private repo → deploy key / PAT).
- **E. Configure** — `cp .env.docker.example .env.docker`; **rotate + fill** all
  secrets: `APP_KEY` (`docker run --rm … php artisan key:generate --show` after a
  first build, or `openssl`), `REVERB_APP_ID/KEY/SECRET`, DB passwords, provider
  keys, `ADMIN_PASSWORD`, and the domain vars from §3.
- **F. Build + launch** —
  `docker compose -f compose.prod.yaml -f compose.caddy.yaml --env-file .env.docker build`
  then `… up -d`; suggest exporting `COMPOSE_FILE`/`COMPOSE_ENV_FILES` to shorten.
- **G. First run** — migrations auto-run (`app` entrypoint). Seed the first admin:
  `docker compose exec app php artisan db:seed --class=ProductionSeeder --force`.
  Map a creator: set `aich_models.of_account_id`.
- **H. Verify** — `docker compose ps` (all healthy), `curl https://<domain>/up`,
  browser login, realtime toast (Reverb over WSS), engine generate in a chat,
  `docker compose logs -f caddy` shows a cert obtained.
- **I. Operate** — tail logs; **update** (`git pull` → rebuild `app` → `up -d app
  queue reverb scheduler`, rebuild `web` only on nginx-conf change); **back up** the
  `mysql-data`, `redis-data`, `storage`, and `caddy-data` volumes; restart policy is
  `unless-stopped` so the stack survives reboot.

### 6. `deploy.sh` (optional helper)
Small, idempotent: sets the compose flags, `git pull`, `docker compose build app`,
`docker compose up -d`. Documented as convenience, not required.

## Security prerequisite (in-scope cleanup)

`.env.docker.example` currently contains **real-looking live** Anthropic,
OpenRouter, and OnlyFans API keys and `ADMIN_PASSWORD=password`, committed to git
history. As part of this work:
1. Replace those values in `.env.docker.example` with empty placeholders / comments.
2. Flag to the operator that the leaked keys must be **rotated** at each provider
   (git history still contains them; scrubbing history is a separate, optional step).

## Testing / verification

No app code changes except the one-line `trustProxies` middleware, so the existing
suites remain the guard:
- `php artisan test` (Pest) still green after the middleware change.
- `docker compose config` validates the merged prod + caddy compose files.
- Manual acceptance = runbook §H (health endpoint over HTTPS, login, realtime,
  engine generate, Caddy cert issued). A short staging-CA dry run is recommended
  before the production cert to confirm DNS/ports.

## Out of scope (YAGNI)

CI/CD, image registry / build-elsewhere, multi-host or orchestrated deploys,
blue-green / zero-downtime, managed database, log shipping. Single-host is the
right altitude now; the runbook names the registry path for when build and deploy
are later split.
