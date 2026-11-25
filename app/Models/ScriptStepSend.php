<?php

namespace App\Models;

use App\Models\Concerns\BelongsToChatter;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * One script step sent from SSAI to one fan (keyed by chat id) as one OnlyFans message, or
 * marked as done by hand (`source = manual`). Written by the chat controller's `send` on a
 * 2xx and by the step "mark" endpoint; read by the per-fan Sent/Bought pill. `user_id` is
 * stamped by BelongsToChatter, which also applies the creator-access scope. The step link is
 * nullOnDelete and `step_title` snapshots the title, so history survives deleting the step.
 * Ids, price and time only — never message text.
 */
class ScriptStepSend extends Model
{
    use BelongsToChatter;

    protected $table = 'script_step_sends';

    protected $fillable = [
        'script_step_id',
        'step_title',
        'creator_model',
        'of_fan_id',
        'of_message_id',
        'price',
        'source',
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

    /** @return BelongsTo<ScriptStep, $this> */
    public function step(): BelongsTo
    {
        return $this->belongsTo(ScriptStep::class, 'script_step_id');
    }
}
