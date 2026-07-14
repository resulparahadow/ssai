# Chat total spend + per-message PPV price/paid state — design

**Date:** 2026-07-14
**Status:** approved (pending spec review)
**Area:** Conversations (live OnlyFans proxy)

## Goal

In the **Conversations** view, surface money that is already flowing through the
live OnlyFans data but is currently invisible or unformatted:

1. Show the fan's **total lifetime spend**, formatted as a proper currency mask
   (`$1,234.50`), in **both** the chat thread header and the right-rail fan panel.
2. Show, on **every priced message**, a **status pill** with the price and whether
   it has been **paid or not paid** — green when paid, amber when unpaid.

This is display-only over live data. **Nothing new is persisted** (Conversations
persists no message text; the only carve-outs remain AI intel, the usage ledger,
and fan memory — none of which this touches).

## Non-goals

- Sending PPV / paid / tip messages (still text + GIF only).
- Per-media price ladders / opened-per-media mapping.
- Persisting any message text, price, or paid state.

## A. Total spend (chat header + right rail)

### Data source (no extra API calls)

The fan detail endpoint already has everything:

- `OnlyFansChatController::user()` (`GET /onlyfans/{model}/users/{id}`) calls
  `OnlyFansService::getUser()` and reads its `data` object (`$d`).
- `OnlyFansService::extractFanSpend($d)` already returns
  `{ total: float|null, tips: float|null, status: string|null }` from that same
  object (`subscribedByData.totalSumm` / `tipsSumm`, with fallbacks).

So spend is surfaced by reading fields already fetched — **zero additional
OnlyFans requests**.

### Backend

In `OnlyFansChatController::user()`, call `$this->of->extractFanSpend($d)` and add
to the `fan` response:

- `totalSpent` = spend `total` (float|null)
- `tips` = spend `tips` (float|null)

`null` is preserved (means "OnlyFans did not return it") so the client can decide
to hide vs. show `$0.00` — see edge cases.

### Types

Extend `OfFan` in `resources/js/types/crm.ts`:

```ts
totalSpent: number | null; // lifetime spend on this creator (live from getUser)
tips: number | null;       // lifetime tips
```

### Currency mask util

New `resources/js/lib/money.ts`:

```ts
const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
/** $1,234.50 — the "nice mask". null/undefined → em-dash. */
export function usd(n: number | null | undefined): string {
    return n == null ? '—' : fmt.format(n);
}
```

Mirrors the formatter already used in `resources/js/pages/Spenders.vue`.

### Chat thread header

`SsChatThread.vue`:

- New prop `spend?: number | null`.
- Render a pill next to the fan name/username: `💰 {{ usd(spend) }}`.
- **Hidden** while `spend == null` (fan object still loading, or OnlyFans returned
  nothing) — no empty/`—` pill in the header.

`Conversations.vue` passes `:spend="fan?.totalSpent ?? null"` (the page already
loads `fan` via `ofApi.fan()` into `fan.value`).

### Right-rail fan panel

`SsFanPanel.vue`, the "Memory & controls" read-only spend tiles:

- *Spent* → `usd(fan?.totalSpent ?? profile?.total_spend ?? null)`
- *Tips* → `usd(fan?.tips ?? profile?.tips_spend ?? null)`
- *Sub* → unchanged (`profile?.subscription_status`)

Live `fan.*` is the primary source (agrees with the header); the persisted
`profile.*` is the fallback when the live fan object has not loaded yet. This
replaces the current raw `${{ profile?.total_spend ?? 0 }}` rendering (which
prints e.g. `$1234.5`).

## B. Per-message PPV price + paid/unpaid pill

### Pure frontend

Every field is already normalized onto `OfMessage`
(`price`, `isFree`, `isOpened`, `isTip`, `from`). No backend change.

### Helper

New pure exported function in `resources/js/lib/onlyfans.ts`:

```ts
export type MessagePay = { kind: 'tip' | 'ppv'; price: number; paid: boolean };

/** Money state of a message, or null if it carries no price. */
export function messagePayInfo(m: OfMessage): MessagePay | null {
    if (m.isTip && m.price > 0) {
        // fan-sent tip = money already received
        return { kind: 'tip', price: m.price, paid: true };
    }
    if (!m.isTip && !m.isFree && m.price > 0) {
        // creator-sent PPV — opening a PPV requires purchase
        return { kind: 'ppv', price: m.price, paid: m.isOpened };
    }
    return null;
}
```

### Pill (in `SsChatThread.vue`)

Rendered inside the message bubble, below media/text, when
`messagePayInfo(m)` is non-null:

| State | Color token | Label |
|-------|-------------|-------|
| Tip | `ss-pos` (green) | `💲 $X.XX · Tip` |
| PPV paid | `ss-pos` (green) | `💲 $X.XX · Paid ✓` |
| PPV unpaid | `ss-warn` (amber) | `💲 $X.XX · Unpaid` |

Price formatted with `usd()`. Soft-tinted background via token opacity
(e.g. `bg-ss-pos/15 text-ss-pos`), consistent with existing pill styling.

### De-duplication

Price currently also appears on locked media and the media-count fallback. To keep
one price source (the pill):

- Add `hidePrice?: boolean` prop to `SsMessageMedia.vue` (default `false`).
  `SsChatThread` passes `:hide-price="true"`. When true, the locked-media overlay
  shows the lock icon + "Locked photo/video" label but **not** the `$price` badge.
  `SsModelWelcome`'s reuse of `SsMessageMedia` keeps the default (price shown).
- Drop the `· $${m.price}` suffix from the media-count fallback line in
  `SsChatThread.vue` (the pill now owns price).

The existing tiny `· tip` text in the message meta line is replaced by the pill.

## Correctness note to verify during implementation

Paid PPV is inferred from `isOpened` (opening a PPV requires purchase). Confirm
this flips `true` on a genuinely purchased PPV against a connected creator during
the verify pass. If OnlyFans exposes a more explicit purchased/opened field, the
change is contained to `messagePayInfo`.

## Edge cases

- **Fan still loading** → header spend pill hidden (`spend == null`); rail falls
  back to persisted `profile.*`, else `—`.
- **Spend returned as 0** → `usd(0)` = `$0.00` shown (an informative "lurker"
  signal), distinct from `null` → `—`.
- **Optimistic / pending / failed sends** → `price` is 0, so `messagePayInfo`
  returns `null`; no pill.
- **Free message with media** → `price` 0 / `isFree` true → no pill.

## Testing

- **Backend (Pest):** feature test on the fan endpoint — mock
  `OnlyFansService::getUser` to return a raw payload with
  `subscribedByData.totalSumm` / `tipsSumm`; assert the JSON `fan` includes
  `totalSpent` / `tips`.
- **Frontend:** `messagePayInfo` and `usd` are pure exported functions
  (unit-testable if/when JS test infra is added). Guards:
  `npm run lint:check`, `npm run types:check`, `php artisan test`.
- **Verify pass:** drive a real chat that has a PPV message (paid + unpaid) and a
  tip; confirm the header/rail spend mask and each pill render correctly.

## Files touched

- `app/Http/Controllers/OnlyFansChatController.php` — spend fields on `user()`.
- `resources/js/types/crm.ts` — `OfFan.totalSpent` / `OfFan.tips`.
- `resources/js/lib/money.ts` — new `usd()` util.
- `resources/js/lib/onlyfans.ts` — new `messagePayInfo()` helper.
- `resources/js/components/crm/conversations/SsChatThread.vue` — header spend pill
  + per-message pill + fallback de-dupe.
- `resources/js/components/crm/conversations/SsMessageMedia.vue` — `hidePrice` prop.
- `resources/js/components/crm/conversations/SsFanPanel.vue` — masked spend tiles.
- `resources/js/pages/Conversations.vue` — pass `:spend` to the thread header.
- `tests/Feature/…` — fan-endpoint spend test.
