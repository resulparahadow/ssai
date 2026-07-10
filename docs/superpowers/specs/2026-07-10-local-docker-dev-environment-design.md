# Local Docker dev environment (full stack, live-reload)

**Date:** 2026-07-10
**Status:** Design approved — ready for implementation plan

## Purpose

Give developers a **full-stack local environment that runs entirely in Docker**
and **reflects source changes live** (no image rebuild per edit), **without
touching the production Docker configuration**. Today local dev is host-based
(`composer run dev`: `php artisan serve` + Vite + queue + reverb, against a host
MySQL); prod is `compose.prod.yaml` + `compose.caddy.yaml` + `.env.docker`. This
adds a third, independent path: `docker compose up`.

## Hard constraints

- **Prod is never modified:** `compose.prod.yaml`, `compose.caddy.yaml`,
  `.env.docker`, `.env.docker.example`, `docker/entrypoint.sh`, and the prod
  Dockerfile **targets** (`app`/`web`/`engine`) stay byte-for-byte unchanged.
- **Isolation:** dev uses its own env file, its own named volumes, and its own
  Compose project name, so it can never read or clobber prod state (and both can
  coexist on one machine).
- **Live reflection:** editing PHP, Vue, or engine code shows up without a
  rebuild — PHP on next request, Vue via hot-module-reload, engine via watch.

## Decisions (from brainstorming)

- **Topology:** full stack in Docker (php-fpm + nginx + Vite + engine + reverb +
  queue + scheduler + mysql + redis). Not the hybrid/Sail options.
- **Invocation:** the dev file is named **`compose.yaml`** (Compose's default), so
  `docker compose up` == dev with no flags; prod stays explicit
  (`-f compose.prod.yaml -f compose.caddy.yaml`).
- **Dev image:** add a **`dev` stage** to the existing `Dockerfile`
  (`FROM php-base AS dev`), reusing the prod PHP extensions. Prod build targets
  are not changed. (A separate `docker/dev/Dockerfile` was the alternative; the
  added stage is DRYer and leaves prod builds identical.)
- **Env & secrets:** committed `.env.docker.dev.example` (blank provider keys) +
  git-ignored `.env.docker.dev` (dev copies + fills), mirroring the prod
  `.env.docker` / `.env.docker.example` pattern.

## Architecture

```
Browser ──▶ web (nginx :8000→80) ──FastCGI──▶ app (php-fpm :9000, Laravel)
Browser ──▶ vite (:5173, HMR)          # JS/CSS served by Vite dev server, hot-reload
Browser ──▶ reverb (:8080)             # websockets, direct (no proxy in dev)
        app/queue/reverb/scheduler ──▶ mysql:3306, redis:6379, engine:8787  (internal)
```

Source (`./`) is bind-mounted at `/var/www/html` into every app-side container,
so code is read live. `vendor/` and `node_modules/` are **named volumes layered
over the bind mount** — this both fixes the macOS↔Linux binary mismatch and
avoids syncing huge dependency trees over the host filesystem. In dev the browser
loads assets from the Vite dev server (via Laravel's `public/hot` file), and talks
to Reverb directly on `:8080`, so nginx does not need to proxy `/app` — the
existing `docker/nginx/default.conf` is reused as-is.

## Components / files

### New files
1. **`compose.yaml`** — dev stack. Top-level `name: ssai-dev`. Services:
   - `app` — build `target: dev`; `command: php-fpm`; mounts source + `vendor`
     volume + the dev env; `depends_on` mysql+redis; dev entrypoint.
   - `web` — `nginx:alpine`; mounts source (for `public/`) + reuses
     `docker/nginx/default.conf`; publishes `8000:80`.
   - `vite` — `node:22-alpine`; mounts source + `node_modules` volume;
     `command: sh -c "npm ci && npm run dev -- --host 0.0.0.0"`; `VITE_DOCKER=1`;
     publishes `5173:5173`.
   - `engine` — `node:22-alpine`; mounts source; `command: node --watch engine/server.js`;
     provider keys from the dev env; publishes `8787` (optional).
   - `reverb` — `dev` image; `command: php artisan reverb:start --host=0.0.0.0 --port=8080`;
     publishes `8080:8080`.
   - `queue` — `dev` image; `command: php artisan queue:listen --tries=1` (listen,
     not work, so jobs pick up code edits).
   - `scheduler` — `dev` image; `command: php artisan schedule:work`.
   - `mysql` — `mysql:8.0`; volume `mysql-data`; publishes `3306:3306`.
   - `redis` — `redis:7-alpine`; volume `redis-data`.
   - Named volumes: `mysql-data`, `redis-data`, `vendor`, `node_modules`
     (namespaced under `ssai-dev_*`).
2. **`docker/dev/entrypoint.sh`** — wait for MySQL → `composer install` if
   `vendor/` is empty → `php artisan migrate --no-interaction` → `storage:link`.
   **Deliberately NO `optimize`/config:cache** so env + code changes reflect live.
3. **`docker/dev/php-dev.ini`** — `opcache.enable=0` (PHP edits apply next request);
   dev-friendly `display_errors=On`, larger `upload_max_filesize`.
4. **`.env.docker.dev.example`** — committed template: `APP_ENV=local`,
   `APP_DEBUG=true`, `APP_URL=http://localhost:8000`, a throwaway dev `APP_KEY`,
   `DB_HOST=mysql`/`DB_DATABASE=ssai_crm`/dev creds, `REDIS_HOST=redis`,
   `SESSION/CACHE/QUEUE` via redis (mirrors prod), `BROADCAST=reverb` with
   `REVERB_HOST=reverb` (server) / `VITE_REVERB_HOST=localhost`+`8080`+`http`
   (browser), `ENGINE_URL=http://engine:8787`, `MAIL_MAILER=log`, and **blank**
   `ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`/`ONLYFANS_API_KEY`.

### Modified files (dev-only additions; prod behavior unchanged)
5. **`Dockerfile`** — append one stage: `FROM php-base AS dev` + composer (copied
   from the `composer:2` image) + `git`/`unzip`. No `COPY` of source (bind-mounted
   at runtime). Prod stages are untouched and still build identically.
6. **`vite.config.ts`** — env-guarded block: when `process.env.VITE_DOCKER` is set,
   use `server.host='0.0.0.0'` and `server.hmr.host='localhost'` (+ `hmr.clientPort:5173`)
   so browser HMR and asset URLs resolve to `localhost:5173`. When the flag is
   unset (host dev, `composer run dev`), behavior is **identical to today**
   (`host:'127.0.0.1'`).
7. **`.gitignore`** — add `.env.docker.dev` (the filled-in dev env is local-only).
8. **`README.md`** — a short "Local dev with Docker" subsection (usage below);
   `CLAUDE.md` Workflow gets a one-line pointer (follow-up doc task).

### Env loading
Dev containers must use `.env.docker.dev`, never the host `.env` (which points at
`127.0.0.1`). Mechanism: **bind-mount `./.env.docker.dev` over `/var/www/html/.env:ro`**
in every container that reads Laravel/Vite/engine env — `app`, `queue`, `reverb`,
`scheduler`, `vite`, and `engine` (the engine auto-loads provider keys from `.env`).
This is deterministic (Laravel/Vite/engine read exactly that file; the host `.env`
never applies) and read-only (nothing rewrites it). `VITE_DOCKER=1` is set via the
`vite` service's `environment:` (it's read through `process.env` in `vite.config.ts`,
not the dotenv file). `mysql`/`redis`/`web` don't need the app env.

## Usage

```bash
cp .env.docker.dev.example .env.docker.dev   # fill provider keys if you want AI generate
docker compose up -d --build                 # first run: builds dev image, installs deps
docker compose up -d                          # day-to-day
docker compose logs -f vite                   # HMR / build output
docker compose exec app php artisan migrate   # ad-hoc artisan
docker compose down                           # stop; KEEPS the dev DB volume
docker compose down -v                        # reset the dev DB (dev only!)
```

- App: `http://localhost:8000` · Vite: `:5173` · MySQL: `:3306` · Reverb: `:8080`.
- Edit a `.vue` file → browser hot-reloads. Edit a `.php` file → next request. Edit
  `engine/*` → engine restarts.

## Testing / verification

- `docker compose config` renders cleanly (dev file valid).
- `docker compose -f compose.prod.yaml -f compose.caddy.yaml config` still renders
  (prod untouched) and `git diff` shows no changes to prod files.
- `composer run dev` (host path) still works unchanged (VITE_DOCKER unset).
- Manual acceptance: `up -d --build` → all services healthy → `http://localhost:8000`
  loads → change a Vue file and see HMR → change a PHP file and see it on refresh →
  (with keys) engine `generate` works.

## Out of scope (YAGNI)

Xdebug (easy to add later via the dev php.ini + a compose env line), Mailpit,
production-parity TLS locally, a `sail`-style wrapper CLI, SSR. Named as future
add-ons, not built now.
