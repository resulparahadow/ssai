'use strict';
/**
 * §5b state switches: the chat agent's lasting corrections of SSAI's read of a fan.
 *
 * Laravel loads the fan's manual switches server-side (customer_profiles.state_overrides) and
 * sends them as `input.stateOverrides`, legacy-shaped, ONLY when at least one is manual. Legacy
 * stays untouched; the engine makes SSAI follow them two ways:
 *
 * 1. A standing note. Every strategy and generator call (retries, fallback and the Mistral route
 *    too) ends with a fixed "AGENT-SET STATE" block listing each manual switch with its rule. It
 *    is NOT the AGENT OVERRIDE channel (that one is one-turn and authoritative, and belongs to
 *    intent buttons and the typed note): it says "treat as true", so walls and hard rules still
 *    win. runGenerate installs it as the INNERMOST wrapper, so it lands after everything else —
 *    the follow-up note included.
 * 2. Hooks where legacy keeps the state itself, so legacy's own logic follows:
 *    - posture / customer tier: legacy calls `computePosture` / `computeCustomerTier` by global
 *      name inside `recomputePosture`, so a per-VM wrapper (eng.set re-binds the global) forces
 *      them. The Fan-tab timewaster flag (`_profile.is_timewaster === true`) wins over both: the
 *      wrappers then return legacy's own result unchanged.
 *    - promise: runGenerate pins `_promiseStatus` before the run and re-applies it after
 *      (pinPromise / repinTelemetry), and `detectPromiseCommitment` is held off so legacy's
 *      in-turn in_progress → verbally_committed flip can't fire.
 *
 * No `stateOverrides` (or an empty one) → no note, no hook: the run is byte-identical to before.
 * See docs/superpowers/specs/2026-11-27-state-switches-design.md §4, §10a.
 */

const HEADER =
    'AGENT-SET STATE (set by the chat agent; treat as true until they change it):';

const PHASES = {
    warm_up: [
        'Warm up',
        'short, light, friendly replies; no selling, no personal questions yet; get him talking',
    ],
    rapport: [
        'Rapport',
        'work in the rapport phase (chit chat / rapport): build the connection; do not sell yet',
    ],
    link: [
        'Link',
        'work in the link phase (CTA 1 / promise ritual): lead toward the first CTA or the promise',
    ],
    sale: [
        'Sale',
        'work in the sale phase (sell / CTA 2 / send content): this is the time to move to paid content',
    ],
    loop: [
        'Loop',
        'work in the loop phase (warm-up between rungs): warm him back up before the next offer on the ladder',
    ],
    aftersale: [
        'Aftersale',
        'work in the aftersale phase (aftercare): warm and caring, no selling',
    ],
};

const LANES = {
    sex_only: [
        'Sex-only',
        'keep it sexual and short, move to paid content sooner, skip deep rapport, never give explicit content free',
    ],
    rude: [
        'Rude',
        "stay calm and short; state one clear boundary in plain words (how you will not be talked to); no selling while he's rude; don't argue, defend yourself or chase",
    ],
};

const POSTURES = {
    WARM_BUILD: ['Normal', 'warm build; no extra pressure'],
    PRESSURE: [
        'Frame-hold',
        'PART 5 frame protection: tease without confirming, withhold without rejecting; validation after spend',
    ],
    TIMEWASTER: [
        'Timewaster',
        'treat him as a timewaster: minimal free effort, no chasing; only paid content moves things forward',
    ],
};

const PROMISES = {
    not_started: ['Not asked', 'the promise has not been asked yet'],
    in_progress: [
        'Asked',
        'the promise has been asked; do not re-ask it from scratch',
    ],
    reinforcement: [
        'Reinforced ×1',
        'he made the promise and it was reinforced once; a light callback at most',
    ],
    assumed: ['Reinforced ×2', 'the promise is settled; treat it as given'],
};

const LANGUAGES = {
    es: ['ES', 'reply only in Spanish'],
    en: ['EN', 'reply only in English'],
};

const isEmpty = (o) =>
    !o || typeof o !== 'object' || Object.keys(o).length === 0;

/**
 * The note: the verbatim header plus one line per manual switch, in spec §4 order
 * (Phase, RLS beat, Fan type, Lane, Posture, Promise state, Language, Support mode). '' when none.
 */
function stateBlock(o) {
    if (isEmpty(o)) return '';
    const lines = [];
    const line = (name, value, rule) =>
        lines.push(`- ${name}: ${value} — ${rule}`);

    if (PHASES[o.phase]) line('Phase', ...PHASES[o.phase]);
    if (Number.isInteger(o.rlsBeat))
        line(
            'RLS beat',
            String(o.rlsBeat),
            `write the message for beat ${o.rlsBeat} of the RLS script (PART 14)`,
        );
    if (o.fanTier === 'new') line('Fan type', 'New', 'treat him as a new fan');
    else if (o.fanTier === 'old' && o.spender)
        line(
            'Fan type',
            'Spender',
            'he has bought before; treat him as a buying customer',
        );
    else if (o.fanTier === 'old')
        line(
            'Fan type',
            'Returning',
            'he has been here before; treat him as a returning fan, not a stranger',
        );
    if (LANES[o.lane]) line('Lane', ...LANES[o.lane]);
    if (POSTURES[o.posture]) line('Posture', ...POSTURES[o.posture]);
    if (PROMISES[o.promiseStatus])
        line('Promise state', ...PROMISES[o.promiseStatus]);
    if (LANGUAGES[o.language]) line('Language', ...LANGUAGES[o.language]);
    if (o.support === true)
        line(
            'Support mode',
            'On',
            'SUPPORT MODE: no selling at all — no CTA, PPV, tip ask or promise; help, reassure, be kind',
        );

    return lines.length ? `\n\n${HEADER}\n${lines.join('\n')}` : '';
}

/** Appends `note` to a prompt that is a string or an array of content blocks. */
function append(prompt, note) {
    if (Array.isArray(prompt)) return [...prompt, { type: 'text', text: note }];
    return String(prompt) + note;
}

/** Wraps the transports so strategy* / generator* calls end with the block; others pass through. */
function withStateNote({ callApi, callMistral }, block) {
    if (!block) return { callApi, callMistral };
    return {
        callApi: (system, user, maxTokens, forceModel, callType, ...rest) => {
            const tag = String(callType || '');
            const hit =
                tag.startsWith('strategy') || tag.startsWith('generator');
            return callApi(
                system,
                hit ? append(user, block) : user,
                maxTokens,
                forceModel,
                callType,
                ...rest,
            );
        },
        callMistral: (persona, strategy, conversation, ...rest) =>
            callMistral(
                persona,
                strategy,
                append(conversation, block),
                ...rest,
            ),
    };
}

/** True when the Fan-tab timewaster flag is on — the stronger, older human setting wins. */
const flagged = (profile) => !!profile && profile.is_timewaster === true;

/**
 * Per-VM function hooks. Each generation runs in its own VM context (createEngine), so these
 * re-bindings never leak into another chat's run.
 */
function installHooks(eng, o) {
    if (isEmpty(o)) return;
    if (o.posture) {
        const legacyPosture = eng.get('computePosture');
        // A forced posture also beats legacy's sexting posture freeze (a human setting wins).
        eng.set('computePosture', function (s, profile) {
            const own = legacyPosture(s, profile);
            return flagged(profile) ? own : o.posture;
        });
    }
    if (o.fanTier) {
        const legacyTier = eng.get('computeCustomerTier');
        eng.set('computeCustomerTier', function (s, profile) {
            const own = legacyTier(s, profile);
            return flagged(profile) ? own : o.fanTier;
        });
    }
    if (o.promiseStatus) {
        // Legacy flips in_progress → verbally_committed on a commitment token before the prompts
        // are built; a pinned promise holds still.
        eng.set('detectPromiseCommitment', function () {
            return null;
        });
    }
}

/** Pins the promise on the session before the run (incl. legacy's one-shot returning-spender upgrade). */
function pinPromise(session, o) {
    if (isEmpty(o) || !o.promiseStatus) return;
    session._promiseStatus = o.promiseStatus;
    session._returningSpenderPromiseInit = true;
}

/** Re-applies the pinned promise to the returned telemetry, so legacy's in-turn advance can't leak. */
function repinTelemetry(telemetry, o) {
    if (!isEmpty(o) && o.promiseStatus)
        telemetry.promiseStatus = o.promiseStatus;
    return telemetry;
}

module.exports = {
    HEADER,
    stateBlock,
    withStateNote,
    installHooks,
    pinPromise,
    repinTelemetry,
};
