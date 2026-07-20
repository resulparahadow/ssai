import { computed, ref } from 'vue';
import type { SidebarCreator } from '@/types/crm';

/**
 * App-wide "creator context": the single creator (or "all creators") the whole CRM operates
 * within. Module-scoped singleton — mirrors `useCrmShell`'s localStorage-backed pattern — so
 * every page shares one selection. The localStorage value is the UI source of truth; a mirror
 * cookie (same key) carries the selection to the server for SSR-rendered pages. The cookie is
 * untrusted and re-validated server-side, so a plain value is fine.
 */

const STORAGE_KEY = 'ss_creator';

/** A creator id, the "all creators" sentinel, or uninitialized (null). */
type Selection = number | 'all' | null;

function readStored(): Selection {
    if (typeof localStorage === 'undefined') {
        return null;
    }

    const raw = localStorage.getItem(STORAGE_KEY);

    if (raw === null || raw === '') {
        return null;
    }

    if (raw === 'all') {
        return 'all';
    }

    const n = Number(raw);

    return Number.isInteger(n) && n > 0 ? n : null;
}

const selection = ref<Selection>(readStored());

function persist(value: Selection): void {
    if (typeof localStorage !== 'undefined') {
        if (value === null) {
            localStorage.removeItem(STORAGE_KEY);
        } else {
            localStorage.setItem(STORAGE_KEY, String(value));
        }
    }

    // Mirror to a cookie so server-rendered pages (Dashboard, AI Usage) learn the selection.
    // 1 year; Lax so it rides normal navigations. `ss_creator` is excluded from cookie
    // encryption (bootstrap/app.php) and re-validated server-side against the user's scope.
    if (typeof document !== 'undefined') {
        const v = value === null ? '' : String(value);
        document.cookie = `${STORAGE_KEY}=${encodeURIComponent(v)}; path=/; max-age=31536000; SameSite=Lax`;
    }
}

/**
 * Apply the default/validation rules (shared shape with the server resolver): a stored id must
 * still be in the user's scoped list; only managers/admins may hold "all"; the default is "all"
 * for managers/admins and the first assigned creator for chatters.
 */
function resolve(
    current: Selection,
    creators: SidebarCreator[],
    canSeeAll: boolean,
): Selection {
    if (!creators.length) {
        return canSeeAll ? 'all' : null;
    }

    if (current === 'all') {
        return canSeeAll ? 'all' : creators[0].id;
    }

    if (
        typeof current === 'number' &&
        creators.some((c) => c.id === current)
    ) {
        return current;
    }

    return canSeeAll ? 'all' : creators[0].id;
}

const selectedId = computed<number | null>(() =>
    typeof selection.value === 'number' ? selection.value : null,
);

const isAll = computed<boolean>(() => selection.value === 'all');

export function useCreatorContext() {
    /** Set the active creator (or "all") and persist to localStorage + cookie. */
    function select(value: number | 'all'): void {
        selection.value = value;
        persist(value);
    }

    /**
     * Self-repair the stored selection against the user's current scoped creators + role, and
     * (re)write the cookie so it exists on first paint. Call once app-wide (from the layout).
     */
    function reconcile(creators: SidebarCreator[], canSeeAll: boolean): void {
        const next = resolve(selection.value, creators, canSeeAll);

        if (next !== selection.value) {
            selection.value = next;
        }

        persist(next);
    }

    return { selection, selectedId, isAll, select, reconcile };
}
