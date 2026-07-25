<?php

use App\Models\AichChatState;
use App\Models\AichModel;
use App\Models\User;
use App\Services\OnlyFans\ChatStateService;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->user = User::create([
        'name' => 'Test User',
        'email' => 'test@example.com',
        'password' => bcrypt('password'),
    ]);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'x', 'of_account_id' => 'acct_cam']);
    $this->svc = app(ChatStateService::class);
});

it('returns cold-start defaults when no state row exists', function () {
    $s = $this->svc->toEngineState($this->svc->find($this->model, '101'));
    expect($s['promise_status'])->toBe('not_started');
    expect($s['story_framework_step'])->toBe(0);
    expect($s['last_strategy'])->toBeNull();
});

it('commits strategy + telemetry then loads them back', function () {
    $this->svc->commit($this->model, '101', ['phase' => 'sell'], [
        'lastAnalysis' => ['archetype' => 'Whale'],
        'nextPlannedMove' => 'run_promise_ritual',
        'nextPlannedMoveAtMsg' => 5,
        'promiseStatus' => 'in_progress',
        'storyFrameworkStep' => 2,
    ], $this->user->id);

    $s = $this->svc->toEngineState($this->svc->find($this->model, '101'));
    expect($s['last_strategy']['phase'])->toBe('sell');
    expect($s['last_analysis']['archetype'])->toBe('Whale');
    expect($s['next_planned_move'])->toBe('run_promise_ritual');
    expect($s['promise_status'])->toBe('in_progress');
    expect($s['story_framework_step'])->toBe(2);

    expect(AichChatState::where('chat_id', '101')->first()->committed_by)->toBe($this->user->id);
});

it('upserts in place on a second commit', function () {
    $this->svc->commit($this->model, '101', ['phase' => 'rapport'], [], null);
    $this->svc->commit($this->model, '101', ['phase' => 'sell'], [], null);

    expect(AichChatState::where('chat_id', '101')->count())->toBe(1);
    expect($this->svc->find($this->model, '101')->last_strategy['phase'])->toBe('sell');
});
