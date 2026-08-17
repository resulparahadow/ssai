<?php

namespace App\Services\OnlyFans;

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
     * @return array{messages: list<array<string, mixed>>, total_spend: float, tips_spend: float}
     */
    public function map(array $messages, int $gapHours = 12): array
    {
        $items = array_map(function (array $m): array {
            $ts = isset($m['time']) && $m['time'] !== null ? strtotime((string) $m['time']) : false;

            return [
                'from' => ($m['from'] ?? 'fan') === 'creator' ? 'creator' : 'fan',
                'text' => (string) ($m['text'] ?? ''),
                'ts' => $ts === false ? null : $ts,
                'price' => (float) ($m['price'] ?? 0),
                'isFree' => (bool) ($m['isFree'] ?? true),
                'isOpened' => (bool) ($m['isOpened'] ?? false),
                'isTip' => (bool) ($m['isTip'] ?? false),
                'tipAmount' => isset($m['tipAmount']) ? (float) $m['tipAmount'] : null,
            ];
        }, array_values($messages));

        // Oldest → newest so the session-window scan and the engine transcript are chronological.
        usort($items, fn ($a, $b) => ($a['ts'] ?? 0) <=> ($b['ts'] ?? 0));

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

            if ($inWindow && $m['from'] === 'creator' && ! $m['isFree'] && $m['price'] > 0 && ! $m['isTip']) {
                $bubble['sender'] = 'ppv';
                $bubble['opened'] = $m['isOpened'];
                $bubble['price'] = $m['price'];
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

        return ['messages' => $out, 'total_spend' => $totalSpend, 'tips_spend' => $tipsSpend];
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
