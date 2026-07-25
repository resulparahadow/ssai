<?php

namespace App\Services\OnlyFans;

use App\Models\AichChatState;
use App\Models\AichModel;

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
     * @param  array<string, mixed>  $strategy   the generate response's strategy object
     * @param  array<string, mixed>  $telemetry  the generate response's telemetry object
     */
    public function commit(AichModel $model, string $chatId, array $strategy, array $telemetry, ?int $userId): AichChatState
    {
        return AichChatState::withoutGlobalScopes()->updateOrCreate(
            ['creator_model' => $model->name, 'chat_id' => $chatId],
            [
                'last_strategy' => $strategy,
                'last_analysis' => $telemetry['lastAnalysis'] ?? null,
                'next_planned_move' => $telemetry['nextPlannedMove'] ?? null,
                'next_planned_move_at_msg' => $telemetry['nextPlannedMoveAtMsg'] ?? null,
                'promise_status' => $telemetry['promiseStatus'] ?? 'not_started',
                'story_framework_step' => (int) ($telemetry['storyFrameworkStep'] ?? 0),
                'committed_by' => $userId,
            ],
        );
    }
}
