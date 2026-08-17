<?php

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

it('feeds session PPV spend, tips, and a ppv bubble into the engine', function () {
    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101, 'isSubscribed' => true]]),
        '127.0.0.1:8787/*' => Http::response(['draft' => 'hi', 'strategy' => ['phase' => 'sell'], 'telemetry' => null, 'usage' => []]),
    ]);
    $now = now();

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/chats/101/generate", [
            'messages' => [
                ['from' => 'fan', 'text' => 'hey', 'time' => $now->copy()->subMinutes(6)->toIso8601String()],
                ['from' => 'creator', 'text' => 'unlock', 'time' => $now->copy()->subMinutes(4)->toIso8601String(),
                    'price' => 25, 'isFree' => false, 'isOpened' => true, 'isTip' => false],
                ['from' => 'fan', 'text' => 'tip', 'time' => $now->copy()->subMinutes(2)->toIso8601String(),
                    'price' => 10, 'isTip' => true, 'isFree' => false, 'isOpened' => true],
            ],
            'customer' => ['id' => '101'],
        ])
        ->assertOk();

    Http::assertSent(function ($r) {
        if (! str_contains($r->url(), '8787')) {
            return false;
        }
        $total = (string) data_get($r->data(), 'session.total_spend');
        $tips = (string) data_get($r->data(), 'session.tips_spend');
        $hasPpv = collect(data_get($r->data(), 'session.messages', []))
            ->contains(fn ($m) => ($m['sender'] ?? null) === 'ppv');

        return str_contains($total, '25') && str_contains($tips, '10') && $hasPpv;
    });
});

it('does not count a pre-gap payment as session spend', function () {
    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101, 'isSubscribed' => true]]),
        '127.0.0.1:8787/*' => Http::response(['draft' => 'hi', 'strategy' => ['phase' => 'rapport'], 'telemetry' => null, 'usage' => []]),
    ]);
    $now = now();

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/chats/101/generate", [
            'messages' => [
                ['from' => 'creator', 'text' => 'old ppv', 'time' => $now->copy()->subDays(2)->toIso8601String(),
                    'price' => 50, 'isFree' => false, 'isOpened' => true, 'isTip' => false],
                ['from' => 'fan', 'text' => 'im back', 'time' => $now->copy()->subMinutes(3)->toIso8601String()],
            ],
            'customer' => ['id' => '101'],
        ])
        ->assertOk();

    Http::assertSent(function ($r) {
        if (! str_contains($r->url(), '8787')) {
            return false;
        }
        // "$0" session spend, and the pre-gap payment is not a ppv bubble.
        $total = (string) data_get($r->data(), 'session.total_spend');
        $hasPpv = collect(data_get($r->data(), 'session.messages', []))
            ->contains(fn ($m) => ($m['sender'] ?? null) === 'ppv');

        return $total === '$0' && $hasPpv === false;
    });
});
