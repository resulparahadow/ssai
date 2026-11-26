<?php

use App\Services\OnlyFans\LiveThreadMapper;
use App\Services\OnlyFans\OnlyFansService;

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

it('drops an unopened mass PPV entirely (no bubble, no spend)', function () {
    $now = now();
    $out = mapThread([
        ['from' => 'fan', 'text' => 'hey', 'time' => $now->copy()->subMinutes(10)->toIso8601String()],
        // A mass-message blast (isFromQueue) the fan never bought — NOT a chatter pitch.
        ['from' => 'creator', 'text' => 'mass blast caption', 'time' => $now->copy()->subMinutes(5)->toIso8601String(),
            'price' => 21, 'isFree' => false, 'isOpened' => false, 'isTip' => false, 'fromQueue' => true],
    ]);

    expect(collect($out['messages'])->pluck('sender')->all())->not->toContain('ppv');
    expect(collect($out['messages'])->pluck('text')->all())->not->toContain('mass blast caption');
    expect($out['total_spend'])->toBe(0.0);
});

it('keeps an opened mass PPV as a ppv bubble with its spend (the fan really paid)', function () {
    $now = now();
    $out = mapThread([
        ['from' => 'fan', 'text' => 'hey', 'time' => $now->copy()->subMinutes(10)->toIso8601String()],
        ['from' => 'creator', 'text' => 'mass blast caption', 'time' => $now->copy()->subMinutes(5)->toIso8601String(),
            'price' => 21, 'isFree' => false, 'isOpened' => true, 'isTip' => false, 'fromQueue' => true],
    ]);

    $ppv = collect($out['messages'])->firstWhere('sender', 'ppv');
    expect($ppv)->not->toBeNull();
    expect($ppv['opened'])->toBeTrue();
    expect($out['total_spend'])->toBe(21.0);
});

it('does not let an unopened mass blast bridge a session gap', function () {
    $now = now();
    $out = mapThread([
        // Old opened chat PPV, then 8h to the blast, then 8h to the fan returning: with the
        // blast counted the thread has no >12h gap and the old PPV would leak into this
        // session's spend. Dropped BEFORE gap detection, the real gap is 16h.
        ['from' => 'creator', 'text' => 'old ppv', 'time' => $now->copy()->subHours(16)->toIso8601String(),
            'price' => 50, 'isFree' => false, 'isOpened' => true, 'isTip' => false],
        ['from' => 'creator', 'text' => 'blast', 'time' => $now->copy()->subHours(8)->toIso8601String(),
            'price' => 21, 'isFree' => false, 'isOpened' => false, 'isTip' => false, 'fromQueue' => true],
        ['from' => 'fan', 'text' => 'im back', 'time' => $now->toIso8601String()],
    ], 12);

    expect($out['total_spend'])->toBe(0.0);
});

it('keeps a free mass message as an ordinary model bubble', function () {
    $now = now();
    $out = mapThread([
        ['from' => 'creator', 'text' => 'free blast', 'time' => $now->copy()->subMinutes(2)->toIso8601String(),
            'price' => 0, 'isFree' => true, 'isOpened' => false, 'isTip' => false, 'fromQueue' => true],
    ]);

    expect($out['messages'][0]['sender'])->toBe('model');
    expect($out['messages'][0]['text'])->toBe('free blast');
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

it('normalizeMessage carries isFromQueue through as fromQueue', function () {
    $svc = app(OnlyFansService::class);

    $mass = $svc->normalizeMessage([
        'id' => 1, 'text' => 'blast', 'price' => 21, 'isFree' => false,
        'isOpened' => false, 'isFromQueue' => true, 'queueId' => 42,
        'fromUser' => ['id' => 556],
    ], '101');
    $direct = $svc->normalizeMessage([
        'id' => 2, 'text' => 'hi', 'fromUser' => ['id' => 101],
        // queueId alone is NOT a mass signal — seen live with isFromQueue:false.
        'queueId' => 43,
    ], '101');

    expect($mass['fromQueue'])->toBeTrue();
    expect($direct['fromQueue'])->toBeFalse();
});

function tagMap(array $messages, array $tags = []): array
{
    return app(LiveThreadMapper::class)->map($messages, 12, 'UTC', $tags);
}

function tagPriced(string $id, int $minAgo, array $extra = []): array
{
    return array_merge([
        'id' => $id, 'from' => 'creator', 'text' => "pitch {$id}", 'time' => now()->subMinutes($minAgo)->toIso8601String(),
        'price' => 25, 'isFree' => false, 'isOpened' => false, 'isTip' => false,
    ], $extra);
}

it('a chat_ppv tag on a fromQueue message keeps it and makes it a ppv bubble', function () {
    $out = tagMap([tagPriced('m1', 5, ['fromQueue' => true])], ['m1' => 'chat_ppv']);

    expect($out['messages'])->toHaveCount(1)
        ->and($out['messages'][0]['sender'])->toBe('ppv')
        ->and($out['droppedMass'])->toBe([])
        ->and($out['thread'][0]['tag'])->toBe('chat_ppv');
});

it('an mppv tag on a non-queue unopened priced message hides it', function () {
    $out = tagMap([tagPriced('m1', 5)], ['m1' => 'mppv']);

    expect($out['messages'])->toBe([])
        ->and($out['thread'])->toBe([])
        ->and($out['droppedMass'])->toHaveCount(1);
});

it('free_preview is not a ppv bubble but an opened one still counts as spend', function () {
    $out = tagMap([tagPriced('m1', 5, ['isOpened' => true])], ['m1' => 'free_preview']);

    expect($out['messages'])->toHaveCount(1)
        ->and($out['messages'][0]['sender'])->toBe('model')
        ->and($out['messages'][0])->not->toHaveKey('price')
        ->and($out['total_spend'])->toBe(25.0)
        ->and($out['thread'][0]['tag'])->toBe('free_preview');
});

it('an opened mass PPV stays, counts as spend and is tagged mppv in thread', function () {
    $out = tagMap([tagPriced('m1', 5, ['fromQueue' => true, 'isOpened' => true])]);

    expect($out['messages'][0]['sender'])->toBe('ppv')
        ->and($out['total_spend'])->toBe(25.0)
        ->and($out['thread'][0]['tag'])->toBe('mppv')
        ->and($out['droppedMass'])->toBe([]);
});

it('droppedMass returns the hidden unbought mass PPV with its id and text', function () {
    $out = tagMap([tagPriced('m7', 5, ['fromQueue' => true])]);

    expect($out['messages'])->toBe([])
        ->and($out['droppedMass'])->toHaveCount(1)
        ->and($out['droppedMass'][0]['id'])->toBe('m7')
        ->and($out['droppedMass'][0]['text'])->toBe('pitch m7')
        ->and($out['droppedMass'][0]['tag'])->toBe('mppv');
});

it('thread carries ids and tags, oldest first', function () {
    $out = tagMap([
        tagPriced('m2', 1),
        ['id' => 'm1', 'from' => 'fan', 'text' => 'hi', 'time' => now()->subMinutes(9)->toIso8601String()],
    ]);

    expect(array_column($out['thread'], 'id'))->toBe(['m1', 'm2'])
        ->and(array_column($out['thread'], 'tag'))->toBe([null, 'chat_ppv']);
});

it('with no tags and no ids the engine messages are identical to before', function () {
    $t = now()->startOfMinute();
    $out = mapThread([
        ['from' => 'fan', 'text' => 'hey', 'time' => $t->copy()->subMinutes(10)->toIso8601String()],
        ['from' => 'creator', 'text' => 'unlock', 'time' => $t->copy()->subMinutes(5)->toIso8601String(),
            'price' => 20, 'isFree' => false, 'isOpened' => true, 'isTip' => false],
        ['from' => 'creator', 'text' => 'blast', 'time' => $t->copy()->subMinutes(4)->toIso8601String(),
            'price' => 9, 'isFree' => false, 'isOpened' => false, 'isTip' => false, 'fromQueue' => true],
    ]);

    expect($out['messages'])->toBe([
        ['sender' => 'customer', 'text' => 'hey', 'ts_iso' => $t->copy()->subMinutes(10)->format('c'), 'ts' => $t->copy()->subMinutes(10)->utc()->format('g:i A')],
        ['sender' => 'ppv', 'text' => 'unlock', 'ts_iso' => $t->copy()->subMinutes(5)->format('c'), 'ts' => $t->copy()->subMinutes(5)->utc()->format('g:i A'), 'opened' => true, 'price' => 20.0],
    ])->and($out['total_spend'])->toBe(20.0);
});

// ---- "Came with tip / media" tags (legacy's CAME-WITH-MEDIA / TIPPED, filled from OnlyFans) ----

it('tags a fan tip with its amount and a fan photo as customer media', function () {
    $t = now()->startOfMinute();
    $out = mapThread([
        ['from' => 'fan', 'text' => '', 'time' => $t->copy()->subMinutes(3)->toIso8601String(),
            'price' => 15, 'isFree' => false, 'isTip' => true],
        ['from' => 'fan', 'text' => 'look', 'time' => $t->copy()->subMinutes(2)->toIso8601String(), 'mediaCount' => 2],
        ['from' => 'fan', 'text' => 'for you', 'time' => $t->copy()->subMinute()->toIso8601String(),
            'price' => 5, 'isFree' => false, 'isTip' => true, 'mediaCount' => 1],
    ]);

    expect($out['messages'][0]['tags'])->toBe(['tip' => true, 'tipAmount' => 15.0])
        ->and($out['messages'][1]['tags'])->toBe(['customerMedia' => true])
        ->and($out['messages'][2]['tags'])->toBe(['tip' => true, 'tipAmount' => 5.0, 'customerMedia' => true]);
});

it('adds no tags key to plain fan lines, creator lines or creator media', function () {
    $t = now()->startOfMinute();
    $out = mapThread([
        ['from' => 'fan', 'text' => 'hi', 'time' => $t->copy()->subMinutes(3)->toIso8601String()],
        ['from' => 'creator', 'text' => 'pic', 'time' => $t->copy()->subMinutes(2)->toIso8601String(), 'mediaCount' => 1],
        ['from' => 'fan', 'text' => 'nice', 'time' => $t->copy()->subMinute()->toIso8601String(), 'mediaCount' => 0],
    ]);

    foreach ($out['messages'] as $m) {
        expect($m)->not->toHaveKey('tags');
    }
});

it('tags a tip with no amount without a tipAmount, and outside the session window too', function () {
    $t = now()->startOfMinute();
    $out = mapThread([
        ['from' => 'fan', 'text' => '', 'time' => $t->copy()->subDays(3)->toIso8601String(), 'isTip' => true],
        ['from' => 'fan', 'text' => 'back', 'time' => $t->copy()->subMinute()->toIso8601String()],
    ]);

    expect($out['messages'][0]['tags'])->toBe(['tip' => true])
        ->and($out['tips_spend'])->toBe(0.0);
});
