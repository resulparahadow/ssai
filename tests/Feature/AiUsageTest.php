<?php

use App\Models\AichModel;
use App\Models\AichSession;
use App\Models\AichUsageEvent;
use App\Models\ModelAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Inertia\Testing\AssertableInertia;

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['services.onlyfans.key' => 'test-key', 'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api']);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
});

/** Two-call ledger the engine returns from /generate. */
function engineUsageResponse(): array
{
    return [
        'draft' => 'aw that means a lot babe',
        'strategy' => null,
        'telemetry' => null,
        'usage' => [
            [
                'callType' => 'strategy_sonnet', 'modelUsed' => 'claude-sonnet-4-6',
                'input' => 120, 'cacheRead' => 33000, 'cacheCreate' => 0, 'output' => 300,
                'cost' => 0.012, 'cached' => true, 'durationMs' => 4200, 'tokPerSec' => 71.4,
                'sysBlocks' => [['idx' => 0, 'hasCacheControl' => true, 'chars' => 132000, 'estTokens' => 33000]],
            ],
            [
                'callType' => 'generator', 'modelUsed' => 'claude-sonnet-4-6',
                'input' => 200, 'cacheRead' => 0, 'cacheCreate' => 8000, 'output' => 60,
                'cost' => 0.05, 'cached' => false, 'durationMs' => 1500, 'tokPerSec' => 40.0,
                'sysBlocks' => [],
            ],
        ],
    ];
}

it('persists the usage ledger as metadata when generating from the live thread', function () {
    Http::fake(['127.0.0.1:8787/*' => Http::response(engineUsageResponse())]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/chats/101/generate", [
            'messages' => [['from' => 'fan', 'text' => 'my day was long but better talking to you']],
            'customer' => ['id' => '101', 'name' => 'Jake'],
        ])
        ->assertOk()
        ->assertJsonPath('draft', 'aw that means a lot babe');

    expect(AichUsageEvent::count())->toBe(2);
    // both calls share one generation_id
    expect(AichUsageEvent::distinct('generation_id')->count('generation_id'))->toBe(1);

    $strategy = AichUsageEvent::where('call_type', 'strategy_sonnet')->first();
    expect($strategy->source)->toBe('live');
    expect($strategy->creator_model)->toBe('Camila');
    expect($strategy->chat_id)->toBe('101');
    expect($strategy->cache_read_tokens)->toBe(33000);
    expect($strategy->cached)->toBeTrue();
    expect((float) $strategy->cost)->toBe(0.012);
    expect($strategy->sys_blocks[0]['hasCacheControl'])->toBeTrue();
});

it('persists usage from the dev session generate path', function () {
    Http::fake(['127.0.0.1:8787/*' => Http::response(engineUsageResponse())]);
    $admin = User::factory()->admin()->create();
    $session = AichSession::create([
        'creator_model' => 'Camila', 'customer_username' => 'jake', 'customer_name' => 'Jake',
        'messages' => [['sender' => 'customer', 'text' => 'hi']],
    ]);

    $this->actingAs($admin)->postJson("/dev/generate/{$session->id}")->assertOk();

    expect(AichUsageEvent::count())->toBe(2);
    $row = AichUsageEvent::first();
    expect($row->source)->toBe('session');
    expect($row->session_id)->toBe($session->id);
    expect($row->user_id)->toBe($admin->id);
});

it('stores no message text — only metering metadata', function () {
    foreach (['text', 'response_text', 'draft', 'messages', 'input_messages'] as $col) {
        expect(Schema::hasColumn('aich_usage_events', $col))->toBeFalse();
    }
});

it('serves the AI usage summary with the legacy $/msg + cache-hit math', function () {
    $admin = User::factory()->admin()->create();
    // 3 calls across 2 generations; 2 cached → hit rate 2/3 ≈ 67% (green).
    AichUsageEvent::insert([
        ['generation_id' => 'gen1', 'creator_model' => 'Camila', 'source' => 'live', 'call_type' => 'strategy_sonnet', 'model' => 'claude-sonnet-4-6', 'input_tokens' => 100, 'cache_read_tokens' => 3000, 'cache_create_tokens' => 0, 'output_tokens' => 200, 'cost' => 0.02, 'cached' => true, 'created_at' => now()],
        ['generation_id' => 'gen1', 'creator_model' => 'Camila', 'source' => 'live', 'call_type' => 'generator', 'model' => 'claude-sonnet-4-6', 'input_tokens' => 150, 'cache_read_tokens' => 0, 'cache_create_tokens' => 4000, 'output_tokens' => 60, 'cost' => 0.03, 'cached' => false, 'created_at' => now()],
        ['generation_id' => 'gen2', 'creator_model' => 'Camila', 'source' => 'live', 'call_type' => 'strategy_sonnet', 'model' => 'claude-sonnet-4-6', 'input_tokens' => 100, 'cache_read_tokens' => 3000, 'cache_create_tokens' => 0, 'output_tokens' => 200, 'cost' => 0.05, 'cached' => true, 'created_at' => now()],
    ]);

    $this->actingAs($admin)
        ->get('/analytics/ai-usage')
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->component('AiUsage')
            ->where('usage.summary.totalCalls', 3)
            ->where('usage.summary.generations', 2)
            ->where('usage.summary.totalCost', 0.1)
            ->where('usage.summary.costPerMsg', 0.05) // 0.10 / 2 generations
            ->where('usage.summary.cacheLabel', '67%')
            ->where('usage.summary.cacheColor', 'neutral') // 67% is 40–69 → neutral
            ->has('usage.recent', 3));
});

it('is manager/admin only — chatters are forbidden', function () {
    $chatter = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $chatter->id, 'creator_model' => 'Camila']);

    $this->actingAs($chatter)->get('/analytics/ai-usage')->assertForbidden();
    $this->actingAs(User::factory()->manager()->create())->get('/analytics/ai-usage')->assertOk();
});
