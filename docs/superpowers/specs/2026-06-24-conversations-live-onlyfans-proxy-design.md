# SmartStars CRM — Conversations as a Live OnlyFans Proxy (Phase 6)

**Date:** 2026-06-24
**Status:** Implemented
**Supersedes:** the DB-backed Conversations of Phases 4–5 (persisted `aich_sessions`/`aich_messages`, sync, lazy-load)

## Goal
OnlyFans is the source of truth. Conversations reads chats/messages and the fan panel **live**
from the API and writes (send/delete/like) straight to it — **nothing about a conversation is
persisted**. Implements the chat ops the user asked for: List Chats · List Chat Media (Gallery) ·
List/Get/Search Messages · Send · Delete · Like/Unlike. **Decisions:** fan intel = live OF only ·
keep AI Generate (transient session from live messages) · send text-only (PPV blocked).

## Confirmed API (base `…/api`, Bearer, `acct_…`) — verified live against the user's key
`GET {acct}/chats` · `GET {acct}/chats/{chat}/media` · `GET {acct}/chats/{chat}/messages` ·
`GET …/messages/{id}` · `GET …/messages/search` (needs `last_id`; UI falls back to client filter) ·
`POST …/messages` (send `{text}`) · `DELETE …/messages/{id}` · `POST …/messages/{id}/like` ·
`POST …/messages/{id}/unlike` · `GET {acct}/users/{id}`. Mutating ops depend on the OF account's
performer capabilities (surfaced as upstream errors).

## Backend
- `App\Services\OnlyFans\OnlyFansService` — thin Bearer client; each endpoint returns the raw
  HTTP `Response` (controller forwards status+body). 429 backoff. Pure normalisers
  (`normalizeChat`, `normalizeMessage`, `htmlToText`, `ppvBlocked`, `nextCursor`).
- `App\Http\Controllers\OnlyFansChatController` — authorised live proxy under
  `/onlyfans/{model}/…` (route-bound `AichModel`; `account()` helper checks access — manager/admin
  any, chatter only `assignedCreatorModels()` — and resolves `of_account_id`, 422 if unset).
  Endpoints: `chats, messages, message, search, media, send, destroy, like, unlike, user, generate`.
- `EngineClient::generateFromLive(model, messages, customer, opts)` — builds a transient legacy
  session from the live thread (no DB, no profile) and calls the engine sidecar.
- `ConversationController@index` — thin shell (only passes `selectedCreator`).
- `HandleInertiaRequests` `creators` shared prop now carries `{id, name, hasOf}` (id drives the
  live URLs; no session count).
- **Retired:** `ConversationPresenter`, `OnlyFansSyncService`, `OnlyFansController` (sync), the
  DB send/sync/lazy-load routes. `aich_sessions`/`aich_messages` tables remain for the Dashboard.
  The DB-session engine harness stays at `POST /dev/generate/{session}` (DevGenerate page).

## Frontend (client-driven, live)
- `resources/js/lib/onlyfans.ts` — `ofApi` client (XSRF) for all proxy endpoints.
- `pages/Conversations.vue` — resolves the model from `?creator` via the shared sidebar
  `creators`; fetches chats on model change, messages + fan on chat open; owns like/delete.
- `components/crm/conversations/`: `SsConvoList` (live chats + Refresh + filter), `SsChatThread`
  (live bubbles + per-message like/unlike + delete, header search with client fallback, media
  gallery overlay), `SsComposer` (Generate via live engine + Send to OnlyFans), `SsFanPanel`
  (live `users/{id}`).

## Verification
- `php artisan test` → 67 passed / 253 assertions; `OnlyFansChatTest` (Http::fake) covers
  list/messages/send (+PPV block)/like/unlike/delete (method+path), upstream-error forwarding,
  access-scoping (chatter 403 → assigned 200), 422 when no OF account, and `generate` building a
  transient engine session from the live thread (engine faked). `types:check`/`lint`/`build` clean.
- Live (user's key, read-only probes): chats/messages/get/media/users all 200; send/like/unlike/
  delete paths confirmed (gated by OF account capabilities).

## Out of scope (later)
Webhook ingestion (realtime inbound) · PPV/tip + media sends · mass messaging · message pagination
("load more") · persisted CRM intel/analysis · remaining design views.
