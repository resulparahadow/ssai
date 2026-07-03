<?php

namespace App\Models;

use App\Models\Scopes\CreatorAccessScope;
use Illuminate\Database\Eloquent\Model;

/**
 * Voice notes already sent to a customer, so the generator never repeats one.
 * Has no user_id, so it carries the creator-access scope directly rather than
 * the full BelongsToChatter trait.
 */
class AichVnUsed extends Model
{
    protected $table = 'aich_vn_used';

    protected $fillable = [
        'creator_model',
        'customer_username',
        'session_id',
        'voice_note_label',
    ];

    protected static function booted(): void
    {
        static::addGlobalScope(new CreatorAccessScope);
    }
}
