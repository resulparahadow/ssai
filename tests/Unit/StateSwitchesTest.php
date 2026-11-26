<?php

use App\Models\CustomerProfile;
use App\Support\StateSwitches;
use Illuminate\Support\Facades\Validator;
use Tests\TestCase;

uses(TestCase::class);

function stateSwitchProfile(array $attrs = []): CustomerProfile
{
    return new CustomerProfile($attrs + ['trust_level' => 1, 'total_spend' => 0, 'tips_spend' => 0]);
}

function stateSwitchValid(array $overrides, bool $bilingual = false): bool
{
    return ! Validator::make(['state_overrides' => $overrides], StateSwitches::rules($bilingual))->fails();
}

it('maps every switch value to the legacy engine shape', function () {
    expect(StateSwitches::toEngine([]))->toBe([]);
    expect(StateSwitches::toEngine(['phase' => 'warm_up']))->toBe(['phase' => 'warm_up']);
    expect(StateSwitches::toEngine(['rls_beat' => 3]))->toBe(['rlsBeat' => 3]);
    expect(StateSwitches::toEngine(['fan_type' => 'new']))->toBe(['fanTier' => 'new']);
    expect(StateSwitches::toEngine(['fan_type' => 'returning']))->toBe(['fanTier' => 'old']);
    expect(StateSwitches::toEngine(['fan_type' => 'spender']))->toBe(['fanTier' => 'old', 'spender' => true]);
    expect(StateSwitches::toEngine(['lane' => 'sex_only']))->toBe(['lane' => 'sex_only']);
    expect(StateSwitches::toEngine(['lane' => 'rude']))->toBe(['lane' => 'rude']);
    expect(StateSwitches::toEngine(['posture' => 'normal']))->toBe(['posture' => 'WARM_BUILD']);
    expect(StateSwitches::toEngine(['posture' => 'frame_hold']))->toBe(['posture' => 'PRESSURE', 'frameHold' => true]);
    expect(StateSwitches::toEngine(['posture' => 'timewaster']))->toBe(['posture' => 'TIMEWASTER']);
    expect(StateSwitches::toEngine(['promise' => 'not_asked']))->toBe(['promiseStatus' => 'not_started']);
    expect(StateSwitches::toEngine(['promise' => 'asked']))->toBe(['promiseStatus' => 'in_progress']);
    expect(StateSwitches::toEngine(['promise' => 'reinforced_1']))->toBe(['promiseStatus' => 'reinforcement']);
    expect(StateSwitches::toEngine(['promise' => 'reinforced_2']))->toBe(['promiseStatus' => 'assumed']);
    expect(StateSwitches::toEngine(['language' => 'es']))->toBe(['language' => 'es']);
    expect(StateSwitches::toEngine(['support' => true]))->toBe(['support' => true]);
});

it('merges per key and removes a key on null, normal lane or support off', function () {
    $cur = ['phase' => 'sale', 'lane' => 'rude', 'support' => true];
    expect(StateSwitches::merge($cur, ['phase' => null]))->toBe(['lane' => 'rude', 'support' => true]);
    expect(StateSwitches::merge($cur, ['lane' => 'normal', 'support' => false]))->toBe(['phase' => 'sale']);
    expect(StateSwitches::merge($cur, ['posture' => 'frame_hold', 'rls_beat' => '4']))
        ->toBe(['phase' => 'sale', 'rls_beat' => 4, 'lane' => 'rude', 'posture' => 'frame_hold', 'support' => true]);
    expect(StateSwitches::merge([], ['phase' => null]))->toBe([]);
});

it('validates values and allows language only for a bilingual creator', function () {
    expect(stateSwitchValid(['phase' => 'warm_up', 'rls_beat' => 12, 'posture' => 'frame_hold', 'support' => true]))->toBeTrue();
    expect(stateSwitchValid(['phase' => 'flirt']))->toBeFalse();
    expect(stateSwitchValid(['rls_beat' => 13]))->toBeFalse();
    expect(stateSwitchValid(['rls_beat' => 0]))->toBeFalse();
    expect(stateSwitchValid(['fan_type' => 'whale']))->toBeFalse();
    expect(stateSwitchValid(['promise' => 'done']))->toBeFalse();
    expect(stateSwitchValid(['unknown' => 'x']))->toBeFalse();
    expect(stateSwitchValid(['language' => 'es']))->toBeFalse();
    expect(stateSwitchValid(['language' => 'es'], true))->toBeTrue();
    expect(stateSwitchValid(['language' => 'fr'], true))->toBeFalse();
    expect(stateSwitchValid(['language' => null]))->toBeTrue();
    expect(stateSwitchValid(['phase' => null, 'lane' => 'normal', 'support' => false]))->toBeTrue();
});

it('reads legacy phases into the switch names', function () {
    $map = [
        'chit_chat' => 'rapport', 'rapport' => 'rapport', 'warm_welcome' => 'rapport', 'yes_flow' => 'rapport',
        'cta1' => 'link', 'promise_ritual' => 'link',
        'sell' => 'sale', 'cta2' => 'sale', 'send_content' => 'sale', 'objection' => 'sale',
        'warmup_between_rungs' => 'loop', 'aftercare' => 'aftersale', 'close' => 'aftersale',
        'mystery' => null,
    ];
    foreach ($map as $legacy => $want) {
        expect(StateSwitches::autoRead(['phase' => $legacy], null, stateSwitchProfile())['phase'])->toBe($want);
    }
    expect(StateSwitches::autoRead(null, null, null)['phase'])->toBeNull();
});

it('reads legacy posture and promise into the switch names', function () {
    foreach (['WARM_BUILD' => 'normal', 'PROBE' => 'normal', 'PRESSURE' => 'frame_hold', 'TIMEWASTER' => 'timewaster', 'FLAGGED_TW' => 'timewaster', 'X' => null] as $legacy => $want) {
        expect(StateSwitches::autoRead(null, ['posture' => $legacy], null)['posture'])->toBe($want);
    }
    foreach (['not_started' => 'not_asked', 'in_progress' => 'asked', 'verbally_committed' => 'asked', 'complete' => 'reinforced_1', 'reinforcement' => 'reinforced_1', 'assumed' => 'reinforced_2'] as $legacy => $want) {
        expect(StateSwitches::autoRead(null, ['promiseStatus' => $legacy], null)['promise'])->toBe($want);
    }
    expect(StateSwitches::autoRead(['customer_language' => 'spanish'], null, null)['language'])->toBe('es');
    expect(StateSwitches::autoRead(['customer_language' => 'english'], null, null)['language'])->toBe('en');
});

it('reads the fan type from the tier rule, flagging a trust-only returning fan', function () {
    $new = StateSwitches::autoRead(null, null, stateSwitchProfile());
    expect($new['fan_type'])->toBe('new')->and($new['fan_type_from_trust'])->toBeFalse();

    $spender = StateSwitches::autoRead(null, null, stateSwitchProfile(['total_spend' => 20]));
    expect($spender['fan_type'])->toBe('spender')->and($spender['fan_type_from_trust'])->toBeFalse();

    $tipper = StateSwitches::autoRead(null, null, stateSwitchProfile(['tips_spend' => 5]));
    expect($tipper['fan_type'])->toBe('spender');

    $trust = StateSwitches::autoRead(null, null, stateSwitchProfile(['trust_level' => 3]));
    expect($trust['fan_type'])->toBe('returning')->and($trust['fan_type_from_trust'])->toBeTrue();

    expect(StateSwitches::autoRead(null, null, null)['fan_type'])->toBeNull();
});

it('lists the selling intents', function () {
    expect(StateSwitches::SELLING_INTENTS)->toBe(['ppv', 'repitch', 'reoffer_mppv', 'cta', 'tip_ask', 'promise', 'free_picture']);
});
