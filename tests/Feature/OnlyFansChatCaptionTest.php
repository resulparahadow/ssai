<?php

use App\Models\AichChatIntel;
use App\Models\AichModel;
use App\Models\AichUsageEvent;
use App\Models\CustomerProfile;
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
    $this->url = "/onlyfans/{$this->model->id}/chats/101/generate";
    $this->admin = User::factory()->admin()->create();

    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101, 'isSubscribed' => true]]),
        '127.0.0.1:8787/*' => Http::response([
            'draft' => 'i got a little carried away 🙈',
            // Legacy forces PPV-mode strategy to send_content — must NOT land in shared state.
            'strategy' => ['phase' => 'send_content', 'trust_level' => 4, 'archetype' => 'Whale', 'temperature' => 'hot', 'caption_required' => true],
            'telemetry' => null,
            'usage' => [['callType' => 'generator', 'model' => 'claude-sonnet', 'input' => 10, 'output' => 5, 'cost' => 0.001, 'durationMs' => 100]],
        ]),
    ]);
});

function captionGenerate(array $over = []): void
{
    test()->actingAs(test()->admin)
        ->postJson(test()->url, array_merge([
            'messages' => [['from' => 'fan', 'text' => 'show me', 'time' => now()->toIso8601String()]],
            'customer' => ['id' => '101', 'name' => 'Jake', 'username' => 'jake_w'],
        ], $over))
        ->assertOk()
        ->assertJsonPath('draft', 'i got a little carried away 🙈');
}

it('forwards sender ppv to the engine', function () {
    captionGenerate(['sender' => 'ppv']);

    Http::assertSent(fn ($r) => str_contains($r->url(), '8787') && data_get($r->data(), 'sender') === 'ppv');
});

it('defaults sender to customer', function () {
    captionGenerate();

    Http::assertSent(fn ($r) => str_contains($r->url(), '8787') && data_get($r->data(), 'sender') === 'customer');
});

it('rejects an unknown sender', function () {
    $this->actingAs($this->admin)
        ->postJson($this->url, ['messages' => [['from' => 'fan', 'text' => 'hi']], 'customer' => ['id' => '101'], 'sender' => 'model'])
        ->assertStatus(422);
});

it('does not write AI Intel or fan memory for a caption generate', function () {
    captionGenerate(['sender' => 'ppv']);

    expect(AichChatIntel::count())->toBe(0);
    $profile = CustomerProfile::withoutGlobalScopes()->where('creator_model', 'Camila')->where('of_fan_id', '101')->first();
    expect($profile)->not->toBeNull()
        ->and((int) $profile->trust_level)->not->toBe(4)
        ->and($profile->archetype)->not->toBe('Whale');
});

it('still writes AI Intel and fan memory for a normal reply', function () {
    captionGenerate();

    expect(AichChatIntel::count())->toBe(1);
    $profile = CustomerProfile::withoutGlobalScopes()->where('creator_model', 'Camila')->where('of_fan_id', '101')->first();
    expect((int) $profile->trust_level)->toBe(4);
});

it('still records usage for a caption generate', function () {
    captionGenerate(['sender' => 'ppv']);

    expect(AichUsageEvent::count())->toBe(1);
});
