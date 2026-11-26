# State switches (§5b), Warm up (§6), last counters (§5c) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. This plan is run as a parallel Workflow: Tasks 1 and 2 run at the same time against the fixed contract below, Task 3 after both. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the nine §5b state switches (with Warm up as a Phase option), the remaining §5c counters (last rung → next price, objection redirects, sex-only pulls), and make SSAI provably follow every manual switch.

**Architecture:**
- Manual switch values are stored per fan (`customer_profiles.state_overrides`) and loaded server-side on every generate.
- They reach the engine as `stateOverrides`. A new engine wrapper (`engine/stateNote.js`) appends a fixed "AGENT-SET STATE" block to every strategy/generator call, and pins legacy state through per-VM function wrappers (`computePosture`, `computeCustomerTier`) and the `_promiseStatus` session field.
- Counters live on `aich_chat_state` and advance on the existing commit-on-accept path.
- A Fan-tab "SSAI state" card edits the switches.

**Tech Stack:** Laravel 13 / Pest, Vue 3 TS, Node engine (legacy JS in a per-request VM context).

**Spec:** `docs/superpowers/specs/2026-11-27-state-switches-design.md` (read all of it, especially §4, §5, §6, §10a).

## Global Constraints

- **Branch** `feature/state-switches`, cut from `feature/agent-intents-2` (slice 2 is pushed and its PR is not yet merged). Commit per task. Never push.
- **Never edit `legacy/js/*`.** A generate with every switch on Auto reaches the engine byte-identical to today: no `stateOverrides` key, no note, no wrapper.
- **A manual value stays until set back to Auto, and is pinned.** The engine re-applies the manual promise value at the end of the generate, and `ChatStateService::commit` skips writing any field that has a manual override.
- **Precedence (spec §10a):**
  - manual Fan type beats the trust-derived tier;
  - the Fan-tab `is_timewaster` flag beats the Posture switch (the Posture row is disabled while it's on);
  - a forced posture beats legacy's sexting freeze.
- **The note framing is verbatim.** Each line follows the header:
  ```
  AGENT-SET STATE (set by the chat agent; treat as true until they change it):
  - <Switch>: <value> — <rule>
  ```
  It lists only manual switches, in spec §4 order, and sits after everything else in the prompt.
- **Support mode blocks selling, server and client.**
  - Selling intents are `ppv`, `repitch`, `reoffer_mppv`, `cta`, `tip_ask`, `promise`, `free_picture`.
  - Server: those server-intent keys and a priced media `send` return 422 `Support mode is on — no selling.`
  - Client: those chips are disabled with the same text, and a PPV script step won't load.
- **Counters count once per fan message.**
  - The stamps are `objection_counted_at` / `sex_only_counted_at`.
  - Reset on an opened PPV newer than the last count, or a `session_gap_hours` gap.
  - Times are compared in UTC.
  - Thresholds: FreePicture lit at objections ≥ 3; PPV lit at sex-only ≥ 2.
- **Ladder:** `aich_models.price_ladder`, default `[12,21,35,49,69,100]`. The next rung is a suggestion only: it never changes a price by itself.
- **Language switch:** only when `aich_models.is_bilingual` is true. The server rejects `language` otherwise.
- **Data:** `$fillable` only; new request keys get validation rules; JSON 422s; tests never use the real OnlyFans API or MySQL.
- **Checks:** `php artisan test`, the engine checks (`parity`, `smoke`, `intent_check`, `followup_check`, `tw_check`, `state_check`), `node legacy/tests/harness.js` (283/0), all `tests/client/*.mjs`, `npm run types:check`, `npm run lint:check` and `npm run build` pass at each task end.

## The fixed contract (Tasks 1 and 2 build against this at the same time)

**Profile payload** (`GET|PATCH onlyfans/{model}/chats/{chat}/profile` → `{profile: {...}}`, from `FanProfileService::toPanel`). These keys are added to the existing ones:

```json
{
  "state_overrides": {
    "phase": "warm_up|rapport|link|sale|loop|aftersale",
    "rls_beat": 1,
    "fan_type": "new|returning|spender",
    "lane": "sex_only|rude",
    "posture": "normal|frame_hold|timewaster",
    "promise": "not_asked|asked|reinforced_1|reinforced_2",
    "language": "es|en",
    "support": true
  },
  "auto_read": {
    "phase": "warm_up|rapport|link|sale|loop|aftersale|null",
    "fan_type": "new|returning|spender|null",
    "fan_type_from_trust": false,
    "posture": "normal|frame_hold|timewaster|null",
    "promise": "not_asked|asked|reinforced_1|reinforced_2|null",
    "language": "es|en|null"
  },
  "counters": { "objection_redirects": 0, "sex_only_pulls": 0 },
  "is_bilingual": false,
  "price_ladder": [12, 21, 35, 49, 69, 100]
}
```

- Only manual keys appear in `state_overrides`. Absent = Auto; lane normal and support off are absent.
- `rls_beat` is an integer from 1 to 12.
- `auto_read` maps legacy values:
  - **phase:** legacy `chit_chat`/`rapport`/`warm_welcome`/`yes_flow` → `rapport`; `cta1`/`promise_ritual` → `link`; `sell`/`cta2`/`send_content`/`objection` → `sale`; `warmup_between_rungs` → `loop`; `aftercare`/`close` → `aftersale`; else null.
  - **posture:** `WARM_BUILD`/`PROBE` → `normal`; `PRESSURE` → `frame_hold`; `TIMEWASTER`/`FLAGGED_TW` → `timewaster`.
  - **promise:** `not_started` → `not_asked`; `in_progress`/`verbally_committed` → `asked`; `complete`/`reinforcement` → `reinforced_1`; `assumed` → `reinforced_2`.
  - **fan_type:** tier `new` → `new`; `old` with spend > 0 → `spender`; `old` otherwise → `returning`. `fan_type_from_trust` is true when the old tier came only from trust ≥ 2.

**PATCH body:** `{"state_overrides": {"<key>": <value>|null}}`. It merges per key; null removes the key. It can be sent alone or with the existing profile fields. Trust keeps using the existing `trust_level` and lock fields.

**Generate response** gains `counters: {objectionRedirects: int, sexOnlyPulls: int}` and `rlsBeat: int|null`.

**Support-mode 422:** `{"error": "Support mode is on — no selling."}` on a selling intent or a priced media send.

**Engine input** (`EngineClient` → engine): `input.stateOverrides`, present only when at least one switch is manual, legacy-shaped:

```
{phase?, rlsBeat?, fanTier?: 'new'|'old', spender?: true,
 lane?: 'sex_only'|'rude', posture?: 'WARM_BUILD'|'PRESSURE'|'TIMEWASTER',
 frameHold?: true, promiseStatus?: 'not_started'|'in_progress'|'reinforcement'|'assumed',
 language?: 'es'|'en', support?: true}
```

**Engine telemetry** gains:
- `forkType` (`s._pendingPassCAdvance?.ladderState?.fork?.type ?? null`);
- `wallDetected` (`strategy?.wall_detected ?? null`).

## Review Focus

1. **All-Auto byte-identity.** A fan with no overrides must produce an engine payload with no `stateOverrides` key and prompts identical to before (Task 1 engine check + Pest).
2. **Pinned promise.** With Promise = asked, legacy's in-turn advance must not leak into telemetry or into `aich_chat_state.promise_status` (Task 1 Pest + engine check).
3. **The timewaster flag vs the Posture switch.** Flag on + Posture normal → the engine still sees the flagged tier, and the card shows the Posture row disabled (Tasks 1 and 2).
4. **Counter double-count.** Accepting two drafts against the same fan message increments once (Task 1 Pest).
5. **Support mode via the send path.** A PPV script step with a price cannot be sent while support is on: the server 422s even if the client is bypassed (Task 1 Pest), and the client blocks the load (Task 2 check).

---

### Task 1: Server + engine

**Files:**
- **Create:**
  - `database/migrations/2026_11_27_100000_add_state_switches.php`: `customer_profiles.state_overrides` json nullable, `rls_beat_sent_at` timestamp nullable; `aich_chat_state.objection_redirects`/`sex_only_pulls` unsigned int default 0, `objection_counted_at`/`sex_only_counted_at` timestamp nullable; `aich_models.is_bilingual` bool default false, `price_ladder` json nullable.
  - `app/Support/StateSwitches.php`.
  - `engine/stateNote.js`.
  - `engine/switch_check.js`.
- **Modify:**
  - `app/Models/{CustomerProfile,AichChatState,AichModel}.php`: fillable + casts.
  - `app/Services/OnlyFans/FanProfileService.php`: `toPanel` adds the contract keys; `applyManualEdit` merges `state_overrides`.
  - `app/Services/OnlyFans/ChatStateService.php`: `commit` skips overridden fields; the counters.
  - `app/Http/Controllers/OnlyFansChatController.php`: profile validation; generate passes overrides and refuses selling intents under support; RLS auto-advance; response keys; `send` support block + `rls_beat_sent_at` stamp.
  - `app/Services/Engine/EngineClient.php`: `stateOverrides` only when non-empty.
  - `engine/runGenerate.js`: install the note + hooks, re-pin promise at the end, telemetry `forkType`/`wallDetected`.
  - `app/Http/Controllers/ModelController.php` + `resources/js/pages/ModelShow.vue`: `is_bilingual` checkbox, `price_ladder` input.
- **Tests:** `tests/Unit/StateSwitchesTest.php`, `tests/Feature/StateSwitchesTest.php`.

**Interfaces:**
- **Produces `final class StateSwitches`:**
  - `const KEYS` and the value lists per key (contract);
  - `static rules(bool $bilingual): array`, Laravel rules for `state_overrides.*`;
  - `static merge(array $current, array $patch): array` (null removes);
  - `static toEngine(array $overrides): array`, the contract mapping to legacy shape: posture `normal`→`WARM_BUILD`, `frame_hold`→`PRESSURE`+`frameHold`, `timewaster`→`TIMEWASTER`; fan_type `new`→`fanTier new`, `returning`→`old`, `spender`→`old`+`spender`; promise per the reverse of the auto_read map (`asked`→`in_progress`, `reinforced_1`→`reinforcement`, `reinforced_2`→`assumed`, `not_asked`→`not_started`); returns `[]` when empty;
  - `static autoRead(?array $lastStrategy, ?array $telemetry, CustomerProfile $p): array` (contract mapping);
  - `const SELLING_INTENTS`.
- **`engine/stateNote.js` exports:**
  - `stateBlock(overrides): string`, the verbatim framing plus one line per key in spec §4 order, with rules from spec §4 including the warm up / lane / frame-hold / support defaults;
  - `withStateNote(transport, block)`, appending to `strategy*`/`generator*` calls only, like `followUp.js`;
  - `installHooks(eng, overrides)`, wrapping `computePosture`/`computeCustomerTier` through `eng.get`/`eng.set` when posture/fanTier are present.
- **The timewaster flag wins:** if `_profile.is_timewaster === true`, the tier and posture wrappers return legacy's own result unchanged.

- [ ] **Step 1: Write failing tests.**
  - **Unit:** `toEngine` maps every value; `merge` removes on null; `rules` rejects bad values and `language` when not bilingual; `autoRead` maps each legacy phase/posture/promise/tier from the contract table.
  - **Feature** (`Http::fake`, engine body via `Http::recorded`):
    - PATCH sets and clears a switch;
    - PATCH `language` on a non-bilingual creator → 422;
    - generate with no overrides sends no `stateOverrides`;
    - generate with posture `frame_hold` sends `{posture:'PRESSURE', frameHold:true}`;
    - support on + `intent=cta` → 422 with the exact error and no engine call;
    - support on + priced media send → 422 before the vendor call;
    - free media send under support → allowed;
    - commit with Promise=asked does not overwrite `promise_status`;
    - objection counter increments once for two accepts on the same fan message and resets after an opened PPV;
    - RLS beat 3 + a send stamps `rls_beat_sent_at`; the next generate with a newer fan message advances it to 4 and returns `rlsBeat: 4`.
- [ ] **Step 2:** Run `php artisan test --filter=StateSwitches` and expect FAIL.
- [ ] **Step 3:** Implement the server side. Then the engine: `stateNote.js` + `runGenerate.js` wiring.
- [ ] **Step 4: Write `engine/switch_check.js`** (pattern: `engine/intent_check.js`, fake `callApi` capturing prompts). It asserts:
  - each switch value puts its line under the header in both strategy and generator prompts;
  - with `posture:'TIMEWASTER'` the session's `_posture` after generate is `TIMEWASTER` (the wrapper took effect via `eng.set`);
  - with `fanTier:'old'` the tier is `old` on a $0 trust-1 fan;
  - with `_profile.is_timewaster: true` + `posture:'WARM_BUILD'` the flagged tier wins;
  - with `promiseStatus:'in_progress'` the returned telemetry `promiseStatus` is `in_progress` even if legacy advanced it;
  - no `stateOverrides` → no header anywhere and prompts identical to a run without the module.
- [ ] **Step 5:** Run everything in Global Constraints → Checks. Commit `feat(state): server + engine for state switches and counters`.

### Task 2: Client

**Files:**
- **Create:** `resources/js/components/crm/conversations/SsStateCard.vue`, `resources/js/lib/stateSwitches.ts`.
- **Modify:**
  - `resources/js/components/crm/conversations/SsFanPanel.vue`: mount the card under Memory & controls.
  - `resources/js/lib/onlyfans.ts`: types for the contract; `saveProfile` accepts `state_overrides`.
  - `resources/js/types/crm.ts`.
  - `resources/js/components/crm/conversations/SsIntentBar.vue`: support locks, lit FreePicture/PPV, counters line parts.
  - `resources/js/components/crm/conversations/SsPpvStrip.vue`: `Ladder: $N [Use]`.
  - `resources/js/components/crm/conversations/SsChatThread.vue`: "Support mode" header pill.
  - `resources/js/pages/Conversations.vue`: hold the fan's state + counters per chat, feed the bar/strip, block PPV step load under support, update counters/rlsBeat from the generate response.
  - `resources/js/lib/chatCounters.ts`: `returning` honours a fan_type override.
- **Test:** `tests/client/state-check.mjs`.

**Interfaces:**
- Consumes ONLY the fixed contract above. Task 1 runs in parallel; for the browser check, stub the endpoints in the harness fake if Task 1's code isn't merged yet.
- **Produces (`lib/stateSwitches.ts`):**
  - `SWITCHES`: ordered rows `{key, label, values:[{value,label}]}`. Labels: Phase (Warm up, Rapport, Link, Sale, Loop, Aftersale), RLS beat (1–12), Fan type (New, Returning, Spender), Lane (Normal, Sex-only, Rude), Posture (Normal, Frame-hold, Timewaster), Trust (L1–L5), Promise (Not asked, Asked, Reinforced ×1, Reinforced ×2), Language (ES, EN), Support mode (Off, On).
  - `rowValue(key, profile)`: `{text, manual: boolean, disabled: boolean, reason?: string}`:
    - Auto rows read `Auto · {auto label}`, or `Auto` alone when no read;
    - Fan type with `fan_type_from_trust` reads `Auto · Returning (from trust L{n})`;
    - Posture is disabled with `Timewaster (flag on Fan tab)` when `is_timewaster`;
    - Language is hidden unless `is_bilingual`.
  - `nextRung(ladder: number[], lastBought: number | null): number | null`: the smallest ladder price > lastBought, the first rung when null, null past the top.
  - `lastRungBought(messages, tags)`: the newest opened chat PPV's price (reuse `effectiveTag` from `chatCounters.ts`).
  - `sellingIntent(key): boolean`, mirroring `StateSwitches::SELLING_INTENTS`.
- **The card:**
  - one row per switch, with a dropdown (Auto + values; Lane/Support have no Auto, their first value is the default);
  - a save on change is optimistic with rollback (like `SsFanPanel`'s toggles);
  - the Trust row reuses the existing trust save/lock (`trust_level` + unlock);
  - manual rows are visually highlighted;
  - ss-* styling.
- **The counters line** adds `last rung $21 → next $35 · objections 3 · sex-only 2` (each part only when meaningful).
- **Lit chips:** FreePicture lit at objections ≥ 3 ("He's objected 3 times — a free teaser can help"); PPV lit at sex-only ≥ 2 ("He keeps pushing for sexual content — time to sell") when PPV is unlocked.
- **Support mode on:** every selling chip disabled with `Support mode is on — no selling.`, a PPV/media-priced script step won't load (`loadStep` returns false + `st.error` the same text), and the header pill shows.

- [ ] **Step 1: Write `tests/client/state-check.mjs`.** It checks:
  - `rowValue` for each switch (auto, manual, from-trust, timewaster-disabled, language hidden);
  - `nextRung` (null → 12, 21 → 35, 100 → null, an off-ladder 25 → 35);
  - `lastRungBought` (newest opened chat PPV; ignores hidden mass and free_preview);
  - `sellingIntent` membership;
  - `chatCounters` returning = true with a fan_type override of returning on a short thread.

  Run it and expect FAIL.
- [ ] **Step 2:** Implement the lib, card, bar, strip, pill and page wiring. Run the checks and expect PASS.
- [ ] **Step 3: Browser check** in the isolated harness (`/private/tmp/claude-501/-Users-resul-Desktop-projects-SmartStars-SSAI-SSAI/de201903-a8a1-4243-80af-a71bed2f6618/scratchpad/bc`; earlier tasks' reports describe it; stub the profile GET/PATCH in the fake if needed). Verify:
  - the card renders all rows;
  - setting Posture → Frame-hold PATCHes `{state_overrides:{posture:'frame_hold'}}`, and Auto PATCHes null;
  - support on disables CTA with the reason and shows the pill;
  - objections 3 lights FreePicture.

  Screenshots at 1440 and 390 wide.
- [ ] **Step 4:** Run everything in Global Constraints → Checks. Commit `feat(state): SSAI state card, counters, support mode UI`.

### Task 3: Integration, real-AI check, docs

**Files:**
- Modify: whatever the join needs.
- Modify: `CLAUDE.md` (a "State switches (§5b)" paragraph + `engine/switch_check.js` in the guard list), `docs/chatter-guide.md` (a new section for the SSAI state card and support mode).
- Create: `engine/switch_spot.js` (manual, invented threads).

- [ ] **Step 1:** Merge both tracks. Run all checks. Fix contract mismatches at the seam.
- [ ] **Step 2: End-to-end browser check** (real Laravel + fake OnlyFans + fake engine, which records the engine payload):
  - setting Posture frame-hold and Lane rude makes the next generate's engine payload carry `stateOverrides` `{posture:'PRESSURE', frameHold:true, lane:'rude'}`;
  - Auto again → no `stateOverrides`;
  - support on → CTA disabled, and a priced send is refused with the exact error.
- [ ] **Step 3: Real-AI spot check** (`node engine/switch_spot.js`, the `ANTHROPIC_API_KEY` from `.env`). 2 drafts each for: Lane rude, Support mode on (a fan asking to see content), Language ES (an English thread), Phase warm up, Posture frame-hold (a fan asking for free validation).
  - Judge each draft on its rule (spec §4).
  - Report "no forbidden content X/Y; switch followed N/Y" honestly, with every draft verbatim.
  - Rerun a failing one once with a reworded rule (only in `stateNote.js`) and say so.
- [ ] **Step 4:** Write the docs.
- [ ] **Step 5:** Commit `feat(state): integrate, spot check, docs`.
