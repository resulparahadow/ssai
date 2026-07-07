<?php

namespace App\Policies;

use App\Models\User;

/**
 * Team management rules (the /team page is already gated to admins/managers by the
 * `manage-team` route middleware — this policy decides who may act on a given target).
 *
 * - Admin manages anyone.
 * - Manager may edit/delete chatters only (never other managers/admins).
 * - Nobody may delete themselves; the create-role allowlist lives in TeamController.
 */
class UserPolicy
{
    public function update(User $actor, User $target): bool
    {
        return $actor->isAdmin() || ($actor->isManager() && $target->isChatter());
    }

    public function delete(User $actor, User $target): bool
    {
        if ($actor->id === $target->id) {
            return false;
        }

        return $actor->isAdmin() || ($actor->isManager() && $target->isChatter());
    }
}
