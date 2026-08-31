# Money-Aware Generation (Package B)

**Date:** 2026-07-26
**Status:** Design — approved for planning
**Scope:** Feed real per-message payment data (PPV price/opened, tips) into the live
Conversations generate path so the engine's money-aware logic — wall enforcement, PPV
stats, posture counters + reset-on-payment, active-buyer / session-spender guards, the
sexting/tip AUTO gates, and tier/whale tracking — operates on truth instead of zeros.
Completes legacy parity begun by Package A (conversation memory).

## Problem

The live generate path sends the engine a plain `customer`/`model` transcript with no
notion of which messages were paid PPVs, whether the fan opened them, or which were tips.
`EngineClient::generateFromLive` therefore feeds session `total_spend`/`tips_spend` as
`$0` (see the CLAUDE.md note: "SESSION spend … stays $0: it's only derivable from
per-message PPV/tip data, which isn't mapped yet"). Consequences, all in the legacy code
the engine runs unmodified:

- `computeWallState` (`legacy/js/app.js:4301`) counts `m.sender==='ppv'` bubbles with
  `m.opened===true`/`false` for PPVs sent / opened / missed. With no `ppv` bubbles it sees
  zero — wall enforcement, miss-lockout, and PPV stats never engage.
- `effectiveSessionSpend(s)` (`app.js:3610`) = `s.total_spend + s.tips_spend` (the
  *session's* spend). At `$0` the active-buyer / session-spender anti-exit guards, the
  timewaster immunity (GUARD 2/3), and tier all misread a paying fan as a lurker.
- The sexting/tip AUTO gates key off "paid this session" — also dead.

Package A restored *conversation memory*; Package B restores the *money awareness*. Both
together ≈ full legacy parity.

## Decisions (from brainstorming)

1. **Data source — the frontend forwards it.** The browser already holds `price`,
   `isFree`, `isOpened`, `isTip` per message (from `OnlyFansService::normalizeMessage`,
   which returns them today). `generate()` will include those alongside `from/text/time`.
   No extra OnlyFans API call; lifetime spend still refreshed server-side via the profile.
2. **Session window — gap-based.** "This session" = the run of messages from the newest
   back to the first gap larger than a threshold (default **12h**, configurable) between
   consecutive messages. Session spend and `ppv`-bubble marking apply only inside that
   window; payments before the last gap remain part of **lifetime** spend (fed from the
   profile, unchanged) but do not read as "spending right now."

## Goals

- Map the client thread into the engine's money-aware inputs: `ppv` bubbles
  (`sender:'ppv'` + `opened` + `price`) for creator-sent paid PPVs in the session window,
  and session `total_spend` / `tips_spend`.
- No change to `legacy/js/*`, the engine sidecar, or `EngineClient` (it already accepts
  these inputs). No new persistence — the mapping is a per-generate transform.
- The full loaded thread stays the transcript (context for personalization); only
  session-window payments are marked/counted, so old payments don't skew posture.

## Non-goals

- Sending PPVs/tips/paid media (still v1-blocked). This is read/derive only.
- Realtime spend webhooks (`messages.ppv.unlocked`, `tips.received`) — a later option;
  here spend comes from the thread the client already loaded.
- Persisting session spend — recomputed each generate.

## Architecture

Three pieces; the engine and `EngineClient` are untouched.

### 1. Frontend forwards payment fields

`resources/js/pages/Conversations.vue` `generate()` currently maps each message to
`{from, text, time}`. It will also forward `price`, `isFree`, `isOpened`, `isTip` (already
present on the cached `OfMessage`). The `OfMessage` type already carries them.

### 2. `LiveThreadMapper` — a pure mapping service (new)

`App\Services\OnlyFans\LiveThreadMapper`, no OnlyFans/engine/DB calls:

```
map(array $messages, int $gapHours = 12): array
  → ['messages' => list<array{sender,text,ts_iso, ...ppv fields}>,
     'total_spend' => float,   // session — opened-PPV prices in the window
     'tips_spend'  => float]   // session — tips in the window
```

Algorithm:
1. Normalise each incoming message to `{from, text, ts, price, isFree, isOpened, isTip}`
   (ts parsed from `time`; missing ts sorts oldest).
2. **Session boundary:** sort ascending by ts; scan from the newest backward; the session
   starts at the first message where the gap to the *previous* message exceeds `gapHours`
   (no such gap → the whole thread is one session). Messages with no ts are treated as
   contiguous (no gap).
3. **Per message → engine bubble:**
   - base `sender` = `from==='fan' ? 'customer' : 'model'`.
   - In-window creator PPV (`from==='creator'` && `!isFree` && `price>0` && `!isTip`) →
     `sender:'ppv'`, plus `opened:isOpened`, `price`. If `isOpened`, add `price` to
     `total_spend`.
   - In-window tip (`isTip`) → stays a `customer` bubble; add its amount to `tips_spend`.
   - Anything else (incl. pre-window payments) → `customer`/`model` by `from`.
   - Always emit `ts_iso` (ISO from ts, or now()).
4. Return the mapped messages (full thread) + the two session sums.

This replaces the inline `collect($data['messages'])->map(...)` in the controller.

### 3. Controller wiring

`OnlyFansChatController::generate`:
- Validate the new nullable per-message fields (`messages.*.price|isFree|isOpened|isTip`).
- Call `LiveThreadMapper::map($data['messages'] ?? [], config gap)`.
- Pass its `messages` as the engine messages, and add `'total_spend'`/`'tips_spend'`
  (session sums) to the `generateFromLive` opts. Everything else (context, profile,
  lifetime spend on `_profile`, state carry-forward) is unchanged.

`EngineClient::generateFromLive` already: reads `opts['total_spend']`/`opts['tips_spend']`
(`EngineClient.php:62-63`) and passes `messages` through (`:67`). **No change needed.**

## Engine bubble contract (verified against legacy)

- PPV bubble: `{sender:'ppv', text, opened:bool, price:number, ts_iso}` —
  `computeWallState` counts these for sent/opened/missed (`app.js:4329+`).
- Session spend: `s.total_spend` + `s.tips_spend` drive `effectiveSessionSpend`
  (`app.js:3610`) → active-buyer / TW-immunity / tier.
- Lifetime spend stays on `_profile` (from the fan profile) — untouched.

## Testing

- **Mapper unit tests** (`tests/Feature/LiveThreadMapperTest.php`): gap-boundary detection
  (payment before vs after the gap), creator-PPV → `ppv` bubble with opened/price,
  unopened PPV excluded from `total_spend` but still a `ppv` bubble, tip → `tips_spend`
  (not a `ppv` bubble), fan vs creator direction, empty/no-timestamp threads.
- **Controller test** (extend the OnlyFans generate tests): with a thread containing a
  recent opened PPV + a tip, `Http::assertSent` shows the engine payload's
  `session.total_spend`/`session.tips_spend` non-zero and a `session.messages[*].sender ===
  'ppv'` bubble present; a payment older than the gap does NOT count toward session spend;
  lifetime spend still rides on `_profile`.
- **Engine parity:** a synthetic marked thread yields non-zero `computeWallState`
  (extend `engine/state_check.js` or a sibling — no doctrine change).

## Verify against live before implementation (stack was down at design time)

Two API facts taken from the docs, to confirm against one real thread with PPV/tip history
(`docker exec ssai-dev-app-1 …` once the dev stack is up):

1. **Tip amount field** — whether a tip's amount is in `price` or a dedicated `tipAmount`.
   The mapper reads `tipAmount ?? price` so it is correct either way, but confirm.
2. **`isOpened` = paid** — that a creator-sent PPV's `isOpened:true` means the fan
   purchased/unlocked it (not merely "delivered"). `canPurchaseReason` corroborates.

If either differs, adjust the mapper's field reads only — the architecture is unaffected.

## Parity note

After Package A + B: conversation memory *and* money-aware selling match legacy. Remaining
optional follow-ups (not parity-blocking): realtime spend webhooks, and per-message
PPV/tip *sending* (still blocked in v1).
