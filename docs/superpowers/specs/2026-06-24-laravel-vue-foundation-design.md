# SmartStars CRM — Laravel + Vue Migration: Foundation (Phase 1)

**Date:** 2026-06-24
**Status:** Phase 1 implemented
**Supersedes:** the legacy vanilla-JS + Supabase app (now in `legacy/`)

## Context

The legacy app is a no-build browser SPA: ~8,800-line `app.js` holding all
business logic (posture engine, doctrine, two-call generation pipeline,
detectors, validators), talking to Supabase (Postgres + RLS + Auth + Edge
Functions that proxy Anthropic/Mistral/OnlyFans). Roles were `manager | chatter`.

The goal is to **scale**: move to a real backend + frontend, protect the
behavioural IP server-side, and ship the richer `SSAI-new-design.html` CRM
(9 views, roles `admin | manager | chatter`).

This is a multi-subsystem effort, so it is decomposed into phases. This spec
covers **Phase 1: the foundation**.

## Key decisions (brainstorm)

1. **Laravel owns everything.** Supabase is retired. Laravel holds its own DB,
   auth, business logic, and the AI provider keys. Single source of truth; real
   server-side IP protection. (Alternatives considered: hybrid Laravel+Supabase
   DB; thin Laravel layer over Supabase — both rejected as not truly consolidating.)
2. **Inertia.js monolith** (Vue pages through Inertia, Fortify auth, single
   deploy) over a decoupled SPA+API. Fastest, idiomatic for a multi-role CRM.
   A real API can be added later if a mobile/3rd-party client is needed.
3. **Phase 1 = foundation + (next) Dashboard slice.** The AI engine port and the
   other 8 CRM views are their own later specs — the engine (crown-jewel IP) is
   too risky to port in the foundation pass.

## Stack

Laravel 13.x · PHP 8.3+ · Inertia 2 + Vue 3 + Vite (TS) · MySQL 8 · Fortify ·
Pest · Tailwind. (Laravel 13 ships a first-party AI SDK — the intended
foundation for the deferred engine port.)

## What Phase 1 delivered

### Repo restructure
- Entire old app moved to `legacy/` (read-only reference, incl. its CLAUDE.md/DEV_SPEC.md).
- Laravel project scaffolded at repo root via the `--vue` starter kit.
- `SSAI-new-design.html` kept at root as the Phase 2 visual reference.

### Database (MySQL `ssai_crm`)
Migrations recreate the legacy schema faithfully. Postgres `jsonb` → MySQL
`json`; in-memory `_`-prefixed JS telemetry fields are **not** persisted.

| Legacy | New | Notes |
|--------|-----|-------|
| `chatters` | `users` (+ `role`, `must_change_password`) | RBAC folded into users |
| `model_assignments` | `model_assignments` | `user_id` FK + `creator_model` |
| `aich_models` | `aich_models` | personas + content libs |
| `creator_status` | `creator_status` | active = not past `expires_at` |
| `customer_profiles` | `customer_profiles` | long-term memory; effective spend = total+tips |
| `aich_sessions` | `aich_sessions` | OF `(creator_model, of_chat_id)` unique TOCTOU guard |
| `aich_messages` | `aich_messages` | dual-purpose; `of_message_id` unique dedup |
| `aich_events` | `aich_events` | analytics event log |
| `aich_feedback_queue` | `aich_feedback_queue` | manager corrections |
| `aich_vn_used` | `aich_vn_used` | per-customer VN usage |
| `__global_training__` row | **`doctrines` table** | *improvement:* versioned + sha256 |

### Access control (replaces Supabase RLS)
- `App\Enums\UserRole` (admin > manager > chatter) with capability helpers.
- `CreatorAccessScope` global scope: chatters limited to assigned creator models;
  admins/managers unrestricted; no-auth (console/seed/test) = no-op.
- `BelongsToChatter` trait: auto-stamps `user_id` on create (legacy
  `installChatterIdAutoInject()`) + applies the scope.
- Gates `view-all-creators`, `manage-team` (manager+), `view-agency-profit`
  (admin) in `AppServiceProvider::configureGates()` — server-side enforcement
  behind the design's role-gated widgets.

### Service boundary (replaces Edge Functions)
- `AI\AnthropicService`, `AI\MistralService` — keys from `config/services.php`,
  never sent to the browser. Method bodies THROW (engine port deferred).
- `OnlyFans\OnlyFansService` — pure helpers (`htmlToText`, `ppvBlocked`) ported;
  live sync/send deferred.
- `Doctrine\DoctrineService` — active-row accessor + sha256 integrity check.
- `Webhooks\OnlyFansWebhookController` + `POST /webhooks/onlyfans` (secret-verified
  stub; CSRF-exempt).

### Tests
Pest, in-memory SQLite. Full suite green (**48 tests / 157 assertions**),
including new coverage for the access scope, chatter auto-injection, JSON/decimal
casts, role gates, and the webhook. `npm run build` passes.

## Deferred — future phases (each its own spec)

1. **App shell + Dashboard slice** (the planned next step): rebuild the design's
   sidebar/topbar/theme/role-switcher in Vue + wire the Dashboard to real
   role-scoped queries over seeded data.
2. **AI engine port**: posture/doctrine/two-call pipeline → PHP on the Laravel AI SDK.
3. **Remaining 7 CRM views**: Chatting Performance, AI Usage/Cost, Smart Links,
   Channels & Spend, Creative, Content, Whales & Churn.
4. **OnlyFans live integration**: sync + send + webhook session routing.
5. **Production data migration** from the old Supabase project.

## Out of scope / non-goals (Phase 1)
- No real AI generation (services throw).
- No design views rebuilt yet (starter pages only).
- No real customer data migrated (seeders/factories only).
