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

it('forwards the list filter and sort order upstream', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(ofChatsPage(''))]);

    test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/chats?limit=100&filter=unread&order=old")
        ->assertOk();

    Http::assertSent(function ($request) {
        $q = [];
        parse_str(parse_url($request->url(), PHP_URL_QUERY) ?: '', $q);

        return str_contains($request->url(), '/chats')
            && ($q['filter'] ?? null) === 'unread'
            && ($q['order'] ?? null) === 'old';
    });
});

it('drops an off-enum filter or order instead of paying for a validation error', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(ofChatsPage(''))]);

    test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/chats?limit=100&filter=bogus&order=newest")
        ->assertOk();

    Http::assertSent(function ($request) {
        $q = [];
        parse_str(parse_url($request->url(), PHP_URL_QUERY) ?: '', $q);

        return str_contains($request->url(), '/chats')
            && ! array_key_exists('filter', $q)
            && ! array_key_exists('order', $q);
    });
});

it('keeps filter, order and query in the cursor even when next_page omits them', function () {
    // The spec's own example next_page carries only offset + limit.
    Http::fake(['app.onlyfansapi.com/*' => Http::response(ofChatsPage(
        'https://app.onlyfansapi.com/api/acct_cam/chats?offset=100&limit=100'
    ))]);

    test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/chats?limit=100&filter=with_tips&order=old&query=jake")
        ->assertOk()
        ->assertJsonPath('next.offset', '100')
        ->assertJsonPath('next.filter', 'with_tips')
        ->assertJsonPath('next.order', 'old')
        ->assertJsonPath('next.query', 'jake');
});

it('does not invent a cursor from the request when the list has run out', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(ofChatsPage(''))]);

    test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/chats?limit=100&filter=unread")
        ->assertOk()
        ->assertJsonPath('next', null);
});

it('reports no next page once the list runs out', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(ofChatsPage(''))]);

    test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/chats?limit=100")
        ->assertOk()
        ->assertJsonPath('next', null);
});
