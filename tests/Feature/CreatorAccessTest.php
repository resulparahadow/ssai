<?php

use App\Models\AichModel;
use App\Models\AichSession;
use App\Models\ModelAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    AichModel::create(['name' => 'creatorA']);
    AichModel::create(['name' => 'creatorB']);

    // Created with no authenticated user → scope no-ops, user_id stays null.
    AichSession::create(['creator_model' => 'creatorA', 'customer_username' => 'fan1']);
    AichSession::create(['creator_model' => 'creatorB', 'customer_username' => 'fan2']);
});

it('lets admins and managers see every creator', function () {
    $this->actingAs(User::factory()->admin()->create());
    expect(AichSession::count())->toBe(2);

    $this->actingAs(User::factory()->manager()->create());
    expect(AichSession::count())->toBe(2);
});

it('scopes chatters to their assigned creators', function () {
    $chatter = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $chatter->id, 'creator_model' => 'creatorA']);

    $this->actingAs($chatter);

    expect(AichSession::count())->toBe(1)
        ->and(AichSession::first()->creator_model)->toBe('creatorA');
});

it('shows an unassigned chatter nothing', function () {
    $this->actingAs(User::factory()->chatter()->create());

    expect(AichSession::count())->toBe(0);
});

it('auto-stamps the chatter id on create', function () {
    $chatter = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $chatter->id, 'creator_model' => 'creatorA']);
    $this->actingAs($chatter);

    $session = AichSession::create(['creator_model' => 'creatorA', 'customer_username' => 'fan3']);

    expect($session->user_id)->toBe($chatter->id);
});

it('casts json and decimal columns', function () {
    $session = AichSession::create([
        'creator_model' => 'creatorA',
        'customer_username' => 'fanX',
        'messages' => [['sender' => 'customer', 'text' => 'hi']],
        'total_spend' => 12.5,
    ]);

    $fresh = $session->fresh();

    expect($fresh->messages)->toBeArray()
        ->and($fresh->messages[0]['text'])->toBe('hi')
        ->and((float) $fresh->total_spend)->toBe(12.5);
});
