import type {
    ChatCounters,
    IntentKey,
    IntentLock,
    MessageTag,
    OfMessage,
} from '@/types/crm';

// Client mirror of the server rules in App\Services\OnlyFans\LiveThreadMapper (effective tag,
// hidden mass PPV, session start) and App\Support\AgentIntents::unpaidPpv. Keep the two in step.
// The server checks only that an intent has a target (an unpaid PPV for Re-pitch, an unbought
// mass PPV for Re-offer); the 12/10/6 PPV unlock and the since>=5 Re-pitch wait are CLIENT UI
// locks enforced nowhere else — they only decide which buttons are enabled.

const TAGS: MessageTag[] = ['chat_ppv', 'mppv', 'free_preview'];

/** Messages needed before PPV unlocks: new fan vs a returning one. */
export const PPV_MIN_NEW = 12;
export const PPV_MIN_RETURNING = 10;
export const PPV_MIN_SINCE_LAST = 6;
export const REPITCH_MIN_SINCE = 5;
/** hasMore means the loaded page (100) is a floor, not the real total. */
const PAGE = 100;

export function effectiveTag(
    m: OfMessage,
    tags: Record<string, MessageTag>,
): MessageTag | null {
    if (m.from !== 'creator' || m.isFree || !(m.price > 0) || m.isTip) {
        return null;
    }

    const stored = m.id !== null ? tags[m.id] : undefined;

    if (stored !== undefined && TAGS.includes(stored)) {
        return stored;
    }

    return m.fromQueue ? 'mppv' : 'chat_ppv';
}

export function isHiddenMass(
    m: OfMessage,
    tags: Record<string, MessageTag>,
): boolean {
    return effectiveTag(m, tags) === 'mppv' && !m.isOpened;
}

const ts = (m: OfMessage): number | null => {
    if (m.time === null) {
        return null;
    }

    const t = Date.parse(m.time);

    return Number.isNaN(t) ? null : t;
};

export function chatCounters(
    messages: OfMessage[],
    tags: Record<string, MessageTag>,
    opts: { hasMore: boolean; sessionGapHours: number },
): ChatCounters {
    const real = messages.filter((m) => !m.pending && !m.failed);
    const unboughtMass = real.filter((m) => isHiddenMass(m, tags)).length;
    const items = real
        .filter((m) => !isHiddenMass(m, tags))
        .map((m) => ({ m, t: ts(m), tag: effectiveTag(m, tags) }))
        // Null times sort first, like the server's `ts ?? 0`; Array#sort is stable.
        .sort((a, b) => (a.t ?? 0) - (b.t ?? 0));

    const gap = opts.sessionGapHours * 3600 * 1000;
    let sessionStart = 0;

    for (let i = items.length - 1; i > 0; i--) {
        const cur = items[i].t;
        const prev = items[i - 1].t;

        if (cur !== null && prev !== null && cur - prev > gap) {
            sessionStart = i;
            break;
        }
    }

    const n = items.length;
    let sinceLastPpv: number | null = null;
    let unpaidPpv: ChatCounters['unpaidPpv'] = null;
    let decided = false;

    for (let i = n - 1; i >= 0; i--) {
        const { m, tag } = items[i];

        if (tag !== 'chat_ppv' && tag !== 'mppv') {
            continue;
        }

        if (sinceLastPpv === null) {
            sinceLastPpv = n - 1 - i;
        }

        if (!decided) {
            decided = true;

            if (!m.isOpened) {
                unpaidPpv = {
                    price: m.price,
                    since: n - 1 - i,
                    messageId: m.id,
                };
            }
        }

        break;
    }

    return {
        total: opts.hasMore ? Math.max(n, PAGE) : n,
        sinceLastPpv,
        unpaidPpv,
        returning: sessionStart > 0 || opts.hasMore,
        unboughtMass,
    };
}

/** The PPV chip: with a media step already loaded its click captions that step (nothing to
 *  unlock); with nothing loaded the click opens the picker, so the 12/10/6 lock applies. */
export function ppvChipLock(c: ChatCounters, mediaLoaded: boolean): IntentLock {
    return mediaLoaded
        ? { enabled: true, lit: false, reason: null }
        : intentLock('ppv', c);
}

export function intentLock(key: IntentKey, c: ChatCounters): IntentLock {
    if (key === 'ppv') {
        const need = c.returning ? PPV_MIN_RETURNING : PPV_MIN_NEW;

        if (c.total < need) {
            return {
                enabled: false,
                lit: false,
                reason: `${c.total} of ${need} messages`,
            };
        }

        if (c.sinceLastPpv !== null && c.sinceLastPpv < PPV_MIN_SINCE_LAST) {
            return {
                enabled: false,
                lit: false,
                reason: `${c.sinceLastPpv} of ${PPV_MIN_SINCE_LAST} since the last PPV`,
            };
        }

        return { enabled: true, lit: false, reason: null };
    }

    if (key === 'repitch') {
        if (c.unpaidPpv === null) {
            return { enabled: false, lit: false, reason: 'No unpaid PPV' };
        }

        if (c.unpaidPpv.since < REPITCH_MIN_SINCE) {
            return {
                enabled: false,
                lit: false,
                reason: `${c.unpaidPpv.since} of ${REPITCH_MIN_SINCE} messages since the unpaid PPV`,
            };
        }

        return { enabled: true, lit: true, reason: null };
    }

    if (c.unboughtMass < 1) {
        return { enabled: false, lit: false, reason: 'No unbought mass PPV' };
    }

    return { enabled: true, lit: false, reason: null };
}

const INTENT_LABELS: Record<IntentKey, string> = {
    ppv: 'PPV',
    repitch: 'Re-pitch',
    reoffer_mppv: 'Re-offer MPPV',
};

export function intentLabel(key: IntentKey): string {
    return INTENT_LABELS[key];
}

const TAG_LABELS: Record<MessageTag, string> = {
    chat_ppv: 'Chat PPV',
    mppv: 'Mass',
    free_preview: 'Free preview',
};

export const MESSAGE_TAGS = TAGS;

export function tagLabel(tag: MessageTag): string {
    return TAG_LABELS[tag];
}

/** The bubble chip's text: the tag, plus "· auto" while no override is stored. */
export function tagChipLabel(tag: MessageTag, auto: boolean): string {
    return auto ? `${TAG_LABELS[tag]} · auto` : TAG_LABELS[tag];
}
