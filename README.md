# SmartStars CRM

Laravel + Inertia + Vue rewrite of the SmartStars AI chatting platform. This
replaces the legacy single-page browser app (archived in [`legacy/`](legacy/))
with a scalable backend + frontend, behind the new CRM design.

> **Status: Phase 1 — foundation.** Repo restructure, Laravel scaffold, MySQL
> schema, auth + roles, AI provider boundary, and the OnlyFans webhook stub are
> in place. The AI engine port and the CRM views land in later phases. See
> [`docs/superpowers/specs/`](docs/superpowers/specs/) and [`CLAUDE.md`](CLAUDE.md).

## Stack

Laravel 13 · PHP 8.3+ · Inertia 2 + Vue 3 + Vite (TypeScript) · MySQL 8 · Fortify auth · Pest · Tailwind.

## Local setup

```bash
composer install
npm install

cp .env.example .env          # then set DB + provider keys
php artisan key:generate

# create the database (defaults: mysql, root, no password)
mysql -u root -e "CREATE DATABASE IF NOT EXISTS ssai_crm CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
php artisan migrate

composer run dev              # app + vite + queue listener
# or: php artisan serve  +  npm run dev
```

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

## Tests

```bash
php artisan test             # Pest; uses in-memory SQLite
```

## Deploy with Docker

A production single-host stack (nginx + PHP-FPM, queue, Reverb, the Node engine,
MySQL, Redis) ships as one multi-stage [`Dockerfile`](Dockerfile) +
[`compose.prod.yaml`](compose.prod.yaml):

```bash
cp .env.docker.example .env.docker   # fill in APP_KEY, DB/Reverb secrets, provider keys
docker compose --env-file .env.docker -f compose.prod.yaml build
docker compose --env-file .env.docker -f compose.prod.yaml up -d
```

The stack uses a dedicated `.env.docker` so it never collides with the local-dev
`.env`. Tip: `export COMPOSE_FILE=compose.prod.yaml COMPOSE_ENV_FILES=.env.docker`
to drop the flags and just run `docker compose up -d`.

Full runbook — services, TLS, first-run, and gotchas — in
[`docker/README.md`](docker/README.md).

## Layout

| Path | What |
|------|------|
| `app/Models` | Eloquent mirror of the legacy schema (+ `Concerns`, `Scopes`) |
| `app/Services` | AI (Anthropic/Mistral), OnlyFans, Doctrine — server-side boundary |
| `app/Enums/UserRole.php` | `admin / manager / chatter` + capability helpers |
| `database/migrations` | schema (legacy tables + `doctrines`) |
| `resources/js` | Inertia + Vue frontend |
| `legacy/` | the previous vanilla-JS + Supabase app (reference only) |
| `SSAI-new-design.html` | the design prototype (Phase 2 visual reference) |

See [`CLAUDE.md`](CLAUDE.md) for architecture, access control, and the deferred-work list.
