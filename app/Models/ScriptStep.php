<?php

namespace App\Models;

use App\Models\Scopes\CreatorAccessScope;
use Illuminate\Database\Eloquent\Casts\Attribute;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * One step of a script: text, optionally with vault media and a price (the old "PPV set").
 *
 * `media`: list<array{id: string, type: string, thumb: string|null}> — vault ids, which is
 * what the send endpoint's `mediaFiles` takes; may be empty (a text-only step).
 */
class ScriptStep extends Model
{
    protected $fillable = [
        'script_id',
        'creator_model',
        'title',
        'text',
        'fallback_name',
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

    /** `text` (no media), `free` (media, price 0) or `ppv` (media + price). */
    protected function kind(): Attribute
    {
        return Attribute::get(function (): string {
            if (empty($this->media)) {
                return 'text';
            }

            return (float) $this->price > 0 ? 'ppv' : 'free';
        });
    }

    /** @return BelongsTo<Script, $this> */
    public function script(): BelongsTo
    {
        return $this->belongsTo(Script::class);
    }

    /** @return HasMany<ScriptStepSend, $this> */
    public function sends(): HasMany
    {
        return $this->hasMany(ScriptStepSend::class, 'script_step_id');
    }
}
