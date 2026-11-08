<?php

namespace App\Models;

use App\Models\Scopes\CreatorAccessScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A creator-wide saved PPV: ordered vault media + price + default caption, loaded into the
 * composer from the Conversations PPV rail. Manager-owned (writes are `can:manage-team`),
 * readable by every chatter assigned to the creator. Has no user_id, so it carries the
 * creator-access scope directly (like AichVnUsed) rather than BelongsToChatter.
 *
 * `media`: list<array{id: string, type: string, thumb: string|null}> — vault ids, which is
 * what the send endpoint's `mediaFiles` takes. See the ppv_sets migration for the thumb rule.
 */
class PpvSet extends Model
{
    protected $table = 'ppv_sets';

    protected $fillable = [
        'creator_model',
        'name',
        'caption',
        'price',
        'media',
        'sort_order',
        'created_by',
    ];

    protected function casts(): array
    {
        return [
            'media' => 'array',
            'price' => 'decimal:2',
            'sort_order' => 'integer',
        ];
    }

    protected static function booted(): void
    {
        static::addGlobalScope(new CreatorAccessScope);
    }

    /** @return HasMany<PpvSetSend, $this> */
    public function sends(): HasMany
    {
        return $this->hasMany(PpvSetSend::class, 'ppv_set_id');
    }
}
