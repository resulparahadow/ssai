<?php

namespace App\Models;

use App\Models\Concerns\BelongsToChatter;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One PPV set sent from SSAI to one fan (keyed by chat id), as one OnlyFans message. Written
 * by the chat controller's `send` on a 2xx; read by the PPV rail's per-fan Sent/Bought pill.
 * `user_id` (who sent it) is stamped by BelongsToChatter, which also applies the
 * creator-access scope. Ids, price and time only — never message text.
 */
class PpvSetSend extends Model
{
    use BelongsToChatter;

    protected $table = 'ppv_set_sends';

    protected $fillable = [
        'ppv_set_id',
        'creator_model',
        'of_fan_id',
        'of_message_id',
        'price',
        'user_id',
        'sent_at',
    ];

    protected function casts(): array
    {
        return [
            'price' => 'decimal:2',
            'sent_at' => 'datetime',
        ];
    }

    /** @return BelongsTo<PpvSet, $this> */
    public function set(): BelongsTo
    {
        return $this->belongsTo(PpvSet::class, 'ppv_set_id');
    }
}
