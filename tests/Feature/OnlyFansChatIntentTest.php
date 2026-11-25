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
    AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
});

function intentGenerate(array $extra, bool $withPpv = true)
{
    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101, 'isSubscribed' => true]]),
        '127.0.0.1:8787/*' => Http::response(['draft' => 'hi', 'strategy' => null, 'telemetry' => null, 'usage' => []]),
    ]);
    $messages = [['id' => 'm8', 'from' => 'fan', 'text' => 'hey', 'time' => now()->subMinutes(10)->toIso8601String()]];
    if ($withPpv) {
        $messages[] = ['id' => 'm9', 'from' => 'creator', 'text' => 'unlock', 'time' => now()->subMinutes(8)->toIso8601String(),
            'price' => 21, 'isFree' => false, 'isOpened' => false, 'isTip' => false, 'fromQueue' => false];
    }
    $messages[] = ['id' => 'm10', 'from' => 'fan', 'text' => 'later', 'time' => now()->subMinutes(5)->toIso8601String()];

    return test()->actingAs(User::factory()->admin()->create())
        ->postJson('/onlyfans/'.AichModel::first()->id.'/chats/101/generate', [
            'messages' => $messages, 'customer' => ['id' => '101'],
        ] + $extra);
}

function intentEngineContext(): ?string
{
    $rec = Http::recorded(fn ($r) => str_contains($r->url(), '8787'))->first();

    return $rec ? data_get($rec[0]->data(), 'context') : null;
}

it('repitch puts the directive then the typed note in context', function () {
    intentGenerate(['intent' => 'repitch', 'context' => 'keep it playful'])->assertOk()->assertJsonPath('intent', 'repitch');
    expect(intentEngineContext())
        ->toStartWith('INTENT BUTTON — Re-pitch: He has not opened the PPV already sent in this chat ($21, locked, 1 messages ago).')
        ->toEndWith("\n\nAgent note (apply within the intent above): keep it playful");
});

it('repitch with no unpaid PPV is 422 and the engine is never called', function () {
    intentGenerate(['intent' => 'repitch'], false)->assertStatus(422)->assertJsonPath('error', 'No unpaid PPV in this chat to re-pitch.');
    expect(Http::recorded(fn ($r) => str_contains($r->url(), '8787')))->toHaveCount(0);
});

it('intent with sender ppv is 422', function () {
    intentGenerate(['intent' => 'repitch', 'sender' => 'ppv'])->assertStatus(422)
        ->assertJsonPath('error', "An intent can't be combined with a PPV caption.");
});

it('unknown intent is 422', function () {
    intentGenerate(['intent' => 'nuke'])->assertStatus(422);
});

it('no intent leaves context exactly as typed', function () {
    intentGenerate(['context' => 'just this'])->assertOk()->assertJsonPath('intent', null);
    expect(intentEngineContext())->toBe('just this');
});
