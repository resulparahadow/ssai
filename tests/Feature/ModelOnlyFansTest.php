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
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam', 'tier' => 'standard']);
});

it('renders the model show page with connected flag', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->get("/models/{$this->model->id}")
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->component('ModelShow')
            ->where('model.name', 'Camila')
            ->where('connected', true));
});

it('returns live account status normalised', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => ['isAuth' => true, 'id' => 7, 'username' => 'camila', 'name' => 'Camila', 'avatar' => 'https://x/a.jpg', 'subscribersCount' => 42, 'postsCount' => 9],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/models/{$this->model->id}/of/status")
        ->assertOk()
        ->assertJsonPath('status.isAuth', true)
        ->assertJsonPath('status.username', 'camila')
        ->assertJsonPath('status.subscribersCount', 42);

    Http::assertSent(fn ($r) => str_contains($r->url(), '/acct_cam/me') && $r->hasHeader('Authorization', 'Bearer test-key'));
});

it('lists active fans normalised with spend', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [
            'list' => [[
                'id' => 101, 'name' => 'Jake', 'username' => 'jake_w', 'isVerified' => true,
                'avatarThumbs' => ['c144' => 'https://cdn/a144.jpg'],
                'subscribedOnDuration' => '6 months',
                'subscribedOnData' => ['regularPrice' => 4.99, 'totalSumm' => 120, 'tipsSumm' => 20, 'subscribeAt' => '2026-01-01T00:00:00+00:00', 'expiredAt' => '2026-07-01T00:00:00+00:00'],
                'lastSeen' => '2026-06-20T00:00:00+00:00',
            ]],
            'hasMore' => true,
        ],
        '_pagination' => ['next_page' => null],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/models/{$this->model->id}/of/fans?bucket=active&limit=20")
        ->assertOk()
        ->assertJsonPath('fans.0.name', 'Jake')
        ->assertJsonPath('fans.0.avatar', 'https://cdn/a144.jpg')
        ->assertJsonPath('fans.0.totalSpent', 120)
        ->assertJsonPath('fans.0.tips', 20)
        ->assertJsonPath('fans.0.subscribePrice', 4.99)
        ->assertJsonPath('hasMore', true);

    Http::assertSent(fn ($r) => str_contains($r->url(), '/acct_cam/fans/active'));
});

it('lists top fans from the users[] shape', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [
            'users' => [['id' => 9, 'name' => 'Whale', 'username' => 'whale', 'subscribedOnData' => ['totalSumm' => 875, 'tipsSumm' => 500]]],
        ],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/models/{$this->model->id}/of/fans?bucket=top&by=total")
        ->assertOk()
        ->assertJsonPath('fans.0.name', 'Whale')
        ->assertJsonPath('fans.0.totalSpent', 875);

    Http::assertSent(fn ($r) => str_contains($r->url(), '/acct_cam/fans/top'));
});

it('returns a fan subscription history', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => ['list' => [['subscribeDate' => '2026-01-01T00:00:00+00:00', 'expireDate' => '2026-02-01T00:00:00+00:00', 'price' => 12.99]], 'hasMore' => false],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/models/{$this->model->id}/of/fans/101/history")
        ->assertOk()
        ->assertJsonPath('history.0.price', 12.99);

    Http::assertSent(fn ($r) => str_contains($r->url(), '/acct_cam/fans/101/subscriptions-history'));
});

it('returns settings flags plus profile identity from /me', function () {
    Http::fake([
        'app.onlyfansapi.com/api/acct_cam/settings' => Http::response(['data' => ['isPrivate' => true, 'isDrmEnabled' => false, 'blockedCountries' => ['US', 'CA']]]),
        'app.onlyfansapi.com/api/acct_cam/me' => Http::response(['data' => ['name' => 'Camila', 'about' => '<p>hi</p>', 'location' => 'EU', 'website' => 'https://x', 'subscribePrice' => 9.99]]),
    ]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/models/{$this->model->id}/of/settings")
        ->assertOk()
        ->assertJsonPath('settings.isPrivate', true)
        ->assertJsonPath('settings.blockedCountriesCount', 2)
        ->assertJsonPath('profile.about', 'hi')
        ->assertJsonPath('profile.subscribePrice', 9.99);
});

it('updates the profile via POST with only sent fields', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['success' => true]])]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/models/{$this->model->id}/of/settings/profile", ['about' => 'new bio'])
        ->assertOk()
        ->assertJsonPath('ok', true);

    Http::assertSent(fn ($r) => $r->method() === 'POST'
        && str_ends_with($r->url(), '/acct_cam/settings/profile')
        && $r['about'] === 'new bio'
        && ! array_key_exists('name', $r->data()));
});

it('validates the subscription price', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['success' => true]])]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->patchJson("/models/{$this->model->id}/of/settings/subscription-price", ['price' => '3.00'])
        ->assertStatus(422);

    $this->actingAs($admin)
        ->patchJson("/models/{$this->model->id}/of/settings/subscription-price", ['price' => '9.99'])
        ->assertOk();

    Http::assertSent(fn ($r) => $r->method() === 'PATCH' && str_ends_with($r->url(), '/subscription-price') && $r['price'] === '9.99');
});

it('gets and toggles the welcome message', function () {
    Http::fake([
        'app.onlyfansapi.com/api/acct_cam/settings/welcome-message' => Http::response(['data' => ['id' => 5, 'text' => '<p>hey</p>', 'isActive' => true, 'price' => 0, 'mediaCount' => 0, 'media' => []]]),
    ]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->getJson("/models/{$this->model->id}/of/welcome-message")
        ->assertOk()
        ->assertJsonPath('welcome.text', '<p>hey</p>')
        ->assertJsonPath('welcome.isActive', true);

    $this->actingAs($admin)
        ->patchJson("/models/{$this->model->id}/of/welcome-message", ['enabled' => false])
        ->assertOk();

    Http::assertSent(fn ($r) => $r->method() === 'PATCH' && str_ends_with($r->url(), '/welcome-message') && $r['enabled'] === false);
});

it('forwards an OnlyFans error status through the proxy', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['error' => 'nope'], 403)]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/models/{$this->model->id}/of/status")
        ->assertStatus(403)
        ->assertJsonPath('error', 'nope');
});

it('blocks chatters and managers without manage-team from model OF endpoints', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['isAuth' => true]])]);

    // chatter — even when assigned — cannot reach the manage-team-gated model endpoints
    $chatter = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $chatter->id, 'creator_model' => 'Camila']);
    $this->actingAs($chatter)->getJson("/models/{$this->model->id}/of/status")->assertForbidden();

    // manager passes the gate
    $this->actingAs(User::factory()->manager()->create())->getJson("/models/{$this->model->id}/of/status")->assertOk();
});

it('422s when the creator has no OnlyFans account', function () {
    $model = AichModel::create(['name' => 'NoOf']);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/models/{$model->id}/of/status")
        ->assertStatus(422);
});

it('lists notifications with replacePairs substituted into plain text', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [
            'list' => [[
                'id' => 1, 'type' => 'subscribed', 'subType' => 'new_subscriber', 'isRead' => false,
                'createdAt' => '2026-06-01T00:00:00+00:00',
                'text' => '{NAME} subscribed for {PRICE}',
                'replacePairs' => ['{NAME}' => "<a href='x'>Jake</a>", '{PRICE}' => 'free'],
                'user' => ['id' => 101],
            ]],
            'hasMore' => false,
        ],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/models/{$this->model->id}/of/notifications?type=all")
        ->assertOk()
        ->assertJsonPath('notifications.0.text', 'Jake subscribed for free')
        ->assertJsonPath('notifications.0.isRead', false)
        ->assertJsonPath('notifications.0.userId', '101');

    Http::assertSent(fn ($r) => str_contains($r->url(), '/acct_cam/notifications'));
});

it('gets notification counts and marks all read', function () {
    Http::fake([
        'app.onlyfansapi.com/api/acct_cam/notifications/counts' => Http::response(['data' => ['all' => 5, 'tip' => 2]]),
        'app.onlyfansapi.com/api/acct_cam/notifications/mark-all-as-read' => Http::response(['data' => ['success' => true]]),
    ]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)->getJson("/models/{$this->model->id}/of/notifications/counts")->assertOk()->assertJsonPath('counts.all', 5);
    $this->actingAs($admin)->postJson("/models/{$this->model->id}/of/notifications/mark-read")->assertOk()->assertJsonPath('ok', true);

    Http::assertSent(fn ($r) => $r->method() === 'POST' && str_ends_with($r->url(), '/notifications/mark-all-as-read'));
});

it('looks up a user and toggles block on/off', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101, 'name' => 'Jake', 'username' => 'jake', 'isBlocked' => true, 'subscribedBy' => false]])]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->getJson("/models/{$this->model->id}/of/users/101")
        ->assertOk()
        ->assertJsonPath('user.username', 'jake')
        ->assertJsonPath('user.isBlocked', true);

    $this->actingAs($admin)->postJson("/models/{$this->model->id}/of/users/101/block")->assertOk()->assertJsonPath('ok', true);
    $this->actingAs($admin)->deleteJson("/models/{$this->model->id}/of/users/101/block")->assertOk();

    Http::assertSent(fn ($r) => $r->method() === 'POST' && str_ends_with($r->url(), '/users/101/block'));
    Http::assertSent(fn ($r) => $r->method() === 'DELETE' && str_ends_with($r->url(), '/users/101/block'));
});

it('mass-lists user details keyed by id, capped at 10', function () {
    Http::fake(['app.onlyfansapi.com/api/acct_cam/users/list*' => Http::response([
        'data' => [
            '101' => ['id' => 101, 'name' => 'Jake', 'username' => 'jake', 'isVerified' => true],
            '202' => ['id' => 202, 'name' => 'Mia', 'username' => 'mia', 'subscribedBy' => true],
        ],
    ])]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->getJson("/models/{$this->model->id}/of/users/list?ids=101,202")
        ->assertOk()
        ->assertJsonCount(2, 'users')
        ->assertJsonPath('users.0.username', 'jake')
        ->assertJsonPath('users.1.subscribedBy', true);

    // empty ids → 422 without calling upstream
    $this->actingAs($admin)
        ->getJson("/models/{$this->model->id}/of/users/list?ids=")
        ->assertStatus(422);

    // never sends more than 10 ids upstream
    $many = collect(range(1, 15))->implode(',');
    $this->actingAs($admin)->getJson("/models/{$this->model->id}/of/users/list?ids={$many}")->assertOk();

    Http::assertSent(fn ($r) => str_contains($r->url(), '/users/list') && $r['ids'] === '101,202');
    Http::assertSent(fn ($r) => str_contains($r->url(), '/users/list') && count(explode(',', $r['ids'])) === 10);
});

it('lists, creates and deletes tracking links', function () {
    Http::fake([
        'app.onlyfansapi.com/api/acct_cam/tracking-links*' => Http::response([
            'data' => ['list' => [['id' => 7, 'campaignName' => 'IG bio', 'campaignUrl' => 'https://onlyfans.com/x/c7', 'clicksCount' => 100, 'subscribersCount' => 10, 'tags' => ['IG'], 'revenue' => ['total' => 20, 'spendersCount' => 1]]], 'hasMore' => false],
            '_pagination' => ['next_page' => null],
        ]),
    ]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->getJson("/models/{$this->model->id}/of/tracking-links")
        ->assertOk()
        ->assertJsonPath('links.0.name', 'IG bio')
        ->assertJsonPath('links.0.clicks', 100)
        ->assertJsonPath('links.0.revenue', 20);

    $this->actingAs($admin)
        ->postJson("/models/{$this->model->id}/of/tracking-links", ['name' => 'Twitter', 'tags' => ['x']])
        ->assertOk()->assertJsonPath('ok', true);

    $this->actingAs($admin)->deleteJson("/models/{$this->model->id}/of/tracking-links/7")->assertOk();

    Http::assertSent(fn ($r) => $r->method() === 'POST' && str_ends_with($r->url(), '/tracking-links') && $r['name'] === 'Twitter');
    Http::assertSent(fn ($r) => $r->method() === 'DELETE' && str_ends_with($r->url(), '/tracking-links/7'));
});

it('lists and creates trial links with validation', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => ['list' => [['id' => 3, 'trialLinkName' => 'Promo', 'url' => 'https://onlyfans.com/x/trial/c', 'subscribeDays' => 7, 'claimCounts' => 5, 'subscribeCounts' => 2, 'tags' => [], 'revenue' => ['total' => 30]]], 'hasMore' => false],
        '_pagination' => ['next_page' => null],
    ])]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->getJson("/models/{$this->model->id}/of/trial-links")
        ->assertOk()
        ->assertJsonPath('links.0.name', 'Promo')
        ->assertJsonPath('links.0.subscribeDays', 7);

    // invalid duration → 422
    $this->actingAs($admin)
        ->postJson("/models/{$this->model->id}/of/trial-links", ['duration' => 5, 'offerExpiration' => 7, 'offerLimit' => 10])
        ->assertStatus(422);

    $this->actingAs($admin)
        ->postJson("/models/{$this->model->id}/of/trial-links", ['duration' => 7, 'offerExpiration' => 7, 'offerLimit' => 10, 'name' => 'Promo'])
        ->assertOk()->assertJsonPath('ok', true);

    Http::assertSent(fn ($r) => $r->method() === 'POST' && str_ends_with($r->url(), '/trial-links') && $r['duration'] === 7);
});

it('lists, creates and deletes smart links scoped to the account', function () {
    Http::fake(['app.onlyfansapi.com/api/smart-links*' => Http::response([
        'data' => [[
            'id' => 'sl_1', 'name' => 'TikTok', 'link_type' => 'tracking_link', 'traffic_redirect_url' => 'https://onlyfans.com/x/sl1',
            'free_trial_days' => null, 'clicks_count' => 80, 'conversions_count' => 9, 'subscribers_count' => 7, 'spenders_count' => 3,
            'revenue' => '120.50', 'account' => ['id' => 'acct_cam', 'display_name' => 'Camila', 'username' => 'camila'],
        ]],
    ])]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->getJson("/models/{$this->model->id}/of/smart-links")
        ->assertOk()
        ->assertJsonPath('links.0.name', 'TikTok')
        ->assertJsonPath('links.0.linkType', 'tracking_link')
        ->assertJsonPath('links.0.revenue', 120.5)
        ->assertJsonPath('links.0.conversions', 9);

    // free_trial without days → 422 (required_if)
    $this->actingAs($admin)
        ->postJson("/models/{$this->model->id}/of/smart-links", ['name' => 'Promo', 'link_type' => 'free_trial'])
        ->assertStatus(422);

    $this->actingAs($admin)
        ->postJson("/models/{$this->model->id}/of/smart-links", ['name' => 'Promo', 'link_type' => 'free_trial', 'free_trial_days' => 7])
        ->assertOk()->assertJsonPath('ok', true);

    $this->actingAs($admin)->deleteJson("/models/{$this->model->id}/of/smart-links/sl_1")->assertOk();

    // list is scoped to this creator's account; create injects account_id
    Http::assertSent(fn ($r) => $r->method() === 'GET' && str_contains($r->url(), 'smart-links?') && str_contains($r->url(), 'account_ids=acct_cam'));
    Http::assertSent(fn ($r) => $r->method() === 'POST' && str_ends_with($r->url(), '/smart-links') && $r['account_id'] === 'acct_cam' && $r['free_trial_days'] === 7);
    Http::assertSent(fn ($r) => $r->method() === 'DELETE' && str_ends_with($r->url(), '/smart-links/sl_1'));
});

it('returns smart link conversions and spenders normalised', function () {
    Http::fake([
        'app.onlyfansapi.com/api/smart-links/sl_1/conversions*' => Http::response([
            'data' => [
                'summary' => ['conversions_total' => 2, 'subscribers_total' => 1, 'revenue_total' => 40],
                'rows' => [['id' => 'cv1', 'conversion_type' => 'new_subscriber', 'amount_gross' => 25, 'amount_net' => 20, 'conversion_at' => '2026-06-01T00:00:00Z', 'fan' => ['onlyfans_id' => '101', 'username' => 'jake', 'name' => 'Jake', 'avatar_url' => null]]],
            ],
        ]),
        'app.onlyfansapi.com/api/smart-links/sl_1/spenders*' => Http::response([
            'data' => [['onlyfans_id' => '101', 'username' => 'jake', 'revenue' => ['total' => 88.5]]],
        ]),
    ]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->getJson("/models/{$this->model->id}/of/smart-links/sl_1/conversions")
        ->assertOk()
        ->assertJsonPath('summary.conversionsTotal', 2)
        ->assertJsonPath('rows.0.amountNet', 20)
        ->assertJsonPath('rows.0.fan.username', 'jake');

    $this->actingAs($admin)
        ->getJson("/models/{$this->model->id}/of/smart-links/sl_1/spenders")
        ->assertOk()
        ->assertJsonPath('rows.0.username', 'jake')
        ->assertJsonPath('rows.0.revenue', 88.5);
});

it('lists, adds and removes smart link tags', function () {
    Http::fake(['app.onlyfansapi.com/api/smart-links/sl_1/tags' => Http::response(['tags' => ['Instagram', 'Promo']])]);
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->getJson("/models/{$this->model->id}/of/smart-links/sl_1/tags")
        ->assertOk()->assertJsonPath('tags', ['Instagram', 'Promo']);

    $this->actingAs($admin)
        ->postJson("/models/{$this->model->id}/of/smart-links/sl_1/tags", ['tags' => ['Promo']])
        ->assertOk()->assertJsonPath('tags.1', 'Promo');

    $this->actingAs($admin)
        ->deleteJson("/models/{$this->model->id}/of/smart-links/sl_1/tags", ['tags' => ['Promo']])
        ->assertOk();

    Http::assertSent(fn ($r) => $r->method() === 'POST' && str_ends_with($r->url(), '/tags') && $r['tags'] === ['Promo']);
    Http::assertSent(fn ($r) => $r->method() === 'DELETE' && str_ends_with($r->url(), '/sl_1/tags') && $r['tags'] === ['Promo']);
});

it('lists agency-wide link tags with a type filter', function () {
    Http::fake(['app.onlyfansapi.com/api/link-tags*' => Http::response(['data' => ['tags' => ['Instagram', 'Twitter']]])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/models/{$this->model->id}/of/link-tags?type=smart_links")
        ->assertOk()->assertJsonPath('tags', ['Instagram', 'Twitter']);

    Http::assertSent(fn ($r) => str_contains($r->url(), 'link-tags') && str_contains($r->url(), 'type=smart_links'));
});

it('blocks chatters from smart link endpoints', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => []])]);

    $this->actingAs(User::factory()->chatter()->create())
        ->getJson("/models/{$this->model->id}/of/smart-links")
        ->assertForbidden();
});
