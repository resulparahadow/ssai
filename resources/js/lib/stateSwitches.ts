import type {
    FanStateCounters,
    IntentKey,
    IntentLock,
    MessageTag,
    OfFanProfile,
    OfMessage,
    StateAutoRead,
    StateOverrides,
} from '@/types/crm';
import { effectiveTag } from './chatCounters.ts';

// §5b state switches + the rest of the §5c counters, client side. The server owns the values
// (customer_profiles.state_overrides, aich_chat_state counters) and applies them on generate;
// everything here only decides what the Fan-tab card, the intent bar and the PPV strip show.
// Spec: docs/superpowers/specs/2026-11-27-state-switches-design.md (§4, §5, §7, §10a).

/** The one support-mode refusal text — the server's 422 says exactly this too. */
export const SUPPORT_REASON = 'Support mode is on — no selling.';

/** The team's Master Script ladder: the default when the creator has none. */
export const DEFAULT_LADDER = [12, 21, 35, 49, 69, 100];

/** Mirror of App\Support\StateSwitches::SELLING_INTENTS — keep the two in step. */
const SELLING: readonly IntentKey[] = [
    'ppv',
    'repitch',
    'reoffer_mppv',
    'cta',
    'tip_ask',
    'promise',
    'free_picture',
];

export function sellingIntent(key: IntentKey): boolean {
    return SELLING.includes(key);
}

export type SwitchKey =
    | 'phase'
    | 'rls_beat'
    | 'fan_type'
    | 'lane'
    | 'posture'
    | 'trust'
    | 'promise'
    | 'language'
    | 'support';

export type SwitchValue = string | number | true;

export interface SwitchRow {
    key: SwitchKey;
    label: string;
    /** false = no Auto: the row's default (Lane normal, Support off) is stored as absent. */
    auto: boolean;
    /** Lane / Support: the default's label. Its value is '' — stored as absent, sent as null. */
    defaultLabel?: string;
    values: { value: SwitchValue; label: string }[];
}

/** Every switch, in spec §4 order (the AGENT-SET STATE block uses the same order). */
export const SWITCHES: SwitchRow[] = [
    {
        key: 'phase',
        label: 'Phase',
        auto: true,
        values: [
            { value: 'warm_up', label: 'Warm up' },
            { value: 'rapport', label: 'Rapport' },
            { value: 'link', label: 'Link' },
            { value: 'sale', label: 'Sale' },
            { value: 'loop', label: 'Loop' },
            { value: 'aftersale', label: 'Aftersale' },
        ],
    },
    {
        key: 'rls_beat',
        label: 'RLS beat',
        auto: true,
        values: Array.from({ length: 12 }, (_, i) => ({
            value: i + 1,
            label: `Beat ${i + 1}`,
        })),
    },
    {
        key: 'fan_type',
        label: 'Fan type',
        auto: true,
        values: [
            { value: 'new', label: 'New' },
            { value: 'returning', label: 'Returning' },
            { value: 'spender', label: 'Spender' },
        ],
    },
    {
        key: 'lane',
        label: 'Lane',
        auto: false,
        defaultLabel: 'Normal',
        values: [
            { value: '', label: 'Normal' },
            { value: 'sex_only', label: 'Sex-only' },
            { value: 'rude', label: 'Rude' },
        ],
    },
    {
        key: 'posture',
        label: 'Posture',
        auto: true,
        values: [
            { value: 'normal', label: 'Normal' },
            { value: 'frame_hold', label: 'Frame-hold' },
            { value: 'timewaster', label: 'Timewaster' },
        ],
    },
    {
        key: 'trust',
        label: 'Trust',
        auto: true,
        values: [1, 2, 3, 4, 5].map((n) => ({ value: n, label: `L${n}` })),
    },
    {
        key: 'promise',
        label: 'Promise',
        auto: true,
        values: [
            { value: 'not_asked', label: 'Not asked' },
            { value: 'asked', label: 'Asked' },
            { value: 'reinforced_1', label: 'Reinforced ×1' },
            { value: 'reinforced_2', label: 'Reinforced ×2' },
        ],
    },
    {
        key: 'language',
        label: 'Language',
        auto: true,
        values: [
            { value: 'es', label: 'ES' },
            { value: 'en', label: 'EN' },
        ],
    },
    {
        key: 'support',
        label: 'Support mode',
        auto: false,
        defaultLabel: 'Off',
        values: [
            { value: '', label: 'Off' },
            { value: true, label: 'On' },
        ],
    },
];

function row(key: SwitchKey): SwitchRow {
    return SWITCHES.find((r) => r.key === key)!;
}

function labelOf(key: SwitchKey, value: unknown): string | null {
    return row(key).values.find((v) => v.value === value)?.label ?? null;
}

const EMPTY_READ: StateAutoRead = {
    phase: null,
    fan_type: null,
    fan_type_from_trust: false,
    posture: null,
    promise: null,
    language: null,
};

/**
 * Give an older server's profile (no state keys) the contract's defaults, so nothing downstream
 * has to guard. Values the server sends pass through.
 */
export function normalizeProfile(raw: unknown): OfFanProfile {
    const p = (raw ?? {}) as Partial<OfFanProfile> & Record<string, unknown>;
    const counters = (p.counters ?? {}) as Partial<FanStateCounters>;
    const ladder = Array.isArray(p.price_ladder)
        ? p.price_ladder.filter(
              (n): n is number => typeof n === 'number' && n > 0,
          )
        : [];

    return {
        ...(p as OfFanProfile),
        locked_fields: p.locked_fields ?? [],
        state_overrides:
            p.state_overrides && typeof p.state_overrides === 'object'
                ? { ...p.state_overrides }
                : {},
        auto_read: { ...EMPTY_READ, ...(p.auto_read ?? {}) },
        counters: {
            objection_redirects: Number(counters.objection_redirects ?? 0) || 0,
            sex_only_pulls: Number(counters.sex_only_pulls ?? 0) || 0,
        },
        is_bilingual: p.is_bilingual === true,
        price_ladder: ladder.length > 0 ? ladder : [...DEFAULT_LADDER],
    };
}

export interface RowView {
    text: string;
    manual: boolean;
    disabled: boolean;
    hidden: boolean;
    reason?: string;
}

/** The current value of one switch row, as the card shows it. */
export function rowValue(key: SwitchKey, p: OfFanProfile): RowView {
    const view = (text: string, manual: boolean): RowView => ({
        text,
        manual,
        disabled: false,
        hidden: false,
    });
    const auto = (read: string | null) =>
        view(read ? `Auto · ${read}` : 'Auto', false);

    if (key === 'trust') {
        const locked = p.locked_fields.includes('trust_level');

        return locked
            ? view(`L${p.trust_level}`, true)
            : auto(`L${p.trust_level}`);
    }

    // The Fan-tab timewaster flag is the stronger, older human setting: it wins over the switch.
    if (key === 'posture' && p.is_timewaster) {
        return {
            text: 'Timewaster (flag on Fan tab)',
            manual: false,
            disabled: true,
            hidden: false,
            reason: 'The timewaster flag on the Fan tab wins. Turn it off to set the posture here.',
        };
    }

    const stored = p.state_overrides[key as keyof StateOverrides];
    const hidden = key === 'language' && !p.is_bilingual;

    if (stored !== undefined && stored !== null) {
        const v = view(labelOf(key, stored) ?? String(stored), true);

        return { ...v, hidden };
    }

    if (!row(key).auto) {
        return view(row(key).defaultLabel ?? '', false);
    }

    if (key === 'rls_beat') {
        return auto(null); // not tracked by SSAI
    }

    if (key === 'fan_type') {
        const read = labelOf('fan_type', p.auto_read.fan_type);

        return auto(
            read && p.auto_read.fan_type_from_trust
                ? `${read} (from trust L${p.trust_level})`
                : read,
        );
    }

    const read = labelOf(key, p.auto_read[key as keyof StateAutoRead]);

    return { ...auto(read), hidden };
}

/** The value a row's dropdown holds: the manual value, or '' for Auto / the default. */
export function rowSelected(key: SwitchKey, p: OfFanProfile): string {
    if (key === 'trust') {
        return p.locked_fields.includes('trust_level')
            ? String(p.trust_level)
            : '';
    }

    const v = p.state_overrides[key as keyof StateOverrides];

    return v === undefined || v === null ? '' : String(v);
}

/**
 * The PATCH body for one row change (one key per PATCH). `null` = Auto, and also Lane normal /
 * Support off, which are stored as absent. Trust reuses the existing pinned `trust_level`: a
 * value edits + pins it, Auto un-pins it.
 */
export function switchPatch(
    key: SwitchKey,
    value: SwitchValue | null,
): Record<string, unknown> {
    const empty = value === null || value === '';

    if (key === 'trust') {
        return empty
            ? { unlock: ['trust_level'] }
            : { trust_level: Number(value) };
    }

    let v: SwitchValue | null = empty ? null : value;

    if (key === 'rls_beat' && v !== null) {
        v = Number(v);
    }

    if (key === 'support' && v !== null) {
        v = true;
    }

    return { state_overrides: { [key]: v } };
}

/** Parse a dropdown's string back into a switch value ('' = Auto / default). */
export function parseSwitchValue(
    key: SwitchKey,
    raw: string,
): SwitchValue | null {
    if (raw === '') {
        return null;
    }

    if (key === 'rls_beat' || key === 'trust') {
        return Number(raw);
    }

    if (key === 'support') {
        return true;
    }

    return raw;
}

/** The smallest ladder price above `lastBought` (the first rung when nothing was bought), or null
 *  past the top. The ladder may arrive unsorted. */
export function nextRung(
    ladder: number[],
    lastBought: number | null,
): number | null {
    const sorted = [...ladder].sort((a, b) => a - b);

    if (sorted.length === 0) {
        return null;
    }

    if (lastBought === null) {
        return sorted[0];
    }

    return sorted.find((p) => p > lastBought) ?? null;
}

const time = (m: OfMessage): number => {
    const t = m.time === null ? NaN : Date.parse(m.time);

    return Number.isNaN(t) ? 0 : t;
};

/** The newest OPENED chat PPV's price in the loaded thread — the last rung he bought. Mass PPVs
 *  and free previews are not rungs; optimistic / failed bubbles never reached him. */
export function lastRungBought(
    messages: OfMessage[],
    tags: Record<string, MessageTag>,
): number | null {
    const bought = messages
        .filter(
            (m) =>
                !m.pending &&
                !m.failed &&
                m.isOpened &&
                effectiveTag(m, tags) === 'chat_ppv',
        )
        .sort((a, b) => time(a) - time(b));

    return bought.length > 0 ? bought[bought.length - 1].price : null;
}

/** FreePicture lights at this many objection redirects; PPV at this many sex-only pulls. */
export const OBJECTIONS_LIT = 3;
export const SEX_ONLY_LIT = 2;

export interface StateChipState {
    support: boolean;
    objections: number;
    sexOnly: number;
}

export interface StateChipLock extends IntentLock {
    /** Why a lit chip is lit (its title); null when not lit by state. */
    hint: string | null;
}

/**
 * Layer the fan's state over a chip's own lock. Support mode comes first and its reason wins;
 * then FreePicture lights at 3 objections and PPV (only when unlocked) at 2 sex-only pulls.
 */
export function stateChipLock(
    key: IntentKey,
    base: IntentLock,
    s: StateChipState,
): StateChipLock {
    if (s.support && sellingIntent(key)) {
        return {
            enabled: false,
            lit: false,
            reason: SUPPORT_REASON,
            hint: null,
        };
    }

    if (
        key === 'free_picture' &&
        base.enabled &&
        s.objections >= OBJECTIONS_LIT
    ) {
        return {
            ...base,
            lit: true,
            hint: `He's objected ${s.objections} times — a free teaser can help`,
        };
    }

    if (key === 'ppv' && base.enabled && s.sexOnly >= SEX_ONLY_LIT) {
        return {
            ...base,
            lit: true,
            hint: 'He keeps pushing for sexual content — time to sell',
        };
    }

    return { ...base, hint: null };
}

/** Support mode keeps a PRICED media step out of the composer (free media and Text steps load);
 *  the server refuses the priced send too. Returns the refusal, or null to load. */
export function stepBlockedBySupport(
    step: { media: unknown[]; price: number },
    support: boolean,
): string | null {
    return support && step.media.length > 0 && step.price > 0
        ? SUPPORT_REASON
        : null;
}

/** Whole-dollar prices read as `$35`, others as `$12.50`. */
export const dollars = (n: number) =>
    Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;

/** The counters-line additions; each part only when it says something. */
export function stateSummaryParts(s: {
    lastRung: number | null;
    nextRung: number | null;
    objections: number;
    sexOnly: number;
}): string[] {
    const parts: string[] = [];

    if (s.lastRung !== null) {
        parts.push(
            s.nextRung !== null
                ? `last rung ${dollars(s.lastRung)} → next ${dollars(s.nextRung)}`
                : `last rung ${dollars(s.lastRung)} · top of ladder`,
        );
    }

    if (s.objections > 0) {
        parts.push(`objections ${s.objections}`);
    }

    if (s.sexOnly > 0) {
        parts.push(`sex-only ${s.sexOnly}`);
    }

    return parts;
}

/** The ladder price to offer beside a loaded PPV step: only for a priced step whose price
 *  differs. A suggestion only — "Use" is the one way it reaches the price. */
export function ladderOffer(next: number | null, price: number): number | null {
    return next !== null && price > 0 && next !== price ? next : null;
}

/** What a generate response carries for the fan's state (absent on an older server). */
export interface LiveState {
    counters?: { objectionRedirects: number; sexOnlyPulls: number } | null;
    rlsBeat?: number | null;
}

/**
 * Fold a generate response's counters + effective RLS beat into the stored profile. A generate
 * runs 25-45s: `beatAtStart` is the stored beat when it began, and a beat the chatter changed
 * meanwhile wins over the response's older view. A null / absent beat changes nothing (the
 * contract doesn't say null means "reset", and deleting would be the destructive reading).
 */
export function applyLiveState(
    p: OfFanProfile,
    live: LiveState,
    beatAtStart: number | undefined,
): void {
    if (live.counters) {
        p.counters = {
            objection_redirects: live.counters.objectionRedirects ?? 0,
            sex_only_pulls: live.counters.sexOnlyPulls ?? 0,
        };
    }

    if (
        typeof live.rlsBeat === 'number' &&
        p.state_overrides.rls_beat === beatAtStart
    ) {
        p.state_overrides = { ...p.state_overrides, rls_beat: live.rlsBeat };
    }
}

/** The manual Fan type, for the client's 10-message PPV rule (null = Auto). */
export function fanTypeOverride(
    p: OfFanProfile | null | undefined,
): StateOverrides['fan_type'] | null {
    return p?.state_overrides.fan_type ?? null;
}

export function supportOn(p: OfFanProfile | null | undefined): boolean {
    return p?.state_overrides.support === true;
}

/** What the composer (intent bar + PPV strip) needs from the open fan's state. */
export interface ComposerFanState extends StateChipState {
    parts: string[]; // counters-line additions
    nextRung: number | null; // the ladder's next price (a suggestion only)
}

export const EMPTY_FAN_STATE: ComposerFanState = {
    support: false,
    objections: 0,
    sexOnly: 0,
    nextRung: null,
    parts: [],
};

/** Build the composer's view of the fan's state. No profile loaded yet = all off, default
 *  ladder (the server still enforces support mode on its own). */
export function composerFanState(
    p: OfFanProfile | null | undefined,
    messages: OfMessage[],
    tags: Record<string, MessageTag>,
): ComposerFanState {
    const last = lastRungBought(messages, tags);
    const next = nextRung(p?.price_ladder ?? DEFAULT_LADDER, last);
    const objections = p?.counters.objection_redirects ?? 0;
    const sexOnly = p?.counters.sex_only_pulls ?? 0;

    return {
        support: supportOn(p),
        objections,
        sexOnly,
        nextRung: next,
        parts: stateSummaryParts({
            lastRung: last,
            nextRung: next,
            objections,
            sexOnly,
        }),
    };
}
