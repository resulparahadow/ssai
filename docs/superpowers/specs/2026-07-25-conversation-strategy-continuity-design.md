# Conversation Strategy Continuity (Package A)

**Date:** 2026-07-25
**Status:** Design — approved for planning
**Scope:** Restore turn-to-turn AI "brain memory" for the live Conversations generate
path, so the strategy builds on the ongoing conversation the way the legacy app did.

## Problem

The legacy app carried the AI's own prior decisions from one generation to the next:
the last strategy, the folded analysis (archetype / phase / message purpose / next
move), the planned next move (anti-drift), and forcing-move progress (promise ritual,
story framework). Legacy held these in a long-lived in-memory browser session and
persisted the durable subset (`ladder_state`, `promise_status`, `unpaid_cta_count`) to
`aich_sessions`, reading them back on reload.

The new live Conversations path is **stateless**: every `POST
onlyfans/{model}/chats/{chat}/generate` builds a throwaway `live-<fanId>` engine
session ([`EngineClient::generateFromLive`](../../../app/Services/Engine/EngineClient.php)),
hardcoding `_promiseStatus: 'not_started'`, `_storyFrameworkStep: 0`, and omitting
`_lastStrategy` / `_lastAnalysis` / `_nextPlannedMove` entirely. Consequences, all
verified against the legacy prompt construction in `legacy/js/app.js`:

- The generator's **"PREVIOUS AI ANALYSIS OF THIS CONVERSATION (act on this — do not
  ignore it)"** block (app.js ~6066) and the strategy call's **"Previous Analysis:
  …"** line (app.js ~6179) read `s._lastAnalysis`, which is always empty → the AI
  re-derives the customer from scratch every turn.
- The anti-drift forward plan (`computeLadderState` reads `s._nextPlannedMove`, app.js
  ~4834) resets every turn.
- Promise ritual / story framework restart every turn.

Net effect the user reported: *"the strategy doesn't adapt per customer / it forgets
the customer."*

This is **not** a chat-history problem — the live path already sends the full OnlyFans
thread to the model. These carried values were never in the message text; they were the
AI's internal decisions from prior turns. Reproducing legacy's continuity in a stateless
server requires **persisting those values and replaying them** — this spec.

## Goals

- Persist, per live chat, the AI's carried strategy state and replay it into the engine
  on the next generate, so the legacy continuity blocks populate and the brain builds on
  the conversation.
- Faithful to legacy for the dimension it covers: same session fields fed into the same
  unmodified legacy `generate()`.
- No message text persisted (consistent with the Conversations carve-out rule). Metadata
  only, like `aich_chat_intel` and `customer_profiles`.
- No extra billed AI calls. No edits to `legacy/js/*` behavior.

## Non-goals (explicitly deferred to Package B)

Anything that depends on in-thread money events, because the live path cannot yet see
which messages were paid PPVs / opened / priced / tipped:

- Pacing counters `_freeMsgCount` / `_unpaidCtaCount` and their reset-on-payment.
- Wall enforcement / PPV STATS / ladder tier + whale tracking.
- Sexting/tip AUTO gates that key off "paid this session."

Package A therefore closes the *conversation-memory* gap but **not** full legacy parity;
full parity = Package A + Package B. This is understood and accepted.

## Data model

New table **`aich_chat_state`** — one row per `(creator_model, chat_id)`, metadata only,
no message bodies. Same sanctioned carve-out pattern and scoping as `aich_chat_intel`.

| column                     | type                | notes                                              |
| -------------------------- | ------------------- | -------------------------------------------------- |
| `id`                       | bigint pk           |                                                    |
| `creator_model`            | string              | enables `CreatorAccessScope` + scoping             |
| `chat_id`                  | string              | opaque OF chat/fan id (= `of_fan_id`)              |
| `last_strategy`            | json nullable       | the strategy that shaped the last committed message |
| `last_analysis`            | json nullable       | folded analysis object (`_lastAnalysis` shape)     |
| `next_planned_move`        | string nullable     | anti-drift forward plan                            |
| `next_planned_move_at_msg` | integer nullable    | message index the plan was set at                  |
| `promise_status`           | string default `not_started` |                                          |
| `story_framework_step`     | integer default `0` |                                                    |
| `committed_by`             | foreignId users nullable, nullOnDelete |                                 |
| `timestamps`               |                     | `updated_at` = last commit time                    |
| unique                     | `(creator_model, chat_id)` | upsert target                               |

Model `App\Models\AichChatState` mirrors `AichChatIntel`: `$fillable`, `strategy`/
`last_analysis` cast to `array`, `CreatorAccessScope` in `booted()`.

## Engine change (surface existing values — no logic change)

`engine/runGenerate.js` already returns `telemetry.promiseStatus` and
`telemetry.storyFrameworkStep`. Add three fields it already computes internally:

- `lastAnalysis` ← `s._lastAnalysis ?? null`
- `nextPlannedMove` ← `s._nextPlannedMove ?? s.ladder_state?.next_planned_move ?? null`
- `nextPlannedMoveAtMsg` ← `s._nextPlannedMoveAtMsg ?? s.ladder_state?.next_planned_at_msg ?? null`

(Exact source field confirmed during implementation; both `s._nextPlannedMove` and
`s.ladder_state` are populated by the legacy generate.) No doctrine or legacy-JS edits.
Guard: extend `engine/parity.js` / `engine/smoke.js` expectations for the new fields.

## Replay (into the engine)

`EngineClient::generateFromLive` accepts a new `opts['state']` (the loaded
`aich_chat_state` row as an array) and injects it into the legacy session shape,
**replacing** the current hardcoded defaults:

```
'_lastStrategy'         => $opts['state']['last_strategy'] ?? null,
'_lastAnalysis'         => $opts['state']['last_analysis'] ?? null,
'_nextPlannedMove'      => $opts['state']['next_planned_move'] ?? null,
'_nextPlannedMoveAtMsg' => $opts['state']['next_planned_move_at_msg'] ?? null,
'_promiseStatus'        => $opts['state']['promise_status'] ?? 'not_started',
'_storyFrameworkStep'   => (int) ($opts['state']['story_framework_step'] ?? 0),
```

When no state row exists yet (first turn) the nulls/defaults match today's cold-start,
so behavior is unchanged for brand-new chats.

## Service

New `App\Services\OnlyFans\ChatStateService`, mirroring `FanProfileService`:

- `find(model, chatId): ?AichChatState` — read without creating (uses
  `withoutGlobalScopes`; controller has already scoped via `account()`).
- `toEngineState(?AichChatState): array` — the `opts['state']` array (null-safe → legacy
  cold-start defaults when the row is absent).
- `commit(model, chatId, strategy, telemetry, ?userId): AichChatState` —
  `updateOrCreate` on `(creator_model, chat_id)` writing `last_strategy = strategy`,
  `last_analysis = telemetry.lastAnalysis`, `next_planned_move`,
  `next_planned_move_at_msg`, `promise_status`, `story_framework_step`, `committed_by`.

## Control flow

**On Generate** (`OnlyFansChatController::generate`): load the chat's state via
`ChatStateService::find` → pass `toEngineState(...)` as `opts['state']` to
`generateFromLive`. The AI Intel display row (`aich_chat_intel`, saved every generate)
is unchanged. **Generate does NOT commit state** — a rejected/experimental draft must
not become the "previous" the next turn builds on.

**On commit (Accept / Accept & Send):** the carried state is written from the
generation the chatter is adopting. The generate response already returns `strategy` +
`telemetry` to the client. New endpoint:

```
POST onlyfans/{model}/chats/{chat}/state   (account-scoped, JSON-422 via validateJson)
body: { strategy: object, telemetry: object }
```

→ `ChatStateService::commit(...)`. Client (`ofApi.commitState`) calls it from the
composer's `accept` and `accept-send` handlers.

**Commit trigger decision (for spec review):** commit on both **Accept** (draft moved to
the typing bar) and **Accept & Send** (sent directly) — the two explicit "I'm using this
AI output" actions. A plain hand-typed Send with no active suggestion does **not** commit
(no AI strategy was used). Known minor imperfection: Accept-then-discard would commit a
message the fan never saw; accepted as a fair trade for simplicity and matching the
user's "Send/Accept" intent.

## Frontend changes

- `ComposerState` (`resources/js/lib/conversationCache.ts`): add `telemetry` (captured
  from the generate response) so the commit can send it. `strategy` is already stored.
- `Conversations.vue`: `generate()` stores `st.telemetry = data.telemetry`; the
  `acceptSuggestion` and `acceptAndSend` handlers call `ofApi.commitState(m.id, chatId,
  { strategy: st.strategy, telemetry: st.telemetry })` (fire-and-forget, non-blocking —
  a failed commit must never block a send).
- `lib/onlyfans.ts`: add `commitState`.

## Access control

`aich_chat_state` carries `creator_model` + `CreatorAccessScope`. Both routes
(`generate`, `state`) sit in the existing `account()`-scoped chatter group, so a chatter
can only read/commit state for assigned creators — same as intel/profile.

## Testing

- **Pest — replay:** with a seeded `aich_chat_state` row, `generate` passes the replayed
  fields into the engine (assert on the mocked engine payload).
- **Pest — commit:** `POST …/state` upserts the row with the strategy/analysis/plan/
  promise/story values; second commit updates in place.
- **Pest — scope:** a chatter cannot commit/read another creator's chat state.
- **Pest — cold start:** generate with no state row still works (nulls/defaults).
- **Engine:** `runGenerate` returns the three new telemetry fields; extend
  `engine/parity.js` / `engine/smoke.js`.

## Rollout / parity notes

- After Package A: the "previous analysis — act on this" steering, anti-drift, and
  promise/story continuation match legacy. Archetype persistence already works via
  `customer_profiles`.
- Money-aware behavior (counters, wall/ladder, paid-session gates) still differs until
  **Package B** feeds per-message PPV/tip/opened/price into the engine.
