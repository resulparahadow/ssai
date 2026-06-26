<?php

namespace App\Models\Scopes;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Scope;
use Illuminate\Support\Facades\Auth;

/**
 * Row-level access control, replacing the legacy Supabase RLS policies.
 *
 * Applied to models that carry a `creator_model` column. A chatter only sees
 * rows for creator models they are assigned (model_assignments). Admins and
 * managers are unrestricted. When there is no authenticated user (console,
 * seeders, queue workers, tests that don't act as a user) the scope is a
 * no-op, so background work and fixtures are never silently filtered.
 */
class CreatorAccessScope implements Scope
{
    public function apply(Builder $builder, Model $model): void
    {
        $user = Auth::user();

        if ($user === null || $user->canSeeAllCreators()) {
            return;
        }

        $assigned = $user->assignedCreatorModels();

        // No assignments → see nothing (whereIn on an empty set yields no rows).
        $builder->whereIn($model->qualifyColumn('creator_model'), $assigned);
    }
}
