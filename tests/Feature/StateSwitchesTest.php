<?php

use App\Models\AichChatState;
use App\Models\AichModel;
use App\Models\CustomerProfile;
use App\Models\Script;
use App\Models\ScriptStep;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

beforeEach(function () {
    config([
        'services.onlyfans.key' => 'test-key',
        'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api',
        'services.engine.url' => 'http://127.0.0.1:8787',
    ]);
    $this->creator = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
    $this->admin = User::factory()->admin()->create();
    $this->base = '/onlyfans/'.$this->creator->id.'/chats/101';
});

function stateFeatureOverrides(array $overrides): CustomerProfile
{
    return CustomerProfile::withoutGlobalScopes()->create([
        'creator_model' => 'Camila', 'of_fan_id' => '101', 'customer_username' => 'jake', 'customer_name' => 'Jake',
        'state_overrides' => $overrides,
    ]);
}

/** @param array<string, mixed> $engineOut */
function stateFeatureFake(array $engineOut = []): void
{
    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 560, 'text' => 'ok', 'isSubscribed' => true]]),
        '127.0.0.1:8787/*' => Http::response($engineOut + [
            'draft' => 'hi',
            'strategy' => ['phase' => 'objection', 'wall_detected' => 'objection', 'customer_language' => 'english'],
            'telemetry' => ['posture' => 'PRESSURE', 'customerTier' => 'new', 'promiseStatus' => 'verbally_committed', 'forkType' => null, 'wallDetected' => 'objection'],
            'usage' => [],
        ]),
    ]);
}

/** @param list<array<string, mixed>> $messages */
function stateFeatureGenerate(array $messages, array $extra = [])
{
    return test()->actingAs(test()->admin)->postJson(test()->base.'/generate', [
        'messages' => $messages, 'customer' => ['id' => '101', 'name' => 'Jake'],
    ] + $extra);
}

function stateFeatureFanMsg(string $id, int $minAgo, string $text = 'hey'): array
{
    return ['id' => $id, 'from' => 'fan', 'text' => $text, 'time' => now()->subMinutes($minAgo)->toIso8601String()];
}

function stateFeatureEngineBody(): ?array
{
    $rec = Http::recorded(fn ($r) => str_contains($r->url(), '8787'))->last();

    return $rec ? $rec[0]->data() : null;
}

it('PATCH sets and clears a switch, merging per key', function () {
    $this->actingAs($this->admin)->patchJson($this->base.'/profile', ['state_overrides' => ['posture' => 'frame_hold', 'phase' => 'warm_up']])
        ->assertOk()
        ->assertJsonPath('profile.state_overrides.posture', 'frame_hold')
        ->assertJsonPath('profile.state_overrides.phase', 'warm_up');

    $this->actingAs($this->admin)->patchJson($this->base.'/profile', ['state_overrides' => ['posture' => null]])
        ->assertOk()
        ->assertJsonPath('profile.state_overrides', ['phase' => 'warm_up']);

    $this->actingAs($this->admin)->patchJson($this->base.'/profile', ['state_overrides' => ['phase' => null]])->assertOk();
    expect(CustomerProfile::withoutGlobalScopes()->first()->state_overrides)->toBeNull();
});

it('returns the contract keys on GET profile, with empty overrides as an object', function () {
    $res = $this->actingAs($this->admin)->getJson($this->base.'/profile')->assertOk();
    expect($res->getContent())->toContain('"state_overrides":{}');
    $res->assertJsonPath('profile.counters', ['objection_redirects' => 0, 'sex_only_pulls' => 0])
        ->assertJsonPath('profile.is_bilingual', false)
        ->assertJsonPath('profile.price_ladder', [12, 21, 35, 49, 69, 100])
        ->assertJsonPath('profile.auto_read.phase', null)
        ->assertJsonPath('profile.auto_read.fan_type', null)
        ->assertJsonPath('profile.auto_read.fan_type_from_trust', false);
});

it('rejects language for a non-bilingual creator and accepts it for a bilingual one', function () {
    $this->actingAs($this->admin)->patchJson($this->base.'/profile', ['state_overrides' => ['language' => 'es']])->assertStatus(422);
    $this->creator->update(['is_bilingual' => true]);
    $this->actingAs($this->admin)->patchJson($this->base.'/profile', ['state_overrides' => ['language' => 'es']])
        ->assertOk()->assertJsonPath('profile.state_overrides.language', 'es')->assertJsonPath('profile.is_bilingual', true);
});

it('rejects bad switch values with a JSON 422', function () {
    $this->actingAs($this->admin)->patchJson($this->base.'/profile', ['state_overrides' => ['rls_beat' => 13]])->assertStatus(422);
    $this->actingAs($this->admin)->patchJson($this->base.'/profile', ['state_overrides' => ['posture' => 'angry']])->assertStatus(422);
    $this->actingAs($this->admin)->patchJson($this->base.'/profile', ['state_overrides' => ['bogus' => 'x']])->assertStatus(422);
});

it('sends no stateOverrides when every switch is Auto', function () {
    stateFeatureFake();
    stateFeatureGenerate([stateFeatureFanMsg('m1', 5)])->assertOk()->assertJsonPath('rlsBeat', null)
        ->assertJsonPath('counters', ['objectionRedirects' => 0, 'sexOnlyPulls' => 0]);
    expect(stateFeatureEngineBody())->not->toHaveKey('stateOverrides');
});

it('sends the legacy-shaped overrides for frame-hold', function () {
    stateFeatureOverrides(['posture' => 'frame_hold']);
    stateFeatureFake();
    stateFeatureGenerate([stateFeatureFanMsg('m1', 5)])->assertOk();
    expect(stateFeatureEngineBody()['stateOverrides'])->toBe(['posture' => 'PRESSURE', 'frameHold' => true]);
});

it('refuses a selling intent under support mode before any upstream call', function () {
    stateFeatureOverrides(['support' => true]);
    stateFeatureFake();
    stateFeatureGenerate([stateFeatureFanMsg('m1', 5)], ['intent' => 'cta'])
        ->assertStatus(422)->assertExactJson(['error' => 'Support mode is on — no selling.']);
    Http::assertNothingSent();
});

it('still allows a non-selling intent under support mode', function () {
    stateFeatureOverrides(['support' => true]);
    stateFeatureFake();
    stateFeatureGenerate([stateFeatureFanMsg('m1', 5)], ['intent' => 'chitchat'])->assertOk();
    expect(stateFeatureEngineBody()['stateOverrides'])->toBe(['support' => true]);
});

it('refuses a priced media send under support mode before the vendor call', function () {
    stateFeatureOverrides(['support' => true]);
    stateFeatureFake();
    $this->actingAs($this->admin)->postJson($this->base.'/messages', ['text' => 'open', 'mediaFiles' => ['v1'], 'price' => 20])
        ->assertStatus(422)->assertExactJson(['error' => 'Support mode is on — no selling.']);
    Http::assertNothingSent();
});

it('refuses a priced script step send under support mode even when the client is bypassed', function () {
    stateFeatureOverrides(['support' => true]);
    stateFeatureFake();
    $script = Script::withoutGlobalScopes()->create(['creator_model' => 'Camila', 'name' => 'Main', 'sort_order' => 0]);
    $step = ScriptStep::withoutGlobalScopes()->create([
        'script_id' => $script->id, 'creator_model' => 'Camila', 'title' => 'PPV 1', 'text' => 'open',
        'media' => [['id' => 'v1', 'type' => 'photo']], 'price' => 21, 'sort_order' => 0,
    ]);
    $this->actingAs($this->admin)->postJson($this->base.'/messages', ['text' => 'open', 'mediaFiles' => ['v1'], 'price' => 21, 'scriptStepId' => $step->id])
        ->assertStatus(422)->assertJsonPath('error', 'Support mode is on — no selling.');
    Http::assertNothingSent();
});

it('allows a free media send and plain text under support mode', function () {
    stateFeatureOverrides(['support' => true]);
    stateFeatureFake();
    $this->actingAs($this->admin)->postJson($this->base.'/messages', ['text' => 'a gift', 'mediaFiles' => ['v1'], 'price' => 0])->assertOk();
    $this->actingAs($this->admin)->postJson($this->base.'/messages', ['text' => 'hi'])->assertOk();
});

it('does not store a pinned promise as SSAI progress on commit', function () {
    AichChatState::withoutGlobalScopes()->create(['creator_model' => 'Camila', 'chat_id' => '101', 'promise_status' => 'not_started']);
    stateFeatureOverrides(['promise' => 'asked']);

    $this->actingAs($this->admin)->postJson($this->base.'/state', [
        'strategy' => ['phase' => 'promise_ritual'],
        'telemetry' => ['promiseStatus' => 'in_progress', 'storyFrameworkStep' => 2],
    ])->assertOk();

    $state = AichChatState::withoutGlobalScopes()->first();
    expect($state->promise_status)->toBe('not_started')->and($state->story_framework_step)->toBe(2);
});

it('writes promise progress when the switch is Auto', function () {
    $this->actingAs($this->admin)->postJson($this->base.'/state', [
        'strategy' => ['phase' => 'promise_ritual'],
        'telemetry' => ['promiseStatus' => 'in_progress'],
    ])->assertOk();
    expect(AichChatState::withoutGlobalScopes()->first()->promise_status)->toBe('in_progress');
});

it('counts an objection once per fan message and resets after an opened PPV', function () {
    stateFeatureFake();
    $thread = [stateFeatureFanMsg('m1', 30, 'too expensive')];

    $gen = stateFeatureGenerate($thread)->assertOk()->json();
    $commit = fn (array $g) => $this->actingAs($this->admin)->postJson($this->base.'/state', ['strategy' => $g['strategy'], 'telemetry' => $g['telemetry']])->assertOk();
    $commit($gen);
    $commit($gen); // a second accept against the same fan message
    expect(AichChatState::withoutGlobalScopes()->first()->objection_redirects)->toBe(1);

    $thread[] = stateFeatureFanMsg('m2', 20, 'still too much');
    $gen2 = stateFeatureGenerate($thread)->assertOk()->assertJsonPath('counters.objectionRedirects', 1)->json();
    $commit($gen2);
    expect(AichChatState::withoutGlobalScopes()->first()->objection_redirects)->toBe(2);

    $thread[] = ['id' => 'm3', 'from' => 'creator', 'text' => 'unlock', 'time' => now()->subMinutes(10)->toIso8601String(),
        'price' => 21, 'isFree' => false, 'isOpened' => true, 'isTip' => false];
    $thread[] = stateFeatureFanMsg('m4', 5, 'loved it');
    stateFeatureGenerate($thread)->assertOk()->assertJsonPath('counters.objectionRedirects', 0);
    expect(AichChatState::withoutGlobalScopes()->first()->objection_redirects)->toBe(0);
});

it('counts an objection from the Objection intent even without a wall', function () {
    stateFeatureFake(['strategy' => ['phase' => 'rapport', 'wall_detected' => 'none']]);
    $gen = stateFeatureGenerate([stateFeatureFanMsg('m1', 5)], ['intent' => 'objection', 'intentOption' => 'later'])->assertOk()->json();
    $this->actingAs($this->admin)->postJson($this->base.'/state', ['strategy' => $gen['strategy'], 'telemetry' => $gen['telemetry']])->assertOk();
    expect(AichChatState::withoutGlobalScopes()->first()->objection_redirects)->toBe(1);
});

it('counts a sex-only pull on the vending-machine fork', function () {
    stateFeatureFake(['strategy' => ['phase' => 'rapport', 'wall_detected' => 'none'], 'telemetry' => ['forkType' => 'vending_machine_attempt']]);
    $gen = stateFeatureGenerate([stateFeatureFanMsg('m1', 5, 'send nudes')])->assertOk()->json();
    $this->actingAs($this->admin)->postJson($this->base.'/state', ['strategy' => $gen['strategy'], 'telemetry' => $gen['telemetry']])->assertOk();
    $state = AichChatState::withoutGlobalScopes()->first();
    expect($state->sex_only_pulls)->toBe(1)->and($state->objection_redirects)->toBe(0);
});

it('advances the RLS beat once after a send and a newer fan reply', function () {
    stateFeatureOverrides(['rls_beat' => 3]);
    stateFeatureFake();

    $this->actingAs($this->admin)->postJson($this->base.'/messages', ['text' => 'beat three'])->assertOk();
    expect(CustomerProfile::withoutGlobalScopes()->first()->rls_beat_sent_at)->not->toBeNull();

    // A fan reply newer than the send.
    $this->travel(1)->minutes();
    $thread = [stateFeatureFanMsg('m1', 0, 'tell me more')];
    stateFeatureGenerate($thread)->assertOk()->assertJsonPath('rlsBeat', 4);
    expect(stateFeatureEngineBody()['stateOverrides'])->toBe(['rlsBeat' => 4]);

    $p = CustomerProfile::withoutGlobalScopes()->first();
    expect($p->state_overrides['rls_beat'])->toBe(4)->and($p->rls_beat_sent_at)->toBeNull();

    // The same reply must not advance it again.
    stateFeatureGenerate($thread)->assertOk()->assertJsonPath('rlsBeat', 4);
});

it('does not advance the RLS beat without a fan reply after the send', function () {
    stateFeatureOverrides(['rls_beat' => 12]);
    stateFeatureFake();
    $thread = [stateFeatureFanMsg('m1', 10)];
    $this->actingAs($this->admin)->postJson($this->base.'/messages', ['text' => 'beat twelve'])->assertOk();
    stateFeatureGenerate($thread)->assertOk()->assertJsonPath('rlsBeat', 12);
});

it('shows the last generate\'s posture and phase as the auto read', function () {
    stateFeatureFake();
    stateFeatureGenerate([stateFeatureFanMsg('m1', 5)])->assertOk();
    $this->actingAs($this->admin)->getJson($this->base.'/profile')->assertOk()
        ->assertJsonPath('profile.auto_read.posture', 'frame_hold')
        ->assertJsonPath('profile.auto_read.phase', 'sale')
        ->assertJsonPath('profile.auto_read.language', 'en')
        ->assertJsonPath('profile.auto_read.fan_type', 'new');
});

it('keeps SSAI\'s own posture read when a forced posture comes back from the engine', function () {
    // SSAI's own read first: PRESSURE.
    stateFeatureFake();
    stateFeatureGenerate([stateFeatureFanMsg('m1', 5)])->assertOk();

    // Forced Timewaster: the engine reports it back, but it is not SSAI's read.
    CustomerProfile::withoutGlobalScopes()->first()->update(['state_overrides' => ['posture' => 'timewaster', 'promise' => 'reinforced_2']]);
    stateFeatureFake(['telemetry' => ['posture' => 'TIMEWASTER', 'promiseStatus' => 'assumed', 'customerTier' => 'new']]);
    stateFeatureGenerate([stateFeatureFanMsg('m1', 5)])->assertOk();

    // Back to Auto: the card shows SSAI's read, not the forced value.
    $this->actingAs($this->admin)->patchJson($this->base.'/profile', ['state_overrides' => ['posture' => null, 'promise' => null]])
        ->assertOk()
        ->assertJsonPath('profile.auto_read.posture', 'frame_hold')
        ->assertJsonPath('profile.auto_read.promise', 'asked');
});

it('saves is_bilingual and the price ladder on the creator model', function () {
    $this->actingAs($this->admin)->put('/models/'.$this->creator->id, [
        'name' => 'Camila', 'is_bilingual' => true, 'price_ladder' => [10, 20, 30],
    ])->assertSessionHasNoErrors();
    $m = $this->creator->fresh();
    expect($m->is_bilingual)->toBeTrue()->and($m->price_ladder)->toBe([10, 20, 30]);

    $this->actingAs($this->admin)->put('/models/'.$this->creator->id, ['name' => 'Camila', 'price_ladder' => [0]])
        ->assertSessionHasErrors('price_ladder.0');
});

it('sends the timewaster flag alongside a Posture override so the engine can let the flag win', function () {
    $p = stateFeatureOverrides(['posture' => 'normal']);
    $p->update(['is_timewaster' => true]);
    stateFeatureFake();
    stateFeatureGenerate([stateFeatureFanMsg('m1', 5)])->assertOk();
    $body = stateFeatureEngineBody();
    expect($body['stateOverrides'])->toBe(['posture' => 'WARM_BUILD'])
        ->and($body['session']['_profile']['is_timewaster'])->toBeTrue();
});

it('clears the RLS sent-marker when the beat is set by hand', function () {
    $p = stateFeatureOverrides(['rls_beat' => 3]);
    $p->update(['rls_beat_sent_at' => now()]);
    $this->actingAs($this->admin)->patchJson($this->base.'/profile', ['state_overrides' => ['rls_beat' => 7]])
        ->assertOk()->assertJsonPath('profile.state_overrides.rls_beat', 7);
    expect($p->fresh()->rls_beat_sent_at)->toBeNull();
});

it('does not stamp the RLS marker on a send when no beat is set', function () {
    stateFeatureOverrides(['phase' => 'rapport']);
    stateFeatureFake();
    $this->actingAs($this->admin)->postJson($this->base.'/messages', ['text' => 'hi'])->assertOk();
    expect(CustomerProfile::withoutGlobalScopes()->first()->rls_beat_sent_at)->toBeNull();
});

it('stamps the counter signals into the generate telemetry', function () {
    stateFeatureOverrides(['lane' => 'sex_only']);
    stateFeatureFake();
    $fanAt = now()->subMinutes(5)->startOfSecond();
    $t = stateFeatureGenerate([['id' => 'm1', 'from' => 'fan', 'text' => 'send me nudes', 'time' => $fanAt->toIso8601String()]])
        ->assertOk()->json('telemetry');
    expect($t['lane'])->toBe('sex_only')
        ->and($t['fanSexual'])->toBeTrue()
        ->and(strtotime($t['fanMessageAt']))->toBe($fanAt->getTimestamp())
        ->and($t['openedPpvAt'])->toBeNull()
        ->and($t['intent'])->toBeNull();
});

it('counts a sex-only pull for a sexual message under the sex-only lane, not for the lane alone', function () {
    stateFeatureOverrides(['lane' => 'sex_only']);
    stateFeatureFake(['strategy' => ['phase' => 'rapport', 'wall_detected' => 'none']]);
    $commit = fn (array $g) => $this->actingAs($this->admin)->postJson($this->base.'/state', ['strategy' => $g['strategy'], 'telemetry' => $g['telemetry']])->assertOk();

    $commit(stateFeatureGenerate([stateFeatureFanMsg('m1', 10, 'how was work')])->json());
    expect(AichChatState::withoutGlobalScopes()->first()->sex_only_pulls)->toBe(0);

    $commit(stateFeatureGenerate([stateFeatureFanMsg('m1', 10, 'how was work'), stateFeatureFanMsg('m2', 5, 'show me your tits')])->json());
    expect(AichChatState::withoutGlobalScopes()->first()->sex_only_pulls)->toBe(1);
});
