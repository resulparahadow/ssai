<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * The global agency training "brain" (legacy DEFAULT_TRAINING). Exactly one row
 * should be is_active = true; sha256 backs the integrity check. The doctrine
 * text is authored outside this repo and is not part of the Phase-1 port.
 */
class Doctrine extends Model
{
    protected $table = 'doctrines';

    protected $fillable = [
        'version',
        'prompt',
        'sha256',
        'tier',
        'is_active',
        'notes',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    /** @param Builder<Doctrine> $query */
    public function scopeActive(Builder $query): void
    {
        $query->where('is_active', true);
    }
}
