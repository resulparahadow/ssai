<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;

/**
 * Real-life creator status entries. "Active" = not past expires_at.
 */
class CreatorStatus extends Model
{
    protected $table = 'creator_status';

    protected $fillable = [
        'creator_model',
        'category',
        'status_text',
        'expires_at',
    ];

    protected $casts = [
        'expires_at' => 'datetime',
    ];

    /** @param Builder<CreatorStatus> $query */
    public function scopeActive(Builder $query): void
    {
        $query->where(function (Builder $q): void {
            $q->whereNull('expires_at')->orWhere('expires_at', '>', now());
        });
    }
}
