<?php

use App\Models\AichModel;
use App\Models\CustomerProfile;
use App\Models\ModelAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['services.onlyfans.key' => 'test-key', 'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api']);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
});

/** Fake OF getUser (spend) + the engine generate, with an overridable strategy. */
function fakeGenerate(array $strategy = [], array $fanData = []): void
{
    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => array_merge([
            'id' => 101, 'isSubscribed' => true,
            'subscribedByData' => ['totalSumm' => 120.5, 'tipsSumm' => 30],
        ], $fanData)]),
        '127.0.0.1:8787/*' => Http::response([
            'draft' => 'aw that means a lot babe',
            'strategy' => array_merge(['archetype' => 'Explorer', 'trust_level' => 3, 'temperature' => 'warm', 'key_details' => 'likes cars'], $strategy),
            'telemetry' => null,
            'usage' => [],
        ]),
    ]);
}

function runGenerate(User $user, AichModel $model, string $chat = '101'): TestResponse
{
    return test()->actingAs($user)->postJson("/onlyfans/{$model->id}/chats/{$chat}/generate", [
        'messages' => [['from' => 'fan', 'text' => 'my day was long but better talking to you', 'time' => now()->toIso8601String()]],
        'customer' => ['id' => $chat, 'name' => 'Jake', 'username' => 'jake_w'],
    ]);
}

it('auto-creates a fan profile keyed by (creator_model, of_fan_id) and refreshes spend from OnlyFans', function () {
    fakeGenerate();

    runGenerate(User::factory()->admin()->create(), $this->model)->assertOk();

    $p = CustomerProfile::withoutGlobalScopes()->where('creator_model', 'Camila')->where('of_fan_id', '101')->first();
    expect($p)->not->toBeNull();
    expect((float) $p->total_spend)->toBe(120.5);
    expect((float) $p->tips_spend)->toBe(30.0);
    expect($p->subscription_status)->toBe('subscribed');
});

it('writes back the analysis into unlocked memory fields on generate', function () {
    fakeGenerate();

    runGenerate(User::factory()->admin()->create(), $this->model)->assertOk();

    $p = CustomerProfile::withoutGlobalScopes()->first();
    expect($p->archetype)->toBe('Explorer');
    expect($p->trust_level)->toBe(3);
    expect($p->temperature)->toBe('warm');
    expect($p->key_details)->toBe('likes cars');
});

it('feeds lifetime spend via _profile and keeps session spend at $0', function () {
    fakeGenerate();

    // Seed prior memory so the engine sees a returning customer, not a $0 lurker.
    CustomerProfile::withoutGlobalScopes()->create([
        'creator_model' => 'Camila', 'of_fan_id' => '101', 'customer_username' => 'jake_w',
        'archetype' => 'Whale', 'trust_level' => 4, 'temperature' => 'hot', 'locked_fields' => ['archetype'],
    ]);

    runGenerate(User::factory()->admin()->create(), $this->model)->assertOk();

    Http::assertSent(function ($r) {
        if (! str_contains($r->url(), '127.0.0.1:8787')) {
            return false;
        }
        $s = $r['session'];

        // Lifetime (OnlyFans totals) rides on _profile; session spend stays $0 (no per-message
        // PPV mapping yet) so the ACTIVE-BUYER / session-spender guards don't misfire.
        return $s['_profile']['archetype'] === 'Whale'
            && (float) $s['_profile']['total_spend'] === 120.5
            && (float) $s['_profile']['tips_spend'] === 30.0
            && $s['total_spend'] === '$0'
            && $s['tips_spend'] === '$0';
    });
});

it('does not clobber a human-pinned field but still updates unlocked ones', function () {
    $admin = User::factory()->admin()->create();

    // Human pins archetype = Whale.
    test()->actingAs($admin)
        ->patchJson("/onlyfans/{$this->model->id}/chats/101/profile", ['archetype' => 'Whale'])
        ->assertOk()
        ->assertJsonPath('profile.archetype', 'Whale')
        ->assertJsonPath('profile.locked_fields', ['archetype']);

    // The AI analysis wants archetype=Explorer, temperature=warm.
    fakeGenerate();
    runGenerate($admin, $this->model)->assertOk();

    $p = CustomerProfile::withoutGlobalScopes()->first();
    expect($p->archetype)->toBe('Whale');   // pinned — untouched
    expect($p->temperature)->toBe('warm');   // unlocked — updated by analysis
});

it('unlocks a field so the AI manages it again', function () {
    $admin = User::factory()->admin()->create();

    test()->actingAs($admin)->patchJson("/onlyfans/{$this->model->id}/chats/101/profile", ['archetype' => 'Whale'])->assertOk();
    test()->actingAs($admin)
        ->patchJson("/onlyfans/{$this->model->id}/chats/101/profile", ['unlock' => ['archetype']])
        ->assertOk()
        ->assertJsonPath('profile.archetype', null)
        ->assertJsonPath('profile.locked_fields', []);

    fakeGenerate();
    runGenerate($admin, $this->model)->assertOk();

    expect(CustomerProfile::withoutGlobalScopes()->first()->archetype)->toBe('Explorer');
});

it('serves the panel shape via GET and defaults for an unknown fan', function () {
    test()->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/chats/999/profile")
        ->assertOk()
        ->assertJsonPath('profile.sexting_mode', 'AUTO')
        ->assertJsonPath('profile.tip_mode', 'AUTO')
        ->assertJsonPath('profile.trust_level', 0)
        ->assertJsonPath('profile.locked_fields', []);
});

// The note is no longer written here: OnlyFans owns it, and `crm_notes` is only the local
// mirror written by the notes endpoints (see OnlyFansChatTest).
it('saves behavior toggles', function () {
    test()->actingAs(User::factory()->admin()->create())
        ->patchJson("/onlyfans/{$this->model->id}/chats/101/profile", [
            'sexting_mode' => 'FORCE_ON', 'tip_mode' => 'FORCE_OFF', 'is_timewaster' => true,
        ])
        ->assertOk()
        ->assertJsonPath('profile.sexting_mode', 'FORCE_ON')
        ->assertJsonPath('profile.tip_mode', 'FORCE_OFF')
        ->assertJsonPath('profile.is_timewaster', true);
});

it('rejects an invalid toggle value with a JSON 422', function () {
    test()->actingAs(User::factory()->admin()->create())
        ->patchJson("/onlyfans/{$this->model->id}/chats/101/profile", ['sexting_mode' => 'MAYBE'])
        ->assertStatus(422);
});

it('scopes memory access: an unassigned chatter is forbidden, assigned is allowed', function () {
    $chatter = User::factory()->chatter()->create();

    test()->actingAs($chatter)->getJson("/onlyfans/{$this->model->id}/chats/101/profile")->assertForbidden();
    test()->actingAs($chatter)->patchJson("/onlyfans/{$this->model->id}/chats/101/profile", ['crm_notes' => 'x'])->assertForbidden();

    ModelAssignment::create(['user_id' => $chatter->id, 'creator_model' => 'Camila']);
    test()->actingAs($chatter)->getJson("/onlyfans/{$this->model->id}/chats/101/profile")->assertOk();
});
