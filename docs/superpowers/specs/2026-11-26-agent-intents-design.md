# Agent intents (Requirements v1 §5a + the §5c counters it needs) — design

Date: 2026-11-26 · Status: draft for review · Source: `SSAI – Requirements v1` §5 (5a table, 5c
table, "Rules worth repeating"), §0 priority #2.

## 1. Intent and why

Chatters need to **take control when SSAI is looping or misreading the chat** (§5 purpose). Today
the only lever is typing an instruction into the override box, which is slow and depends on the
chatter knowing the right words. 5a gives them a row of **intent buttons**: each one says what the
next message is (Re-pitch, Objection → Price, Goodbye 2, …). One click and SSAI writes that kind of
message for this fan.

Decided with the user (2026-11-26): **option (a)**. A click writes the draft right away, and SSAI
**must follow** the button for that one message. The doc's own wording backs this: "take control",
"manual **fire**", the PPV button "greys out" (a lock only matters if a click acts), and 5b switches
are the "auto, override" layer while 5a buttons are "manual".

## 2. Goals, non-goals, anti-goals

**Goals**
- An intent bar on the composer. One click writes a draft that follows the intent. Some intents
  have an option: CTA 1/2, objection type, Goodbye 1/2/3, Promise step.
- The §5c chat counters (msgs this chat, msgs since last PPV, msgs since unpaid PPV) driving the
  doc's lock rules on **PPV** and **Re-pitch**.
- The MPPV tag: automatic chat_ppv / mppv, plus a per-message manual override including
  free_preview, applied both to what SSAI sees and to the counters.
- Every intent grounded in rules the playbook (legacy doctrine) already has, so SSAI writes it
  the team's way.

**Non-goals (this design)**
- 5b state switches (Phase, RLS beat, lane, …) and §6 "Warm up". These come next, as their own design.
- The 5c counters "last rung bought", "objection redirects" and "sex-only pulls". They depend on
  5b's lane and on the price ladder (Option A), and come with 5b.
- Option A (SSAI picks the PPV content and price by itself).
- A "12–48h spent" fan **list** view. Follow-up here is the in-chat button only.
- Sending voice notes.

**Anti-goals**
- **A button that SSAI quietly ignores.** That is the problem 5a exists to fix.
- **Anything sent without the chatter.** A click writes a draft only; the chatter still Accepts or Sends.
- **Breaking engine parity.** `legacy/js/*` stays untouched, and a generate with no intent reaches the AI
  byte-identical to today.
- **Sticky intents.** The intent applies to one message. The next plain Generate is SSAI's own pacing again.

## 3. Approaches considered

1. **Directive through legacy's AGENT OVERRIDE channel (chosen).** The click sends an `intent` key.
   The server turns it into a fixed, playbook-worded directive and passes it as the generate
   `context`, joined with anything the chatter typed. Legacy built this channel for exactly
   "pitch 3rd PPV / ask for a tip / go to aftercare". It is authoritative for **one turn**, the
   brain marks `agent_override_active`, and it still yields to HARD RULES, TOS bans and CRM Hard NOs
   (`app.js` ~6041, ~6174). No engine or legacy change is needed, and it obeys by design.
   **Cost:** for that turn it also beats the TW lockout, the ppv_missed lockout and the persuasion
   cap. That is what a manual "take control" button should do, and the PPV lock rules keep pacing
   on the button side.
2. **An engine wrapper note (like `engine/followUp.js`) with no override.** This keeps legacy's
   locks live, but it is a hint. Legacy's strategy validators would push back: a wall or an
   aftercare block would win over it. That gives option (b) behaviour, which the user rejected.
3. **Forcing strategy fields after the strategy pass.** This is brittle, because it fights legacy's
   own Pass B/C enforcement. It also needs engine surgery per intent.

**Exception: Aftersale uses legacy's aftercare mode, not a directive.** Legacy has a manual
Aftercare toggle (`_aftercareMode` + `_aftercareContext` aftersex | ladder_stop) that injects a fixed
Percival template and hard-blocks pitching (`app.js` ~6630). It was never wired into the rewrite.
An override would actually *skip* that template (`!agentOverrideActive`), so Aftersale sends
aftercare mode for that turn **and no directive**.

## 4. The intent catalogue

One server-side catalogue (`App\Support\AgentIntents`) holds, per intent and option, the label and the
directive text. The client gets only keys and labels, so the wording has one home and is unit-tested.
Directives cite the playbook part they run ("Run the Goodbye Framework Phase 2 — PART 12"), so the
brain uses its own reference examples rather than our paraphrase.

Directive format (identical framing for all):
`INTENT BUTTON — {Label}: {instruction}`, followed by a blank line and the chatter's typed text
when there is any. The typed text is more specific, so the directive tells the brain to apply it
inside the intent.

| Key | Button | Options | What the directive asks for (playbook source) | Slice |
|---|---|---|---|---|
| `ppv` | PPV | – | See §6: opens the PPV path. No directive of its own; caption mode does the work | 1 |
| `repitch` | Re-pitch | – | Get him to open the locked PPV already in the chat, **same price $X**, no new content, no discount, no number in the text. $X and "N msgs ago" come from the thread (Wall/CTA 2 doctrine) | 1 |
| `reoffer_mppv` | Re-offer MPPV | – | He never bought the mass message "<its text, ≤140 chars>" at $X. Offer that content to him personally as his first rung, framed as just for him. The chatter attaches the content (§6) | 1 |
| `cta` | CTA | CTA 1 · CTA 2 | Run CTA #1 / CTA #2 (PART "Step" skeleton) | 2 |
| `objection` | Objection ▾ | the playbook's 11 types (§4.1) | Run the solve script for this objection (PART 11, `wall_subtype`) | 2 |
| `sexting` | Sexting | – | A warm-up sexting beat: build the scene with her in it, hand the move back to him with a question (PART 23). See the open questions on "hand-it-back" | 2 |
| `promise` | Promise ▾ | Ask (RLS beat 11) · Reinforce ×1 · Reinforce ×2 | The promise ritual opener / the reinforcement beat (doctrine ~312). "Beat 11" is the PROMISE step of the team's 12-step RLS Script (`RLS 1.8`) | 2 |
| `post_purchase` | Post-purchase | – | He just unlocked; text first: reaction plus a deepening question, no new pitch this message | 2 |
| `post_tip` | Post-tip | – | Appreciation plus a question about him, no content, no pitch (tip doctrine) | 2 |
| `tip_ask` | Tip ask | – | A vague tip ask, **never a number** (TIP-ASKING DOCTRINE) | 2 |
| `free_picture` | FreePicture | – | See §6: caption for a free vault pic the chatter picks (caption mode, price 0) | 2 |
| `breadcrumb` | Breadcrumb | – | Shift from chit-chat toward a CTA: drop a scene cue tied to something he said (BREADCRUMB doctrine) | 2 |
| `hook` | Hook | – | An eye-catching first message to a new subscriber (Warm Welcome) | 2 (manual); auto in 3 |
| `chitchat` | ChitChat | – | A rapport beat: flirt on what he gave, no selling this message | 2 |
| `follow_up` | Follow-up | – | Re-engage a fan who went cold after spending: callback to the last thing he shared, one message, no chase | 2 |
| `aftersale` | Aftersale ▾ | After sexting · After a no | **Aftercare mode** for this turn (`_aftercareContext` aftersex / ladder_stop), no directive | 2 |
| `goodbye` | Goodbye ▾ | Phase 1 · 2 · 3 | Run Goodbye Framework phase N (PART 12; 4-message cap stays legacy's) | 2 |
| `vn_cue` | VN cue ▾ | show-you · promise · judge-me | Waiting on the team (§10) | 3 |

### 4.1 Objection types

These come from the playbook's PART 11 and its `wall_subtype` list:
- Only want naked
- Is it worth it / what's inside
- You lied / expected more
- Only want [body part] / menu
- Other girls cheaper
- Too expensive / discount
- Something for free
- Bad experiences
- Send a preview
- Later / not now
- Didn't like it

That is 11. The team's CreatorHero account has 7 OBJ scripts, and all of them map onto these.
The doc says 12, so the 12th is an open question (§10). Adding it later means one catalogue line.

## 5. Counters (§5c, first three) and lock rules

Computed **client-side** from the loaded thread by a pure `lib/chatCounters.ts`, like
`lib/sentPpvs.ts`. No extra OnlyFans call. The page holds the newest 100 messages. Every
threshold is ≤ 12, and "older messages exist" (`hasMore`) means the chat already has 100+, so
the loaded page decides the count rules correctly. One limit applies to a very old unpaid PPV
(see §9a).

What counts as a **message** (my call; the team can correct it, §10): any message from either side,
**excluding**:
- mass messages the fan did not buy (effective tag `mppv`, unopened);
- optimistic, pending and failed bubbles.

Tips count.

| Counter | Definition |
|---|---|
| `total` | Messages in the chat. `hasMore` → treat as ≥ 100 |
| `sinceLastPpv` | Messages after the newest **chat PPV** (effective tag `chat_ppv`, bought or not). None → no limit |
| `unpaidPpv` | The newest chat PPV the fan has **not opened**, if it is also newer than his last opened one: `{price, since}`, else null |
| `returning` | The loaded thread has a message older than the current conversation (gap > `session_gap_hours`, the same rule as rejections and session spend), or `hasMore` |

Lock rules, exactly as the doc states them:
- **PPV** is greyed out when `total < (returning ? 10 : 12)` **or** `sinceLastPpv < 6`. The
  tooltip says why, e.g. "8 of 12 messages" or "4 of 6 since the last PPV".
- **Re-pitch** is enabled only when `unpaidPpv` exists and `unpaidPpv.since >= 5`. It is lit
  (accent) at that point; otherwise it is greyed out with "No unpaid PPV" or "3 of 5 messages
  since the unpaid PPV".
- **Re-offer MPPV** is enabled only when the thread has an unbought mass PPV. It is never auto,
  never lit.

The locks apply to the **buttons**. Loading a PPV step by hand from the Scripts panel stays allowed:
that is the chatter's explicit choice, and the doc only locks the button.

The counters show as one quiet line in the intent bar (`23 msgs · 7 since PPV · unpaid $21 · 5 ago`),
which is the 5c "counter" surface.

## 6. Intents that involve media

- **PPV.**
  - With a media step already loaded, the click is the existing caption Generate (`sender:'ppv'`).
  - With nothing loaded, the click opens the Scripts panel, focused on the folder holding the
    current **Next** PPV step. Once the chatter picks a step, Generate runs automatically. This
    replaces the two clicks with one flow.
  - The step brings its own price. The existing AI price suggestion still shows.
- **FreePicture.** Opens the existing vault picker (photos only). The chosen media load as an
  **ad-hoc free media payload**: same strip, price 0, no `scriptStepId`. Then caption mode
  generates. NB the plan must check whether `ComposerStep` can be ad-hoc or needs a sibling field.
- **Re-pitch** never attaches media. The locked PPV is already in the chat; the message pushes him to open it.
- **Re-offer MPPV** writes the text. The chatter then attaches the content: a vault pick or a
  script step, priced by them. There is no way to map a mass message's media to vault ids,
  which is a known API limit (CLAUDE.md, DRM/vault notes).
- **While a media step or ad-hoc media is loaded, every non-media intent is disabled.** Tooltip:
  "Remove the loaded PPV first". A reply accepted over a media strip would otherwise be sent as
  its caption.

## 7. MPPV tag

- **Auto:** a creator message with price > 0 is `mppv` when `fromQueue`, else `chat_ppv`. Nothing else is auto-tagged.
- **Manual override per locked message:** a small tag chip on each priced creator bubble (`Chat
  PPV ▾` / `Mass ▾` / `Free preview ▾`), with "Auto" to clear. This is stored in
  **`aich_message_tags`**:
  - columns: `creator_model`, `chat_id`, `message_id`, `tag`, `user_id`;
  - `BelongsToChatter`;
  - unique on (creator_model, chat_id, message_id);
  - metadata only, no text.

  Routes:
  - `PUT|DELETE onlyfans/{model}/chats/{chat}/messages/{message}/tag`, for anyone assigned;
  - `GET …/chats/{chat}/tags`, loaded with the thread.

  The tag is shared, so every chatter on the fan sees the same tag.
- **Effect on SSAI.** The client sends each message's `id`, and the server loads the chat's tags
  and applies them in `LiveThreadMapper`:
  - `mppv` → treated as `fromQueue` (dropped while unbought, as today);
  - `chat_ppv` → treated as not `fromQueue`, even if OnlyFans says it is;
  - `free_preview` → never a `ppv` bubble (not a pitch, not spend).

  The tags are looked up server-side, so every chatter's generate uses the same stored tags (see §9a,
  Trust boundary).
  The counters use the same effective tag (`lib/chatCounters.ts` mirrors the mapper rule; keep
  the two in step, same as `draftRejections`).
- `free_preview` is manual-only (my call): the API has no field that reliably marks a teaser
  versus a pitch.

## 8. Where it lives in the UI

- **The intent bar** is a single row directly above the composer's typing bar, inside `SsComposer`:
  - visible chips: PPV, Re-pitch, CTA ▾, Objection ▾, ChitChat, Sexting, Tip ask, Goodbye ▾;
  - a **More ▾** menu with the rest;
  - the counters line on the right.

  The chips are compact, the Scripts button stays where it is, and the bar is keyboard reachable.
  Exact styling goes to the impeccable pass.
- **Click** = Generate with that intent. The chip shows a spinner while generating, and the
  other chips and Generate are disabled meanwhile.
  - A dropdown intent fires on choosing the option.
  - The typed override text (`ComposerState.context`) is sent with it and is **not** cleared.
- **The draft card** shows an "Intent: Re-pitch" label. **Regenerate** and **Reject & regenerate**
  keep the same intent. **Dismiss**, **Accept** and a send clear it.
- A new **`ComposerState.intent`** (`{key, option} | null`) records what the pending suggestion
  was generated for.
  - Loading a step clears it.
  - `generationStillApplies` also compares it, so a reply generated for another intent that lands late is dropped.
- **Text step loaded + intent click:** same as today's Generate over a Text step. Accepting the
  draft drops the Text step chip (`stepAfterAccept`).
- **Rail:** an intent generate updates AI Intel and the auto-switch like a normal generate
  (legacy persisted override turns normally). Caption-mode intents (PPV, FreePicture) keep caption
  mode's existing skips.

## 9. Server and engine changes

- **`generate` validation:**
  - `intent` is `nullable|in:<catalogue keys>`;
  - `intentOption` is checked against that intent's options;
  - `messages.*.id` is added (load-bearing, same trap as `time` and `fromQueue`).
- **`OnlyFansChatController::generate`:**
  - `context = AgentIntents::directive(key, option, thread) . typed context`;
  - for `aftersale`, pass `aftercare: {mode: true, context}` instead;
  - `ppv` and `free_picture` are client-side flows ending in caption mode, so the server rejects
    them as an `intent` value with 422.
- **`AgentIntents::directive`** fills thread facts for `repitch` (price, msgs since) and
  `reoffer_mppv` (text, price) from the **mapped** thread. It needs the unbought mass PPV, which the
  mapper drops, so the mapper also returns that item to the caller (not to the engine).
- **`EngineClient`** maps `aftercare` to the session's `_aftercareMode` / `_aftercareContext`. If
  absent, nothing is sent, so the payload is byte-identical to today.
- **Engine:** no logic change. New guard `node engine/intent_check.js` proves two things:
  - a directive in `context` reaches both the strategy and generator prompts inside the AGENT
    OVERRIDE block;
  - `_aftercareMode` injects the Percival template and the HARD BLOCK.
- **Tests:**
  - Pest: catalogue keys and options, controller composition, the aftercare pass-through, tag CRUD
    and scoping, mapper tag application;
  - `tests/client/intents-check.mjs`: counters, lock rules, effective tags.

## 9a. Edge rules (settled after the builder check; marked as my calls)

- **"Must follow" is best-effort via the prompt, not a post-check.** That is how legacy's override
  works, and a post-check-and-retry would double the cost of a 30–45 s generate.
  - Acceptance bar: `intent_check.js` passes, plus a real-LLM spot run of 3 drafts per slice-1
    intent and 2 per slice-2 intent on a fixture thread. Every draft must read as the intent.
  - Results are recorded in the plan's ledger. An intent that fails gets its directive reworded,
    not a code-side check.
- **Aftersale with typed override text.** Aftersale sends aftercare mode and **does not send the
  typed text** for that turn, because any `context` makes legacy skip the template. The draft card
  says "Your note wasn't used for Aftersale". The text stays in the box.
- **The follow-up note.** When the creator spoke last, `engine/followUp.js` already switches to its
  "override box set" variant whenever `context` is non-empty. That variant carries facts only and
  says the directive picks the move (`runGenerate.js` ~68). So "push him to open the PPV" does
  not fight "pick a different topic". No engine change.
- **Chat state after an intent turn.** An intent generate runs the normal `applyAnalysis` and
  shows in AI Intel. On Accept/Send it commits state like any reply, because the forced move
  really was sent (a Goodbye *is* now the plan), and legacy persisted override turns the same way.
  Only the caption-mode intents keep caption mode's skips.
- **The `free_preview` tag** drops only the **pitch** signal: the message is never a `ppv` bubble,
  never a counter PPV, and never Re-pitch's "unpaid PPV". If the fan **opened** a priced message,
  that money still counts as spend. The tag can be set on any priced creator message.
- **Text step + intent click.** The step stays loaded while generating (exactly like today's
  Generate). Accepting the draft drops the Text step chip (`stepAfterAccept`). `intent` is cleared by
  a step load, the same as the pending draft. `generationStillApplies` compares `stepLoads` **and**
  `intent`.
- **Which folder the PPV click opens:**
  1. the last folder the chatter opened (`rememberOpenScript`), if it has an unsent PPV step;
  2. otherwise the first folder in manager order that has one;
  3. otherwise the folder list.

  The **Next** PPV step in that folder is pre-selected in the preview.
- **Ids through the mapper.** `LiveThreadMapper` carries each message's `id` through the filter,
  the sort and the `ppv` rewrite. It applies tags by id **before** the mass-PPV filter. It returns
  the dropped unbought mass PPVs separately (`droppedMass`) for `AgentIntents`. The engine payload
  itself gains no new keys.
- **Trust boundary.** The client still supplies the thread, so the server-side tag lookup only
  guarantees that the **stored tags** are the shared ones, not that the thread is genuine. That
  matches every other generate input today.
- **Known limit: a PPV beyond the loaded 100 messages.** If the newest chat PPV is older than the
  loaded page, `sinceLastPpv` reads "no limit" (correct, since it is ≥ 100). But an unpaid PPV that far
  back reads "No unpaid PPV", so Re-pitch stays off. This is accepted: after 100+ messages a re-pitch
  of it is not the doc's "5 messages since" case.

## 10. Open questions for the team

Building does not wait on these. Each one has a default in brackets.

1. **What is "msgs" in the 12/10/6/5 rules?** Both sides, or fan messages only? [both sides,
   excluding unbought mass messages]
2. **What makes a fan "returning" for the 10-message rule?** [an earlier conversation exists]
3. **The 12th objection type.** [11 from the playbook]
4. **"Sex-only promise" on the Promise button.** [not shown until defined; likely tied to the 5b sex-only lane]
5. **"Hand-it-back style" sexting.** [read as: end the sexting beat by handing the next move back
   to him with a question]
6. **VN cue, show-you / promise / judge-me.** Is the output a short script the chatter records?
   [button hidden until answered]

## 11. Slices (build order)

1. **Counters + PPV / Re-pitch / Re-offer MPPV + MPPV tag override.** These are the doc's "rules worth repeating".
2. **The playbook buttons:**
   - CTA, Objection, Sexting, Promise (Ask / Reinforce), Post-purchase, Post-tip;
   - Tip ask, FreePicture, Breadcrumb, Hook (manual), ChitChat, Follow-up;
   - Aftersale (aftercare mode), Goodbye.
3. **Auto hints and the rest:**
   - glow for Post-purchase (he opened a PPV after the creator's last message), Post-tip (his
     newest message is a tip) and Aftersale;
   - Hook auto on a new subscriber (needs the `subscriptions.new` webhook);
   - VN cue, sex-only promise and the 12th objection once the team answers.

## 12. Left to the builder

- Chip styling, the counters line format, and keyboard shortcuts.
- Whether FreePicture's ad-hoc media reuses `ComposerStep` with a null `stepId` or a sibling field.
- The exact directive wording per intent, inside the constraints above: cite the playbook part,
  one message, and the intent's must and must-not lines.
