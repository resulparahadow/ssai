<?php

use App\Models\AichModel;
use App\Models\AichUsageEvent;
use App\Models\User;
use App\Services\Integrations\ChatProvider;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia;

/*
 * The provider switch (Settings → Integrations) scopes the whole app: OnlyFansAPI and OopCRM list
 * the same creator under different account ids, so only creators connected through the active
 * provider show in the creator selector, the sidebar dropdowns, the dashboards, and get OnlyFans
 * calls. A model with no account yet has nothing to show, so it is hidden too (it stays on the
 * Creator Models page).
 */

uses(RefreshDatabase::class);

beforeEach(function () {
    config([
        'services.onlyfans.key' => 'ofapi-key',
        'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api',
        'services.oopcrm.key' => 'oop-key',
        'services.oopcrm.base_url' => 'https://app.oopcrm.com/api/v1/ofapi',
    ]);

    $this->ofapi = AichModel::create(['name' => 'Ofapi Creator', 'of_account_id' => 'acct_ofapi', 'provider' => 'onlyfansapi']);
    $this->oop = AichModel::create(['name' => 'Oop Creator', 'of_account_id' => 'acct_oop', 'provider' => 'oopcrm']);
    $this->bare = AichModel::create(['name' => 'No Account']);
    $this->admin = User::factory()->admin()->create();
});

function sharedCreatorNames($test): array
{
    $names = [];
    $test->actingAs($test->admin)->get('/dashboard')
        ->assertInertia(function (AssertableInertia $p) use (&$names) {
            $names = collect($p->toArray()['props']['creators'])->pluck('name')->all();
        });

    return $names;
}

function usageFor(string $creator, float $cost): void
{
    AichUsageEvent::create([
        'generation_id' => (string) Str::ulid(), 'user_id' => null, 'creator_model' => $creator,
        'source' => 'live', 'call_type' => 'generator', 'model' => 'claude-sonnet-4-6',
        'input_tokens' => 100, 'cache_read_tokens' => 0, 'cache_create_tokens' => 0,
        'output_tokens' => 50, 'cost' => $cost, 'cached' => false, 'created_at' => now(),
    ]);
}

it('shows only the active provider creators in the shared creators list, never account-less models', function () {
    expect(sharedCreatorNames($this))->toBe(['Ofapi Creator']);

    app(ChatProvider::class)->set(ChatProvider::OOPCRM);

    expect(sharedCreatorNames($this))->toBe(['Oop Creator']);
});

it('shares the active provider so the shell can name it', function () {
    app(ChatProvider::class)->set(ChatProvider::OOPCRM);

    $this->actingAs($this->admin)->get('/dashboard')
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->where('chatProvider.key', 'oopcrm')
            ->where('chatProvider.label', 'OOP CRM'));
});

it('drops a selected creator that the switch just hid, falling back to all creators', function () {
    app(ChatProvider::class)->set(ChatProvider::OOPCRM);

    $this->actingAs($this->admin)
        ->withUnencryptedCookie('ss_creator', (string) $this->ofapi->id)
        ->get('/dashboard')
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->where('creatorContext.mode', 'all')
            ->where('creatorContext.selectedId', null));
});

it('limits "All creators" dashboard figures to the active provider', function () {
    usageFor('Ofapi Creator', 0.10);
    usageFor('Oop Creator', 0.30);
    app(ChatProvider::class)->set(ChatProvider::OOPCRM);

    $this->actingAs($this->admin)->get('/analytics/ai-usage?period=7d')
        ->assertInertia(fn (AssertableInertia $p) => $p
            ->where('usage.summary.totalCalls', 1));
});

it('refuses OnlyFans calls for a creator on the other provider, without calling out', function () {
    Http::fake();
    app(ChatProvider::class)->set(ChatProvider::OOPCRM);

    $this->actingAs($this->admin)->getJson("/onlyfans/{$this->ofapi->id}/chats")
        ->assertStatus(409)
        ->assertJsonPath('message', 'Ofapi Creator is connected through OnlyFansAPI, but chats run through OOP CRM right now. An admin can switch providers in Settings → Integrations.');

    Http::assertNothingSent();
});

it('stamps the active provider on an account id set without one, and clears it with the id', function () {
    app(ChatProvider::class)->set(ChatProvider::OOPCRM);

    $this->bare->update(['of_account_id' => 'acct_new']);
    expect($this->bare->fresh()->provider)->toBe('oopcrm');

    $this->bare->update(['of_account_id' => null]);
    expect($this->bare->fresh()->provider)->toBeNull();

    // An explicit provider wins over the hook.
    $this->bare->update(['of_account_id' => 'acct_x', 'provider' => 'onlyfansapi']);
    expect($this->bare->fresh()->provider)->toBe('onlyfansapi');
});

it('corrects a model provider from the live account lists on the Creator Models page', function () {
    // Stored as OnlyFansAPI (the migration's assumption), but the id is really OopCRM's.
    $this->oop->update(['provider' => 'onlyfansapi']);

    Http::fake([
        'app.onlyfansapi.com/api/accounts*' => Http::response([['id' => 'acct_ofapi', 'onlyfans_username' => 'a']]),
        'app.oopcrm.com/api/v1/ofapi/accounts*' => Http::response([['id' => 'acct_oop', 'onlyfans_username' => 'b']]),
    ]);

    $this->actingAs($this->admin)->getJson('/of/accounts')->assertOk();

    expect($this->oop->fresh()->provider)->toBe('oopcrm')
        ->and($this->ofapi->fresh()->provider)->toBe('onlyfansapi');
});

it('records the provider of an account added from the OOP CRM list', function () {
    Http::fake(['app.oopcrm.com/api/v1/ofapi/accounts*' => Http::response([['id' => 'acct_added', 'onlyfans_username' => 'added']])]);

    $this->actingAs($this->admin)
        ->post('/models/from-account', ['of_account_id' => 'acct_added', 'provider' => 'oopcrm'])
        ->assertRedirect();

    expect(AichModel::query()->where('of_account_id', 'acct_added')->value('provider'))->toBe('oopcrm');
});
