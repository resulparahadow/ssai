<?php

return [

    /*
    |--------------------------------------------------------------------------
    | Third Party Services
    |--------------------------------------------------------------------------
    |
    | This file is for storing the credentials for third party services such
    | as Mailgun, Postmark, AWS and more. This file provides the de facto
    | location for this type of information, allowing packages to have
    | a conventional file to locate the various service credentials.
    |
    */

    'postmark' => [
        'key' => env('POSTMARK_API_KEY'),
    ],

    'resend' => [
        'key' => env('RESEND_API_KEY'),
    ],

    'ses' => [
        'key' => env('AWS_ACCESS_KEY_ID'),
        'secret' => env('AWS_SECRET_ACCESS_KEY'),
        'region' => env('AWS_DEFAULT_REGION', 'us-east-1'),
    ],

    'slack' => [
        'notifications' => [
            'bot_user_oauth_token' => env('SLACK_BOT_USER_OAUTH_TOKEN'),
            'channel' => env('SLACK_BOT_USER_DEFAULT_CHANNEL'),
        ],
    ],

    // ---- SmartStars AI providers (server-held keys; never sent to the browser) ----

    'anthropic' => [
        'key' => env('ANTHROPIC_API_KEY'),
        'model' => env('ANTHROPIC_MODEL', 'claude-sonnet-4-6'),
    ],

    'openrouter' => [
        'key' => env('OPENROUTER_API_KEY'),
        'model' => env('OPENROUTER_MODEL', 'mistralai/mistral-nemo'),
    ],

    'onlyfans' => [
        'key' => env('ONLYFANS_API_KEY'),
        'base_url' => env('ONLYFANS_BASE_URL', 'https://app.onlyfansapi.com/api'),
        'webhook_secret' => env('ONLYFANS_WEBHOOK_SECRET'),
        'timeout' => (int) env('ONLYFANS_TIMEOUT', 30),
        // Uploads forward up to 100MB to OnlyFans; the 30s default is far too short.
        // Only `uploadMedia()` uses this — every other call keeps `timeout`.
        'upload_timeout' => (int) env('ONLYFANS_UPLOAD_TIMEOUT', 300),
    ],

    // Node sidecar that runs the real legacy generation engine (engine/server.js).
    'engine' => [
        'url' => env('ENGINE_URL', 'http://127.0.0.1:8787'),
        'timeout' => (int) env('ENGINE_TIMEOUT', 60),
        'session_gap_hours' => (int) env('ENGINE_SESSION_GAP_HOURS', 12),
    ],

];
