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

    protected $fillable = [
        'user_id',
        'creator_model',
        'customer_name',
        'customer_username',
        'status',
        'current_posture',
        'ladder_state',
        'story_framework_step',
        'promise_status',
        'free_msg_count',
        'unpaid_cta_count',
        'total_spend',
        'tips_spend',
        'is_flagged',
        'crm_notes',
        'draft',
        'messages',
        'messages_input',
        'vn_used',
        'aftercare_context',
        'input_mode',
        'of_chat_id',
        'last_active_at',
        'session_closed_at',
        'session_closed_at_msg_count',
    ];

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
