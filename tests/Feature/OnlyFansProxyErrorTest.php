<?php

use App\Models\AichModel;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['services.onlyfans.key' => 'test-key', 'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api']);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
    $this->admin = User::factory()->admin()->create();
});

it('keeps the status and body when OnlyFans returns a real JSON error', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(
        ['error' => 'ONLYFANS_COM_ERROR', 'message' => 'The requested OnlyFans resource was not found.'], 404
    )]);

    test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/chats/101/media")
        ->assertStatus(404)
        ->assertJsonPath('message', 'The requested OnlyFans resource was not found.');
});

it('surfaces the status when the failure body is not JSON, instead of a bare generic message', function () {
    // The vendor sits behind Cloudflare (verified live: `server: cloudflare`), whose 5xx
    // pages are HTML. Those never reach the vendor's JSON error layer, so the old code
    // collapsed every one into "OnlyFans request failed" with the status thrown away.
    Http::fake(['app.onlyfansapi.com/*' => Http::response(
        '<!DOCTYPE html><html><head><title>502 Bad Gateway</title></head><body>cloudflare</body></html>',
        502,
        ['Content-Type' => 'text/html']
    )]);

    $res = test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/chats/101/media")
        ->assertStatus(502);

    expect($res->json('error'))->toContain('502');
});

it('logs the discarded upstream body so an intermittent failure is diagnosable', function () {
    Log::spy();

    Http::fake(['app.onlyfansapi.com/*' => Http::response('error code: 524', 524, ['Content-Type' => 'text/plain'])]);

    test()->actingAs($this->admin)->getJson("/onlyfans/{$this->model->id}/chats/101/media");

    Log::shouldHaveReceived('warning')->once()->withArgs(function (string $msg, array $ctx) {
        return $msg === 'onlyfans.proxy.non_json_error'
            && $ctx['status'] === 524
            && str_contains((string) $ctx['body'], '524')
            && str_contains((string) $ctx['url'], 'chats/101/media');
    });
});

it('reports a media-proxy timeout as a timeout rather than an unhandled 500', function () {
    Http::fake(['app.onlyfansapi.com/*' => fn () => throw new ConnectionException(
        'cURL error 28: Operation timed out after 30001 milliseconds'
    )]);

    $url = 'https://cdn2.onlyfans.com/files/a/ab/x/300x300_deadbeef.jpg?Tag=1&Policy=2&Signature=3&Key-Pair-Id=4';

    test()->actingAs($this->admin)
        ->get("/onlyfans/{$this->model->id}/media?url=".urlencode($url))
        ->assertStatus(504);
});

/**
 * OnlyFansAPI's error bodies carry BOTH a machine `error` code and a human `message`
 * (captured live 2026-09-05 from an account whose session had lapsed). The chat list is
 * where a broken account shows up first, so the proxy must hand the browser that message —
 * it is the only part of the payload that tells a manager what to actually do. The UI used
 * to render the bare code ("SERVICE_UNAVAILABLE"), which says nothing.
 */
it('forwards the human message on a vendor account-state error, not just the code', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'error' => 'SESSION_EXPIRED:NEEDS_REAUTHENTICATION',
        'message' => "This Account can't be used. It needs re-authentication. Please visit Dashboard or use /authenticate endpoint to re-authenticate.",
        'description' => 'This error happened most probably because of a bug in the OnlyFans.com API or you sent wrong parameters (like a non-existing user id).',
    ], 401)]);

    test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/chats")
        ->assertStatus(401)
        ->assertJsonPath('error', 'SESSION_EXPIRED:NEEDS_REAUTHENTICATION')
        ->assertJsonPath('message', "This Account can't be used. It needs re-authentication. Please visit Dashboard or use /authenticate endpoint to re-authenticate.");
});

/** 503 is what the vendor returns while an account is re-authenticating (spec: Re-authenticate Account). */
it('forwards a 503 raised while an account is re-authenticating', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'error' => 'SERVICE_UNAVAILABLE',
        'message' => 'This account is currently re-authenticating. Please try again shortly.',
    ], 503)]);

    test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/chats")
        ->assertStatus(503)
        ->assertJsonPath('message', 'This account is currently re-authenticating. Please try again shortly.');
});

/**
 * A JSON 5xx from the vendor used to pass straight through unlogged — only NON-JSON bodies
 * were recorded. The chat list walks up to 200 pages in one burst, so when one page 5xxs the
 * whole load dies with nothing on the server saying which call broke or why. Log it.
 */
it('logs a vendor 5xx even though the body is valid JSON', function () {
    Log::spy();

    Http::fake(['app.onlyfansapi.com/*' => Http::response(
        ['error' => 'SERVICE_UNAVAILABLE', 'message' => 'Temporarily unavailable.'], 503
    )]);

    test()->actingAs($this->admin)->getJson("/onlyfans/{$this->model->id}/chats");

    Log::shouldHaveReceived('warning')->once()->withArgs(function (string $msg, array $ctx) {
        return $msg === 'onlyfans.proxy.upstream_error'
            && $ctx['status'] === 503
            && $ctx['error'] === 'SERVICE_UNAVAILABLE'
            && str_contains((string) $ctx['url'], '/chats');
    });
});

it('does not log a routine 4xx as an upstream failure', function () {
    Log::spy();

    Http::fake(['app.onlyfansapi.com/*' => Http::response(['error' => 'VALIDATION_ERROR'], 422)]);

    test()->actingAs($this->admin)->getJson("/onlyfans/{$this->model->id}/chats");

    Log::shouldNotHaveReceived('warning');
});
