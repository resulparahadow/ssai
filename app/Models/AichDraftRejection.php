<?php

namespace App\Models;

use App\Models\Concerns\BelongsToChatter;
use Illuminate\Database\Eloquent\Model;

/**
 * One AI draft a chatter rejected, with their reason, for a live OnlyFans chat keyed by
 * (creator_model, chat_id). Holds the AI's own rejected output + the chatter's words — no
 * fan message text. `user_id` (who rejected) is stamped by BelongsToChatter, which also
 * applies the creator-access scope. See DraftRejectionService.
 */
class AichDraftRejection extends Model
{
    use BelongsToChatter;

    protected $table = 'aich_draft_rejections';

    protected $fillable = [
        'creator_model',
        'chat_id',
        'user_id',
        'draft',
        'feedback',
    ];
}
