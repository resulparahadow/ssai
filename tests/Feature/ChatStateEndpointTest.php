<?php

use App\Models\AichChatState;
use App\Models\AichModel;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

beforeEach(function () {
    config([
        'services.onlyfans.key' => 'test-key',
        'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api',
        'services.engine.url' => 'http://127.0.0.1:8787',
    ]);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
});

it('commits strategy memory via POST state', function () {
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->postJson("/onlyfans/{$this->model->id}/chats/101/state", [
            'strategy' => ['phase' => 'sell', 'archetype' => 'Whale'],
            'telemetry' => [
                'lastAnalysis' => ['archetype' => 'Whale'],
                'nextPlannedMove' => 'run_promise_ritual',
                'nextPlannedMoveAtMsg' => 5,
                'promiseStatus' => 'in_progress',
                'storyFrameworkStep' => 2,
            ],
        ])
        ->assertOk()
        ->assertJsonPath('ok', true);

    $row = AichChatState::where('creator_model', 'Camila')->where('chat_id', '101')->first();
    expect($row->last_strategy['phase'])->toBe('sell');
    expect($row->promise_status)->toBe('in_progress');
    expect($row->story_framework_step)->toBe(2);
    expect($row->committed_by)->toBe($admin->id);
});

it('rejects a commit with no strategy (JSON 422)', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/chats/101/state", ['telemetry' => []])
        ->assertStatus(422);
});

it('forbids committing state for an unassigned creator', function () {
    $chatter = User::factory()->create(['role' => 'chatter']); // no assignment

    $this->actingAs($chatter)
        ->postJson("/onlyfans/{$this->model->id}/chats/101/state", ['strategy' => ['phase' => 'sell']])
        ->assertForbidden();
});

it('replays saved chat state on generate', function () {
    AichChatState::create([
        'creator_model' => 'Camila', 'chat_id' => '101',
        'last_strategy' => ['phase' => 'sell'], 'promise_status' => 'in_progress', 'story_framework_step' => 2,
    ]);

    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101, 'isSubscribed' => true]]),
        '127.0.0.1:8787/*' => Http::response(['draft' => 'hi', 'strategy' => ['phase' => 'sell'], 'telemetry' => null, 'usage' => []]),
    ]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/chats/101/generate", [
            'messages' => [['from' => 'fan', 'text' => 'hi']],
            'customer' => ['id' => '101'],
        ])
        ->assertOk();

    Http::assertSent(fn ($r) => str_contains($r->url(), '8787')
        && data_get($r->data(), 'session._promiseStatus') === 'in_progress'
        && data_get($r->data(), 'session._lastStrategy.phase') === 'sell');
});
