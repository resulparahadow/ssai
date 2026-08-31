<?php

namespace App\Models\Concerns;

use App\Models\Scopes\CreatorAccessScope;
use App\Models\User;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\Auth;

/**
 * Reproduces the legacy installChatterIdAutoInject() behaviour plus RLS:
 *
 *  - On create, stamps `user_id` with the authenticated chatter when it is not
 *    already set (so analytics/ownership are never bypassed by forgetting it).
 *  - Applies CreatorAccessScope so chatters only read rows for their assigned
 *    creator models.
 *
 * Use on per-conversation models that have both a `user_id` and a
 * `creator_model` column.
 */
trait BelongsToChatter
{
    public static function bootBelongsToChatter(): void
    {
        static::addGlobalScope(new CreatorAccessScope);

        static::creating(function ($model): void {
            if (empty($model->user_id) && Auth::check()) {
                $model->user_id = Auth::id();
            }
        });
    }

    /** @return BelongsTo<User, $this> */
    public function chatter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }
}
