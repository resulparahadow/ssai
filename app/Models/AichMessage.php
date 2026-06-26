<?php

namespace App\Models;

use App\Models\Concerns\BelongsToChatter;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Dual-purpose: AI draft-log rows (response_text/input_messages/was_sent) and
 * per-message OnlyFans rows (sender/text/of_message_id/send_state).
 */
class AichMessage extends Model
{
    use BelongsToChatter;

    protected $table = 'aich_messages';

    protected $guarded = [];

    protected $casts = [
        'input_messages' => 'array',
        'was_sent' => 'boolean',
    ];

    /** @return BelongsTo<AichSession, $this> */
    public function session(): BelongsTo
    {
        return $this->belongsTo(AichSession::class, 'session_id');
    }
}
