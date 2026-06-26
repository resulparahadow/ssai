<?php

namespace App\Models;

use App\Models\Concerns\BelongsToChatter;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Analytics events: agent_override, tip_recorded, sexting_mode_toggled,
 * tip_mode_toggled, spend_override, etc. `payload` holds per-event JSON.
 */
class AichEvent extends Model
{
    use BelongsToChatter;

    protected $table = 'aich_events';

    protected $guarded = [];

    protected $casts = [
        'payload' => 'array',
    ];

    /** @return BelongsTo<AichSession, $this> */
    public function session(): BelongsTo
    {
        return $this->belongsTo(AichSession::class, 'session_id');
    }
}
