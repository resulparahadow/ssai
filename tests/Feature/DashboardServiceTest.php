<?php

use App\Models\AichMessage;
use App\Models\AichModel;
use App\Models\AichSession;
use App\Models\CustomerProfile;
use App\Models\ModelAssignment;
use App\Models\User;
use App\Services\Dashboard\DashboardService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia;

uses(RefreshDatabase::class);

beforeEach(function () {
    AichModel::create(['name' => 'Alpha']);
    AichModel::create(['name' => 'Beta']);

    $this->worker = User::factory()->chatter()->create(['name' => 'Work Er']);
    ModelAssignment::create(['user_id' => $this->worker->id, 'creator_model' => 'Alpha']);

    CustomerProfile::create(['creator_model' => 'Alpha', 'customer_username' => 'a1', 'subscription_status' => 'paid', 'total_spend' => 100, 'tips_spend' => 20]);
    CustomerProfile::create(['creator_model' => 'Alpha', 'customer_username' => 'a2', 'subscription_status' => 'free']);
    CustomerProfile::create(['creator_model' => 'Beta', 'customer_username' => 'b1', 'subscription_status' => 'paid', 'total_spend' => 50]);

    $alpha = AichSession::create(['user_id' => $this->worker->id, 'creator_model' => 'Alpha', 'customer_username' => 'a1', 'total_spend' => 100, 'tips_spend' => 20]);
    AichSession::create(['creator_model' => 'Beta', 'customer_username' => 'b1', 'total_spend' => 50]);
    AichMessage::create(['session_id' => $alpha->id, 'user_id' => $this->worker->id, 'creator_model' => 'Alpha', 'sender' => 'creator', 'text' => 'hi', 'was_sent' => true]);
});

it('aggregates every creator for an admin', function () {
    $admin = User::factory()->admin()->create();
    $this->actingAs($admin);

    $d = app(DashboardService::class)->build($admin, '30d');

    expect($d['kpis'][0]['value'])->toBe('$170')                              // turnover 100+20+50
        ->and($d['kpis'][1]['value'])->toBe('2')                              // paid subs a1,b1
        ->and($d['kpis'][2]['value'])->toBe('1')                              // free subs a2
        ->and(collect($d['creators'])->pluck('name')->sort()->values()->all())->toBe(['Alpha', 'Beta'])
        ->and(collect($d['attribution'])->firstWhere('label', 'Messages')['value'])->toBe('$150')
        ->and(collect($d['attribution'])->firstWhere('label', 'Tips')['value'])->toBe('$20')
        ->and($d['canViewAllCreators'])->toBeTrue();
});

it('scopes a chatter to assigned creators only', function () {
    $this->actingAs($this->worker);

    $d = app(DashboardService::class)->build($this->worker, '30d');

    expect($d['kpis'][0]['value'])->toBe('$120')                             // only Alpha (100+20)
        ->and(collect($d['creators'])->pluck('name')->all())->toBe(['Alpha'])
        ->and($d['canViewAllCreators'])->toBeFalse();
});

it('builds a chatter leaderboard from attributed sessions and messages', function () {
    $admin = User::factory()->admin()->create();
    $this->actingAs($admin);

    $d = app(DashboardService::class)->build($admin, '30d');
    $row = collect($d['chatters'])->firstWhere('name', 'Work Er');

    expect($row)->not->toBeNull()
        ->and($row['revenue'])->toBe('$120')
        ->and($row['sentMessages'])->toBe(1)
        ->and($row['conversations'])->toBe(1);
});

it('renders the Inertia dashboard for an authenticated user', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->get('/dashboard')
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('Dashboard')
            ->has('dashboard.kpis', 4)
            ->has('dashboard.creators')
            ->where('dashboard.canViewAllCreators', true)
        );
});
