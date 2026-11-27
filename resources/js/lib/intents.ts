import type { IntentRef } from '@/types/crm';
import catalogue from './intent-catalogue.json' with { type: 'json' };

// The agent-intent catalogue is ONE json file shared with the server
// (App\Support\AgentIntents reads the same file), so the bar, the labels and the server's
// validation cannot drift apart.

/** Every catalogue key, in chip order. Pinned to intent-catalogue.json by intents-check.mjs. */
export const INTENT_KEYS = [
    'ppv',
    'repitch',
    'cta',
    'objection',
    'chitchat',
    'sexting',
    'tip_ask',
    'goodbye',
    'reoffer_mppv',
    'promise',
    'post_purchase',
    'post_tip',
    'free_picture',
    'breadcrumb',
    'hook',
    'follow_up',
    'aftersale',
] as const;

export type IntentKey = (typeof INTENT_KEYS)[number];

/** Intents the server handles (everything except the client-only PPV / Free picture). */
export type ServerIntentKey = Exclude<IntentKey, 'ppv' | 'free_picture'>;

export interface CatalogueOption {
    key: string;
    label: string;
    /** What this option makes SSAI write, shown under its label in the menu. */
    hint?: string;
}

export interface CatalogueIntent {
    key: IntentKey;
    label: string;
    group: 'bar' | 'more';
    /** false = handled by the client alone (PPV, Free picture): never posted as `intent`. */
    server: boolean;
    options: CatalogueOption[];
    /** What the button does, shown as its tooltip. */
    hint?: string;
}

/** The id of the media step built on the fly from picked vault media (no `script_steps` row). */
export const AD_HOC_STEP_ID = 0;

const INTENTS = catalogue.intents as CatalogueIntent[];

export function intentCatalogue(): CatalogueIntent[] {
    return INTENTS;
}

export function findIntent(key: IntentKey): CatalogueIntent | undefined {
    return INTENTS.find((i) => i.key === key);
}

export function isServerIntent(key: IntentKey): key is ServerIntentKey {
    return findIntent(key)?.server === true;
}

/** key + option equality. `undefined` (nothing owns the composer) equals only `undefined`. */
export function sameIntent(
    a: IntentRef | null | undefined,
    b: IntentRef | null | undefined,
): boolean {
    if (a === undefined || b === undefined) {
        return a === b;
    }

    if (a === null || b === null) {
        return a === b;
    }

    return a.key === b.key && a.option === b.option;
}

/** `Re-pitch`, or `Objection – Too expensive / discount` — the server's `{L}` string. */
export function intentRefLabel(r: IntentRef): string {
    const intent = findIntent(r.key);
    const base = intent?.label ?? r.key;

    if (r.option === null) {
        return base;
    }

    const opt = intent?.options.find((o) => o.key === r.option);

    return `${base} – ${opt?.label ?? r.option}`;
}

/** Which keys the bar shows inline and which sit under More, both in catalogue order. */
export function barLayout(items: CatalogueIntent[]): {
    bar: IntentKey[];
    more: IntentKey[];
} {
    return {
        bar: items.filter((i) => i.group === 'bar').map((i) => i.key),
        more: items.filter((i) => i.group === 'more').map((i) => i.key),
    };
}
