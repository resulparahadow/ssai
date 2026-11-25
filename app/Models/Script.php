<?php

namespace App\Models;

use App\Models\Scopes\CreatorAccessScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * A named, ordered list of steps (a conversation playbook) for one creator. Manager-owned
 * (writes are `can:manage-team`), readable by every chatter assigned to the creator.
 * No user_id, so it carries the creator-access scope directly.
 */
class Script extends Model
{
    protected $fillable = [
        'creator_model',
        'name',
        'sort_order',
        'created_by',
    ];

    protected function casts(): array
    {
        return ['sort_order' => 'integer'];
    }

    protected static function booted(): void
    {
        static::addGlobalScope(new CreatorAccessScope);
    }

    /** @return HasMany<ScriptStep, $this> */
    public function steps(): HasMany
    {
        return $this->hasMany(ScriptStep::class)->orderBy('sort_order')->orderBy('id');
    }
}
