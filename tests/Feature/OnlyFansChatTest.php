<?php

use App\Models\AichChatIntel;
use App\Models\AichModel;
use App\Models\CustomerProfile;
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

// Without this the chat list re-labels a renamed fan with their real name on every
// refresh, so a rename looks like it silently reverted.
it('labels a listed chat with the fan custom name when one is set', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [['fan' => [
            'id' => 101, 'name' => 'Jake Wilson', 'username' => 'jake_w', 'displayName' => '🐳Whale',
        ], 'lastMessage' => ['text' => 'hey']]],
        '_pagination' => ['next_page' => null],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats")
        ->assertOk()
        ->assertJsonPath('chats.0.name', '🐳Whale')
        ->assertJsonPath('chats.0.initials', '🐳');
});

it('falls back through the fan label chain when no custom name is set', function () {
    $svc = app(OnlyFansService::class);

    // Empty `displayName` is what OnlyFans sends for a fan with no custom name.
    expect($svc->displayNameOf(['name' => 'Jake', 'displayName' => '']))->toBe('Jake');
    expect($svc->displayNameOf(['name' => 'Jake', 'displayName' => '  ']))->toBe('Jake');
    expect($svc->displayNameOf(['name' => 'Jake', 'displayName' => '🐳Whale']))->toBe('🐳Whale');
    expect($svc->displayNameOf(['username' => 'jake_w']))->toBe('jake_w');
    expect($svc->displayNameOf(['id' => 101]))->toBe('101');
    expect($svc->displayNameOf([]))->toBe('');
});

// `isRestricted` is embedded in the chat list's fan object (verified live), so the list and
// header can flag a restricted fan without a per-chat getUser.
it('surfaces the fan restricted state on listed chats (no extra API call)', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [
            ['fan' => ['id' => 101, 'name' => 'Jake', 'isRestricted' => true], 'lastMessage' => ['text' => 'hey']],
            ['fan' => ['id' => 102, 'name' => 'Sam', 'isRestricted' => false], 'lastMessage' => ['text' => 'yo']],
            ['fan' => ['id' => 103, 'name' => 'Kim'], 'lastMessage' => ['text' => 'hi']],
        ],
        '_pagination' => ['next_page' => null],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats")
        ->assertOk()
        ->assertJsonPath('chats.0.restricted', true)
        ->assertJsonPath('chats.1.restricted', false)
        // Absent key (older payload) must read as not-restricted, never as a badge.
        ->assertJsonPath('chats.2.restricted', false);

    Http::assertSentCount(1);
});

it('surfaces per-fan lifetime spend on listed chats (no extra API call)', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [['fan' => [
            'id' => 101, 'name' => 'Jake', 'username' => 'jake_w',
            'subscribedByData' => ['totalSumm' => 1234.5],
        ], 'lastMessage' => ['text' => 'hey']]],
        '_pagination' => ['next_page' => null],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats")
        ->assertOk()
        ->assertJsonPath('chats.0.id', '101')
        ->assertJsonPath('chats.0.totalSpent', 1234.5);
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

it('surfaces the first_id pagination cursor for loading older messages', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [
            ['id' => 5, 'text' => 'newest', 'fromUser' => ['id' => 101], 'createdAt' => '2026-06-24T10:00:00Z'],
        ],
        '_pagination' => [
            'next_page' => 'https://app.onlyfansapi.com/api/acct_x/chats/101/messages?limit=100&first_id=5',
        ],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats/101/messages")
        ->assertOk()
        ->assertJsonPath('next.first_id', '5')
        ->assertJsonPath('next.limit', '100');
});

it('forwards the id/first_id cursor params to OnlyFans when paging', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => []])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats/101/messages?first_id=5&limit=100")
        ->assertOk();

    Http::assertSent(fn ($request) => str_contains($request->url(), 'first_id=5')
        && str_contains($request->url(), 'limit=100'));
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

it('serializes draft markers and escapes html on send', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 557, 'text' => '', 'fromUser' => ['id' => 999]]])]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/chats/101/messages", ['text' => "I <3 **you**\nreally"])
        ->assertOk();

    // Escaped <, markers converted, newline left raw for OnlyFans to turn into <br />.
    Http::assertSent(fn ($r) => $r->method() === 'POST'
        && str_contains($r->url(), '/acct_cam/chats/101/messages')
        && $r['text'] === "I &lt;3 <strong>you</strong>\nreally");
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

it('returns fan details with live lifetime spend + tips', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => [
        'id' => 101, 'name' => 'Jake', 'username' => 'jake_w',
        'subscribedByData' => ['totalSumm' => 1234.5, 'tipsSumm' => 80],
    ]])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/users/101")
        ->assertOk()
        ->assertJsonPath('fan.id', '101')
        ->assertJsonPath('fan.name', 'Jake')
        ->assertJsonPath('fan.totalSpent', 1234.5)
        ->assertJsonPath('fan.tips', 80);
});

it('surfaces subscription indicators on fan details (no extra API call)', function () {
    // Shaped after a real payload: the documented top-level `subscribedOnDuration`
    // arrives null and the usable label sits in `subscribedOnData.duration`.
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => [
        'id' => 101, 'name' => 'Jake', 'username' => 'jake_w',
        'location' => 'Austin, TX',
        'lastSeen' => '2026-07-15T13:04:11+00:00',
        'subscribedOn' => true,
        'subscribedOnExpiredNow' => false,
        'subscribedOnDuration' => null,
        'subscribedOnData' => [
            'subscribePrice' => 9.99,
            'duration' => '5 months',
            'subscribeAt' => '2026-06-14T10:00:00+00:00',
            'expiredAt' => '2026-08-14T10:00:00+00:00',
        ],
    ]])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/users/101")
        ->assertOk()
        ->assertJsonPath('fan.subscribed', true)
        ->assertJsonPath('fan.durationLabel', '5 months')
        ->assertJsonPath('fan.location', 'Austin, TX')
        ->assertJsonPath('fan.subscribedAt', '2026-06-14T10:00:00+00:00')
        ->assertJsonPath('fan.lastSeen', '2026-07-15T13:04:11+00:00');

    // One upstream call only — the indicators ride along on the existing getUser.
    Http::assertSentCount(1);
});

it('reports a followed non-fan as never-subscribed, not expired', function () {
    // A creator the account follows: subscribedOn false with no subscribedOnData.
    // A null subscribedAt is what lets the panel say "Not subscribed" over "Expired".
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => [
        'id' => 101, 'name' => 'Mia',
        'subscribedOn' => false,
        'subscribedBy' => true,
        'subscribedByData' => ['subscribePrice' => 15, 'duration' => '2 months'],
    ]])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/users/101")
        ->assertOk()
        ->assertJsonPath('fan.subscribed', false)
        ->assertJsonPath('fan.subscribedAt', null)
        // The creator's own $15 sub to them must not leak in as their price/duration.
        ->assertJsonPath('fan.subscribePrice', null)
        ->assertJsonPath('fan.durationLabel', null);
});

it('reads subscribePrice from the fan->creator direction (subscribedOnData)', function () {
    // Regression: the panel used to read subscribedByData (creator->fan), which is
    // the wrong direction and reads 0 for essentially every fan.
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => [
        'id' => 101, 'name' => 'Jake',
        'subscribedByData' => ['subscribePrice' => 0],
        'subscribedOnData' => ['subscribePrice' => 9.99],
    ]])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/users/101")
        ->assertOk()
        ->assertJsonPath('fan.subscribePrice', 9.99);
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

// ---- Chat actions (mute / pin / read / hide) -------------------------------

it('mutes and unmutes a chat, hitting the exact upstream method+path', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['success' => true]])]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)->postJson("/onlyfans/{$this->model->id}/chats/101/mute")->assertOk()->assertJsonPath('ok', true);
    $this->actingAs($admin)->deleteJson("/onlyfans/{$this->model->id}/chats/101/mute")->assertOk()->assertJsonPath('ok', true);

    Http::assertSent(fn ($r) => $r->method() === 'POST' && str_ends_with($r->url(), '/acct_cam/chats/101/mute'));
    // Unmute is DELETE on its OWN path — NOT a DELETE on /mute.
    Http::assertSent(fn ($r) => $r->method() === 'DELETE' && str_ends_with($r->url(), '/acct_cam/chats/101/unmute'));
});

it('surfaces live mute + pinned-count state on the chat list', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [['fan' => ['id' => 101, 'name' => 'Jake'], 'isMutedNotifications' => true, 'countPinnedMessages' => 3]],
        '_pagination' => ['next_page' => null],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats")
        ->assertOk()
        ->assertJsonPath('chats.0.muted', true)
        ->assertJsonPath('chats.0.pinnedCount', 3);
});

it('defaults mute/pinned state when OnlyFans omits the fields', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [['fan' => ['id' => 101, 'name' => 'Jake']]],
        '_pagination' => ['next_page' => null],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats")
        ->assertOk()
        ->assertJsonPath('chats.0.muted', false)
        ->assertJsonPath('chats.0.pinnedCount', 0);
});

it('lists pinned messages via the filter param and marks them pinned', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [['id' => 9, 'text' => 'remember: no feet', 'fromUser' => ['id' => 101], 'isPinned' => true, 'createdAt' => '2026-07-01T10:00:00Z']],
        '_pagination' => ['next_page' => null],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats/101/pinned")
        ->assertOk()
        ->assertJsonPath('messages.0.id', '9')
        ->assertJsonPath('messages.0.isPinned', true)
        ->assertJsonPath('messages.0.from', 'fan');

    Http::assertSent(fn ($r) => str_contains($r->url(), '/acct_cam/chats/101/messages')
        && str_contains($r->url(), 'filter=pinned'));
});

it('pins and unpins a message, hitting the exact upstream method+path', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['success' => true]])]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)->postJson("/onlyfans/{$this->model->id}/chats/101/messages/9/pin")->assertOk()->assertJsonPath('ok', true);
    $this->actingAs($admin)->deleteJson("/onlyfans/{$this->model->id}/chats/101/messages/9/unpin")->assertOk();

    Http::assertSent(fn ($r) => $r->method() === 'POST' && str_ends_with($r->url(), '/messages/9/pin'));
    // Unpin is DELETE on its OWN path — NOT a DELETE on /pin.
    Http::assertSent(fn ($r) => $r->method() === 'DELETE' && str_ends_with($r->url(), '/messages/9/unpin'));
});

it('marks a chat read and unread', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['success' => true]])]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)->postJson("/onlyfans/{$this->model->id}/chats/101/mark-as-read")->assertOk()->assertJsonPath('ok', true);
    $this->actingAs($admin)->postJson("/onlyfans/{$this->model->id}/chats/101/mark-as-unread")->assertOk();

    Http::assertSent(fn ($r) => $r->method() === 'POST' && str_ends_with($r->url(), '/chats/101/mark-as-read'));
    Http::assertSent(fn ($r) => $r->method() === 'POST' && str_ends_with($r->url(), '/chats/101/mark-as-unread'));
});

// OnlyFans returns the custom name as `displayName` and leaves `name` as the fan's real
// name, so echoing `name` would hand the client back the label it already had.
it('renames a fan and echoes back the custom name, not the unchanged real name', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => ['id' => 101, 'name' => 'Jake Wilson', 'displayName' => '🐳Whale'],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->putJson("/onlyfans/{$this->model->id}/chats/101/custom-name", ['custom_name' => '🐳Whale'])
        ->assertOk()
        ->assertJsonPath('ok', true)
        ->assertJsonPath('name', '🐳Whale');

    Http::assertSent(fn ($r) => $r->method() === 'PUT'
        && str_ends_with($r->url(), '/acct_cam/fans/101/custom-name')
        && $r['custom_name'] === '🐳Whale');
});

// Clearing empties `displayName`, so the echo has to fall back to the real name.
it('clears a custom name by sending null and echoes back the real name', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => ['id' => 101, 'name' => 'Jake Wilson', 'displayName' => ''],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->putJson("/onlyfans/{$this->model->id}/chats/101/custom-name", ['custom_name' => null])
        ->assertOk()
        ->assertJsonPath('name', 'Jake Wilson');

    Http::assertSent(fn ($r) => $r->method() === 'PUT' && $r['custom_name'] === null);
});

it('rejects a rename with no custom_name key as JSON 422 (not a redirect)', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => []])]);

    $this->actingAs(User::factory()->admin()->create())
        ->putJson("/onlyfans/{$this->model->id}/chats/101/custom-name", [])
        ->assertStatus(422)
        ->assertJsonStructure(['error']);
});

// ---- Fan note (OnlyFans-owned, crm_notes mirrors it) -----------------------

it('reads the OnlyFans note and mirrors it into crm_notes', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['notes' => 'prefers babe']])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats/101/notes")
        ->assertOk()
        ->assertJsonPath('notes', 'prefers babe')
        ->assertJsonPath('synced', true);

    expect(CustomerProfile::where('of_fan_id', '101')->first()->crm_notes)->toBe('prefers babe');
});

it('saves the note to OnlyFans and mirrors it down only after a 2xx', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101]])]);

    $this->actingAs(User::factory()->admin()->create())
        ->putJson("/onlyfans/{$this->model->id}/chats/101/notes", ['notes' => 'hard no: feet'])
        ->assertOk()
        ->assertJsonPath('ok', true);

    Http::assertSent(fn ($r) => $r->method() === 'PUT'
        && str_ends_with($r->url(), '/acct_cam/fans/101/notes')
        && $r['notes'] === 'hard no: feet');

    expect(CustomerProfile::where('of_fan_id', '101')->first()->crm_notes)->toBe('hard no: feet');
});

it('does NOT mirror the note when OnlyFans rejects the write', function () {
    CustomerProfile::create(['creator_model' => 'Camila', 'of_fan_id' => '101', 'customer_username' => 'jake', 'customer_name' => 'Jake', 'crm_notes' => 'original']);
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['error' => 'nope'], 403)]);

    $this->actingAs(User::factory()->admin()->create())
        ->putJson("/onlyfans/{$this->model->id}/chats/101/notes", ['notes' => 'clobbered'])
        ->assertStatus(403);

    expect(CustomerProfile::where('of_fan_id', '101')->first()->crm_notes)->toBe('original');
});

it('keeps a legacy local note that OnlyFans does not have yet, flagged unsynced', function () {
    CustomerProfile::create(['creator_model' => 'Camila', 'of_fan_id' => '101', 'customer_username' => 'jake', 'customer_name' => 'Jake', 'crm_notes' => 'written before the sync existed']);
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['notes' => '']])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats/101/notes")
        ->assertOk()
        ->assertJsonPath('notes', 'written before the sync existed')
        ->assertJsonPath('synced', false);

    // A read must never push to OnlyFans, and must never destroy the local note.
    Http::assertSentCount(1);
    expect(CustomerProfile::where('of_fan_id', '101')->first()->crm_notes)->toBe('written before the sync existed');
});

it('clears the note on both sides', function () {
    CustomerProfile::create(['creator_model' => 'Camila', 'of_fan_id' => '101', 'customer_username' => 'jake', 'customer_name' => 'Jake', 'crm_notes' => 'bye']);
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101]])]);

    $this->actingAs(User::factory()->admin()->create())
        ->deleteJson("/onlyfans/{$this->model->id}/chats/101/notes")
        ->assertOk()
        ->assertJsonPath('notes', '');

    Http::assertSent(fn ($r) => $r->method() === 'DELETE' && str_ends_with($r->url(), '/acct_cam/fans/101/notes'));
    expect(CustomerProfile::where('of_fan_id', '101')->first()->crm_notes)->toBeNull();
});

it('no longer accepts crm_notes through the profile PATCH (one write path for the note)', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->patchJson("/onlyfans/{$this->model->id}/chats/101/profile", ['crm_notes' => 'sneaky', 'archetype' => 'whale'])
        ->assertOk();

    $p = CustomerProfile::where('of_fan_id', '101')->first();
    expect($p->archetype)->toBe('whale');
    expect($p->crm_notes)->toBeNull();
});

// ---- Authorization matrix --------------------------------------------------

it('scopes the new chat actions: an unassigned chatter is forbidden', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['success' => true]])]);
    $chatter = User::factory()->chatter()->create();

    $this->actingAs($chatter)->postJson("/onlyfans/{$this->model->id}/chats/101/mute")->assertForbidden();
    $this->actingAs($chatter)->getJson("/onlyfans/{$this->model->id}/chats/101/pinned")->assertForbidden();
    $this->actingAs($chatter)->getJson("/onlyfans/{$this->model->id}/chats/101/notes")->assertForbidden();
    $this->actingAs($chatter)->putJson("/onlyfans/{$this->model->id}/chats/101/custom-name", ['custom_name' => 'x'])->assertForbidden();
    $this->actingAs($chatter)->postJson("/onlyfans/{$this->model->id}/chats/101/mark-as-read")->assertForbidden();

    Http::assertNothingSent();
});

it('lets an ASSIGNED chatter use the non-destructive actions', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['success' => true, 'notes' => 'hi']])]);
    $chatter = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $chatter->id, 'creator_model' => 'Camila']);

    $this->actingAs($chatter)->postJson("/onlyfans/{$this->model->id}/chats/101/mute")->assertOk();
    $this->actingAs($chatter)->getJson("/onlyfans/{$this->model->id}/chats/101/notes")->assertOk();
    $this->actingAs($chatter)->postJson("/onlyfans/{$this->model->id}/chats/101/mark-as-read")->assertOk();
    $this->actingAs($chatter)->putJson("/onlyfans/{$this->model->id}/chats/101/custom-name", ['custom_name' => 'VIP'])->assertOk();
});

it('bars even an ASSIGNED chatter from the destructive actions', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['success' => true]])]);
    $chatter = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $chatter->id, 'creator_model' => 'Camila']);

    $this->actingAs($chatter)->postJson("/onlyfans/{$this->model->id}/chats/101/hide")->assertForbidden();
    $this->actingAs($chatter)->postJson("/onlyfans/{$this->model->id}/users/101/block")->assertForbidden();
    $this->actingAs($chatter)->postJson("/onlyfans/{$this->model->id}/users/101/restrict")->assertForbidden();
    $this->actingAs($chatter)->deleteJson("/onlyfans/{$this->model->id}/users/101/subscribe")->assertForbidden();

    Http::assertNothingSent();
});

it('lets a manager hide, block, restrict and unfollow', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['success' => true]])]);
    $manager = User::factory()->manager()->create();

    $this->actingAs($manager)->postJson("/onlyfans/{$this->model->id}/chats/101/hide")->assertOk()->assertJsonPath('ok', true);
    $this->actingAs($manager)->postJson("/onlyfans/{$this->model->id}/users/101/block")->assertOk();
    $this->actingAs($manager)->deleteJson("/onlyfans/{$this->model->id}/users/101/block")->assertOk();
    $this->actingAs($manager)->postJson("/onlyfans/{$this->model->id}/users/101/restrict")->assertOk();
    $this->actingAs($manager)->deleteJson("/onlyfans/{$this->model->id}/users/101/restrict")->assertOk();
    $this->actingAs($manager)->deleteJson("/onlyfans/{$this->model->id}/users/101/subscribe")->assertOk();

    Http::assertSent(fn ($r) => $r->method() === 'POST' && str_ends_with($r->url(), '/chats/101/hide'));
    Http::assertSent(fn ($r) => $r->method() === 'DELETE' && str_ends_with($r->url(), '/users/101/subscribe'));
});

it('forwards an upstream error through the new actions', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['error' => 'rate limited'], 429)]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/chats/101/mute")
        ->assertStatus(429)
        ->assertJsonPath('error', 'rate limited');
});

it('exposes moderation state on the fan payload without an extra call', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => [
        'id' => 101, 'name' => 'Jake', 'username' => 'jake', 'isBlocked' => true, 'isRestricted' => false, 'subscribedBy' => true,
    ]])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/users/101")
        ->assertOk()
        ->assertJsonPath('fan.isBlocked', true)
        ->assertJsonPath('fan.isRestricted', false)
        ->assertJsonPath('fan.subscribedBy', true);

    Http::assertSentCount(1);
});
