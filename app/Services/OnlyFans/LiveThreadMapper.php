<?php

namespace App\Services\OnlyFans;

use Illuminate\Support\Carbon;

/**
 * Turns the live OnlyFans thread the client forwards (from/text/time + payment
 * fields) into the legacy engine's money-aware inputs: `sender:'ppv'` bubbles for
 * creator-sent paid PPVs and gap-windowed SESSION total_spend/tips_spend. Pure —
 * no OnlyFans/engine/DB calls. See docs/superpowers/specs/2026-07-26-money-aware-generation-design.md.
 */
class LiveThreadMapper
{
    /**
     * @param  list<array<string, mixed>>  $messages  client thread items
     * @param  string  $timezone  the creator's IANA zone — the per-message `ts` stamps must read
     *                            the same clock as the engine's "current time" line (EngineClient
     *                            sends the same zone), or the AI sees two contradicting times
     * @param  array<string, string>  $tags  stored message_id => tag overrides (AichMessageTag::forChat)
     * @return array{messages: list<array<string, mixed>>, total_spend: float, tips_spend: float, thread: list<array<string, mixed>>, droppedMass: list<array<string, mixed>>}
     */
    public function map(array $messages, int $gapHours = 12, string $timezone = 'UTC', array $tags = []): array
    {
        $items = array_map(function (array $m) use ($tags): array {
            $ts = isset($m['time']) && $m['time'] !== null ? strtotime((string) $m['time']) : false;

            $item = [
                'id' => isset($m['id']) && $m['id'] !== '' ? (string) $m['id'] : null,
                'from' => ($m['from'] ?? 'fan') === 'creator' ? 'creator' : 'fan',
                'text' => (string) ($m['text'] ?? ''),
                'ts' => $ts === false ? null : $ts,
                'price' => (float) ($m['price'] ?? 0),
                'isFree' => (bool) ($m['isFree'] ?? true),
                'isOpened' => (bool) ($m['isOpened'] ?? false),
                'isTip' => (bool) ($m['isTip'] ?? false),
                'tipAmount' => isset($m['tipAmount']) ? (float) $m['tipAmount'] : null,
                'fromQueue' => (bool) ($m['fromQueue'] ?? false),
                'mediaCount' => max(0, (int) ($m['mediaCount'] ?? 0)),
            ];

            // Effective tag: only a creator-sent paid, non-tip message is taggable. A stored
            // override wins, else the OnlyFans default (mass blast = mppv, otherwise chat_ppv).
            // free_preview is manual-only. Applied BEFORE the mass filter below.
            $item['tag'] = null;
            if ($item['from'] === 'creator' && ! $item['isFree'] && $item['price'] > 0 && ! $item['isTip']) {
                $stored = $item['id'] !== null ? ($tags[$item['id']] ?? null) : null;
                $item['tag'] = in_array($stored, ['chat_ppv', 'mppv', 'free_preview'], true)
                    ? $stored
                    : ($item['fromQueue'] ? 'mppv' : 'chat_ppv');
            }

            return $item;
        }, array_values($messages));

        // An UNOPENED mass-message PPV (OnlyFans mass blast, `isFromQueue`) is broadcast
        // noise, not a chatter pitch: left in, the engine reads it as "we already pitched
        // him" (wrong pacing, false don't-chase) and its timestamp can bridge a real
        // session gap. Dropped BEFORE sorting/gap detection so it affects neither. An
        // OPENED one stays — the fan genuinely paid, so spend + post-purchase are correct.
        $isHidden = fn ($m) => $m['tag'] === 'mppv' && ! $m['isOpened'];
        $dropped = array_values(array_filter($items, $isHidden));
        $items = array_values(array_filter($items, fn ($m) => ! $isHidden($m)));

        // Oldest → newest so the session-window scan and the engine transcript are chronological.
        usort($items, fn ($a, $b) => ($a['ts'] ?? 0) <=> ($b['ts'] ?? 0));
        usort($dropped, fn ($a, $b) => ($a['ts'] ?? 0) <=> ($b['ts'] ?? 0));

        $sessionStart = $this->sessionStartIndex($items, $gapHours);

        $out = [];
        $totalSpend = 0.0;
        $tipsSpend = 0.0;

        foreach ($items as $i => $m) {
            $inWindow = $i >= $sessionStart;
            $bubble = [
                'sender' => $m['from'] === 'fan' ? 'customer' : 'model',
                'text' => $m['text'],
                'ts_iso' => $m['ts'] !== null ? date('c', $m['ts']) : now()->toIso8601String(),
            ];

            // Legacy prints this as "[9:02 AM] CUSTOMER: …" — the clock time of each message, which
            // is what lets the AI line a reply up with the time of day. `ts_iso` alone only yields
            // relative gaps ("9 hrs later"). No time → no stamp (legacy skips an empty one).
            if ($m['ts'] !== null) {
                $bubble['ts'] = Carbon::createFromTimestamp($m['ts'], $timezone)->format('g:i A');
            }

            // Legacy's "Came with tip / media" tags, filled from OnlyFans instead of chips: legacy
            // prints them on the line as "CUSTOMER [TIPPED $15 · CAME-WITH-MEDIA]: …" (ui.js
            // fmtMsg). Without them a tip reached the AI as an empty fan line and a photo he sent
            // as nothing at all. Fan lines only; absent (not empty) when neither applies, so a
            // thread with no tips or fan media reaches the engine byte-identical.
            if ($m['from'] === 'fan') {
                $msgTags = [];
                if ($m['isTip']) {
                    $msgTags['tip'] = true;
                    $amount = $m['tipAmount'] ?? $m['price'];
                    if ($amount > 0) {
                        $msgTags['tipAmount'] = $amount;
                    }
                }
                if ($m['mediaCount'] > 0) {
                    $msgTags['customerMedia'] = true;
                }
                if ($msgTags !== []) {
                    $bubble['tags'] = $msgTags;
                }
            }

            if ($inWindow && $m['tag'] !== null) {
                // free_preview is never a ppv bubble, but a paid one still counts as spend.
                if ($m['tag'] !== 'free_preview') {
                    $bubble['sender'] = 'ppv';
                    $bubble['opened'] = $m['isOpened'];
                    $bubble['price'] = $m['price'];
                }
                if ($m['isOpened']) {
                    $totalSpend += $m['price'];
                }
            } elseif ($inWindow && $m['isTip']) {
                // Live tips arrive with the amount in `price` today (normalizeMessage emits no
                // tipAmount, so the `tipAmount ??` read is inert in production). It's forward-compat
                // for live-verify #1: if OnlyFans stores a tip's value in a dedicated field, capture
                // it in normalizeMessage + OfMessage + the generate payload + validation so it reaches here.
                $tipsSpend += $m['tipAmount'] ?? $m['price'];
            }

            $out[] = $bubble;
        }

        $view = fn (array $m): array => array_intersect_key($m, array_flip(
            ['id', 'tag', 'from', 'text', 'ts', 'price', 'isFree', 'isOpened', 'isTip', 'fromQueue'],
        ));

        return [
            'messages' => $out,
            'total_spend' => $totalSpend,
            'tips_spend' => $tipsSpend,
            'thread' => array_map($view, $items),
            'droppedMass' => array_map($view, $dropped),
        ];
    }

    /**
     * Index of the first message of the current session: scan newest→oldest and stop at the
     * first message whose gap to the previous message exceeds the threshold. No gap (or no
     * timestamps) → the whole thread is one session (index 0).
     *
     * @param  list<array{ts: int|null}>  $items  sorted oldest→newest
     */
    private function sessionStartIndex(array $items, int $gapHours): int
    {
        $gapSeconds = $gapHours * 3600;

        for ($i = count($items) - 1; $i > 0; $i--) {
            $cur = $items[$i]['ts'];
            $prev = $items[$i - 1]['ts'];
            if ($cur !== null && $prev !== null && ($cur - $prev) > $gapSeconds) {
                return $i;
            }
        }

        return 0;
    }
}
