<?php

use App\Services\OnlyFans\OnlyFansService;
use Illuminate\Support\Facades\Http;
use Tests\TestCase;

uses(TestCase::class);

/**
 * These need Http::fake (the facade), so they boot Laravel — unlike the pure
 * mappers in OnlyFansTextTest, which are app-free.
 */
function mediaService(): OnlyFansService
{
    return new OnlyFansService('test-key', 'https://app.onlyfansapi.com/api');
}

it('uploads multipart with async=true and returns the prefixed id', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'status' => 'pending',
        'prefixed_id' => 'ofapi_media_abc123',
        'polling_url' => 'https://app.onlyfansapi.com/api/acct_cam/media/uploads/ofapi_media_abc123/status',
    ], 202)]);

    $path = tempnam(sys_get_temp_dir(), 'up');
    file_put_contents($path, 'PNGDATA');

    $res = mediaService()->uploadMedia('acct_cam', $path, 'shot.png');

    expect($res->status())->toBe(202)
        ->and($res->json('prefixed_id'))->toBe('ofapi_media_abc123');

    Http::assertSent(function ($r) {
        return $r->method() === 'POST'
            && str_contains($r->url(), '/acct_cam/media/upload')
            && $r->isMultipart()
            && collect($r->data())->contains(fn ($p) => $p['name'] === 'async' && $p['contents'] === 'true')
            && collect($r->data())->contains(fn ($p) => $p['name'] === 'file');
    });

    unlink($path);
});

// THE most important test in this spec. client() retries 3x on 429; a retried multipart
// upload re-sends bytes OnlyFans may already have accepted -> a second BILLED copy.
// 429 is retryable by client() (its retry `when` callback returns true for 429),
// so a client()-based upload would send 3 requests here — the custom no-retry builder sends exactly 1.
it('NEVER retries a failed upload (duplicate media guard)', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['error' => 'boom'], 429)]);

    $path = tempnam(sys_get_temp_dir(), 'up');
    file_put_contents($path, 'PNGDATA');

    $res = mediaService()->uploadMedia('acct_cam', $path, 'shot.png');

    expect($res->status())->toBe(429);
    Http::assertSentCount(1); // exactly ONE — never 3

    unlink($path);
});

it('reads a completed upload status', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'status' => 'completed',
        'prefixed_id' => 'ofapi_media_abc123',
    ])]);

    $res = mediaService()->getUploadStatus('acct_cam', 'ofapi_media_abc123');

    expect($res->json('status'))->toBe('completed');
    Http::assertSent(fn ($r) => $r->method() === 'GET'
        && str_contains($r->url(), '/acct_cam/media/uploads/ofapi_media_abc123/status'));
});

it('reads a failed upload status with its error', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'status' => 'failed',
        'prefixed_id' => 'ofapi_media_abc123',
        'error' => 'Failed to download file from the provided URL.',
    ])]);

    $res = mediaService()->getUploadStatus('acct_cam', 'ofapi_media_abc123');

    expect($res->json('status'))->toBe('failed')
        ->and($res->json('error'))->toBe('Failed to download file from the provided URL.');
});
