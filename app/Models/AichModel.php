<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * Creator persona + content library. `name` is the isolation boundary that
 * `creator_model` string columns elsewhere refer to. `content_library` and
 * `feedback_rules` are freeform text the manager edits in the Models settings.
 */
class AichModel extends Model
{
    protected $table = 'aich_models';

    protected $fillable = [
        'name',
        'prompt',
        'content_library',
        'feedback_rules',
        'tier',
        'of_account_id',
    ];

    /** Assignments are matched on the creator name, not a FK (legacy convention). */
    public function assignments(): HasMany
    {
        return $this->hasMany(ModelAssignment::class, 'creator_model', 'name');
    }
}
