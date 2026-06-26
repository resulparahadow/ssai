# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

SmartStars CRM — a Laravel + Inertia + Vue rewrite of the legacy browser app. The
goal is to scale the product (proper backend + frontend separation, real
server-side logic, role-based access) behind the `SSAI-new-design.html` design.

**This rewrite is being built in phases.** Phase 1 (done): foundation — repo
restructure, Laravel scaffold, MySQL schema mirror, auth/roles, AI provider
boundary, OnlyFans webhook stub. Phase 2 (done): the SmartStars design shell
(sidebar/topbar/theme/role-preview) + the Overview dashboard wired to real,
role-scoped data. Phase 3 (done): the legacy generation engine runs **exactly**
inside the project via a Node sidecar (`engine/`) — Laravel calls it over HTTP.
Later phases build the other CRM views and may port the engine to PHP. See
`docs/superpowers/specs/` for the specs.

## Stack

- **Laravel 13.x**, PHP 8.3+
- **Inertia 2 + Vue 3 + Vite** (TypeScript) — the `--vue` starter kit; auth via **Fortify**
- **MySQL 8** (`ssai_crm` database)
- **Pest** for tests · Tailwind for styling

## Repository shape

```
.
├── app/
│   ├── Enums/UserRole.php            ← admin | manager | chatter (+ capability helpers)
│   ├── Models/                       ← Eloquent mirror of the legacy schema
│   │   ├── Concerns/BelongsToChatter.php   ← auto-stamps user_id + applies access scope
│   │   └── Scopes/CreatorAccessScope.php   ← row-level access (replaces Supabase RLS)
│   ├── Services/
│   │   ├── AI/{AnthropicService,MistralService}.php   ← server-held keys (proxy ports, STUBS)
│   │   ├── OnlyFans/OnlyFansService.php               ← OF client (helpers real, sync STUB)
│   │   └── Doctrine/DoctrineService.php               ← active row + integrity hash
│   ├── Http/Controllers/Webhooks/OnlyFansWebhookController.php  ← webhook STUB
│   └── Providers/AppServiceProvider.php  ← role gates defined in configureGates()
├── database/migrations/              ← schema (mirror of legacy Supabase tables + doctrines)
├── resources/
│   ├── css/app.css                   ← Tailwind v4 + SmartStars design tokens (ss-* utilities)
│   └── js/
│       ├── layouts/SmartStarsLayout.vue   ← CRM design shell (routed in app.ts for Dashboard)
│       ├── components/crm/                ← SsSidebar, SsTopbar, Ss{Sparkline,Donut,BarChart}
│       ├── composables/useCrmShell.ts     ← sidebar-collapse + admin role-preview state
│       ├── crm/nav.ts                     ← nav tree + PERM matrix + ssColor()
│       └── pages/Dashboard.vue            ← Overview view (real data via DashboardController)
├── routes/web.php                    ← inertia routes + webhooks/onlyfans
├── tests/Feature/                    ← Pest (CreatorAccess, RoleGate, OnlyFansWebhook, +starter)
├── engine/                           ← Node sidecar that RUNS the real legacy generate()
│   ├── loadEngine.js                 ← loads legacy js into one vm context + bridges globals
│   ├── callModel.js                  ← headless callApi/callMistral (server keys)
│   ├── runGenerate.js                ← driver: payload → real generate() → draft/strategy/telemetry
│   └── server.js                     ← HTTP /generate, /health  (smoke.js, parity.js next to it)
├── app/Services/Engine/EngineClient.php  ← maps MySQL → legacy session shape, calls the engine
├── legacy/                           ← the ENTIRE old vanilla-JS app, archived read-only
│                                       (legacy/package.json restores CommonJS for tests/harness.js)
├── docs/superpowers/specs/           ← phase specs
└── SSAI-new-design.html              ← the design prototype (visual reference for Phase 2)
```

`legacy/` is the previous Supabase + vanilla-JS app (its own `legacy/CLAUDE.md`
and `legacy/DEV_SPEC.md` document it). It is reference only — not wired into the
new app. The behavioural IP (doctrine text, posture rules, generation pipeline)
still lives there and is ported later under coordination.

## Backend boundary

There is **no Supabase**. Laravel owns the database (MySQL), auth (Fortify +
sessions), and will own the AI calls. Provider API keys live in server config
(`config/services.php` → `anthropic`, `openrouter`, `onlyfans`) and **never**
reach the browser — an improvement over the legacy `ssai_*` proxy token.

## Schema

Migrations recreate the legacy tables faithfully (in-memory `_`-prefixed JS
telemetry fields are intentionally NOT persisted): `aich_models`,
`creator_status`, `customer_profiles`, `model_assignments`, `aich_sessions`,
`aich_messages`, `aich_events`, `aich_feedback_queue`, `aich_vn_used`. Postgres
`jsonb` → MySQL `json`. The legacy `chatters` RBAC folds into `users` (adds a
`role` enum + `must_change_password`). One intentional improvement: the doctrine
"brain" moves out of an `aich_models` row into its own versioned, hashed
`doctrines` table.

## Access control

- **Roles**: `admin | manager | chatter` (`App\Enums\UserRole`). Admin > Manager > Chatter.
- **Row-level**: `CreatorAccessScope` (a global scope on conversation models)
  restricts chatters to their assigned `creator_model`s; admins/managers are
  unrestricted; no authenticated user (console/seeders/tests) = no-op.
- **Ownership**: `BelongsToChatter` auto-stamps `user_id` on create (the legacy
  `installChatterIdAutoInject()`), applied to `AichSession`/`AichMessage`/`AichEvent`.
- **Feature gates**: `view-all-creators`, `manage-team` (manager+), `view-agency-profit`
  (admin only) — defined in `AppServiceProvider::configureGates()`. The Vue shell
  hides UI per role, but these gates are the actual enforcement.

## AI generation engine (Phase 3 — runs the exact legacy logic)

The legacy two-call pipeline runs **unmodified** in the `engine/` Node sidecar
(it loads the real `legacy/js/*.js`). Laravel never reimplements it: `EngineClient`
maps a MySQL `AichSession` (+ persona, profile, creator status) into the legacy
session shape and POSTs to `engine/server.js`; `GenerationController`
(`POST /conversations/{session}/generate`) persists the returned draft as a
draft-log `AichMessage`. The exact `DEFAULT_TRAINING` doctrine is seeded into the
`doctrines` table (sha `a1bcbcef…`, `DoctrineService::integrityOk()` passes) and the
engine uses its in-process copy. Provider keys live in the engine's env
(`ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`), never the browser.

- **Do NOT edit `legacy/js/*` to change behavior** — the engine's whole point is byte-identical parity. Enhancements go in `engine/` wrappers or the (future) PHP port.
- Parity guards: `node engine/parity.js`, `node engine/smoke.js`, `node legacy/tests/harness.js` (283/0).
- The `AnthropicService`/`MistralService` PHP stubs still THROW — a future PHP port
  (intended foundation: the first-party **Laravel AI SDK**) can replace the sidecar.

## Deferred to later specs (do NOT assume these exist)

- **Engine extras** — post-message analysis (`runAnalysis` / engine `/analyze`), PPV
  price suggestion, and the optional PHP port of the pipeline.
- **CRM views** — DONE: app shell + Overview dashboard (Phase 2), **Conversations**
  + **Creator Models** (Phase 4). The remaining design views (Chatting Performance,
  AI Usage, Smart Links, Channels, Creative, Content, Whales/Churn) are each their
  own spec — inert sidebar placeholders today.
  - **Conversations** (`/conversations`) — a **live OnlyFans proxy; NOTHING is persisted**
    (Phase 6 replaced the old DB-backed version). The sidebar "Conversations" item is a
    **dropdown of creator models** (shared `creators` prop from `HandleInertiaRequests`);
    picking one opens `/conversations?creator=<name>`. The Vue page fetches everything LIVE
    client-side (`resources/js/lib/onlyfans.ts`) via `OnlyFansChatController` (`/onlyfans/{model}/…`):
    list chats, list/get/search messages, chat media gallery, send (text-only), delete,
    like/unlike, fan details, and AI `generate` (a transient engine session built from the
    live thread — no DB row). Access is scoped in the controller (chatter → assigned creators).
  - **Creator Models** (`/models`, manager/admin via `can:manage-team`) — `ModelController`
    CRUD over `aich_models` (persona/library/rules/OF-id/tier) + chatter assignment sync.
- **OnlyFans live — DONE.** `OnlyFansService` (Bearer client, base `https://app.onlyfansapi.com/api`)
  is the proxy for chats/messages/media/send/delete/like/unlike/users; send is text-only (PPV
  blocked, v1). Needs `ONLYFANS_API_KEY` + `aich_models.of_account_id` per creator. Confirmed
  paths: `GET {acct}/chats`, `GET {acct}/chats/{chat}/messages[/{id}|/search]`, `GET {acct}/chats/{chat}/media`,
  `POST {acct}/chats/{chat}/messages` (send), `DELETE …/messages/{id}`, `POST …/messages/{id}/like|unlike`,
  `GET {acct}/users/{id}`. **Note:** `aich_sessions`/`aich_messages` are NO LONGER used by
  Conversations (kept only for the Dashboard + future analytics). STILL deferred: **webhook
  ingestion** (`messages.received` → thread) and **PPV/tip + media sends**.
- **Production data migration** from the old Supabase project.

## Workflow

- **Run**: `composer run dev` (serves app + vite + queue) or `php artisan serve` + `npm run dev`.
- **Engine**: `ANTHROPIC_API_KEY=… OPENROUTER_API_KEY=… node engine/server.js` (port 8787);
  exercise it at `/dev/generate`. Without keys the pipeline runs but returns an empty draft.
- **OnlyFans**: set `ONLYFANS_API_KEY` in `.env` + map `aich_models.of_account_id` (acct_…) per
  creator; then `/conversations` → pick the creator (sidebar) → chats/messages load **live**,
  Generate (engine) → Send posts live; like/unlike/delete/search/media all hit OnlyFans directly.
- **DB**: `php artisan migrate` (MySQL `ssai_crm`). Tests use in-memory SQLite.
- **Test**: `php artisan test` (Pest) · engine: `node engine/parity.js` + `node legacy/tests/harness.js`.
- **Build**: `npm run build`.
- **Lint/format**: Pint (PHP), ESLint + Prettier (JS/Vue).

## Conventions

- New conversation models that carry `creator_model` + `user_id` should
  `use BelongsToChatter`; if they carry `creator_model` only, add
  `CreatorAccessScope` directly (see `AichVnUsed`).
- Gate new manager/admin-only features in `configureGates()` rather than per-call-site.
- Keep provider keys in `config/services.php` + `.env`; never inline or ship to the client.
- New CRM views go under the design shell: add a `pages/*.vue`, route it to
  `SmartStarsLayout` in `app.ts`, add a `NAV` entry in `crm/nav.ts`, and style with
  the `ss-*` tokens / `font-ss` (not the starter's shadcn tokens, which stay for auth/settings).
- `npm run lint:check` / `types:check` must pass; `legacy/` is excluded from lint.
