<?php

use App\Broadcasting\CreatorChannel;
use App\Events\OnlyFansMessageReceived;
use App\Models\AichModel;
use App\Models\ModelAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Event;

uses(RefreshDatabase::class);

function inboundPayload(string $account = 'acct_cam'): array
{
    return [
        'event' => 'messages.received',
        'account_id' => $account,
        'payload' => [
            'id' => 555,
            'text' => '<p>hey there</p>',
            'isFree' => true,
            'price' => 0,
            'createdAt' => '2025-05-16T00:27:25+00:00',
            'fromUser' => ['id' => 101, 'name' => 'Jake', 'username' => 'jake_w', 'avatar' => 'https://x/a.jpg'],
        ],
    ];
}

it('acknowledges the onlyfans webhook when no secret is configured', function () {
    config(['services.onlyfans.webhook_secret' => '']);

    $this->postJson('/webhooks/onlyfans', ['event' => 'subscriptions.updated', 'account_id' => 'acct_1'])
        ->assertOk()
        ->assertJson(['ok' => true]);
});

it('rejects a webhook with the wrong secret', function () {
    config(['services.onlyfans.webhook_secret' => 'right-secret']);

    $this->postJson('/webhooks/onlyfans', ['event' => 'messages.received'], ['X-Webhook-Secret' => 'wrong'])
        ->assertUnauthorized();
});

it('broadcasts an inbound message for a mapped creator', function () {
    config(['services.onlyfans.webhook_secret' => '']);
    AichModel::create(['name' => 'Camila', 'of_account_id' => 'acct_cam']);
    Event::fake([OnlyFansMessageReceived::class]);

    $this->postJson('/webhooks/onlyfans', inboundPayload())->assertOk()->assertJson(['ok' => true]);

    Event::assertDispatched(OnlyFansMessageReceived::class, function (OnlyFansMessageReceived $e) {
        return $e->chatId === '101'
            && $e->message['from'] === 'fan'
            && $e->message['text'] === 'hey there'
            && $e->message['id'] === '555'
            && $e->fan['username'] === 'jake_w';
    });
});

it('does not broadcast for an unknown account', function () {
    config(['services.onlyfans.webhook_secret' => '']);
    Event::fake([OnlyFansMessageReceived::class]);

    $this->postJson('/webhooks/onlyfans', inboundPayload('acct_nope'))->assertOk();

    Event::assertNotDispatched(OnlyFansMessageReceived::class);
});

it('does not broadcast for non-message events', function () {
    config(['services.onlyfans.webhook_secret' => '']);
    AichModel::create(['name' => 'Camila', 'of_account_id' => 'acct_cam']);
    Event::fake([OnlyFansMessageReceived::class]);

    $this->postJson('/webhooks/onlyfans', ['event' => 'messages.sent', 'account_id' => 'acct_cam', 'payload' => []])->assertOk();

    Event::assertNotDispatched(OnlyFansMessageReceived::class);
});

it('authorizes the creator channel for an assigned chatter and admins, not an unassigned chatter', function () {
    $model = AichModel::create(['name' => 'Camila', 'of_account_id' => 'acct_cam']);
    $channel = new CreatorChannel;

    $assigned = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $assigned->id, 'creator_model' => 'Camila']);
    $unassigned = User::factory()->chatter()->create();

    expect($channel->join($assigned, $model))->toBeTrue();
    expect($channel->join(User::factory()->admin()->create(), $model))->toBeTrue();
    expect($channel->join($unassigned, $model))->toBeFalse();
});

it('accepts an OopCRM delivery signed with HMAC-SHA256 of the raw body', function () {
    config(['services.oopcrm.webhook_secret' => 'whsec_test']);
    AichModel::create(['name' => 'Camila', 'of_account_id' => 'acct_cam']);
    Event::fake([OnlyFansMessageReceived::class]);

    $body = json_encode(inboundPayload());
    $headers = ['Content-Type' => 'application/json', 'Signature' => hash_hmac('sha256', $body, 'whsec_test')];

    $this->call('POST', '/webhooks/onlyfans', [], [], [], $this->transformHeadersToServerVars($headers), $body)->assertOk();

    Event::assertDispatched(OnlyFansMessageReceived::class);
});

it('accepts a sha256= prefixed signature', function () {
    config(['services.oopcrm.webhook_secret' => 'whsec_test']);
    $body = json_encode(['event' => 'subscriptions.updated', 'account_id' => 'acct_1']);
    $headers = ['Content-Type' => 'application/json', 'Signature' => 'sha256='.hash_hmac('sha256', $body, 'whsec_test')];

    $this->call('POST', '/webhooks/onlyfans', [], [], [], $this->transformHeadersToServerVars($headers), $body)->assertOk();
});

it('rejects a delivery whose signature does not match the body', function () {
    config(['services.oopcrm.webhook_secret' => 'whsec_test']);
    Event::fake([OnlyFansMessageReceived::class]);

    $body = json_encode(inboundPayload());
    $headers = ['Content-Type' => 'application/json', 'Signature' => hash_hmac('sha256', $body.' ', 'whsec_test')];

    $this->call('POST', '/webhooks/onlyfans', [], [], [], $this->transformHeadersToServerVars($headers), $body)->assertUnauthorized();

    Event::assertNotDispatched(OnlyFansMessageReceived::class);
});

it('broadcasts a redelivered message only once', function () {
    config(['services.onlyfans.webhook_secret' => '']);
    AichModel::create(['name' => 'Camila', 'of_account_id' => 'acct_cam']);
    Event::fake([OnlyFansMessageReceived::class]);

    $headers = ['X-OFAPI-Idempotency-Key' => 'evt_123'];
    $this->postJson('/webhooks/onlyfans', inboundPayload(), $headers)->assertOk();
    $this->postJson('/webhooks/onlyfans', inboundPayload(), $headers)->assertOk()->assertJson(['duplicate' => true]);

    Event::assertDispatchedTimes(OnlyFansMessageReceived::class, 1);
});
