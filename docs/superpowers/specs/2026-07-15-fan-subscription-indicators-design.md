# Fan subscription indicators + human-friendly last seen — design

**Date:** 2026-07-15
**Status:** approved (pending spec review)
**Area:** Conversations (live OnlyFans proxy) — right-rail fan panel

## Goal

In the **Conversations** right rail (`SsFanPanel`, Fan tab), surface subscription
state that already ships inside the live `getUser` payload but is currently
dropped on the floor, and fix the two rows that render badly today:

1. **Subscribed** — is this fan currently subscribed to the creator, or lapsed?
2. **Subscribed for** — how long they have been subscribed (e.g. `1 month`).
3. **Location** — already shown; kept, unchanged.
4. **Rebill on** — does their subscription auto-renew?
5. **Last seen** — currently rendered as a raw ISO string
   (`2026-07-15T13:04:11+00:00`); becomes relative (`2 hours ago`).

This is display-only over live data. **Nothing new is persisted** (Conversations
persists no message text; the carve-outs remain AI intel, the usage ledger, and
fan memory — none of which this touches).

## Non-goals

- Chat-list badges or a chat-header status strip (fan panel only).
- Any new OnlyFans API call, endpoint, or credit spend.
- Feeding these fields into the engine / AI generation.
- Persisting subscription state into `customer_profiles`.
- Refactoring `SsChatThread.fmtTime` to use the new formatter (unrelated).

## Data source (no extra API calls, no extra credits)

The panel is already fed by `OnlyFansChatController::user()` →
`OnlyFansService::getUser()` → `GET {acct}/users/{id}`. Every field below is
present in **that same response**. No new request, no new credits.

### Subscription direction: `subscribedOn*`, not `subscribedBy*`

OnlyFans models the two directions separately, and the distinction is the crux of
this spec:

| Prefix | Meaning (from the creator account's view of a fan) |
| --- | --- |
| `subscribedBy*` | The **creator's** subscription **to the fan** — almost always empty |
| `subscribedOn*` | The **fan's** subscription **to the creator** — what we want |

`OnlyFansService::normalizeFan()` already reads `subscribedOnData` and is correct.
`OnlyFansChatController::user()` reads `subscribedByData.subscribePrice`, which is
the **wrong direction** — a pre-existing bug that makes the panel's "Subscribe
price" show a meaningless `0`/empty for most fans. Fixed here.

Confirmed against the OnlyFansAPI docs (Get User Details, Mass-List User Details,
List Active Fans, and the FAQ) via context7 on 2026-07-15.

### Field map

| Indicator | Source field(s) |
| --- | --- |
| Subscribed | `subscribedOnExpiredNow` → `subscribedOn` → `subscribedOnData.expiredAt` |
| Subscribed for | `subscribedOnDuration` → `subscribedOnData.duration` → derive from `subscribeAt` |
| Rebill on | `listsStates[]` entry `rebill_on` / `rebill_off` → `hasUser` |
| Location | `location` (already wired) |
| Sub price | `subscribedOnData.subscribePrice` (**was** `subscribedByData.…`) |
| Last seen | `lastSeen` (already wired; reformatted client-side) |

**On rebill:** the FAQ documents an agency-level path (Get User List with
`rebill_on` as `{userListId}`) for *enumerating* rebill-on fans. That is the wrong
shape here — it would be a second API call to answer a per-fan question. The
per-fan answer is already inline in `listsStates[]`, which carries `rebill_on` and
`rebill_off` entries with a `hasUser` flag. We read that.

## A. Backend — `OnlyFansService::extractFanSubscription()`

Normalization of OnlyFans payloads lives in `OnlyFansService` alongside
`normalizeFan()` / `extractFanSpend()`; the controller stays a thin proxy. New
sibling helper:

```php
/**
 * @param  array<string, mixed>  $d  the `data` object from getUser
 * @return array{subscribed: bool|null, durationLabel: string|null,
 *               subscribedAt: string|null, expiredAt: string|null,
 *               rebillOn: bool|null}
 */
public function extractFanSubscription(array $d): array
```

It inherits `extractFanSpend`'s contract: **every field is a defensive cascade
that returns `null` when the payload can't answer it**, so an unknown never
renders as a confident-looking `false`/`0`.

- **subscribed**
  1. `subscribedOnExpiredNow` is bool → `! $expiredNow`
  2. else `subscribedOn` is bool → use it
  3. else `subscribedOnData.expiredAt` parses → `expiredAt > now`
  4. else `null`

  (Step 1 leads because Mass-List returns `subscribedOn: null` alongside a
  meaningful `subscribedOnExpiredNow: true`.)

- **durationLabel**
  1. `subscribedOnDuration` non-empty → use verbatim
  2. else `subscribedOnData.duration` non-empty → use verbatim (docs show `""`,
     so empty string is treated as absent, not as a value)
  3. else `null` → the UI derives a coarse label from `subscribedAt`

- **rebillOn** — scan `listsStates[]` matching on `id` **or** `type`:
  - `rebill_on` with `hasUser: true` → `true`
  - `rebill_off` with `hasUser: true` → `false`
  - neither → `null` (unknown)

- **subscribedAt** / **expiredAt** — `subscribedOnData.subscribeAt` / `.expiredAt`,
  passed through as raw ISO for the client to format.

`OnlyFansChatController::user()` spreads the result into its existing `fan`
payload and switches `subscribePrice` to the `On` direction. `OfFan` in
`resources/js/types/crm.ts` gains the matching fields.

## B. Frontend — `resources/js/lib/datetime.ts`

No shared relative-time helper exists today (`SsChatThread` has a local `fmtTime`).
New tiny module following the `lib/money.ts` pattern — module-level `Intl`
formatter, `null`/unparseable → `'—'`, same contract as `usd()`:

```ts
relativeTime(iso: string | null | undefined): string
absoluteTime(iso: string | null | undefined): string
```

`relativeTime` thresholds:

| Elapsed | Output |
| --- | --- |
| < 5 min | `Online now` |
| < 1 hour | `32 minutes ago` |
| < 24 hours | `2 hours ago` |
| < 48 hours | `Yesterday` |
| < 7 days | `3 days ago` |
| >= 7 days | `Jul 2` (absolute; "412 days ago" helps nobody) |

Built on `Intl.RelativeTimeFormat('en', { numeric: 'auto' })`. `absoluteTime`
(`Jul 15, 2026, 13:04`) backs the hover tooltip. Future timestamps (clock skew)
clamp to `Online now`.

## C. UI — `SsFanPanel` (Fan tab)

A status line of two pills above the existing detail rows:

```
● Subscribed          ↻ Rebill on
────────────────────────────────
Subscribed for            1 month
Location            Austin, TX, US
Sub price                   $9.99
Last seen             2 hours ago   ← hover: Jul 15, 2026, 13:04
```

Rendering rules:

- **Subscribed pill** — green (`ss-pos`) `● Subscribed` when `true`; neutral
  `○ Expired` when `false`; **hidden** when `null`.
- **Rebill pill** — `↻ Rebill on` (green) / `↻ Rebill off` (neutral) ;
  **hidden** when `null`. Deliberately **still shown for expired fans** — "they
  let it lapse" is signal a chatter wants.
- **Subscribed for** — `durationLabel` verbatim when present, else a coarse
  derivation from `subscribedAt` (`~5 weeks`), else `—`. Coarse by design: it
  gauges loyalty tier, and matching OF's own wording avoids discrepancies the
  chatter would have to explain.
- **Last seen** — `relativeTime(fan.lastSeen)` with `absoluteTime` in `title`.
- Hiding (not defaulting) unknown pills is the whole point of the `null` cascade:
  a wrong "Rebill off" would drive a real chatter decision.

Styled with `ss-*` tokens / `font-ss` per the CRM convention.

## D. Tests

Pest unit tests on `extractFanSubscription()` — the real logic, pure and
payload-shaped:

- rebill on / off / unknown (missing `listsStates`)
- `subscribedOnExpiredNow: true` → not subscribed, even when `subscribedOn: null`
- active subscription via each cascade step
- empty-string `duration` treated as absent
- missing `subscribedOnData` entirely → all-`null`, no crash
- **regression:** `subscribePrice` reads `subscribedOnData`, not `subscribedByData`

Vitest is not configured in this repo, so `datetime.ts` is verified by hand-check
rather than bolting on a JS test runner as a side quest.

Guards: `php artisan test`, `npm run lint:check`, `npm run types:check`.

## Risks

- **`listsStates` may be absent** on some payload shapes → rebill reads `null` and
  the pill hides. Degrades to today's behavior (no indicator), never to a wrong one.
- **The price fix changes a visible number.** "Subscribe price" will start showing
  a real value where it likely showed `0`. That is the intent, but it is a visible
  behavior change worth noting in review.
