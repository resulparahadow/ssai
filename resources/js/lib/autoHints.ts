import type { MessageTag, OfMessage } from '@/types/crm';
import { effectiveTag } from './chatCounters.ts';

// §5a slice 3 auto hints: Post-purchase / Post-tip light up by themselves when the loaded thread
// shows the moment for them. Client-only and read from the messages already loaded — nothing is
// stored. Spec: docs/superpowers/specs/2026-11-26-agent-intents-design.md §11 (slice 3).

export interface AutoHints {
    /** The newest PPV he can see was bought and the creator hasn't written since it. */
    postPurchase: boolean;
    /** He tipped after the creator's last message. */
    postTip: boolean;
    /** A new subscriber the creator hasn't written to herself yet. */
    hook: boolean;
    /** He said no to the PPV still waiting for him, and she hasn't answered yet. */
    aftersale: boolean;
}

export const NO_HINTS: AutoHints = {
    postPurchase: false,
    postTip: false,
    hook: false,
    aftersale: false,
};

/** A subscriber this new still gets the Hook hint. */
export const HOOK_NEW_DAYS = 7;
/** OnlyFans' automatic Welcome Message goes out right after he subscribes; a creator message
 *  this soon after subscribing is that, not her writing to him herself. */
export const WELCOME_GRACE_MINUTES = 10;

/** The fan's subscription, from the fan details (`OfFan`). */
export interface FanSubscription {
    subscribed: boolean | null;
    subscribedAt: string | null;
}

const at = (m: OfMessage): number => {
    const t = m.time === null ? NaN : Date.parse(m.time);

    return Number.isNaN(t) ? 0 : t;
};

/**
 * OnlyFans says a PPV was bought (`isOpened`) but not WHEN, so "bought since she last wrote"
 * can't be checked exactly. The stand-in: the newest PPV is bought and no creator message came
 * after it. A mass blast (`fromQueue`) is not the creator answering him, so it doesn't count as
 * "she wrote"; optimistic and failed bubbles don't count either (a send in flight is her answer
 * on its way, but the intent chips are already locked while sending).
 */
export function autoHints(
    messages: OfMessage[],
    tags: Record<string, MessageTag>,
    sub: FanSubscription | null = null,
    now: number = Date.now(),
): AutoHints {
    const real = messages
        .filter((m) => !m.pending && !m.failed)
        .map((m, i) => ({ m, i }))
        // Stable by time, then load order — same tie-break as chatCounters.
        .sort((a, b) => at(a.m) - at(b.m) || a.i - b.i)
        .map(({ m }) => m);

    let lastWrote = -1;

    for (let i = real.length - 1; i >= 0; i--) {
        if (real[i].from === 'creator' && !real[i].fromQueue) {
            lastWrote = i;
            break;
        }
    }

    const postTip = real
        .slice(lastWrote + 1)
        .some((m) => m.from === 'fan' && m.isTip);

    let postPurchase = false;

    for (let i = real.length - 1; i >= 0; i--) {
        const tag = effectiveTag(real[i], tags);

        if (tag !== 'chat_ppv' && tag !== 'mppv') {
            continue;
        }

        // The newest PPV decides. Bought, and nothing she wrote after it.
        postPurchase = real[i].isOpened && lastWrote <= i;
        break;
    }

    return {
        postPurchase,
        postTip,
        hook: hookHint(real, sub, now),
        aftersale: aftersaleHint(real, tags),
    };
}

/**
 * Hook (Warm Welcome) lights for a fan who subscribed in the last HOOK_NEW_DAYS days when the
 * creator hasn't written to him herself since — mass blasts and the Welcome Message sent in the
 * first WELCOME_GRACE_MINUTES don't count. No subscription date (details not loaded, or OnlyFans
 * didn't say) or a lapsed subscription = no hint.
 */
function hookHint(
    real: OfMessage[],
    sub: FanSubscription | null,
    now: number,
): boolean {
    if (sub === null || sub.subscribed === false || sub.subscribedAt === null) {
        return false;
    }

    const since = Date.parse(sub.subscribedAt);

    if (
        Number.isNaN(since) ||
        since > now ||
        now - since > HOOK_NEW_DAYS * 86400000
    ) {
        return false;
    }

    const grace = since + WELCOME_GRACE_MINUTES * 60000;

    return !real.some(
        (m) => m.from === 'creator' && !m.fromQueue && at(m) > grace,
    );
}

/**
 * A plain refusal, English or Spanish: "no", "nah", "not now", "maybe later", "no thanks",
 * "I'm good", "not interested", "can't afford it", "ahora no", "no gracias", "después"…
 * Deliberately narrow: a price push-back ("too expensive", "for free") is an OBJECTION —
 * that button answers it — and a "no" inside a sentence ("no way you're so hot") isn't one.
 */
const REFUSAL = new RegExp(
    [
        String.raw`^\s*(no+|nah+|nope|pass)\b[\s.!,]*$`,
        String.raw`^\s*no+[\s,.!]+(thanks|thank you|gracias|babe|baby|bb|hun|sorry)\b`,
        String.raw`\b(not now|maybe later|another time|some other time|next time|not today|not tonight)\b`,
        String.raw`\b(no thanks|no thank you|i'?m good|im good|i'?ll pass|not interested|not for me)\b`,
        String.raw`\b(don'?t want (it|that|to)|dont want (it|that|to)|not buying|not paying|won'?t pay|wont pay)\b`,
        String.raw`\b(can'?t afford|cant afford|no money|i'?m broke|im broke)\b`,
        String.raw`\b(ahora no|hoy no|no gracias|no quiero|no puedo|no tengo (dinero|plata)|otro d[ií]a|despu[eé]s|luego|m[aá]s tarde)\b`,
    ].join('|'),
    'iu',
);

export function isRefusal(text: string): boolean {
    const plain = text
        .replace(/<[^>]*>/g, ' ')
        .replace(/[\u2018\u2019]/g, "'")
        .trim();

    return plain !== '' && REFUSAL.test(plain);
}

/**
 * Aftersale ("After a no") lights when the newest PPV he can see is NOT bought, his newest
 * message after it is a refusal, and she hasn't written since that message. Hidden unbought
 * mass PPVs are not a pitch to him, so they don't count as "the PPV".
 */
function aftersaleHint(
    real: OfMessage[],
    tags: Record<string, MessageTag>,
): boolean {
    let ppvAt = -1;

    for (let i = real.length - 1; i >= 0; i--) {
        const tag = effectiveTag(real[i], tags);

        if (tag === 'chat_ppv' || (tag === 'mppv' && real[i].isOpened)) {
            ppvAt = i;
            break;
        }
    }

    if (ppvAt < 0 || real[ppvAt].isOpened) {
        return false;
    }

    let fanAt = -1;

    for (let i = real.length - 1; i > ppvAt; i--) {
        if (real[i].from === 'fan' && !real[i].isTip) {
            fanAt = i;
            break;
        }
    }

    if (fanAt < 0 || !isRefusal(real[fanAt].text)) {
        return false;
    }

    return !real
        .slice(fanAt + 1)
        .some((m) => m.from === 'creator' && !m.fromQueue);
}
