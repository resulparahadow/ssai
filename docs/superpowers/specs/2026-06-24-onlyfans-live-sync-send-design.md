# SmartStars CRM — OnlyFans Live (Sync + Send) · Phase 5

**Date:** 2026-06-24
**Status:** Implemented (sync + send; webhook ingestion deferred)
**Builds on:** Phase 4 (Conversations + Models)

## Goal
Wire the real OnlyFans API into Conversations: pull chats/messages and send messages for
real, reusing the legacy proxy's proven flow. Decisions: **sync + send** this pass (no
webhook ingestion), build live (user provides the API key).

## API (onlyfansapi.com — confirmed from the reference)
- Base `https://app.onlyfansapi.com/api` · auth `Authorization: Bearer <key>` · account ids `acct_XXXX`.
- `GET /{acct}/chats` → `data[].fan.{id,name,username}`, `_pagination.next_page`.
- `GET /{acct}/chats/{chatId}/messages` → `data[].{id,text,fromUser.id,createdAt,price,isFree,isOpened}`.
- `POST /{acct}/chats/{chatId}/messages` `{text, price(0|3-200), …}` → `data.{id,…}`.
  (The legacy proxy's path was correct; the docs' `send-message` slug 404s.)

## Implementation
- `app/Services/OnlyFans/OnlyFansService.php` — Bearer HTTP client: `listChats`, `listMessages`,
  `send` (text-only, PPV blocked) + ported pure helpers (`normalizeMessage`, `nextCursor`,
  `resolveCreator`, `htmlToText`, `ppvBlocked`). Key from `config('services.onlyfans')`.
- `app/Services/OnlyFans/OnlyFansSyncService.php` — `syncChats(model)` find-or-creates a session
  per chat (legacy `ofCreateSessionRows`, messages left null = "unloaded"); `loadMessages(session)`
  normalises + sorts + upserts `aich_messages` deduped on `of_message_id`, then writes the thread.
- `OnlyFansController@syncChats` → `POST /onlyfans/sync-chats` (scoped to the creators the user
  can access — chatters: assigned; managers/admins: all linked).
- `ConversationController` — `index` lazy-loads OF messages the first time an OF chat is opened
  (`of_chat_id` set + `messages` null); `send` pushes text to OnlyFans first when the chat is
  linked, captures `of_message_id`, then persists (502 on OF failure).
- Frontend: a **Sync** button in `SsConvoList` (pulls chats → Inertia reload). Generate/Send
  already wired; Send now reaches real fans for OF-linked chats.
- Config: `services.onlyfans.base_url` defaults to the live base; `.env`/`.env.example` carry
  `ONLYFANS_API_KEY` (blank) + base url.

## Verification
- `php artisan test` → 68 passed / 266 assertions. `OnlyFansIntegrationTest` (Http::fake):
  send hits `/{acct}/chats/{id}/messages` with Bearer; sync find-or-creates sessions; message
  load tags sender (fan→customer, creator→model) + dedups on `of_message_id`; send pushes to OF
  then persists; non-linked chats make no OF call; sync is chatter-scoped.
- `types:check` · `lint:check` · `build` clean.
- Live: set `ONLYFANS_API_KEY`, map a creator's `of_account_id`, `/conversations` → Sync → open → Send.

## Out of scope (next)
Webhook ingestion (`messages.received` → thread, dedupe `event_id`) · PPV/tip pricing + media
sends · mass messaging · account-connection UI · post-message analysis.
