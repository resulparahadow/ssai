/**
 * Pure decisions behind the PPV composer, kept out of the components so they can be checked
 * without a browser (the repo has no TS unit runner; `engine/`-style node checks cover them).
 */

/**
 * Parse a Price-to-View edit. An empty or unparseable edit REVERTS to the previous price —
 * never to 0. Otherwise `Number('')` is 0, `isValidPpvPrice(0)` is true, and a chatter who
 * cleared "$20" to retype it and clicked Send would give the paid set away for free. Free (0)
 * has to be typed on purpose. Out-of-rule numbers pass through: `isValidPpvPrice` disables Send
 * and the strip shows the rule, which is clearer than silently clamping.
 */
export function parsePpvPriceInput(
    raw: string | number,
    previous: number,
): number {
    const text = String(raw).replace(/[$,\s]/g, '');

    if (text === '') {
        return previous;
    }

    const n = Number(text);

    return Number.isFinite(n) ? n : previous;
}

/**
 * A draft belongs to the mode and set it was generated for. `captionFor` is the loaded set's id
 * at generate time (null = a normal reply); `currentSetId` is the loaded set now. Any change in
 * between means the draft must be dropped: a reply landing while a set is loaded would be sent
 * as the PPV caption, and a caption for set A must not ride on set B.
 */
export function suggestionStillApplies(
    captionFor: number | null,
    currentSetId: number | null,
): boolean {
    return captionFor === currentSetId;
}

/** Anything a loaded set would replace — including a generate still in flight. */
export function composerDirty(st: {
    draft: string;
    suggestion: string | null;
    gif: unknown;
    attachment: unknown;
    ppv: unknown;
    generating: boolean;
}): boolean {
    return (
        st.generating ||
        st.draft.trim() !== '' ||
        st.suggestion !== null ||
        st.gif !== null ||
        st.attachment !== null ||
        st.ppv !== null
    );
}

type PpvMediaType = 'photo' | 'video' | 'gif' | 'audio';

/** The loaded set's contents for the price prompt: counts by type, non-zero keys only. */
export function ppvMediaCounts(
    media: ReadonlyArray<{ type: PpvMediaType }>,
): Partial<Record<PpvMediaType, number>> {
    const out: Partial<Record<PpvMediaType, number>> = {};

    for (const m of media) {
        out[m.type] = (out[m.type] ?? 0) + 1;
    }

    return out;
}

const PLAN_WORDS: Record<string, string> = {
    rapport_beat: 'a rapport beat',
    qualifying_question: 'a qualifying question',
    aftercare: 'aftercare',
    goodbye_script: 'a goodbye',
    manager_flag: 'a manager flag',
};

/** SSAI's saved plan (legacy `next_planned_move`) in words, for the "not ready" warning. */
export function humanPlan(plan: string): string {
    return PLAN_WORDS[plan] ?? plan.replace(/_/g, ' ');
}

export type PpvPriceSuggestionLike =
    | { price: number; reason: string }
    | { error: string };

export type PriceSuggestionView =
    | { kind: 'pricing' | 'none' }
    | { kind: 'error'; error: string }
    | { kind: 'agree' | 'offer'; price: number; reason: string };

/**
 * What the PPV strip shows beside the price chip. A Generate in flight always reads "pricing" —
 * an older suggestion is for an older caption. The suggestion never changes the chip; only the
 * chatter's "Use" does.
 */
export function priceSuggestionView(
    s: PpvPriceSuggestionLike | null,
    generating: boolean,
    chipPrice: number,
): PriceSuggestionView {
    if (generating) {
        return { kind: 'pricing' };
    }

    if (s === null) {
        return { kind: 'none' };
    }

    if ('error' in s) {
        return { kind: 'error', error: s.error };
    }

    return {
        kind: s.price === chipPrice ? 'agree' : 'offer',
        price: s.price,
        reason: s.reason,
    };
}
