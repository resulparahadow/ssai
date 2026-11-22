# PPV slice 2 — AI price suggestion + "not ready" warning — design

Date: 2026-11-22 · Status: draft for approval (builder-checked) · Requirements v1 §2 (priority #1), follows
`2026-11-08-ppv-sets-design.md`

## Intent

Slice 1 lets a chatter load a PPV set (vault media + the manager's preset price + default
caption) and have SSAI write a fan-specific caption. Requirements v1 §2 Option C also shows two
pieces of decision support that slice 1 left out:

1. **An AI price suggestion with a one-line reason**, e.g. "AI: $12 · cold lurker, zero spend,
   first PPV must be a low-risk entry price".
2. **A warning when SSAI doesn't think the fan is ready**, e.g. "SSAI wanted chit_chat first —
   send only if he's ready to unlock".

The goal is to help the chatter decide whether to send this PPV now and at what price. The chatter
still makes the call.

## Decisions made with the user

- **The set's preset price stays in the chip.** The AI suggestion sits next to it with a
  **Use** button. The AI never changes the price on its own. The manager's ladder is the default
  and the chatter decides.
- **Approach A: the suggestion arrives with the caption.** It is not fetched when the set loads.
- Leave out the legacy "Customer | Camila" message-type toggle and the "Came with tip / media"
  tags. Those belonged to legacy's paste-in mode. In a live chat, OnlyFans already tells us who
  sent what, and whether a tip or media came with it.

## Goals

1. A Generate with a set loaded returns a price suggestion (whole dollars + a short reason)
   together with the caption draft. Legacy's own pricing logic produces it.
2. The PPV strip shows the suggestion next to the price chip. **Use** copies it into the chip.
3. The caption draft card shows the "not ready" warning when the last plan SSAI saved for this
   chat was not a selling beat.
4. No extra AI call for the warning. One small extra AI call per caption Generate for the price.

## Non-goals (this slice)

- AI picking which set to send (Option A of §2 / "auto-pick from the ladder"). Next slice.
- A price suggestion without Generate (approach B, or a "Suggest price" link). It can be added
  later on top of this without rework.
- Pre-warming a suggestion on a normal (non-PPV) Generate when the strategy lands on a sell
  phase. Legacy does this. We skip it here because nothing would show the result until a set is
  loaded.
- A separate "Set PPV price" modal. The strip's price chip already covers it (see UI).
- Agent controls (§5): PPV-button grey-outs, Re-pitch, counters.

## Anti-goals

- The price changing without the chatter's action. Accepting a draft, regenerating, or a
  suggestion arriving must never overwrite the chip.
- A suggestion the vendor will reject. It must land in the sendable range ($3–$200, whole
  dollars) before it is offered, so **Use** can never produce a disabled Send.
- Editing `legacy/js/*`. Everything goes through `engine/` wrappers (parity rule).
- Persisting fan message text. Nothing new is stored. The suggestion and the warning live only in
  the response and the composer state.
- A warning that cries wolf. If we don't know the plan, show no warning.

## How it works today (relevant facts)

- `engine/runGenerate.js` sets `currentSender='ppv'` for caption mode. At the end of
  `generate()`, legacy calls `fetchPpvSuggestion(...)` **fire-and-forget** in PPV mode
  (app.js ~7077). That call is `callApi(..., 'price_ppv')`. The engine currently short-circuits
  that tag to `''` (runGenerate.js ~71–82), so legacy records `_ppvSuggestion = {error}` and
  nothing is billed.
- `fetchPpvSuggestion` (app.js ~5615) prices from: customer name, lifetime spend, tips,
  subscription status, profile (trust/archetype/temperature/key_details), the creator's
  `content_library` (or generic tier heuristics when missing), and the last 12 messages including
  `[PPV PURCHASED $x]` / `[PPV SENT $x — unopened]`. It returns `{price, reason}`, rounds to a
  whole dollar, rewrites contradictory "Tier N" text in the reason, and applies **×1.25 when
  `_sextingActive`** (reason gets "· sexting × 1.25 (base $x → $y)"). On a parse/invalid result
  it stores `{error}`. It also touches the DOM (`ppvSuggestCard`, `updateOpenPpvModal`) through
  the engine's DOM stub.
- Legacy's own warning `_ppvOverrodeBrain` is already in the response as
  `telemetry.ppvOverrodeBrain`, but it almost never fires. In PPV mode, legacy's strategy prompt
  says "Set phase=send_content", so the phase it checks has already been forced.
- `EngineClient` replays the saved chat state into the session: `_lastStrategy` ←
  `aich_chat_state.last_strategy`. That row is written by `commitState` when a draft is
  **accepted**, so it is the last plan a chatter accepted. The caption generate itself skips
  `commitState` (slice 1).
- `OnlyFansChatController::generate` returns `{draft, strategy, telemetry, generatedAt}`. In
  caption mode it skips AI Intel and the memory write-back but records the usage ledger.
- `SsPpvStrip.vue` renders the set's tiles + the editable "Price to View" chip (validated by
  `isValidPpvPrice`, mirrors `App\Rules\PpvPrice`). `SsComposer.vue` renders the draft card.

## The design

### Engine (`engine/runGenerate.js`, wrapper only)

1. **Lift the `price_ppv` short-circuit in caption mode only** (`input.sender === 'ppv'`). In
   normal mode keep the short-circuit, since nothing consumes the pre-warm (see non-goals).
2. **Wait for it.** The call is fire-and-forget inside legacy, so the wrapper must keep the
   `price_ppv` promise (wrap `callApi` for that tag) and, after `eng.generate()` resolves, await
   it. Then read `s._ppvSuggestion` once legacy's continuation has run (legacy sets it after the
   awaited call returns). Cap the wait (≈20s). A timeout means "no suggestion", never a failed
   Generate.
3. **Tell it what's in the set.** Append one block to the `price_ppv` user prompt (same
   wrapper style as `followUp.js`): "THE PPV BEING SENT: {N photos, M videos, …}". Legacy's
   prompt infers the tier from the conversation alone and could price one photo like a video
   bundle. *Our call:* send the media counts by type only. Do not send the set name (free text,
   could steer oddly) and do not send the preset price (it would anchor the suggestion, which
   defeats the point of a second opinion).
4. **"Not ready" snapshot.** Laravel passes the **forward plan** as a separate input field,
   `ppvPlan` (`aich_chat_state.next_planned_move`, or null once the stale rules below drop it).
   The session replay (`_nextPlannedMove` etc.) stays exactly as today, so the caption prompts
   are unchanged. That is the move
   the strategy committed to for the *next* turn when the last draft was accepted. Legacy's
   strategy schema requires it, as one of `rapport_beat / qualifying_question / seed_cta / cta1 /
   cta2 / send_ppv / tier_jump_test / aftercare / exclusive_custom / goodbye_script /
   manager_flag`. *Our call:* do **not** use `last_strategy.phase`. That phase is the move the
   accepted draft *made*. "Accept a chit-chat warm-up, then load a set" is the normal lead-in to a
   sell, so comparing against it would fire a warning on most captions. After the run, set a new
   telemetry field `ppvPlanBeforeCaption`:
   - **warn** (the plan value) for `rapport_beat`, `qualifying_question`, `aftercare`,
     `goodbye_script`, `manager_flag`. These moves say "not selling next".
   - **no warning** for `seed_cta`, `cta1`, `cta2`, `send_ppv`, `tier_jump_test`,
     `exclusive_custom` (pitch moves), for an unknown value, or when there is no plan.
   Leave legacy's `ppvOverrodeBrain` untouched so the parity diff stays clean.
5. Return `ppvSuggestion` at the top level of the result: `{price, reason}` | `{error}` | null
   (null = not caption mode).
6. The price call goes into the usage ledger like every other call (tag `price_ppv`).
   Nothing extra is needed.
7. Make sure the DOM stub tolerates `fetchPpvSuggestion`'s `getElementById('ppvSuggestCard')`
   → `outerHTML =` and `updateOpenPpvModal` (no throw). If it throws, the suggestion is lost to
   the catch path.

### Laravel

- `EngineClient` passes the set's media type counts through to the engine (new optional input
  field, e.g. `ppvMedia: {photo: n, video: n, …}`). `OnlyFansChatController::generate` accepts it
  **with explicit rules** (`validate()` strips unlisted nested keys). It is only meaningful with
  `sender:'ppv'`.
- **Clamp before returning:** the controller rounds `ppvSuggestion.price` to a whole dollar and
  clamps it into $3–$200. When it clamped, the reason gets a short suffix
  ("· capped at $200"). A non-numeric or ≤0 price becomes `{error: 'no usable price'}`.
- Response gains `ppvSuggestion` (caption mode only). `telemetry.ppvPlanBeforeCaption` rides
  inside `telemetry` as-is.
- **Stale plans:** the plan only changes on Accept/Send, so later turns can make it outdated.
  *Our call* (per the "don't cry wolf" anti-goal: when unsure, no warning): the controller sends
  `ppvPlan: null` for a caption generate when any of these hold, judged from the generate payload's messages vs `aich_chat_state.updated_at`:
  - the chat went quiet for longer than `session_gap_hours` after the commit (same rule as
    rejections and the memory log, `DraftRejectionService::isActive`);
  - a PPV (`sender:'ppv'` / priced message) was sent **after** the commit; it was already
    acted on, bought or not;
  - **more than one** creator message was sent after the commit. The plan covered the very
    next turn, and the first message after an Accept is usually the accepted draft itself
    (Accept & Send commits just before it sends).
  The chat-state row is only read here, never written. Caption mode still skips `commitState`.

### Client

- `ComposerState.ppv` gains `suggestion: {price, reason} | {error} | null` and
  `notReadyPlan: string | null`. Both are written from the caption Generate response and
  cleared when a set is loaded, removed, or replaced, and when a new caption Generate starts.
- **`SsPpvStrip`**: next to the price chip:
  ```
  [🔒 Price to View: $20]   AI: $12 · cold lurker, zero spend, first PPV  [Use]
  ```
  - While a caption Generate is running: "AI pricing…" (muted).
  - On error: "AI price unavailable" (muted, reason in a tooltip). No retry button
    (regenerate covers it).
  - When the suggestion equals the chip price: show it without the **Use** button
    ("AI agrees: $20 · …").
  - **Use** sets the chip to the suggested price (same path as a manual edit, so the existing
    validation and draft-ownership rules apply).
- **`SsComposer` draft card** (caption mode only), when `notReadyPlan` is set, shows an amber
  line above the caption:
  ```
  ⚠ SSAI planned a rapport beat next. Caption written anyway, send only if he's ready to unlock.
  ```
  Show the plan humanised (`rapport_beat` → "a rapport beat", `aftercare` → "aftercare",
  `goodbye_script` → "a goodbye"; the builder picks the exact wording). No warning when null.
- The "SSAI is avoiding" / reject flow is unchanged.

### Docs

- `docs/chatter-guide.md` §7 "Sending a PPV": add the suggestion (how to read it, that **Use** is
  optional, that the set price stays unless you click) and the warning. Update §8 "Known limits":
  SSAI now suggests a price, but still doesn't pick the set.
- CLAUDE.md PPV-sets paragraph: note that the `price_ppv` short-circuit is lifted in caption
  mode, add the new response fields, and add the new guard.

## Tests / guards

- `node engine/ppv_price_check.js` (new, with fake transports): caption mode makes exactly one
  `price_ppv` call whose prompt contains the set-contents block, and returns `{price, reason}`.
  The sexting ×1.25 path applies. A garbage answer gives `{error}`. Normal mode still makes **no**
  `price_ppv` call. A hung price call times out without failing the generate.
- Update `node engine/ppv_caption_check.js`: it currently asserts NO `price_ppv` call in caption
  mode, and that flips.
- `ppvPlanBeforeCaption`: set for a replayed `rapport_beat` / `aftercare` plan, null for
  `send_ppv` / `cta2` / `seed_cta` / an unknown value / no plan.
- Pest (`OnlyFansChatCaptionTest`): clamping (250 → 200 + suffix, 1 → 3, 12.6 → 13, null →
  error), `ppvSuggestion` absent in normal mode, each stale-plan case (12h gap, PPV after
  commit, two creator messages after commit, one is fine), and `ppvMedia` validation.
- Parity: `node engine/parity.js`, `node legacy/tests/harness.js`, and a normal-mode A/B prompt
  diff stay byte-identical.

## Left to the builder

- Exact copy, colours, and the phase-name mapping (within the `ss-*` tokens).
- How exactly to capture and await the fire-and-forget promise, and the timeout value (≈20s).
- Whether the stale-plan rule lives in `EngineClient`, the controller or a small service.
- Small clock-skew slack when comparing message times with `updated_at`.
