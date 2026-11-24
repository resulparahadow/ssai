<?php

namespace App\Services\OnlyFans;

use App\Models\AichChatState;

/**
 * The "not ready" warning on a PPV caption. Legacy's own check (`_ppvOverrodeBrain`) compares the
 * phase AFTER PPV mode forced it to send_content, so it almost never fires. Instead this reads the
 * forward plan saved the last time a chatter accepted a draft (`next_planned_move`, legacy's
 * binding plan for the next turn) and warns when it was a non-selling move.
 *
 * The plan only changes on Accept/Send, so it is dropped — no warning, the "don't cry wolf" rule —
 * once it no longer describes this point in the chat: the conversation went quiet past the
 * session gap, a PPV went out after it, or more than one creator message did (the first is
 * usually the accepted draft itself: Accept & Send commits just before sending).
 */
class PpvReadiness
{
    public const WARN = ['rapport_beat', 'qualifying_question', 'aftercare', 'goodbye_script', 'manager_flag'];

    /** @param  list<array<string, mixed>>  $messages  raw generate payload rows (from/time/price/isFree/isTip) */
    public function plan(?AichChatState $state, array $messages, int $now, int $gapSeconds): ?string
    {
        $plan = $state?->next_planned_move;

        if ($plan === null || ! in_array($plan, self::WARN, true) || $state->updated_at === null) {
            return null;
        }

        $at = $state->updated_at->getTimestamp();
        $rows = [];

        foreach ($messages as $m) {
            $ts = isset($m['time']) ? strtotime((string) $m['time']) : false;

            if ($ts !== false) {
                $rows[] = ['ts' => $ts] + $m;
            }
        }

        if (! DraftRejectionService::isActive($at, array_column($rows, 'ts'), $now, $gapSeconds)) {
            return null;
        }

        $creatorAfter = array_filter($rows, fn ($m) => ($m['from'] ?? null) === 'creator' && $m['ts'] > $at);

        foreach ($creatorAfter as $m) {
            if ((float) ($m['price'] ?? 0) > 0 && ! ($m['isFree'] ?? true) && ! ($m['isTip'] ?? false)) {
                return null;
            }
        }

        return count($creatorAfter) > 1 ? null : $plan;
    }
}
