<?php

use App\Models\AichChatState;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('stores and reads per-chat strategy state', function () {
    $state = AichChatState::create([
        'creator_model' => 'Camila',
        'chat_id' => '101',
        'last_strategy' => ['phase' => 'sell'],
        'last_analysis' => ['archetype' => 'Whale'],
        'next_planned_move' => 'run_promise_ritual',
        'next_planned_move_at_msg' => 5,
        'promise_status' => 'in_progress',
        'story_framework_step' => 2,
    ]);

    $fresh = $state->fresh();
    expect($fresh->last_strategy['phase'])->toBe('sell');
    expect($fresh->last_analysis['archetype'])->toBe('Whale');
    expect($fresh->next_planned_move)->toBe('run_promise_ritual');
    expect($fresh->story_framework_step)->toBe(2);
});
