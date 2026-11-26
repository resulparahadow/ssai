<?php

namespace App\Support;

/**
 * Server-side "intent button" directives. A directive rides the existing agent-override
 * `context` channel for ONE generate. `ppv` and `free_picture` are client flows, never keys here.
 */
final class AgentIntents
{
    /** @var list<array{key: string, label: string, group: string, server: bool, options: list<array{key: string, label: string}>}>|null */
    private static ?array $catalogue = null;

    /** The shared chip catalogue (the client imports the same JSON). Order = chip order. */
    public static function catalogue(): array
    {
        return self::$catalogue ??= json_decode(
            (string) file_get_contents(__DIR__.'/../../resources/js/lib/intent-catalogue.json'),
            true,
            512,
            JSON_THROW_ON_ERROR,
        )['intents'];
    }

    /** @return list<string> */
    public static function serverKeys(): array
    {
        return array_values(array_map(
            fn ($i) => $i['key'],
            array_filter(self::catalogue(), fn ($i) => $i['server']),
        ));
    }

    /** @return list<string> */
    public static function options(string $key): array
    {
        foreach (self::catalogue() as $i) {
            if ($i['key'] === $key) {
                return array_map(fn ($o) => $o['key'], $i['options']);
            }
        }

        return [];
    }

    public static function aftercareContext(string $option): string
    {
        return $option === 'after_sexting' ? 'aftersex' : 'ladder_stop';
    }

    /**
     * @param  list<array<string, mixed>>  $thread  oldest → newest (hidden mass PPVs already excluded)
     * @param  list<array<string, mixed>>  $droppedMass  hidden unbought mass PPVs, oldest → newest
     *
     * @throws IntentUnavailable
     */
    public static function directive(string $key, ?string $option, array $thread, array $droppedMass): string
    {
        if ($key === 'repitch') {
            $unpaid = self::unpaidPpv($thread);
            if ($unpaid === null) {
                throw new IntentUnavailable('No unpaid PPV in this chat to re-pitch.');
            }

            return 'INTENT BUTTON — Re-pitch: He has not opened the PPV already sent in this chat ('
                .self::money($unpaid['price']).', locked, '.$unpaid['since'].' messages ago). '
                .'Write ONE message that gets him to open THAT PPV. Same price: no discount, no new content, and no price or number in the text. '
                .'Curiosity and a light nudge, not pressure (CTA 2 / objection doctrine).';
        }

        if ($key === 'reoffer_mppv') {
            $mass = $droppedMass === [] ? null : end($droppedMass);
            if ($mass === null) {
                throw new IntentUnavailable('No unbought mass PPV in this chat to re-offer.');
            }
            $text = trim((string) ($mass['text'] ?? ''));
            if (mb_strlen($text) > 140) {
                $text = mb_substr($text, 0, 140).'…';
            }

            return 'INTENT BUTTON — Re-offer MPPV: He never bought the mass message "'.$text.'" ('
                .self::money((float) ($mass['price'] ?? 0)).'). '
                .'Write ONE message offering that same content to him personally as his first purchase, framed as just for him, not a mass message. '
                .'Do not quote a price or any number; the agent attaches the content and sets the price (CTA 1 doctrine).';
        }

        $entry = collect(self::catalogue())->firstWhere('key', $key);
        if ($entry === null || ! $entry['server'] || $key === 'aftersale') {
            throw new IntentUnavailable('Unknown intent.');
        }
        $opt = null;
        $n = 0;
        foreach ($entry['options'] as $idx => $o) {
            if ($o['key'] === $option) {
                $opt = $o;
                $n = $idx + 1;
            }
        }
        if ($entry['options'] !== [] && $opt === null) {
            throw new IntentUnavailable('Pick an option for this intent.');
        }
        $label = $opt === null ? $entry['label'] : $entry['label'].' – '.$opt['label'];
        $body = match ($key) {
            'cta' => $option === 'cta1'
                ? 'Write ONE CTA #1 message (PART 3 Step 4, The Connection): build the personal connection that makes him want to see more of her, tied to something he said. No content offer and no price yet.'
                : 'Write ONE CTA #2 message (PART 3 Step 7, The Reason to Buy): give him the reason to open or buy now, with curiosity tied to the scene. Never describe the content, never name a price.',
            'objection' => 'He has raised PART 11 objection '.$n.' ("'.$opt['label'].'"). Write ONE message that solves it the PART 11 way: empathy, reframe to connection, a curiosity hook. Hold the price: no discount and no number in the text. Do not run the goodbye framework.',
            'sexting' => 'Write ONE warm-up sexting beat (PART 23): build the scene with her in it, react to what he gave, and hand the next move back to him with a question. No PPV pitch and no price in this message.',
            'promise' => match ($option) {
                'ask' => 'Run the promise ritual opener now (PART 4; the PROMISE step, RLS beat 11): the trust ask that comes before any content. One message.',
                'reinforce1' => 'He has agreed to the promise. Write the FIRST reinforcement beat (PART 4): reinforce, do not re-ask. One message.',
                default => 'He has agreed to the promise and it was reinforced once. Write the SECOND reinforcement beat (PART 4): reinforce, do not re-ask. One message.',
            },
            'post_purchase' => 'He just unlocked her PPV. Text first: an in-character reaction to him opening it plus ONE deepening question about him. No new pitch and no price in this message.',
            'post_tip' => 'He just tipped. Write ONE message of real appreciation plus a question about him. No content, no pitch, no price (TIP-ASKING DOCTRINE).',
            'tip_ask' => 'Write ONE tip ask (TIP-ASKING DOCTRINE). Keep it vague: NEVER a number, an amount or a price. Frame it as spoiling her or taking care of her, in her voice.',
            'breadcrumb' => 'Shift from chit-chat toward a CTA: drop ONE scene cue tied to something he said (BREADCRUMB) and let him react. No offer and no price.',
            'hook' => 'Write ONE eye-catching first message to a new subscriber (Warm Welcome): short, personal, easy to reply to. No selling.',
            'chitchat' => 'Write ONE rapport beat (PART 3 Step 2, Chit Chat): flirt on what he gave, ask about him. No selling and no mention of content in this message.',
            'follow_up' => 'He went quiet after spending. Write ONE re-engagement message: a callback to the last specific thing he shared, light and warm. No chasing, no guilt, no pitch.',
            'goodbye' => 'Run Goodbye Framework PHASE '.$n.' (PART 12): '.['bounce back and pivot', 'chill chat and vetting', 'smooth exit'][$n - 1].'. One message.',
            default => throw new IntentUnavailable('Unknown intent.'),
        };

        return 'INTENT BUTTON — '.$label.': '.$body;
    }

    /**
     * Newest chat/mass PPV he has not opened, and only if no such PPV after it was opened.
     *
     * @param  list<array<string, mixed>>  $thread
     * @return array{price: float, since: int}|null
     */
    public static function unpaidPpv(array $thread): ?array
    {
        $n = count($thread);
        for ($i = $n - 1; $i >= 0; $i--) {
            $m = $thread[$i];
            if (! in_array($m['tag'] ?? null, ['chat_ppv', 'mppv'], true)) {
                continue;
            }
            // Walking newest → oldest: the first such item decides. Opened → nothing older is unpaid.
            if (! empty($m['isOpened'])) {
                return null;
            }

            return ['price' => (float) ($m['price'] ?? 0), 'since' => $n - 1 - $i];
        }

        return null;
    }

    public static function compose(string $directive, string $typed): string
    {
        $typed = trim($typed);

        return $typed === '' ? $directive : $directive."\n\nAgent note (apply within the intent above): ".$typed;
    }

    private static function money(float $price): string
    {
        return '$'.(floor($price) == $price ? (string) (int) $price : number_format($price, 2, '.', ''));
    }
}
