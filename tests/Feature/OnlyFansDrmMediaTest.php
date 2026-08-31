<?php

use App\Models\AichModel;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['services.onlyfans.key' => 'test-key', 'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api']);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
    Storage::fake('local');
});

/**
 * `GET {acct}/media/download/drm/{media_id}` 302s to dl.fansapi.com, which streams back a
 * DECRYPTED mp4 — the one way a Widevine-protected video becomes playable. It costs credits
 * per byte and takes 8-15s, so the file is cached on disk and never fetched twice.
 */
it('downloads a DRM video once and serves the cached file on repeat views', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response('FAKE-MP4-BYTES', 200, ['Content-Type' => 'video/mp4'])]);
    $user = User::factory()->admin()->create();

    $this->actingAs($user)
        ->get("/onlyfans/{$this->model->id}/media/drm/2381923812")
        ->assertOk()
        ->assertHeader('Content-Type', 'video/mp4');

    Storage::disk('local')->assertExists('of-drm/acct_cam/2381923812.mp4');
    expect(Storage::disk('local')->get('of-drm/acct_cam/2381923812.mp4'))->toBe('FAKE-MP4-BYTES');
    Http::assertSent(fn ($r) => str_ends_with($r->url(), '/acct_cam/media/download/drm/2381923812'));
    Http::assertSentCount(1);

    // Second view is served off disk: no upstream call, so no second credit charge.
    $this->actingAs($user)->get("/onlyfans/{$this->model->id}/media/drm/2381923812")->assertOk();
    Http::assertSentCount(1);
});

// Serving the cached file (rather than streaming the upstream through PHP) is what lets the
// browser seek in a long video.
it('serves the cached DRM video with range support', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response('FAKE-MP4-BYTES', 200, ['Content-Type' => 'video/mp4'])]);
    $user = User::factory()->admin()->create();

    $this->actingAs($user)
        ->get("/onlyfans/{$this->model->id}/media/drm/2381923812")
        ->assertOk()
        ->assertHeader('Accept-Ranges', 'bytes');

    $this->actingAs($user)
        ->get("/onlyfans/{$this->model->id}/media/drm/2381923812", ['Range' => 'bytes=0-3'])
        ->assertStatus(206);
});

it('forwards the 422 when the media is not DRM-protected and caches nothing', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'message' => 'Media 123 is not DRM-protected. Use the regular media download endpoint instead.',
    ], 422)]);

    $this->actingAs(User::factory()->admin()->create())
        ->get("/onlyfans/{$this->model->id}/media/drm/123")
        ->assertStatus(422)
        ->assertJsonPath('message', 'Media 123 is not DRM-protected. Use the regular media download endpoint instead.');

    Storage::disk('local')->assertMissing('of-drm/acct_cam/123.mp4');
});

it('forwards the 402 when the account is out of credits', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['message' => 'Insufficient credits for a DRM media download.'], 402)]);

    $this->actingAs(User::factory()->admin()->create())
        ->get("/onlyfans/{$this->model->id}/media/drm/2381923812")
        ->assertStatus(402)
        ->assertJsonPath('message', 'Insufficient credits for a DRM media download.');

    Storage::disk('local')->assertMissing('of-drm/acct_cam/2381923812.mp4');
});

// The media id becomes a filename on our disk, so anything but digits is refused outright.
it('rejects a non-numeric media id without calling OnlyFans', function () {
    Http::fake();

    $this->actingAs(User::factory()->admin()->create())
        ->get("/onlyfans/{$this->model->id}/media/drm/evil.mp4")
        ->assertStatus(400);

    Http::assertNothingSent();
});

// A path-traversal id never even reaches the controller — the route param is a single segment,
// so the router 404s it. Asserted so the guard above is never mistaken for the only defence.
it('never routes a traversal media id to the DRM download', function () {
    Http::fake();

    $this->actingAs(User::factory()->admin()->create())
        ->get("/onlyfans/{$this->model->id}/media/drm/..%2F..%2Fetc%2Fpasswd")
        ->assertNotFound();

    Http::assertNothingSent();
});

it('denies a DRM download to a chatter not assigned to the creator', function () {
    Http::fake();

    $this->actingAs(User::factory()->chatter()->create())
        ->get("/onlyfans/{$this->model->id}/media/drm/2381923812")
        ->assertForbidden();

    Http::assertNothingSent();
});

/**
 * The frontend needs to tell "our own DRM video, downloadable through the DRM endpoint" apart
 * from "locked PPV media we can never fetch" — both are videos with no `source`. `files.drm`
 * is the discriminator.
 */
it('flags DRM-protected media so the frontend can offer the download', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [
            'id' => 55, 'type' => 'video', 'canView' => true, 'duration' => 42,
            'files' => [
                'preview' => ['url' => 'https://cdn.fansapi.com/of/poster.jpg?X-Amz-Signature=s'],
                'drm' => ['manifest' => ['hls' => 'https://cdn2.onlyfans.com/x.m3u8'], 'signature' => ['hls' => ['CloudFront-Policy' => 'p']]],
            ],
        ],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/media/vault/55")
        ->assertOk()
        ->assertJsonPath('item.drm', true)
        ->assertJsonPath('item.source', null);
});

it('does not flag an ordinary video as DRM-protected', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [
            'id' => 56, 'type' => 'video', 'canView' => true,
            'videoSources' => ['720' => 'https://cdn.fansapi.com/of/v720.mp4?X-Amz-Signature=s'],
            'files' => ['preview' => ['url' => 'https://cdn.fansapi.com/of/poster.jpg?X-Amz-Signature=s']],
        ],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/media/vault/56")
        ->assertOk()
        ->assertJsonPath('item.drm', false);
});
