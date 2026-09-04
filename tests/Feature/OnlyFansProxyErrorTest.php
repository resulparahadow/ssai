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
