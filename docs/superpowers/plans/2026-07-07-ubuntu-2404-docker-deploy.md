# Ubuntu 24.04 Docker + Caddy Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing SmartStars Docker stack deployable end-to-end on a fresh Ubuntu 24.04 host by adding a Caddy auto-HTTPS edge, the proxy-trust it requires, a hardened env template, and an operator runbook.

**Architecture:** The shipped `compose.prod.yaml` (web/app/queue/reverb/scheduler/engine/mysql/redis) is left intact. A new `compose.caddy.yaml` overlay adds a `caddy` service that terminates TLS on :80/:443 and reverse-proxies everything to the internal nginx `web` service (which already splits the `/app` websocket to `reverb`). Laravel is told to trust the proxy so it detects HTTPS. A runbook drives server prep → build → up → verify.

**Tech Stack:** Docker Engine + Compose plugin, Caddy 2 (Let's Encrypt/ACME), Laravel 12 / PHP 8.3, Reverb websockets, MySQL 8, Redis 7.

## Global Constraints

- **No app behavior changes.** The only PHP edit is one middleware line in `bootstrap/app.php`. Do NOT touch `legacy/`, the engine, or `Dockerfile`.
- **Caddy image:** `caddy:2-alpine`. **Compose `!reset` tag** requires Compose v2.24+ (bundled with current `docker-compose-plugin`).
- **Secrets never hard-coded** in tracked files. Example/template values must be blank placeholders.
- **`VITE_REVERB_*` are build-time.** They compile into the browser bundle; changing them requires rebuilding `app` + `web`.
- **Reverb split:** server-side `REVERB_HOST=reverb`/`REVERB_PORT=8080`/`REVERB_SCHEME=http` (internal) must stay distinct from client-side `VITE_REVERB_HOST=<domain>`/`443`/`https` (public). Never collapse them.
- **Commit style:** end messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit only the files named in each task (the working tree also has an unrelated `SsChatThread.vue` change — leave it).
- **Spec:** `docs/superpowers/specs/2026-07-07-ubuntu-2404-docker-deploy-design.md`.

---

### Task 1: Harden `.env.docker.example`

Blank the remaining example secrets, drop the duplicate ADMIN block, add `SITE_ADDRESS`, and point the client-side Reverb vars at the public domain over HTTPS.

**Files:**
- Modify: `.env.docker.example`

**Interfaces:**
- Produces: env keys the compose files + runbook reference — `SITE_ADDRESS`, `APP_URL`, `VITE_REVERB_HOST/PORT/SCHEME`.

- [ ] **Step 1: Add `SITE_ADDRESS` under `APP_URL`**

Replace lines 11–14:
```
APP_URL=https://your-domain.com

# Host port the nginx `web` service binds (put a TLS reverse proxy in front).
WEB_PORT=8080
```
with:
```
APP_URL=https://your-domain.com

# Public domain the Caddy edge serves + provisions a Let's Encrypt cert for.
# Must be a real hostname resolving to this server (not an IP) for auto-HTTPS.
SITE_ADDRESS=your-domain.com

# Host port the bare nginx `web` service binds when running WITHOUT the Caddy
# overlay. With compose.caddy.yaml applied, web is not host-published (Caddy
# fronts it) and this is ignored.
WEB_PORT=8080
```

- [ ] **Step 2: Blank the example DB passwords**

Replace lines 34–35:
```
DB_PASSWORD=422f9cdad99fa46d7dd95291ee1dd786
DB_ROOT_PASSWORD=248395f5bf335cf7723be41c15b9f7e0
```
with:
```
DB_PASSWORD=            # generate: openssl rand -hex 24
DB_ROOT_PASSWORD=       # generate: openssl rand -hex 24
```

- [ ] **Step 3: Blank the example Reverb credentials**

Replace lines 54–56:
```
REVERB_APP_ID=115806
REVERB_APP_KEY=8412e303bccf4de40f27d3dd05a17d48
REVERB_APP_SECRET=9af7c7b8d8eb2bb0e923ea19e778582c
```
with:
```
REVERB_APP_ID=          # any integer, e.g. openssl rand 100000..999999
REVERB_APP_KEY=         # generate: openssl rand -hex 16
REVERB_APP_SECRET=      # generate: openssl rand -hex 16
```

- [ ] **Step 4: Point client-side Reverb vars at the public HTTPS host**

Replace lines 69–71:
```
VITE_REVERB_HOST=localhost
VITE_REVERB_PORT=8080
VITE_REVERB_SCHEME=http
```
with:
```
VITE_REVERB_HOST="${SITE_ADDRESS}"
VITE_REVERB_PORT=443
VITE_REVERB_SCHEME=https
```

- [ ] **Step 5: Remove the duplicate ADMIN block**

Delete lines 104–106 entirely (the second, weaker copy):
```
ADMIN_NAME="Admin"
ADMIN_EMAIL=admin@smartstars.com
ADMIN_PASSWORD=password
```
The canonical block at lines 98–100 (`ADMIN_PASSWORD=` blank) stays.

- [ ] **Step 6: Verify no secret-looking values remain**

Run:
```bash
grep -nE '=(sk-|ofapi_|[0-9a-f]{16,})|ADMIN_PASSWORD=password' .env.docker.example || echo "CLEAN"
```
Expected: `CLEAN`

- [ ] **Step 7: Commit**

```bash
git add .env.docker.example
git commit -m "chore(deploy): blank example secrets, add SITE_ADDRESS + HTTPS Reverb vars

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Trust the reverse proxy in Laravel

Behind Caddy, Laravel must trust the forwarded scheme or it emits `http://` URLs and mis-flags secure cookies (breaking Reverb auth + logins over HTTPS).

**Files:**
- Modify: `bootstrap/app.php`
- Test: existing Pest suite (`tests/`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `X-Forwarded-*` trust so `$request->getScheme()` returns `https` behind the edge.

- [ ] **Step 1: Run the suite first to confirm a green baseline**

Run: `php artisan test`
Expected: PASS (all existing tests green) — this is the pre-change baseline.

- [ ] **Step 2: Add `trustProxies` to the middleware closure**

In `bootstrap/app.php`, inside `->withMiddleware(function (Middleware $middleware): void {`, add as the first line of the closure body (before `encryptCookies`):
```php
        // Behind the Caddy → nginx edge (internal Docker network only), trust the
        // forwarded headers so HTTPS/scheme + client IP are detected correctly.
        $middleware->trustProxies(at: '*');

```
Result — the closure begins:
```php
    ->withMiddleware(function (Middleware $middleware): void {
        // Behind the Caddy → nginx edge (internal Docker network only), trust the
        // forwarded headers so HTTPS/scheme + client IP are detected correctly.
        $middleware->trustProxies(at: '*');

        $middleware->encryptCookies(except: ['appearance', 'sidebar_state']);
```

- [ ] **Step 3: Re-run the suite to confirm no regression**

Run: `php artisan test`
Expected: PASS (same green result; the middleware change is inert in the test env, which sends no forwarded headers).

- [ ] **Step 4: Static analysis**

Run: `composer run types:check`
Expected: PASS (phpstan clean).

- [ ] **Step 5: Commit**

```bash
git add bootstrap/app.php
git commit -m "feat(deploy): trust the reverse proxy for HTTPS scheme detection

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Add the Caddy TLS edge

A Caddyfile + a compose overlay that runs Caddy in front of `web`.

**Files:**
- Create: `docker/caddy/Caddyfile`
- Create: `compose.caddy.yaml`

**Interfaces:**
- Consumes: `SITE_ADDRESS` (Task 1); the `web` service + `ssai` network from `compose.prod.yaml`.
- Produces: a `caddy` service publishing 80/443; `web` no longer host-published.

- [ ] **Step 1: Create `docker/caddy/Caddyfile`**

```caddyfile
# SmartStars CRM — Caddy edge (TLS termination + reverse proxy).
# Automatic HTTPS is ON by default for a hostname site address: Caddy solves the
# ACME challenge on :80/:443 and auto-renews. It forwards ALL paths to the nginx
# `web` service, which internally splits the /app websocket to reverb — so no
# extra websocket config is needed here (Caddy upgrades connections transparently).
{$SITE_ADDRESS} {
	encode zstd gzip
	reverse_proxy web:80
}

# --- Testing tip -------------------------------------------------------------
# To dry-run cert issuance without burning Let's Encrypt production rate limits,
# uncomment the global staging CA below (certs will be UNTRUSTED by browsers),
# `docker compose ... up -d caddy`, confirm a cert is obtained in the logs, then
# re-comment and recreate caddy for the real cert:
# {
# 	acme_ca https://acme-staging-v02.api.letsencrypt.org/directory
# }
```

- [ ] **Step 2: Create `compose.caddy.yaml`**

```yaml
# SmartStars CRM — TLS edge overlay. Apply ALONGSIDE compose.prod.yaml:
#   docker compose -f compose.prod.yaml -f compose.caddy.yaml --env-file .env.docker up -d
#
# Adds a Caddy reverse proxy that terminates HTTPS (auto Let's Encrypt) in front
# of the nginx `web` service, and stops `web` from publishing a host port so the
# only internet-facing ports are Caddy's 80/443.
services:
  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"   # HTTP/3 (QUIC)
    environment:
      # Fails fast if unset. The public domain Caddy serves + issues a cert for.
      SITE_ADDRESS: "${SITE_ADDRESS:?set SITE_ADDRESS in .env.docker}"
    volumes:
      - ./docker/caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data       # issued certs + ACME account — PERSIST / BACK UP
      - caddy-config:/config
    depends_on:
      - web
    networks: [ssai]

  web:
    # Compose CONCATENATES multi-value keys across files, so a plain `ports: []`
    # would keep the base publish. `!reset` erases it (needs Compose v2.24+).
    # web stays reachable to caddy as `web:80` over the internal ssai network.
    ports: !reset []

volumes:
  caddy-data:
  caddy-config:
```

- [ ] **Step 3: Validate the merged compose config renders**

Run:
```bash
SITE_ADDRESS=example.com docker compose -f compose.prod.yaml -f compose.caddy.yaml config >/dev/null && echo "COMPOSE OK"
```
Expected: `COMPOSE OK` (no YAML/interpolation errors).

- [ ] **Step 4: Confirm `web` is no longer host-published in the merged config**

Run:
```bash
SITE_ADDRESS=example.com docker compose -f compose.prod.yaml -f compose.caddy.yaml config \
  | awk '/^  web:/{f=1} f&&/ports:/{print "WEB PUBLISHES A PORT"; exit} /^  [a-z]/&&!/^  web:/{f=0}'; echo "checked"
```
Expected: prints only `checked` (no `WEB PUBLISHES A PORT` line) — the `!reset` dropped the base publish.

- [ ] **Step 5: Confirm caddy publishes 80/443 in the merged config**

Run:
```bash
SITE_ADDRESS=example.com docker compose -f compose.prod.yaml -f compose.caddy.yaml config \
  | grep -E 'published: "(80|443)"' && echo "CADDY PORTS OK"
```
Expected: shows published 80 and 443, then `CADDY PORTS OK`.

- [ ] **Step 6: Commit**

```bash
git add docker/caddy/Caddyfile compose.caddy.yaml
git commit -m "feat(deploy): add Caddy auto-HTTPS edge overlay

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Write the Ubuntu 24.04 runbook

The operator-facing guide. Full content below — write it verbatim.

**Files:**
- Create: `docs/DEPLOY-ubuntu.md`

**Interfaces:**
- Consumes: everything from Tasks 1–3 + the existing `compose.prod.yaml` / `docker/README.md`.

- [ ] **Step 1: Create `docs/DEPLOY-ubuntu.md`**

````markdown
# Deploying SmartStars CRM to Ubuntu 24.04

A single-host deploy of the Docker stack (see [`docker/README.md`](../docker/README.md)
for the service breakdown), fronted by **Caddy** for automatic HTTPS. Everything
runs in containers; the only things you install on the host are Docker and a
firewall rule set.

**Compose invocation used throughout** (prod stack + TLS overlay + prod env):

```bash
docker compose -f compose.prod.yaml -f compose.caddy.yaml --env-file .env.docker <cmd>
```

Set these once per shell to type just `docker compose <cmd>`:

```bash
export COMPOSE_FILE=compose.prod.yaml:compose.caddy.yaml
export COMPOSE_ENV_FILES=.env.docker
```

---

## A. Provision the server

- Ubuntu **24.04 LTS (noble)**, **≥ 2 vCPU / 4 GB RAM / 25 GB disk**. The image is
  built on the box (`composer install` + `npm run build`), which needs the RAM; a
  1 GB droplet will OOM the Vite build.
- SSH in as root, create a sudo non-root user, and log back in as them:

  ```bash
  adduser deploy
  usermod -aG sudo deploy
  # (copy your SSH key to the new user, then reconnect as deploy)
  ```

- Firewall — allow SSH + the two public web ports only:

  ```bash
  sudo ufw allow OpenSSH
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw enable
  ```

  > MySQL/Redis/engine are **never** host-published (internal Docker network only),
  > so nothing else needs opening. Note: Docker manages its own iptables rules; the
  > only ports it publishes here are Caddy's 80/443, which you want public anyway.

## B. Point DNS at the server

Create an `A` record (and `AAAA` if you have IPv6) for your domain →  the server's
public IP **before** the first launch. Caddy proves domain ownership over
ports 80/443, so the name must resolve and those ports be reachable, or cert
issuance fails. Verify:

```bash
dig +short your-domain.com    # should print the server IP
```

## C. Install Docker Engine + Compose plugin

Official apt repository (Docker's own instructions for Ubuntu):

```bash
# Docker's GPG key
sudo apt-get update
sudo apt-get install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

# Add the repo (deb822 format)
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io \
  docker-buildx-plugin docker-compose-plugin

# Run docker without sudo (log out/in afterwards for the group to take effect)
sudo usermod -aG docker $USER
```

Verify (reconnect first so the `docker` group applies):

```bash
docker run --rm hello-world
docker compose version   # expect v2.24+ (needed for the !reset overlay)
```

## D. Get the code

```bash
sudo mkdir -p /opt/ssai && sudo chown $USER:$USER /opt/ssai
git clone <your-repo-url> /opt/ssai
cd /opt/ssai
```

Private repo? Use a deploy key or a `https://<token>@github.com/...` URL.

## E. Configure the environment

```bash
cp .env.docker.example .env.docker
```

Generate secrets and edit `.env.docker`:

```bash
# APP_KEY (Laravel needs base64:... ; no image required):
echo "base64:$(openssl rand -base64 32)"

# DB + Reverb secrets:
openssl rand -hex 24    # -> DB_PASSWORD
openssl rand -hex 24    # -> DB_ROOT_PASSWORD
openssl rand -hex 16    # -> REVERB_APP_KEY
openssl rand -hex 16    # -> REVERB_APP_SECRET
# REVERB_APP_ID: any integer, e.g. 481920
```

Set these keys in `.env.docker`:

| Key | Value |
|-----|-------|
| `APP_KEY` | the `base64:...` above |
| `APP_URL` | `https://your-domain.com` |
| `SITE_ADDRESS` | `your-domain.com` (Caddy issues the cert for this) |
| `DB_PASSWORD`, `DB_ROOT_PASSWORD` | the generated hex values |
| `REVERB_APP_ID/KEY/SECRET` | the generated values |
| `ANTHROPIC_API_KEY`, `OPENROUTER_API_KEY`, `ONLYFANS_API_KEY` | **fresh, rotated** provider keys (see warning) |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | first admin login (used by the seeder in §G) |

`VITE_REVERB_HOST/PORT/SCHEME` already resolve to your domain over 443/https via
`SITE_ADDRESS` — leave them. `REVERB_HOST=reverb` (internal) stays as-is.

> ⚠ **Rotate leaked keys.** Earlier commits of `.env.docker.example` contained live
> Anthropic / OpenRouter / OnlyFans keys. Treat them as compromised: rotate each at
> the provider and put the **new** keys in `.env.docker` (which is git-ignored).

## F. Build and launch

```bash
docker compose -f compose.prod.yaml -f compose.caddy.yaml --env-file .env.docker build
docker compose -f compose.prod.yaml -f compose.caddy.yaml --env-file .env.docker up -d
docker compose -f compose.prod.yaml -f compose.caddy.yaml --env-file .env.docker ps
```

The `app` entrypoint waits for MySQL, runs migrations (`RUN_MIGRATIONS=true` on
`app` only), links storage, and caches config/routes/views before PHP-FPM starts.

Watch Caddy obtain the certificate:

```bash
docker compose ... logs -f caddy    # look for "certificate obtained successfully"
```

> First run failing to get a cert? Re-check §B (DNS resolves, ports 80/443 open).
> To dry-run without hitting rate limits, use the staging-CA toggle documented in
> `docker/caddy/Caddyfile`, then switch back for the real cert.

## G. Seed the first admin

```bash
docker compose ... exec app php artisan db:seed --class=ProductionSeeder --force
```

Creates the admin (from `ADMIN_EMAIL`/`ADMIN_PASSWORD`) + a single `Test` creator
model. Idempotent (`updateOrCreate`). To use a creator with OnlyFans, set its
`aich_models.of_account_id` (`acct_…`) — via the Creator Models UI or tinker.

## H. Verify

```bash
docker compose ... ps                       # every service healthy/running
curl -fsS https://your-domain.com/up        # Laravel health endpoint -> 200
```

Then in a browser:
- Log in as the admin.
- Open **Conversations** for an OF-mapped creator → chats/messages load live.
- Trigger a realtime event (inbound message / another tab) → toast fires =
  Reverb is reachable over `wss://your-domain.com/app`.
- **Generate** in a chat → the Node engine returns a draft.

## I. Operate

```bash
# Logs
docker compose ... logs -f app          # or: reverb / caddy / engine

# Update to new code
git pull
docker compose ... build app
docker compose ... up -d app queue reverb scheduler
#   rebuild `web` only when docker/nginx/default.conf changes;
#   rebuild `app` + `web` when VITE_REVERB_* / other build-time vars change.

# Restart everything (survives host reboot via restart: unless-stopped anyway)
docker compose ... up -d
```

**Back up** the named volumes — they hold all persistent state:

| Volume | Holds |
|--------|-------|
| `mysql-data` | the database |
| `redis-data` | cache/sessions/queue |
| `storage` | Laravel `storage/` (logs, uploads) |
| `caddy-data` | **TLS certs + ACME account** — losing it re-triggers issuance |

Example DB dump:

```bash
docker compose ... exec mysql \
  sh -c 'exec mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" ssai_crm' > backup-$(date +%F).sql
```

`docker compose ... down` (without `-v`) stops the stack but keeps the volumes.
`down -v` **deletes** them — don't, unless you mean it.

## Scaling later (out of scope here)

For multiple app replicas, move migrations into a one-shot `migrate` service (see
`docker/README.md`) and build images in CI, pushing to a registry the server pulls
from instead of building on-box. Not needed for a single host.
````

- [ ] **Step 2: Sanity-check internal doc links resolve**

Run:
```bash
test -f docker/README.md && test -f docker/caddy/Caddyfile && echo "LINKS OK"
```
Expected: `LINKS OK` (referenced files exist).

- [ ] **Step 3: Commit**

```bash
git add docs/DEPLOY-ubuntu.md
git commit -m "docs(deploy): Ubuntu 24.04 runbook (Docker + Caddy HTTPS)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Add the `deploy.sh` update helper

A tiny convenience wrapper for the §I update flow.

**Files:**
- Create: `deploy.sh`

- [ ] **Step 1: Create `deploy.sh`**

```bash
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
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x deploy.sh`

- [ ] **Step 3: Verify it parses**

Run: `bash -n deploy.sh && echo "SYNTAX OK"`
Expected: `SYNTAX OK`

- [ ] **Step 4: Commit**

```bash
git add deploy.sh
git commit -m "chore(deploy): add deploy.sh update helper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] `php artisan test` — green (Task 2 didn't regress anything).
- [ ] `SITE_ADDRESS=example.com docker compose -f compose.prod.yaml -f compose.caddy.yaml config >/dev/null` — renders clean.
- [ ] `grep -rnE '=(sk-|ofapi_)' .env.docker.example` — no live keys in the template.
- [ ] `git log --oneline -6` — five deploy commits (Tasks 1–5) atop the spec commit, and the unrelated `SsChatThread.vue` change is still uncommitted.
