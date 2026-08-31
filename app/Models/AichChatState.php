<?php

namespace App\Models;

use App\Models\Scopes\CreatorAccessScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Carried AI strategy state for one live OnlyFans chat, keyed by (creator_model,
 * chat_id). Replayed into the engine so the next generation continues the prior
 * turn's plan. Stores strategy/analysis metadata only — no message text. Carries
 * creator_model but no user_id, so it takes the creator-access scope directly.
 */
class AichChatState extends Model
{
    protected $table = 'aich_chat_state';

    protected $fillable = [
        'creator_model',
        'chat_id',
        'last_strategy',
        'last_analysis',
        'next_planned_move',
        'next_planned_move_at_msg',
        'promise_status',
        'story_framework_step',
        'committed_by',
    ];

    protected $casts = [
        'last_strategy' => 'array',
        'last_analysis' => 'array',
        'story_framework_step' => 'integer',
        'next_planned_move_at_msg' => 'integer',
    ];

    protected static function booted(): void
    {
        static::addGlobalScope(new CreatorAccessScope);
    }

    /** @return BelongsTo<User, $this> */
    public function committedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'committed_by');
    }
}
