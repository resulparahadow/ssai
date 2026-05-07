# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository shape

This is a single-file browser app. The entire application lives in one HTML file at the repo root: `SSAI_0_4_3_1.html` (the version number is part of the filename — current canonical version is set in JS as `SSAI_VERSION='0.4.3.1'` at [SSAI_0_4_3_1.html:743](SSAI_0_4_3_1.html#L743)). There is no build step, no package manager, no test framework, and no CI. To run the app, open the HTML file in Chrome.

There is no git repository here. Treat edits as direct edits to the deployed file.

## Architecture (the parts that span the file)

The HTML file is divided into three contiguous regions:
- Lines 1–737: HTML + CSS shell (topbar, sidebar, dashboard, modals, theming).
- Line 738 onward: a single `<script>` block holding all application logic.
- Inside that script, a very large template literal `DEFAULT_TRAINING` ([SSAI_0_4_3_1.html:777-1958](SSAI_0_4_3_1.html#L777-L1958)) holds the Layer 1 doctrine prompt. **This block is integrity-checked at runtime** (see "Doctrine integrity" below) — edits to it require updating `DEFAULT_TRAINING_SHA256`.

### Backend boundary

Backend is Supabase (Postgres + auth + Edge Functions). The app only talks to:
- `SB_URL` / `SB_KEY` — Supabase project (anon key is committed; RLS does the actual access control).
- `PROXY_URL` (`/functions/v1/anthropic-proxy`) — Edge Function that holds the real Anthropic key and forwards browser calls.
- `MISTRAL_PROXY_URL` (`/functions/v1/mistral-proxy`) — same pattern for Mistral via OpenRouter.

Proxy mode is the default and on by default; the browser only carries a low-value proxy token (`ssai_*`). To bypass the proxy locally for debugging, set `localStorage.ss_use_proxy='false'` and put a real key in `localStorage.ss_claude` / `ss_openrouter`. See `useProxy()` / `callApi()` / `callMistral()` at [SSAI_0_4_3_1.html:769](SSAI_0_4_3_1.html#L769), [:8128](SSAI_0_4_3_1.html#L8128), [:8354](SSAI_0_4_3_1.html#L8354).

The Anthropic model is hardcoded to `claude-sonnet-4-6` ([SSAI_0_4_3_1.html:8159](SSAI_0_4_3_1.html#L8159)). Mistral is `mistralai/mistral-nemo` via OpenRouter.

### Supabase tables in use

- `chatters`, `model_assignments` — auth/RBAC. Roles: `manager` | `chatter`. Manager sees everything; chatter sees only own sessions and assigned creator models.
- `aich_sessions`, `aich_messages`, `aich_events`, `aich_vn_used` — per-conversation state and analytics events. All four have `chatter_id` auto-injected on insert via the `installChatterIdAutoInject()` shim ([SSAI_0_4_3_1.html:9909](SSAI_0_4_3_1.html#L9909)) — do not bypass `sb.from(...)` and write through a different client.
- `aich_models` — creator personas + content libraries; also stores `__global_training__` row (the live brain copy, RLS-locked for writes).
- `customer_profiles` — long-term per-customer memory (trust level, archetype, total_spend, key_details).
- `creator_status` — real-life status entries fetched per-generation by `fetchActiveCreatorStatus()`.
- `aich_feedback_queue` — manager-reviewed corrections.

### Two-call generation pipeline

`generate()` ([SSAI_0_4_3_1.html:6598](SSAI_0_4_3_1.html#L6598)) is the central function — ~1200 lines. Read it before touching any prompt-construction or routing code. The flow is:

1. **Pre-compute session telemetry** — posture (`recomputePosture`/`computePosture`), customer tier, wall state (`computeWallState`), forcing move, fork detection (`detectFork`), investment signals (`detectInvestmentSignals`), trust capping by spend (`capTrustBySpend`).
2. **Strategy call (Claude)** — produces a JSON strategy object with phase, ritual_step, tone, price_rule, caption_required, etc. Validated and clamped by `validateStrategy`, `clampStrategyByPosture`, `clampStrategyByDepthGate`, `clampStrategyByRegisterMatch`.
3. **Generator call** — depending on `api` mode (`auto` | `claude` | `mistral`):
   - `claude`: Claude writes the message directly using the strategy.
   - `mistral`: Claude returns the strategy JSON, then `callMistral()` executes it. Used for explicit content (Anthropic refuses; Mistral doesn't).
   - `auto`: Claude decides per-message whether to route to Mistral.
4. **Post-processing** — `scanForBanned`, `registerFilterCheck`, `stripReasoningLeaks`.
5. **Analysis call** — `runAnalysis()` updates the customer profile (trust, archetype, key_details).

**Prompt-cache discipline**: the strategy and generator calls deliberately share byte-identical system blocks (notably `contentLibraryBlock`) so they hit one cache entry instead of two. Comment at [SSAI_0_4_3_1.html:6684](SSAI_0_4_3_1.html#L6684) explains the rule. **Never reorder, rewrap, or paraphrase shared system blocks** — even whitespace differences cost a cache write (~$3.75/M write vs $0.30/M read). Inspect cache behavior live via the `$/msg · Cache` card → `openCostDiagnostic()` ([SSAI_0_4_3_1.html:8247](SSAI_0_4_3_1.html#L8247)).

### Posture system

Sessions carry a posture: `WARM_BUILD` | `PROBE` | `PRESSURE` | `TIMEWASTER`. It is recomputed on every generate from spend, free-message count, unpaid CTAs, and investment signals. Posture gates what the strategy is allowed to do — e.g. `PRESSURE` unlocks the ladder/PPV pitch; `TIMEWASTER` forces short replies to cut token cost. Strategy outputs are clamped against posture before generation. See [SSAI_0_4_3_1.html:4626](SSAI_0_4_3_1.html#L4626) onward.

### Doctrine integrity

`DEFAULT_TRAINING` is the brain prompt and ships in code. Three independent integrity checks run:

1. `checkDoctrineIntegrity()` — structural (presence of expected section headers).
2. `verifyBrainTamper()` — SHA256 of the in-code constant matches the declared `DEFAULT_TRAINING_SHA256` constant.
3. Same SHA256 compared against the Supabase `__global_training__` row.

If both code and Supabase fail, `window.__brainCorrupted=true` and `callApi()` refuses to generate. **When you intentionally edit `DEFAULT_TRAINING`, you must update `DEFAULT_TRAINING_SHA256`** ([SSAI_0_4_3_1.html:1969](SSAI_0_4_3_1.html#L1969)). The only authoritative way to compute the new hash is in-browser (template-literal escapes are unescaped at runtime, so Python/CLI SHA256 won't match): open Settings → Models → "Show current brain SHA256" (`showBrainHash()`).

### Role gating

Manager-vs-chatter UI gating runs through `applyRoleGating()` ([SSAI_0_4_3_1.html:9842](SSAI_0_4_3_1.html#L9842)) at startup and after auth. Many features (API mode switcher, Settings tab, CSV exports, full leaderboard, cost cards, dashboard chatter filter) are manager-only. When adding a new manager-only widget, gate it inside `applyRoleGating` rather than per-call-site.

## Workflow

- **Run the app**: open `SSAI_0_4_3_1.html` in Chrome. No server needed.
- **Edit the app**: edit the file in place. The `<title>` and brand version label are auto-rewritten from `SSAI_VERSION` on load — bump that constant rather than hand-editing the title.
- **Bump version on release**: rename the file (e.g. `SSAI_0_4_3_1.html` → `SSAI_0_4_3_2.html`) AND update `SSAI_VERSION`. They are intentionally coupled so the on-disk filename signals the build.
- **Inspect runtime cost**: click the `$/msg · Cache` dashboard card, or read `window._ssaiCostLog`, `window._ssaiCostTotal`, `window._ssaiCacheHitRate` in DevTools.
- **Tests**: there are none. Verification is manual via the running UI.

## Doctrine vs. code

Per the README: prompts, training documents, beat structure, fork detection logic, and behavioral playbook are authored work maintained outside this repo. This repo is the technical wrapper. Refactors of code are welcome; **changes to `DEFAULT_TRAINING` text, posture rules, or behavioral validators are doctrine changes and require coordination** — don't reword or "improve" the in-code prompt strings without explicit authorization.
