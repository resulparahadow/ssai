<?php

use App\Models\AichChatIntel;
use App\Models\AichModel;
use App\Models\ModelAssignment;
use App\Models\User;
use App\Services\OnlyFans\OnlyFansService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
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
        ->assertJsonPath('chats.0.unread', 2)
        ->assertJsonPath('chats.0.preview', 'hey')
        ->assertJsonPath('chats.0.previewKind', null);

    Http::assertSent(fn ($r) => str_contains($r->url(), '/acct_cam/chats') && $r->hasHeader('Authorization', 'Bearer test-key'));
});

it('classifies a text-less last message for the list indicator', function () {
    $svc = app(OnlyFansService::class);

    expect($svc->lastMessageKind(['text' => 'hi', 'media' => [['type' => 'photo']]]))->toBeNull();
    expect($svc->lastMessageKind(['text' => '', 'giphyId' => 'abc']))->toBe('gif');
    expect($svc->lastMessageKind(['text' => '', 'media' => [['type' => 'gif', 'canView' => true]]]))->toBe('gif');
    expect($svc->lastMessageKind(['text' => '', 'media' => [['type' => 'video', 'canView' => true]]]))->toBe('video');
    expect($svc->lastMessageKind(['text' => '', 'media' => [['type' => 'audio', 'canView' => true]]]))->toBe('audio');
    expect($svc->lastMessageKind(['text' => '', 'media' => [['type' => 'photo', 'canView' => true]]]))->toBe('photo');
    expect($svc->lastMessageKind(['text' => '', 'media' => [['type' => 'photo', 'canView' => false]]]))->toBe('locked');
    expect($svc->lastMessageKind(['text' => '', 'mediaCount' => 2]))->toBe('media');
    expect($svc->lastMessageKind(['text' => '', 'isTip' => true]))->toBe('tip');
    expect($svc->lastMessageKind([]))->toBeNull();
});

it('surfaces a previewKind for a chat whose last message is a GIF', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [['fan' => ['id' => 101, 'name' => 'Jake'], 'lastMessage' => ['text' => '', 'giphyId' => 'xyz']]],
        '_pagination' => ['next_page' => null],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats")
        ->assertOk()
        ->assertJsonPath('chats.0.preview', '')
        ->assertJsonPath('chats.0.previewKind', 'gif');
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

it('normalises message media (image, video poster, locked ppv)', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [[
            'id' => 1,
            'text' => 'look',
            'fromUser' => ['id' => 101],
            'createdAt' => '2026-06-24T10:00:00Z',
            'mediaCount' => 3,
            'price' => 15,
            'media' => [
                ['id' => 11, 'type' => 'photo', 'canView' => true, 'files' => ['full' => ['url' => 'https://cdn/full.jpg', 'width' => 800, 'height' => 600], 'thumb' => ['url' => 'https://cdn/thumb.jpg']]],
                ['id' => 12, 'type' => 'video', 'canView' => true, 'duration' => 9, 'files' => ['full' => ['url' => null], 'preview' => ['url' => 'https://cdn/poster.jpg', 'width' => 480, 'height' => 848], 'thumb' => ['url' => 'https://cdn/vthumb.jpg']]],
                ['id' => 13, 'type' => 'photo', 'canView' => false, 'files' => []],
            ],
        ]],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats/101/messages")
        ->assertOk()
        ->assertJsonPath('messages.0.mediaCount', 3)
        ->assertJsonPath('messages.0.media.0.type', 'photo')
        ->assertJsonPath('messages.0.media.0.canView', true)
        ->assertJsonPath('messages.0.media.0.full', 'https://cdn/full.jpg')
        ->assertJsonPath('messages.0.media.0.width', 800)
        ->assertJsonPath('messages.0.media.1.type', 'video')
        ->assertJsonPath('messages.0.media.1.full', null)
        ->assertJsonPath('messages.0.media.1.preview', 'https://cdn/poster.jpg')
        ->assertJsonPath('messages.0.media.1.duration', 9)
        ->assertJsonPath('messages.0.media.2.canView', false)
        ->assertJsonPath('messages.0.media.2.preview', null);
});

it('rebuilds a sent GIF from giphyId when text + media are empty', function () {
    // OnlyFans returns a sent GIF as a bare giphyId (empty text, empty media).
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [[
            'id' => 777, 'text' => '', 'giphyId' => '26gsdCX7tCsAeygLe',
            'fromUser' => ['id' => 999], 'createdAt' => '2026-06-29T08:14:21Z',
            'mediaCount' => 0, 'media' => [],
        ]],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats/101/messages")
        ->assertOk()
        ->assertJsonPath('messages.0.mediaCount', 1)
        ->assertJsonPath('messages.0.media.0.type', 'gif')
        ->assertJsonPath('messages.0.media.0.canView', true)
        ->assertJsonPath('messages.0.media.0.direct', true)
        ->assertJsonPath('messages.0.media.0.preview', 'https://media.giphy.com/media/26gsdCX7tCsAeygLe/200w.gif')
        ->assertJsonPath('messages.0.media.0.full', 'https://media.giphy.com/media/26gsdCX7tCsAeygLe/giphy.gif');
});

it('proxies an OnlyFans CDN media file through the download endpoint', function () {
    // Real JPEG header bytes — non-UTF-8. These must survive the server-side cache;
    // the default (database/utf8mb4) store would reject them with SQLSTATE 1366, so
    // mediaFile caches binary in the byte-safe file store instead.
    $binary = "\xFF\xD8\xFF\xE0\x00\x10JFIF\x00\x01\x02\x03raw-image-bytes\xFF\xD9";
    Http::fake(['app.onlyfansapi.com/*' => Http::response($binary, 200, ['Content-Type' => 'image/jpeg'])]);
    $cdn = 'https://cdn2.onlyfans.com/files/3/35/abc/960x1280_xyz.jpg?Tag=2&u=1&Policy=p&Signature=s&Key-Pair-Id=k';
    $key = 'ofmedia:'.sha1(parse_url($cdn, PHP_URL_PATH));
    Cache::store('file')->forget($key); // file cache persists on disk across runs

    $res = $this->actingAs(User::factory()->admin()->create())
        ->get("/onlyfans/{$this->model->id}/media?url=".urlencode($cdn));

    $res->assertOk()->assertHeader('Content-Type', 'image/jpeg');
    expect($res->getContent())->toBe($binary);

    // Cached in the binary-safe file store, bytes intact (regression guard for 1366).
    expect(Cache::store('file')->get($key)['body'])->toBe($binary);
    Cache::store('file')->forget($key);

    Http::assertSent(fn ($r) => str_contains(rawurldecode($r->url()), '/acct_cam/media/download/')
        && str_contains(rawurldecode($r->url()), 'cdn2.onlyfans.com')
        && $r->hasHeader('Authorization', 'Bearer test-key'));
});

it('rejects a non-OnlyFans media url (SSRF guard)', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->get("/onlyfans/{$this->model->id}/media?url=".urlencode('https://evil.example.com/secret'))
        ->assertStatus(400);
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

it('sends a GIF (giphyId) with optional text', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 556, 'text' => '', 'fromUser' => ['id' => 999]]])]);
    $admin = User::factory()->admin()->create();

    // GIF-only (empty text) is allowed
    $this->actingAs($admin)
        ->postJson("/onlyfans/{$this->model->id}/chats/101/messages", ['text' => '', 'giphyId' => 'WAGC3LeqJvXglm5H7a'])
        ->assertOk()
        ->assertJsonPath('message.from', 'creator');

    // empty text AND no gif → 422
    $this->actingAs($admin)
        ->postJson("/onlyfans/{$this->model->id}/chats/101/messages", ['text' => ''])
        ->assertStatus(422);

    Http::assertSent(fn ($r) => $r->method() === 'POST'
        && str_contains($r->url(), '/acct_cam/chats/101/messages')
        && $r['giphyId'] === 'WAGC3LeqJvXglm5H7a'
        && ! array_key_exists('text', $r->data()));
});

it('lists trending GIFs and searches GIFs normalised', function () {
    // The OFAPI Giphy proxy double-wraps the list as data.data[] (Giphy payload under the OFAPI envelope).
    Http::fake([
        'app.onlyfansapi.com/api/acct_cam/giphy/trending' => Http::response([
            'data' => ['data' => [[
                'id' => 'gif_1', 'url' => 'https://giphy.com/gifs/example1', 'images' => [
                    'fixed_width' => ['url' => 'https://media.giphy.com/media/example1/200w.gif', 'width' => '200', 'height' => '150'],
                    'original' => ['url' => 'https://media.giphy.com/media/example1/giphy.gif', 'width' => '500', 'height' => '375'],
                ],
            ]]],
        ]),
        'app.onlyfansapi.com/api/acct_cam/giphy/search*' => Http::response([
            'data' => ['data' => [[
                'id' => 'gif_2', 'title' => 'Happy', 'url' => 'https://giphy.com/gifs/example2', 'images' => [
                    'fixed_height' => ['url' => 'https://media.giphy.com/media/example2/200.gif', 'width' => '266', 'height' => '200'],
                    'original' => ['url' => 'https://media.giphy.com/media/example2/giphy.gif', 'width' => '400', 'height' => '300'],
                ],
            ]]],
        ]),
    ]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->getJson("/onlyfans/{$this->model->id}/giphy/trending")
        ->assertOk()
        ->assertJsonCount(1, 'gifs') // unwraps data.data[] — not the envelope's keys
        ->assertJsonPath('gifs.0.id', 'gif_1')
        ->assertJsonPath('gifs.0.preview', 'https://media.giphy.com/media/example1/200w.gif')
        ->assertJsonPath('gifs.0.width', 200);

    $this->actingAs($admin)
        ->getJson("/onlyfans/{$this->model->id}/giphy/search?q=happy&limit=24")
        ->assertOk()
        ->assertJsonPath('gifs.0.id', 'gif_2')
        ->assertJsonPath('gifs.0.title', 'Happy')
        ->assertJsonPath('gifs.0.preview', 'https://media.giphy.com/media/example2/200.gif');

    // empty query → 422 without calling upstream
    $this->actingAs($admin)->getJson("/onlyfans/{$this->model->id}/giphy/search?q=")->assertStatus(422);

    Http::assertSent(fn ($r) => str_ends_with($r->url(), '/acct_cam/giphy/trending'));
    Http::assertSent(fn ($r) => str_contains($r->url(), '/acct_cam/giphy/search') && str_contains($r->url(), 'q=happy') && str_contains($r->url(), 'limit=24'));
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

it('persists AI Intel (strategy) on generate and returns generatedAt', function () {
    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101, 'isSubscribed' => true]]),
        '127.0.0.1:8787/*' => Http::response([
            'draft' => 'hey you 🙈',
            'strategy' => ['phase' => 'rapport', 'temperature' => 'warm', 'next_move' => 'tease'],
            'telemetry' => null,
            'usage' => [],
        ]),
    ]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->postJson("/onlyfans/{$this->model->id}/chats/101/generate", [
            'messages' => [['from' => 'fan', 'text' => 'hi']],
            'customer' => ['id' => '101'],
        ])
        ->assertOk()
        ->assertJsonPath('strategy.phase', 'rapport')
        ->assertJsonPath('generatedAt', fn ($v) => is_string($v) && $v !== '');

    $row = AichChatIntel::where('creator_model', 'Camila')->where('chat_id', '101')->first();
    expect($row)->not->toBeNull();
    expect($row->strategy['phase'])->toBe('rapport');
    expect($row->generated_by)->toBe($admin->id);
});

it('serves saved AI Intel via the intel endpoint', function () {
    AichChatIntel::create([
        'creator_model' => 'Camila',
        'chat_id' => '101',
        'strategy' => ['phase' => 'pressure', 'temperature' => 'hot'],
    ]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats/101/intel")
        ->assertOk()
        ->assertJsonPath('strategy.phase', 'pressure')
        ->assertJsonPath('generatedAt', fn ($v) => is_string($v) && $v !== '');
});

it('returns null intel for a chat with no saved strategy', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats/999/intel")
        ->assertOk()
        ->assertJsonPath('strategy', null)
        ->assertJsonPath('generatedAt', null);
});

it('does not persist intel when the engine returns no strategy', function () {
    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 102, 'isSubscribed' => true]]),
        '127.0.0.1:8787/*' => Http::response([
            'draft' => 'hey', 'strategy' => null, 'telemetry' => null, 'usage' => [],
        ]),
    ]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/chats/102/generate", [
            'messages' => [['from' => 'fan', 'text' => 'hi']],
            'customer' => ['id' => '102'],
        ])
        ->assertOk()
        ->assertJsonPath('generatedAt', null);

    $this->assertDatabaseMissing('aich_chat_intel', ['chat_id' => '102']);
});

it('scopes intel access: an unassigned chatter is forbidden', function () {
    AichChatIntel::create([
        'creator_model' => 'Camila', 'chat_id' => '101', 'strategy' => ['phase' => 'rapport'],
    ]);
    $chatter = User::factory()->chatter()->create();

    $this->actingAs($chatter)->getJson("/onlyfans/{$this->model->id}/chats/101/intel")->assertForbidden();

    ModelAssignment::create(['user_id' => $chatter->id, 'creator_model' => 'Camila']);
    $this->actingAs($chatter)
        ->getJson("/onlyfans/{$this->model->id}/chats/101/intel")
        ->assertOk()
        ->assertJsonPath('strategy.phase', 'rapport');
});

it('422s when the creator has no OnlyFans account', function () {
    $model = AichModel::create(['name' => 'NoOf']);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$model->id}/chats")
        ->assertStatus(422);
});

it('generates an AI draft from the live thread via the engine', function () {
    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101, 'isSubscribed' => true]]),
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
