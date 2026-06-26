<?php

namespace App\Models;

use App\Models\Concerns\BelongsToChatter;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Per-conversation state. The behavioural telemetry the legacy app held as
 * in-memory `_`-prefixed fields (posture, free-msg counters, etc.) is recomputed
 * by the engine port (a later spec); this model persists only the durable columns.
 */
class AichSession extends Model
{
    use BelongsToChatter;

    protected $table = 'aich_sessions';

    protected $guarded = [];

    protected $casts = [
        'ladder_state' => 'array',
        'messages' => 'array',
        'messages_input' => 'array',
        'vn_used' => 'array',
        'story_framework_step' => 'integer',
        'free_msg_count' => 'integer',
        'unpaid_cta_count' => 'integer',
        'total_spend' => 'decimal:2',
        'tips_spend' => 'decimal:2',
        'is_flagged' => 'boolean',
        'last_active_at' => 'datetime',
        'session_closed_at' => 'datetime',
        'session_closed_at_msg_count' => 'integer',
    ];

    /** @return HasMany<AichMessage, $this> */
    public function messages(): HasMany
    {
        return $this->hasMany(AichMessage::class, 'session_id');
    }

    /** @return HasMany<AichEvent, $this> */
    public function events(): HasMany
    {
        return $this->hasMany(AichEvent::class, 'session_id');
    }
}
