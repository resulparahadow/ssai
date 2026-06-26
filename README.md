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

## Tests

```bash
php artisan test             # Pest; uses in-memory SQLite
```

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
