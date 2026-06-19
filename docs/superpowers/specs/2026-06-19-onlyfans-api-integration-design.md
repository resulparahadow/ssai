# OnlyFans API Integration — Design Spec

**Date:** 2026-06-19
**Status:** Approved (design); pending implementation plan
**App:** SSAI (app v0.4.4.7 / doctrine v0.4.5.1)
**External API:** OnlyFansAPI — https://docs.onlyfansapi.com/introduction

## Goal

Eliminate the manual copy-paste at both ends of the chat loop. Today a chatter
manually reads a fan's OnlyFans DM, pastes it into SSAI, generates a reply, then
copy-pastes the approved reply back into OnlyFans. This integration:

- **Pulls** existing chats + message history into SSAI (`GET /chats`, `GET /chats/{id}/messages`).
- **Receives** new fan messages live via webhook (`messages.received`).
- **Sends** the chatter-approved reply back to OnlyFans automatically (`POST /chats/{id}/messages`).

The human review gate is preserved: the AI drafts, a chatter approves, and only
then does SSAI transmit. No autonomous sending.

## Decisions (locked during brainstorming)

| # | Decision | Choice |
|---|---|---|
| 1 | Autonomy level | **Chatter approves → SSAI auto-sends.** Human-in-the-loop preserved; only the copy-paste is removed. |
| 2 | PPV / paid media in v1 | **Text auto-sends; PPV stays manual.** A PPV is one composed unit (locked text + media + price); media→vault-ID mapping is out of scope for v1. |
| 3 | Account connection | **Connect each OF account once in the OnlyFansAPI dashboard, store the resulting `acct_XXXX` on the creator's SSAI model.** No in-app auth UI in v1. |
| 4 | Inbound mechanism | **Pull (backfill/sync) + webhook (live).** |
| 5 | OF API key storage | **Server-side, in the Edge Function env.** Browser calls everything through the proxy with the existing `ssai_*` token. Key never in browser. |
| 6 | Tenancy / key model | **One OnlyFansAPI key, many connected accounts.** `of_account_id` per creator does all routing. |

## Tenancy model (verified against code)

SSAI is a **single agency, multi-creator** app — there is no separate
client/tenant entity with its own credentials.

- `aich_models` = creator personas, keyed by `name`. **Each creator row = one OnlyFans account.**
- `chatters` (role `manager` | `chatter`) + `model_assignments` (`chatter_id → creator_model`).
  A chatter sees only assigned creators (`currentChatter.assignments`, `js/auth.js:95`);
  a manager sees all.

"Multiple accounts/clients, each a different OF account" maps to **`of_account_id`
per `aich_models` row**. One OnlyFansAPI key covers all of them; `of_account_id`
is the per-message routing key in both directions.

## OnlyFansAPI reference facts (as of 2026-06-19)

- **Base URL:** `https://app.onlyfansapi.com/api`, paths prefixed `/api/{acct_id}/…`.
- **Auth:** `Authorization: Bearer <API_KEY>`. One key per OnlyFansAPI workspace.
- **Account ID:** each connected OF account → `acct_XXXX`, required in all paths.
- **Endpoints used in v1:**
  - `GET  /api/{acct}/chats`
  - `GET  /api/{acct}/chats/{chat_id}/messages`
  - `POST /api/{acct}/chats/{chat_id}/messages` — body: `text` (string), `price`
    (int, 0 or 3–200; if non-zero, `mediaFiles` required — **rejected in v1**),
    `lockedText`, `mediaFiles[]`, `previews[]`, `replyToMessageId`, `giphyId`.
    `chat_id` is the fan's OF user ID.
- **Webhooks (real-time):** `messages.received`, `messages.sent`, `tips.received`,
  `messages.ppv.unlocked`, `subscriptions.new/renewed`, `accounts.session_expired`,
  etc. Registered in the dashboard. **At-least-once**, retries up to 5× if no 2xx
  within 15s → consumers must be idempotent (use `event_id` / message id).
  `messages.received` payload: `event`, `account_id`, `payload.fromUser.{id,username,name}`,
  `payload.text` (HTML, e.g. `<p>…</p>`), `payload.createdAt`, `payload.isNew`.

## Architecture (Approach A)

Browser + Supabase only — **no SSAI-owned backend server**. Webhooks need a public
HTTPS receiver, so they ride on Supabase **Edge Functions** (the same pattern as the
existing `anthropic-proxy` / `mistral-proxy`).

```
Browser (SSAI)                Supabase Edge Functions            OnlyFansAPI
─────────────                 ───────────────────────            ───────────
js/onlyfans.js  ──proxy tok──▶ onlyfans-proxy  ──Bearer key──▶  GET  /chats
  ofPull()                       (holds OF key,                  GET  /chats/{id}/messages
  ofSend()                        allowlist only)                POST /chats/{id}/messages
       ▲                                                              │
       │ Supabase Realtime / refresh                                  │ webhook
       │                                                              ▼
  aich_messages ◀──insert── onlyfans-webhook ◀──messages.received───┘
                            (verify sig, dedupe,
                             HTML-strip, upsert session)
```

Generation stays **client-side** (unchanged `generate()`), so we pay for a
generation only when a chatter actually works a message — no porting the
1,311-line pipeline into a Deno function (rejected Approach B), and no
browser-side OF key or open-tab polling (rejected Approach C).

### Components

1. **`onlyfans-proxy` Edge Function** (new) — holds `ONLYFANS_API_KEY` in env.
   Validates the `ssai_*` proxy token, enforces authorization (see Security),
   then forwards to OnlyFansAPI with `Authorization: Bearer …` and the
   `/api/{acct_id}/…` prefix. **Strict allowlist:** only the 3 endpoints above.
   Rejects any other OF path, any `acct_id` not in `aich_models.of_account_id`,
   and any send with `price > 0`.

2. **`onlyfans-webhook` Edge Function** (new) — public URL registered in the
   dashboard. Verifies the webhook signature/secret, dedupes, normalizes,
   upserts session + inserts message. Does **not** generate. Write-scoped only.

3. **`js/onlyfans.js`** (new browser module) — `ofPull(acct, path)`,
   `ofSend(acct, chatId, body)`. Reuses `getProxyToken()` + the `fetch` pattern
   from `js/api.js`.

## Data model

| Table | New column | Purpose |
|---|---|---|
| `aich_models` | `of_account_id` (text, nullable) | Maps creator → OF `acct_XXXX`. Set from the dashboard-connected ID. Editor gets a field. Acts as the per-creator on/off + kill switch. |
| `aich_sessions` | `of_chat_id` (text) | Fan's OF user ID — the `{chat_id}` for sends and the inbound routing key. Stable across username changes. |
| `aich_messages` | `of_message_id` (text, **UNIQUE**) | Dedup key. Single source of truth that stops the same message double-inserting across **pull**, **`messages.received`**, and the **`messages.sent` echo** of our own send. |
| `aich_messages` | `send_state` (text) | `pending` / `sent` / `send_failed` — outbound double-send lock + failure surfacing. |

`ON CONFLICT (of_message_id) DO NOTHING` is the mechanism that makes all inbound
paths idempotent.

## Inbound flow

1. **Account → creator:** every event carries `account_id`; look up the
   `aich_models` row where `of_account_id = account_id` → `creator_model`. No
   match → log + return 2xx (don't make OnlyFansAPI retry). This lookup is the
   isolation boundary between creators.
2. **Fan → session:** from `payload.fromUser.{id,username,name}`. Session key =
   (`creator_model`, `of_chat_id = fromUser.id`). Find-or-create `aich_sessions`
   mirroring `createSession()` (`js/app.js:7317`):
   - `customer_username = fromUser.username` (display + ties to `customer_profiles` memory)
   - `of_chat_id = fromUser.id`
   - `chatter_id` set **explicitly** (the chatter assigned to that creator via
     `model_assignments`, or a `system` sentinel) — the browser's
     `installChatterIdAutoInject()` (`js/auth.js:103`) does **not** apply to
     server-side writes.
3. **Normalize + insert:** strip HTML from `text` **in the webhook function**
   (also neutralizes fan-controlled markup before it reaches the DOM — defense in
   depth with the client `esc()`). Insert into `aich_messages`
   (`sender='customer'`, `of_message_id`, `created_at=createdAt`) with
   `ON CONFLICT (of_message_id) DO NOTHING`.
4. **Two triggers, one insert path:**
   - **Live:** `messages.received` → steps 1–3; browser sees it via Supabase
     Realtime (or existing refresh).
   - **Backfill/sync:** a "Sync from OnlyFans" button (per creator) → `ofPull`
     via proxy → `GET /chats` then `GET /chats/{id}/messages` → same
     normalize+dedup path. Used on first connect and to recover webhook gaps.

## Outbound flow

Hook at the **end** of `acceptDraft()` (`js/app.js:2701`), after its existing
persist-as-`sender='model'` logic:

1. Guard: proceed only if `session.of_chat_id` set **and** creator has
   `of_account_id` **and** the draft has no PPV price.
2. **Final safety gate:** re-run `scanForBanned` on the exact (possibly
   chatter-edited) approved text. One banned term = account termination, so the
   send path is the last line of defense. Empty/flagged → abort send, keep
   message, warn.
3. `ofSend(creator_model, of_chat_id, { text })` → `onlyfans-proxy` →
   `POST /api/{of_account_id}/chats/{of_chat_id}/messages`.
4. **On success:** API returns the created message `id` → write back as
   `of_message_id` on the just-inserted row. This is what makes the
   `messages.sent` echo dedupe instead of double-inserting.
5. **On failure:** mark row `send_failed`, toast, offer retry or manual fallback.
   Text never lost.

**Double-send lock:** `send_state` (`pending → sent`) + disabling Accept during
the call.

**PPV (manual in v1):** `confirmPpvSend()` (`js/app.js:5294`) does not auto-send;
it persists as today and shows a "send this PPV manually on OnlyFans" indicator.
The proxy hard-rejects `price > 0` as a server-side backstop.

## Security

- **Key isolation:** `ONLYFANS_API_KEY` only in Edge Function secrets. Browser
  holds only the `ssai_*` token.
- **Proxy = strict allowlist:** 3 operations only; refuses every other OF path
  (earnings, mass-message, vault, account-disconnect), any unknown `acct_id`, and
  `price > 0`. A leaked proxy token cannot drain or wreck an account.
- **Server-side authorization:** browser role gating is UI-only (`js/auth.js:31`).
  The proxy independently confirms the caller is a manager OR a chatter assigned
  to that creator via `model_assignments` before sending. The proxy is where role
  gating becomes real.
- **Webhook verification:** verify the OnlyFansAPI signature/shared secret; reject
  unsigned. Write-scoped: only creates sessions + inserts customer messages, never
  sends, never reads keys.

## Error handling

- OF errors surfaced, not swallowed: 401/403 → manager banner;
  `accounts.session_expired` → per-creator "reconnect needed" banner that blocks
  sends for that creator until fixed; 429 → back off using `_meta._rate_limits`,
  retry rather than hard-fail.
- Send failure → row `send_failed`, retry/manual fallback. Text preserved.
- Webhook: return 2xx fast, idempotent via `of_message_id`. Unmapped account →
  log + 2xx.
- No-message-left-behind: webhook + pull are redundant inbound paths; if Realtime
  drops, "Sync from OnlyFans" backfills.

## Testing

- **Pure functions → new `harness.js` sections** (deterministic, synthetic
  payloads, no network): HTML-strip (incl. script/entity/emoji edge cases),
  `messages.received` normalizer, identity mapping (`account_id → creator_model`
  incl. unmapped-drop; `fromUser.id → session key`), `of_message_id` dedup, PPV
  `price > 0` reject, outbound pre-send banned-word gate, chatter→creator
  authorization check.
- **Edge Functions (Deno + network) → not harness-able** (documented gap): test
  via `supabase functions serve` + curl with sample payloads against a sandbox
  account; a small proxy smoke-test script.
- **Live, on one test account:** inbound webhook appears in SSAI; "Sync"
  backfills; generate → accept → lands on OF; `messages.sent` echo dedupes (no
  double row); second creator's traffic never crosses into the first.

## Rollout (staged, with kill switch)

| Phase | Action | Blast radius |
|---|---|---|
| 0 | DB migration (columns + unique constraint), deploy both Edge Functions, register webhook | None — no creator has `of_account_id` |
| 1 | Set `of_account_id` on one pilot creator; inbound only, outbound still manual | One creator, read-only |
| 2 | Enable auto-send for that creator | One creator |
| 3 | Roll out remaining creators by setting `of_account_id` | Per-creator, incremental |

**Kill switch:** clearing a creator's `of_account_id` instantly reverts them to
fully-manual. The existing manual flow is never removed — only bypassed when the
ID is present.

## Out of scope for v1

- PPV / paid-media auto-send (needs content-library → OF vault-media-ID mapping).
- In-app OAuth connect flow (start-auth / poll / 2FA UI).
- Mass messaging, earnings/analytics sync, stories/posts.
- Per-client OnlyFansAPI keys (single key model chosen).
- Tip / PPV-unlock webhooks feeding `effectiveSpend` (natural follow-up; the
  inbound pipe makes it cheap later, but not built in v1).

## Open questions / follow-ups (post-v1)

- Wire `tips.received` + `messages.ppv.unlocked` → `effectiveSpend` (PPV+tips) so
  the posture/pricing engine sees real spend automatically.
- Read-receipt tracking via the `isNew` field poll (no webhook available).
- Revisit PPV auto-send once a vault-media mapping exists.
