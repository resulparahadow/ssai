# Agent intents — Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship slice 1 of §5a: the chat counters, the **PPV / Re-pitch / Re-offer MPPV** intent buttons with the doc's lock rules, and the MPPV tag (auto + per-message manual override).

**Architecture:**
- **Server.** A server-side intent catalogue (`App\Support\AgentIntents`) turns an `intent` key
  into a playbook-worded directive. The directive rides legacy's AGENT OVERRIDE channel (the
  generate `context`), joined with the chatter's typed text. Per-message tags live in
  `aich_message_tags` and are applied inside `LiveThreadMapper`.
- **Client.** A pure `lib/chatCounters.ts` mirrors the mapper's tag rule and computes the counters
  and locks. The intent bar sits in `SsComposer`. PPV-with-nothing-loaded opens the Scripts panel
  on the next PPV step and auto-generates the caption once a step loads.

**Tech Stack:** Laravel 13 / Pest (in-memory SQLite), Inertia 2 + Vue 3 TS, Tailwind `ss-*` tokens, Node engine checks.

**Spec:** `docs/superpowers/specs/2026-11-26-agent-intents-design.md` (read §4–§9a; this plan is its slice 1, §11).

## Global Constraints

- **Branch.** Work on a new branch `feature/agent-intents` cut from `feature/scripts` (which is
  pushed but not merged). Commit per task. Never push without the user asking.
- **Parity.** Never edit `legacy/js/*`. A generate with no `intent` must reach the engine byte-identical to today.
- **One turn only.** An intent applies to ONE generate. The next plain Generate sends no directive.
- **Directive framing, verbatim:** `INTENT BUTTON — {Label}: {instruction}`. When the chatter typed
  override text, append `"\n\nAgent note (apply within the intent above): {typed}"`.
- **Lock rules, verbatim from the doc:**
  - PPV is greyed out when `total < (returning ? 10 : 12)` or `sinceLastPpv < 6`.
  - Re-pitch is enabled only when an unpaid chat PPV exists with `since >= 5`.
  - Re-offer MPPV is enabled only when an unbought mass PPV exists, and is never auto.
- **Effective tag rule (server + client must match):**
  - Only a creator message with `price > 0` and `!isTip` is taggable.
  - The tag is the override if stored, else `fromQueue ? 'mppv' : 'chat_ppv'`.
  - `free_preview` is manual-only.
  - Hidden from SSAI and from the counters: tag `mppv` AND not opened.
- **Counting:** a "message" is any message from either side, excluding hidden mass PPVs and
  `pending`/`failed` bubbles. Tips count. `hasMore` → `total` reads ≥ 100.
- **Returning fan:** the loaded thread has a message older than the current conversation (gap
  > `sessionGapHours`, the page prop already used by `lib/draftRejections.ts`), or `hasMore`.
- **Data:**
  - `aich_message_tags` is metadata only (no message text).
  - The model uses `$fillable` (never `$guarded`) and `BelongsToChatter`.
- **Validation:** new `generate` keys MUST get rules. Unlisted keys are stripped, the same trap as
  `messages.*.time` / `fromQueue`.
- **Styling:** `ss-*` tokens. `npm run lint:check`, `npm run types:check`, `npm run format:check`
  and `php artisan test` must pass at every task end.
- **Private content:** `Scripts.csv` is never committed or quoted, and the real OnlyFans API and
  the real MySQL DB are never used by tests.

## Review Focus

1. **A mass PPV the fan bought** (`fromQueue`, opened) must count as spend and as a PPV for
   `sinceLastPpv`, but must never be Re-pitch's "unpaid" PPV. The tests in Tasks 2 and 4 pin this.
2. **A chatter re-tags a mass PPV as `chat_ppv`.** It must then reach the engine as a `ppv`
   bubble and count for Re-pitch, on both server and client. Pinned in Tasks 2 and 4.
3. **An intent generate landing after the chatter clicked a different intent or loaded a step**
   must be dropped. Pinned in Task 4 (`generationStillApplies` with intent).
4. **Re-pitch clicked when the server sees no unpaid PPV** (e.g. the client counted a bubble the
   server dropped) must return a clear 422, not an empty directive. Pinned in Task 3.
5. **Typed override text plus an intent:** both must reach the engine `context` in the fixed
   order, and the typed text must stay in the box afterwards. Pinned in Tasks 3 and 5.

---

### Task 1: Message tags — table, model, endpoints

**Files:**
- Create: `database/migrations/2026_11_26_200000_create_aich_message_tags_table.php`
- Create: `app/Models/AichMessageTag.php`
- Create: `app/Http/Controllers/MessageTagController.php`
- Modify: `routes/web.php` (inside the `onlyfans/{model}` group, NOT the manage-team subgroup)
- Test: `tests/Feature/MessageTagTest.php`

**Interfaces:**
- Produces: table `aich_message_tags`:
  - columns `id`, `creator_model` string, `chat_id` string(64), `message_id` string(64),
    `tag` string(16), `user_id` nullable FK users `nullOnDelete`, timestamps;
  - unique (`creator_model`, `chat_id`, `message_id`).
- Produces: `AichMessageTag` with `TAGS = ['chat_ppv', 'mppv', 'free_preview']` and
  `static function forChat(string $creator, string $chat): array<string,string>` (message_id → tag,
  `withoutGlobalScopes`, for server use).
- Produces routes (all `authorizeCreator`-checked like `ScriptController::status`):
  - `GET onlyfans/{model}/chats/{chat}/tags` → `{tags: {"<messageId>": "<tag>"}}`
  - `PUT onlyfans/{model}/chats/{chat}/messages/{message}/tag` body `{tag}` → `{tag}`.
    It upserts and re-stamps `user_id` to the acting user on update.
  - `DELETE onlyfans/{model}/chats/{chat}/messages/{message}/tag` → 204.
- NB the literal `messages/{message}/tag` must not collide with existing `messages/{message}`
  routes. Check `php artisan route:list --path=onlyfans` after adding.

- [ ] **Step 1: Write failing tests** in `MessageTagTest.php`:
  - `it stores, replaces and clears a tag`: PUT `mppv`, then PUT `free_preview`, then GET →
    `{tags: {"m1": "free_preview"}}`; then DELETE → GET `{tags: {}}`.
  - `it rejects an unknown tag`: PUT `{tag: 'bogus'}` → 422 JSON.
  - `it scopes tags to the chat and creator`: a tag on chat 101 is absent from GET on chat 102 and on another creator.
  - `it forbids a chatter not assigned to the creator`: 403 on all three routes.
  - `it lets an assigned chatter tag`: 200.
- [ ] **Step 2:** Run `php artisan test --filter=MessageTagTest` and expect FAIL (route/table missing).
- [ ] **Step 3:** Implement the migration, the model (`$fillable` = `creator_model, chat_id,
  message_id, tag, user_id`; `use BelongsToChatter`), the controller and the routes. Validation
  errors must return JSON 422 (use the same `validateJson` style the chat controller uses).
- [ ] **Step 4:** Run `php artisan test --filter=MessageTagTest` and expect PASS. Then run the full `php artisan test`.
- [ ] **Step 5: Commit** `feat(intents): per-message MPPV tags (table + endpoints)`.

### Task 2: Mapper — ids, effective tags, droppedMass

**Files:**
- Modify: `app/Services/OnlyFans/LiveThreadMapper.php`
- Modify: `app/Http/Controllers/OnlyFansChatController.php` (generate validation + the tags passed to `map`)
- Test: `tests/Feature/LiveThreadMapperTest.php`, `tests/Feature/OnlyFansChatGenerateTagsTest.php` (new)

**Interfaces:**
- Consumes: `AichMessageTag::forChat()` (Task 1).
- Produces:
  `LiveThreadMapper::map(array $messages, int $gapHours = 12, string $timezone = 'UTC', array $tags = []): array`.
  The return gains two keys:
  - `'thread'` — the normalized items, sorted oldest→newest, each with `id` (string|null) and
    `tag` (`'chat_ppv'|'mppv'|'free_preview'|null`), hidden mass PPVs excluded;
  - `'droppedMass'` — the hidden ones, same shape, oldest→newest.

  `messages` / `total_spend` / `tips_spend` are unchanged in shape.
- Rules:
  - The effective tag is per Global Constraints and is applied BEFORE the mass filter.
  - The filter drops `tag === 'mppv' && !isOpened` (replacing the raw `fromQueue` test).
  - The `ppv` bubble requires `tag === 'chat_ppv' || tag === 'mppv'`.
  - `free_preview` is never a `ppv` bubble, but if opened its price still adds to `total_spend`
    (in-window).
  - The engine `messages` bubbles gain NO new keys.
- Generate validation adds `'messages.*.id' => 'nullable|string|max:64'`, and the controller passes
  `AichMessageTag::forChat($model->name, $chat)` as `$tags`.

- [ ] **Step 1: Write failing tests:**
  - Mapper unit tests:
    - `a chat_ppv tag on a fromQueue message keeps it and makes it a ppv bubble`;
    - `an mppv tag on a non-queue unopened priced message hides it`;
    - `free_preview is not a ppv bubble but an opened one still counts as spend`;
    - `an opened mass PPV stays, counts as spend and is tagged mppv in thread`;
    - `droppedMass returns the hidden unbought mass PPV with its id and text`;
    - `thread carries ids and tags, oldest first`;
    - `with no tags and no ids the engine messages are identical to before`. Snapshot the
      existing fixture's `messages` output, which must be unchanged.
  - Feature test (`OnlyFansChatGenerateTagsTest`): with `Http::fake` for OnlyFans + engine, a
    stored `chat_ppv` tag on message `m9` (a `fromQueue` priced unopened message in the posted
    thread) makes the engine request body contain a `sender: "ppv"` bubble. Read it via
    `Http::recorded`. Without the tag, it is absent.
- [ ] **Step 2:** Run the filters and expect FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run them and expect PASS. Then run the full suite.
- [ ] **Step 5: Commit** `feat(intents): mapper applies MPPV tags, returns thread + droppedMass`.

### Task 3: Intent catalogue + generate wiring + engine guard

**Files:**
- Create: `app/Support/AgentIntents.php`
- Modify: `app/Http/Controllers/OnlyFansChatController.php` (`generate`)
- Create: `engine/intent_check.js`
- Test: `tests/Unit/AgentIntentsTest.php`, `tests/Feature/OnlyFansChatIntentTest.php`

**Interfaces:**
- Consumes: `map()['thread']` / `['droppedMass']` (Task 2).
- Produces `final class AgentIntents`:
  - `const SERVER_KEYS = ['repitch', 'reoffer_mppv']`. Slice 2 adds keys here; `ppv` and
    `free_picture` are client flows and are never server keys.
  - `static function directive(string $key, array $thread, array $droppedMass): string`. It
    throws `App\Support\IntentUnavailable` (new, extends `RuntimeException`, carries the user
    message) when the thread lacks what the intent needs.
  - `static function unpaidPpv(array $thread): ?array{price: float, since: int}` (public, so the
    test pins the rule). It finds the newest item with tag `chat_ppv`|`mppv` that is not opened
    and newer than the newest opened such item. `since` = number of items after it (`thread`
    already excludes hidden mass PPVs).
  - `static function compose(string $directive, string $typed): string`: framing per Global Constraints.
- Directive copy (pin exactly; `{price}` formatted like `$21` or `$12.50`, `{n}` an integer,
  `{text}` the mass message text trimmed and cut to 140 chars with `…`):
  - `repitch`: `INTENT BUTTON — Re-pitch: He has not opened the PPV already sent in this chat ({price}, locked, {n} messages ago). Write ONE message that gets him to open THAT PPV. Same price: no discount, no new content, and no price or number in the text. Curiosity and a light nudge, not pressure (CTA 2 / objection doctrine).`
  - `reoffer_mppv`: `INTENT BUTTON — Re-offer MPPV: He never bought the mass message "{text}" ({price}). Write ONE message offering that same content to him personally as his first purchase, framed as just for him, not a mass message. Do not quote a price or any number; the agent attaches the content and sets the price (CTA 1 doctrine).`
  - Unavailable messages: `No unpaid PPV in this chat to re-pitch.` / `No unbought mass PPV in this chat to re-offer.`
- `generate`:
  - validation adds `'intent' => 'nullable|in:repitch,reoffer_mppv'` (built from `SERVER_KEYS`);
  - when `intent` is set and `sender === 'ppv'`, it returns 422 `An intent can't be combined with a PPV caption.`;
  - `IntentUnavailable` → 422 with its message, BEFORE any engine call;
  - otherwise `context = AgentIntents::compose(directive, typed)`;
  - no `intent` → `context` exactly as today.
  - The response gains `intent` (echo of the key or null).
- `engine/intent_check.js` (pattern: `engine/rejection_check.js`) asserts:
  1. a `context` starting `INTENT BUTTON — Re-pitch:` appears inside the strategy prompt's
     `AGENT OVERRIDE — AUTHORITATIVE FOR THIS TURN` block and the generator prompt's
     `AGENT OVERRIDE — AUTHORITATIVE` block;
  2. with a creator-last thread, the follow-up note's override variant (facts only) is used,
     not the full rules;
  3. with `context: ''` the prompts contain no `AGENT OVERRIDE`.

- [ ] **Step 1: Write failing tests:**
  - Unit:
    - `unpaidPpv ignores an opened PPV and anything older than it`;
    - `unpaidPpv counts messages after the PPV`;
    - `an opened mass PPV is never unpaid`;
    - `directive repitch fills price and count`;
    - `directive reoffer_mppv uses the newest dropped mass PPV and cuts long text to 140 chars`;
    - `directive throws IntentUnavailable without the needed message`;
    - `compose appends the agent note only when typed text is non-empty`.
  - Feature (`Http::fake`, read the engine body via `Http::recorded`):
    - `repitch puts the directive then the typed note in context`;
    - `repitch with no unpaid PPV is 422 and the engine is never called`;
    - `intent with sender ppv is 422`;
    - `unknown intent is 422`;
    - `no intent leaves context exactly as typed`.
- [ ] **Step 2:** Run `php artisan test --filter='AgentIntents|OnlyFansChatIntent'` and expect FAIL.
- [ ] **Step 3:** Implement. Then run `node engine/intent_check.js` and expect `✓ intent_check: …`.
- [ ] **Step 4:** Run the full `php artisan test`, `node engine/parity.js`, `node engine/smoke.js` and
  `node legacy/tests/harness.js` (283/0). Expect all PASS.
- [ ] **Step 5: Commit** `feat(intents): Re-pitch / Re-offer MPPV directives via the override channel`.

### Task 4: Client logic — counters, locks, stale-draft rule

**Files:**
- Create: `resources/js/lib/chatCounters.ts`
- Modify: `resources/js/lib/ppvComposer.ts` (`generationStillApplies`)
- Modify: `resources/js/types/crm.ts` (types below)
- Create: `tests/client/intents-check.mjs` (run: `node --experimental-strip-types tests/client/intents-check.mjs`)
- Modify: `tests/client/ppv-composer-check.mjs` (update existing `generationStillApplies` calls)

**Interfaces:**
- Produces (types in `crm.ts`):
  - `type MessageTag = 'chat_ppv' | 'mppv' | 'free_preview'`;
  - `type IntentKey = 'ppv' | 'repitch' | 'reoffer_mppv'`;
  - `interface ChatCounters { total: number; sinceLastPpv: number | null; unpaidPpv: { price: number; since: number; messageId: string | null } | null; returning: boolean; unboughtMass: number }`;
  - `interface IntentLock { enabled: boolean; lit: boolean; reason: string | null }`.
- Produces (`chatCounters.ts`):
  - `effectiveTag(m: OfMessage, tags: Record<string, MessageTag>): MessageTag | null`
  - `isHiddenMass(m: OfMessage, tags): boolean`
  - `chatCounters(messages: OfMessage[], tags, opts: { hasMore: boolean; sessionGapHours: number }): ChatCounters`.
    - `sinceLastPpv` is null when no chat/mass PPV is in view.
    - `unpaidPpv` mirrors `AgentIntents::unpaidPpv`.
    - `returning` per Global Constraints.
    - Input order is whatever the page holds: sort by `time` inside.
  - `intentLock(key: IntentKey, c: ChatCounters): IntentLock`. Reason strings are pinned:
    - `ppv` disabled: `"{total} of {need} messages"`, or `"{since} of 6 since the last PPV"`
      (the first failing rule wins);
    - `repitch`: `"No unpaid PPV"`, or `"{since} of 5 messages since the unpaid PPV"`; enabled → `lit: true`;
    - `reoffer_mppv`: `"No unbought mass PPV"`; enabled → `lit: false`.
- Changes: `generationStillApplies(started, now)`. Both sides gain `intent: IntentKey | null`; a
  change in intent drops the draft.

- [ ] **Step 1: Write failing `intents-check.mjs`** with fixtures built from minimal `OfMessage`
  objects. Assertions:
  - 11 messages, new fan → ppv disabled `"11 of 12 messages"`; returning (old message 2 days
    back) → enabled at 10;
  - `hasMore: true` → total ≥ 100;
  - 5 messages since the last chat PPV → `"5 of 6 since the last PPV"`;
  - an unbought `fromQueue` PPV is hidden: not counted in total, not a PPV, and `unboughtMass === 1`;
  - the same message tagged `chat_ppv` → counted, `unpaidPpv.since` correct, repitch enabled + lit at 5, disabled at 4;
  - an opened PPV newer than an unopened one → `unpaidPpv === null`;
  - an opened mass PPV → PPV for `sinceLastPpv`, never `unpaidPpv`;
  - `free_preview` → never a PPV;
  - pending/failed bubbles not counted; tips counted;
  - `generationStillApplies` false when only the intent changed.
- [ ] **Step 2:** Run it and expect FAIL (module missing).
- [ ] **Step 3:** Implement, and update `generationStillApplies`' only call site in
  `Conversations.vue` to pass `intent: null` on both sides for now (Task 5 wires the real value).
- [ ] **Step 4:** Run `node --experimental-strip-types tests/client/intents-check.mjs`,
  `…/ppv-composer-check.mjs` and `…/scripts-check.mjs`, all PASS. Then run
  `npm run types:check && npm run lint:check`.
- [ ] **Step 5: Commit** `feat(intents): client chat counters + lock rules`.

### Task 5: Intent bar + Re-pitch / Re-offer wiring

**Files:**
- Create: `resources/js/components/crm/conversations/SsIntentBar.vue`
- Modify: `resources/js/components/crm/conversations/SsComposer.vue` (mount the bar above the typing bar; draft-card intent label)
- Modify: `resources/js/pages/Conversations.vue` (`generate(intent?)`, tags load, counters)
- Modify: `resources/js/lib/conversationCache.ts` (`ComposerState.intent`)
- Modify: `resources/js/lib/onlyfans.ts` (`ofApi.tags`, `ofApi.setTag`, `ofApi.clearTag`; `messages.*.id` + `intent` in the generate payload type)

**Interfaces:**
- Consumes: `chatCounters`, `intentLock` (Task 4); the `generate` `intent` param and response key (Task 3); the tag routes (Task 1).
- Produces:
  - `SsIntentBar` props `{ counters: ChatCounters; busy: boolean; mediaLoaded: boolean; activeIntent: IntentKey | null }`, emits `fire: [key: IntentKey]`.
    - It renders chips PPV · Re-pitch · Re-offer MPPV (slice 1 only), each `disabled` per
      `intentLock` or `busy`.
    - Re-pitch and Re-offer are also disabled while `mediaLoaded`, reason `Remove the loaded PPV first`.
    - The reason shows as the chip's `title` and as `aria-describedby` text.
    - The counters line reads `{total} msgs · {sinceLastPpv} since PPV · unpaid {price} · {since} ago`,
      omitting parts that are null.
  - `ComposerState.intent: IntentKey | null`, holding what the pending suggestion was generated for.
    - Cleared by `loadStep`, Dismiss, Accept, and a send that clears the composer.
    - Regenerate and Reject & regenerate re-use it.
  - `generate(intent: IntentKey | null = null)` in `Conversations.vue`:
    - posts `intent` for `repitch` / `reoffer_mppv`;
    - adds `id: mm.id` to each posted message;
    - passes `intent` into both sides of `generationStillApplies`;
    - on success sets `st.intent = intent`.
    - A 422 from an unavailable intent shows its message in `st.error`.
    - `st.context` is NOT cleared.
  - The draft card shows `Intent: Re-pitch` / `Intent: Re-offer MPPV` when `st.intent` is set.
  - Tags: `tagsCache: Map<chatId, Record<string, MessageTag>>`, fetched alongside the thread
    (stale-while-revalidate like `msgCache`), cleared on creator switch / Refresh. The counters are
    `computed(() => chatCounters(messages, tags, {hasMore, sessionGapHours}))`.
- Clicking **PPV** in this task: if a media step is loaded it calls `generate(null)` (the existing
  caption flow). Otherwise it is a no-op placeholder that Task 6 completes.

- [ ] **Step 1:** Add `tests/client/intents-check.mjs` cases for a pure helper
  `intentLabel(key: IntentKey): string` (exported from `chatCounters.ts`): `'repitch' → 'Re-pitch'`,
  `'reoffer_mppv' → 'Re-offer MPPV'`, `'ppv' → 'PPV'`. Run it and expect FAIL.
- [ ] **Step 2:** Implement `intentLabel`, the bar, the state, the wiring and the API client. Run the check and expect PASS.
- [ ] **Step 3: Browser check** with the isolated harness from memory `local-browser-check-recipe.md`
  (throwaway SQLite, fake OF on 8790, `php -S` from `public/`, restore `public/hot`). Seed chat 101
  with a priced unopened chat PPV followed by 5 messages. Then verify:
  - Re-pitch is lit;
  - clicking it posts `intent: 'repitch'` with typed context kept (inspect the request);
  - the card label shows;
  - with 4 messages after the PPV it is disabled with the pinned reason.

  Screenshot at 1440 and at 390 wide.
- [ ] **Step 4:** Run `npm run types:check && npm run lint:check && npm run format:check` and `php artisan test`, all PASS.
- [ ] **Step 5: Commit** `feat(intents): intent bar with Re-pitch and Re-offer MPPV`.

### Task 6: PPV button → Scripts panel → auto caption

**Files:**
- Modify: `resources/js/components/crm/conversations/SsScriptsPanel.vue` (prop `focusPpv`)
- Modify: `resources/js/components/crm/conversations/SsComposer.vue` (open the panel in PPV-focus mode)
- Modify: `resources/js/pages/Conversations.vue` (generate after the load)
- Create helper in: `resources/js/lib/scriptProgress.ts`

**Interfaces:**
- Produces `nextPpvTarget(scripts: Script[], status: ScriptStatus, rememberedId: number | null): { scriptId: number; stepIndex: number } | null`. Rule:
  1. the remembered folder, if it has an unsent step with `kind === 'ppv' && !needsMedia`;
  2. else the first folder in array order with one;
  3. else null.

  `stepIndex` is the first such unsent step.
- `SsScriptsPanel` gains prop `focusPpv?: boolean`. When true on open:
  - it opens `nextPpvTarget`'s folder with that step in preview;
  - when the target is null it shows the folder list, with a one-line note `No unsent PPV step — pick any step.`
- `SsComposer`: the intent bar's `fire('ppv')` with no media loaded opens the scripts slot with `focusPpv` true.
- `Conversations.vue`: a `ppvPending` flag per composer is set by that open. When `loadStep`
  returns true and the loaded step has media, it calls `generate(null)` once and clears the flag.
  Closing the panel without loading also clears the flag.
- PPV's lock (`intentLock('ppv')`) disables the chip only. The Scripts button is unchanged.

- [ ] **Step 1:** Add `scripts-check.mjs` cases for `nextPpvTarget`:
  - remembered folder wins;
  - fallback to the first folder with an unsent PPV;
  - needs-media and sent steps are skipped;
  - none → null.

  Run and expect FAIL.
- [ ] **Step 2:** Implement the helper, then the prop, open mode and auto-generate. Run the checks and expect PASS.
- [ ] **Step 3: Browser check** with the same harness:
  - with ≥ 12 messages, PPV opens the panel on the Next PPV step;
  - **Use** loads it and a caption Generate fires on its own (one request with `sender: 'ppv'`);
  - with 8 messages the chip is disabled with `8 of 12 messages`;
  - Esc closes the panel and the next manual step load does not auto-generate.
- [ ] **Step 4:** Run the full client checks, `types:check`, `lint:check`, `format:check` and `php artisan test`.
- [ ] **Step 5: Commit** `feat(intents): PPV button opens the next PPV step and captions it`.

### Task 7: MPPV tag chip on thread bubbles

**Files:**
- Modify: `resources/js/components/crm/conversations/SsChatThread.vue` (chip on taggable bubbles)
- Modify: `resources/js/pages/Conversations.vue` (pass tags; handle set/clear; patch `tagsCache`)

**Interfaces:**
- Consumes: `effectiveTag` (Task 4), `ofApi.setTag` / `clearTag` (Task 5).
- `SsChatThread` gains prop `tags: Record<string, MessageTag>` and emits `tag: [messageId: string, tag: MessageTag | null]`.
- Every taggable bubble (`effectiveTag !== null`, `id` non-null, not pending) shows a small chip:
  - the label is `Chat PPV` / `Mass` / `Free preview`;
  - an `· auto` suffix appears when no override is stored;
  - clicking opens a menu with the three tags plus `Auto` (clear).

  This replaces the existing `· Mass` label so there is one indicator, not two.
- Set or clear updates `tagsCache` optimistically and rolls back with `st.error`-style feedback on failure.
- The counters recompute (computed), and the next generate carries the new tag server-side.

- [ ] **Step 1:** Add an `intents-check.mjs` case for a pure `tagChipLabel(tag: MessageTag, auto: boolean): string`
  (`'mppv', true → 'Mass · auto'`). Run and expect FAIL.
- [ ] **Step 2:** Implement the helper and the chip/menu. Run the check and expect PASS.
- [ ] **Step 3: Browser check:**
  - a `fromQueue` unopened PPV shows `Mass · auto`;
  - re-tag it as `Chat PPV` → the PUT is sent, the counters line changes, and Re-pitch's
    reason/state updates;
  - `Auto` → DELETE, and it reverts.
- [ ] **Step 4:** Run the full checks + `php artisan test`.
- [ ] **Step 5: Commit** `feat(intents): per-message MPPV tag chip`.

### Task 8: Docs + real-AI spot check

**Files:**
- Modify: `CLAUDE.md` (an "Agent intents" paragraph under Conversations: catalogue, override
  channel, tags table + mapper rule, counters mirror, guard list incl. `engine/intent_check.js`)
- Modify: `docs/chatter-guide.md` (a new section: the intent bar, locks, Re-pitch / Re-offer / PPV, the tag chip)
- Create: `engine/intent_spot.js` (manual, NOT in CI; needs `ANTHROPIC_API_KEY`)

**Interfaces:**
- `intent_spot.js`:
  - runs `generateDraft` with the real transport on two fixture threads (in-file, invented text,
    no real fan or script content);
  - thread A has an unpaid $21 chat PPV 5 messages ago; thread B has an unbought mass PPV;
  - 3 runs each, with the directive from a JSON copy of the Task 3 strings;
  - it prints each draft.

- [ ] **Step 1:** Write the docs paragraphs.
- [ ] **Step 2:** If `ANTHROPIC_API_KEY` is set in `.env`, run `node engine/intent_spot.js` and
  record in the ledger every draft and whether it reads as its intent: re-pitch nudges toward the
  existing PPV with no number; re-offer is personal with no number. If a draft fails, reword that
  directive in `AgentIntents` + the JSON copy, rerun, and update the Task 3 test strings. If no
  key is available, note "spot check not run — no key" in the ledger and in the final report.
- [ ] **Step 3:** Run the full verification: `php artisan test`, all `tests/client/*.mjs`, the engine
  checks (`parity`, `smoke`, `intent_check`, `rejection_check`, `followup_check`), the legacy harness,
  `npm run types:check`, `lint:check` and `format:check`.
- [ ] **Step 4: Commit** `docs(intents): CLAUDE.md, chatter guide, spot-check script`.
