# PPV Slice 2: AI Price Suggestion + "Not Ready" Warning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A caption Generate with a PPV set loaded also returns an AI price suggestion (shown
beside the set's price chip with a **Use** button) and, when SSAI's saved plan wasn't a selling
move, a "not ready" warning on the caption draft.

**Architecture:** In caption mode the engine stops short-circuiting legacy's own `price_ppv`
call. It appends the set's media counts to that prompt, awaits the call (≤20s), and returns
`ppvSuggestion`. Laravel validates and clamps the suggestion. Laravel also decides the warning
from `aich_chat_state.next_planned_move` plus the stale rules, and returns `ppvNotReady`. The
Vue composer stores both on the loaded `ComposerPpv` and renders them in `SsPpvStrip` /
`SsComposer`.

**Tech Stack:** Node engine wrapper (`engine/`), Laravel 13 / Pest, Vue 3 + TS.

**Spec:** `docs/superpowers/specs/2026-11-22-ppv-price-suggestion-design.md`

**One deviation from the spec (plan author's call):** the spec routes the plan through the
engine (`ppvPlan` input → `telemetry.ppvPlanBeforeCaption`). The engine would only echo a value
Laravel already computed, so Laravel computes it and returns it as top-level **`ppvNotReady`**.
The engine is not involved in the warning at all. Behaviour is identical, with fewer moving parts.

## Global Constraints

- Never edit `legacy/js/*`. Engine changes are wrappers in `engine/runGenerate.js` only.
- Normal (`sender:'customer'`) generates stay byte-identical: the `price_ppv` short-circuit stays
  for them, and they get no `ppvSuggestion` / `ppvNotReady` key.
- The suggestion never changes the chip price on its own. Only **Use** does, via the existing
  `update:price` path.
- Sendable suggestion: whole dollars, clamped to **$3–$200**. Suffixes: `· capped at $200` /
  `· raised to the $3 minimum`.
- The price prompt gets media counts by type only. No set name, no preset price.
- Warn plans: `rapport_beat`, `qualifying_question`, `aftercare`, `goodbye_script`,
  `manager_flag`. Everything else (incl. unknown / null) → no warning.
- Nothing new is persisted. Caption mode still skips `commitState`, AI Intel, and memory write-back.
- Every new request field needs a validation rule (Laravel strips unlisted nested keys).

## Review Focus

1. **The price call hangs or throws** → the caption still returns, with
   `ppvSuggestion: {error}`. (Task 1 test `hung price call`.)
2. **The model returns 0, 250, 12.6, a string, or junk JSON** → a clamped whole-dollar price or
   `{error}`, never an unsendable number. (Task 2 dataset.)
3. **Accept & Send right before loading a set** (the accepted draft is one creator message after
   the commit) → the warning still shows. Two creator messages after the commit → no warning.
   (Task 3.)
4. **The chatter edits the chip while the caption is generating** → the edited price survives
   the response. The result is merged into the *current* `st.ppv`, not a snapshot taken at
   Generate time. (Task 4 step.)
5. **A normal reply Generate** → no `price_ppv` call and no new response keys. (Task 1 and
   Task 2 tests.)

---

### Task 1: Engine — price suggestion in caption mode

**Files:**
- Modify: `engine/runGenerate.js` (the `price_ppv` short-circuit block ~71–82, and the return object ~100)
- Create: `engine/ppv_price_check.js`
- Modify: `engine/ppv_caption_check.js` (its "no price_ppv call in caption mode" assertion flips)

**Interfaces:**
- Consumes: `input.sender`, plus new optional `input.ppvMedia: {photo?, video?, gif?, audio?: number}`.
  New `opts.priceTimeoutMs` (tests). Default `Number(process.env.PPV_PRICE_TIMEOUT_MS) || 20000`.
- Produces: result field `ppvSuggestion`: `{price:number, reason:string}` | `{error:string}` |
  `null` (null exactly when `sender !== 'ppv'`).

- [ ] **Step 1: Write `engine/ppv_price_check.js`** (copy the harness shape of `ppv_caption_check.js`:
  fake `callApi` recording `{tag, user}`, with the same `fakeStrategy`). The fake answers `price_ppv`
  with a per-case string. Cases and assertions:
  - `ok`: answer `{"price":14,"reason":"cold lurker, first PPV"}`, `ppvMedia:{photo:3,video:1}`,
    `sender:'ppv'` → exactly one `price_ppv` call. Its `user` includes
    `THE PPV BEING SENT (the content this price is for): 3 photos, 1 video`.
    `out.ppvSuggestion` deep-equals `{price:14, reason:'cold lurker, first PPV'}`.
  - `singular`: `ppvMedia:{photo:1}` → prompt includes `: 1 photo` and no `video`.
  - `no media`: no `ppvMedia` → prompt does NOT include `THE PPV BEING SENT`.
  - `sexting`: `session._sextingModeToggle:'FORCE_ON'`, answer price 20 → `ppvSuggestion.price === 25`
    and `reason` includes `sexting × 1.25` (legacy's multiplier, untouched).
  - `garbage`: answer `'not json'` → `ppvSuggestion` has a string `error` and no `price`.
  - `hung price call`: the `price_ppv` fake returns `new Promise(() => {})`, `opts.priceTimeoutMs: 50`
    → `generateDraft` resolves, `out.draft` non-empty, `ppvSuggestion.error` matches `/timed out/`.
  - `reply`: `sender:'customer'` → no `price_ppv` call reaches the fake. `out.ppvSuggestion === null`.
  - End with `console.log('✓ ppv_price_check: …')`. On failure `process.exit(1)`, same as the sibling checks.

- [ ] **Step 2: Run it, expect FAIL**

  Run: `node engine/ppv_price_check.js`
  Expected: FAIL. No `price_ppv` call is recorded (the short-circuit still returns `''`).

- [ ] **Step 3: Implement in `engine/runGenerate.js`**
  - Caption mode (`input.sender === 'ppv'`): the `callApi` wrapper, for tag `price_ppv`, appends
    the media block to `user` (only when counts are non-empty). It calls `inner`, stores the
    promise in a local `pricePromise`, and returns it. The block format is
    `\n\nTHE PPV BEING SENT (the content this price is for): ` + the non-zero counts joined with
    `, `, in the order photo, video, gif, audio, pluralised (`photo/photos`, `video/videos`,
    `GIF/GIFs`, `audio clip/audio clips`). Any other mode: keep the existing `Promise.resolve('')`.
  - After `await eng.generate()`, in caption mode: if `pricePromise` exists, race it (errors
    swallowed) against the timeout. Then yield one macrotask (`await new Promise(r => setImmediate(r))`)
    so legacy's continuation inside `fetchPpvSuggestion` writes `s._ppvSuggestion`. Map it:
    - `typeof price === 'number'` → `{price, reason}`
    - `.error` → `{error}`
    - still `loading` → `{error:'price suggestion timed out'}`
    - no `pricePromise` at all → `{error:'no price suggestion'}`
  - Return `ppvSuggestion` (null outside caption mode) at the top level of the result.
  - Comment that a timed-out call may still bill later, and that it then misses the usage ledger.
  - If the DOM stub throws inside `fetchPpvSuggestion` (`ppvSuggestCard.outerHTML =`,
    `updateOpenPpvModal`), fix it in `engine/loadEngine.js`'s `makeEl`, not in legacy.

- [ ] **Step 4: Flip `engine/ppv_caption_check.js`.** Replace the
  `!ppv.some(c => c.tag === 'price_ppv')` assertion with "exactly one `price_ppv` call in caption
  mode". Add "zero `price_ppv` calls in the `customer` run". Update the header comment and the
  success line.

- [ ] **Step 5: Run the engine guards, expect PASS**

  Run: `node engine/ppv_price_check.js && node engine/ppv_caption_check.js && node engine/parity.js && node engine/smoke.js && node engine/followup_check.js && node engine/usage_check.js && node legacy/tests/harness.js`
  Expected: all print their ✓ lines. Harness reports 283/0.

- [ ] **Step 6: Commit**

```bash
git add engine/runGenerate.js engine/ppv_price_check.js engine/ppv_caption_check.js engine/loadEngine.js
git commit -m "feat(ppv): engine returns legacy's PPV price suggestion in caption mode"
```

---

### Task 2: Laravel — forward set contents, clamp + return the suggestion

**Files:**
- Create: `app/Support/PpvPriceSuggestion.php`
- Modify: `app/Http/Controllers/OnlyFansChatController.php` (`generate()` rules ~877–900, the engine opts ~920, the response ~1007)
- Modify: `app/Services/Engine/EngineClient.php` (`generateFromLive` payload, next to `sender` ~87)
- Test: `tests/Unit/PpvPriceSuggestionTest.php`, `tests/Feature/OnlyFansChatCaptionTest.php`

**Interfaces:**
- Consumes: the engine result `ppvSuggestion` (Task 1).
- Produces: `PpvPriceSuggestion::normalize(mixed $raw): ?array`, returning `null` |
  `['price' => int, 'reason' => string]` | `['error' => string]`. Generate response key
  **`ppvSuggestion`** is present only when `sender === 'ppv'`. Request field
  **`ppvMedia`** (`{photo,video,gif,audio}` ints) is forwarded to the engine as `ppvMedia`
  only in caption mode.

- [ ] **Step 1: Write `tests/Unit/PpvPriceSuggestionTest.php`** as a Pest dataset over `normalize()`:
  - `null` → `null`
  - `['price'=>14,'reason'=>'cold']` → `['price'=>14,'reason'=>'cold']`
  - `['price'=>12.6,'reason'=>'x']` → price `13`
  - `['price'=>250,'reason'=>'whale']` → `['price'=>200,'reason'=>'whale · capped at $200']`
  - `['price'=>1,'reason'=>'cold']` → `['price'=>3,'reason'=>'cold · raised to the $3 minimum']`
  - `['price'=>0]`, `['price'=>'abc']`, `[]` → `['error'=>'no usable price']`
  - `['error'=>'price suggestion timed out']` → same error passed through
  - A reason longer than 160 chars is truncated to 160.

- [ ] **Step 2: Add feature tests to `OnlyFansChatCaptionTest.php`** (extend the engine fake to return `ppvSuggestion`):
  - `returns the clamped suggestion in caption mode`: engine `['price'=>250,'reason'=>'whale']`,
    `sender:'ppv'` → `assertJsonPath('ppvSuggestion.price', 200)`.
  - `forwards ppvMedia counts in caption mode`: post `ppvMedia:{photo:3,video:1}` → `Http::assertSent`
    with `data_get($r->data(),'ppvMedia.photo') === 3`.
  - `omits ppvSuggestion and ppvMedia on a reply`: `sender` absent → `assertJsonMissingPath('ppvSuggestion')`,
    and the engine request has no `ppvMedia` key.
  - `rejects bad ppvMedia`: `ppvMedia:{photo:-1}` → 422. `ppvMedia:{photo:41}` → 422.

- [ ] **Step 3: Run, expect FAIL**

  Run: `php artisan test --filter='PpvPriceSuggestion|OnlyFansChatCaption'`
  Expected: FAIL (class missing, keys missing).

- [ ] **Step 4: Implement**
  - `PpvPriceSuggestion::normalize`: `final` class, static method, values as tested.
  - Controller rules: `'ppvMedia' => 'nullable|array'`, plus
    `'ppvMedia.photo|video|gif|audio' => 'nullable|integer|min:0|max:40'` (four rules).
  - Pass `'ppvMedia' => $captionMode ? ($data['ppvMedia'] ?? null) : null` into the opts.
    `EngineClient::generateFromLive` adds `'ppvMedia' => $opts['ppvMedia'] ?? null` to the
    top-level payload, beside `sender`.
  - Response: add `'ppvSuggestion' => PpvPriceSuggestion::normalize($out['ppvSuggestion'] ?? null)`
    only when `$captionMode` (array spread / conditional key).

- [ ] **Step 5: Run, expect PASS**

  Run: `php artisan test --filter='PpvPriceSuggestion|OnlyFansChatCaption|OnlyFansChatTest|DraftRejection'`
  Expected: PASS. The 5 known `HtmlSanitizer` failures in `OnlyFansChatTest` are pre-existing
  if `vendor/` lacks it; they are not a regression.

- [ ] **Step 6: Commit**

```bash
git add app/Support/PpvPriceSuggestion.php app/Http/Controllers/OnlyFansChatController.php app/Services/Engine/EngineClient.php tests/Unit/PpvPriceSuggestionTest.php tests/Feature/OnlyFansChatCaptionTest.php
git commit -m "feat(ppv): forward set contents to pricing and return a clamped suggestion"
```

---

### Task 3: Laravel — "not ready" plan with the stale rules

**Files:**
- Create: `app/Services/OnlyFans/PpvReadiness.php`
- Modify: `app/Http/Controllers/OnlyFansChatController.php` (`generate()` response, caption mode only; `$state` is already loaded ~915)
- Test: `tests/Unit/PpvReadinessTest.php`, `tests/Feature/OnlyFansChatCaptionTest.php`

**Interfaces:**
- Consumes: `AichChatState` (`next_planned_move`, `updated_at`), the validated `$data['messages']`
  (raw payload rows: `from`, `time`, `price`, `isFree`, `isTip`),
  `DraftRejectionService::isActive(int $at, array $times, int $now, int $gap): bool`.
- Produces: `PpvReadiness::plan(?AichChatState $state, array $messages, int $now, int $gapSeconds): ?string`.
  The generate response key **`ppvNotReady`** (string|null) is present only in caption mode.
  Constant `PpvReadiness::WARN = ['rapport_beat','qualifying_question','aftercare','goodbye_script','manager_flag']`.

- [ ] **Step 1: Write `tests/Unit/PpvReadinessTest.php`.** Build an unsaved `AichChatState` with
  `next_planned_move` and `updated_at` set to commit time T. Messages are given as offsets from T.
  `$now` = T+10min, gap = 12h. Cases:
  - `rapport_beat`, no messages after T → `'rapport_beat'`
  - `aftercare` → `'aftercare'`
  - `send_ppv`, `cta2`, `seed_cta`, `tier_jump_test`, `exclusive_custom`, `'weird_value'`, `null` → `null`
  - `null` state → `null`
  - one creator text message at T+5s (the accepted draft) → `'rapport_beat'`
  - fan message at T+1min and one creator message at T+5s → `'rapport_beat'` (fan messages don't count)
  - two creator messages after T → `null`
  - one creator PPV after T (`price:20,isFree:false,isTip:false`) → `null`
  - a creator *tip-flagged* priced message after T → still counts as a creator message, not a PPV
  - `$now` = T+13h with no messages after T → `null` (gap)
  - messages at T+1h and T+14h, `$now` = T+14h5m → `null` (13h gap inside the thread)

- [ ] **Step 2: Add a feature test** `returns ppvNotReady from saved chat state in caption mode`:
  create an `AichChatState` (`creator_model` 'Camila', `chat_id` '101',
  `next_planned_move` 'rapport_beat'), run `captionGenerate(['sender'=>'ppv'])` →
  `assertJsonPath('ppvNotReady','rapport_beat')`. Then the same with no `sender` →
  `assertJsonMissingPath('ppvNotReady')`. Also assert the `AichChatState` row is unchanged
  after the caption generate.

- [ ] **Step 3: Run, expect FAIL**

  Run: `php artisan test --filter='PpvReadiness|OnlyFansChatCaption'`

- [ ] **Step 4: Implement `PpvReadiness::plan`**, in this order:
  1. Plan not in `WARN`, or no state → null.
  2. `$at = $state->updated_at->getTimestamp()`. Parse every message `time` with `strtotime`
     and drop unparseable ones. `! DraftRejectionService::isActive($at, $times, $now, $gapSeconds)` → null.
  3. Take creator messages (`from === 'creator'`) with ts > `$at`. If any has `price > 0`,
     `! isFree`, and `! isTip` → null. If more than 1 → null.
  4. Return the plan.

  No clock-skew slack. A sent draft that lands a few seconds "before" the commit only lowers
  the count. In the controller, add
  `'ppvNotReady' => $this->readiness->plan($state, $data['messages'] ?? [], now()->getTimestamp(), (int) config('services.engine.session_gap_hours', 12) * 3600)`
  for caption mode only. Inject `PpvReadiness` via the constructor, like the other services.

- [ ] **Step 5: Run, expect PASS**

  Run: `php artisan test --filter='PpvReadiness|OnlyFansChatCaption|ChatState'`

- [ ] **Step 6: Commit**

```bash
git add app/Services/OnlyFans/PpvReadiness.php app/Http/Controllers/OnlyFansChatController.php tests/Unit/PpvReadinessTest.php tests/Feature/OnlyFansChatCaptionTest.php
git commit -m "feat(ppv): warn when SSAI's saved plan wasn't a selling move"
```

---

### Task 4: Client — show the suggestion and the warning

**Files:**
- Modify: `resources/js/types/crm.ts` (`ComposerPpv` ~170; new `PpvPriceSuggestion` type)
- Modify: `resources/js/lib/onlyfans.ts` (`generate` result type ~390)
- Modify: `resources/js/lib/ppvComposer.ts` (three pure helpers)
- Modify: `tests/client/ppv-composer-check.mjs`
- Modify: `resources/js/pages/Conversations.vue` (`generate()` ~200–290, plus wherever `ComposerPpv` is built in `loadPpvSet`)
- Modify: `resources/js/components/crm/conversations/SsPpvStrip.vue`
- Modify: `resources/js/components/crm/conversations/SsComposer.vue` (suggestion card ~272)

**Interfaces:**
- Consumes: response keys `ppvSuggestion` (Task 2) and `ppvNotReady` (Task 3). Request key `ppvMedia` (Task 2).
- Produces:
  - `type PpvPriceSuggestion = { price: number; reason: string } | { error: string }`
  - `ComposerPpv` gains `priceSuggestion: PpvPriceSuggestion | null` and `notReadyPlan: string | null`
    (both `null` when a set is loaded).
  - In `ppvComposer.ts`:
    - `ppvMediaCounts(media: PpvSetMedia[]): Partial<Record<'photo'|'video'|'gif'|'audio', number>>`
      (non-zero keys only)
    - `humanPlan(plan: string): string`
    - `priceSuggestionView(s: PpvPriceSuggestion | null, generating: boolean, chipPrice: number): { kind: 'pricing'|'error'|'agree'|'offer'|'none'; price?: number; reason?: string; error?: string }`

- [ ] **Step 1: Extend `tests/client/ppv-composer-check.mjs`** with:
  - `ppvMediaCounts([{type:'photo'},{type:'photo'},{type:'video'}])` deep-equals `{photo:2, video:1}`. `[]` → `{}`.
  - `humanPlan`: `rapport_beat`→`a rapport beat`, `qualifying_question`→`a qualifying question`,
    `aftercare`→`aftercare`, `goodbye_script`→`a goodbye`, `manager_flag`→`a manager flag`,
    `some_new_move`→`some new move`.
  - `priceSuggestionView`:
    - `(null, true, 20).kind === 'pricing'`
    - `(null, false, 20).kind === 'none'`
    - `({error:'x'}, false, 20)` → `{kind:'error', error:'x'}`
    - `({price:12,reason:'r'}, false, 20)` → `kind 'offer'`
    - `({price:20,reason:'r'}, false, 20)` → `kind 'agree'`
    - `({price:12,reason:'r'}, true, 20).kind === 'pricing'` (a regenerate in flight hides the old one)

- [ ] **Step 2: Run, expect FAIL**

  Run: `node --experimental-strip-types tests/client/ppv-composer-check.mjs`

- [ ] **Step 3: Implement the helpers and types.** Extend the `generate` result type with
  `ppvSuggestion?: PpvPriceSuggestion | null; ppvNotReady?: string | null`. Initialise
  `priceSuggestion: null, notReadyPlan: null` wherever a `ComposerPpv` is constructed.

- [ ] **Step 4: Wire `Conversations.vue` `generate()`**
  - When `captionFor !== null`: clear `st.ppv.priceSuggestion` / `notReadyPlan` before the request
    (replace `st.ppv` with a spread copy), and add `ppvMedia: ppvMediaCounts(st.ppv.media)` to the payload.
  - On a result that still applies, with `captionFor !== null`: re-read **the current `st.ppv`**
    after the await, then set `st.ppv = { ...st.ppv, priceSuggestion: data.ppvSuggestion ?? null, notReadyPlan: data.ppvNotReady ?? null }`.
    Never touch `price` (Review Focus #4).

- [ ] **Step 5: `SsPpvStrip.vue`.** Add a `generating: boolean` prop (SsComposer passes its own
  `generating`). Right of the price chip, render from `priceSuggestionView(ppv.priceSuggestion, generating, ppv.price)`:
  - `pricing` → muted `AI pricing…`
  - `error` → muted `AI price unavailable` (error in `title`)
  - `agree` → `AI agrees: $20 · {reason}`
  - `offer` → `AI: $12 · {reason}` + a **Use** button emitting `update:price` with the price
  - `none` → nothing

  Use `usd()` for amounts and `ss-*` tokens. Truncate the reason with ellipsis and put the full
  text in `title`. It must wrap without breaking the strip at narrow widths.

- [ ] **Step 6: `SsComposer.vue` suggestion card.** When `props.ppv?.notReadyPlan` and a
  suggestion is shown, add an amber line above the caption text:
  `⚠ SSAI planned {humanPlan(plan)} next. Caption written anyway, send only if he's ready to unlock.`
  Use the `ss-*` amber/warning token the strip's invalid-price note already uses.

- [ ] **Step 7: Verify**

  Run: `node --experimental-strip-types tests/client/ppv-composer-check.mjs && npm run types:check && npm run lint:check && npm run build`
  Expected: check prints ✓, and types/lint/build exit 0.

- [ ] **Step 8: Browser check.** Follow the local browser-check recipe (throwaway SQLite, blank OF
  key, fake engine response). Load a set and Generate. Confirm:
  - `AI pricing…`, then `AI: $12 · … [Use]`
  - Use sets the chip and the Send label to `$12`
  - the warning line shows when the fake returns `ppvNotReady`
  - removing the set clears both

- [ ] **Step 9: Commit**

```bash
git add resources/js tests/client/ppv-composer-check.mjs
git commit -m "feat(ppv): show the AI price suggestion beside the chip and the not-ready warning"
```

---

### Task 5: Docs + full regression

**Files:**
- Modify: `docs/chatter-guide.md` (§7 "Sending a PPV", §8 "Known limits")
- Modify: `CLAUDE.md` (PPV sets paragraph; engine input-guards list)

- [ ] **Step 1: Chatter guide.**
  - §7: after Generate, the strip may show `AI: $X · reason [Use]`. The set's price stays unless
    you click Use. "AI agrees" means it matches. The amber warning means SSAI had planned a
    non-selling move. Send only if he's ready.
  - §8: replace "doesn't pick the set or suggest the price yet" with "suggests a price, but
    doesn't pick the set yet".

- [ ] **Step 2: CLAUDE.md.**
  - In the PPV sets paragraph: the `price_ppv` short-circuit is lifted in caption mode only.
  - Response keys `ppvSuggestion` (clamped by `App\Support\PpvPriceSuggestion`) and `ppvNotReady`
    (`PpvReadiness`, warn list + stale rules).
  - Request `ppvMedia`.
  - Add `node engine/ppv_price_check.js` to the input-guards list. Update the `ppv_caption_check`
    description, which says it asserts NO `price_ppv` call.

- [ ] **Step 3: Full regression**

  Run: `php artisan test && node engine/parity.js && node engine/smoke.js && node engine/concurrency_check.js && node engine/ppv_price_check.js && node engine/ppv_caption_check.js && node legacy/tests/harness.js`
  Expected: Pest green (except the documented pre-existing `HtmlSanitizer` failures if
  `vendor/` lacks it). Engine checks ✓. Harness 283/0.

- [ ] **Step 4: Commit**

```bash
git add docs/chatter-guide.md CLAUDE.md
git commit -m "docs(ppv): price suggestion + not-ready warning in chatter guide and CLAUDE.md"
```
