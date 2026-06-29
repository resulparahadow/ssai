<?php

namespace App\Broadcasting;

use App\Models\AichModel;
use App\Models\User;

/**
 * Authorizes the private `creator.{model}` channel that carries live OnlyFans inbound
 * messages. Scoped exactly like OnlyFansChatController::account(): admins/managers may
 * watch any creator, chatters only the ones assigned to them.
 */
class CreatorChannel
{
    public function join(User $user, AichModel $model): bool
    {
        return $user->canSeeAllCreators() || in_array($model->name, $user->assignedCreatorModels(), true);
    }
}
