<?php

namespace App\Support;

/**
 * Server-side "intent button" directives. A directive rides the existing agent-override
 * `context` channel for ONE generate. `ppv` and `free_picture` are client flows, never keys here.
 */
final class AgentIntents
{
    public const SERVER_KEYS = ['repitch', 'reoffer_mppv'];

    /**
     * @param  list<array<string, mixed>>  $thread  oldest → newest (hidden mass PPVs already excluded)
     * @param  list<array<string, mixed>>  $droppedMass  hidden unbought mass PPVs, oldest → newest
     *
     * @throws IntentUnavailable
     */
    public static function directive(string $key, array $thread, array $droppedMass): string
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

        throw new IntentUnavailable('Unknown intent.');
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
