# SSAI — Dev Spec

_(Started as the v0.4.1.4 handoff; kept as the living dev reference. Version-specific notes below are historical.)_

**Doctrine version:** `v0.4.1.3` → `v0.4.1.4`
**SHA256 (line 1360 of `js/doctrine.js`):** `e09f670f1d6193dd37577a7b0be64b1e45c6176a7cbbae611563a61868e26b6b`
**Source for changes:** May 6–11 manager feedback audit (41 items, see "What shipped" below).

This branch makes substantial changes across doctrine, app code, and UI. This doc is the one-page handoff for the dev review.

---

## What shipped — by cluster

### Doctrine changes (`js/doctrine.js`)

| Cluster | PART affected | Items | Summary |
|---|---|---|---|
| **N (Sexting)** | PART 23 (new, +167 lines) | #7, #34 | Brand-new SEXTING MODE doctrine: 2-gate entry, posture freeze, beat-counting split, PPV pricing multiplier, voice/tone rules, 5 exit conditions, reference examples. Engineering fields surfaced: `sexting_active`, `sexting_mode_toggle`, `sexting_beats_since_last_ppv`, `sexting_ppv_multiplier`, `free_chat_beats` freeze. |
| **A (TIMEWASTER)** | PART 6 patched | #7, #19, #20, #28, #29, #30, #34, #35, #37 | Added 6 TIMEWASTER GUARDS subsection: pre-CTA protection, active-session spend immunity, 6-msg post-payment grace window, negotiation ≠ stalling, returning-day grace, agent override precedence. Plus manual TW removal rule (bidirectional). |
| **M (Hard NOs)** | PART 19 patched | #24 | Added CRM HARD NOs subsection: model-specific prohibitions get firm warm refusals, not vague deflections. Repetition is the signal of a weak prior refusal. |
| **D (Captions)** | PART 4 patched | #9, #23 | Caption personalization rules (tie to what HE likes) + recovery-caption rules for unsatisfied prior buyers. |
| **C (Frame discipline)** | PART 2, 3, 5, 9, 21 patched | #14, #15, #16, #17, #41 | Relationship archetype → tip-asking works; CTA 2 mystery/tease emphasis; FRAME LEAKS (no free validation); ENERGY MATCHING AT KEY MOMENTS; TIP-ASKING DOCTRINE (last resort default, relationship-register exception). |
| **E (Goodbye)** | PART 12 patched | #25, #26, #39 | Added GOODBYE MUST FIRE — NEVER HALF-EXIT subsection with explicit closed-door anti-pattern list. Auto-fire discipline. |
| **F-doctrine (Phase labels)** | PART 7.5 patched | #12, #13 | Added PHASE LABEL DISCIPLINE — what each phase actually means; explicit "Aftercare ≠ rapport break" + "Rapport ≠ active PRESSURE" fixes. |
| **G-doctrine (Time)** | PART 21 patched | #27 | Added TIME AWARENESS — Match the Hour: 6-block energy map, customer-clock vs creator-clock rule, day-of-week awareness, drift guidance. |

### App code changes (`js/app.js`, `js/ui.js`, `SSAI.html`)

| Cluster | Files | Items | Summary |
|---|---|---|---|
| **L (Dashboard bugs)** | `app.js` | #21, #22, #31 | (1) `acceptDraft` now inserts `aich_messages` row with `was_sent:true` (was missing — caused 0% accept). (2) `confirmPpvSend` also inserts the PPV caption send with `was_sent:true`. (3) `togglePpvOpened` re-open branch now logs a balancing `ppv_landed` event so dashboard counts don't drift downward after relock→unlock cycles. |
| **K (Feedback queue)** | `app.js` | #11 | `approveFeedbackQueueItem` now APPENDS to existing rules (dedupe) instead of replacing. New `saveFeedbackRules` function — Learned Rules display is now editable so manager can resolve contradictions in-place. |
| **F-engineering (Beat counter reset)** | `app.js` | #33 | New `_openedAtMsgIdx` stamped on the PPV bubble when it's opened. `computeLadderState` derives `messagesSinceLastPurchase` from this and uses it for drift-signal gates when the last PPV is opened (was using send-time count, breaking the post-land warmup window on delayed payments). |
| **G-engineering (Time + chronological hint)** | `app.js` | #18, #32 | New `timeContextBlock` computed once per generate (weekday + date + time + active hour block). Injected into BOTH the generator user prompt AND the strategy prompt. Added explicit chronological-ordering hints to both prompts (OLDEST at top, NEWEST at bottom) as a backreading safety net. |
| **B (Override system)** | `app.js` | #6, #8, #36, #37, #38, #40 | Context box content is now wrapped as `=== AGENT OVERRIDE — AUTHORITATIVE ===` with explicit precedence rules (wins over TW lockout, miss-lockout, persuasion cap, aftercare auto-triggers; does NOT win over HARD RULES, TOS, CRM Hard NOs). Strategy prompt gets matching authoritative block + `agent_override_active` strategy field. New `aich_events` event_type `agent_override` logged whenever context is non-empty — gives manager audit trail (item #6). |
| **H (Tags)** | `app.js`, `ui.js` | #1, #3, #4 | New `msg-tags-bar` UI under sender-bar: VN / Mass / Free Media toggles when sender=model, "Came with tip" + amount input when sender=customer. New `toggleMsgTag` / `resetPendingMsgTags` / state in `window._pendingMsgTags`. `addMsg` attaches `tags` object to the message; `fmtMsgForAI` surfaces tags in the prompt format (e.g. `CUSTOMER [TIPPED $20]: thanks babe`). Tip toggle with amount auto-records as a tip via the same posture-reset path as `recordPpv`. |
| **I (Analytics)** | `app.js`, `SSAI.html` | #5, #10 | New dashboard widgets: SPEND BY ARCHETYPE (groups range PPVs by customer archetype, sums + counts) and TOP SPENDERS (top 8 customers in range by net unlocked, with archetype tag). Cross-references `aich_events.ppv_landed` with `customer_profiles.archetype`. New PPV STATS panel in the per-session profile sidebar (separate from CRM Notes — feedback item #10): session opens/sends, avg + max price, net unlocked, lifetime spend. Strategy prompt also surfaces a PPV STATS line so AI pricing decisions use clean data. |
| **J (OCR)** | `app.js` | #2 | New "📷 Import Screenshot" tab. `openOcrPicker` triggers a hidden file input; `handleOcrFile` reads the image as base64 and calls `callClaudeVisionForChat` (uses existing `callApi` with image content block + JSON-only system prompt). Preview modal shows extracted messages with per-row checkboxes; `confirmOcrImport` pushes the kept ones to `s.messages`. Handles `customer` / `model` / `ppv` sender types and PPV price/opened flags. |

---

## Engineering fields introduced (need to live in code beyond doctrine)

These were named in the new doctrine and are now also reflected in app.js where applicable. Some are partially wired and need follow-through from the dev:

| Field | Where doctrine references it | Where code touches it | Dev follow-through |
|---|---|---|---|
| `sexting_active` | PART 23 | not yet enforced in code | **needs full integration** — wire the two-gate detector into the strategy pass (see SEXTING_MODE section in PART 23 doctrine for the gates) and apply the posture freeze / beat-counter split / aftercare defer as described. |
| `sexting_mode_toggle` | PART 23 | not yet in UI | **needs UI toggle** in session panel: 3-state (AUTO / FORCE_ON / FORCE_OFF). Persist on session record. |
| `sexting_beats_since_last_ppv` | PART 23 | not yet | **needs counter** that increments only while `sexting_active`. Reset on PPV PAID event (not on send). |
| `sexting_ppv_multiplier` | PART 23 | not yet | Default 1.4. Apply to `recommended_price` / `unlocked_tier` price suggestions when `sexting_active`. |
| `free_chat_beats` freeze | PART 23 | partial — existing `_freeMsgCount` resets on payment but isn't frozen during sexting | **needs gating** on increment: only bump when `sexting_active === false`. |
| `session_ppv_count >= 1` TW immunity | PART 6 GUARD 2 | not yet | **needs guard** in posture transition code: any session with `session_ppv_count >= 1` cannot transition to TIMEWASTER. |
| `free_chat_beats_since_payment < 6` grace | PART 6 GUARD 3 | not yet | **needs counter + guard**. Reset to 0 on every payment event. Block TW transitions while < 6. |
| `agent_override_active` (strategy field) | PART 6 GUARD 6, override doctrine | now in strategy prompt | **dev should**: read this back from the strategy JSON, and ensure wall enforcement (`aftercareActive`, `ppvMissedAfterChance` blocks) defer when it's true. |
| `_openedAtMsgIdx` (PPV bubble) | n/a (engineering only) | implemented in `togglePpvOpened` and `computeLadderState` | ✓ done |
| `creator_local_time` / `creator_local_weekday` | PART 21 | implemented inline as `timeContextBlock` | ✓ done — customer-clock support deferred (needs structured timezone data on profile, not free-text location). |
| Sexting Mistral routing (Claude generates suggestive, Mistral only for literal) | PART 23 | not yet | **dev review**: current `auto` routing in `api.js` / `app.js` may route to Mistral on explicit-tier signals — confirm whether sexting-mode should bypass that and force Claude. |

---

## DB schema notes

No migrations added in this branch. The following new event types are emitted (just `event_type` strings on existing `aich_events` table):
- `agent_override` (payload: directive, posture_before, tw_state, miss_locked, ppv_count_session)
- `tip_recorded` (payload: amount, new_total_tips)
- `ppv_landed` with `payload.reopen: true` (existing event type, new payload flag)

New fields on message objects (in `aich_sessions.messages_input` JSON):
- `tags` (object): may contain `vn`, `mass`, `freeMedia`, `tip`, `tipAmount`
- `_openedAtMsgIdx` (number, on PPV bubbles only): set when first-opened or re-opened

`aich_models.feedback_rules` now grows over time (append) instead of overwriting. Manager can prune via the Models tab Save Rules editor.

---

## Out-of-band database changes already applied (FYI — dev did not do these)

While preparing this branch, two database-side changes were applied directly via the Supabase SQL Editor (which runs as `postgres`). Both are already live in production DB — listing them here so you're not surprised by drift between your local schema dump and prod.

### 1. Bug fix to `snapshot_aich_models()` trigger function

**Symptom:** ALL `UPDATE` statements on `aich_models` were silently no-op'ing — Supabase reported "Success" but the row never changed. This silently broke the in-app `saveModel` function (the Save button in the Models tab) for every chatter and manager.

**Root cause:** The trigger function was returning `OLD` unconditionally. In PostgreSQL, `BEFORE UPDATE` returning `OLD` semantically means "discard the proposed NEW row, keep OLD" — i.e., silent cancellation. The function was likely originally written for the `BEFORE DELETE` trigger (where `RETURN OLD` correctly allows the delete to proceed) and got reused for `UPDATE` without updating the return logic.

**Fix applied:**
```sql
CREATE OR REPLACE FUNCTION public.snapshot_aich_models()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE uid_text TEXT;
BEGIN
  BEGIN
    uid_text := auth.uid()::text;
  EXCEPTION WHEN OTHERS THEN
    uid_text := NULL;
  END;
  IF uid_text IS NULL OR uid_text = '' THEN
    uid_text := session_user;
  END IF;
  INSERT INTO aich_models_backups(operation, changed_by, name, prev_prompt, prev_tier, prompt_length)
  VALUES (TG_OP, uid_text, OLD.name, OLD.prompt, OLD.tier, length(OLD.prompt));
  -- Was: RETURN OLD (unconditionally). Bug: BEFORE UPDATE returning OLD = silent no-op.
  -- Fix: TG_OP-aware return. UPDATE → NEW (apply change). DELETE → OLD (allow delete).
  IF TG_OP = 'UPDATE' THEN
    RETURN NEW;
  END IF;
  RETURN OLD;
END;
$function$;
```

**Audit-log behavior preserved:** every UPDATE and DELETE still inserts a snapshot row into `aich_models_backups` capturing the prior state — same as before. Only the return value changed.

**`aich_models_backups` will have several junk entries** from the failed-update diagnostic attempts during this deploy. Each entry has `prev_prompt` matching the prior doctrine version (v0.4.1.3 or older). They're harmless audit log entries — prune or leave at your discretion.

### 2. `__global_training__` row already updated to v0.4.1.4

Already pushed via Supabase SQL Editor using base64-encoded payload (initial attempt via direct paste produced UTF-8 → mojibake corruption; base64 + `convert_from(decode(..., 'base64'), 'UTF8')` ran cleanly).

**Verification:**
- `octet_length(prompt)` = 116627 ✓
- `char_length(prompt)` = 109064 (matches code: 109108 JS UTF-16 code units − 44 supplementary-plane chars = 109064 code points)
- Preview shows `SMARTSTARSAI — GLOBAL AGENCY TRAINING (v0.4.1.4)` with clean em-dash
- SHA256 matches code-canonical `e09f670f1d6193dd37577a7b0be64b1e45c6176a7cbbae611563a61868e26b6b` end-to-end

**So when you pull this branch and load the app, there should be ZERO `[brain-tamper]` warnings.** If there are, something diverged between this writeup and what actually shipped — investigate before rolling out further.

---

## Test cases derived from feedback screenshots

Regression checks — these are the real cases that informed the changes:

1. **Ricardo (PART 23 + Cluster F doctrine)** — Paid $35, started fantasy-building ("me encantaría venirme en tus pies"). Expected: `sexting_active=true` fires once code is wired, posture freezes at PRESSURE, ladder climbs. Don't pivot to aftercare. (Doctrine already supports — engineering needs to fire the flag.)

2. **Josh (PART 23 + Cluster B + Cluster F-eng)** — Paid 2 PPVs, sent dick pic, agent typed "validate and pitch 3rd sale" in context box. Expected: agent override block in strategy prompt makes brain comply. With `sexting_mode_toggle=FORCE_ON` (once wired), sexting state holds. Beat counter reset on payment prevents false MISS LOCKED.

3. **Eduardo (PART 6 GUARD 2 + GUARD 3 + GUARD 4)** — Paid $69, negotiated price ("babe i cant do more than 60 tbh"). Expected: `session_ppv_count >= 1` immunity blocks TW. Decisive archetype's negotiation is buying behavior, not stalling.

4. **Javier (already working — protect)** — Paid, TW flag cleared instantly, posture reset to WARM_BUILD. ✓

5. **Dashboard math** — After accepting 5 drafts, accept rate should show 100%, not 0%. After 2 PPVs landed in session, landed count stays at 2 even after a relock→unlock cycle.

6. **Time** — Generate at noon on a Thursday: prompt sees `Thursday, [date] · 12:00 · DAYTIME block`. Generate at 11pm: sees `NIGHT block`. AI does not say "good morning" at 11pm, does not say "Tuesday vibes" on Thursday.

---

## What the dev still owns

- Pulling this branch and reviewing the doctrine diff in `js/doctrine.js` (PART 23 is the biggest change, ~167 lines new; PARTs 2/3/5/6/7.5/12/19/21 have additions).
- Verifying the SHA256 on line 1360 matches what the browser computes (it should — last regen was after all doctrine edits).
- Implementing the engineering fields listed in the "Engineering fields" table above (especially the sexting suite — doctrine is dead text without those).
- The UI toggle for `sexting_mode_toggle` (AUTO / FORCE_ON / FORCE_OFF).
- Manager-facing view for `agent_override` events — Cluster B introduced the logging; a dashboard widget to surface "X overrides this week" + a click-through to review them is a natural follow-up.
- Reviewing the out-of-band DB changes section above (the `snapshot_aich_models()` fix in particular) — confirm the trigger fix is what you would have done, or flag if you had a different intent for the original `RETURN OLD` behavior.
- CLAUDE.md needs a refresh — current text still describes the old single-file layout (`SSAI_0_4_3_1.html`, single script block at line 738+, etc.). Stale.

**NOT on your plate (already done):** Pushing the new doctrine text to Supabase `aich_models.__global_training__` — already applied via SQL Editor + base64 payload; hash matches code-canonical end-to-end. See "Out-of-band database changes" section above for details.

---

## How to verify the branch loads

1. Open `SSAI.html` in Chrome from the new folder.
2. Open DevTools console.
3. Expected console state (since Supabase is already in sync):
   - **No** red `[brain-tamper] CODE INTEGRITY BROKEN` errors.
   - **No** yellow `[brain-tamper] Supabase row drifted` warnings either.
   - `SmartStarsAI ready` toast.
4. If a red CODE INTEGRITY error appears, the SHA256 on line 1360 of `js/doctrine.js` doesn't match the current `DEFAULT_TRAINING` content. Use Settings → Models → "Show current brain SHA256" to recompute and update the constant.
5. If a yellow `Supabase row drifted` warning appears, the Supabase row diverged again somehow (someone else updated it, or the trigger regressed). Investigate before further rollout.

---

**Doctrine is canonical. Engineering catches up.** When doctrine and code disagree, doctrine wins — fix the code, not the doctrine.

---

## Release history

_Per-release changelog moved out of CLAUDE.md on 2026-06-18 to keep the always-loaded doc lean. Newest first; these are historical and code-only unless noted._

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
