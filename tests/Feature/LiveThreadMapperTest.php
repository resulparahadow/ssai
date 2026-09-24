<?php

use App\Services\OnlyFans\LiveThreadMapper;

function mapThread(array $messages, int $gapHours = 12): array
{
    return app(LiveThreadMapper::class)->map($messages, $gapHours);
}

it('maps an opened creator PPV in the window to a ppv bubble and session spend', function () {
    $now = now();
    $out = mapThread([
        ['from' => 'fan', 'text' => 'hey', 'time' => $now->copy()->subMinutes(10)->toIso8601String()],
        ['from' => 'creator', 'text' => 'unlock me', 'time' => $now->copy()->subMinutes(5)->toIso8601String(),
            'price' => 20, 'isFree' => false, 'isOpened' => true, 'isTip' => false],
    ]);

    $ppv = collect($out['messages'])->firstWhere('sender', 'ppv');
    expect($ppv)->not->toBeNull();
    expect($ppv['opened'])->toBeTrue();
    expect($ppv['price'])->toBe(20.0);
    expect($out['total_spend'])->toBe(20.0);
    expect($out['tips_spend'])->toBe(0.0);
});

it('marks an unopened PPV as a ppv bubble but excludes it from session spend', function () {
    $now = now();
    $out = mapThread([
        ['from' => 'creator', 'text' => 'locked', 'time' => $now->copy()->subMinutes(1)->toIso8601String(),
            'price' => 30, 'isFree' => false, 'isOpened' => false, 'isTip' => false],
    ]);

    $ppv = collect($out['messages'])->firstWhere('sender', 'ppv');
    expect($ppv)->not->toBeNull();
    expect($ppv['opened'])->toBeFalse();
    expect($out['total_spend'])->toBe(0.0);
});

it('sums a tip into tips_spend and keeps it a customer bubble (not ppv)', function () {
    $now = now();
    $out = mapThread([
        ['from' => 'fan', 'text' => 'here you go', 'time' => $now->copy()->subMinutes(2)->toIso8601String(),
            'price' => 15, 'isTip' => true, 'isFree' => false, 'isOpened' => true],
    ]);

    expect($out['tips_spend'])->toBe(15.0);
    expect($out['total_spend'])->toBe(0.0);
    expect($out['messages'][0]['sender'])->toBe('customer');
});

it('prefers a dedicated tipAmount over price for a tip', function () {
    $now = now();
    $out = mapThread([
        ['from' => 'fan', 'text' => 'tip', 'time' => $now->copy()->subMinutes(2)->toIso8601String(),
            'price' => 0, 'tipAmount' => 12, 'isTip' => true, 'isFree' => false],
    ]);

    expect($out['tips_spend'])->toBe(12.0);
});

it('excludes a payment before the last long gap from the session (not a ppv bubble, no spend)', function () {
    $now = now();
    $out = mapThread([
        ['from' => 'creator', 'text' => 'old ppv', 'time' => $now->copy()->subDays(2)->toIso8601String(),
            'price' => 50, 'isFree' => false, 'isOpened' => true, 'isTip' => false],
        // >12h gap, then the current session
        ['from' => 'fan', 'text' => 'im back', 'time' => $now->copy()->subMinutes(3)->toIso8601String()],
    ], 12);

    expect($out['total_spend'])->toBe(0.0);
    expect(collect($out['messages'])->pluck('sender')->all())->not->toContain('ppv');
});

it('maps fan/creator direction to customer/model', function () {
    $now = now();
    $out = mapThread([
        ['from' => 'fan', 'text' => 'hi', 'time' => $now->copy()->subMinutes(2)->toIso8601String()],
        ['from' => 'creator', 'text' => 'hey babe', 'time' => $now->copy()->subMinutes(1)->toIso8601String()],
    ]);

    expect($out['messages'][0]['sender'])->toBe('customer');
    expect($out['messages'][1]['sender'])->toBe('model');
});

it('returns empty messages and zero spend for an empty thread', function () {
    $out = mapThread([]);
    expect($out['messages'])->toBe([]);
    expect($out['total_spend'])->toBe(0.0);
    expect($out['tips_spend'])->toBe(0.0);
});

it('treats an all-untimestamped thread as one session', function () {
    $out = mapThread([
        ['from' => 'creator', 'text' => 'ppv a', 'price' => 20, 'isFree' => false, 'isOpened' => true, 'isTip' => false],
        ['from' => 'fan', 'text' => 'thanks'],
    ]);

    // No timestamps → no gap → whole thread is one session → the PPV is in-window.
    expect($out['total_spend'])->toBe(20.0);
    expect(collect($out['messages'])->firstWhere('sender', 'ppv'))->not->toBeNull();
});

it('starts the session at the most recent long gap when several gaps exist', function () {
    $now = now();
    $out = mapThread([
        ['from' => 'creator', 'text' => 'old', 'time' => $now->copy()->subDays(4)->toIso8601String(),
            'price' => 40, 'isFree' => false, 'isOpened' => true, 'isTip' => false],
        // gap 1 (>12h)
        ['from' => 'fan', 'text' => 'mid', 'time' => $now->copy()->subDays(2)->toIso8601String()],
        // gap 2 (>12h) — session starts AFTER this one
        ['from' => 'creator', 'text' => 'recent ppv', 'time' => $now->copy()->subMinutes(5)->toIso8601String(),
            'price' => 25, 'isFree' => false, 'isOpened' => true, 'isTip' => false],
    ], 12);

    // Only the most-recent-gap session counts: the $25 PPV, not the $40 one.
    expect($out['total_spend'])->toBe(25.0);
});

it('stamps each message with its clock time in the creator timezone', function () {
    // 13:02 UTC is 9:02 AM in New York (EDT). The legacy transcript prints this stamp as
    // "[9:02 AM] CUSTOMER: …" — without it the AI sees only relative gaps, no clock times.
    $out = app(LiveThreadMapper::class)->map([
        ['from' => 'fan', 'text' => 'good morning', 'time' => '2026-09-24T13:02:00+00:00'],
        ['from' => 'creator', 'text' => 'hey you', 'time' => '2026-09-24T22:40:00+00:00'],
    ], 12, 'America/New_York');

    expect($out['messages'][0]['ts'])->toBe('9:02 AM');
    expect($out['messages'][1]['ts'])->toBe('6:40 PM');
});

it('does not invent a stamp for a message with no time', function () {
    $out = app(LiveThreadMapper::class)->map([['from' => 'fan', 'text' => 'hey']], 12, 'America/New_York');

    expect($out['messages'][0])->not->toHaveKey('ts');
});
