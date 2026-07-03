<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Join row: which creator model a chatter may work.
 */
class ModelAssignment extends Model
{
    protected $table = 'model_assignments';

    protected $fillable = [
        'user_id',
        'creator_model',
    ];

    /** @return BelongsTo<User, $this> */
    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
