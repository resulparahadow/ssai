<?php

use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

// Decrypted DRM videos are cached on disk so a re-watch doesn't re-bill the download; this
// keeps that cache from growing without bound.
Schedule::command('of:prune-drm-cache')->weekly();
