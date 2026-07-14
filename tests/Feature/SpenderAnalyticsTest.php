<?php

use App\Models\AichModel;
use App\Models\ModelAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;
use Inertia\Testing\AssertableInertia;

uses(RefreshDatabase::class);

beforeEach(function () {
    Cache::flush();
    config(['services.onlyfans.key' => 'test-key', 'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api']);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam', 'tier' => 'standard']);
});

it('renders the spender-brackets page for managers/admins', function () {
    $this->actingAs(User::factory()->manager()->create())
        ->get('/analytics/spenders')
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $p) => $p->component('Spenders'));
});

it('blocks chatters from the spender-brackets page', function () {
    $this->actingAs(User::factory()->chatter()->create())
        ->get('/analytics/spenders')
        ->assertForbidden();
});

it('aggregates spenders across pages filtered by the floor', function () {
    Http::fake([
        'app.onlyfansapi.com/*' => Http::sequence()
            ->push([
                'data' => [
                    'list' => [
                        ['id' => 1, 'name' => 'Whale', 'username' => 'whale', 'subscribedOnData' => ['totalSumm' => 5000, 'tipsSumm' => 800]],
                        ['id' => 2, 'name' => 'Big', 'username' => 'big', 'subscribedOnData' => ['totalSumm' => 300, 'tipsSumm' => 0]],
                    ],
                    'hasMore' => true,
                ],
                '_pagination' => ['next_page' => null],
            ])
            ->push([
                'data' => [
                    'list' => [
                        ['id' => 3, 'name' => 'Mid', 'username' => 'mid', 'subscribedOnData' => ['totalSumm' => 220, 'tipsSumm' => 10]],
                    ],
                    'hasMore' => false,
                ],
                '_pagination' => ['next_page' => null],
            ]),
    ]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/models/{$this->model->id}/of/spenders?floor=200")
        ->assertOk()
        ->assertJsonPath('floor', 200)
        ->assertJsonPath('count', 3)
        ->assertJsonCount(3, 'spenders')
        ->assertJsonPath('spenders.0.totalSpent', 5000)
        ->assertJsonPath('spenders.2.name', 'Mid');

    // Both pages hit fans/all with filter[total_spent]=200; the second used offset=20.
    Http::assertSent(fn ($r) => str_contains($r->url(), '/acct_cam/fans/all')
        && str_contains(urldecode($r->url()), 'filter[total_spent]=200'));
    Http::assertSent(fn ($r) => str_contains(urldecode($r->url()), 'offset=20'));
});

it('surfaces the PPV and subscription spend split per fan', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [
            'list' => [[
                'id' => 1, 'name' => 'Whale', 'username' => 'whale',
                'subscribedOnData' => [
                    'totalSumm' => 5000,
                    'tipsSumm' => 800,
                    'messagesSumm' => 3500,
                    'subscribesSumm' => 500,
                    'postsSumm' => 200,
                ],
            ]],
            'hasMore' => false,
        ],
        '_pagination' => ['next_page' => null],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/models/{$this->model->id}/of/spenders?floor=200")
        ->assertOk()
        ->assertJsonPath('spenders.0.totalSpent', 5000)
        ->assertJsonPath('spenders.0.ppv', 3500)
        ->assertJsonPath('spenders.0.tips', 800)
        ->assertJsonPath('spenders.0.subs', 500);
});

it('defaults the floor to 200 when none is given', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => ['list' => [], 'hasMore' => false],
        '_pagination' => ['next_page' => null],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/models/{$this->model->id}/of/spenders")
        ->assertOk()
        ->assertJsonPath('floor', 200)
        ->assertJsonPath('count', 0);

    Http::assertSent(fn ($r) => str_contains(urldecode($r->url()), 'filter[total_spent]=200'));
});

it('rejects a negative floor with a 422', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/models/{$this->model->id}/of/spenders?floor=-5")
        ->assertStatus(422);
});

it('blocks chatters from the spenders endpoint', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['list' => [], 'hasMore' => false]])]);

    $chatter = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $chatter->id, 'creator_model' => 'Camila']);

    $this->actingAs($chatter)
        ->getJson("/models/{$this->model->id}/of/spenders")
        ->assertForbidden();
});

it('422s when the creator has no OnlyFans account', function () {
    $model = AichModel::create(['name' => 'NoOf']);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/models/{$model->id}/of/spenders")
        ->assertStatus(422);
});

it('503s when the OnlyFans API key is not configured', function () {
    config(['services.onlyfans.key' => '']);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/models/{$this->model->id}/of/spenders")
        ->assertStatus(503);
});
