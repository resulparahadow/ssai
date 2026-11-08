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
