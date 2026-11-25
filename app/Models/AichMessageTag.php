<?php

namespace App\Models;

use App\Models\Concerns\BelongsToChatter;
use Illuminate\Database\Eloquent\Model;

/**
 * A chatter's label on one OnlyFans message (which kind of PPV it was). Metadata only — no
 * message text — keyed by (creator_model, chat_id, message_id).
 */
class AichMessageTag extends Model
{
    use BelongsToChatter;

    public const TAGS = ['chat_ppv', 'mppv', 'free_preview'];

    protected $table = 'aich_message_tags';

    protected $fillable = [
        'creator_model',
        'chat_id',
        'message_id',
        'tag',
        'user_id',
    ];

    /**
     * message_id => tag for one chat. Server use (bypasses the access scope).
     *
     * @return array<string, string>
     */
    public static function forChat(string $creator, string $chat): array
    {
        return static::withoutGlobalScopes()
            ->where('creator_model', $creator)
            ->where('chat_id', $chat)
            ->pluck('tag', 'message_id')
            ->all();
    }
}
