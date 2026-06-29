import { reactive, watch } from 'vue';

// Client-side notification preferences for live OnlyFans inbound messages. Like the
// theme (useAppearance), these are pure UI prefs so they live in localStorage — the
// app persists nothing about conversations. The store is module-scoped + reactive, so
// the Settings page, the Conversations quick-menu, and the notifier all share one state.

export interface NotificationPrefs {
    /** Show an in-app toast when a new fan message arrives. */
    showToast: boolean;
    /** Play a short "bing" when a new fan message arrives. */
    playSound: boolean;
    /** Bing volume, 0–1. */
    volume: number;
}

const STORAGE_KEY = 'ss:notification-prefs';

const DEFAULTS: NotificationPrefs = {
    showToast: true,
    playSound: true,
    volume: 0.5,
};

function load(): NotificationPrefs {
    if (typeof localStorage === 'undefined') {
        return { ...DEFAULTS };
    }

    try {
        const raw = localStorage.getItem(STORAGE_KEY);

        return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<NotificationPrefs>) } : { ...DEFAULTS };
    } catch {
        return { ...DEFAULTS };
    }
}

export const notificationPrefs = reactive<NotificationPrefs>(load());

if (typeof window !== 'undefined') {
    watch(
        notificationPrefs,
        (v) => {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
            } catch {
                // localStorage may be unavailable (private mode / quota) — prefs just won't persist.
            }
        },
        { deep: true },
    );
}
