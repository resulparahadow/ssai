<?php

use App\Models\AichModel;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Inertia\Testing\AssertableInertia;

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['services.onlyfans.key' => 'test-key', 'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api']);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam', 'tier' => 'standard']);
});

it('renders the analytics dashboard with connected accounts', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->get('/analytics/overview')
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->component('Analytics')
            ->where('accounts.0.accountId', 'acct_cam')
            ->where('accounts.0.name', 'Camila'));
});

it('forbids chatters from the analytics dashboard (manage-team gate)', function () {
    $this->actingAs(User::factory()->chatter()->create())
        ->get('/analytics/overview')
        ->assertForbidden();

    $this->actingAs(User::factory()->chatter()->create())
        ->postJson('/analytics/of/earnings', [
            'start_date' => '2026-01-01', 'end_date' => '2026-06-30',
        ])
        ->assertForbidden();
});

it('proxies the earnings overview and defaults to all connected accounts', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'total_earnings' => 15000.5, 'subscriptions' => 8000, 'posts' => 2500,
        'messages' => 3000, 'tips' => 1300, 'streams' => 200.5,
        'total_accounts' => 1, 'total_messages' => 1250, 'total_images' => 450, 'total_videos' => 120,
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson('/analytics/of/earnings', [
            'start_date' => '2026-01-01', 'end_date' => '2026-06-30',
        ])
        ->assertOk()
        ->assertJsonPath('data.total_earnings', 15000.5);

    Http::assertSent(function ($r) {
        return str_contains($r->url(), '/analytics/summary/earnings')
            && $r['account_ids'] === ['acct_cam']
            && $r['start_date'] === '2026-01-01';
    });
});

it('rejects account ids the caller cannot access', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->postJson('/analytics/of/earnings', [
            'account_ids' => ['acct_someone_else'],
            'start_date' => '2026-01-01', 'end_date' => '2026-06-30',
        ])
        ->assertStatus(422);

    Http::assertNothingSent();
});

it('proxies historical performance (top-level array response)', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        ['period' => '2024-01', 'value' => 5000.0],
        ['period' => '2024-02', 'value' => 5500.0],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson('/analytics/of/historical', ['time_range' => '12m'])
        ->assertOk()
        ->assertJsonPath('data.0.period', '2024-01')
        ->assertJsonPath('data.1.value', 5500);

    Http::assertSent(fn ($r) => str_contains($r->url(), '/analytics/summary/historical')
        && $r['time_range'] === '12m');
});

it('surfaces an OnlyFans 5xx as an attributed 502, not a bare 500', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['message' => 'Server Error'], 500)]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson('/analytics/of/historical', ['time_range' => '12m'])
        ->assertStatus(502)
        ->assertJsonPath('source', 'onlyfans')
        ->assertJsonPath('upstreamStatus', 500)
        ->assertJson(fn ($j) => $j->where('error', fn ($e) => str_contains($e, 'OnlyFans'))->etc());
});

it('forwards an OnlyFans 4xx validation message with its status', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'message' => 'One or more selected accounts are invalid or do not have OnlyFans data.',
        'errors' => ['account_ids.0' => ['invalid']],
    ], 422)]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson('/analytics/of/earnings', ['start_date' => '2026-01-01', 'end_date' => '2026-06-30'])
        ->assertStatus(422)
        ->assertJsonPath('source', 'onlyfans')
        ->assertJsonPath('error', 'One or more selected accounts are invalid or do not have OnlyFans data.');
});

it('validates the forecast enums', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->postJson('/analytics/of/forecast', [
            'metric' => 'revenue', 'model' => 'not-a-model',
            'historical_days' => 90, 'forecast_days' => 30,
        ])
        ->assertStatus(422);
});

it('forwards profitability history for a connected creator', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        ['year' => 2026, 'month' => 1, 'gross_revenue' => 10000, 'net_revenue' => 8000, 'profit' => 6000, 'margin' => 75],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/analytics/of/profitability/{$this->model->id}/history?months=6")
        ->assertOk()
        ->assertJsonPath('data.0.profit', 6000);

    Http::assertSent(fn ($r) => str_contains($r->url(), "/analytics/financial/profitability/acct_cam/history")
        && str_contains($r->url(), 'account_prefixed_id=acct_cam')
        && str_contains($r->url(), 'months=6'));
});
