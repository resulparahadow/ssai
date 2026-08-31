<?php

use App\Models\AichModel;
use App\Models\AichUsageEvent;
use App\Models\ModelAssignment;
use App\Models\User;
use App\Services\Dashboard\AiUsageService;
use App\Services\Dashboard\DashboardService;
use App\Support\CreatorContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia;

uses(RefreshDatabase::class);

function ctx(): CreatorContext
{
    return app(CreatorContext::class);
}

/** Insert one aich_usage_events row (one LLM call) for a creator. */
function usageRow(string $creator, float $cost): void
{
    AichUsageEvent::create([
        'generation_id' => (string) Str::ulid(),
        'user_id' => null,
        'creator_model' => $creator,
        'source' => 'live',
        'call_type' => 'generator',
        'model' => 'claude-sonnet-4-6',
        'input_tokens' => 100,
        'cache_read_tokens' => 0,
        'cache_create_tokens' => 0,
        'output_tokens' => 50,
        'cost' => $cost,
        'cached' => false,
        'created_at' => now(),
    ]);
}

beforeEach(function () {
    $this->alpha = AichModel::create(['name' => 'Alpha']);
    $this->beta = AichModel::create(['name' => 'Beta']);
});

// ---- resolver: admin/manager (canSeeAll) -----------------------------------

it('defaults an admin with no cookie to all creators', function () {
    $admin = User::factory()->admin()->create();

    expect(ctx()->resolve($admin, null))->toMatchArray([
        'selectedId' => null,
        'mode' => 'all',
        'canSeeAll' => true,
    ]);
});

it('honors an admin selecting a specific creator', function () {
    $admin = User::factory()->admin()->create();

    expect(ctx()->resolve($admin, (string) $this->alpha->id))->toMatchArray([
        'selectedId' => $this->alpha->id,
        'mode' => 'creator',
    ]);
});

it('honors an admin selecting all creators', function () {
    $admin = User::factory()->admin()->create();

    expect(ctx()->resolve($admin, 'all')['mode'])->toBe('all');
});

it('falls back to all for an admin with an unknown creator id', function () {
    $admin = User::factory()->admin()->create();

    expect(ctx()->resolve($admin, '999999'))->toMatchArray([
        'selectedId' => null,
        'mode' => 'all',
    ]);
});

// ---- resolver: chatter (scoped, never "all") -------------------------------

it('defaults a chatter to their first assigned creator', function () {
    $chatter = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $chatter->id, 'creator_model' => 'Beta']);

    $c = ctx()->resolve($chatter, null);

    expect($c['mode'])->toBe('creator')
        ->and($c['selectedId'])->toBe($this->beta->id)
        ->and($c['canSeeAll'])->toBeFalse();
});

it('rejects a chatter forcing all creators', function () {
    $chatter = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $chatter->id, 'creator_model' => 'Alpha']);

    $c = ctx()->resolve($chatter, 'all');

    expect($c['selectedId'])->toBe($this->alpha->id)
        ->and($c['mode'])->toBe('creator');
});

it('rejects a chatter selecting a creator outside their scope', function () {
    $chatter = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $chatter->id, 'creator_model' => 'Alpha']);

    // Tries Beta (not assigned) → falls back to Alpha.
    expect(ctx()->resolve($chatter, (string) $this->beta->id)['selectedId'])
        ->toBe($this->alpha->id);
});

// ---- selectedName ----------------------------------------------------------

it('maps a selection to a creator name (or null for all)', function () {
    $admin = User::factory()->admin()->create();

    expect(ctx()->selectedName($admin, 'all'))->toBeNull()
        ->and(ctx()->selectedName($admin, (string) $this->beta->id))->toBe('Beta');
});

// ---- service scoping -------------------------------------------------------

it('scopes DashboardService::build to a creator name', function () {
    usageRow('Alpha', 0.10);
    usageRow('Beta', 0.30);
    $admin = User::factory()->admin()->create();

    $all = app(DashboardService::class)->build($admin, '30d', null);
    $scoped = app(DashboardService::class)->build($admin, '30d', 'Alpha');

    expect(collect($all['creators'])->pluck('name')->sort()->values()->all())->toBe(['Alpha', 'Beta'])
        ->and(collect($scoped['creators'])->pluck('name')->all())->toBe(['Alpha'])
        ->and($scoped['selectedCreator'])->toBe('Alpha');
});

it('scopes AiUsageService::build to a creator name', function () {
    usageRow('Alpha', 0.10);
    usageRow('Beta', 0.30);
    $admin = User::factory()->admin()->create();

    $all = app(AiUsageService::class)->build($admin, '30d', null);
    $scoped = app(AiUsageService::class)->build($admin, '30d', 'Alpha');

    expect($all['summary']['totalCalls'])->toBe(2)
        ->and($scoped['summary']['totalCalls'])->toBe(1)
        ->and($scoped['summary']['totalCost'])->toBe(0.1);
});

// ---- middleware share + controller cookie scoping --------------------------

it('shares creatorContext with canSeeAll per role', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->get('/dashboard')
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->where('creatorContext.canSeeAll', true)
            ->where('creatorContext.mode', 'all'));
});

it('scopes the dashboard to the ss_creator cookie', function () {
    usageRow('Alpha', 0.10);
    usageRow('Beta', 0.30);

    $this->actingAs(User::factory()->admin()->create())
        ->withUnencryptedCookie('ss_creator', (string) $this->alpha->id)
        ->get('/dashboard?period=30d')
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->where('dashboard.selectedCreator', 'Alpha')
            ->count('dashboard.creators', 1)
            ->where('dashboard.creators.0.name', 'Alpha'));
});

it('ignores a foreign ss_creator cookie for a chatter', function () {
    $chatter = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $chatter->id, 'creator_model' => 'Alpha']);

    // Chatter tampers the cookie to Beta (not assigned) — resolver falls back to Alpha.
    expect(ctx()->selectedName($chatter, (string) $this->beta->id))->toBe('Alpha');
});
