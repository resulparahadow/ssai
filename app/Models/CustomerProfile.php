<?php

namespace App\Models;

use App\Models\Scopes\CreatorAccessScope;
use Illuminate\Database\Eloquent\Model;

/**
 * Long-term per-customer memory, keyed by (creator_model, customer_username).
 * effective spend = total_spend (PPV) + tips_spend.
 */
class CustomerProfile extends Model
{
    protected $table = 'customer_profiles';

    protected $fillable = [
        'creator_model',
        'customer_username',
        'of_fan_id',
        'customer_name',
        'archetype',
        'trust_level',
        'temperature',
        'is_timewaster',
        'tw_auto_cleared_at',
        'subscription_status',
        'total_spend',
        'tips_spend',
        'time_on_page',
        'key_details',
        'crm_notes',
        'locked_fields',
        'sexting_mode',
        'tip_mode',
        'last_seen_at',
    ];

    /** AI-owned fields the folded analysis writes; each can be pinned in locked_fields. */
    public const AI_FIELDS = ['archetype', 'trust_level', 'temperature', 'key_details'];

    public function isLocked(string $field): bool
    {
        return in_array($field, $this->locked_fields ?? [], true);
    }

    protected static function booted(): void
    {
        static::addGlobalScope(new CreatorAccessScope);
    }

    protected $casts = [
        'trust_level' => 'integer',
        'is_timewaster' => 'boolean',
        'tw_auto_cleared_at' => 'datetime',
        'total_spend' => 'decimal:2',
        'tips_spend' => 'decimal:2',
        'time_on_page' => 'integer',
        'locked_fields' => 'array',
        'last_seen_at' => 'datetime',
    ];
}
