<?php

use App\Services\OnlyFans\FanMemoryLog;

/**
 * The fan's AI memory is a log of dated entries, one per conversation (legacy's
 * writeSessionMemory format: "[Sep 28, 2026] …", blank line between entries).
 */
it('starts an empty log with a dated entry', function () {
    expect(FanMemoryLog::record(null, 'likes cars', 'Sep 28, 2026', false))
        ->toBe('[Sep 28, 2026] likes cars');
});

it('appends a new conversation below the earlier entries instead of overwriting them', function () {
    expect(FanMemoryLog::record('[Sep 27, 2026] works nights', 'likes cars', 'Sep 28, 2026', false))
        ->toBe("[Sep 27, 2026] works nights\n\n[Sep 28, 2026] likes cars");
});

it('keeps undated older memory above the first dated entry', function () {
    expect(FanMemoryLog::record('old note', 'likes cars', 'Sep 28, 2026', false))
        ->toBe("old note\n\n[Sep 28, 2026] likes cars");
});

it('rewrites only the current entry while the conversation continues, keeping its date', function () {
    $log = "[Sep 27, 2026] works nights\n\n[Sep 28, 2026] likes cars";

    // The conversation crossed midnight: the entry keeps the date it started on.
    expect(FanMemoryLog::record($log, 'likes cars, has a dog', 'Sep 29, 2026', true))
        ->toBe("[Sep 27, 2026] works nights\n\n[Sep 28, 2026] likes cars, has a dog");
});

it('appends rather than rewriting a last block that is not a dated entry', function () {
    expect(FanMemoryLog::record('old note', 'likes cars', 'Sep 28, 2026', true))
        ->toBe("old note\n\n[Sep 28, 2026] likes cars");
});

it('does not repeat an entry the AI summarised word for word', function () {
    expect(FanMemoryLog::record('[Sep 27, 2026] likes cars', 'likes cars', 'Sep 28, 2026', false))
        ->toBe('[Sep 27, 2026] likes cars');
});

it('flattens line breaks in the summary so entries stay separable', function () {
    expect(FanMemoryLog::record(null, "likes cars\n\nhas a dog", 'Sep 28, 2026', false))
        ->toBe('[Sep 28, 2026] likes cars has a dog');
});

it('drops the oldest entries once the log outgrows its column', function () {
    $old = '[Jan 1, 2026] '.str_repeat('a', 59990);

    expect(FanMemoryLog::record($old, 'likes cars', 'Sep 28, 2026', false))
        ->toBe('[Sep 28, 2026] likes cars');
});

it('shows the AI only the newest whole entries that fit', function () {
    $log = "[Sep 26, 2026] aaaa\n\n[Sep 27, 2026] bbbb\n\n[Sep 28, 2026] cccc";

    expect(FanMemoryLog::recent($log, 40))->toBe("[Sep 27, 2026] bbbb\n\n[Sep 28, 2026] cccc");
    expect(FanMemoryLog::recent($log, 39))->toBe('[Sep 28, 2026] cccc');
});

it('cuts a single oversized entry rather than showing the AI nothing', function () {
    expect(FanMemoryLog::recent('[Sep 28, 2026] '.str_repeat('x', 100), 20))
        ->toBe('[Sep 28, 2026] xxxxx');
});

it('shows the AI nothing when there is no memory', function () {
    expect(FanMemoryLog::recent(null, 3000))->toBe('');
});
