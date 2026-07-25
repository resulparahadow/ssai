<?php

use App\Models\AichModel;
use App\Services\Engine\EngineClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

it('replays saved chat state into the engine session payload', function () {
    config(['services.engine.url' => 'http://127.0.0.1:8787']);
    Http::fake(['127.0.0.1:8787/*' => Http::response([
        'draft' => 'hi', 'strategy' => ['phase' => 'sell'], 'telemetry' => null, 'usage' => [],
    ])]);

    $model = AichModel::create(['name' => 'Camila', 'prompt' => 'x', 'of_account_id' => 'acct_cam']);

    app(EngineClient::class)->generateFromLive($model, [], ['id' => '101'], [
        'state' => [
            'last_strategy' => ['phase' => 'sell'],
            'last_analysis' => ['archetype' => 'Whale'],
            'next_planned_move' => 'run_promise_ritual',
            'next_planned_move_at_msg' => 5,
            'promise_status' => 'in_progress',
            'story_framework_step' => 2,
        ],
    ]);

    Http::assertSent(fn ($r) => data_get($r->data(), 'session._lastStrategy.phase') === 'sell'
        && data_get($r->data(), 'session._lastAnalysis.archetype') === 'Whale'
        && data_get($r->data(), 'session._nextPlannedMove') === 'run_promise_ritual'
        && data_get($r->data(), 'session._nextPlannedMoveAtMsg') === 5
        && data_get($r->data(), 'session._promiseStatus') === 'in_progress'
        && data_get($r->data(), 'session._storyFrameworkStep') === 2);
});
