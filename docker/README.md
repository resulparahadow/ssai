# Deploying SmartStars CRM with Docker

A single-host Docker Compose stack. One multi-stage [`Dockerfile`](../Dockerfile)
produces three images; [`compose.prod.yaml`](../compose.prod.yaml) wires them into
eight services.

## Services

| Service     | Image target | Role                                              | Port |
|-------------|--------------|---------------------------------------------------|------|
| `web`       | `web`        | nginx — static assets + proxy to PHP + Reverb ws  | 80   |
| `app`       | `app`        | PHP-FPM (Laravel). Runs migrations on boot        | 9000 |
| `queue`     | `app`        | `queue:work` (Redis)                              | —    |
| `reverb`    | `app`        | `reverb:start` websocket server                   | 8080 |
| `scheduler` | `app`        | `schedule:work`                                   | —    |
| `engine`    | `engine`     | Node sidecar running the legacy generation engine | 8787 |
| `mysql`     | `mysql:8.0`  | database (`ssai_crm`)                              | 3306 |
| `redis`     | `redis:7`    | cache / sessions / queue / Reverb scaling         | 6379 |

`app`, `queue`, `reverb`, and `scheduler` all share the single `ssai/app:latest`
image built once by the `app` service — different `command`s, same code.

## First deploy

The stack uses a dedicated **`.env.docker`** (not `.env`), so it never collides
with the local-dev `.env` used by `composer run dev`. Because that file isn't the
compose default, every command needs `--env-file .env.docker -f compose.prod.yaml`.
Set them once per shell to make plain `docker compose ...` work:

```bash
export COMPOSE_FILE=compose.prod.yaml
export COMPOSE_ENV_FILES=.env.docker
```

Then:

```bash
# 1. Configure environment
cp .env.docker.example .env.docker

# 2. Generate an app key and paste it into APP_KEY= in .env.docker
docker run --rm ssai/app:latest php artisan key:generate --show
# ...also set REVERB_APP_ID / _KEY / _SECRET, DB passwords, provider API keys,
#    and VITE_REVERB_HOST=<your public domain> (baked into the JS at build time).

# 3. Build, launch, watch (every service should report healthy)
docker compose build
docker compose up -d
docker compose ps
docker compose logs -f app
```

Without the exports, pass the flags explicitly, e.g.:

```bash
docker compose --env-file .env.docker -f compose.prod.yaml up -d
```

The `app` container's entrypoint waits for MySQL, runs `php artisan migrate --force`
(only `app` has `RUN_MIGRATIONS=true`), runs `php artisan storage:link`, then
`php artisan optimize` (config/route/view/event cache) before starting PHP-FPM.

## Seeding data

The stack runs migrations automatically; it does **not** seed. Seed the minimal
real data (a first admin + a single `Test` creator model — no demo roster) with
`ProductionSeeder`. Set `ADMIN_PASSWORD` (and optionally `ADMIN_EMAIL`,
`ADMIN_NAME`, `TEST_MODEL_OF_ACCOUNT_ID`) in `.env.docker` first, then either:

```bash
# One-off, against the running stack (recommended):
docker compose exec app php artisan db:seed --class=ProductionSeeder --force
```

or let the app container seed itself on boot (opt-in, app-service only, idempotent):

```bash
RUN_SEEDERS=true docker compose up -d app
```

`ProductionSeeder` is idempotent (`updateOrCreate`), so re-running it is safe. It
deliberately skips the demo seeders (`DashboardSeeder`, `ConversationsDemoSeeder`)
and the `doctrines` table (unused by the running app; the engine has its own copy).

## TLS / public exposure

`web` listens on plain HTTP :80. Terminate TLS in front of it with your existing
reverse proxy (or add a Caddy/Traefik service). Because Laravel Echo connects to
`wss://<VITE_REVERB_HOST>:443/app/...`, the TLS proxy must forward `/app` (and its
websocket `Upgrade`) through to `web`, which proxies it on to the `reverb` container.

## Common operations

These assume the `COMPOSE_FILE` / `COMPOSE_ENV_FILES` exports above (otherwise add
`--env-file .env.docker -f compose.prod.yaml`).

```bash
# Tinker / artisan in the running app
docker compose exec app php artisan about
docker compose exec app php artisan migrate:status

# Rebuild after a code change. The app image carries the compiled assets and
# publishes them into the shared `assets` volume on start; nginx serves from
# that volume, so you do NOT need to rebuild web to avoid stale/404 assets.
docker compose build app
docker compose up -d app queue reverb scheduler
# (rebuild web only when you change docker/nginx/default.conf)

# Tail a specific service
docker compose logs -f reverb
```

## Notes & gotchas

- **Rebuild to change the public Reverb host.** `VITE_REVERB_*` are compiled into
  the browser bundle at build time. Update `.env` then rebuild `app` + `web`.
- **Reverb is decoupled**: `REVERB_HOST=reverb` (server → container, internal) vs
  `VITE_REVERB_HOST=<domain>` (browser → public). Don't collapse them.
- **Provider keys** reach the engine via container env (compose passes them); the
  engine falls back to `process.env`, so no `.env` file is needed inside it.
- **Multi-replica app?** Move migrations out of the `app` entrypoint into a
  one-shot service instead, so they run exactly once:

  ```yaml
  migrate:
    image: ssai/app:latest
    command: ["php", "artisan", "migrate", "--force"]
    env_file: [.env]
    depends_on: { mysql: { condition: service_healthy } }
    restart: "no"
  ```

  Then drop `RUN_MIGRATIONS=true` from `app` and add `depends_on: [migrate]`.
- **Compiled assets** live in the `assets` volume, published by the `app`
  container's entrypoint from the app image and served read-only by nginx. This
  makes the app image the single source of truth for `public/build`, so nginx
  can never serve a manifest that mismatches the app (no `/build/*.js` 404s).
  Rebuild `app` and `up -d app`; the new assets propagate to nginx automatically.
- **Persistent data** lives in the `mysql-data`, `redis-data`, and `storage`
  named volumes. Back these up; `docker compose down` (without `-v`) keeps them.
