<?php

namespace App\Services\OnlyFans;

use App\Models\AichDraftRejection;
use App\Models\AichModel;
use Illuminate\Support\Collection;

/**
 * Rejected AI drafts per live chat (legacy "Feedback → Submit & Reject"). They feed the next
 * generations as legacy's `_sessionFeedback` — but only for the CURRENT conversation: a reason
 * like "don't sell today" must not block tomorrow's sales. Rows stay as history either way.
 */
class DraftRejectionService
{
    /** How many active rejections reach the AI — the newest, so the prompt can't grow unbounded. */
    public const LIMIT = 5;

    /** How far back to look for candidates; far more than LIMIT survive only in huge sessions. */
    private const CANDIDATES = 30;

    /** @return Collection<int, AichDraftRejection> oldest first (controller has already scoped access) */
    public function recent(AichModel $model, string $chatId): Collection
    {
        return AichDraftRejection::withoutGlobalScopes()
            ->with('chatter:id,name')
            ->where('creator_model', $model->name)
            ->where('chat_id', $chatId)
            ->latest('created_at')->latest('id')
            ->take(self::CANDIDATES)
            ->get()
            ->reverse()
            ->values();
    }

    /**
     * The rejections still steering this conversation, oldest first, at most LIMIT.
     *
     * @param  list<string|null>  $messageTimes  the thread's message times as generate received them
     * @return Collection<int, AichDraftRejection>
     */
    public function active(AichModel $model, string $chatId, array $messageTimes): Collection
    {
        $gap = (int) config('services.engine.session_gap_hours', 12) * 3600;
        $now = now()->getTimestamp();

        $times = array_values(array_filter(array_map(
            fn ($t) => $t ? strtotime((string) $t) : false,
            $messageTimes,
        )));
        sort($times);

        return $this->recent($model, $chatId)
            ->filter(fn (AichDraftRejection $r) => self::isActive($r->created_at->getTimestamp(), $times, $now, $gap))
            ->take(-self::LIMIT)
            ->values();
    }

    /**
     * A rejection steers the AI until the chat goes quiet for longer than the session gap after
     * it — the same gap LiveThreadMapper uses to split session spend. Walks from the rejection
     * through every later message to `now`; any step longer than `$gap` ends its conversation.
     * Starting from the rejection (not the thread's session start) keeps one made while
     * re-engaging a quiet fan: it sits after the quiet stretch, not before it.
     *
     * Mirrored client-side by `isRejectionActive` in resources/js/lib/draftRejections.ts (the
     * list of what the AI is avoiding) — keep the two in step.
     *
     * @param  list<int>  $times  message unix times, ascending
     */
    public static function isActive(int $at, array $times, int $now, int $gap): bool
    {
        $prev = $at;

        foreach ($times as $t) {
            if ($t <= $at) {
                continue;
            }
            if ($t - $prev > $gap) {
                return false;
            }
            $prev = $t;
        }

        return $now - $prev <= $gap;
    }

    /**
     * Legacy's `_sessionFeedback` entry shape — the generator prints `Rejection N: "<first 100
     * chars of rejectedMsg>" — Agent feedback: <feedback>`.
     *
     * @param  Collection<int, AichDraftRejection>  $rejections
     * @return list<array{feedback: string, rejectedMsg: string}>
     */
    public function toEngineFeedback(Collection $rejections): array
    {
        // A JSON list, not an object: legacy iterates it with `.map`.
        return array_values($rejections
            ->map(fn (AichDraftRejection $r) => ['feedback' => $r->feedback, 'rejectedMsg' => $r->draft])
            ->all());
    }

    /** @return array{id: int, feedback: string, draft: string, createdAt: string|null, by: string|null} */
    public function present(AichDraftRejection $r): array
    {
        return [
            'id' => $r->id,
            'feedback' => $r->feedback,
            'draft' => $r->draft,
            'createdAt' => $r->created_at?->toIso8601String(),
            'by' => $r->chatter?->name,
        ];
    }
}
