/**
 * Pure decisions behind the PPV composer, kept out of the components so they can be checked
 * without a browser (the repo has no TS unit runner; `engine/`-style node checks cover them).
 */
import type { ComposerStep } from '@/types/crm';

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
 * The loaded step's id when Generate should write a CAPTION for it (legacy caption mode,
 * `sender: 'ppv'`), else null. Only a step with media is captioned; a Text step is a normal
 * reply that ignores the step (spec: "Generate with a step loaded").
 */
export function captionStepId(step: ComposerStep | null): number | null {
    return step !== null && step.media.length > 0 ? step.stepId : null;
}

/**
 * A draft belongs to the mode and step it was generated for. Both arguments are
 * `captionStepId()` values — at generate time, and now (null = a normal reply). Any change in
 * between means the draft must be dropped: a reply landing while a media step is loaded would
 * be sent as its caption, and a caption for step A must not ride on step B. A Text step reads
 * as null on both sides, so a reply generated with one loaded still applies.
 */
export function suggestionStillApplies(
    captionFor: number | null,
    currentStepId: number | null,
): boolean {
    return captionFor === currentStepId;
}

/**
 * Whether a Generate's result may still land, comparing the composer when it started with now.
 * `captionFor` is `captionStepId()`; `loads` counts steps loaded into this composer
 * (`ComposerState.stepLoads`). Loading ANY step replaces the pending draft — that is what its
 * confirm promises — so a draft still in flight from before the load is dropped, even when
 * both ends read as a normal reply (a Text step, or Text step A → B). A reply generated after
 * a Text step was loaded still applies.
 */
export function generationStillApplies(
    started: { captionFor: number | null; loads: number },
    now: { captionFor: number | null; loads: number },
): boolean {
    return (
        suggestionStillApplies(started.captionFor, now.captionFor) &&
        started.loads === now.loads
    );
}

/**
 * What a send adds for the loaded step: `scriptStepId` whenever a step is loaded (the ledger
 * row that drives per-fan progress), and its vault media + price only when it has media. A
 * Text step is sent as plain text.
 */
export function stepSendExtras(step: ComposerStep | null): {
    price?: number;
    scriptStepId?: number;
    mediaFiles?: string[];
} {
    if (step === null) {
        return {};
    }

    if (step.media.length === 0) {
        return { scriptStepId: step.stepId };
    }

    return {
        scriptStepId: step.stepId,
        price: step.price,
        mediaFiles: step.media.map((m) => m.id),
    };
}

/** Anything a loaded step would replace — including a generate still in flight. */
export function composerDirty(st: {
    draft: string;
    suggestion: string | null;
    gif: unknown;
    attachment: unknown;
    step: unknown;
    generating: boolean;
}): boolean {
    return (
        st.generating ||
        st.draft.trim() !== '' ||
        st.suggestion !== null ||
        st.gif !== null ||
        st.attachment !== null ||
        st.step !== null
    );
}

type PpvMediaType = 'photo' | 'video' | 'gif' | 'audio';

/** The loaded step's media for the price prompt: counts by type, non-zero keys only. */
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
