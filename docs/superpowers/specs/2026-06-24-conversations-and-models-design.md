# SmartStars CRM — Conversations + Creator Models (Phase 4)

**Date:** 2026-06-24
**Status:** Implemented
**Builds on:** Phases 1–3 (foundation · dashboard · legacy engine sidecar)

## Goal
The two operational views: **Creator Models** (legacy model settings, manager/admin) and
**Conversations** (the design's chat view), reusing the legacy chat fetch/send logic over
our MySQL, with generation via the Phase-3 engine.

**Decisions:** single engine draft per generate · MySQL-backed chat (live OnlyFans deferred) ·
Models manager/admin-only.

## Backend
- `app/Services/Conversations/ConversationPresenter.php` — the one place mapping
  `AichSession` + `CustomerProfile` → the design shape (conversation card, thread bubble
  `from` fan|creator|ppv, fan-intel Profile/Intel/Memory/Sales). Real columns are exact;
  intel fields needing the deferred analysis pass are derived or `—`.
- `app/Http/Controllers/ConversationController.php` — `index` (role-scoped list via
  `CreatorAccessScope`, creator filter, selected detail; mirrors legacy `loadSessions`),
  `send` (`POST /conversations/{session}/messages` = legacy `acceptDraft`: append a sent
  `model` message to `aich_sessions.messages`, bump `free_msg_count`/`last_active_at`, insert
  `AichMessage was_sent=true`). Generate reuses the Phase-3 `GenerationController`.
- `app/Http/Controllers/ModelController.php` — `index/store/update/destroy/assignments`
  over `aich_models` (+ `model_assignments` sync). Routes gated by `can:manage-team`.
- Migration `…_change_aich_models_content_columns_to_text` — `content_library` +
  `feedback_rules` are freeform text (longText), not JSON.
- `ConversationsDemoSeeder` — Camila + Yendry personas, 5 conversations (jake/marcus/devin,
  theo/ray) with messages + `CustomerProfile` intel + chatter assignments.

## Frontend (design shell)
- `crm/nav.ts` — Conversations is now a real link (`/conversations`); added Creator Models
  (`/models`, cap `manageTeam`). `app.ts` routes both to `SmartStarsLayout`.
- `pages/Conversations.vue` + `components/crm/conversations/`: `SsConvoList` (filter+search+list),
  `SsChatThread` (bubbles), `SsComposer` (single engine draft + reason + posture + Regenerate +
  Send; design toolbar affordances inert), `SsFanPanel` (Profile/Intel/Memory/Sales).
- `pages/Models.vue` — per-model cards (tier · persona · content library · learned rules · OF id ·
  assigned chatters) with Save / Save assignments / Delete + Add.
- `lib/api.ts` — shared `postJson` (XSRF) for the interactive Generate/Send calls.

## Verification
- `php artisan test` → 62 passed / 247 assertions (incl. `ModelManagementTest` gating + CRUD,
  `ConversationsTest` admin-sees-all / chatter-scoped / send / auth).
- `npm run types:check` · `lint:check` · `build` clean; engine parity unaffected.
- Manual: `/models` edit a persona → Save; `/conversations` pick a chat → Generate (engine
  draft) → edit → Send (appears in thread); creator filter; chatter login → only assigned
  creators, no Models nav.

## Out of scope (later)
Live OnlyFans sync/send · PPV pricing + tip sends · incoming-message ingestion · post-message
analysis · GIF/scripts/media composer tools · remaining design views.
