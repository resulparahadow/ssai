# PPV Sets — design

Date: 2026-11-08 · Status: approved for planning · Requirements v1 priority #1 ("SSAI must generate the PPV, not describe it")

## Intent

Chatters today sell PPVs from CreatorHero. Its chat view has a right-rail **PPV** tab: a
creator-wide list of saved PPV sets (vault media + price + caption). Clicking a card copies the
set into the message box — media tiles, a "Price to View: $20" chip and the caption — and the
chatter hits Send. The caption is the same stale text for every fan.

SSAI gets the same flow, with one difference that is the whole point: once a set is loaded,
**Generate writes the caption for this fan** from the live thread, in persona voice, using the
engine's existing PPV caption mode. The chatter keeps the set's price, edits if they like, and
sends a locked PPV through the OnlyFans proxy.

This is the first slice of the PPV flow. The team chose **caption only** for now. SSAI does not
pick the set and does not suggest the price yet.

## Goals

1. A chatter can send a real PPV (vault media + price + text) from Conversations.
2. A creator-wide library of PPV sets, managed by managers/admins, visible to every chatter on
   that creator.
3. One click loads a set into the composer; Generate then writes a fan-specific caption.
4. Each card shows, for the fan currently open, whether SSAI already sent this set to them and
   whether they bought it.

## Non-goals (this slice)

- AI choosing which set to send, or suggesting a price. Next slice.
- `previews` / `lockedText` options on the vendor send call.
- Mass-message PPVs.
- Detecting sets sent from CreatorHero or OnlyFans directly (see "Sent/Bought status").
- Per-fan "already seen this media" labels across arbitrary media (vault ids and chat media
  ids are not mappable — see CLAUDE.md, DRM notes).
- Auto follow-up on unbought PPVs.

## Anti-goals

- Sending a PPV with the wrong price or the wrong media because of stale composer state.
  Loading a set must replace the whole send payload (text, media, price, GIF) atomically, with a
  confirm when the composer is not empty.
- Letting a chatter edit or delete sets. Managers own the library.
- Persisting fan message text. The only new persistence is set metadata and a send ledger of
  ids/price/time.

## Constraints

- Vendor send endpoint `POST {acct}/chats/{chat}/messages` accepts `text`, `mediaFiles`
  (vault ids), `price`. Price must be **0 or between $3 and $200** (verified live 2026-11-07).
- Vault thumbnails are `cdn.fansapi.com` presigned urls that expire in **15 minutes**; onlyfans
  CDN urls must go through the media proxy. Never persist a thumbnail url as the source of truth.
- The engine's PPV caption mode is `sender: 'ppv'` (legacy `currentSender==='ppv'` → "PPV
  CAPTION MODE — OVERRIDES EVERYTHING ELSE", one curiosity line, no price). `runGenerate.js`
  already skips the follow-up wrapper for it. `EngineClient::generateFromLive` already forwards
  `sender`; the chat controller does not yet accept it.
- `OnlyFansChatController::send` currently validates `mediaFiles` `max:1` and rejects any
  `price > 0` via `ppvBlocked()`. Both are v1 guards to be lifted here.
- Laravel `validate()` strips unlisted nested keys. Every new field on the generate/send payload
  needs a rule.
- Access: chatters see only assigned creators (`account()` scope in the chat controller;
  `CreatorAccessScope` on models keyed by `creator_model`).

## The design

### Data

**`ppv_sets`** (new table, Eloquent `PpvSet`, `CreatorAccessScope` on `creator_model`,
explicit `$fillable`):

| column | type | notes |
|---|---|---|
| id | bigint pk | |
| creator_model | string | `aich_models.name`, like every other conversation table |
| name | string(120) | shown on the card and as the "set" label in the composer |
| caption | text, nullable | default text loaded into the typing bar |
| price | decimal(6,2) | 0 or 3.00–200.00 |
| media | json | ordered list of `{id, type: 'photo'\|'video'\|'gif'\|'audio', thumb: string\|null}` — vault id, type, and an onlyfans-hosted thumb url or null (see Thumbs) |
| sort_order | int | manager ordering in the rail; default = append |
| created_by | fk users, nullOnDelete | provenance only |
| timestamps | | |

**`ppv_set_sends`** (new table, `PpvSetSend`, `BelongsToChatter` since it carries
`creator_model` + `user_id`):

| column | type | notes |
|---|---|---|
| id | bigint pk | |
| ppv_set_id | fk ppv_sets, cascadeOnDelete | |
| creator_model | string | |
| of_fan_id | string | = chat id |
| of_message_id | string, nullable | the sent message's id from the vendor response |
| price | decimal(6,2) | price actually sent |
| user_id | fk users, nullable, nullOnDelete | the chatter who sent it (auto-stamped) |
| sent_at | timestamp | |

No message text anywhere.

### Endpoints (all under `onlyfans/{model}/…`, same controller family)

Read, any assigned user:

- `GET ppv-sets` → `{sets: PpvSetDto[]}`; ordered by `sort_order`, then `id`.
- `GET chats/{chat}/ppv-sets/status` → `{status: {[setId]: {sentAt, messageId, price}[]}}`
  from `ppv_set_sends` for this creator + fan. Small, one query.

Write, `can:manage-team`:

- `POST ppv-sets` `{name, caption?, price, media: [{id,type}]}` (1–40 media).
- `PUT ppv-sets/{set}` same body, all optional.
- `DELETE ppv-sets/{set}`.
- `PUT ppv-sets/order` `{ids: []}`. Optional; builder may defer if the rail's drag ordering is
  not cheap. Without it, sets sort by creation.

JSON 422s via the existing `validateJson` pattern (these routes are not under `api/*`).

Changed:

- `POST chats/{chat}/messages` (send): `mediaFiles` max **40**, `price` `nullable|numeric` with
  a custom rule: `0` or `3 ≤ price ≤ 200`, two decimals. `ppvBlocked()` is removed.
  `OnlyFansService::sendMedia` gains an optional `price` and sends it only when `> 0`.
  New optional `ppvSetId` (integer, must belong to this creator): on a 2xx the controller writes
  a `ppv_set_sends` row with the returned message id. A ledger insert failure must not fail the
  send (log, continue). The `fromQueue` / `price` fields on the normalized response already
  render the amber "$20 · Unpaid" pill.
- `POST chats/{chat}/generate`: new `'sender' => 'nullable|in:customer,ppv'`, forwarded to
  `generateFromLive` as `$opts['sender']`. Nothing else changes server-side; the engine does the
  rest. Usage events should record `call_type` as the engine reports it (unchanged).

### Composer state

`ComposerState` gains:

```ts
ppv: {
    setId: number;
    setName: string;
    price: number;                 // editable, validated 0 | 3..200
    media: { id: string; type: ...; thumb: string | null }[]; // thumb = stored onlyfans url or null
} | null;
```

Rules:

- `ppv` is exclusive with `gif` and `attachment`. Loading a set clears both. Attaching a GIF
  or file while a set is loaded clears `ppv` (with the same confirm).
- Loading a set when `draft`, `suggestion`, `gif`, `attachment` or `ppv` is non-empty asks
  "Replace current message? This replaces your text, media and price with the set." Cancel
  keeps everything.
- Loading sets `draft = set.caption ?? ''`, `suggestion = null`, `ppv = {...}`.
- Send with `ppv` set posts `{text, mediaFiles: ppv.media ids, price: ppv.price, ppvSetId}`.
  Text may be empty (media-only PPV is valid). Price `0` sends as free media — allowed, but the
  chip shows "Free" in warn color so it is deliberate.
- Generate with `ppv` set posts `sender: 'ppv'`. `context` carries ONLY the chatter's own
  override text, exactly as today. The set name is NOT injected: in legacy a non-empty context
  box switches the brain into AGENT OVERRIDE mode (wall/TW/ppv_missed guards deferred for the
  turn), so a synthetic sentence there would pause the safeguards on every caption. Zero drift
  from legacy's PPV click. Passing the set name to the generator only is a later engine-wrapper
  change with its own parity check, not this slice.
  The resulting suggestion lands in the normal suggestion card; Accept puts it in the typing
  bar, Accept & Send sends the PPV with it.
- A caption generate is a different task from a reply, so it must not overwrite shared state:
  for `sender === 'ppv'` the controller skips the `AichChatIntel` write and the
  `customer_profiles` analysis fold, the client skips `commitState` on Accept / Accept & Send,
  and the rail does NOT auto-switch to AI Intel (the chatter stays on the PPV tab). Legacy
  forces the PPV-mode strategy to `phase: send_content`, which would clobber the fan's real
  next-planned-move. The usage ledger (`aich_usage_events`) is still recorded.
- After a successful send, `ppv` clears like `attachment` does today. The optimistic bubble is
  `price: ppv.price, isFree: price === 0, isOpened: false`, media tiles from `ppv.media`
  thumbs; reconcile with the vendor response as today (`reconcileSentMedia` handles not-ready
  media already).

### Composer UI (`SsComposer`)

Above the typing bar, when `ppv` is set, a **PPV strip**:

- Set name chip with an × (unload, no confirm).
- Media tiles (reuse the attachment preview tile; cap 6 visible + "+N", like `SsMessageMedia`).
  A tile with no thumb yet shows a type icon placeholder, never a broken image.
- **Price to View** chip: click to edit (number input, step 1, min 3, max 200, or 0). Invalid
  value disables Send and shows the vendor rule inline ("$3–$200, or free").
- The Generate button label reads **Generate caption** while a set is loaded. The Send button
  reads **Send PPV $20** (or **Send free media**).

### Right rail: PPV tab

Third tab beside Fan / AI Intel: **PPV**. Persisted in the same `rail` ref. Content:

- Cards, one per set, ordered. Card: cover thumb, name, price, media counts by type (📷 n 🎞 n),
  status pill for the open fan, caption excerpt (2 lines).
- Status pill, from `chats/{chat}/ppv-sets/status` joined with the loaded thread:
  - **Bought** (green) — a ledger message id is in the thread with `isOpened`.
  - **Sent** (amber) — ledger row exists; not opened or message not in the loaded page.
  - none — never sent by SSAI to this fan.
  Hovering shows "sent {n} times, last {date}".
- Click anywhere on the card loads it (with the confirm above). Keyboard: Enter.
- Manager/admin only: a ⋯ menu per card with **Edit** (name, caption, price — a small modal)
  and **Delete** (confirm). Media is not edited here; see Media Vault.
- Empty state: "No PPV sets yet." Managers see "Create sets from the Media Vault: select
  media → Save as PPV set."

Thumbs, and why they are stored after all: every vault detail call bills a credit, and a set
has up to 40 items, so fetching thumbs live would cost tens of credits per load. Instead each
`media[]` entry also stores `thumb: string|null`, captured from the vault payload when the
manager saves the set — but ONLY when the url is an onlyfans.com host. Those load through the
media proxy, which re-signs expired signatures and caches by path (CLAUDE.md, signed-url
facts), so a stored onlyfans CDN thumb stays valid indefinitely. A `cdn.fansapi.com` presigned
url expires in 15 minutes and is stored as `null`. Rendering: tile with `thumb` → `mediaSrc`;
tile without → type-icon placeholder. The rail cover is the first item with a thumb; if a set
has none, ONE lazy `GET media/vault/{media}` for its first item, memoized per page session.
**Build finding (2026-11-08):** the vendor serves onlyfans-hosted thumbs on first look and
`cdn.fansapi.com` presigned ones for any media it has since re-hosted (same ids, an hour apart),
so onlyfans urls cannot be relied on. Implemented fallback: a fansapi thumb is downloaded ONCE at
save time (a direct S3 fetch, no credit) to `storage/app/private/ppv-thumbs/{model}/{mediaId}`,
stored as the marker `local`, and served by `GET onlyfans/{model}/ppv-sets/thumb/{media}`
(assigned users only, private, 1-day browser cache). Onlyfans-hosted thumbs are still kept as
urls. Other hosts → null, never fetched.

### Media Vault: creating a set

In `SsVaultGrid`, the bulk bar (visible when ≥1 selected) gets **Save as PPV set**
(manager/admin only, next to "Add N to a list"). It opens a modal: name, price (default from
the first item's vault price if the payload exposes one, else blank), caption, and the selected
items in their grid order (drag to reorder optional). Save → `POST ppv-sets` → toast with a
link "Open in Conversations". Only `photo|video|gif|audio` items are accepted; DRM videos are
fine (vault ids are what the send endpoint wants).

### Access and gates

- Read endpoints: `account()` scope (chatter must be assigned). Rows carry `creator_model`, so
  `CreatorAccessScope` guards the model layer too.
- Write endpoints: `can:manage-team` route group, plus the same `account()` scope.
- Vue hides manager controls with `can(role, 'manageTeam')`; the server gates are the
  enforcement.

### Sent/Bought status — honest limits

Status comes only from SSAI's own ledger. A set sent from CreatorHero or OnlyFans directly
shows no status. This is stated in the rail tooltip ("tracked for sends made from SSAI"). The
alternative — matching message media to vault ids — is not possible with this vendor (chat
media ids are distinct from vault ids; verified 2026-08-24).

### Engine

No engine change. `sender: 'ppv'` already produces a caption-only draft. One check to add:
`node engine/ppv_caption_check.js` — proves a `sender:'ppv'` request reaches the generator with
the "PPV CAPTION MODE" block and no FOLLOW-UP note, in the style of the other `*_check.js`
guards. The legacy price-suggestion path (`fetchPpvSuggestion`) is DOM-driven and stays out of
scope.

### Tests

- Pest: `PpvSetTest` — CRUD, manager gate (chatter 403 on write, 200 on read), creator scope
  (chatter not assigned → 403/404 like other chat routes), validation (price rule, media 1–40,
  type enum), ordering.
- Pest: `OnlyFansChatSendPpvTest` — send with `price` + `mediaFiles` forwards both; price 2.99
  → 422; price 200.01 → 422; price 0 + media → no `price` key sent; `ppvSetId` writes a ledger
  row with the vendor message id; ledger failure does not fail the send; `ppvSetId` of another
  creator → 422.
- Pest: `OnlyFansChatGenerateTest` addition — `sender: 'ppv'` reaches `EngineClient` opts.
- Existing: full suite, `types:check`, `lint:check`, Pint.

### Chatter guide

Add a "Sending a PPV" section to `docs/chatter-guide.md`: pick a set → Generate caption →
read it → Send. Note that the status pill only knows sends made from SSAI.

## Left to the builder

- Exact component split (`SsPpvRail`, `SsPpvStrip`, `SsPpvSetModal` suggested).
- Whether to add `ppv_set_sends` reads to the chat list (no — not in this slice).
- Thumb memo shape and eviction.
- Drag ordering vs simple up/down; or defer ordering endpoint.
- Migration timestamps and exact validation messages.

## My calls (not discussed with the team)

- Sets are keyed by `creator_model` name, not `of_account_id`, to match every other table.
- Price allowed to be 0 (free media set) because the vendor allows it and "free tease sets"
  are a real CreatorHero use; the UI makes it visibly deliberate.
- Media cap 40 per set. Vendor limit unknown; 40 is above anything in the screenshots.
- The set name is NOT passed to the engine (see Composer state). Caption gets the thread,
  persona and `sender:'ppv'` only, exactly as legacy's PPV click.
- Caption generates do not write AI Intel, fan memory or forcing-move state.
- Thumbs are stored per media item when onlyfans-hosted, else null; one lazy fetch per set at
  most. `reconcileSentMedia` is generalised from one attachment to N media.
- Ledger written server-side on the send response, not client-side, so it cannot be skipped.
