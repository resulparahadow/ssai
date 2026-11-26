<?php

use App\Models\AichMessageTag;
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

/** Runs a live generate with a fromQueue priced unopened message m9 and returns the engine's bubbles. */
function tagsGenerateBubbles(): array
{
    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101, 'isSubscribed' => true]]),
        '127.0.0.1:8787/*' => Http::response(['draft' => 'hi', 'strategy' => null, 'telemetry' => null, 'usage' => []]),
    ]);

    test()->actingAs(User::factory()->admin()->create())
        ->postJson('/onlyfans/'.AichModel::first()->id.'/chats/101/generate', [
            'messages' => [
                ['id' => 'm8', 'from' => 'fan', 'text' => 'hey', 'time' => now()->subMinutes(10)->toIso8601String()],
                ['id' => 'm9', 'from' => 'creator', 'text' => 'unlock', 'time' => now()->subMinutes(5)->toIso8601String(),
                    'price' => 20, 'isFree' => false, 'isOpened' => false, 'isTip' => false, 'fromQueue' => true],
            ],
            'customer' => ['id' => '101'],
        ])->assertOk();

    $sent = Http::recorded(fn ($r) => str_contains($r->url(), '8787'))->first()[0];

    return data_get($sent->data(), 'session.messages') ?? [];
}

it('a stored chat_ppv tag turns a mass-flagged message into a ppv bubble for the engine', function () {
    AichMessageTag::create(['creator_model' => 'Camila', 'chat_id' => '101', 'message_id' => 'm9', 'tag' => 'chat_ppv']);

    expect(collect(tagsGenerateBubbles())->pluck('sender')->all())->toContain('ppv');
});

it('without the tag the unopened mass message is hidden from the engine', function () {
    expect(collect(tagsGenerateBubbles())->pluck('sender')->all())->not->toContain('ppv');
});

it('a fan tip and a fan photo reach the engine as legacy TIPPED / CAME-WITH-MEDIA tags', function () {
    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101, 'isSubscribed' => true]]),
        '127.0.0.1:8787/*' => Http::response(['draft' => 'hi', 'strategy' => null, 'telemetry' => null, 'usage' => []]),
    ]);

    test()->actingAs(User::factory()->admin()->create())
        ->postJson('/onlyfans/'.$this->model->id.'/chats/101/generate', [
            'messages' => [
                ['id' => 'm1', 'from' => 'fan', 'text' => 'look', 'time' => now()->subMinutes(10)->toIso8601String(), 'mediaCount' => 1],
                ['id' => 'm2', 'from' => 'fan', 'text' => '', 'time' => now()->subMinutes(5)->toIso8601String(),
                    'price' => 15, 'isFree' => false, 'isTip' => true, 'mediaCount' => 0],
            ],
            'customer' => ['id' => '101'],
        ])->assertOk();

    $sent = Http::recorded(fn ($r) => str_contains($r->url(), '8787'))->first()[0];
    $bubbles = data_get($sent->data(), 'session.messages');

    expect($bubbles[0]['tags'])->toBe(['customerMedia' => true])
        ->and($bubbles[1]['tags'])->toBe(['tip' => true, 'tipAmount' => 15.0]);
});
