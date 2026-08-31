<?php

use Illuminate\Console\Scheduling\Schedule;
use Illuminate\Support\Facades\Storage;

// Decrypted DRM videos are cached on disk indefinitely to avoid re-billing; without a pruner
// that cache only grows.
it('deletes cached DRM videos older than the retention window and keeps recent ones', function () {
    Storage::fake('local');
    $disk = Storage::disk('local');
    $disk->put('of-drm/acct_cam/111.mp4', 'old');
    $disk->put('of-drm/acct_cam/222.mp4', 'fresh');
    touch($disk->path('of-drm/acct_cam/111.mp4'), now()->subDays(10)->getTimestamp());

    $this->artisan('of:prune-drm-cache', ['--days' => 7])->assertSuccessful();

    $disk->assertMissing('of-drm/acct_cam/111.mp4');
    $disk->assertExists('of-drm/acct_cam/222.mp4');
});

it('leaves everything alone when the cache is empty', function () {
    Storage::fake('local');

    $this->artisan('of:prune-drm-cache')->assertSuccessful();
});

it('schedules the DRM cache pruner', function () {
    $commands = collect(app(Schedule::class)->events())->map(fn ($e) => $e->command);

    expect($commands->contains(fn ($c) => str_contains((string) $c, 'of:prune-drm-cache')))->toBeTrue();
});
