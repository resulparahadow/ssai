<?php

use App\Support\AgentIntents;
use App\Support\IntentUnavailable;

function intentItem(string $from, ?string $tag = null, float $price = 0, bool $opened = false, string $text = 'x'): array
{
    return ['id' => uniqid(), 'from' => $from, 'text' => $text, 'ts' => '1:00 PM', 'price' => $price,
        'isFree' => false, 'isOpened' => $opened, 'isTip' => false, 'fromQueue' => $tag === 'mppv', 'tag' => $tag];
}

it('unpaidPpv ignores an opened PPV and anything older than it', function () {
    $thread = [
        intentItem('creator', 'chat_ppv', 10),
        intentItem('fan'),
        intentItem('creator', 'chat_ppv', 20, true),
        intentItem('fan'),
    ];
    expect(AgentIntents::unpaidPpv($thread))->toBeNull();
});

it('unpaidPpv counts messages after the PPV', function () {
    $thread = [
        intentItem('creator', 'chat_ppv', 21),
        intentItem('fan'), intentItem('creator'), intentItem('fan'),
    ];
    expect(AgentIntents::unpaidPpv($thread))->toBe(['price' => 21.0, 'since' => 3]);
});

it('an opened mass PPV is never unpaid', function () {
    expect(AgentIntents::unpaidPpv([intentItem('creator', 'mppv', 15, true), intentItem('fan')]))->toBeNull();
});

it('directive repitch fills price and count', function () {
    $thread = [intentItem('creator', 'chat_ppv', 12.5), intentItem('fan'), intentItem('creator')];
    expect(AgentIntents::directive('repitch', $thread, []))->toBe(
        'INTENT BUTTON — Re-pitch: He has not opened the PPV already sent in this chat ($12.50, locked, 2 messages ago). Write ONE message that gets him to open THAT PPV. Same price: no discount, no new content, and no price or number in the text. Curiosity and a light nudge, not pressure (CTA 2 / objection doctrine).'
    );
    $thread[0]['price'] = 21;
    expect(AgentIntents::directive('repitch', $thread, []))->toContain('($21, locked');
});

it('directive reoffer_mppv uses the newest dropped mass PPV and cuts long text to 140 chars', function () {
    $dropped = [intentItem('creator', 'mppv', 9, false, 'old one'), intentItem('creator', 'mppv', 30, false, '  '.str_repeat('a', 200))];
    $d = AgentIntents::directive('reoffer_mppv', [], $dropped);
    expect($d)->toContain('"'.str_repeat('a', 140).'…" ($30)')
        ->and($d)->toStartWith('INTENT BUTTON — Re-offer MPPV: He never bought the mass message "')
        ->and($d)->toEndWith('(CTA 1 doctrine).');
});

it('directive throws IntentUnavailable without the needed message', function () {
    expect(fn () => AgentIntents::directive('repitch', [], []))->toThrow(IntentUnavailable::class, 'No unpaid PPV in this chat to re-pitch.');
    expect(fn () => AgentIntents::directive('reoffer_mppv', [], []))->toThrow(IntentUnavailable::class, 'No unbought mass PPV in this chat to re-offer.');
});

it('compose appends the agent note only when typed text is non-empty', function () {
    expect(AgentIntents::compose('D', ''))->toBe('D')
        ->and(AgentIntents::compose('D', "  \n"))->toBe('D')
        ->and(AgentIntents::compose('D', 'be nice'))->toBe("D\n\nAgent note (apply within the intent above): be nice");
});

it('engine/intent_directives.json (the spot-check copy) matches the PHP directives', function () {
    $json = json_decode(file_get_contents(dirname(__DIR__, 2).'/engine/intent_directives.json'), true);
    $thread = array_merge([intentItem('creator', 'chat_ppv', 21)], array_fill(0, 5, intentItem('fan')));
    $mass = [intentItem('creator', 'mppv', 15, false, 'made something naughty in the shower today, unlock it')];
    expect(AgentIntents::directive('repitch', $thread, []))->toBe($json['repitch'])
        ->and(AgentIntents::directive('reoffer_mppv', [], $mass))->toBe($json['reoffer_mppv']);
});
