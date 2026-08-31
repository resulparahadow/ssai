# Local Docker Dev Environment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a full-stack local Docker dev environment (`docker compose up`) with live reload, completely isolated from the production Docker stack.

**Architecture:** A default `compose.yaml` (project `name: ssai-dev`) runs php-fpm + nginx + Vite (HMR) + the Node engine + reverb + queue + scheduler + mysql + redis. Source is bind-mounted so PHP/Vue/engine changes reflect live; `vendor/` and `node_modules/` are named volumes. A new `dev` Dockerfile stage provides PHP + composer; prod build targets are untouched.

**Tech Stack:** Docker Compose v2, PHP 8.3-FPM (alpine), Node 22, Vite 6 + laravel-vite-plugin (HMR), MySQL 8, Redis 7, Laravel Reverb.

## Global Constraints

- **Prod files are NEVER modified:** `compose.prod.yaml`, `compose.caddy.yaml`, `.env.docker`, `.env.docker.example`, `docker/entrypoint.sh`, `docker/nginx/default.conf`, `docker/php/*`, `docker/php-fpm/*`. (The `Dockerfile` IS edited — appending a `dev` stage only; prod targets `app`/`web`/`engine` stay byte-for-byte identical.)
- **Dev project name:** `ssai-dev` (top-level `name:` in `compose.yaml`) → volumes namespaced `ssai-dev_*`, isolated from prod's `ssai_*`.
- **Dev ports:** app `8000`, Vite `5173`, MySQL `3306`, Reverb `8080`, Redis `6379`, engine `8787`.
- **Dev DB creds:** MySQL root password `root`, database `ssai_crm`; app connects `root`/`root`.
- **No config cache in dev:** the dev entrypoint must NOT run `optimize`/`config:cache` (env + code must reflect live).
- **Host dev path unchanged:** `composer run dev` (host, `VITE_DOCKER` unset) must behave exactly as today.
- **Commit trailer:** end messages with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Commit only the files named in each task.
- **Spec:** `docs/superpowers/specs/2026-07-10-local-docker-dev-environment-design.md`.

---

### Task 1: Dev PHP image (Dockerfile `dev` stage + dev ini + dev entrypoint)

The PHP runtime used by `app`/`queue`/`reverb`/`scheduler` in dev. Reuses the prod `php-base` extensions, adds composer + git, disables opcache, and installs deps + migrates on boot.

**Files:**
- Create: `docker/dev/php-dev.ini`
- Create: `docker/dev/entrypoint.sh`
- Modify: `Dockerfile` (append a `dev` stage after the existing `engine` stage)

**Interfaces:**
- Produces: the `dev` build target (image `ssai-dev/php:latest`), entrypoint at `/usr/local/bin/dev-entrypoint.sh`, honoring `DEV_BOOTSTRAP=true` (owns composer-install + migrate).

- [ ] **Step 1: Create `docker/dev/php-dev.ini`**

Loaded as `zzz-dev.ini` (after the prod `zz-opcache.ini`) so these win in dev:
```ini
; SmartStars — LOCAL DEV php overrides (loaded after zz-opcache.ini).
; Opcache OFF so source edits apply on the next request with no restart.
opcache.enable = 0
opcache.enable_cli = 0

display_errors = On
display_startup_errors = On
error_reporting = E_ALL

upload_max_filesize = 25M
post_max_size = 30M
memory_limit = 512M
```

- [ ] **Step 2: Create `docker/dev/entrypoint.sh`**

```sh
#!/bin/sh
# SmartStars — LOCAL DEV entrypoint (php dev image: app/queue/reverb/scheduler).
# Source is bind-mounted; vendor/ is a shared named volume. NO config cache so
# env + code changes reflect live. The `app` service (DEV_BOOTSTRAP=true) owns
# the one-time composer install + migrate; the others wait for vendor/ then run.
set -e
cd /var/www/html

# Runtime-writable dirs (bind/volume may start bare).
mkdir -p storage/framework/cache/data storage/framework/sessions \
    storage/framework/views storage/logs storage/app/public bootstrap/cache

if [ "${DEV_BOOTSTRAP:-false}" = "true" ]; then
    if [ ! -f vendor/autoload.php ]; then
        echo "[dev] composer install (first run may take a minute)..."
        composer install --no-interaction --prefer-dist
    fi
    # mysql is already 'service_healthy' via depends_on before we get here.
    php artisan migrate --no-interaction || true
    php artisan storage:link --no-interaction 2>/dev/null || true
else
    echo "[dev] waiting for vendor/ (installed by the app service)..."
    i=0
    until [ -f vendor/autoload.php ]; do
        i=$((i + 1))
        [ "$i" -ge 150 ] && { echo "[dev] vendor/ never appeared" >&2; exit 1; }
        sleep 2
    done
fi

echo "[dev] starting: $*"
exec "$@"
```

- [ ] **Step 3: Append the `dev` stage to `Dockerfile`**

Add at the END of the file (after the `engine` stage). Do NOT change any existing stage:
```dockerfile

##########################  Stage 6: dev (local development)  #################
# Local dev PHP-FPM: prod php-base extensions + composer + git. Source is
# bind-mounted at runtime (no COPY), so code changes reflect live. Opcache is
# disabled via zzz-dev.ini. NOT built by prod (compose.prod.yaml targets
# app/web/engine only) — this stage never affects the production images.
FROM php-base AS dev
RUN apk add --no-cache git unzip
COPY --from=composer:2 /usr/bin/composer /usr/bin/composer
COPY docker/dev/php-dev.ini "$PHP_INI_DIR/conf.d/zzz-dev.ini"
COPY docker/dev/entrypoint.sh /usr/local/bin/dev-entrypoint.sh
RUN chmod +x /usr/local/bin/dev-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/dev-entrypoint.sh"]
CMD ["php-fpm"]
```

- [ ] **Step 4: Verify the entrypoint is valid shell**

Run: `sh -n docker/dev/entrypoint.sh && echo "SH OK"`
Expected: `SH OK`

- [ ] **Step 5: Verify the dev image builds**

Run: `docker build --target dev -t ssai-dev/php:verify . 2>&1 | tail -5`
Expected: ends with a success line (`naming to …ssai-dev/php:verify` / `writing image`). No error.

- [ ] **Step 6: Verify prod targets still build (unchanged)**

Run: `docker build --target app -t ssai/app:verify . 2>&1 | tail -3`
Expected: builds successfully (the appended stage didn't break prod).

- [ ] **Step 7: Commit**

```bash
git add docker/dev/php-dev.ini docker/dev/entrypoint.sh Dockerfile
git commit -m "feat(dev): add dev Dockerfile stage + php ini + entrypoint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Dev env template + gitignore

**Files:**
- Create: `.env.docker.dev.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: the env values every dev container reads (mounted as `.env` by Task 4). DB `root`/`root`@`mysql`; redis-backed session/cache/queue; Reverb server=`reverb` / client=`localhost`; blank provider keys.

- [ ] **Step 1: Create `.env.docker.dev.example`**

```dotenv
# =============================================================================
# SmartStars CRM — LOCAL DEV Docker environment.
#   cp .env.docker.dev.example .env.docker.dev   (git-ignored)
#   docker compose up -d --build
# Fill the provider keys below if you want AI generate to return real drafts.
# =============================================================================

APP_NAME="SmartStars"
APP_ENV=local
APP_KEY=base64:WN2xvb4nLZzgPn1bXphcI4zgqx5JUKvAl3bbfQl//Kk=
APP_DEBUG=true
APP_URL=http://localhost:8000

APP_LOCALE=en
APP_FALLBACK_LOCALE=en
APP_FAKER_LOCALE=en_US
BCRYPT_ROUNDS=12

LOG_CHANNEL=stderr
LOG_STACK=single
LOG_LEVEL=debug

# ---- Database (the `mysql` service) -----------------------------------------
DB_CONNECTION=mysql
DB_HOST=mysql
DB_PORT=3306
DB_DATABASE=ssai_crm
DB_USERNAME=root
DB_PASSWORD=root

# ---- Redis (session / cache / queue) ----------------------------------------
REDIS_CLIENT=phpredis
REDIS_HOST=redis
REDIS_PASSWORD=null
REDIS_PORT=6379

CACHE_STORE=redis
SESSION_DRIVER=redis
SESSION_LIFETIME=120
QUEUE_CONNECTION=redis
FILESYSTEM_DISK=local

# ---- Broadcasting / Reverb --------------------------------------------------
BROADCAST_CONNECTION=reverb
REVERB_APP_ID=190240
REVERB_APP_KEY=847c2bcc6cb4a17bcb086e813e59514c
REVERB_APP_SECRET=e25d783f942dc39278b6f20c59781c78

# Server-side: how Laravel reaches the Reverb container (internal network).
REVERB_HOST=reverb
REVERB_PORT=8080
REVERB_SCHEME=http

# Client-side: how the browser reaches Reverb (published to the host).
VITE_REVERB_APP_KEY="${REVERB_APP_KEY}"
VITE_REVERB_HOST=localhost
VITE_REVERB_PORT=8080
VITE_REVERB_SCHEME=http

# ---- Mail -------------------------------------------------------------------
MAIL_MAILER=log

# ---- AI providers (blank = engine returns empty drafts; fill to enable) -----
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-4-6
OPENROUTER_API_KEY=
OPENROUTER_MODEL=mistralai/mistral-nemo
ONLYFANS_API_KEY=
ONLYFANS_BASE_URL=https://app.onlyfansapi.com/api

# ---- Node engine sidecar (the `engine` service) -----------------------------
ENGINE_URL=http://engine:8787
ENGINE_TIMEOUT=60
```

- [ ] **Step 2: Add the filled-in dev env to `.gitignore`**

Append after the existing `.env.docker` line:
```
.env.docker.dev
```
Run to confirm it's placed with the other env ignores:
```bash
grep -nE '^\.env' .gitignore
```
Expected: shows `.env`, `.env.docker`, and `.env.docker.dev` (among others).

- [ ] **Step 3: Verify the example has NO real secrets**

Run:
```bash
grep -nE 'ANTHROPIC_API_KEY=.+|OPENROUTER_API_KEY=.+|ONLYFANS_API_KEY=.+' .env.docker.dev.example || echo "NO PROVIDER SECRETS"
```
Expected: `NO PROVIDER SECRETS` (the three keys are blank).

- [ ] **Step 4: Verify it isn't accidentally tracked under the ignore**

Run: `git check-ignore .env.docker.dev && echo "IGNORED OK"`
Expected: prints `.env.docker.dev` then `IGNORED OK`.

- [ ] **Step 5: Commit**

```bash
git add .env.docker.dev.example .gitignore
git commit -m "feat(dev): add .env.docker.dev.example template + gitignore the filled copy

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Vite Docker HMR guard

Make Vite reachable + hot-reloading from the browser when running in the dev container, with **zero change** to host dev.

**Files:**
- Modify: `vite.config.ts`

**Interfaces:**
- Consumes: `VITE_DOCKER=1` env (set on the `vite` service in Task 4).
- Produces: in-container Vite binds `0.0.0.0:5173`, HMR/asset URLs resolve to `localhost:5173`, file watching uses polling (bind-mount friendly).

- [ ] **Step 1: Edit the `server` block in `vite.config.ts`**

Replace the existing `server: { … }` object (the `host: '127.0.0.1'` / `cors: true` block) with:
```ts
    server: {
        // In the dev container (VITE_DOCKER=1) bind all interfaces and route HMR
        // through the published localhost:5173; on the host keep IPv4 localhost.
        host: process.env.VITE_DOCKER ? '0.0.0.0' : '127.0.0.1',
        cors: true,
        ...(process.env.VITE_DOCKER
            ? {
                  hmr: { host: 'localhost', clientPort: 5173 },
                  // inotify events don't cross the bind mount on macOS/Docker.
                  watch: { usePolling: true },
              }
            : {}),
    },
```
Leave the rest of the file (plugins, wayfinder, etc.) unchanged.

- [ ] **Step 2: Lint + format the file**

Run:
```bash
npx eslint vite.config.ts && npx prettier --check vite.config.ts && echo "LINT OK"
```
Expected: `LINT OK` (fix with `npx prettier --write vite.config.ts` if the format check fails, then re-run).

- [ ] **Step 3: Verify both branches are present**

Run:
```bash
grep -c "VITE_DOCKER" vite.config.ts && grep -q "0.0.0.0" vite.config.ts && grep -q "127.0.0.1" vite.config.ts && echo "BRANCHES OK"
```
Expected: a count ≥ 1, then `BRANCHES OK`.

- [ ] **Step 4: Verify host-dev config still resolves (VITE_DOCKER unset)**

Run: `npm run build 2>&1 | tail -3`
Expected: a successful Vite build (`✓ built in …`) — proves the config is valid and the non-Docker path is intact. (Discard the `public/build` output; it isn't committed.)

- [ ] **Step 5: Commit**

```bash
git add vite.config.ts
git commit -m "feat(dev): vite HMR config for the Docker dev container (host dev unchanged)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: The dev stack — `compose.yaml`

**Files:**
- Create: `compose.yaml`

**Interfaces:**
- Consumes: the `dev` image (Task 1), `.env.docker.dev` (Task 2, mounted as `.env`), `VITE_DOCKER` (Task 3), and the existing `docker/nginx/default.conf`.

- [ ] **Step 1: Create `compose.yaml`**

```yaml
# SmartStars CRM — LOCAL DEV stack (full app in Docker, live reload).
#   cp .env.docker.dev.example .env.docker.dev   # required (git-ignored)
#   docker compose up -d --build
# Isolated from prod (name: ssai-dev). Prod stays:
#   docker compose -f compose.prod.yaml -f compose.caddy.yaml --env-file .env.docker ...
name: ssai-dev

# Shared config for the four PHP services (app/reverb/queue/scheduler). Only
# `app` carries `build:` so the dev image builds once; the rest reuse the tag.
x-php-dev: &php-dev
  image: ssai-dev/php:latest
  restart: unless-stopped
  volumes:
    - .:/var/www/html
    - vendor:/var/www/html/vendor
    - ./.env.docker.dev:/var/www/html/.env:ro
  depends_on:
    mysql: { condition: service_healthy }
    redis: { condition: service_healthy }
  networks: [ssai-dev]

services:
  app:
    <<: *php-dev
    build:
      context: .
      dockerfile: Dockerfile
      target: dev
    command: ["php-fpm"]
    environment:
      DEV_BOOTSTRAP: "true"   # this service owns composer install + migrate

  web:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "8000:80"
    volumes:
      - .:/var/www/html:ro
      - ./docker/nginx/default.conf:/etc/nginx/conf.d/default.conf:ro
    depends_on:
      - app
    networks: [ssai-dev]

  vite:
    image: node:22-alpine
    restart: unless-stopped
    working_dir: /var/www/html
    # npm ci only when node_modules is empty; then start Vite with HMR.
    command: ["sh", "-c", "[ -f node_modules/.bin/vite ] || npm ci; exec npm run dev -- --host 0.0.0.0"]
    environment:
      VITE_DOCKER: "1"
    volumes:
      - .:/var/www/html
      - node_modules:/var/www/html/node_modules
      - ./.env.docker.dev:/var/www/html/.env:ro
    ports:
      - "5173:5173"
    networks: [ssai-dev]

  engine:
    image: node:22-alpine
    restart: unless-stopped
    working_dir: /var/www/html
    command: ["node", "--watch", "engine/server.js"]
    environment:
      ENGINE_HOST: "0.0.0.0"
      ENGINE_PORT: "8787"
    volumes:
      - .:/var/www/html
      - ./.env.docker.dev:/var/www/html/.env:ro
    ports:
      - "8787:8787"
    networks: [ssai-dev]

  reverb:
    <<: *php-dev
    command: ["php", "artisan", "reverb:start", "--host=0.0.0.0", "--port=8080"]
    ports:
      - "8080:8080"

  queue:
    <<: *php-dev
    command: ["php", "artisan", "queue:listen", "--tries=1", "--timeout=0"]

  scheduler:
    <<: *php-dev
    command: ["php", "artisan", "schedule:work"]

  mysql:
    image: mysql:8.0
    restart: unless-stopped
    command: ["--character-set-server=utf8mb4", "--collation-server=utf8mb4_unicode_ci"]
    environment:
      MYSQL_ROOT_PASSWORD: "root"
      MYSQL_DATABASE: "ssai_crm"
    ports:
      - "3306:3306"
    volumes:
      - mysql-data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "mysqladmin", "ping", "-h", "127.0.0.1", "-uroot", "-proot"]
      interval: 5s
      timeout: 5s
      retries: 20
      start_period: 20s
    networks: [ssai-dev]

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 5s
      retries: 20
    networks: [ssai-dev]

volumes:
  mysql-data:
  redis-data:
  vendor:
  node_modules:

networks:
  ssai-dev:
    driver: bridge
```

- [ ] **Step 2: Validate the dev compose renders**

Run: `docker compose config >/dev/null && echo "DEV COMPOSE OK"`
Expected: `DEV COMPOSE OK` (this uses `compose.yaml` by default; needs no env file).

- [ ] **Step 3: Confirm the project name + isolation**

Run: `docker compose config | grep -E 'name:|ssai-dev' | head -3`
Expected: shows `name: ssai-dev`.

- [ ] **Step 4: Confirm PROD compose still renders (untouched)**

Run:
```bash
SITE_ADDRESS=example.com docker compose -f compose.prod.yaml -f compose.caddy.yaml config >/dev/null && echo "PROD COMPOSE OK"
```
Expected: `PROD COMPOSE OK`.

- [ ] **Step 5: Confirm prod files are unmodified by this branch**

Run:
```bash
git status --porcelain -- compose.prod.yaml compose.caddy.yaml .env.docker.example docker/entrypoint.sh docker/nginx/default.conf docker/php docker/php-fpm
echo "exit: done"
```
Expected: **no output** before `exit: done` (none of the prod files changed).

- [ ] **Step 6: Commit**

```bash
git add compose.yaml
git commit -m "feat(dev): add compose.yaml — isolated full-stack local dev with live reload

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Document the dev workflow (README + CLAUDE.md pointer)

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Add a "Local dev with Docker" section to `README.md`**

Insert immediately AFTER the existing `composer run dev` local-setup block (before the `## Tests` heading):
````markdown
## Local dev with Docker

A full-stack local environment in containers with live reload — separate from the
prod stack, so it never touches `compose.prod.yaml` / `.env.docker`:

```bash
cp .env.docker.dev.example .env.docker.dev   # required (git-ignored); add AI keys if wanted
docker compose up -d --build                 # first run: builds the dev image, installs deps
docker compose logs -f vite                   # watch HMR / build output
```

App → http://localhost:8000 · Vite HMR → :5173 · MySQL → :3306 · Reverb → :8080.
Edit a `.vue` file and the browser hot-reloads; PHP edits apply on the next
request; `engine/*` edits restart the engine. `docker compose down` stops the
stack and **keeps** the dev DB; `docker compose down -v` resets it. The stack is
`name: ssai-dev`, fully isolated from prod
(`docker compose -f compose.prod.yaml -f compose.caddy.yaml …`).
````

- [ ] **Step 2: Add a one-line dev pointer to `CLAUDE.md` Workflow**

In `CLAUDE.md`, immediately after the `- **Run**: \`composer run dev\` …` bullet in the `## Workflow` section, add:
```markdown
- **Run (Docker)**: `docker compose up -d --build` — full stack in containers with live
  reload (`compose.yaml`, `name: ssai-dev`), isolated from prod. See `README.md` → "Local
  dev with Docker". Requires `cp .env.docker.dev.example .env.docker.dev` first.
```

- [ ] **Step 3: Verify the doc references resolve**

Run:
```bash
test -f .env.docker.dev.example && test -f compose.yaml && grep -q "Local dev with Docker" README.md && grep -q "Run (Docker)" CLAUDE.md && echo "DOCS OK"
```
Expected: `DOCS OK`

- [ ] **Step 4: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs(dev): document the local Docker dev workflow

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Final verification (after all tasks)

- [ ] **Prod untouched:** `git diff --stat -- compose.prod.yaml compose.caddy.yaml .env.docker.example docker/entrypoint.sh docker/nginx/default.conf docker/php docker/php-fpm` (working tree vs HEAD) and the same across the feature range both print nothing.
- [ ] **Dev compose valid:** `docker compose config >/dev/null && echo OK`.
- [ ] **Prod compose valid:** `SITE_ADDRESS=example.com docker compose -f compose.prod.yaml -f compose.caddy.yaml config >/dev/null && echo OK`.
- [ ] **Host dev intact:** `vite.config.ts` diff shows the non-`VITE_DOCKER` branch keeps `host: '127.0.0.1'`.
- [ ] **Live smoke (manual, heavy — run once):**
  ```bash
  cp .env.docker.dev.example .env.docker.dev
  docker compose up -d --build
  # wait for build + composer install, then:
  curl -fsS http://localhost:8000/up && echo " APP UP"
  ```
  Then in a browser: open `http://localhost:8000`, edit a `.vue` file, confirm the page hot-reloads; edit a `.php` file, confirm it applies on refresh. Tear down with `docker compose down`.
