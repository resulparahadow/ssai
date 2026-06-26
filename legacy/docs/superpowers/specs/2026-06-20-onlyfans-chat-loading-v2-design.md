# OnlyFans Chat Loading v2 (scale-aware) — Design Spec

**Date:** 2026-06-20
**Status:** Approved (design); pending implementation plan
**App:** SSAI
**Supersedes:** the eager "Load chats" behavior introduced in the v1 integration
(`ofSyncCreator` pulling all chats + all messages synchronously).

## Problem

The v1 "Load chats" (`ofSyncCreator`) eagerly pulls *every* chat and *every*
message for a creator, synchronously in the browser, one DB round-trip per
message. It worked for a pilot but does not scale:

- **Pagination ignored** — only the first page of `list_chats` is read
  (`_pagination.next_page` dropped), so it silently loads a partial set.
- **Serial per-message upserts** — `for (n of norm) await upsert(...)` =
  O(chats × messages) sequential round-trips → minutes of a frozen UI.
- **One OF call per chat, no throttle** — thousands of calls → 429 rate limits
  + OF API credit cost.
- **Loads/render everything** — `loadSessions()` + `renderSidebar()` materialize
  and draw all sessions.

## Scope (decided)

- **Scale target:** small — ~5–20 creators, hundreds of chats each.
  Browser-side is sufficient; **no** server-side bulk/export job.
- **Load model:** **sidebar group, paginated + lazy messages.** "Load chats"
  creates session *stub rows* for one page of chats (name only, no messages);
  a chat's messages are pulled only when it is **opened**; "Load more" pages
  forward.

## Out of scope (noted follow-ups)

- Server-side bulk import via OnlyFansAPI Data Exports (only needed at large scale).
- "Load older messages" within a single chat (we load the first page on open).
- Last-message preview on stub rows (needs a small persisted field).
- Sidebar virtualization.

## Prerequisites (already in place)

The v1 schema fixes are assumed applied: `aich_messages` has `sender`, `text`,
`of_message_id`, `send_state`; `of_message_id` has a **non-partial** unique
index (required for `ON CONFLICT` upserts); `aich_sessions.of_chat_id`,
`aich_models.of_account_id` exist. **No new DB migration** is required by v2.

## UX & flow

```
Sidebar group header:  [Load chats]   [Load more ▸]   (Load more shows once a page is loaded)
        │ Load chats / Load more
        ▼
  ofListChatsPage(account, cursor)        ← ONE paginated GET /chats (a page)
        │  { chats, next }
        ▼
  ofCreateSessionRows(model, chats)       ← batched find-or-create stubs (no messages)
        │  (rows appear in the group with an OF badge)
        ▼
  remember next cursor for this creator (in-memory); hide "Load more" when next === null

Open a chat (click):
     s._ofNeedsLoad ?  (of_chat_id set AND messages_input was null)
        │ yes → render "Loading…" placeholder, fire ofEnsureChatLoaded(s)
        ▼
     ofLoadChatMessages(account, model, fanId)   ← lazy: ONE GET /chats/{id}/messages (first page)
        │  normalize + sort + BATCH upsert + write messages_input
        ▼
     re-render bubbles + recomputePosture
     (already-loaded chats render instantly from messages_input — no fetch)
```

- "Load chats" loads the first page; "Load more" advances via the saved cursor.
  No silent truncation; no eager message pull for unopened chats.
- Opening a chat lazily pulls that one chat's messages once, then it behaves
  exactly like any session (Generate → Accept → auto-send).
- OF badges (chat via `of_chat_id`, message via `of_message_id`) unchanged.

**Cost profile:** per Load-chats/Load-more click = **1 OF call + ~2 DB calls**;
per chat opened = **1 OF call + 1 batch upsert + 1 update**. No O(chats × messages)
sweep.

## Proxy pagination (`supabase/functions/onlyfans-proxy/index.ts`)

- Accept an optional **`params`** object on the list ops; append **only an
  allowlisted set of query keys** — `limit`, `offset`, `id`, `order` — to the
  URL the proxy builds itself. Never fetch a raw `next_page` URL (SSRF/allowlist
  hole); only re-apply known pagination params to the allowlisted path.
- The browser derives next-page `params` from the previous response's
  `_pagination`. Allowlisting `offset` + `id` covers both offset- and
  cursor-based schemes.
- `list_messages` paginates the same way; lazy-open pulls the **first page**.
- The proxy stays a strict allowlist (3 ops; rejects `price > 0`, unknown
  `account_id`; CORS + OPTIONS preflight unchanged).

**Live-verify point:** the exact `_pagination` field / param name (`offset` vs
`id` cursor) isn't confirmable from the docs; the first real "Load more" reveals
it and the allowlist already supports either → at most a one-line adjustment.

## Browser data layer (`js/onlyfans.js`)

- **`ofPull(account, op, chatId, params)`** — gains `params`, passed to the proxy.
- **`ofListChatsPage(account, cursor)`** → `{ chats, next }` from one paginated
  `list_chats`; `next` is the cursor/params from `_pagination`, or `null` at end.
- **`ofCreateSessionRows(creatorModel, chats)`** — batched find-or-create for a
  page: **one** `SELECT … of_chat_id IN (ids)` for existing, then **one** bulk
  `INSERT` of missing stubs (`customer_name`, `customer_username`, `of_chat_id`,
  `status`, `current_posture`; `messages_input` left **null**). ~2 DB calls per
  page regardless of size. Returns created count.
- **`ofLoadChatMessages(account, creatorModel, fanId)`** — lazy single-chat pull:
  first page of `list_messages` → normalize (sender = `fromUser.id === fanId ?
  'customer' : 'model'`) + sort oldest→newest → **one batch
  `upsert(array, {onConflict:'of_message_id', ignoreDuplicates:true})`** → write
  `messages_input`. Returns the messages.
- **`ofNextCursor(pagination)`** (pure) → next-page params object or `null`.
- **Cursor state:** in-memory `window._ofChatCursor[creatorModel]`. "Load chats"
  resets it; "Load more" advances it; `null` → hide "Load more".
- **`ofSyncCreator` is removed.** `onOfLoadGroup` now calls `ofListChatsPage` +
  `ofCreateSessionRows`; message loading moves to open-time.

## Lazy-open hook & rendering (`js/app.js`)

- **"Needs load" detection:** stubs are inserted with `messages_input = null`.
  In `loadSessions` hydration: `s._ofNeedsLoad = !!s.of_chat_id && !s.messages_input`.
  Once `ofLoadChatMessages` writes `messages_input` (even `'[]'`), it's loaded —
  no re-pull loop.
- **`openSession`** stays synchronous and renders immediately; if `s._ofNeedsLoad`
  it shows a "Loading conversation from OnlyFans…" placeholder (a tweak to
  `renderBubbles`' empty branch) and fires `ofEnsureChatLoaded(s)`.
- **`ofEnsureChatLoaded(s)`** — guarded by `s._ofLoading` (no double-fetch on
  double-click): `ofLoadChatMessages` → set `s.messages` → clear `_ofNeedsLoad`
  → persist `messages_input` → if still the active session, re-render bubbles +
  `recomputePosture(s)` + `updatePostureChip()`.
- Cached opens (messages_input present) render straight from memory.
- "Load more" button + handler in the sidebar group header next to "Load chats";
  both gated on `of_account_id` + `ofIsAuthorized`.

## Rate-limit backoff

`_ofProxy` adopts the transient-retry pattern from `callApi`: on **429** (and on
`_meta._rate_limits` near zero), read `Retry-After`, wait with jittered backoff,
retry up to ~3 attempts, then surface a clear toast. Makes paging a larger roster
resilient instead of failing hard.

## Error handling

- Page fetch fails → toast, leave already-loaded stubs intact, don't advance the
  cursor.
- Lazy message load fails → toast on the open chat, keep `_ofNeedsLoad` true so a
  re-open retries; never wipe an existing conversation.
- Batch upsert partial failure → surfaced via the upsert error (logged); the
  `messages_input` write is the display source, so display still works; dedup
  ledger may miss rows (re-open re-upserts).
- 429 after retries → toast asking to wait/Load more again.

## Testing

- **Harness (deterministic):** `ofNextCursor(_pagination)` (next params vs `null`
  at end), and the `_ofNeedsLoad` predicate. Message normalize/sort/sender are
  already covered by existing section W.
- **Manual (live):** paging, lazy open, batch upsert, backoff. Harness must stay
  `FAIL 0`.

## Rollout

Browser JS + one proxy change (pagination). **No DB migration.** Deploy the
updated `onlyfans-proxy`, reload the app, test on the pilot creator: Load chats →
Load more → open a chat (lazy load) → Generate → Accept → send. Kill switch
(clear `of_account_id`) unchanged.
