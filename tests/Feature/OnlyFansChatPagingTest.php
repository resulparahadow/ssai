<?php

use App\Models\AichModel;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

/**
 * The conversations list pages on scroll, so the `next` cursor it follows has to carry
 * EVERY param that shaped the first page — otherwise page 2 quietly answers a different
 * question than page 1 (a search that widens back to all chats after one scroll).
 */
beforeEach(function () {
    config(['services.onlyfans.key' => 'test-key', 'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api']);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
    $this->admin = User::factory()->admin()->create();
});

function ofChatsPage(string $nextPage): array
{
    return [
        'data' => [[
            'withUser' => ['id' => 77, 'name' => 'Jake', 'username' => 'jake'],
            'lastMessage' => ['text' => 'hi', 'createdAt' => '2025-01-01T00:00:00+00:00'],
            'unreadMessagesCount' => 0,
        ]],
        '_pagination' => ['next_page' => $nextPage],
    ];
}

it('keeps the search query in the paging cursor so scrolling a search stays filtered', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(ofChatsPage(
        'https://app.onlyfansapi.com/api/acct_cam/chats?limit=100&offset=100&query=jake'
    ))]);

    test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/chats?limit=100&query=jake")
        ->assertOk()
        ->assertJsonPath('next.offset', '100')
        ->assertJsonPath('next.query', 'jake');
});

it('forwards limit, offset and query upstream when the list pages', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(ofChatsPage(''))]);

    test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/chats?limit=100&offset=200&query=jake")
        ->assertOk();

    Http::assertSent(function ($request) {
        $q = [];
        parse_str(parse_url($request->url(), PHP_URL_QUERY) ?: '', $q);

        return str_contains($request->url(), '/chats')
            && ($q['limit'] ?? null) === '100'
            && ($q['offset'] ?? null) === '200'
            && ($q['query'] ?? null) === 'jake';
    });
});

it('reports no next page once the list runs out', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(ofChatsPage(''))]);

    test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/chats?limit=100")
        ->assertOk()
        ->assertJsonPath('next', null);
});
