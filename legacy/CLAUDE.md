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
- **Bump version on release**: update `SSAI_VERSION` in `js/config.js` (the *app* version). The legacy per-file version convention (`SSAI_0_4_3_1.html`) is gone — the single `SSAI.html` reads its label from the constant. Note the folder name (`SSAI-v0.4.5.1`) tracks the *doctrine* version, not the app version, so the two can legitimately differ.
- **Inspect runtime cost**: click the `$/msg · Cache` dashboard card, or read `window._ssaiCostLog`, `window._ssaiCostTotal`, `window._ssaiCacheHitRate` in DevTools.
- **Tests**: `node tests/harness.js` — deterministic regression suite (253 assertions; the count grows with each release, so trust the printed `PASS n / FAIL 0` line over any number quoted here). Loads the real `js/*.js` into a Node VM sandbox (no browser, no API calls, no DB writes) and stress-tests the guard/detector/validator layer with synthetic customers: posture ladder + all TW guards, continued-interest gate, miss-lock 3-persuasion window, drift signals, effective spend (PPV+tips), sexting/tip-led/fork/investment detectors, ToS filter, promise-commitment detector, strategy validators (incl. buildup-only skip), audit warns. Run it after ANY change to the systems above. The probabilistic layer (register/voice quality, live generations) is NOT covered — that's manual via the running UI. The v0.4.3.2 release was additionally validated by a 27-test regression suite executed via Claude in Chrome (report in DEV_SPEC.md).

## Doctrine vs. code

Prompts, training documents, beat structure, fork detection logic, and behavioral playbook are authored work maintained outside this repo. This repo is the technical wrapper. Refactors of code are welcome; **changes to `DEFAULT_TRAINING` text, posture rules, or behavioral validators are doctrine changes and require coordination** — don't reword or "improve" the in-code prompt strings without explicit authorization.

The manager (brain author) maintains doctrine via separate Claude project sessions with full framework context. The dev maintains the technical wrapper. Doctrine changes flow: manager edits → SHA256 regen → Supabase push → dev reviews on the branch.

## Release history

The per-release changelog (v0.4.4.7 cost cut → v0.4.3.2) now lives in **DEV_SPEC.md → "Release history"** to keep this always-loaded file lean. Current release: **app v0.4.4.7 / doctrine v0.4.5.1** — the canonical version + SHA facts are under "Repository shape" at the top of this file.
