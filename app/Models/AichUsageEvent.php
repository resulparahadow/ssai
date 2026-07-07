<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One row per LLM call made during a generate() (strategy / generator / retries),
 * grouped by generation_id. Metadata only — no message text. Restores the legacy
 * js/api.js _ssaiCostLog telemetry, persisted so the AI Usage view can read it.
 */
class AichUsageEvent extends Model
{
    public const UPDATED_AT = null; // table has created_at only

    protected $table = 'aich_usage_events';

    protected $fillable = [
        'generation_id',
        'user_id',
        'creator_model',
        'chat_id',
        'session_id',
        'source',
        'call_type',
        'model',
        'input_tokens',
        'cache_read_tokens',
        'cache_create_tokens',
        'output_tokens',
        'cost',
        'cached',
        'duration_ms',
        'tok_per_sec',
        'sys_blocks',
        'created_at',
    ];

    protected $casts = [
        'input_tokens' => 'integer',
        'cache_read_tokens' => 'integer',
        'cache_create_tokens' => 'integer',
        'output_tokens' => 'integer',
        'cost' => 'float',
        'cached' => 'boolean',
        'duration_ms' => 'integer',
        'tok_per_sec' => 'float',
        'sys_blocks' => 'array',
    ];

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
