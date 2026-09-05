<?php

use App\Models\AichModel;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

/**
 * The chat media gallery (`GET {acct}/chats/{chat}/media`).
 *
 * The endpoint's `data.list` holds MESSAGES, not media objects — each entry carries
 * `responseType: "message"`, `text`, `price`, `fromUser`, and nests its media in `media[]`
 * (openapi.yaml `paths./api/{account}/chats/{chat_id}/media`). Handing those raw to the UI
 * gave a grid of empty tiles, because every media field it looked for lives one level down.
 * The fixture below is the vendor's documented example, trimmed to the fields we read.
 */
function ofChatMediaExample(): array
{
    return [
        'data' => [
            'list' => [
                [
                    'responseType' => 'message',
                    'text' => 'Text message!',
                    'price' => 0,
                    'isMediaReady' => true,
                    'mediaCount' => 1,
                    'id' => 501,
                    'fromUser' => ['id' => 123, '_view' => 't'],
                    'media' => [
                        [
                            'id' => 123,
                            'type' => 'photo',
                            'canView' => true,
                            'createdAt' => '2025-01-01T00:00:00+00:00',
                            'duration' => 0,
                            'files' => [
                                'full' => ['url' => 'https://cdn2.onlyfans.com/files/full.jpg', 'width' => 2048, 'height' => 1360],
                                'thumb' => ['url' => 'https://cdn2.onlyfans.com/files/thumb.jpg', 'width' => 300, 'height' => 300],
                                'preview' => ['url' => 'https://cdn2.onlyfans.com/files/preview.jpg', 'width' => 960, 'height' => 638],
                            ],
                            'videoSources' => ['240' => null, '720' => null],
                        ],
                    ],
                ],
            ],
            'hasMore' => false,
            'nextLastId' => '123',
        ],
    ];
}

beforeEach(function () {
    config(['services.onlyfans.key' => 'test-key', 'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api']);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
    $this->admin = User::factory()->admin()->create();
});

it('returns renderable media for the chat gallery, not the raw message wrappers', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(ofChatMediaExample())]);

    test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/chats/101/media")
        ->assertOk()
        ->assertJsonPath('items.0.id', '123')
        ->assertJsonPath('items.0.type', 'photo')
        ->assertJsonPath('items.0.thumb', 'https://cdn2.onlyfans.com/files/thumb.jpg')
        ->assertJsonPath('items.0.full', 'https://cdn2.onlyfans.com/files/full.jpg');
});

it('flattens every message so a multi-media message contributes each of its items', function () {
    $payload = ofChatMediaExample();
    $second = $payload['data']['list'][0];
    $second['id'] = 502;
    $second['media'][0]['id'] = 456;
    $payload['data']['list'][] = $second;

    Http::fake(['app.onlyfansapi.com/*' => Http::response($payload)]);

    $items = test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/chats/101/media")
        ->assertOk()
        ->json('items');

    expect($items)->toHaveCount(2)
        ->and(array_column($items, 'id'))->toBe(['123', '456']);
});

it('skips a message that carries no media at all', function () {
    $payload = ofChatMediaExample();
    $payload['data']['list'][] = ['responseType' => 'message', 'text' => 'just words', 'id' => 503, 'media' => []];

    Http::fake(['app.onlyfansapi.com/*' => Http::response($payload)]);

    test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/chats/101/media")
        ->assertOk()
        ->assertJsonCount(1, 'items');
});

it('keeps the gallery paginating on the message cursor', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(ofChatMediaExample())]);

    test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/chats/101/media")
        ->assertOk()
        ->assertJsonPath('hasMore', false)
        ->assertJsonPath('next', '123');
});
