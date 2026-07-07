<?php

use App\Models\AichModel;
use App\Models\AichUsageEvent;
use App\Models\User;
use App\Services\Dashboard\DashboardService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia;

uses(RefreshDatabase::class);

/** Insert one aich_usage_events row (one LLM call) with sensible defaults. */
function usageCall(array $attrs = []): AichUsageEvent
{
    return AichUsageEvent::create(array_merge([
        'generation_id' => (string) Str::ulid(),
        'user_id' => null,
        'creator_model' => 'Alpha',
        'source' => 'live',
        'call_type' => 'generator',
        'model' => 'claude-sonnet-4-6',
        'input_tokens' => 100,
        'cache_read_tokens' => 0,
        'cache_create_tokens' => 0,
        'output_tokens' => 50,
        'cost' => 0.10,
        'cached' => false,
        'created_at' => now(),
    ], $attrs));
}

beforeEach(function () {
    AichModel::create(['name' => 'Alpha']);
    AichModel::create(['name' => 'Beta']);
    $this->worker = User::factory()->chatter()->create(['name' => 'Work Er']);

    // Generation g1: creator Alpha, made by the worker, 2 calls (one cache hit).
    $g1 = (string) Str::ulid();
    usageCall(['generation_id' => $g1, 'user_id' => $this->worker->id, 'creator_model' => 'Alpha', 'cost' => 0.10, 'cache_read_tokens' => 0]);
    usageCall(['generation_id' => $g1, 'user_id' => $this->worker->id, 'creator_model' => 'Alpha', 'cost' => 0.20, 'cache_read_tokens' => 500]);

    // Generation g2: creator Beta, no attributed user, 1 call, no cache.
    usageCall(['generation_id' => (string) Str::ulid(), 'user_id' => null, 'creator_model' => 'Beta', 'cost' => 0.30, 'cache_read_tokens' => 0]);
});

it('builds AI KPIs across all creators for an admin', function () {
    $admin = User::factory()->admin()->create();
    $d = app(DashboardService::class)->build($admin, '30d');

    $kpi = collect($d['aiKpis'])->keyBy('key');

    expect($d['aiKpis'])->toHaveCount(4)
        ->and($kpi['cost']['value'])->toBe('$0.60')            // 0.10 + 0.20 + 0.30
        ->and($kpi['generations']['value'])->toBe('2')          // g1, g2
        ->and($kpi['perMsg']['value'])->toBe('$0.30')           // 0.60 / 2
        ->and($kpi['cache']['value'])->toBe('33%')              // 1 cached of 3 calls
        ->and($kpi['cache']['color'])->toBe('neg')              // 33% < 40%
        ->and($d['canViewAllCreators'])->toBeTrue()
        ->and(collect($d['creators'])->pluck('name')->sort()->values()->all())->toBe(['Alpha', 'Beta']);
});

it('scopes a chatter to their own generations only', function () {
    $d = app(DashboardService::class)->build($this->worker, '30d');
    $kpi = collect($d['aiKpis'])->keyBy('key');

    expect($kpi['cost']['value'])->toBe('$0.30')                // only g1 (worker's) = 0.10 + 0.20
        ->and($kpi['generations']['value'])->toBe('1')
        ->and(collect($d['creators'])->pluck('name')->all())->toBe(['Alpha'])
        ->and($d['canViewAllCreators'])->toBeFalse();
});

it('builds a chatter AI-activity leaderboard', function () {
    $admin = User::factory()->admin()->create();
    $d = app(DashboardService::class)->build($admin, '30d');
    $row = collect($d['chatters'])->firstWhere('name', 'Work Er');

    expect($row)->not->toBeNull()
        ->and($row['generations'])->toBe(1)
        ->and($row['cost'])->toBe('$0.30')
        ->and($row['cachePct'])->toBe('50%');                   // 1 cached of the worker's 2 calls
});

it('renders the Inertia dashboard for an authenticated user', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->get('/dashboard')
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('Dashboard')
            ->has('dashboard.aiKpis', 4)
            ->has('dashboard.creators')
            ->where('dashboard.canViewAllCreators', true)
        );
});
