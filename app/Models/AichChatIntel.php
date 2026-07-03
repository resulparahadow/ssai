<?php

namespace App\Models;

use App\Models\Scopes\CreatorAccessScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Latest AI Intel (the generate() strategy object) for one live OnlyFans chat,
 * keyed by (creator_model, chat_id). Stores ONLY the analysis strategy shown in
 * the Conversations right-rail — no message text. Carries creator_model but no
 * user_id, so it takes the creator-access scope directly (like AichVnUsed).
 */
class AichChatIntel extends Model
{
    protected $table = 'aich_chat_intel';

    protected $fillable = [
        'creator_model',
        'chat_id',
        'generated_by',
        'strategy',
    ];

    protected $casts = [
        'strategy' => 'array',
    ];

    protected static function booted(): void
    {
        static::addGlobalScope(new CreatorAccessScope);
    }

    /** @return BelongsTo<User, $this> */
    public function generatedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'generated_by');
    }
}
