<?php

use App\Services\OnlyFans\OnlyFansService;

/**
 * Unit tests for OnlyFansService::extractFanSubscription() — the pure mapper from a
 * getUser `data` payload to the fan panel's subscription indicators.
 *
 * Passing both constructor args keeps this app-free (the ctor only reads config()
 * when an arg is null), so these run as plain PHPUnit without booting Laravel.
 */
function ofService(): OnlyFansService
{
    return new OnlyFansService('test-key', 'https://app.onlyfansapi.com/api');
}

/** @return array<string, mixed> */
function listsStates(string $id, bool $hasUser): array
{
    return ['listsStates' => [
        ['id' => 'following', 'type' => 'following', 'name' => 'Following', 'hasUser' => true],
        ['id' => $id, 'type' => $id, 'name' => 'Renew', 'hasUser' => $hasUser],
    ]];
}

// ---- rebillOn -------------------------------------------------------------

it('reads rebill on from the rebill_on list state', function () {
    $sub = ofService()->extractFanSubscription(listsStates('rebill_on', true));

    expect($sub['rebillOn'])->toBeTrue();
});

it('reads rebill off from the rebill_off list state', function () {
    $sub = ofService()->extractFanSubscription(listsStates('rebill_off', true));

    expect($sub['rebillOn'])->toBeFalse();
});

it('reports rebill as unknown (null) when listsStates is absent', function () {
    $sub = ofService()->extractFanSubscription(['id' => 101]);

    expect($sub['rebillOn'])->toBeNull();
});

it('reports rebill as unknown when the fan is in neither rebill list', function () {
    $sub = ofService()->extractFanSubscription(listsStates('rebill_on', false));

    expect($sub['rebillOn'])->toBeNull();
});

// ---- subscribed -----------------------------------------------------------

it('treats subscribedOnExpiredNow as authoritative even when subscribedOn is null', function () {
    // The shape Mass-List returns: subscribedOn null, but expiredNow meaningful.
    $sub = ofService()->extractFanSubscription([
        'subscribedOn' => null,
        'subscribedOnExpiredNow' => true,
    ]);

    expect($sub['subscribed'])->toBeFalse();
});

it('reports an active subscription when subscribedOnExpiredNow is false', function () {
    $sub = ofService()->extractFanSubscription(['subscribedOnExpiredNow' => false]);

    expect($sub['subscribed'])->toBeTrue();
});

it('falls back to the subscribedOn boolean when expiredNow is absent', function () {
    $sub = ofService()->extractFanSubscription(['subscribedOn' => true]);

    expect($sub['subscribed'])->toBeTrue();
});

it('falls back to a future expiredAt when no boolean flag is present', function () {
    $sub = ofService()->extractFanSubscription([
        'subscribedOnData' => ['expiredAt' => now()->addDays(10)->toIso8601String()],
    ]);

    expect($sub['subscribed'])->toBeTrue();
});

it('reports not-subscribed when expiredAt is in the past', function () {
    $sub = ofService()->extractFanSubscription([
        'subscribedOnData' => ['expiredAt' => now()->subDays(3)->toIso8601String()],
    ]);

    expect($sub['subscribed'])->toBeFalse();
});

// ---- durationLabel --------------------------------------------------------

it('uses the human-readable subscribedOnDuration verbatim', function () {
    $sub = ofService()->extractFanSubscription(['subscribedOnDuration' => '1 month']);

    expect($sub['durationLabel'])->toBe('1 month');
});

it('falls back to subscribedOnData.duration when the top-level label is absent', function () {
    $sub = ofService()->extractFanSubscription([
        'subscribedOnData' => ['duration' => '3 months'],
    ]);

    expect($sub['durationLabel'])->toBe('3 months');
});

it('treats an empty-string duration as absent, not as a value', function () {
    $sub = ofService()->extractFanSubscription([
        'subscribedOnDuration' => '',
        'subscribedOnData' => ['duration' => ''],
    ]);

    expect($sub['durationLabel'])->toBeNull();
});

// ---- dates ----------------------------------------------------------------

it('passes subscribe/expiry dates through as raw ISO for the client to format', function () {
    $sub = ofService()->extractFanSubscription([
        'subscribedOnData' => [
            'subscribeAt' => '2026-06-14T10:00:00+00:00',
            'expiredAt' => '2026-07-14T10:00:00+00:00',
        ],
    ]);

    expect($sub['subscribedAt'])->toBe('2026-06-14T10:00:00+00:00')
        ->and($sub['expiredAt'])->toBe('2026-07-14T10:00:00+00:00');
});

// ---- defensive contract ---------------------------------------------------

it('returns all-null rather than crashing on an empty payload', function () {
    $sub = ofService()->extractFanSubscription([]);

    expect($sub)->toBe([
        'subscribed' => null,
        'durationLabel' => null,
        'subscribedAt' => null,
        'expiredAt' => null,
        'rebillOn' => null,
    ]);
});

it('survives subscribedOnData arriving as a non-array', function () {
    // The docs show `subscribedOnData: {}` and other endpoints send scalars/null.
    $sub = ofService()->extractFanSubscription(['subscribedOnData' => false]);

    expect($sub['durationLabel'])->toBeNull()
        ->and($sub['subscribedAt'])->toBeNull();
});

it('ignores an unparseable expiredAt instead of reporting a bogus status', function () {
    $sub = ofService()->extractFanSubscription([
        'subscribedOnData' => ['expiredAt' => 'not-a-date'],
    ]);

    expect($sub['subscribed'])->toBeNull();
});
