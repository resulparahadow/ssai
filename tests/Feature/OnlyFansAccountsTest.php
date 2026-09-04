<?php

use App\Models\AichModel;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

/**
 * `GET /api/accounts` (OnlyFansAPI "Account" tag) lists the OnlyFans accounts connected
 * to the agency's OnlyFansAPI key. The Creator Models page uses it to pick an
 * `of_account_id` from real accounts instead of pasting an `acct_…` string by hand.
 *
 * The fixture below is the vendor's OWN documented example payload (openapi.yaml
 * `paths./api/accounts.get.responses.200…example`), trimmed to the fields we read —
 * a hand-written fake would just re-encode whatever field we guessed wrong.
 * Note it is a BARE ARRAY: this endpoint has no `data` wrapper (and no `_meta`).
 */
function ofAccountsExample(): array
{
    return [
        [
            'id' => 'acct_123',
            'onlyfans_id' => 123,
            'onlyfans_username' => 'user',
            'onlyfans_email' => 'user@example.com',
            'is_authenticated' => true,
            'authentication_progress' => 'signed_in',
            'display_name' => 'oft',
            'onlyfans_user_data' => [
                'id' => 123,
                'name' => 'Name',
                'username' => 'user',
                'avatar' => 'https://example.com',
                'avatarThumbs' => ['c50' => 'https://example.com', 'c144' => 'https://example.com'],
                'isAuth' => true,
                'postsCount' => 0,
                'subscribersCount' => 123,
            ],
        ],
    ];
}

beforeEach(function () {
    config(['services.onlyfans.key' => 'test-key', 'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api']);
    $this->admin = User::factory()->admin()->create();
});

it('lists the connected OnlyFans accounts from the vendor bare-array payload', function () {
    Http::fake(['app.onlyfansapi.com/api/accounts*' => Http::response(ofAccountsExample())]);

    test()->actingAs($this->admin)
        ->getJson('/of/accounts')
        ->assertOk()
        ->assertJsonPath('accounts.0.id', 'acct_123')
        ->assertJsonPath('accounts.0.username', 'user')
        ->assertJsonPath('accounts.0.name', 'oft')
        ->assertJsonPath('accounts.0.email', 'user@example.com')
        ->assertJsonPath('accounts.0.isAuthenticated', true)
        ->assertJsonPath('accounts.0.authProgress', 'signed_in')
        ->assertJsonPath('accounts.0.avatar', 'https://example.com')
        ->assertJsonPath('accounts.0.subscribersCount', 123);
});

it('labels an account by its OnlyFans profile name when no display name is set', function () {
    $payload = ofAccountsExample();
    $payload[0]['display_name'] = null;

    Http::fake(['app.onlyfansapi.com/api/accounts*' => Http::response($payload)]);

    test()->actingAs($this->admin)
        ->getJson('/of/accounts')
        ->assertOk()
        ->assertJsonPath('accounts.0.name', 'Name');
});

it('reads a data-wrapped payload too, since every other vendor endpoint wraps', function () {
    Http::fake(['app.onlyfansapi.com/api/accounts*' => Http::response(['data' => ofAccountsExample()])]);

    test()->actingAs($this->admin)
        ->getJson('/of/accounts')
        ->assertOk()
        ->assertJsonPath('accounts.0.id', 'acct_123');
});

it('forbids chatters from listing agency accounts (manage-team gate)', function () {
    Http::fake(['app.onlyfansapi.com/api/accounts*' => Http::response(ofAccountsExample())]);

    test()->actingAs(User::factory()->chatter()->create())
        ->getJson('/of/accounts')
        ->assertForbidden();
});

it('forwards an upstream failure instead of returning an empty account list', function () {
    Http::fake(['app.onlyfansapi.com/api/accounts*' => Http::response(
        ['error' => 'UNAUTHENTICATED', 'message' => 'Invalid API key.'], 401
    )]);

    test()->actingAs($this->admin)
        ->getJson('/of/accounts')
        ->assertStatus(401)
        ->assertJsonPath('message', 'Invalid API key.');
});

it('keeps the account id a model already stores resolvable against the list', function () {
    // The picker marks a stored id that no longer matches any connected account, so the
    // ids the endpoint returns must be the same `acct_…` strings `aich_models` persists.
    AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_123']);

    Http::fake(['app.onlyfansapi.com/api/accounts*' => Http::response(ofAccountsExample())]);

    $ids = test()->actingAs($this->admin)->getJson('/of/accounts')->json('accounts.*.id');

    expect($ids)->toContain(AichModel::firstWhere('name', 'Camila')->of_account_id);
});

// ---- Creating a creator model straight from a connected account ------------

it('creates a creator model from a connected account, named after it', function () {
    Http::fake(['app.onlyfansapi.com/api/accounts*' => Http::response(ofAccountsExample())]);

    test()->actingAs($this->admin)
        ->post('/models/from-account', ['of_account_id' => 'acct_123'])
        ->assertRedirect();

    $model = AichModel::firstWhere('of_account_id', 'acct_123');

    expect($model)->not->toBeNull()
        ->and($model->name)->toBe('oft');
});

it('sends the manager to the new model so the other fields can be filled in', function () {
    Http::fake(['app.onlyfansapi.com/api/accounts*' => Http::response(ofAccountsExample())]);

    test()->actingAs($this->admin)
        ->post('/models/from-account', ['of_account_id' => 'acct_123'])
        ->assertRedirect('/models/'.AichModel::firstWhere('of_account_id', 'acct_123')->id);
});

it('names the model after the OnlyFans username when the account has no display name', function () {
    $payload = ofAccountsExample();
    $payload[0]['display_name'] = null;
    $payload[0]['onlyfans_user_data']['name'] = '';

    Http::fake(['app.onlyfansapi.com/api/accounts*' => Http::response($payload)]);

    test()->actingAs($this->admin)->post('/models/from-account', ['of_account_id' => 'acct_123']);

    expect(AichModel::firstWhere('of_account_id', 'acct_123')->name)->toBe('user');
});

it('keeps the model name unique when one already uses the account label', function () {
    // `aich_models.name` is the creator key every assignment and session row joins on, so a
    // second model may not reuse it — without this the create fails a unique constraint.
    AichModel::create(['name' => 'oft']);

    Http::fake(['app.onlyfansapi.com/api/accounts*' => Http::response(ofAccountsExample())]);

    test()->actingAs($this->admin)->post('/models/from-account', ['of_account_id' => 'acct_123']);

    expect(AichModel::firstWhere('of_account_id', 'acct_123')->name)->toBe('oft (@user)');
});

it('refuses an account id that is not actually connected', function () {
    // The id comes from the browser, so it is checked against the live list rather than
    // trusted — otherwise a stale page could create a model wired to a dead account.
    Http::fake(['app.onlyfansapi.com/api/accounts*' => Http::response(ofAccountsExample())]);

    test()->actingAs($this->admin)
        ->post('/models/from-account', ['of_account_id' => 'acct_nope'])
        ->assertSessionHasErrors('of_account_id');

    expect(AichModel::count())->toBe(0);
});

it('refuses to add the same account twice', function () {
    AichModel::create(['name' => 'Camila', 'of_account_id' => 'acct_123']);

    Http::fake(['app.onlyfansapi.com/api/accounts*' => Http::response(ofAccountsExample())]);

    test()->actingAs($this->admin)
        ->post('/models/from-account', ['of_account_id' => 'acct_123'])
        ->assertSessionHasErrors('of_account_id');

    expect(AichModel::count())->toBe(1);
});

it('forbids chatters from adding an account as a creator model', function () {
    Http::fake(['app.onlyfansapi.com/api/accounts*' => Http::response(ofAccountsExample())]);

    test()->actingAs(User::factory()->chatter()->create())
        ->post('/models/from-account', ['of_account_id' => 'acct_123'])
        ->assertForbidden();

    expect(AichModel::count())->toBe(0);
});
