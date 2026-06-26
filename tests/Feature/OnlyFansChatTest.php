<?php

use App\Models\AichModel;
use App\Models\ModelAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Inertia\Testing\AssertableInertia;

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['services.onlyfans.key' => 'test-key', 'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api']);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
});

it('renders the Conversations shell with the selected creator', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->get('/conversations?creator=Camila')
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $p) => $p->component('Conversations')->where('selectedCreator', 'Camila'));
});

it('lists chats live and normalises them', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [['fan' => ['id' => 101, 'name' => 'Jake', 'username' => 'jake_w'], 'unreadMessagesCount' => 2, 'lastMessage' => ['text' => 'hey']]],
        '_pagination' => ['next_page' => null],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats")
        ->assertOk()
        ->assertJsonPath('chats.0.id', '101')
        ->assertJsonPath('chats.0.name', 'Jake')
        ->assertJsonPath('chats.0.unread', 2);

    Http::assertSent(fn ($r) => str_contains($r->url(), '/acct_cam/chats') && $r->hasHeader('Authorization', 'Bearer test-key'));
});

it('lists messages and tags sender by fan id', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [
            ['id' => 1, 'text' => 'hi babe', 'fromUser' => ['id' => 101], 'createdAt' => '2026-06-24T10:00:00Z'],
            ['id' => 2, 'text' => 'hey you', 'fromUser' => ['id' => 999], 'createdAt' => '2026-06-24T10:01:00Z'],
        ],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats/101/messages")
        ->assertOk()
        ->assertJsonPath('messages.0.from', 'fan')
        ->assertJsonPath('messages.1.from', 'creator');
});

it('sends text to OnlyFans and blocks PPV', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 555, 'text' => 'hello', 'fromUser' => ['id' => 999]]])]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->postJson("/onlyfans/{$this->model->id}/chats/101/messages", ['text' => 'hello'])
        ->assertOk()
        ->assertJsonPath('message.from', 'creator');
    Http::assertSent(fn ($r) => $r->method() === 'POST' && str_contains($r->url(), '/acct_cam/chats/101/messages') && $r['text'] === 'hello');

    $this->actingAs($admin)
        ->postJson("/onlyfans/{$this->model->id}/chats/101/messages", ['text' => 'pay me', 'price' => 20])
        ->assertStatus(422);
});

it('proxies like, unlike and delete to the right method+path', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['ok' => true])]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)->postJson("/onlyfans/{$this->model->id}/chats/101/messages/9/like")->assertOk();
    $this->actingAs($admin)->postJson("/onlyfans/{$this->model->id}/chats/101/messages/9/unlike")->assertOk();
    $this->actingAs($admin)->deleteJson("/onlyfans/{$this->model->id}/chats/101/messages/9")->assertOk();

    Http::assertSent(fn ($r) => $r->method() === 'POST' && str_ends_with($r->url(), '/messages/9/like'));
    Http::assertSent(fn ($r) => $r->method() === 'POST' && str_ends_with($r->url(), '/messages/9/unlike'));
    Http::assertSent(fn ($r) => $r->method() === 'DELETE' && str_ends_with($r->url(), '/messages/9'));
});

it('forwards an OnlyFans error status through the proxy', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['error' => 'nope'], 403)]);

    $this->actingAs(User::factory()->admin()->create())
        ->deleteJson("/onlyfans/{$this->model->id}/chats/101/messages/9")
        ->assertStatus(403)
        ->assertJsonPath('error', 'nope');
});

it('scopes access: a chatter can only reach assigned creators', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => [], '_pagination' => ['next_page' => null]])]);
    $chatter = User::factory()->chatter()->create();

    $this->actingAs($chatter)->getJson("/onlyfans/{$this->model->id}/chats")->assertForbidden();

    ModelAssignment::create(['user_id' => $chatter->id, 'creator_model' => 'Camila']);
    $this->actingAs($chatter)->getJson("/onlyfans/{$this->model->id}/chats")->assertOk();
});

it('422s when the creator has no OnlyFans account', function () {
    $model = AichModel::create(['name' => 'NoOf']);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$model->id}/chats")
        ->assertStatus(422);
});

it('generates an AI draft from the live thread via the engine (no persistence)', function () {
    Http::fake([
        '127.0.0.1:8787/*' => Http::response(['draft' => 'aw that means a lot babe', 'strategy' => ['next_move' => 'qualify'], 'telemetry' => ['posture' => 'WARM_BUILD']]),
    ]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/chats/101/generate", [
            'messages' => [['from' => 'fan', 'text' => 'my day was long but better talking to you', 'time' => now()->toIso8601String()]],
            'customer' => ['id' => '101', 'name' => 'Jake'],
        ])
        ->assertOk()
        ->assertJsonPath('draft', 'aw that means a lot babe')
        ->assertJsonPath('telemetry.posture', 'WARM_BUILD');

    Http::assertSent(fn ($r) => str_contains($r->url(), '/generate')
        && $r['model']['prompt'] === 'You are Camila.'
        && collect($r['session']['messages'])->contains(fn ($m) => str_contains($m['text'], 'my day was long')));
});
