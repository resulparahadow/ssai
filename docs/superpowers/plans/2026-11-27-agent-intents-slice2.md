# Agent intents — Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the rest of the §5a buttons that SSAI's playbook already defines:
- CTA 1/2 and Objection ▾ (11 types);
- Sexting and Promise ▾ (Ask / Reinforce ×1 / ×2);
- Post-purchase, Post-tip, Tip ask;
- FreePicture, Breadcrumb, Hook, ChitChat, Follow-up;
- Aftersale ▾ (legacy aftercare template) and Goodbye ▾ (Phase 1/2/3).

**Architecture:** Slice 1's machinery stays. One server catalogue builds a directive per intent key and option, and the directive rides legacy's AGENT OVERRIDE `context` for one generate.
- **The intent list:** a shared JSON catalogue (keys, options, labels, bar placement) is read by both PHP (validation) and the client (chips). The directive text stays in PHP.
- **Aftersale is the exception.** It sends legacy's aftercare mode (`_aftercareMode` / `_aftercareContext`) and no context.
- **FreePicture is a client flow.** The chatter picks vault photos, they load as an ad-hoc free media step, and caption mode writes the caption.

**Tech Stack:** Laravel 13 / Pest, Inertia 2 + Vue 3 TS, Tailwind `ss-*`, Node engine checks.

**Spec:** `docs/superpowers/specs/2026-11-26-agent-intents-design.md` (§3 exception, §4 catalogue table, §6 FreePicture, §8 UI, §9a edge rules). Slice 1 shipped in PR #28/#29; its code is the baseline.

## Global Constraints

- Branch `feature/agent-intents-2`, cut from `main` (87e0290). Commit per task. Never push unless the user asks.
- Never edit `legacy/js/*`. A generate with no `intent` must reach the engine byte-identical to today.
- **One turn only:** an intent applies to ONE generate.
- **Directive framing, verbatim (slice 1):** `INTENT BUTTON — {Label}: {instruction}`, plus `"\n\nAgent note (apply within the intent above): {typed}"` when override text was typed.
- **Aftersale sends `aftercare: {mode: true, context: 'aftersex'|'ladder_stop'}` and NO context.** The chatter's typed text is not sent for that turn, the response carries `noteDropped: true` when text was typed, and the draft card shows `Your note wasn't used for Aftersale`. The typed text stays in the box.
- **Every non-media intent is disabled while a media step (or FreePicture media) is loaded**, reason `Remove the loaded PPV first`, and while busy or sending (slice-1 rule).
- **No new locks.** Every slice-2 button is "manual" in the doc, so none has a count rule.
- **The objection dropdown has the playbook's 11 types (PART 11, numbered 1–11)**, with these exact keys and labels:

  | Key | Label |
  |---|---|
  | `naked` | Only want naked |
  | `worth_it` | Is it worth it? |
  | `lied` | You lied / expected more |
  | `body_part` | Only want a body part / menu |
  | `cheaper` | Other girls show more for less |
  | `expensive` | Too expensive / discount |
  | `free` | Something for free |
  | `bad_experience` | Bad experiences |
  | `preview` | Send a preview |
  | `later` | Later / not now |
  | `didnt_like` | Didn't like it |

- **FreePicture media is ad-hoc:**
  - `ComposerStep.stepId === 0` (`AD_HOC_STEP_ID`), title `Free picture`, price 0, photos only, max 40.
  - The send posts `mediaFiles` only: no `scriptStepId`, no `price`.
  - Caption mode generates exactly once after the load.
- **Data rules:** `$fillable` only; new generate keys get validation rules (unlisted keys are stripped); JSON 422s.
- **Checks:** `php artisan test`, `npm run types:check`, `npm run lint:check`, prettier on changed files, and all `tests/client/*.mjs` (run with `node --experimental-strip-types`) pass at each task end. 10 untouched files are known pre-existing prettier warnings.
- **Testing limits:** never the real OnlyFans API or the real MySQL DB; `Scripts.csv` is never committed or quoted.

## Review Focus

1. **Aftersale with typed text.** Typed text must not reach the engine `context` (any context makes legacy skip the aftercare template). The response must say `noteDropped`, and the box must keep the text. Pinned in Task 1 (feature test) and Task 3 (browser).
2. **An option-bearing intent without an option, or with an option of another intent** (`intent=goodbye`, `intentOption=cta1`) returns 422 before any engine call. Pinned in Task 1.
3. **A late draft from Objection → Too expensive landing after the chatter clicked Objection → Later** must be dropped. The intent identity includes the option. Pinned in Task 2 (`sameIntent` cases in `generationStillApplies`).
4. **A FreePicture send must not write a script ledger row** (no `scriptStepId`) and must not carry a price. Pinned in Task 2 (`stepSendExtras`) and Task 4 (browser: inspect the send body).
5. **The catalogue JSON and PHP must not drift.** Every server key in the JSON has a directive, and every directive key is in the JSON. Pinned in Task 1 (Pest drift test).

---

### Task 1: Server — catalogue, directives, aftercare pass-through, engine guard

**Files:**
- Create: `resources/js/lib/intent-catalogue.json`
- Modify: `app/Support/AgentIntents.php`, `app/Http/Controllers/OnlyFansChatController.php` (`generate`), `app/Services/Engine/EngineClient.php` (`generateFromLive` session)
- Modify: `engine/intent_check.js`
- Test: `tests/Unit/AgentIntentsTest.php`, `tests/Feature/OnlyFansChatIntentTest.php`

**Interfaces:**
- Produces `intent-catalogue.json`: `{"intents":[{"key":string,"label":string,"group":"bar"|"more","server":bool,"options":[{"key":string,"label":string}]}]}`.
  - Order = chip order.
  - **bar:** `ppv` PPV, `repitch` Re-pitch, `cta` CTA, `objection` Objection, `chitchat` ChitChat, `sexting` Sexting, `tip_ask` Tip ask, `goodbye` Goodbye.
  - **more:** `reoffer_mppv` Re-offer MPPV, `promise` Promise, `post_purchase` Post-purchase, `post_tip` Post-tip, `free_picture` FreePicture, `breadcrumb` Breadcrumb, `hook` Hook, `follow_up` Follow-up, `aftersale` Aftersale.
  - `server: false` only for `ppv` and `free_picture`.
  - **Options:**
    - `cta`: `cta1` CTA 1, `cta2` CTA 2;
    - `objection`: the 11 in Global Constraints;
    - `promise`: `ask` Ask (RLS beat 11), `reinforce1` Reinforce ×1, `reinforce2` Reinforce ×2;
    - `goodbye`: `phase1` Phase 1, `phase2` Phase 2, `phase3` Phase 3;
    - `aftersale`: `after_sexting` After sexting, `after_no` After a no.
- Produces `AgentIntents`:
  - `static function catalogue(): array` reads `resource_path('js/lib/intent-catalogue.json')` once (static cache).
  - `static function serverKeys(): list<string>` replaces the `SERVER_KEYS` const; update its uses.
  - `static function options(string $key): list<string>`.
  - `static function directive(string $key, ?string $option, array $thread, array $droppedMass): string` — the signature gains `$option`.
  - `static function aftercareContext(string $option): string` maps `after_sexting → 'aftersex'`, `after_no → 'ladder_stop'`.
  - `aftersale` never reaches `directive` (it throws `IntentUnavailable('Unknown intent.')` if called).
- Directive copy, pinned exactly. `{L}` = the label shown on the card: the intent label, or `Intent – Option` for option intents (e.g. `Objection – Too expensive / discount`, `Goodbye – Phase 2`, `CTA – CTA 1`).
  - `cta` + `cta1`: `INTENT BUTTON — {L}: Write ONE CTA #1 message (PART 3 Step 4, The Connection): build the personal connection that makes him want to see more of her, tied to something he said. No content offer and no price yet.`
  - `cta` + `cta2`: `INTENT BUTTON — {L}: Write ONE CTA #2 message (PART 3 Step 7, The Reason to Buy): give him the reason to open or buy now, with curiosity tied to the scene. Never describe the content, never name a price.`
  - `objection` + any: `INTENT BUTTON — {L}: He has raised PART 11 objection {N} ("{option label}"). Write ONE message that solves it the PART 11 way: empathy, reframe to connection, a curiosity hook. Hold the price: no discount and no number in the text. Do not run the goodbye framework.` (`{N}` = the option's 1-based position.)
  - `sexting`: `INTENT BUTTON — {L}: Write ONE warm-up sexting beat (PART 23): build the scene with her in it, react to what he gave, and hand the next move back to him with a question. No PPV pitch and no price in this message.`
  - `promise` + `ask`: `INTENT BUTTON — {L}: Run the promise ritual opener now (PART 4; the PROMISE step, RLS beat 11): the trust ask that comes before any content. One message.`
  - `promise` + `reinforce1`: `INTENT BUTTON — {L}: He has agreed to the promise. Write the FIRST reinforcement beat (PART 4): reinforce, do not re-ask. One message.`
  - `promise` + `reinforce2`: `INTENT BUTTON — {L}: He has agreed to the promise and it was reinforced once. Write the SECOND reinforcement beat (PART 4): reinforce, do not re-ask. One message.`
  - `post_purchase`: `INTENT BUTTON — {L}: He just unlocked her PPV. Text first: an in-character reaction to him opening it plus ONE deepening question about him. No new pitch and no price in this message.`
  - `post_tip`: `INTENT BUTTON — {L}: He just tipped. Write ONE message of real appreciation plus a question about him. No content, no pitch, no price (TIP-ASKING DOCTRINE).`
  - `tip_ask`: `INTENT BUTTON — {L}: Write ONE tip ask (TIP-ASKING DOCTRINE). Keep it vague: NEVER a number, an amount or a price. Frame it as spoiling her or taking care of her, in her voice.`
  - `breadcrumb`: `INTENT BUTTON — {L}: Shift from chit-chat toward a CTA: drop ONE scene cue tied to something he said (BREADCRUMB) and let him react. No offer and no price.`
  - `hook`: `INTENT BUTTON — {L}: Write ONE eye-catching first message to a new subscriber (Warm Welcome): short, personal, easy to reply to. No selling.`
  - `chitchat`: `INTENT BUTTON — {L}: Write ONE rapport beat (PART 3 Step 2, Chit Chat): flirt on what he gave, ask about him. No selling and no mention of content in this message.`
  - `follow_up`: `INTENT BUTTON — {L}: He went quiet after spending. Write ONE re-engagement message: a callback to the last specific thing he shared, light and warm. No chasing, no guilt, no pitch.`
  - `goodbye` + `phaseN`: `INTENT BUTTON — {L}: Run Goodbye Framework PHASE {N} (PART 12): {name}. One message.` (names: 1 `bounce back and pivot`, 2 `chill chat and vetting`, 3 `smooth exit`).
- **Controller `generate`:**
  - Validation: `intent` ∈ `serverKeys()`, plus `intentOption` `nullable|string|max:32`.
  - A key with options requires an option from its own list, else 422 `Pick an option for this intent.` before any engine call. A key without options ignores `intentOption`.
  - `aftersale`: `context = ''`, engine opts `aftercare => ['mode' => true, 'context' => aftercareContext($option)]`, response `noteDropped = trim(typed) !== ''`.
  - Everything else: `context = compose(directive(...), typed)` as in slice 1.
  - The response keeps echoing `intent` and gains `intentOption`.
- **`EngineClient::generateFromLive`:** when `$opts['aftercare']` is set, the session gets `_aftercareMode => true` and `_aftercareContext => <context>`. Absent → no keys at all (byte-identical payload).
- **`engine/intent_check.js`** gains check 4: a session with `_aftercareMode: true, _aftercareContext: 'ladder_stop'` and empty context puts `AFTERCARE MODE — POST-SOFT-NO / LADDER-STOP VARIANT` and `HARD BLOCK: aftercare mode is ON` into the generator prompt. With `aftersex`, the POST-SEXTING variant appears instead. Without the mode, neither appears. Find the exact strings in `legacy/js/app.js` ~4909 and ~6630.

- [ ] **Step 1: Write the failing tests:**
  - Unit:
    - `catalogue lists every server key with a directive and no directive key outside it` (the drift guard: loop every server key and option and assert `directive()` returns a string starting `INTENT BUTTON — `, except `aftersale`);
    - `objection directive numbers the option and holds the price` (expensive → `PART 11 objection 6 ("Too expensive / discount")`);
    - `goodbye phase 2 directive names chill chat and vetting`;
    - `cta2 label reads CTA – CTA 2`;
    - `aftercareContext maps both options`.
  - Feature (`Http::fake`, engine body via `Http::recorded`):
    - `objection with an option puts the directive then the typed note in context`;
    - `an option intent without an option is 422 and the engine is never called`;
    - `an option from another intent is 422`;
    - `aftersale sends aftercare mode, empty context and noteDropped when text was typed`;
    - `aftersale without typed text has noteDropped false`;
    - `no intent sends no _aftercareMode key`.
- [ ] **Step 2:** Run `php artisan test --filter='AgentIntents|OnlyFansChatIntent'` and expect FAIL.
- [ ] **Step 3:** Implement. Also keep `engine/intent_directives.json` + its drift test from slice 1 green: they cover repitch/reoffer only, so only update them if a signature change touches them.
- [ ] **Step 4:** Run `node engine/intent_check.js` (4 checks pass), the full `php artisan test`, `node engine/parity.js`, `node engine/smoke.js` and `node legacy/tests/harness.js` (283/0).
- [ ] **Step 5: Commit** `feat(intents): slice 2 directives, catalogue, aftercare pass-through`.

### Task 2: Client logic — intent refs, catalogue access, ad-hoc media step

**Files:**
- Modify: `resources/js/types/crm.ts`, `resources/js/lib/chatCounters.ts`, `resources/js/lib/ppvComposer.ts`, `resources/js/lib/conversationCache.ts`
- Create: `resources/js/lib/intents.ts`
- Modify: `resources/js/pages/Conversations.vue` (only the type follow-through; no new UI yet)
- Test: `tests/client/intents-check.mjs`, `tests/client/ppv-composer-check.mjs`

**Interfaces:**
- Consumes: `intent-catalogue.json` (Task 1). Import it with `import catalogue from './intent-catalogue.json' with { type: 'json' };` so node strip-types and Vite both load it. If Vite or TS refuses that syntax, report it rather than duplicating the list.
- Produces (types):
  - `IntentKey` becomes the union of every catalogue key.
  - `interface IntentRef { key: IntentKey; option: string | null }`.
  - `ComposerState.intent: IntentRef | null` and `requestedIntent: IntentRef | null | undefined`.
- Produces (`lib/intents.ts`):
  - `intentCatalogue(): CatalogueIntent[]`
  - `sameIntent(a: IntentRef | null | undefined, b: IntentRef | null | undefined): boolean` (key + option; `undefined` equals only `undefined`)
  - `intentRefLabel(r: IntentRef): string` — `Re-pitch`, or `Objection – Too expensive / discount`, matching the server's `{L}`
  - `isServerIntent(key: IntentKey): boolean`
  - `export const AD_HOC_STEP_ID = 0`
- `intentLabel(key)` in `chatCounters.ts` reads labels from the catalogue (existing callers keep working).
- `generationStillApplies` / `generationOutcome` compare intents with `sameIntent`.
- `stepSendExtras(step)`: when `step.stepId === AD_HOC_STEP_ID` it returns `{ mediaFiles }` only (no `scriptStepId`, no `price`).
- `captionStepId(step)` keeps returning the id (0 is a valid caption target: check `!== null`, not truthiness; audit its call sites for `if (captionFor)` style checks and fix them).

- [ ] **Step 1: Write the failing checks:**
  - `sameIntent` true for an equal key+option, false for a different option, false for undefined vs null;
  - `intentRefLabel` for objection/expensive equals `Objection – Too expensive / discount`, and for repitch equals `Re-pitch`;
  - `generationStillApplies` drops a draft when only the option changed;
  - `stepSendExtras` for an ad-hoc step with 2 photos returns exactly `{ mediaFiles: [id1, id2] }`;
  - `captionStepId` of an ad-hoc media step is `0` (not null);
  - every catalogue key with `server: true` that has options has at least 2 options.
- [ ] **Step 2:** Run the checks and expect FAIL.
- [ ] **Step 3:** Implement, and follow the type change through `Conversations.vue` / `SsComposer` / `SsIntentBar` so `types:check` passes. Slice-1 behaviour is unchanged: posting `intent` for repitch/reoffer still works.
- [ ] **Step 4:** Run all `tests/client/*.mjs`, `types:check`, `lint:check` and `php artisan test`.
- [ ] **Step 5: Commit** `feat(intents): intent refs with options, ad-hoc media step`.

### Task 3: Intent bar with dropdowns + More, wired to generate

**Files:**
- Modify: `resources/js/components/crm/conversations/SsIntentBar.vue`, `SsComposer.vue`
- Modify: `resources/js/pages/Conversations.vue` (`generate(ref)`, the `noteDropped` notice)
- Modify: `resources/js/lib/onlyfans.ts` (payload type: `intentOption`; response: `intentOption`, `noteDropped`)

**Interfaces:**
- Consumes: Task 1 server contract; Task 2 `IntentRef`, `intentCatalogue`, `intentRefLabel`, `sameIntent`.
- **`SsIntentBar` renders from the catalogue:**
  - `group: 'bar'` chips inline;
  - `group: 'more'` inside a **More ▾** menu;
  - an intent with options opens a small menu of its options (one click on an option fires);
  - the existing counters line stays at the right.
- **Emits** `fire: [ref: IntentRef]`.
- **Locks:**
  - PPV / Re-pitch / Re-offer keep their slice-1 lock logic.
  - Every other server intent is enabled unless busy, sending, or a media step is loaded (`Remove the loaded PPV first`).
  - `free_picture` is enabled unless busy or sending.
- **Menus:** `role="menu"` / `menuitem`, Esc closes and returns focus to the trigger, click-outside closes, arrow keys move. Follow `SsPayPill.vue`'s menu from slice 1 and reuse its pattern. A disabled chip's reason stays a `title` plus sr-only text, as in slice 1.
- **`generate(ref: IntentRef | null)`:**
  - posts `intent` + `intentOption` for server intents;
  - sets `st.intent = ref` on success;
  - Regenerate and Reject & regenerate reuse `st.intent`.
- The draft card shows `Intent: {intentRefLabel}`, and when `noteDropped` is true a second muted line `Your note wasn't used for Aftersale`.
- The chip spinner, `requestedIntent` and the generate token behave exactly as in slice 1, using `sameIntent`.

- [ ] **Step 1:** Add `intents-check.mjs` cases for a pure helper `barLayout(catalogue)` exported from `lib/intents.ts`. It returns `{ bar: IntentKey[], more: IntentKey[] }` in catalogue order: `bar` starts `['ppv','repitch','cta','objection','chitchat','sexting','tip_ask','goodbye']`, and `more` contains `aftersale` and `free_picture`. Run and expect FAIL.
- [ ] **Step 2:** Implement the helper, the bar, menus, wiring and card lines. Run the check and expect PASS.
- [ ] **Step 3: Browser check** with the isolated harness: `/private/tmp/claude-501/-Users-resul-Desktop-projects-SmartStars-SSAI-SSAI/de201903-a8a1-4243-80af-a71bed2f6618/scratchpad/bc` (a throwaway SQLite copy + `fake.js`-style fake OnlyFans/engine on 8790; vite on a free port, not 5173; back up and restore `public/hot`; kill only your own PIDs). Verify:
  - **Objection ▾ → Too expensive / discount** posts `intent: 'objection', intentOption: 'expensive'` and the card reads `Intent: Objection – Too expensive / discount`.
  - **More ▾ → Aftersale ▸ After a no**, with override text typed, posts `intent: 'aftersale', intentOption: 'after_no'`. The card shows the note-dropped line, and the box still holds the text. Make the fake return `noteDropped: true` when it sees that request; Laravel computes it.
  - **With a PPV step loaded**, CTA is disabled with `Remove the loaded PPV first`.
  - **Keyboard:** Tab to Objection, open it with Enter, move with arrows, close with Esc.

  Screenshots at 1440 and 390 wide.
- [ ] **Step 4:** Run `types:check`, `lint:check`, prettier on changed files, all client checks and `php artisan test`.
- [ ] **Step 5: Commit** `feat(intents): slice 2 intent bar with dropdowns and More`.

### Task 4: FreePicture flow

**Files:**
- Modify: `resources/js/components/crm/conversations/SsVaultPickerModal.vue` (props `types?: string[]` to restrict the type pills, `title?`, `confirmLabel?`)
- Modify: `resources/js/components/crm/conversations/SsComposer.vue`, `resources/js/pages/Conversations.vue`

**Interfaces:**
- Consumes: `AD_HOC_STEP_ID`, `stepSendExtras`, `captionStepId` (Task 2); `fire({key:'free_picture'})` (Task 3).
- `SsVaultPickerModal` gains optional props:
  - `types` (when `['photo']`, only the Photo pill shows and the list is pre-filtered to photos);
  - `title` (default stays as today);
  - `confirmLabel` (default `Add {n} items`).
  - Existing callers are unchanged.
- **Clicking FreePicture:**
  - Opens the picker with `types: ['photo']`, `title: 'Free picture'`, `max: 40`.
  - On `add(media)`, `Conversations.vue` runs `loadFreePicture(media)`: the same replace-confirm as `loadStep` (cancel = nothing changes).
  - It then sets `st.step = { stepId: AD_HOC_STEP_ID, title: 'Free picture', price: 0, media, priceSuggestion: null, notReadyPlan: null }`, does `st.stepLoads++`, clears the draft/suggestion/intent as `loadStep` does, and calls `generate(null)` exactly once (caption mode, `sender: 'ppv'`).
- The strip shows the media with price **Free** (existing `SsPpvStrip`). The price chip stays editable. If the chatter sets a price, the step stops being ad-hoc-free: `stepSendExtras` must then send `price` too. **Ruling:** keep `stepId 0` but include `price` when > 0, and still never `scriptStepId`. Update Task 2's helper and checks in this task.
- A send of the ad-hoc step posts `mediaFiles` (+ `price` only when > 0) and no `scriptStepId`. After a successful send the step clears like any step.

- [ ] **Step 1:** Add `ppv-composer-check.mjs` cases: an ad-hoc step with price 0 → `{ mediaFiles }`; with price 12 → `{ mediaFiles, price: 12 }`; never `scriptStepId`. Run and expect FAIL on the price case.
- [ ] **Step 2:** Implement the props, the flow and the helper change. Run the checks and expect PASS.
- [ ] **Step 3: Browser check** (same harness; the fake must answer vault media list calls with a couple of photos — look at how slice-1 Task 6's fake served vault/scripts):
  - FreePicture opens a photo-only picker;
  - picking 2 photos loads the strip and fires exactly one `/generate` with `sender: 'ppv'`;
  - Send posts `mediaFiles` with no `scriptStepId` and no `price` (inspect the request body);
  - Cancel on the replace-confirm leaves the composer untouched.
- [ ] **Step 4:** Run the full checks + `php artisan test`.
- [ ] **Step 5: Commit** `feat(intents): FreePicture picks vault photos and captions them`.

### Task 5: Docs + real-AI spot check

**Files:**
- Modify: `CLAUDE.md` (extend the "Agent intents" paragraph: the catalogue JSON as the single list, slice-2 keys, Aftersale via aftercare mode + `noteDropped`, the FreePicture ad-hoc step `stepId 0`, guard 4 in `intent_check.js`)
- Modify: `docs/chatter-guide.md` §7b (every new button in plain words, plus the Aftersale note behaviour)
- Modify: `engine/intent_spot.js` (+ `engine/intent_directives.json` if it holds the copies)

**Interfaces:**
- `intent_spot.js` gains a slice-2 mode (`node engine/intent_spot.js --slice2`). It runs 2 drafts per slice-2 server intent on ONE invented thread (rapport-stage, fan mid-conversation): one objection option (`expensive`), CTA 1, CTA 2, Sexting, Promise Ask, Post-purchase, Post-tip, Tip ask, Breadcrumb, Hook, ChitChat, Follow-up, Goodbye Phase 3, and Aftersale (both variants, via `_aftercareMode`). That is about 30 generations of 2 calls each. Directives come from a JSON copy pinned to PHP by the drift test (extend slice 1's `intent_directives.json` approach).

- [ ] **Step 1:** Write the docs.
- [ ] **Step 2:** If `ANTHROPIC_API_KEY` is set (it is in `.env`), run `node engine/intent_spot.js --slice2`. Record every draft with a verdict against its directive's must / must-not lines (e.g. Tip ask has no number; Goodbye Phase 3 exits warmly; Aftersale doesn't pitch). If a directive fails twice, reword it in PHP + the JSON copy, rerun, and update the pinned test strings. Report the tally honestly.
- [ ] **Step 3:** Full verification: `php artisan test`, all client checks, engine `parity` / `smoke` / `intent_check` / `rejection_check` / `followup_check`, the legacy harness, `types:check`, `lint:check`.
- [ ] **Step 4: Commit** `docs(intents): slice 2 docs and spot check`.
