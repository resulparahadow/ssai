# State switches, Warm up, last counters (Requirements v1 §5b, §6, rest of §5c) — design

Date: 2026-11-27 · Status: draft for review · Builds on the agent-intents design
(`2026-11-26-agent-intents-design.md`) and slice 1–2 code.

## 1. Intent and why

5a gave the chatter one-message control (intent buttons). 5b gives **lasting** control: a panel that
shows SSAI's current read of the fan and lets the chatter correct it when SSAI misreads him.
§5 purpose: "keep the pace and take control when SSAI is looping or not reading the chat correctly".

Decided with the user (2026-11-27):
- **A manual setting stays until someone sets the switch back to Auto** (option a). This matches
  how the existing Sexting and Tip switches work.
- **Build it as parallel tracks with a workflow.**

## 2. Goals, non-goals, anti-goals

**Goals**
- **Nine switches, as the doc lists them.** Each is Auto or a manual value. Auto shows SSAI's own
  read where one exists. A manual value changes what SSAI writes from the next generate on, and
  stays until reset.
- **§6 Warm up:** a Phase option.
- **§5c's last three counters:**
  - last rung bought → next price;
  - objection redirects → free teaser lights up at 3;
  - sex-only pulls → PPV lights up at 2.

**Non-goals**
- 5a slice 3: auto-glow for Post-purchase / Post-tip / Aftersale, Hook firing on a new subscriber, VN cue.
- The "Came with tip / media" tags.
- §7 CRM settings.

**Anti-goals**
- **A switch that changes the screen but not SSAI.** Every switch must provably reach the prompt.
- **Editing `legacy/js/*`.**
- **Changing generates with no overrides.** A generate where every switch is Auto must reach the
  engine byte-identical to today.
- **Stacking on the intent channel.** Switches must not use the AGENT OVERRIDE channel. That channel
  is one-turn and authoritative, and would collide with intents and typed notes.

## 3. Approaches considered

1. **A standing "agent-set state" note plus targeted session hooks (chosen).**
   - A new engine wrapper (beside `followUp.js`) appends a short block to every `strategy*` and
     `generator*` call when any switch is manual. It lists each manual value with its rule.
   - Where legacy already keeps the state in a session field or a function, the engine also sets it
     there, so legacy's own logic follows:
     - `_promiseStatus` is a session field;
     - posture and customer tier come from global functions (`computePosture`, `computeCustomerTier`)
       that the engine can wrap inside each generation's VM context;
     - trust uses the existing locked `trust_level`.
   - No legacy edits.
2. **Put the state into the AGENT OVERRIDE `context` on every generate.** Rejected: it would make every
   turn an override. That defers legacy's walls and locks permanently and collides with intent buttons.
3. **Port posture and tier logic to PHP and feed computed results.** Rejected: large, and it breaks
   parity.

## 4. The switches

Stored per fan, shared by every chatter, until reset to Auto. "Engine effect" is what makes SSAI
follow the switch; "note" means a line in the agent-set state block.

| Switch | Values | Auto shows | Engine effect |
|---|---|---|---|
| **Phase** | Auto · warm up · rapport · link · sale · loop · aftersale | the last strategy's phase, mapped to these names | note. Mapping to legacy phases: rapport → chit_chat/rapport, link → cta1/promise_ritual, sale → sell/cta2/send_content, loop → warmup_between_rungs, aftersale → aftercare. **warm up** = "short, light, friendly replies; no selling, no personal questions yet; get him talking" (my call, §11) |
| **RLS beat** | Auto · 1–12 | "—" (not tracked today) | note: "write the message for beat N of the RLS script (PART 14)". **Auto-advance:** when a draft written under beat N is sent and the fan replies after it, the beat moves to N+1 at the next generate (server-side, from thread times). It stops at 12 |
| **Fan type** | Auto · new · returning · spender | telemetry `customerTier` + spend (new / returning / spender) | wraps `computeCustomerTier`: new → `new`; returning or spender → `old`. Note: "spender" adds "he has bought before; treat him as a buying customer". The client's 10-message PPV rule also treats returning/spender as returning |
| **Lane** | normal · sex-only · rude | normal | note, my call (§11). **sex-only:** keep it sexual and short, move to paid content sooner, skip deep rapport, never give explicit content free. **rude:** stay calm and short, set one clear boundary, no selling while he's rude, don't argue or chase. normal = no note |
| **Posture** | Auto · normal · frame-hold · timewaster | telemetry `posture` (WARM_BUILD/PROBE → normal, PRESSURE → frame-hold, TIMEWASTER → timewaster) | wraps `computePosture`: normal → `WARM_BUILD`, frame-hold → `PRESSURE` plus a note quoting PART 5 frame protection ("tease without confirming, withhold without rejecting; validation after spend"), timewaster → `TIMEWASTER`. The existing Fan-tab **timewaster** flag stays as it is (it is the stronger "flagged" tier) |
| **Trust level** | Auto · L1–L5 | the profile's `trust_level` | **reuses the existing locked `trust_level`.** Setting a value = edit + lock (the Fan tab already does this); Auto = unlock. No new storage. **Amended at integration: no note line.** Legacy already prints the profile's `trust_level` in its prompt, so the locked value reaches SSAI without one; and trust locks predate this feature, so a note keyed on the lock would give existing fans a `stateOverrides` payload they never set (breaking all-Auto byte-identity) |
| **Promise state** | Auto · not asked · asked · reinforced ×1 · reinforced ×2 | chat state `promise_status`, mapped | sets session `_promiseStatus`: not asked → `not_started`, asked → `in_progress`, reinforced ×1 → `reinforcement`, reinforced ×2 → `assumed` |
| **Language** | Auto · ES · EN, **only for creators marked bilingual** | the last strategy's `customer_language` | note: "reply only in Spanish / English". New `aich_models.is_bilingual` boolean (a checkbox on the Creator Models page). The switch is hidden otherwise |
| **Support mode** | off · on | off | note: "SUPPORT MODE: no selling at all — no CTA, PPV, tip ask or promise; help, reassure, be kind". Also **selling intents are refused while on**: the client disables PPV, Re-pitch, Re-offer MPPV, CTA, Tip ask, Promise and FreePicture with "Support mode is on", and the server returns 422 for those intent keys |

**The note's framing** is fixed text. The block is ordered as above and lists only manual switches:

```
AGENT-SET STATE (set by the chat agent; treat as true until they change it):
- <Switch>: <value> — <rule>
```

It sits below everything else, so legacy's prompts are unchanged above it. With no manual switches
there is no block and no hook.

**With intents:** an intent's directive stays authoritative for its one message. The state block stays
underneath it as background, and the directive wins where they differ. Support mode is the one hard
rule: it blocks selling intents, as above.

## 5. Counters (§5c, rest)

| Counter | Rule | Shows / drives |
|---|---|---|
| **Last rung bought** | Client-side from the loaded thread: the newest **opened** chat PPV's price. The next rung = the next higher price in the creator's ladder | The counters line: `last rung $21 → next $35`. When a loaded PPV step's price differs from the next rung, the strip shows `Ladder: $35 [Use]`, beside the AI suggestion. **It never changes the price by itself** (my call, §11: §1 says a script's own price comes with it). Ladder = new `aich_models.price_ladder` json, default `[12,21,35,49,69,100]` (the team's Master Script ladder), editable on the Creator Models page |
| **Objection redirects** | Server-side. `aich_chat_state.objection_redirects` +1 when an **accepted or sent** draft's strategy has `wall_detected === 'objection'` or the draft came from the Objection intent. Reset to 0 when the thread shows an opened PPV newer than the last increment, or after a `session_gap_hours` gap | Counters line `objections 3`. At ≥ 3 the **FreePicture** chip is lit with "He's objected 3 times — a free teaser can help" |
| **Sex-only pulls** | Server-side. `aich_chat_state.sex_only_pulls` +1 on an accepted or sent draft whose generate telemetry reports legacy's fork `vending_machine_attempt`, or whose Lane is sex-only and the fan's message was sexual. Same reset rules | Counters line `sex-only 2`. At ≥ 2 the **PPV** chip is lit (when unlocked) with "He keeps pushing for sexual content — time to sell" |

The engine telemetry gains `forkType` (legacy's ladder state fork) and `wallDetected` (from the
strategy). Both are already computed by legacy; only exposing them is new. The counters ride on the
existing commit-on-accept path (`ChatStateService::commit`).

## 6. Data and API

- **`customer_profiles.state_overrides`** (json, nullable).
  - Keys: `phase`, `rls_beat`, `fan_type`, `lane`, `posture`, `promise`, `language`, `support`.
  - An absent key = Auto. Lane and support have no Auto: normal / off is stored as absent.
  - Trust is not here; it is the locked `trust_level`.
- **`customer_profiles.rls_beat_sent_at`** (timestamp, nullable) for auto-advance.
- **`aich_chat_state.objection_redirects`**, **`sex_only_pulls`** (int, default 0), plus
  **`counters_touched_at`** (timestamp).
- **`aich_models.is_bilingual`** (bool, default false) and **`price_ladder`** (json, nullable →
  default ladder).
- **`PATCH onlyfans/{model}/chats/{chat}/profile`** accepts
  `state_overrides: {key: value|null}`. It merges per key, and null removes the key. Values are
  validated against the table's lists, with `language` allowed only for a bilingual creator. The
  endpoint returns the full profile. **`GET …/profile`** returns `state_overrides` plus an
  `auto_read` object built from the last stored strategy and telemetry (`AichChatIntel` / chat
  state), so Auto rows have something to show.
- **`generate`** loads the overrides server-side, never from the client. It passes them to
  `EngineClient` as `stateOverrides` (legacy-shaped: `{phase, rlsBeat, fanTier, lane, posture,
  promiseStatus, language, support}`), and refuses selling intents while support is on.
- **The response** gains `counters: {objectionRedirects, sexOnlyPulls}` and the effective `rlsBeat`.
  The counters also come back from `GET …/profile`.

## 7. UI

- **A "SSAI state" card on the Fan tab**, under Memory & controls. It has one row per switch:
  - the label;
  - the current value (Auto rows in muted text: "Auto · rapport");
  - a dropdown with Auto plus the manual values.

  A manual row is highlighted and shows who set it and when, if cheap; otherwise just highlighted.
  Changing a row saves immediately (optimistic, with rollback), like the existing toggles. The
  Language row only appears for bilingual creators. Trust reuses the existing trust control's
  save/lock call.
- **Support mode on** also shows a pill in the thread header ("Support mode") so nobody sells by
  accident.
- **The counters line** in the intent bar gains `last rung $21 → next $35 · objections 3 ·
  sex-only 2` (parts hidden when zero or empty).
- **Lit chips:** FreePicture at ≥ 3 objections, PPV at ≥ 2 sex-only pulls, with the reason as the title.

## 8. Build tracks (for the parallel workflow)

The contracts in §6 are fixed up front, so the tracks run at the same time:
1. **Server + engine.** Migrations, models, validation, profile GET/PATCH, generate wiring, support
   block, counters on commit, the RLS auto-advance, telemetry `forkType`/`wallDetected`, the
   `engine/stateNote.js` wrapper + function hooks, and a new guard `engine/state_check2.js` (each
   switch reaches the prompt; all-Auto is byte-identical). Plus the Creator Models fields.
2. **Client.** The SSAI state card, the support-mode pill and chip locks, the counters line
   additions, the lit chips, the ladder suggestion on the strip, and the fan-type override feeding
   the 10-message rule. Built against the §6 contract, with a fake in client checks.
3. **Integration** (after 1 and 2). Wire both ends, a browser check in the isolated harness, a
   real-AI spot check of a few switches (rude lane, support mode, Spanish, warm up), docs, then the
   final review.

## 9. Testing

- **Pest:**
  - validation (values, null = Auto, language only for bilingual);
  - merge semantics;
  - generate passes overrides server-side;
  - the selling-intent 422 under support mode;
  - the counters increment and reset rules;
  - RLS auto-advance;
  - all-Auto payload has no `stateOverrides`.
- **Engine check:** every switch value produces its line or hook (posture/tier wrappers return the
  forced value, `_promiseStatus` set), and all-Auto is byte-identical.
- **Client checks:** auto-read mapping, the counters line text, lit-chip thresholds, ladder next-rung
  math, and support-mode chip locks.

## 10. Risks

- **Function wrapping in the VM** depends on legacy calling `computePosture`/`computeCustomerTier` by
  their global names. The builder verifies this first; if a call site captures a local reference, use
  the closest session-field hook instead and say so.
- **The state note can conflict with legacy's walls** (e.g. rude lane vs a pitch the ladder wants).
  The note says "treat as true", not "override everything", so walls still win; the spot check watches
  for it.

## 10a. Edge rules (settled after the builder check; my calls)

- **Verified in code:**
  - legacy calls `computePosture` / `computeCustomerTier` by global name inside `recomputePosture`
    (app.js ~3671), so a per-VM wrapper works; the builder proves it with the engine check, because
    `eng.set` reassigns via eval;
  - `_promiseStatus` is a session field EngineClient already sets;
  - the fork is at `s._pendingPassCAdvance.ladderState.fork.type`, the Pass C stash `runGenerate`
    already reads;
  - `wall_detected` is on the returned strategy;
  - `ChatStateService::commit(strategy, telemetry)` is the accept path;
  - trust editing and locking live in `SsFanPanel.vue`.
- **A manual value is pinned, not just a seed.** Legacy advances `_promiseStatus` during the turn, so:
  - the engine re-applies the manual promise value at the end of the generate, so telemetry reports it;
  - `ChatStateService::commit` **skips writing any field that has a manual override** (e.g.
    `promise_status`), so an agent-set value is never stored as if SSAI earned it, and Auto resumes
    from SSAI's own last value.
  - Phase is note-only and has nothing to persist.
- **Precedence: explicit human settings beat derived ones.**
  - Fan type manual beats the trust-derived tier: the wrapper returns the forced tier whatever the trust.
  - With Fan type on Auto, a manual trust ≥ L2 still reads as returning. That is legacy's own rule
    (trust ≥ 2 → old), and the card says so under Fan type ("Auto · returning (from trust L3)").
  - **The Fan-tab timewaster flag wins over the Posture switch.** It is the stronger, older
    human setting. While it is on, the Posture row shows "Timewaster (flag on Fan tab)" and is
    disabled.
  - A forced posture also overrides legacy's sexting posture freeze: a human setting wins. Legacy
    still sets `_autoFlagged` from the returned value as before.
- **Counters count once per fan message, not once per accept.** Each counter stores the timestamp of
  the last fan message it counted (`objection_counted_at` / `sex_only_counted_at`) and increments at
  most once per newer fan message. The Lane switch alone never counts.
  - Times are the thread's ISO timestamps compared in UTC.
  - Reset = an opened PPV in the thread newer than the last count, or a `session_gap_hours` gap.
- **RLS beat sent-marker:** any successful send while a manual RLS beat is set stamps
  `rls_beat_sent_at` server-side in `send`, even if the chatter rewrote the draft (they sent the
  beat's message). The beat advances at the next generate if a fan message is newer than that stamp.
- **Support mode also blocks paid sends.** `send` refuses a priced media send with 422 "Support mode is
  on — no selling." (free media and plain text still go). The client stops a PPV script step loading
  while support is on, with the same reason.

## 11. Open questions for the team (defaults in brackets)

1. What does **Warm up** mean in practice? [short, light, no selling, no personal questions yet]
2. **Rude lane:** what should SSAI do? [calm, short, one boundary, no selling while rude, no arguing]
3. **Sex-only lane:** how fast should it sell? [move to paid content sooner, skip deep rapport]
4. **RLS beat:** does a beat count as done when the fan replies, or when the creator sends it? [when he replies]
5. **Last rung:** should the ladder price **replace** the script's own price automatically? [no, it's a suggestion]
6. **Frame-hold:** is it PART 5 frame protection? [yes]

## 12. Left to the builder

Exact wording of each note line within the rules above, card styling (impeccable pass), and whether
"set by / when" fits in the card.
