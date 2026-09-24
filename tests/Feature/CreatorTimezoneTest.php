<?php

use App\Models\AichModel;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Inertia\Testing\AssertableInertia;

uses(RefreshDatabase::class);

beforeEach(function () {
    config([
        'services.onlyfans.key' => 'test-key',
        'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api',
        'services.engine.url' => 'http://127.0.0.1:8787',
        'services.engine.default_timezone' => 'UTC',
    ]);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
});

function generateFor(AichModel $model, array $messages): void
{
    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101, 'isSubscribed' => true]]),
        '127.0.0.1:8787/*' => Http::response(['draft' => 'hi', 'strategy' => null, 'telemetry' => null, 'usage' => []]),
    ]);

    test()->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$model->id}/chats/101/generate", [
            'messages' => $messages,
            'customer' => ['id' => '101'],
        ])
        ->assertOk();
}

/** The one payload the engine received. */
function enginePayload(): array
{
    $sent = Http::recorded(fn ($r) => str_contains($r->url(), '8787'));
    expect($sent)->toHaveCount(1);

    return $sent->first()[0]->data();
}

it('runs the engine in the creator timezone and stamps messages in it', function () {
    $this->model->update(['timezone' => 'America/Los_Angeles']);

    generateFor($this->model, [
        ['from' => 'fan', 'text' => 'good morning', 'time' => '2026-09-24T13:02:00+00:00'],
    ]);

    $payload = enginePayload();
    // The engine's "current time" line and the per-message stamps must share one clock,
    // or the AI sees two contradicting times.
    expect($payload['timezone'])->toBe('America/Los_Angeles');
    expect(data_get($payload, 'session.messages.0.ts'))->toBe('6:02 AM');
});

it('falls back to the configured default when the creator has no timezone', function () {
    config(['services.engine.default_timezone' => 'Europe/Berlin']);

    generateFor($this->model, [
        ['from' => 'fan', 'text' => 'hey', 'time' => '2026-09-24T13:02:00+00:00'],
    ]);

    $payload = enginePayload();
    expect($payload['timezone'])->toBe('Europe/Berlin');
    expect(data_get($payload, 'session.messages.0.ts'))->toBe('3:02 PM');
});

it('lets a manager set a creator timezone', function () {
    $this->actingAs(User::factory()->manager()->create())
        ->put("/models/{$this->model->id}", ['name' => 'Camila', 'timezone' => 'America/Chicago'])
        ->assertRedirect()
        ->assertSessionHasNoErrors();

    expect($this->model->fresh()->timezone)->toBe('America/Chicago');
});

it('rejects a timezone PHP does not know', function () {
    $this->actingAs(User::factory()->manager()->create())
        ->put("/models/{$this->model->id}", ['name' => 'Camila', 'timezone' => 'Mars/Olympus_Mons'])
        ->assertSessionHasErrors('timezone');

    expect($this->model->fresh()->timezone)->toBeNull();
});

it('offers the timezone list and the fallback on the model page', function () {
    $this->actingAs(User::factory()->manager()->create())
        ->get("/models/{$this->model->id}")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->component('ModelShow')
            ->where('model.timezone', null)
            ->where('defaultTimezone', 'UTC')
            ->where('timezones', fn ($list) => collect($list)->contains('America/New_York')));
});
