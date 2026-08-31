<?php

use App\Broadcasting\CreatorChannel;
use Illuminate\Support\Facades\Broadcast;

Broadcast::channel('App.Models.User.{id}', function ($user, $id) {
    return (int) $user->id === (int) $id;
});

// Live OnlyFans inbound messages for a creator (private-creator.{id}). The browser
// subscribes to the active creator's channel; the webhook broadcasts onto it.
Broadcast::channel('creator.{model}', CreatorChannel::class);
