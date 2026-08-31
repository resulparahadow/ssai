import { reactive, watch } from 'vue';

// Per-user spend-bracket thresholds for the Spender-Brackets analytics page. Pure UI
// prefs (like the notification prefs / theme), so they live in localStorage — the app
// persists nothing server-side. Module-scoped + reactive so every consumer shares one
// state. Values are kept as a positive, de-duplicated, ascending integer list.

const STORAGE_KEY = 'ss:spender-thresholds';

export const DEFAULT_THRESHOLDS = [200, 500, 1000, 2000, 10000];

/** Coerce arbitrary input into a valid ascending list of positive integers. */
function sanitize(list: unknown): number[] {
    if (!Array.isArray(list)) {
        return [...DEFAULT_THRESHOLDS];
    }

    const nums = list
        .map((n) => Math.floor(Number(n)))
        .filter((n) => Number.isFinite(n) && n > 0);

    const uniqueAscending = [...new Set(nums)].sort((a, b) => a - b);

    return uniqueAscending.length ? uniqueAscending : [...DEFAULT_THRESHOLDS];
}

function load(): number[] {
    if (typeof localStorage === 'undefined') {
        return [...DEFAULT_THRESHOLDS];
    }

    try {
        const raw = localStorage.getItem(STORAGE_KEY);

        return raw ? sanitize(JSON.parse(raw)) : [...DEFAULT_THRESHOLDS];
    } catch {
        return [...DEFAULT_THRESHOLDS];
    }
}

export const thresholdStore = reactive<{ values: number[] }>({
    values: load(),
});

/** Replace the thresholds (sanitized: positive, unique, ascending). */
export function setThresholds(list: number[]): void {
    thresholdStore.values = sanitize(list);
}

export function resetThresholds(): void {
    thresholdStore.values = [...DEFAULT_THRESHOLDS];
}

if (typeof window !== 'undefined') {
    watch(
        () => thresholdStore.values,
        (v) => {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
            } catch {
                // localStorage may be unavailable (private mode / quota) — thresholds just won't persist.
            }
        },
        { deep: true },
    );
}
