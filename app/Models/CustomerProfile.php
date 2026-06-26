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

    protected $guarded = [];

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
        'key_details' => 'array',
        'last_seen_at' => 'datetime',
    ];
}
