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
