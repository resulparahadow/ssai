<?php

use App\Models\AichModel;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['services.onlyfans.key' => 'test-key', 'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api']);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
});

/**
 * Laravel's HTTP client raises ConnectionException for BOTH a refused connection and a
 * blown timeout, so the two have to be told apart by the cURL error carried in the message.
 */
function fakeEngineFailure(string $message): void
{
    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101, 'isSubscribed' => true]]),
        '127.0.0.1:8787/*' => fn () => throw new ConnectionException($message),
    ]);
}

function postGenerate(AichModel $model): TestResponse
{
    return test()->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$model->id}/chats/101/generate", [
            'messages' => [['from' => 'fan', 'text' => 'hey', 'time' => now()->toIso8601String()]],
            'customer' => ['id' => '101', 'name' => 'Jake', 'username' => 'jake_w'],
        ]);
}

it('reports a blown timeout as a timeout, not as an unreachable engine', function () {
    fakeEngineFailure('cURL error 28: Operation timed out after 60001 milliseconds (see https://curl.se/…)');

    $res = postGenerate($this->model)->assertStatus(504);

    // The generation is still running upstream and was billed — saying "start the engine"
    // sends the reader to restart a container that is in fact healthy.
    expect($res->json('error'))
        ->toContain('longer than')
        ->not->toContain('node engine/server.js');
});

it('still reports a refused connection as an unreachable engine', function () {
    fakeEngineFailure('cURL error 7: Failed to connect to 127.0.0.1 port 8787: Connection refused');

    postGenerate($this->model)->assertStatus(503)
        ->assertJsonPath('error', fn ($e) => str_contains((string) $e, 'not reachable'));
});

it('gives the engine a ceiling above a two-call pipeline with one retry', function () {
    // The strategy call alone measures 34-36s on a production-shaped thread, and
    // callModel.js retries transient 429/529 up to 3x — 60s could not survive one retry.
    expect((int) config('services.engine.timeout'))->toBeGreaterThanOrEqual(180);

    // A genuinely down engine must still fail fast rather than hang for the full ceiling.
    expect((int) config('services.engine.connect_timeout'))->toBeLessThanOrEqual(10);
});
