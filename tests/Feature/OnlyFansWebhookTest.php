<?php

use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('acknowledges the onlyfans webhook when no secret is configured', function () {
    config(['services.onlyfans.webhook_secret' => '']);

    $this->postJson('/webhooks/onlyfans', ['type' => 'message', 'account_id' => 'acct_1'])
        ->assertOk()
        ->assertJson(['ok' => true]);
});

it('rejects a webhook with the wrong secret', function () {
    config(['services.onlyfans.webhook_secret' => 'right-secret']);

    $this->postJson('/webhooks/onlyfans', ['type' => 'message'], ['X-Webhook-Secret' => 'wrong'])
        ->assertUnauthorized();
});
