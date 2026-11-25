# Scripts — design

Date: 2026-11-25 · Status: draft, awaiting approval · Requirements v1 §1 ("Scripts usable from
the UI, holding media + pricing")

## Intent

Chatters run every fan through pre-written scripts in CreatorHero: an RLS script for new subs,
a Master Script that climbs from chit-chat through a free pic to six priced PPVs, and one short
script per objection. Requirements v1 §1 asks for the same in SSAI: scripts usable from the chat
UI, where each step can carry media and a price, so "the chatter picks the step and the content
and price come with it."

SSAI already has half of this. A **PPV set** (2026-11-08) is exactly one CreatorHero script
step with media and a price, and the composer already loads one with a click. What is missing
is the *script* around it: an ordered list of steps, steps that are only text or free media, and
a per-fan record of how far through each script the fan is.

Scripts are also the base for the next piece of work, §5a agent controls. Those buttons will ask
SSAI to write "the next step for this fan" instead of the fixed line, so the steps need to exist
first.

## What CreatorHero does (observed live 2026-11-25, Camila's account)

- **Settings → Scripts** lists *folders* (RLS Script, Master Script, OBJ Price, …). Each folder
  holds ordered *scripts* — one per step (MS 1.1 … MS 1.20). Drag handle to reorder, search,
  Create Folder, New Script, Import / Export, edit, delete.
- **A step's form:** Title (`MS 1.7 (PPV)` — "(FREE)" / "(PPV)" is naming only), Text, name
  labels `{Fan Name}` / `{Custom Name}` (each in Normal / UPPER / lower case) with a Fallback
  Name, Media (vault picker, ≤40 items), Price (shown only once media is selected), Folder.
- **In chat:** a Scripts button on the composer opens a panel listing folders with per-fan
  progress (`0/13`, `1/23` in amber once started). Opening a folder lists its steps (label,
  text, media count, ◉ preview). Clicking a step loads text + media + "Price to View" chip +
  a **Sent Marker** chip into the composer; the preview has `‹ 4/23 ›` paging and Use.
- **Sent Marker** ("Marks this script as sent for the selected fan") is what drives the
  progress count. Sending the step with the chip on moved Master Script from 0/23 to 1/23.
- Script texts contain chatter instructions in brackets: `[rizz him up e.g. construction …]`,
  `FREE PIC [ DECIDE YOURSELF ] DELETE TEXT`, `SET 2 MINUTES TIMER THEN SEND PPV [DELETE
  INSTRUCTIONS🚨]`. The chatter edits them out before sending.

## Goals

1. Managers build, per creator, ordered **scripts** of **steps**. A step is text, optional vault
   media (≤40), and a price that only applies when there is media.
2. Three kinds of step, derived from the data, never stored as a separate type:
   **Text** (no media), **Free** (media, price 0), **PPV** (media, price $3–$200).
3. A chatter picks a step from the chat and it loads into the composer exactly as a PPV set does
   today: text, media, price — one click.
4. Per fan, per script: which steps were sent, so the list shows `3/23` and highlights the next
   unsent step.
5. Name labels in step text are filled in with the fan's name when the step loads.
6. Existing PPV sets keep working and keep their send history.

## Non-goals (this slice)

- **AI writing the step.** Generate with a Text step loaded behaves as a normal reply, as if no
  step were loaded. "Write this step for this fan" is §5a.
- **AI picking the next step or the next PPV** (Requirements §2 Option A).
- **Importing CreatorHero scripts.** Their Export exists, but its file format and whether its
  media ids are OnlyFans vault ids are unknown. Separate slice once someone exports a file.
- **Per-item "Send as free preview"** inside a PPV (CreatorHero's tile menu; vendor `previews`
  param). Already a PPV-sets non-goal.
- Scheduled sends, countdowns, automations, mass messages.

## Anti-goals

- **Two libraries for the same thing.** A PPV must not exist both as a "PPV set" and as a
  script step. After this ships, PPV sets *are* steps.
- **Sending bracket instructions to a fan.** A text like `[rizz him up …]` reaching a fan is
  the most likely real-world failure of a script feature.
- **Losing the PPV send history** (`ppv_set_sends`) in the migration.
- Persisting fan message text. The new persistence is manager-written script text, step
  metadata and a ledger of ids/price/time.

## Constraints

- Everything in the PPV sets design still holds: vendor price 0 or $3–$200 (`App\Rules\PpvPrice`),
  ≤40 media per send, vault thumbs stored as the `local` marker or an onlyfans url
  (`durableThumb`), loading replaces the whole send payload with a confirm when the composer is
  dirty, `ppv` exclusive with `gif` / `attachment`.
- A non-empty `context` flips the engine into AGENT OVERRIDE. Step text must never be put in
  `context`.
- Generate with media loaded sends `sender: 'ppv'` (caption mode) and returns a price
  suggestion. That is only meaningful for a PPV.
- Access: reads for anyone assigned to the creator; writes `can:manage-team`. Models keyed by
  `creator_model` with `CreatorAccessScope`; the send ledger `BelongsToChatter`.
- Models use explicit `$fillable`.

## Approaches considered

1. **Grow PPV sets into script steps (chosen).** Rename `ppv_sets` → `script_steps` and
   `ppv_set_sends` → `script_step_sends`, add a `scripts` table, make media optional. The
   existing loader, strip, price chip, set modal, vault picker, thumb handling and ledger all
   carry over. Cost: a rename across controller, routes, types and tests, done while the
   feature is two weeks old and small.
2. **New scripts next to PPV sets.** Less churn now, but two libraries holding PPVs, two ledgers,
   two rail tabs, and chatters deciding which one a PPV lives in. Fails the first anti-goal.
3. **Keep the `ppv_sets` names and add a folder column.** Cheapest, but every future reader meets
   "a PPV set with no media and no price", which is a text step. Names that lie cost more later
   than the rename costs now.

## The design

### Data

**`scripts`** (new; `Script`, `CreatorAccessScope`):

| column | type | notes |
|---|---|---|
| id | pk | |
| creator_model | string | |
| name | string(120) | "Master Script", "OBJ Price" |
| sort_order | uint | manager ordering |
| created_by | fk users, nullOnDelete | provenance |
| timestamps | | |

**`script_steps`** (renamed from `ppv_sets`; `ScriptStep`, `CreatorAccessScope`):

| column | change | notes |
|---|---|---|
| script_id | **new**, fk scripts, cascadeOnDelete, required | |
| name → **title** | renamed | "MS 1.7 (PPV)" |
| caption → **text** | renamed | step text, may contain name labels; nullable (media-only step) |
| price | unchanged | must be 0 when `media` is empty |
| media | **now may be `[]`** | Text step |
| fallback_name | **new**, string(60) nullable | used when the fan has no name |
| sort_order | unchanged | order inside the script |

A step needs text or media (both empty → 422).

**`script_step_sends`** (renamed from `ppv_set_sends`; `ScriptStepSend`, `BelongsToChatter`):
`ppv_set_id` → `script_step_id`, and its foreign key changes from `cascadeOnDelete` to
**`nullOnDelete`** (deleting a step or a script never erases what SSAI sent; status ignores rows
whose step is gone). New `step_title` string(120): the step's title at send time, so a row stays
readable after the step is deleted or renamed. `of_message_id` and `price` become nullable; new
`source` enum `send|manual`. A `manual` row is a chatter saying "this fan already had this
step" (sent from CreatorHero, or before SSAI).

**Migration:** rename tables and columns in place, so ids — and so every ledger row — survive.
Create one script per creator that has sets, named **"PPV sets"**, and attach its sets to it in
their current order. No data is dropped.

### Name labels

Tokens in step text: `{Fan Name}`, `{FAN NAME}`, `{fan name}`, `{Custom Name}`, `{CUSTOM NAME}`,
`{custom name}` — the same six CreatorHero offers. Filled in **when the step loads into the
composer**, so the chatter sees and can edit the final text:

- Fan Name → the fan's real OnlyFans `name`, even when a custom name is set; Custom Name → the
  custom label (`displayName`, empty when unset). Two separate tokens, as in CreatorHero. Today
  the chat row's `name` is already the custom label (`displayNameOf`), so the chat list / fan
  payload must expose the real name and the custom name as separate fields.
- An auto-generated OnlyFans placeholder (`u` followed by digits, e.g. `u12345678`) counts as
  empty — nobody should receive "hey u12345678".
- Empty value → the step's `fallback_name`; no fallback → the token is removed and doubled
  spaces collapse.
- Case variants apply upper / lower case to the value.

Server-side storage keeps the tokens. One pure helper (`lib/scriptLabels.ts`) does the fill.

### Bracket guard

On Send, if the text contains a `[ … ]` span, Send asks: **"This message still contains
script notes in [brackets]. Send anyway?"** Cancel puts the cursor at the first bracket. Applies
to every send, not only scripts, since a pasted script line is the same risk. Cheap, and it
covers the second anti-goal.

### Per-fan progress

- Sending with a step loaded writes a `send` ledger row (today's behaviour for PPV sets, now for
  every kind of step). A Text step is sent as plain text with `scriptStepId`.
- **The step chip is the chatter's "this counts as the step" switch**, like CreatorHero's Sent
  Marker. It survives editing the text and Generate — a reworded step is still that step.
  Dismissing a suggestion doesn't touch it. **For a Text step, accepting an AI reply (Accept or
  Accept & Send) drops the chip**: Generate wrote a normal reply that ignores the step, so the
  fan never gets the step and nothing may be logged for it. This holds until §5a makes the AI
  write the step itself. A media step's caption IS its text, so accepting a caption keeps the
  strip. The chatter removes the chip
  (×) when what they send is no longer the step; then nothing is logged. A media step's chip is
  its strip, so removing the strip removes the media too, as today.
- A step row in the list has **Mark sent / Unmark** (anyone assigned). Mark writes a `manual`
  row; Unmark deletes **manual rows only** for that fan + step — real sends stay in history.
- A step counts as sent for a fan if it has any ledger row for that fan. Script progress =
  sent steps / total steps. **Next step** = the first unsent step in order.
- Bought (PPV steps only) is computed exactly as today: a ledger message id in the loaded thread
  with `isOpened`.
- Progress never resets on its own. CreatorHero's doesn't either, and a fan going through the
  Master Script twice is rare enough for Unmark to cover.

### Endpoints (under `onlyfans/{model}/…`)

Reads, anyone assigned:
- `GET scripts` → `{scripts: [{id, name, steps: StepDto[]}]}` — one call, ordered. StepDto =
  today's PPV set DTO + `scriptId`, `title`, `text`, `fallbackName`, `kind` (derived).
- `GET chats/{chat}/scripts/status` → `{status: {[stepId]: {sentAt, messageId, price, source}[]}}`.
- `POST chats/{chat}/scripts/steps/{step}/mark` · `DELETE …/mark` — manual marks.

Writes, `can:manage-team`: `POST|PUT|DELETE scripts[/{script}]`, `PUT scripts/order`,
`POST scripts/{script}/steps`, `PUT|DELETE scripts/steps/{step}`, `PUT scripts/{script}/steps/order`.
Static segments (`order`, `steps`) registered above `{script}` wildcards.

Changed: `send` takes `scriptStepId` (was `ppvSetId`; resolved against this creator). The old
`ppv-sets*` routes are removed — the client changes in the same release.

### Chat UI

> **Revised 2026-11-26 (layout).** The first build put scripts — using AND managing — in the
> right rail's PPV tab. That is not how CreatorHero works, and the team expects its layout (see
> the observations above and the user's screenshots of 2026-11-26). The layout is now three
> parts. Data, endpoints, composer behaviour, labels, guard and progress are unchanged.

**1. Scripts button + panel, in the composer (where chatters USE scripts).**
- A **Scripts** button at the top-right of the message box (CreatorHero's spot, beside the
  emoji row). It toggles a panel that opens **above the message box**, full composer width,
  over the bottom of the thread (CreatorHero's panel; a sheet, not a modal).
- Level 1: the creator's scripts in order, each with the open fan's progress (`0/13`;
  accent once started, green when done).
- Level 2 (click a script): back arrow + script name, then its steps in order. Each row: title,
  one-line text, kind badge (**Free 📷3** · **PPV $12 📷4 🎞2**; text steps no badge), status
  (**Sent** / **Bought**), the **Next** step marked, and a ◉ **preview** button. Preview opens
  the step in the panel (text, media tiles, price, `‹ 4/23 ›` paging) with **Use**.
- Clicking a step row (or Use) loads it into the composer — same rules and confirm as before —
  and closes the panel.
- Row ⋯ → **Mark sent / Unmark** (anyone assigned). No create/edit/delete here.
- Esc / click outside / the button again closes it. Keyboard: arrows move, Enter loads.

**2. Right rail → PPV tab = PPVs sent to this fan (CreatorHero's PPV tab).**
- One card per locked/priced message the creator sent in the loaded thread, newest first:
  first thumb, price, **Bought** / **Not bought** (`isOpened`), photo/video counts, relative
  time, two lines of caption. Built from the loaded messages, so PPVs sent from CreatorHero or
  OnlyFans show too (the old ledger-only view could not). Mass PPVs keep their `· Mass` label.
- Clicking a card scrolls the thread to that message.
- Empty: "No PPVs sent to this fan yet." Scope note: only what is in the loaded page (~100
  messages), like everything else in the thread.
- The Scripts tab is removed from the rail; the rail is Fan · AI Intel · PPV again, and the
  "no auto-switch to AI Intel" exception goes with it (a reply Generate switches to AI Intel
  as before).

**Composer.** `ComposerState.ppv` generalises to `step`:
`{stepId, title, price, media}`; `media` may be empty.
- Media step → today's strip: tiles, price chip (Free when 0), Generate reads "Generate
  caption", Send reads "Send PPV $12" / "Send free media".
- Text step → no strip; a small chip **Script · MS 1.1 ×** above the input so the send is
  logged. Removing the chip keeps the text and stops the logging.
- Loading fills labels, then sets `draft`.

**Generate with a step loaded.** PPV step → caption mode exactly as today (caption + price
suggestion + not-ready warning). Free step → caption mode, but the price suggestion is
discarded (it's free). Text step → a normal reply that ignores the step; the reply lands in
the suggestion card as usual and the step text stays in the typing bar until the chatter
accepts. §5a changes this.

**Step editor** (the PPV set modal, generalised): Title, Text with a row of label buttons that
insert tokens at the cursor, Fallback name, Media (optional, the existing vault picker),
Price (shown only with media), Script (select). Validation mirrors the server.

### Where scripts are managed (revised 2026-11-26)

**3. A Scripts page** — managers/admins only (`can:manage-team`), like CreatorHero's
Settings → Scripts, and Requirements v1 §7 ("Scripts — most important" creator setting).
- Sidebar item **Scripts** with the creator dropdown (the `dynamic:'creators'` pattern Media
  Vault and Conversations use); route `/scripts`, `SmartStarsLayout`, the app-wide creator
  context picks the creator.
- A wide list: scripts as expandable folders (name, step count), steps inside (title, kind
  badge, one-line text, media count, price). Search (title + text), **New script**, **New
  step**, rename, delete (confirm with step count; history kept), drag to reorder scripts and
  steps (↑/↓ buttons as keyboard fallback).
- Edit/New step opens the existing step editor (`SsScriptStepModal`), unchanged.
- Uses the existing `onlyfans/{model}/scripts…` endpoints; no server changes except the page
  route + controller shell (like `MediaVaultController@index`).
- Chatters don't see the sidebar item, and the route 403s for them.

**Import from CreatorHero (added 2026-11-26).** CreatorHero's Scripts → Export gives a CSV:
`Name, Category, Script Order, Message, Fallback, Price, Created At` (Camila's: 120 rows, 12
categories — RLS Script (Invested New Subs) 13, Master Script 23, 7 × OBJ, RLS Script 12,
PRE RLS CS 4, RLS CRAZY STORY 37). Facts that shape the import:
- **No media column.** The export carries text and price only, so every step comes in without
  its photos/videos.
- Category → script (names trimmed; CreatorHero has trailing spaces like `"Master Script "`);
  Name → title (trimmed); Message → text; Fallback → fallback name; steps ordered by
  `Script Order` within each category.
- Master Script prices are the ladder: **$12, $21, $35, $49, $69, $100** — the "last rung
  bought → next price" data §5c and Requirements §2 Option A will use.
- The page gets **Import CSV** (managers): upload → preview ("12 scripts, 120 steps; 6 need
  media") → Import. Scripts whose name already exists for the creator are skipped, not merged
  (re-importing must not duplicate). Server-side parse; the file is not stored.
- **Steps that need media:** a step whose title says `(PPV)` / `(FREE)` / `FREE PIC`, or whose
  price > 0, imports as **Needs media** — price kept, media empty — shown with a warning badge
  and **not loadable** in the chat until a manager attaches media in the step editor. This is
  the one place a price may sit on a step without media; the send-side rule ("a price needs
  media") is unchanged.

## Testing

- Migration: existing sets and sends survive with the same ids; a "PPV sets" script per creator.
- Feature tests per endpoint: access scope, manage-team gate, 422s (no text and no media; price
  with no media; price off the vendor rule; step from another creator), route order.
- Send: `scriptStepId` writes a `send` row for Text, Free and PPV steps; a ledger failure never
  fails the send.
- Marks: manual mark / unmark; unmark never deletes a `send` row.
- Deleting a step or script keeps its ledger rows (step id nulled, `step_title` kept).
- Label fill: real name vs custom name, a `u12345678` placeholder falls back.
- Client checks (node, like `ppv-composer-check.mjs`): label fill (each token, case, fallback,
  no fallback), bracket detection, progress + next-step from a status map.

## Left to the builder

Exact component split, the drag library (or plain up/down buttons if drag is costly), DTO field
names beyond those named here, empty-state copy, and how the rail renders 100+ steps (virtual
list or plain).

## Open questions

1. **Manual marks:** may chatters mark steps sent (proposed: yes), or managers only?
2. **CreatorHero import:** worth a slice soon? Someone would need to click Export there so we
   can see the file.
