# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

This is a browser app — no build step, no package manager, no test framework, no CI. To run: open `SSAI.html` in Chrome, or serve via `python3 -m http.server 8000` and visit `http://localhost:8000/SSAI.html` (needed for Claude in Chrome / extension access since Chrome blocks `file://` for extensions).

**File layout** (NOT single-file — was refactored to multi-file at some point post-v0.4.1.5; older CLAUDE.md versions describe the obsolete single-file layout):

```
SSAI-v0.4.5.1/
├── SSAI.html              ← shell only: topbar, sidebar, dashboard, modals
├── CLAUDE.md              ← this file
├── README.md              ← brief README
├── DEV_SPEC.md   ← canonical handoff doc for the dev (read this first)
├── css/
│   ├── base.css
│   ├── layout.css
│   └── modals.css
├── js/
│   ├── api.js             ← callApi (Claude) + callMistral
│   ├── app.js             ← main logic (~8500 lines): generate(), posture, UI rendering, etc.
│   ├── auth.js            ← Supabase auth + role gating
│   ├── config.js          ← SSAI_VERSION + SB_URL/SB_KEY + PROXY_URL constants
│   ├── doctrine.js        ← DEFAULT_TRAINING template literal (~1700 lines) + SHA256 + verifier
│   ├── supabase-client.js ← Supabase client init
│   ├── team.js            ← manager/chatter team management
│   └── ui.js              ← bubble formatting (fmtMsgForAI), gap detection, global error handler
├── tests/                 ← harness.js (regression suite) + ab_*/batch_driver/slop_scan helpers
├── sql/                   ← doctrine_v*_push.sql (Supabase brain-row pushes — rollback refs) + gen_push_sql.js
└── docs/                  ← working/reference docs (audits, live results, test matrices, persona drafts)
```

**Current versions:**
- App: `0.4.4.7` (in `js/config.js` as `SSAI_VERSION`)
- Doctrine: `v0.4.5.1` (in `js/doctrine.js` header line + footer). v0.4.5.0 (2026-06-12) rewrote PART 11 objection registers to beat-format + bilingual for OBJ 1/2/3/4/6/9/10, added NEW OBJECTION 11 (recovery-to-resale), PART 9 whale-$37 cross-ref, PART 23 sexting multiplier 1.4×→1.25×. v0.4.5.1 (2026-06-14) fixed a stale PART 4 multiplier ref (1.4×→1.25×, the v0.4.5.0 change had missed it) + cut PART 1 paragraph/bullet redundancy. **Supabase `__global_training__` push DONE + VERIFIED 2026-06-14** — manager ran `sql/doctrine_v0.4.5.1_push.sql` in the SQL Editor (supabase.com is hard-blocked for browser automation — nav + js exec both permission-denied — so this is always manager-run); live hash check from localhost = MATCHES, len 132232, tier system. All three integrity layers agree, no drift warning.
- Doctrine SHA256: `a1bcbcef27519268fd005622a9e124965a4b8e7732c24cc5303ccda0760ade0e` (was `62ffaa6e…`, `ca53389d…`; in `js/doctrine.js` as `DEFAULT_TRAINING_SHA256` — grep `DEFAULT_TRAINING_SHA256=`, don't trust a line number; len 132232)

The `<title>` in `SSAI.html` is set on load from `SSAI_VERSION` — don't hand-edit, just bump the constant. The brand label in the topbar reads from the same constant.

## Backend boundary

Backend is Supabase (Postgres + auth + Edge Functions). The app only talks to:
- `SB_URL` / `SB_KEY` — Supabase project (anon key is committed in `js/config.js`; RLS does the actual access control).
- `PROXY_URL` (`/functions/v1/anthropic-proxy`) — Edge Function that holds the real Anthropic key and forwards browser calls.
- `MISTRAL_PROXY_URL` (`/functions/v1/mistral-proxy`) — same pattern for Mistral via OpenRouter.

Proxy mode is default ON. The browser only carries a low-value proxy token (`ssai_*`). To bypass for local debugging: `localStorage.ss_use_proxy='false'` + put a real key in `localStorage.ss_claude` / `ss_openrouter`. See `useProxy()` / `callApi()` / `callMistral()`.

The Anthropic model is hardcoded to `claude-sonnet-4-6` in `js/api.js`. Mistral is `mistralai/mistral-nemo` via OpenRouter.

## Supabase tables in use

- `chatters`, `model_assignments` — auth/RBAC. Roles: `manager` | `chatter`. Manager sees everything; chatter sees only own sessions and assigned creator models.
- `aich_sessions`, `aich_messages`, `aich_events`, `aich_vn_used` — per-conversation state and analytics events. All four have `chatter_id` auto-injected on insert via `installChatterIdAutoInject()` — do not bypass `sb.from(...)` and write through a different client.
- `aich_models` — creator personas + content libraries; also stores `__global_training__` row (the live brain copy, RLS-locked for writes — see "Doctrine integrity" below).
- `aich_models_backups` — append-only audit log of every UPDATE/DELETE on `aich_models`, fired by the `snapshot_aich_models()` BEFORE trigger. (Trigger had a `RETURN OLD` bug on UPDATE that silently no-op'd all aich_models writes — fixed via SQL editor on 2026-05-12, see DEV_SPEC.md for the corrected function body.)
- `customer_profiles` — long-term per-customer memory (trust level, archetype, total_spend, key_details).
- `creator_status` — real-life status entries fetched per-generation by `fetchActiveCreatorStatus()`.
- `aich_feedback_queue` — manager-reviewed corrections. As of v0.4.1.4, approval APPENDS to existing `feedback_rules` (not replaces); manager can edit the combined list in Models tab to resolve contradictions.

### Event types (introduced v0.4.1.4 → v0.4.4.0)

- `agent_override` — fired when context box is non-empty at generate time. Payload includes the directive, posture state, TW state, miss-locked state, and session_ppv_count. Lets manager audit when chatters override the brain.
- `tip_recorded` — fired when an incoming customer message has the "Came with tip" toggle on. Payload: amount, new_total_tips.
- `sexting_mode_toggled` — fired when the agent cycles the sexting AUTO / FORCE_ON / FORCE_OFF chip. Payload: prior state, new state, sexting_active flag.
- `tip_mode_toggled` (v0.4.4.0) — fired when the agent cycles the TIP-LED AUTO / FORCE_ON / FORCE_OFF chip. Payload: prior state, new state, tip_primary flag. Mirrors `sexting_mode_toggled`.
- `spend_override` — fired when a manager edits session or lifetime spend via the spend-edit modal. Payload: scope (`session`|`lifetime`), from, to.

## Two-call generation pipeline

`generate()` in `js/app.js` is the central function (~1200 lines). Read it before touching any prompt-construction or routing code. The flow is:

1. **Pre-compute session telemetry** — posture (`recomputePosture` → `computePosture`), customer tier, wall state (`computeWallState`), forcing move, fork detection (`detectFork`), investment signals (`detectInvestmentSignals`), trust capping by **effective** spend (`capTrustBySpend` over `effectiveSessionSpend`/`effectiveLifetimeSpend` = PPV + tips), **sexting state (`detectSextingActive`)**, **tip-primary state (`detectTipPrimary` → `_tipPrimary`)**, **time context block**, **agent override block (from context box)**.
2. **Strategy call (Claude)** — produces a JSON strategy object with phase, ritual_step, tone, price_rule, caption_required, etc. Validated and clamped by `validateStrategy`, `clampStrategyByPosture`, `clampStrategyByDepthGate`, `clampStrategyByRegisterMatch`. Strategy can now set `agent_override_active: true` to defer wall enforcement for one turn.
3. **Generator call** — depending on `api` mode (`auto` | `claude` | `mistral`):
   - `claude`: Claude writes the message directly using the strategy.
   - `mistral`: Claude returns the strategy JSON, then `callMistral()` executes it. Used for explicit content (Anthropic refuses; Mistral doesn't).
   - `auto`: Claude decides per-message whether to route to Mistral.
4. **Post-processing** — `scanForBanned`, `registerFilterCheck`, `stripReasoningLeaks`.
5. **Analysis call** — `runAnalysis()` updates the customer profile (trust, archetype, key_details).

**Prompt-cache discipline**: the strategy and generator calls deliberately share byte-identical system blocks (notably `contentLibraryBlock`) so they hit one cache entry instead of two. **Never reorder, rewrap, or paraphrase shared system blocks** — even whitespace differences cost a cache write (~$3.75/M write vs $0.30/M read). Inspect cache behavior live via the `$/msg · Cache` card or read `window._ssaiCostLog`, `window._ssaiCostTotal`, `window._ssaiCacheHitRate` in DevTools.

## Posture system

Sessions carry a posture: `WARM_BUILD` | `PROBE` | `PRESSURE` | `TIMEWASTER`. Recomputed on every generate from **effective spend (PPV + tips)**, free-message count, unpaid CTAs, and investment signals.

**As of v0.4.4.0, all spend-driven gates read EFFECTIVE spend, not PPV alone.** Helpers `parseMoney` / `effectiveSessionSpend` / `effectiveLifetimeSpend` (near `capTrustBySpend`) sum PPV `total_spend` + `tips_spend`. A tipper scales trust ceiling, pricing, tier, and TW-immunity exactly like a PPV buyer — tips are no longer a separate bucket the scaling engine ignores.

**TIMEWASTER GUARDS** (in `computePosture`, see also PART 6 doctrine):
- GUARD 1 — Pre-CTA protection: TW cannot fire before at least one CTA attempt.
- GUARD 2 — Active-session spend immunity: any customer with effective session spend > 0 (any paid PPV **or tip** this session) is TW-immune for the rest of the session. (v0.4.4.0 widened this from `session_ppv_count >= 1` to include tips.)
- GUARD 3 — Post-payment grace window: 6-message grace after any payment (PPV or tip) before TW can fire.

**SESSION-SPENDER ANTI-EXIT GUARD (v0.4.4.0, CRITICAL — separate from posture).** Posture is not the only system that can end a session; the strategy's `next_move` can route to `goodbye_script` / ladder-stop. A proven session-spender must never be exited on a reply-gap misread. At the wall-enforcement site, `sessionSpenderKeepClimbing` reroutes any exit move → `continue_climb` when the session has spend (PPV opened **or** tip) AND the ladder has not *legitimately* closed (no miss-lockout, no persuasion-cap exhaustion). Carve-out: `warmCloseForSpender` still allows a warm close when the *customer himself* winds down (`windDownPat`). This fixed the "paid $20, replied 10 min later, got a cold goodbye" bug — root cause was the old `lastMessageWasPurchase` trigger being too narrow (only fired when the purchase was the literal last message) plus no code guard on the `goodbye_script` branch. A reply gap (10 min, an hour) is an active buyer who stepped away, not disengagement.

**v0.4.1.4 SEXTING POSTURE FREEZE** (PART 23): when `s._sextingActive === true`, posture cannot decay to TIMEWASTER. The free-chat beat counter (`_freeMsgCount`) FREEZES during sexting; a separate counter (`_sextingBeatsSinceLastPpv`) accumulates instead. Sexting beat counter resets on PPV PAID (not on send — fix for the Josh delayed-payment case).

## Sexting mode (PART 23, v0.4.1.4)

Three-state UI toggle in profile bar chip: `SEXTING · AUTO` (default) | `FORCE ON` (red) | `FORCE OFF` (gray). Cycled via `toggleSextingMode()`.

In AUTO mode, `detectSextingActive()` runs a two-gate check on every `recomputePosture` call:
- **Gate 1**: customer has paid ≥1 PPV in session OR `lifetime_spend > 0`
- **Gate 2**: last 3 customer messages contain fantasy-building patterns (English + Spanish patterns, see `detectSextingActive` source). Dick-pic / nude-image-sent flag (`[image sent]` in customer text) also satisfies gate 2.

When `sexting_active === true`:
- Posture freezes (no TW)
- `_freeMsgCount` increment is gated off; `_sextingBeatsSinceLastPpv` accumulates instead
- PPV price suggestion auto-multiplies by 1.4× (`SEXTING_MULTIPLIER` in `fetchPpvSuggestion`)
- Strategy + generator prompts both get a SEXTING STATE block with full rule recap

The sexting chip surgically refreshes via `updatePostureChip()` (which also handles the posture chip).

**Engineering follow-up still needed** (per DEV_SPEC.md): some fields are referenced in doctrine but not fully wired (e.g. `sexting_mode_toggle` persistence in `aich_sessions` column — currently in-memory only).

## Tip-led mode (PART 9, v0.4.4.0)

Mirrors the sexting-mode architecture. Some customers yield more through tips than PPVs (provider/spoiler psychology); tip-asking should LEAD, not be a soft-no fallback.

Three-state UI chip: `TIP-LED · AUTO` (default) | `FORCE ON` | `FORCE OFF`. Cycled via `toggleTipMode()`, logs `tip_mode_toggled`.

In AUTO mode, `detectTipPrimary(s)` fires on any of: customer tipped (session or lifetime — the clearest signal), provider/spoiler language, `tips_spend >= ppv_spend`, or Relationship archetype. Result lands in `s._tipPrimary` during `recomputePosture`.

When `tip_primary === true`:
- Strategy + generator prompts both get `tipPrimaryStateBlock`; strategy schema carries a `tip_affinity` field
- Tip-asking becomes the PRIMARY monetization move (led from connection), PPVs secondary — does NOT wait for a PPV soft-no
- **Never a quoted number.** Open-ended, relationship-register asks only ("tip your girl to see how naughty she gets", "send me an even nicer one", "spoil me"). No suggested tip amount is ever surfaced. Tippers are the highest-value customers *as long as it never feels transactional* — doctrine PART 9 is explicit on this.

`_tipPrimary` / `_tipModeToggle` are in-memory only (no `aich_sessions` column yet — same limitation as `sexting_mode_toggle`; survives recomputes within a session, resets on page reload).

## Agent override system (Cluster B, v0.4.1.4)

When the agent types into the Context box at generate time:
- Generator user prompt wraps it as `=== AGENT OVERRIDE — AUTHORITATIVE ===` with explicit precedence rules (wins over TW lockout, miss-lockout, persuasion cap, aftercare auto-triggers; does NOT win over HARD RULES, TOS, CRM Hard NOs).
- Strategy prompt gets matching block + instruction to set `agent_override_active: true` in the strategy JSON.
- Wall enforcement code (PASS B) reads `strategyJson.agent_override_active` and defers the aftercare + miss-lockout hard blocks for one turn when true.
- An `agent_override` event is logged to `aich_events` with the directive text + session state — gives manager audit trail.

## Doctrine integrity

`DEFAULT_TRAINING` in `js/doctrine.js` is the brain prompt. Three independent integrity checks run on load:

1. `checkDoctrineIntegrity()` — structural (presence of expected section headers).
2. `verifyBrainTamper()` — SHA256 of the in-code `DEFAULT_TRAINING` matches the declared `DEFAULT_TRAINING_SHA256` constant in `js/doctrine.js` (grep `DEFAULT_TRAINING_SHA256=`; the line number moves as doctrine grows).
3. Same SHA256 compared against the Supabase `__global_training__` row's `prompt` column.

If code-hash fails, app refuses to generate (`window.__brainCorrupted=true`). If Supabase-hash fails but code passes, app uses code-canonical (yellow warning shown).

### Procedure for editing the doctrine

1. Edit `js/doctrine.js` (typically the `DEFAULT_TRAINING` template literal body — backticks inside the template need to be escaped as `\``).
2. Bump doctrine version in header line `SMARTSTARSAI — GLOBAL AGENCY TRAINING (v0.x.y.z)` and matching footer line `END OF GLOBAL TRAINING — v0.x.y.z`.
3. Recompute the hash. Either: (a) in-app via Settings → Models → "Show current brain SHA256" (`showBrainHash()`), OR (b) in Node — `node -e "const fs=require('fs'),c=require('crypto');const {DEFAULT_TRAINING}=new Function(fs.readFileSync('js/doctrine.js','utf8')+'\\nreturn {DEFAULT_TRAINING};')();console.log(c.createHash('sha256').update(DEFAULT_TRAINING,'utf8').digest('hex'))"`. Both are authoritative — they hash the *runtime* template-literal value. (A raw `sha256sum` of the file does NOT match, because the file bytes still contain the JS escape characters; evaluating the template literal first is the trick.)
4. Update `DEFAULT_TRAINING_SHA256` with that hash value.
5. Push to Supabase: the `__global_training__` row is RLS-write-locked, so this MUST go through the Supabase Dashboard SQL Editor (which runs as `postgres` and bypasses RLS). Use base64 encoding to avoid UTF-8 mojibake in the clipboard/paste chain:

```sql
UPDATE aich_models
SET prompt = convert_from(decode('<base64-encoded-doctrine>', 'base64'), 'UTF8'),
    tier = 'system'
WHERE name = '__global_training__';
```

A helper Node script for generating the base64 payload + SHA256 verification lives in commit history if needed (was deleted as a one-shot artifact).

**Supabase has a `snapshot_aich_models` trigger** that audits every UPDATE/DELETE on aich_models into the `aich_models_backups` table. The trigger had a `RETURN OLD` bug pre-v0.4.1.4 that silently no-op'd all UPDATEs — it's been patched to be `TG_OP`-aware (RETURN NEW on UPDATE, RETURN OLD on DELETE). See DEV_SPEC.md "Out-of-band database changes" section for the corrected function body.

## Role gating

Manager-vs-chatter UI gating runs through `applyRoleGating()` in `js/app.js` at startup and after auth. Many features (API mode switcher, Settings tab, CSV exports, full leaderboard, cost cards, dashboard chatter filter) are manager-only. When adding a new manager-only widget, gate it inside `applyRoleGating` rather than per-call-site.

## Workflow

- **Run the app**: open `SSAI.html` in Chrome (`file://` works for direct testing). For Claude in Chrome or any extension that can't access `file://`, serve via `python3 -m http.server 8000` from the project root.
- **Edit the app**: edit the file in place. The `<title>` and brand version label are auto-rewritten from `SSAI_VERSION` on load — bump that constant in `js/config.js` rather than hand-editing.
- **Bump version on release**: update `SSAI_VERSION` in `js/config.js`. The folder doesn't carry the version in its name anymore (the legacy `SSAI_0_4_3_1.html` filename convention is gone).
- **Inspect runtime cost**: click the `$/msg · Cache` dashboard card, or read `window._ssaiCostLog`, `window._ssaiCostTotal`, `window._ssaiCacheHitRate` in DevTools.
- **Tests**: `node tests/harness.js` — deterministic regression suite (79 assertions). Loads the real `js/*.js` into a Node VM sandbox (no browser, no API calls, no DB writes) and stress-tests the guard/detector/validator layer with synthetic customers: posture ladder + all TW guards, continued-interest gate, miss-lock 3-persuasion window, drift signals, effective spend (PPV+tips), sexting/tip-led/fork/investment detectors, ToS filter, promise-commitment detector, strategy validators (incl. buildup-only skip), audit warns. Run it after ANY change to the systems above. The probabilistic layer (register/voice quality, live generations) is NOT covered — that's manual via the running UI. The v0.4.3.2 release was additionally validated by a 27-test regression suite executed via Claude in Chrome (report in DEV_SPEC.md).

## Doctrine vs. code

Prompts, training documents, beat structure, fork detection logic, and behavioral playbook are authored work maintained outside this repo. This repo is the technical wrapper. Refactors of code are welcome; **changes to `DEFAULT_TRAINING` text, posture rules, or behavioral validators are doctrine changes and require coordination** — don't reword or "improve" the in-code prompt strings without explicit authorization.

The manager (brain author) maintains doctrine via separate Claude project sessions with full framework context. The dev maintains the technical wrapper. Doctrine changes flow: manager edits → SHA256 regen → Supabase push → dev reviews on the branch.

## Recent release: v0.4.4.7 (2026-06-14) — per-message cost cut to ~4.69¢ (code-only)

Cost-reduction work. App `0.4.4.6`→`0.4.4.7`, doctrine untouched, harness `253`. Driven by a 30-agent adversarial workflow (`path-to-3cents`) that decomposed the per-message cost and refuted every over-projected lever. **Headline finding: 3¢ is NOT reachable** without putting the customer-facing voice on Haiku (~3.96¢ floor, voice bet) — the strategy JSON output (~1.8¢) is the biggest line and is mostly irreducible (most `*_reason` fields are consumed by the generator/validators/Mistral route). The verified-safe levers (shipped) total ~0.41¢:

1. **Generator block-3 cache split** (~0.24¢) — the ~882-tok static TOS/length/emoji/anti-slop text was billed fresh at $3/M every turn (block had no `cache_control` and got per-turn text appended). Split into its own `cache_control` block (`systemBlocks[2]`, app.js ~5940) — it now caches as part of the ~9.3k generator prefix at $0.30/M; the genuinely per-turn posture/depth/feedback/ppv/strategyEnforcement text is `systemBlocks[3]` (uncached, as before). The 1024-token cache minimum applies to the **cumulative prefix**, not the individual block, so a small static block riding on the big persona prefix does cache.
2. **Deleted 6 strategy schema fields** (~0.17¢ output) from STRATEGY_STATIC_RULES (app.js line 5687 — the giant single-line const): 4 truly-dead (`investment_quality`, `investment_quality_reason`, `frame_hold_reason`, `tip_affinity_reason` — zero consumers anywhere incl. the Mistral route) + 2 debug-only (`next_planned_move_reason`, `temperature_reason`). KEPT every load-bearing sibling (`frame_hold_active`, `tip_affinity`, `next_planned_move`, `temperature`, `message_purpose`). Only **deleting** the field definition cuts output tokens — prompt "omit" instructions do nothing (the model emits whatever the schema defines). NOT a doctrine edit (STRATEGY_STATIC_RULES is an app.js const, no SHA/Supabase ritual; one-time cache rewrite absorbed by the next first-msg-per-hour write).
3. **Fixed the `$/msg` card ⚠ heuristic** (api.js ~216) to be cumulative-prefix aware — it was flagging any <1024-tok block as "won't cache," which would have shown a false ⚠ on the new static block and made step 1 look broken.

**LIVE-VERIFIED 2026-06-14** (Camila, localhost, 2 real generations, mock data cleaned): warm msg-2 measured **4.33¢** (strategy 3.38¢ + generator 0.95¢) on a short session. Step 1 confirmed — generator block #2 (882 static tok) reads from cache on the warm call (`cacheRead` includes the static prefix, `cacheCreate 0`); steps 2-3 confirmed — strategy output dropped to 872 tok. Longer sessions cost slightly more (growing uncached conversation) → general steady-state ~4.5–4.7¢ (from ~5.1¢, and 6.4¢ at the session's start). NOT done: generator→Haiku (step 4, ~3.96¢) — needs a 6-persona voice A/B + a cost-log Haiku-rate fix (the log only branches on `/opus/i`, so it would mis-bill Haiku at Sonnet rates) before it can be trusted. Side-finding for a future doc pass: the "session-boundary cut" claim in the Context-window section below is **wrong** — the full `s.messages` is sent uncached on both calls (only `computeWallState` + the reentry summary slice), so long/returning sessions cost more than that section implies.

## Recent release: v0.4.4.5 (2026-06-12) — Whale Builder + anti-slop + exhaustive verification (code-only)

Big work session. App `0.4.4.4`→`0.4.4.5`, doctrine untouched (`ca53389d…`), harness `90`→`240` assertions.

**Whale Builder (Cielo new-USA-sub qualification arc)** — `detectWhaleBuilder`/`detectEnglishPick` in `js/app.js`, persona-marker-gated (`WHALE BUILDER: ON`, like `PROMISE MODE: BUILDUP_ONLY`). USA detection is **conversational, not a field**: Cielo's welcome asks "spanish or english"; English pick = new American. Arc: English-practice opener → RLS rapport thru age-reveal → Matias pivot → single-mom reveal → **scripted $37 tip test** (the ONE sanctioned quoted-number ask — PART 9 never-quote rule is absolute everywhere else) → branch read. Outcome session-sticky (tip→`qualified_whale`; 6 replies no-tip→`not_whale`); qualify auto-flips `detectTipPrimary`. WHALE chip (marker-creators only), `whale_builder` events, posture-freeze during arc. Persona section in `docs/Cielo_whale_builder_persona_section.md` (LIVE in Supabase — saved 2026-06-12, len 38,094). Harness section O+. Full arc live-verified (qualify + not-whale branches). See [[whale-builder-cielo]] memory.

**AI-slop layer (Hans: "generator must talk without AI slops")** — 3 layers: (1) generator-prompt ANTI-SLOP RULES block (em-dash/semicolon ban, no repeated framing/openers, contraction consistency, no balanced not-X-but-Y, no therapy register) — in the UNCACHED per-turn block, zero cache cost; (2) `sanitizeSlop(text)` DETERMINISTIC backstop (em/en-dash→"...", semicolon→comma) on EVERY finalized draft incl. PPV captions — the prompt ban alone did NOT catch 100% (Sonnet shipped "i'm jammy — what..."); (3) `tests/slop_scan.js` scanner. Pre-fix baseline 7 em-dashes/9 msgs; post-fix **0 across all 12+ live drafts, all 6 creators**. Harness section U (9 assertions).

**Side-quest hooks (inert unless set, dev tools)** — `localStorage.ss_model_override` (per-callType model A/B: Opus generator-only ≈$0.079/msg est, under ceiling — manager chose to stay Sonnet) and `ss_effort` (per-callType effort A/B). Plus per-call `durationMs`/`tokPerSec` in `_ssaiCostLog`. **Latency diagnosis**: strategy JSON call = 92% of latency (31.6s of 34.5s, output-bound 1286 tok); manager elected no change. See [[v0444-cost-restructure]] memory.

**Bugs found+fixed live this session (4):** (1) English-pick misread "english please, my spanish is terrible" as Spanish (negation-aware fix); (2) ToS auto-retry referenced out-of-scope `useMistral` → ReferenceError on its FIRST-ever live firing → banned draft kept (session-stashed route fix — the retry path had never run before); (3) em-dash slop (sanitizeSlop); (4) sexting gate-2 missed "id love to taste you" (apostrophe-less + interposed "to" — `i('?d| would) … (to )?`). All have regression assertions.

**Open findings for manager ruling (not fixed):** Sandra's persona is a **502-char stub** (vs ~30KB others) → generic voice, needs authoring; sexting gate-2 still misses dominance-fantasy + descriptive-participle scene language (widening risks false positives, FORCE_ON is the fallback); miss-lock live brain-routing drifted to small-talk on one ambiguous synthetic seed (needs multi-sample retest). Full report in `docs/LIVE_RESULTS.md`. Verification matrix in `docs/TEST_MATRIX.md`.

**Still pending (needs manager):** the single batched doctrine push (PART 11 objection upgrades for OBJ 1/2/3/4/6/9/10 + NEW OBJ 11 recovery-to-resale + PART 9 whale $37 cross-ref) — all drafted in `docs/objection_scripts_PART11_draft.md`, two boundary rulings needed (OBJ Price 1.2(B) managed-discount-choice; OBJ Menu 1.1(A) missing beat). Plus the merged Cielo persona paste is already applied live but the standalone authored section is in the repo for review.

## Recent release: v0.4.4.4 (2026-06-11) — cost restructure: <$0.10/msg (code-only)

**Hans directive: every message after the cache-creating first one must cost under 10 cents.** Was ~$0.10–0.13+. Root cause: the strategy user prompt was a ~67KB template whose static majority (~42KB: prime directive, drift/ppv-pending rules, phase gates, wall handling, deflection, power calibration, the full JSON schema) was re-sent UNCACHED at $3/M on every generate (~$0.04/msg), plus `extractCustomerIntel` fired on every generate including regenerations.

Changes (all in `js/app.js`, doctrine untouched):
1. **`STRATEGY_STATIC_RULES`** — new module-level const (~42.4KB ≈ 10.6k tokens) holding the relocated static text VERBATIM, shipped as a **third cached system block** (1h TTL) on the strategy call. Per-message cost for that text drops $3/M → $0.30/M. **EDITING RULE: this string must stay byte-stable and contain ZERO per-turn interpolation** — any change invalidates the cache (~$0.08 rewrite per creator). Per-turn data belongs in `strategyPrompt`.
2. **Slim `strategyPrompt`** — now only: per-turn state lines (customer/CRM/PPV stats/posture/walls/ladder/investment IIFEs), conditional state blocks (override/sexting/tip/PPV-mode), and the conversation (kept LAST). Static source shrank 66,930 → 15,698 chars.
3. **Prefix-share fixed** — the old uncached "Return only valid JSON…" block #0 sat BEFORE Layer 1 on the strategy call, breaking prefix-sharing with the generator (the "one cache entry" claim in the old comment was false). It's folded into LAYER 3; strategy and generator now genuinely share the L1/L2 entries.
4. **Relocation fixups** (only deviations from verbatim): positional "above" refs → "in the per-turn state"; forcing-move 9 now carries BOTH promise-mode variants (9a ritual / 9b buildup_only) since the block is static — the per-turn state declares the mode; reinforcement→assumed text aligned to the v0.4.4.1 two-PPV flip; `*_reason` fields capped to ~12 words (output is $15/M).
5. **Intel on Accept** — `extractCustomerIntel` moved from generate() (every generation, incl. regens re-paying for identical history) to `acceptDraft()` (once per shipped message).

Expected per-message (msgs 2+, warm cache): strategy ≈ $0.016 cache-reads + ~$0.006–0.012 dynamic input + ~$0.009 output; generator ≈ $0.012 reads + ~$0.008 uncached + $0.003 output → **≈ $0.055–0.07/msg**. First message per creator per hour writes ~50k tokens of cache (~$0.30) — the accepted cache-creation cost. Verify live via the `$/msg · Cache` card: msgs 2+ should show `strategy_sonnet` with large `cR`, near-zero `cW`, and per-msg ≤ $0.10. `analysis_legacy`/`runAnalysis` confirmed dead code (never called).

### Live stress-test addendum (2026-06-12) — 3 more fixes, cost CONFIRMED

A full live mock-customer matrix (9 scenarios, ~40 real generations via localhost + browser automation; all `mock_%`/`mk_%` test data wiped from Supabase afterward) validated the release and caught three more bugs, all fixed same-session:

1. **Validator false-positive retry-loop (cost killer).** `validateStrategy`'s `isPitching` predicate sniffed free-text fields for the substring "pitch" — matching NEGATIONS ("hold frame, do NOT pitch"), so every frame-hold strategy was rejected and re-ran the full call (+$0.04, +30s, 100% repro on vending-machine customers). Now structured-fields-only (`skeleton_step`/`phase`).
2. **Calibration vs frame-hold.** The sexual-floor ("never >2 below his heat") and emotional rules (`te>ce`, `ce===0&&te>0`) rejected every correct frame-hold strategy. `frameHoldActive` (strategy.frame_hold_active) now exempts the floor and grants emotional latitude ≤2.
3. **PPV send crashed (CRITICAL).** v0.4.4.2 scoped `let newPromiseStatus` inside the buildup-only guard in `confirmPpvSend`, but the Supabase persist + `ppv_pitched` event below read it → "newPromiseStatus is not defined" on EVERY PPV send. Function-scoped now (`=currentStatus`). The Node harness structurally can't reach `confirmPpvSend` — only live testing catches this class.

**Matrix results (all PASS):** vending frame-hold (0 violations, $0.06/msg), tipper (tip registers → tip-primary flips → reciprocity cycle, no number quoted), buyer-gap ($20 PPV + 3h-backdated gap → keeps climbing, NO goodbye — the Finding #9 bug confirmed dead), promise ladder (PPV1 full ritual → PPV2 ONE callback → PPV3 assumed/silent), Yendry buildup-only (no promise language anywhere incl. PPV caption, BUILDUP chip, mode detected), miss-lock (3 smooth no-command persuasion turns → lock → exclusive_custom pivot; the one retry seen was validator #18 legitimately correcting a continue_climb-after-miss), sexting (auto-detect on, in-register), Spanish (Yendry replies in accent-free Spanish per persona rules; Jammy deflects English-only), Camila emoji variety (😌😏😭 — stuck-😏 gone), goodbye (auto-fires on 2nd soft-no, warm short close, no loop). **Steady-state cost: $0.055–0.07/msg across all scenario types — Hans's target confirmed live.**

**Gap-matrix round 2 (2026-06-12) — objections + edge archetypes, all PASS.** A second live matrix closed the coverage gaps (objection handling had ZERO prior live coverage):
- **Objections — every subtype correctly classified + doctrine register:** discount ("do 15?" → run_objection_solve, never quotes a lower number, redirects to value), bad_experiences ("worth it? been burned" → "i'm actually different, you can feel that right?"), other_girls_cheaper ("show more for less" → never-compete "notice the difference between performing and when it's real"), free/preview demand pre-rapport → frame-hold not capitulation, "I'll get it later" → soft_no/never_spent, expected_more/ripped-off post-purchase → no apology, emotional reframe + probe for next angle.
- **Decisive negotiator (GUARD 4):** paid $69 then haggled "do 40?"/"can't do >60" → posture stayed WARM_BUILD (never TIMEWASTER — spender immunity), met the $60 counter "for a start" keeping the ladder open.
- **RLS arc (new sub):** rapport → rizz callback → age/qualify → breadcrumb scene drop, posture held WARM_BUILD (RLS freeze prevented premature-pitch truncation), strategy flipped to run_promise_ritual at the right beat.
- **Whale/love-framing:** "you're the only one I open up to" → pause-pitch held, sat in the emotional beat (Chit Chat, no CTA) both turns.
- **Story-framework-via-override — FIXED + confirmed live.** The validator hard-gated `run_story_framework` on `sell_vs_hold_read=case_5` with NO agent-override exception, so an explicit "run story framework" in the context box couldn't set the formal move (the auto-classifier vetoed the agent). Fix: validator skips the case_5 requirement when `agent_override_active` (PART 6 GUARD 6 precedence — same as TW/cap), and the AGENT OVERRIDE prompt block now tells the brain that a directive naming a framework/move sets that `next_move_after_wall` even if the auto-gate isn't met. A real wall still wins. Live-confirmed: override in `ctxIn` → `move=run_story_framework`, `agent_override_active=true`, draft is a proper story burst. Harness +3 assertions (90 total). NOTE for testers: the override box is **`ctxIn`** (NOT `agentNote`, which is the persistent CRM note), and `addMsg` re-renders the chat view — set `ctxIn` AFTER the customer message is added, right before generate, or the re-render wipes it.
- **Emoji fix confirmed landing live:** RLS turn used 😇/😌/🫣/🙈 (4 distinct across 4 msgs); objections varied throughout. The new no-repeat rule reduced repetition sharply (one 😇-at-2-msgs-gap slip seen — LLM guidance, not a hard guarantee).
- **Test-infra lesson:** the localhost python server died mid-run (silent — generates kept using browser cache until a navigate exposed it); and a double-installed `validateStrategy` instrumentation wrapper caused "Maximum call stack exceeded" that killed all generates. Both were HARNESS bugs, not product. Now guard the wrapper against re-entry and run a server-liveness Monitor during long matrices.

**Still UNTESTED live (the honest remainder as of 2026-06-12):** Mistral routing (every stress-test generation ran Claude — the explicit-content route via `callMistral`/OpenRouter has zero live coverage), ToS auto-retry trigger (regex is harness-covered; no generation ever emitted a banned word to fire the live retry path), OCR screenshot import end-to-end (vision→preview→import needs a real screenshot; only the date pure-functions are harness-covered), aftercare aftersex variant, manager_flag go-silent path, hard-promise-refusal routing (posture side harness-covered, live routing not). Also held by manager decision: Vercel deploy is stale at v0.4.3.2 (`ssai-new.vercel.app`) — no fixes from v0.4.3.3+ are live there.

**Jammy 😭 tic — ROOT-CAUSED + FIXED (same session):** her persona was innocent (😭 appears once, in her approved-emoji list). The funnel was the global EMOJI RULE itself — it prescribed a menu ("a laugh wants 😭/💀") and 💀 isn't in her approved list, so every laugh-beat had exactly one legal option. Classic positive-example parroting vector. The rule is now menu-free: match feeling→glyph from the persona's approved set, HARD never-repeat-within-last-2-messages, never develop a signature emoji, when in doubt none. Also: sexting 1.4× price multiplier verified live (base $25 → $35, reason carries "sexting × 1.4"), and `tests/harness.js` extended to 87 assertions (OCR date-resolution pure functions: Today/Yesterday/day-names/garbage→empty, date+time→ISO combination).

## Recent release: v0.4.4.3 (2026-06-01) — miss-lock persuasion window (code-only)

**PPV miss-lockout was firing too early.** Old trigger (`computeWallState`, ~line 4075) confirmed a miss after **2 customer replies** (or 1 reply + an "asking for more" signal) on an unopened PPV — so the lock fired before the brain got to work it. New trigger counts **our generated persuasion messages** after the unopened PPV and only confirms the miss after `MISS_PERSUASION_WINDOW=3` of them (with a `customerMsgsSince>=1` sanity floor so it's "ignoring the PPV while chatting", not "went silent"). The brain stays in `ppv_pending` mode for those 3 turns, then locks to exclusive_custom/warm only if he still hasn't opened. Manager: "some customers need 1-2 more messages to pay; I wouldn't call it a miss until 3 generated messages from our side."

The PPV-PENDING REGISTER RULES were also **rewritten to principle + hard-NOs, NO positive example lines** (same release). Original had a contradiction (`"open it then 😈"` command example next to the FELT-not-NARRATED rule); rather than swap examples, the manager's call was to **remove positive examples entirely** — they're the parroting vector (the model gravitates to them and flattens, same failure as Camila's 😏), whereas a hard-NO can't be parroted into sameness. The block now teaches the *mechanic* (desire over instruction, felt over narrated, match his heat one notch under, tie the pull to what HE just said, move a different lever each of the 3 turns, never repeat/beg) and lists hard-NOs (never command the transaction — "open it"/"unlock it"/"open it then"/etc.; never narrate the sale; never clinically name his state; never caretaker/permission-to-leave). Brain generates fresh from principle + customer context. If live testing shows register drift, add back ONE clearly-disposable illustration, not a menu.

**Dead-stash cleanup (DONE this release):** `session._ppvMissedAfterChance` was never assigned — the two miss-lock audit warns (`auditAnalysisVsGroundTruth`) silently never fired and the `agent_override` event's `miss_locked` field always logged false. Both now compute miss-lock **live from `computeWallState(session)`** (warns via a `missLockedNow` local that also suppresses during an agent override; event field inline). The real wall-enforcement always used live `wallState.ppvMissedAfterChance` and was unaffected — this just makes the advisory warns + analytics accurate.

## Recent release: v0.4.4.2 (2026-06-01) — per-model promise mode (code-only)

**Buildup-only promise mode** — lets a creator whose persona doesn't fit the promise ritual (e.g. a confident grown woman for whom "promise you'll keep this secret?" reads needy) keep the *buildup* before content but drop the promise ask. A model opts in with the marker `PROMISE MODE: BUILDUP_ONLY` anywhere in its persona prompt (case/space/`-`/`_`/`=` tolerant). `s._promiseMode` is computed in `generate()` right after the model resolves (default `'ritual'`). When `buildup_only`, six sites gate off: (1) `validateStrategy` skips all promise validators; (2) PPV-caption-mode prompt drops the "complete the ritual" instruction; (3) the promise-status guidance block is swapped for a BUILDUP-ONLY block; (4) the strategy schema's "PROMISE RITUAL forcing move" becomes a "BUILDUP forcing move" (never set `run_promise_ritual`); (5) the wall-enforcement site converts any stray `run_promise_ritual`/`run_promise_reinforcement` → `continue_climb`; (6) the Pass-C state machine skips `promise_status` advancement. The profile bar shows a blue **BUILDUP MODE** chip instead of PROMISE. The buildup itself is still enforced (investment-signal + breadcrumb gates are separate from the promise), so she still warms him up — she just never asks for a promise. First buildup-only model: **Yendry** (`Yendry_persona_edits.md` in repo root has the persona edits).

## Recent release: v0.4.4.1 (2026-06-01) — code-only, no doctrine push

Two live-testing findings, both code + app.js-prompt only (doctrine untouched, hash still `ca53389d`):

- **Promise reminder over-mentioned** → flipped the `reinforcement → assumed` transition from 3 landed PPVs to **2** (`landedPpvCount>=2`, ~line 4924), so the "keep this between us" callback fires AT MOST ONCE (on PPV2) then goes silent. `buildPromiseReinforcementTemplate` also teaches that over-invoking the secret reads as distrust — lean to a warm intimate line over the literal reminder. Customer feedback: "you don't have to mention the promise every time, it's a turn off."
- **Gives up too soon on interested customers** → new `detectContinuedInterest(s)` (reads last 2 customer msgs for wants-more / live heat / content-pull). Wired into `recomputePosture` as `s._continuedInterest`, gated into `s._continuedInterestProtects`. Three effects (all read the GATED flag): (1) CONTINUED-INTEREST POSTURE FREEZE in `computePosture` blocks TIMEWASTER; (2) `interestKeepClimbing` guard at the wall-enforcement site reroutes goodbye/ladder-stop → `continue_climb` — **this one overrides the persuasion cap** (interest beats the 3-attempt close; only a PPV miss-lockout still stops it), with a customer-winding-down carve-out; (3) an "ACTIVE INTEREST" postureGuidance block tells the brain to stay warm, not hammer the same offer, and re-pitch on a fresh opening. Manager had been overriding this by hand.
  - **THE GATE (`_continuedInterestProtects`):** interest protects him only while we haven't tried-and-failed to extract money. `protects = interest.active && !(effectiveSessionSpend===0 && madeRealAsk)` where `madeRealAsk = (PPV sent this session) || (_unpaidCtaCount>=1)`. So an "interested" guy still at $0 spend AFTER a real ask (PPV or unpaid CTA) is the vending-machine timewaster and **CAN go TW** — his "show me more" stops shielding him. Protected when: he's spent (incl. tips), OR no real ask has been made yet (don't quit before trying).

## Recent release: v0.4.4.0 (2026-06-01)

11 manager findings fixed across code + doctrine (doctrine bumped `v0.4.1.5` → `v0.4.4.0`, hash `ca53389d…`). Key changes:

- **Effective spend = PPV + tips** (`effectiveSessionSpend`/`effectiveLifetimeSpend`/`parseMoney` near `capTrustBySpend`). Tips now scale trust ceiling, pricing, tier, and TW-immunity — previously `tips_spend` was a separate bucket the scaling engine ignored. `updateProfile` writes `tips_spend` back so lifetime tips accumulate.
- **Session-spender anti-exit guard (CRITICAL)**: any session with spend (PPV opened OR tip) and no legitimate ladder close (miss-lockout / persuasion-cap) cannot be goodbye'd or ladder-stop-exited — the brain's `next_move` is rerouted to keep-climbing at the wall-enforcement site (`sessionSpenderKeepClimbing`). Warm-close carve-out (`warmCloseForSpender`) when the customer winds down himself. Fixes the "paid $20, came back 10 min later, got a cold goodbye" bug. GUARD 2 now grants full immunity for tips too.
- **Tip-led monetization (tip-primary type)**: `detectTipPrimary` + `toggleTipMode` (3-state `TIP-LED` chip mirroring sexting), `_tipPrimary` in `recomputePosture`, `tip_affinity` strategy field, `tipPrimaryStateBlock` in both prompts. Leads with relationship-register tip asks, **never a quoted number**, PPVs secondary. Doctrine PART 9 expanded from tips-as-last-resort to tips-as-primary-path.
- **No-salesman-register**: `ppvDirective` + PPV-pending prompts + doctrine PART 4/5 now teach "create desire, never command the transaction (`open it`/`unlock it`), never narrate the sale (`trust me it's worth it`, `it hits different`), never clinically name his state." The old `ppvDirective` literally taught "unlock this baby" as a RIGHT example — removed.
- **Returning-spender promise**: `recomputePosture` one-shot inits `promise_status` → `reinforcement` when lifetime spend > 0 (soft callback, not full ritual); doctrine PART 4 adds the "if he doesn't remember → re-frame" fallback.
- **RLS pacing**: `rlsProtection` freezes the free-msg posture clock for an engaged new sub (no PPV + new tier + ≥2 investment signals, bounded to first 12 AI msgs) so the RLS arc isn't truncated into a premature pitch. Doctrine PART 14 reframed as logic-not-script.
- **Tags + media**: tag chips now render in chat bubbles (were invisible); free-media gets a description field (`tags.mediaDescription`) surfaced as `[FREE-MEDIA: …]`, also via the OCR vision path.
- **PPV click honored**: clicking PPV always yields a caption (`_draftIsPpv=isPpvMode`); a `_ppvOverrodeBrain` badge warns when the brain wanted a different beat first.
- **Emoji rule**: generator prompt teaches tone-matched emoji + no repeating the same emoji across recent messages.
- **OCR date awareness** (from v0.4.3.4): screenshot import resolves a per-conversation date instead of stamping every message "now".

New `aich_events` types: `tip_mode_toggled`. New session/profile fields: `_tipPrimary`/`_tipModeToggle` (in-memory), `tags.mediaDescription`, profile `tips_spend` now persisted. **Doctrine push DONE (2026-06-01)**: `sql/doctrine_v0.4.4.0_push.sql` ran in the Supabase SQL Editor via Claude-in-Chrome; live `__global_training__` hash verified = `ca53389d…`, len 125850. All three integrity layers (code, declared constant, Supabase row) agree — no brain-tamper / drift warning. The push file remains in `sql/` for reference/rollback context.

### Context window & caching (verified v0.4.4.0)

The brain reads the **entire current-session conversation**, not a fixed window. In chat mode `generate()` passes the full `s.messages` array to both the strategy and generator calls via `fmtMsgsForAI(msgs, …)` — no `.slice()` truncation. The only conversation trimming is the **session-boundary** cut (`allMsgs.slice(boundaryIdx)` ~line 3973), which drops history from a *previously closed* session so a fresh arc doesn't drag the old one in — intentional, not a message cap. Sub-slices elsewhere are scoped helpers only: PPV pricing reads `slice(-12)`, signal detectors read the last 2–4 customer messages. The static system blocks (Layer 1 global training + Layer 2 model prompt) carry `cache_control: ephemeral, ttl 1h`, so the large doctrine is a cache *read* each turn (~$0.30/M) not a rewrite; the conversation itself is sent fresh (it changes every turn) but is small relative to the cached doctrine. Net: full-chat reads are already the behavior and are cheap for normal sessions. Only very long sessions (hundreds of msgs) would add meaningful uncached input cost — add a conversation-prefix cache breakpoint if that ever matters.

### v0.4.4.0 open items / verification notes

- **Deterministic vs. probabilistic fixes.** The hard code guards (effective-spend merge, session-spender anti-exit, TW guards, `_draftIsPpv=isPpvMode`) are deterministic and will hold. The voice/register fixes (no-salesman-talk, no-command captions, emoji tone-match, seed-don't-announce, tip-without-a-number) are *generator-prompt instructions to the LLM* — strong guidance, not guarantees. Live testing is how you confirm the brain actually obeys; don't assume "prompt says it" = "brain does it" for these.
- **Camila's persona 😏.** The global EMOJI RULE (tone-match, no-repeat) is in the generator prompt. But per-creator persona prompts live in Supabase `aich_models` (not the repo). If Camila still leans on 😏 after v0.4.4.0, check her persona prompt in Settings → Creator Models for a hardcoded smirk instruction — that would override the global rule. Quick console read: `models.find(m=>m.name==='Camila').prompt`.
- **In-memory mode toggles.** Both `_tipModeToggle` and `sexting_mode_toggle` reset on page reload (no `aich_sessions` column). Force-mode does not survive a refresh.

## Recent release: v0.4.3.2 (2026-05-12)

41 feedback items addressed across doctrine + engineering. See DEV_SPEC.md for the full spec. Key additions:

- **Doctrine v0.4.1.4**: new PART 23 (SEXTING MODE), patches to PARTs 2/3/4/5/6/7.5/9/12/19/21 covering TW guards, frame discipline, tip-asking rules, goodbye execution, phase labels, time awareness, hard NO compliance, caption personalization.
- **Engineering**: sexting state wiring (auto-detector, posture freeze, beat split, price multiplier, 3-state toggle UI), agent override system (context box authoritative wrap + audit event), TW guards (3 protections + manual unflag), dashboard fixes (accept/reject % math, PPV unlock balance, beat counter reset on payment), feedback queue append behavior, message-type tags (VN/Mass/Free Media/Tip), spend-by-archetype + top-spenders dashboard widgets, PPV Stats panel in profile sidebar, OCR Import via Claude vision.

### Known unaddressed minor items

- Phase enum: brain may still label post-PPV-purchase warmup beats as `aftercare` instead of the newly-added `warmup_between_rungs` — added to PHASE NAME REFERENCE doctrine but brain habit may persist for a few sessions before adapting.
- `customer_profiles` has stray rows from older dev testing (`Jake!mock`, bare `Jake` username) — not actively polluting current analytics but worth a one-off cleanup pass.
- `sexting_mode_toggle` field is in-memory only (no `aich_sessions` column added in v0.4.1.4) — survives across recomputes within a session but resets on page reload. Dev follow-up item.
