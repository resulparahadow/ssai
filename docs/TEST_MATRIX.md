# SSAI v0.4.4.5 — EXHAUSTIVE VERIFICATION MATRIX (2026-06-12)

Goal: 100/100 coverage — every doctrine PART, every code system, every archetype,
every conversation shape, including the new Whale Builder + objection material.
Legend: ☐ pending · ✓ pass · ✗ fail(→fix→re-run) · ⊘ blocked (reason logged).
Mock naming: `mk_*`. Cost gate: msgs 2+ < $0.10 (watch `_ssaiCostLog` every scenario).
Order: Phase 1A (deterministic, free) completes BEFORE live cells burn API spend.

## PHASE 1A — DETERMINISTIC ✅ COMPLETE 2026-06-12 (227 assertions, 90 at mission start)

Sections K+N+P (validators), Q (clamps), B+C+R (posture/tier/wall/ladder), F+R
(drift), G+H+S (detectors/forks/investment), J+S (promise reachable side), T
(full TOS/register list sweeps), O (whale builder), A (spend), M (OCR).

FINDINGS (deterministic layer):
1. GUARD 3 (post-payment grace) is SHADOWED by GUARD 2 since v0.4.4.0 widened
   GUARD 2 to tips — hasAnyPayment ⊆ sessionHasSpend, so GUARD 3 can never fire.
   Dead code, zero behavioral impact (GUARD 2 grants strictly stronger immunity).
2. driftSignal 'post_miss' base state is unreachable-by-construction (miss-lock
   needs ≥4 msgs after the PPV → counter ≥2 → always lands drift_post_miss or
   worse). Dead branch, harmless.
3. English-pick detector bug (both-languages-mentioned misread) — FOUND LIVE,
   FIXED, +3 regression assertions (see WB smoke).
HARNESS-UNREACHABLE (live-cell coverage instead, by construction — they live in
acceptDraft/confirmPpvSend/generate() UI flows): Pass-C promise advancement,
sessionSpenderKeepClimbing / interestKeepClimbing / warmCloseForSpender rerouting,
whale-builder freeMsg freeze increment site, ToS auto-retry loop, _draftIsPpv.

Original inventory (all ✓ except the unreachable list above):

- ☐ D1 validateStrategy — EVERY rule individually (read source, enumerate all
  ~18+ validators: pitch-during-wall, frame-hold calibration exemptions, sexual
  floor, emotional latitude, posture-phase legality, depth gate, register match,
  promise validators (ritual creators), buildup-only skips, story case_5 gate +
  override exception, continue_climb-after-miss correction, ppv_pending rules,
  message_length bounds, tier/price legality, agent_override interactions)
- ☐ D2 clampStrategyByPosture — every posture × phase clamp branch
- ☐ D3 clampStrategyByDepthGate — under/at/over-depth cases
- ☐ D4 clampStrategyByRegisterMatch — each register mismatch correction
- ☐ D5 computePosture — every branch: WARM_BUILD/PROBE/PRESSURE thresholds,
  TW entry, GUARD 1 (pre-CTA), GUARD 2 (spend immunity incl. tips), GUARD 3
  (6-msg grace), GUARD 4 (decisive negotiator), investment-zero override,
  continued-interest freeze, sexting freeze, whale-dilation freeze, RLS freeze,
  whale-builder freeze (new), flagged_tw manual tier
- ☐ D6 Drift signals — every drift state fire + clear (cooling, register drift,
  length collapse, echo) on computeLadderState
- ☐ D7 computeWallState — objection/soft_no/ppv_missed branches, miss-lock
  3-persuasion window (0/1/2/3 msgs, customerMsgsSince floor), persuasion cap,
  pause-pitching triggers (love_framing, whale candidate)
- ☐ D8 computeLadderState — next-move routing branches, sessionSpenderKeepClimbing,
  warmCloseForSpender (windDownPat), interestKeepClimbing + cap override,
  goodbye 3-phase ladder, exclusive_custom pivot
- ☐ D9 Detectors edge inputs — detectSextingActive (both gates, ES patterns,
  [image sent]), detectTipPrimary (all 3 signal paths), detectContinuedInterest
  (+ protects gate: madeRealAsk × spend grid), detectInvestmentSignals,
  detectFork (deflection/love_framing/vending/silence/vulnerability),
  detectPromiseCommitment, detectWhaleBuilder ✓(23 done), detectEnglishPick ✓
- ☐ D10 Promise state machine — ALL transitions: not_started→in_progress→
  verbally_committed→complete→reinforcement→assumed (incl. 2-PPV flip),
  returning-spender init, "what promise?" reframe backward transition,
  buildup-only: all six gate-off sites
- ☐ D11 Effective-spend math — parseMoney/effectiveSessionSpend/
  effectiveLifetimeSpend edge inputs ($ strings, null, profile-vs-session
  fallbacks) ✓(partial: 9 in section A)
- ☐ D12 OCR date functions — resolveOcrDateHint/combineDateAndTime ✓(done in M;
  re-verify against any new edge from live OCR test)
- ☐ D13 scanForBanned — every BANNED_WORD + each BANNED_PATTERN context
  (fire + benign-context not-fire), registerFilterCheck every phrase family
- ☐ D14 capTrustBySpend thresholds ✓(done) + tier system computeCustomerTier
  branches (new/regular/vip/whale/flagged_tw)
- ☐ D15 Whale Builder ✓ DONE (23 assertions, section O)

## PHASE 1B — LIVE GENERATION MATRIX

Creators: Jammy (ritual, EN-only), Yendry (buildup-only, ES), Camila (ritual,
emoji-watch), Cielo (whale-builder — persona update must be pasted first),
Cindy, Sandra (voice/coverage TBD from their persona prompts at login).
"Relevant creators" listed per cell; every creator appears in multiple cells.
First-gen cache write per creator (~$0.30) is expected, not a regression.

### B1 — New material (FIRST, it's the freshest risk)
- ☐ WB-01 Cielo + mk_usa new sub: "english" pick → arc activates (chip ARC
  ACTIVE, event logged), opener + thank-you beats in practicing-English voice
- ☐ WB-02 RLS rapport runs to age-reveal, then Matias pivot (no premature pitch;
  posture Free counter FROZEN — verify chip numbers)
- ☐ WB-03 Tip test fires ONCE: $37 quoted, takeout framing, hypothetical frame,
  no PPV stacked on the turn; ask auto-detected (chip → tip_test_made)
- ☐ WB-04 Branch A: tip recorded → QUALIFIED chip + event; next turns = whale
  handling, tip-led, NO quoted numbers ever again
- ☐ WB-05 Branch B: "whats in it for me" → reciprocity line → tip → qualified
- ☐ WB-06 Branch C: interrogates exactly-what-do-I-get ×6 → NOT WHALE event;
  returns to standard ladder warmly (no punishment register)
- ☐ WB-07 Negative: "espanol" pick → arc must NOT activate (no chip activity)
- ☐ WB-08 Negative: returning spender (lifetime>0) English pick → NOT activate
- ☐ WB-09 FORCE_ON on a non-eligible sub → arc runs; FORCE_OFF mid-arc → block
  gone next turn; events for both toggles
- ☐ WB-10 Non-WB creator (Jammy): no WHALE chip rendered at all
- ☐ OBJ-N1 New OBJECTION 2 register (bundle content): bait "what exactly is in
  it?" during ppv_pending — refuse-describe mechanic, feeling-invitation closer
  allowed, NO naked open-it command, no copy-paste of script lines (Jammy + Yendry-ES)
- ☐ OBJ-N2 New OBJECTION 9 register (preview demand) — performing-vs-real +
  can't-show-in-preview beats, in-voice variants (Camila + Yendry-ES)
- ☐ OBJ-N3 New OBJECTION 10 register (buy later) — warm acceptance + in-the-
  moment framing, NO pressure register (Cindy or Sandra + 1 more)
- ☐ OBJ-N4 (⊘ until screenshots complete) remaining new objection sets — same
  protocol per set

### B2 — Customer archetypes (spread across creators, every creator ≥1)
- ☐ AR-01 Decisive (fast yes, hates fluff) — pitch pace matches (Jammy)
- ☐ AR-02 Consensus (needs validation/agreement) (Camila)
- ☐ AR-03 Relationship (boyfriend frame, pet names) → tip exception register (Cindy)
- ☐ AR-04 Skeptical (challenges realness/value) (Sandra)
- ☐ AR-05 Rational (logic, price-per-value talk) (Jammy)
- ☐ AR-06 Emotional (mood-led, vulnerability) (Yendry)
- ☐ AR-07 Hybrid shift mid-convo (rational→emotional after rapport) — strategy
  archetype read updates, register follows (Camila)

### B3 — Full ladders
- ☐ LD-01 Ritual creator full climb: rapport→breadcrumb→promise ritual→PPV1→
  warmup_between_rungs (correct phase label!)→PPV2 (ONE reinforcement callback)→
  PPV3 (assumed, silent) (Jammy)
- ☐ LD-02 Same ladder on Camila — voice differs, mechanics identical
- ☐ LD-03 Yendry buildup-only: NO promise language anywhere incl. captions,
  BUILDUP chip, buildup beats still enforced before tier-2
- ☐ LD-04 Returning spender: soft reinforcement (no full ritual), then
  "what promise?" → re-frame fallback (Jammy)
- ☐ LD-05 PPV price laddering sane across rungs (suggestions climb, sexting ×1.4
  when active) (any)

### B4 — Objections (existing PART 11 set still intact post-edit)
- ☐ OB-01 discount ask → never quotes lower number, value redirect
- ☐ OB-02 only_want_naked → vulnerability + imagination redirect
- ☐ OB-03 expected_more/lied → hurt-not-defensive, "what does more look like"
- ☐ OB-04 specific_body_part menu ask → reject menu framing
- ☐ OB-05 other_girls_cheaper → performing-vs-real differentiation
- ☐ OB-06 free ask → only-with-you framing
- ☐ OB-07 bad_experiences → validate + different-with-us
- ☐ OB-08 worth_it short-form (QUICK REFERENCE register)
- ☐ OB-09 price objection during HIGH TICKET (PART 13 register)

### B5 — Walls
- ☐ WL-01 Soft-no from a session spender → Percival aftercare ladder_stop
  variant (50/25/25), no store-voice
- ☐ WL-02 Aftercare aftersex variant (post-sexting climax, manual toggle)
- ☐ WL-03 Soft-no never-spent ×2 → goodbye 3-phase to cap (warm, short, no loop)
- ☐ WL-04 Miss-lock: PPV unopened + 3 persuasion turns (each a different lever,
  no command register) → lock → exclusive_custom pivot only
- ☐ WL-05 manager_flag: objection unsolved after 3-4 redirects → goes quiet
  (flag event, no further pitching)
- ☐ WL-06 Hard promise refusal ("I don't do promises" hostile) → case_5/goodbye
  routing — NOT treated as content objection
- ☐ WL-07 Persuasion cap: 3 attempts post-wall → ladder closes (vs continued-
  interest override case: interest present → keeps climbing)

### B6 — Modes
- ☐ MD-01 Sexting AUTO detect (paid + fantasy language) → freeze + 1.4× price
  + scene register; AUTO ACTIVE chip
- ☐ MD-02 Sexting FORCE_ON cold (no gates) + FORCE_OFF mid-scene kills it
- ☐ MD-03 Tip-led AUTO (tip recorded → flips) → open-ended asks, NEVER a number,
  PPVs secondary; FORCE both ways
- ☐ MD-04 Aftercare toggle variants (see WL-01/02)
- ☐ MD-05 Agent override via ctxIn (set AFTER addMsg!) — overrides TW lockout,
  miss-lockout, persuasion cap, forcing-move gates (story framework by name);
  agent_override event logged with posture state; does NOT override HARD RULES
  (bait a TOS-banned directive → must refuse)
- ☐ MD-06 PPV click honored when brain wanted another beat (_ppvOverrodeBrain
  badge) + buildup-only caption has no promise language

### B7 — Forks
- ☐ FK-01 Deflection (dodges the ask, changes subject) → deflection handling
- ☐ FK-02 love_framing ("you're the only one...") → pause-pitching, sits in
  the emotional beat, no CTA
- ☐ FK-03 Vending machine (sexual demand at $0, no investment) → frame-hold,
  zero violations, no pitch
- ☐ FK-04 Silence breaker (24h+ gap session) → correct re-entry register
- ☐ FK-05 Vulnerability drop (real-life pain share) → human beat, no pivot-to-
  sell on the same turn

### B8 — Posture journeys
- ☐ PJ-01 Clean WARM_BUILD→PROBE→PRESSURE→TW climb on a true timewaster
  (vending type, post-real-ask) — TW fires only after CTA attempt + guards
- ☐ PJ-02 Each TW guard blocks at its step (live confirmation of D5: pre-CTA,
  tip immunity, grace window, RLS freeze, sexting freeze, WB freeze)
- ☐ PJ-03 Spender-gap anti-exit: pay → 3h backdated gap → return → keeps
  climbing, NO goodbye (Finding #9 regression)
- ☐ PJ-04 Customer winds down himself after spending → warm close allowed
  (warmCloseForSpender carve-out)

### B9 — Register sweeps (per-creator voice)
- ☐ RG-01 No salesman talk anywhere (worth it/trust me/you'll love it) — all runs
- ☐ RG-02 No transaction commands during ppv_pending (open it/unlock) — miss-lock runs
- ☐ RG-03 No caretaker/permission-to-leave during pending PPV
- ☐ RG-04 No meta-sales narration (price talk in captions, "this pay")
- ☐ RG-05 Emoji variety per creator: no repeat within 2 msgs, persona-approved
  sets only, no signature emoji (watch Camila 😏, Jammy 😭ban→💀 substitution)
- ☐ RG-06 Length mirroring (short customer → short replies; long → fuller)
- ☐ RG-07 Time-of-day correctness (morning/night energy, creator clock vs
  customer clock when stated)
- ☐ RG-08 Spanish: Yendry replies accent-free ES per persona; English-only
  creator (Jammy) deflects ES request per rules
- ☐ RG-09 Per-creator voice integrity: Cindy + Sandra personas read distinct
  (first live exercise of both)

### B10 — Routes & infra
- ☐ RT-01 Mistral explicit route: api=mistral on an explicit-content gen —
  callMistral executes strategy, draft lands, cost logged (NEVER live-tested)
- ☐ RT-02 auto route: explicit content → Claude routes to Mistral by itself
- ☐ RT-03 ToS auto-retry: bait a banned word (e.g. customer pushes a meet-up /
  uses a banned term the draft might echo) → scanForBanned fires → retry →
  final draft clean (NEVER live-tested)
- ☐ RT-04 OCR import end-to-end: real screenshot → vision → preview → import
  with correct per-conversation dates (ASK FRANCESCO for screenshot at this cell)
- ☐ RT-05 Cost discipline: every scenario's msgs 2+ ≤ $0.10; strategy_sonnet
  large cR / ~0 cW; flag ANY cache-write spike immediately (cached-block
  mutation = bug); section totals in checkpoint reports
- ☐ RT-06 Server liveness monitor armed; generation failures distinguished
  from server death (harness-bug lesson from round 2)

### B11 — Dashboard / analytics / gating (after the runs, data-rich)
- ☐ DA-01 Accept/reject % math, beat counters reset on payment
- ☐ DA-02 PPV stats panel (unlock balance, per-session counts) matches what we ran
- ☐ DA-03 Spend-by-archetype + top-spenders widgets populate from mk_* data
- ☐ DA-04 Leaderboard + $/msg·Cache card sane (matches _ssaiCostLog)
- ☐ DA-05 Event audit: whale_builder, agent_override, tip_recorded,
  sexting_mode_toggled, tip_mode_toggled, spend_override rows all present with
  correct payloads for the scenarios that fired them
- ☐ DA-06 Role gating: chatter login sees NO manager widgets (API switcher,
  Settings, CSV, cost cards, dashboard filter) — needs a chatter test account
  or temporary role flip; manager sees all
- ☐ DA-07 Feedback queue: approve appends (not replaces) feedback_rules

### Protocol
1. Findings-first per scenario: verdict + evidence (draft text, chip states,
   _lastStrategy, cost row) logged in the run log before moving on.
2. Real bug → fix immediately (code-only), add harness regression assertion,
   re-run the cell, continue. Doctrine bugs → batch list for the single push.
3. Checkpoint to Francesco every ~10 cells: pass/fail table + cost readout.
4. mk_*/mock_* cleanup from Supabase at the end (events/messages/sessions/profiles).
5. Final report: every cell ✓/✗/⊘, bugs+fixes, harness count before/after
   (baseline this session: 90 → 113 so far), total spend, honest unverifiable list.

### Known-blocked / needs-Francesco
- ⊘ Cielo persona paste (I assemble the merged file at login; you paste in Models tab)
- ⊘ Remaining objection screenshots (OBJ-N4+)
- ⊘ OCR screenshot (RT-04, when we reach it)
- ⊘ Login at http://localhost:8000/SSAI.html to start Phase 1B
- ⊘ Chatter test account for DA-06 (or approve a temporary role flip of a test user)
