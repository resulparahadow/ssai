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
    expect(AgentIntents::directive('repitch', null, $thread, []))->toBe(
        'INTENT BUTTON — Re-pitch: He has not opened the PPV already sent in this chat ($12.50, locked, 2 messages ago). Write ONE message that gets him to open THAT PPV. Same price: no discount, no new content, and no price or number in the text. Curiosity and a light nudge, not pressure (CTA 2 / objection doctrine).'
    );
    $thread[0]['price'] = 21;
    expect(AgentIntents::directive('repitch', null, $thread, []))->toContain('($21, locked');
});

it('directive reoffer_mppv uses the newest dropped mass PPV and cuts long text to 140 chars', function () {
    $dropped = [intentItem('creator', 'mppv', 9, false, 'old one'), intentItem('creator', 'mppv', 30, false, '  '.str_repeat('a', 200))];
    $d = AgentIntents::directive('reoffer_mppv', null, [], $dropped);
    expect($d)->toContain('"'.str_repeat('a', 140).'…" ($30)')
        ->and($d)->toStartWith('INTENT BUTTON — Re-offer MPPV: He never bought the mass message "')
        ->and($d)->toEndWith('(CTA 1 doctrine).');
});

it('directive throws IntentUnavailable without the needed message', function () {
    expect(fn () => AgentIntents::directive('repitch', null, [], []))->toThrow(IntentUnavailable::class, 'No unpaid PPV in this chat to re-pitch.');
    expect(fn () => AgentIntents::directive('reoffer_mppv', null, [], []))->toThrow(IntentUnavailable::class, 'No unbought mass PPV in this chat to re-offer.');
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
    expect(AgentIntents::directive('repitch', null, $thread, []))->toBe($json['repitch'])
        ->and(AgentIntents::directive('reoffer_mppv', null, [], $mass))->toBe($json['reoffer_mppv']);
});

it('catalogue lists every server key with a directive and no directive key outside it', function () {
    $keys = AgentIntents::serverKeys();
    expect($keys)->toBe(['repitch', 'cta', 'objection', 'chitchat', 'sexting', 'tip_ask', 'goodbye', 'reoffer_mppv',
        'promise', 'post_purchase', 'post_tip', 'breadcrumb', 'hook', 'follow_up', 'aftersale']);
    $client = collect(AgentIntents::catalogue())->where('server', false)->pluck('key')->all();
    expect($client)->toBe(['ppv', 'free_picture']);
    foreach ($keys as $key) {
        if ($key === 'aftersale') {
            expect(fn () => AgentIntents::directive($key, 'after_no', [], []))->toThrow(IntentUnavailable::class, 'Unknown intent.');

            continue;
        }
        if (in_array($key, ['repitch', 'reoffer_mppv'], true)) {
            continue;
        }
        $opts = AgentIntents::options($key) ?: [null];
        foreach ($opts as $o) {
            expect(AgentIntents::directive($key, $o, [], []))->toStartWith('INTENT BUTTON — ');
        }
    }
    expect(fn () => AgentIntents::directive('nuke', null, [], []))->toThrow(IntentUnavailable::class);
});

it('objection directive numbers the option and holds the price', function () {
    $d = AgentIntents::directive('objection', 'expensive', [], []);
    expect($d)->toContain('INTENT BUTTON — Objection – Too expensive / discount:')
        ->toContain('PART 11 objection 6 ("Too expensive / discount")')
        ->toContain('Hold the price: no discount and no number in the text.');
});

it('goodbye phase 2 directive names chill chat and vetting', function () {
    expect(AgentIntents::directive('goodbye', 'phase2', [], []))->toBe(
        'INTENT BUTTON — Goodbye – Phase 2: Run Goodbye Framework PHASE 2 (PART 12): chill chat and vetting. One message.'
    );
});

it('cta2 label reads CTA – CTA 2', function () {
    expect(AgentIntents::directive('cta', 'cta2', [], []))->toStartWith('INTENT BUTTON — CTA – CTA 2: Write ONE CTA #2 message');
});

it('aftercareContext maps both options', function () {
    expect(AgentIntents::aftercareContext('after_sexting'))->toBe('aftersex')
        ->and(AgentIntents::aftercareContext('after_no'))->toBe('ladder_stop');
});

it('engine/intent_directives.json slice2 block matches every PHP slice-2 directive', function () {
    $json = json_decode(file_get_contents(dirname(__DIR__, 2).'/engine/intent_directives.json'), true)['slice2'];
    $expected = [];
    foreach (AgentIntents::serverKeys() as $key) {
        if (in_array($key, ['repitch', 'reoffer_mppv', 'aftersale'], true)) {
            continue;
        }
        foreach (AgentIntents::options($key) ?: [null] as $o) {
            $expected[$key.($o ? ':'.$o : '')] = AgentIntents::directive($key, $o, [], []);
        }
    }
    expect($json)->toBe($expected);
});
