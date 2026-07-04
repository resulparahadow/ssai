# Fan Customer Profile — persisted per-fan memory for live AI generation

**Date:** 2026-07-03 · **Status:** approved, implementing

## Problem

Conversations became a live OnlyFans proxy that persists nothing, so the AI
`generateFromLive` path passes a **null `_profile`** and **$0 spend**. The legacy
pipeline drew the customer-memory half of its inputs from the `customer_profiles`
model (trust, archetype, temperature, key_details) and spend from the session.
Without them, every live fan looks like a brand-new never-spent lurker to the
brain: posture skews to WARM_BUILD/frame-hold, trust caps at 1, the depth gate
always clamps, TIMEWASTER-immunity never grants, and whale/tip-primary detection
never fires.

## Goal

Restore the legacy `customer_profiles` contribution to the AI on the live path —
**auto-filled by the analysis each generate, with per-field human override** —
and fold in the cheap OF spend fetch so spend-driven telemetry comes alive.

Out of scope (explicitly deferred, separate specs):
- Per-message PPV/`opened`/`price` mapping into the thread (wall/ladder/miss-lockout).
- Multi-turn forcing-move continuation state (`_promiseStatus`, `_storyFrameworkStep`).
- `vn_used`, `time_on_page`.
- DB-session path (`buildPayload`) — it already reads `customer_profiles`, unchanged.

## Decisions (locked)

1. **Populate mode:** auto-fill (AI analysis) **+** manual override.
2. **Record scope:** memory **+** per-fan behavior toggles (sexting/tip mode, manual TW).
3. **Merge:** per-field lock — a human-edited field is pinned; auto fills only unpinned.
4. **Storage:** Approach A — extend the existing `customer_profiles` table/model.
5. **Spend:** fold in the OF fan spend fetch to populate `total_spend`/`tips_spend`.

## Part 1 — Data model + generate-time flow

### Schema (one migration extending `customer_profiles`)

New columns:

| Column | Type | Purpose |
|---|---|---|
| `of_fan_id` | string, nullable, indexed | Stable OF fan id = the chat id; the live-world key |
| `locked_fields` | json, nullable | Pinned AI-field names, e.g. `["archetype","trust_level"]` |
| `sexting_mode` | string, default `AUTO` | `AUTO \| FORCE_ON \| FORCE_OFF` |
| `tip_mode` | string, default `AUTO` | `AUTO \| FORCE_ON \| FORCE_OFF` |

New unique index `(creator_model, of_fan_id)`. All other needed columns already
exist (`archetype`, `trust_level`, `temperature`, `key_details`, `crm_notes`,
`is_timewaster`, `total_spend`, `tips_spend`, `subscription_status`).

`key_details` cast changes `array` → `text` (the AI memory log is a string; the
legacy DB path fed memory from `crm_notes`). Field roles standardize to:
**`key_details` = AI memory log (text)**, **`crm_notes` = human notes (text)**.

### Field ownership

- **AI-owned, lockable:** `archetype`, `trust_level`, `temperature`, `key_details`
  — auto-written each generate unless the field name is in `locked_fields`.
- **OF-owned, always overwritten from OF:** `total_spend`, `tips_spend`,
  `subscription_status` — never manual, never locked.
- **Human-owned, always manual:** `crm_notes`, `is_timewaster`, `sexting_mode`,
  `tip_mode` — no AI counterpart, no lock needed.

### Generate-time flow (`EngineClient::generateFromLive`)

1. `firstOrNew(['creator_model' => model.name, 'of_fan_id' => customer.id])`.
2. Refresh spend from OF (`getUser` → `subscribedByData`/`subscribedOnData` totals,
   read defensively); write `total_spend`/`tips_spend`/`subscription_status`.
   Non-blocking: on failure keep last-known values.
3. Build `_profile` from the record (`trust_level, archetype, temperature,
   total_spend, tips_spend, key_details, crm_notes`) instead of `null`; set session
   `total_spend`/`tips_spend`, real `subscription_status`, `_sextingModeToggle` =
   `sexting_mode`, `_tipModeToggle` = `tip_mode`.
4. Run the engine unchanged → strategy + draft.
5. Write-back (folded analysis): for each AI-owned field **not** in `locked_fields`,
   copy from the returned `strategy` (`trust_level/archetype/temperature/key_details`)
   onto the record; `save()`. Failure is logged, never blocks the response.

Persistence note: still **no message text** — only derived memory + toggles +
OF-sourced spend. Consistent with `AichChatIntel` (strategy-only) and
`aich_usage_events` (metadata-only). Document the carve-out in CLAUDE.md.

## Part 2 — API + UI

### Endpoints (under the existing `onlyfans/{model}` group, `account()`-scoped)

- `GET  onlyfans/{model}/chats/{chat}/profile` → the fan's profile
  (memory + toggles + read-only spend + `locked_fields`); returns a default,
  unpersisted shape when none exists yet.
- `PATCH onlyfans/{model}/chats/{chat}/profile` → update editable fields.
  Each AI-owned field present in the body is set **and pinned** (added to
  `locked_fields`). An optional `unlock: [..]` array un-pins named fields (and
  clears them so the next generate refills). Toggles/notes just set.

`chat` = `of_fan_id`. JSON 422 on validation (throw `HttpResponseException` like
`ModelOnlyFansController::validateJson`, since these routes aren't under `api/*`).

### Client (`resources/js/lib/onlyfans.ts`)

`ofApi.getProfile(model, chat)` and `ofApi.saveProfile(model, chat, payload)`.

### UI (`SsFanPanel.vue`, Fan tab, right rail)

A "Memory & Controls" card:
- AI-owned (each with a lock toggle + pinned/AI indicator): Trust level (0–5),
  Archetype (text), Temperature (cold/warm/hot), Key details (textarea).
- Human: CRM notes (textarea).
- Toggles: Sexting mode (AUTO/ON/OFF), Tip-led (AUTO/ON/OFF), Timewaster (checkbox).
- Read-only from OF: Total spent, Tips.
- Load on chat open (GET); Save (PATCH). Reset-per-chat like the AI Intel tab.

## Error handling

- OF spend fetch failure → swallow, keep last-known (like `fetchActiveCreatorStatus`).
- Missing `customer.id` → skip persistence, run transient as today (graceful degrade).
- Write-back failure → log, still return the draft.
- Access → `account()` (chatter assigned only); same as the rest of the controller.

## Testing (Pest, in-memory SQLite; engine faked)

- Generate auto-creates the profile keyed by `(creator_model, of_fan_id)`.
- Write-back updates unlocked AI fields from strategy; skips locked ones.
- PATCH pins edited fields; a following generate does not clobber them; `unlock` re-opens.
- OF spend populates `total_spend`/`tips_spend`.
- Access scope: a chatter is blocked from an unassigned creator's profile.
