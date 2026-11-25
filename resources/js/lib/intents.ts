import type { IntentKey, IntentRef } from '@/types/crm';
import catalogue from './intent-catalogue.json' with { type: 'json' };

// The agent-intent catalogue is ONE json file shared with the server
// (App\Support\AgentIntents reads the same file), so the bar, the labels and the server's
// validation cannot drift apart.

export interface CatalogueOption {
    key: string;
    label: string;
}

export interface CatalogueIntent {
    key: IntentKey;
    label: string;
    group: 'bar' | 'more';
    /** false = handled by the client alone (PPV, Free picture): never posted as `intent`. */
    server: boolean;
    options: CatalogueOption[];
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

export function isServerIntent(key: IntentKey): boolean {
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
