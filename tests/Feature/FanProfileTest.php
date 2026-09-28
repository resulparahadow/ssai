<?php

use App\Models\AichModel;
use App\Models\CustomerProfile;
use App\Models\ModelAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Http;
use Illuminate\Testing\TestResponse;

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['services.onlyfans.key' => 'test-key', 'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api']);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
});

/** What the engine answers a generate with; `$strategy` overrides the analysis fields. */
function engineReply(array $strategy = []): array
{
    return [
        'draft' => 'aw that means a lot babe',
        'strategy' => array_merge(['archetype' => 'Explorer', 'trust_level' => 3, 'temperature' => 'warm', 'key_details' => 'likes cars'], $strategy),
        'telemetry' => null,
        'usage' => [],
    ];
}

/** Fake OF getUser (spend) + the engine generate, with an overridable strategy. */
function fakeGenerate(array $strategy = [], array $fanData = []): void
{
    fakeGenerates([$strategy], $fanData);
}

/** Like fakeGenerate, but each generate gets the next strategy in turn. */
function fakeGenerates(array $strategies, array $fanData = []): void
{
    $engine = Http::sequence();
    foreach ($strategies as $strategy) {
        $engine->push(engineReply($strategy));
    }

    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => array_merge([
            'id' => 101, 'isSubscribed' => true,
            'subscribedByData' => ['totalSumm' => 120.5, 'tipsSumm' => 30],
        ], $fanData)]),
        '127.0.0.1:8787/*' => $engine,
    ]);
}

/** @param  list<array{from:string,text:string,time:string}>|null  $messages  default: one fan line sent now */
function runGenerate(User $user, AichModel $model, string $chat = '101', ?array $messages = null): TestResponse
{
    return test()->actingAs($user)->postJson("/onlyfans/{$model->id}/chats/{$chat}/generate", [
        'messages' => $messages ?? [['from' => 'fan', 'text' => 'my day was long but better talking to you', 'time' => now()->toIso8601String()]],
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
    $this->travelTo(Carbon::parse('2026-09-28 15:00', 'UTC'));
    fakeGenerate();

    runGenerate(User::factory()->admin()->create(), $this->model)->assertOk();

    $p = CustomerProfile::withoutGlobalScopes()->first();
    expect($p->archetype)->toBe('Explorer');
    expect($p->trust_level)->toBe(3);
    expect($p->temperature)->toBe('warm');
    expect($p->key_details)->toBe('[Sep 28, 2026] likes cars');
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

// ---- Engine inputs --------------------------------------------------------

it('forwards the timewaster flag to the engine so the posture tier can flip', function () {
    fakeGenerate();

    CustomerProfile::withoutGlobalScopes()->create([
        'creator_model' => 'Camila', 'of_fan_id' => '101', 'customer_username' => 'jake_w',
        'is_timewaster' => true,
    ]);

    runGenerate(User::factory()->admin()->create(), $this->model)->assertOk();

    // Legacy `computeCustomerTier` short-circuits to 'flagged_tw' on a strict `=== true`,
    // so the flag has to arrive as a real boolean, not 1/"1".
    Http::assertSent(fn ($r) => str_contains($r->url(), '127.0.0.1:8787')
        && $r['session']['_profile']['is_timewaster'] === true);
});

it('sends the timewaster flag as false when the fan is not flagged', function () {
    fakeGenerate();

    runGenerate(User::factory()->admin()->create(), $this->model)->assertOk();

    Http::assertSent(fn ($r) => str_contains($r->url(), '127.0.0.1:8787')
        && $r['session']['_profile']['is_timewaster'] === false);
});

it('forwards the fan name and username to the engine', function () {
    fakeGenerate();

    runGenerate(User::factory()->admin()->create(), $this->model)->assertOk();

    // The legacy prompt prints "Customer: {name} (@{username})" and tells the model
    // "You already know his name ({name})" — a fallback of 'Fan' is read as his actual name.
    Http::assertSent(fn ($r) => str_contains($r->url(), '127.0.0.1:8787')
        && $r['session']['customer_name'] === 'Jake' && $r['session']['customer_username'] === 'jake_w');
});

// ---- Memory log: dated entries, one per conversation ------------------------

function memoryLog(): ?string
{
    return CustomerProfile::withoutGlobalScopes()->first()?->key_details;
}

it('rewrites the current memory entry while the chat continues', function () {
    $admin = User::factory()->admin()->create();
    fakeGenerates([['key_details' => 'likes cars'], ['key_details' => 'likes cars, has a dog']]);

    $this->travelTo(Carbon::parse('2026-09-28 15:00', 'UTC'));
    runGenerate($admin, $this->model)->assertOk();
    $this->travel(1)->hours();
    runGenerate($admin, $this->model)->assertOk();

    expect(memoryLog())->toBe('[Sep 28, 2026] likes cars, has a dog');
});

it('starts a new dated memory entry after the chat went quiet for longer than the session gap', function () {
    $admin = User::factory()->admin()->create();
    fakeGenerates([['key_details' => 'likes cars'], ['key_details' => 'likes cars, has a dog']]);

    $this->travelTo(Carbon::parse('2026-09-28 15:00', 'UTC'));
    runGenerate($admin, $this->model)->assertOk();
    $this->travelTo(Carbon::parse('2026-09-29 16:00', 'UTC'));
    runGenerate($admin, $this->model)->assertOk();

    expect(memoryLog())->toBe("[Sep 28, 2026] likes cars\n\n[Sep 29, 2026] likes cars, has a dog");
});

it('keeps one memory entry while the fan kept chatting, even with no generate for over 12h', function () {
    $admin = User::factory()->admin()->create();
    fakeGenerates([['key_details' => 'likes cars'], ['key_details' => 'likes cars, has a dog']]);

    $this->travelTo(Carbon::parse('2026-09-28 08:00', 'UTC'));
    runGenerate($admin, $this->model)->assertOk();

    // 14h since the last generate, but no 12h silence in the chat itself.
    $this->travelTo(Carbon::parse('2026-09-28 22:00', 'UTC'));
    runGenerate($admin, $this->model, '101', array_map(fn (string $at) => [
        'from' => 'fan', 'text' => 'still here', 'time' => Carbon::parse("2026-09-28 {$at}", 'UTC')->toIso8601String(),
    ], ['12:00', '16:00', '20:00', '22:00']))->assertOk();

    expect(memoryLog())->toBe('[Sep 28, 2026] likes cars, has a dog');
});

it('dates memory entries in the creator timezone', function () {
    $this->model->update(['timezone' => 'America/New_York']);
    fakeGenerate(['key_details' => 'likes cars']);

    // 02:00 UTC on the 28th is still the evening of the 27th in New York.
    $this->travelTo(Carbon::parse('2026-09-28 02:00', 'UTC'));
    runGenerate(User::factory()->admin()->create(), $this->model)->assertOk();

    expect(memoryLog())->toBe('[Sep 27, 2026] likes cars');
});

it('keeps the memory log when a chatter hands it back to the AI, which then adds below it', function () {
    $admin = User::factory()->admin()->create();
    $this->travelTo(Carbon::parse('2026-09-28 15:00', 'UTC'));

    test()->actingAs($admin)->patchJson("/onlyfans/{$this->model->id}/chats/101/profile", ['key_details' => 'works nights'])->assertOk();
    test()->actingAs($admin)
        ->patchJson("/onlyfans/{$this->model->id}/chats/101/profile", ['unlock' => ['key_details']])
        ->assertOk()
        ->assertJsonPath('profile.key_details', 'works nights')
        ->assertJsonPath('profile.locked_fields', []);

    fakeGenerate(['key_details' => 'likes cars']);
    runGenerate($admin, $this->model)->assertOk();

    expect(memoryLog())->toBe("works nights\n\n[Sep 28, 2026] likes cars");
});

it('does not overwrite a chatter correction to the current memory entry', function () {
    $admin = User::factory()->admin()->create();
    fakeGenerates([['key_details' => 'likes cars'], ['key_details' => 'likes cars']]);

    $this->travelTo(Carbon::parse('2026-09-28 15:00', 'UTC'));
    runGenerate($admin, $this->model)->assertOk();

    $fixed = '[Sep 28, 2026] likes trucks, not cars';
    test()->actingAs($admin)->patchJson("/onlyfans/{$this->model->id}/chats/101/profile", ['key_details' => $fixed])->assertOk();
    test()->actingAs($admin)->patchJson("/onlyfans/{$this->model->id}/chats/101/profile", ['unlock' => ['key_details']])->assertOk();

    // Same conversation, but the entry is the chatter's now: the AI adds its own below it.
    $this->travel(1)->hours();
    runGenerate($admin, $this->model)->assertOk();

    expect(memoryLog())->toBe("{$fixed}\n\n[Sep 28, 2026] likes cars");
});

it('shows the AI only the newest memory entries', function () {
    CustomerProfile::withoutGlobalScopes()->create([
        'creator_model' => 'Camila', 'of_fan_id' => '101', 'customer_username' => 'jake_w',
        'key_details' => '[Jan 1, 2026] '.str_repeat('a', 3000)."\n\n[Sep 27, 2026] works nights",
    ]);
    fakeGenerate();

    runGenerate(User::factory()->admin()->create(), $this->model)->assertOk();

    Http::assertSent(fn ($r) => str_contains($r->url(), '127.0.0.1:8787')
        && $r['session']['_profile']['key_details'] === '[Sep 27, 2026] works nights');
});

it('accepts a manual edit of a memory log longer than 5000 characters', function () {
    test()->actingAs(User::factory()->admin()->create())
        ->patchJson("/onlyfans/{$this->model->id}/chats/101/profile", ['key_details' => str_repeat('a', 6000)])
        ->assertOk();

    expect(mb_strlen(memoryLog()))->toBe(6000);
});

it('ignores a memory summary that is not text', function () {
    fakeGenerate(['key_details' => ['likes cars']]);

    runGenerate(User::factory()->admin()->create(), $this->model)->assertOk();

    expect(memoryLog())->toBeNull();
});

it('leaves a pinned memory log untouched on generate', function () {
    $admin = User::factory()->admin()->create();
    test()->actingAs($admin)->patchJson("/onlyfans/{$this->model->id}/chats/101/profile", ['key_details' => 'works nights'])->assertOk();

    fakeGenerate(['key_details' => 'likes cars']);
    runGenerate($admin, $this->model)->assertOk();

    expect(memoryLog())->toBe('works nights');
});
