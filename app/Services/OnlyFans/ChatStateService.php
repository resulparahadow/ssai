<?php

namespace App\Services\OnlyFans;

use App\Models\AichChatState;
use App\Models\AichModel;
use Illuminate\Support\Carbon;

/**
 * Owns the live-path carry-forward strategy state (aich_chat_state keyed by
 * (creator_model, of_fan_id = chat id)). Loaded into the engine on generate and
 * committed when a generated draft is accepted/sent. Metadata only — no message text.
 *
 * See docs/superpowers/specs/2026-07-25-conversation-strategy-continuity-design.md.
 */
class ChatStateService
{
    /** Read the stored state without creating a row (controller has already scoped access). */
    public function find(AichModel $model, string $chatId): ?AichChatState
    {
        return AichChatState::withoutGlobalScopes()
            ->where('creator_model', $model->name)
            ->where('chat_id', $chatId)
            ->first();
    }

    /**
     * The engine `opts['state']` shape. Null-safe: absent state → legacy cold-start
     * defaults, so a brand-new chat behaves exactly as before.
     *
     * @return array<string, mixed>
     */
    public function toEngineState(?AichChatState $state): array
    {
        return [
            'last_strategy' => $state?->last_strategy,
            'last_analysis' => $state?->last_analysis,
            'next_planned_move' => $state?->next_planned_move,
            'next_planned_move_at_msg' => $state?->next_planned_move_at_msg,
            'promise_status' => $state?->promise_status ?? 'not_started',
            'story_framework_step' => (int) ($state?->story_framework_step ?? 0),
        ];
    }

    /**
     * Persist the carried state from a generation the chatter adopted (Accept / Send).
     *
     * A field with a manual state switch is pinned, not earned: it is never written (spec
     * §10a), so Auto resumes from SSAI's own last value. Today that is `promise_status`
     * (the Promise switch), skipped while it is set OR when the draft was generated under it
     * (`telemetry.promisePinned`, stamped at generate); Phase is note-only and has nothing to persist.
     *
     * The §5c counters advance here too, once per fan message (see countOnCommit).
     *
     * @param  array<string, mixed>  $strategy  the generate response's strategy object
     * @param  array<string, mixed>  $telemetry  the generate response's telemetry object
     * @param  array<string, mixed>  $overrides  the fan's manual switches (customer_profiles.state_overrides)
     */
    public function commit(AichModel $model, string $chatId, array $strategy, array $telemetry, ?int $userId, array $overrides = []): AichChatState
    {
        $attributes = [
            'last_strategy' => $strategy,
            'committed_by' => $userId,
        ];

        // Progress fields come from the engine telemetry. Only overwrite them when
        // telemetry is actually present, so a telemetry-less commit can't reset a
        // chat's promise/story progress back to defaults.
        if ($telemetry !== []) {
            $attributes['last_analysis'] = $telemetry['lastAnalysis'] ?? null;
            $attributes['next_planned_move'] = $telemetry['nextPlannedMove'] ?? null;
            $attributes['next_planned_move_at_msg'] = $telemetry['nextPlannedMoveAtMsg'] ?? null;
            if (! isset($overrides['promise']) && empty($telemetry['promisePinned'])) {
                $attributes['promise_status'] = $telemetry['promiseStatus'] ?? 'not_started';
            }
            $attributes['story_framework_step'] = (int) ($telemetry['storyFrameworkStep'] ?? 0);
        }

        $state = AichChatState::withoutGlobalScopes()->updateOrCreate(
            ['creator_model' => $model->name, 'chat_id' => $chatId],
            $attributes,
        );

        $this->countOnCommit($state, $strategy, $telemetry);

        return $state;
    }

    /**
     * §5c counters on an adopted draft. Each counts at most once per fan message: the generate
     * response's telemetry carries the newest fan message's time (`fanMessageAt`, stamped
     * server-side by the controller), and a counter only moves for a fan message newer than the
     * one it last counted. Times are compared as unix seconds (UTC).
     *
     * - objection redirects: the strategy saw an objection wall, or the draft came from the
     *   Objection intent;
     * - sex-only pulls: legacy's fork read `vending_machine_attempt`, or the Lane switch was
     *   sex-only and the fan's message was sexual (`fanSexual`). The Lane alone never counts.
     *
     * @param  array<string, mixed>  $strategy
     * @param  array<string, mixed>  $telemetry
     */
    protected function countOnCommit(AichChatState $state, array $strategy, array $telemetry): void
    {
        $fanAt = $this->time($telemetry['fanMessageAt'] ?? null);
        if ($fanAt === null) {
            return;
        }
        // No resets here: refreshCounters() owns them (one rule). It runs on every generate with
        // the full thread — the walked session-gap rule (DraftRejectionService::isActive) and the
        // opened-PPV check — so by the time this generate's draft is committed the counters are
        // already current for the thread it saw. Re-checking from two stamps here used a cruder
        // gap rule and could zero a counter that generate had just kept.
        $hits = [
            'objection' => ($strategy['wall_detected'] ?? null) === 'objection'
                || ($telemetry['intent'] ?? null) === 'objection',
            'sex_only' => ($telemetry['forkType'] ?? null) === 'vending_machine_attempt'
                || (($telemetry['lane'] ?? null) === 'sex_only' && ($telemetry['fanSexual'] ?? false) === true),
        ];

        $dirty = false;
        foreach (self::COUNTERS as $kind => [$countCol, $atCol]) {
            $countedAt = $state->{$atCol}?->getTimestamp();
            if ($hits[$kind] && ($countedAt === null || $fanAt > $countedAt)) {
                $state->{$countCol} = (int) $state->{$countCol} + 1;
                $state->{$atCol} = Carbon::createFromTimestamp($fanAt, config('app.timezone'));
                $dirty = true;
            }
        }

        if ($dirty) {
            $state->save();
        }
    }

    /**
     * The counters as of THIS thread, at generate: reset to 0 (and persisted) when the thread
     * shows an opened PPV newer than the last count, or the chat went quiet for longer than the
     * session gap after it. The last-counted time is kept, so a reset is idempotent.
     *
     * @param  list<int>  $messageTimes  every message's unix time, ascending
     * @return array{objectionRedirects: int, sexOnlyPulls: int}
     */
    public function refreshCounters(?AichChatState $state, array $messageTimes, ?int $openedPpvAt, ?int $now = null): array
    {
        if ($state === null) {
            return $this->counters(null);
        }
        $now ??= now()->getTimestamp();
        $gap = $this->gapSeconds();

        $dirty = false;
        foreach (self::COUNTERS as [$countCol, $atCol]) {
            $countedAt = $state->{$atCol}?->getTimestamp();
            if ($countedAt === null || (int) $state->{$countCol} === 0) {
                continue;
            }
            $stale = ($openedPpvAt !== null && $openedPpvAt > $countedAt)
                || ! DraftRejectionService::isActive($countedAt, $messageTimes, $now, $gap);
            if ($stale) {
                $state->{$countCol} = 0;
                $dirty = true;
            }
        }
        if ($dirty) {
            $state->save();
        }

        return $this->counters($state);
    }

    /** @return array{objectionRedirects: int, sexOnlyPulls: int} */
    public function counters(?AichChatState $state): array
    {
        return [
            'objectionRedirects' => (int) ($state?->objection_redirects ?? 0),
            'sexOnlyPulls' => (int) ($state?->sex_only_pulls ?? 0),
        ];
    }

    /** kind => [count column, last-counted column] */
    private const COUNTERS = [
        'objection' => ['objection_redirects', 'objection_counted_at'],
        'sex_only' => ['sex_only_pulls', 'sex_only_counted_at'],
    ];

    private function gapSeconds(): int
    {
        return (int) config('services.engine.session_gap_hours', 12) * 3600;
    }

    private function time(mixed $iso): ?int
    {
        if (! is_string($iso) || $iso === '') {
            return null;
        }
        $t = strtotime($iso);

        return $t === false ? null : $t;
    }
}
