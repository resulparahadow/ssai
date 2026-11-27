import { router } from '@inertiajs/vue3';
import { computed, ref } from 'vue';

const STORAGE_KEY = 'ss_sidebar_collapsed';

/**
 * The CRM shell's sidebar state. Two modes, picked by the viewport:
 *
 * - **Desktop (≥ 1024px):** the sidebar is docked and the toggle COLLAPSES it to an icon rail
 *   (labels hidden, groups open as a flyout). The choice persists in localStorage.
 * - **Narrower:** there is no room to dock it, so it is an off-canvas DRAWER — hidden until the
 *   toggle opens it over the page, closed again by the backdrop, Esc, or any navigation. The
 *   desktop collapse preference is ignored here (a drawer is always full width).
 *
 * Module-scoped singletons, so the sidebar, the creator selector and the topbar share one state.
 */
const collapsedPref = ref<boolean>(
    typeof localStorage !== 'undefined' &&
        localStorage.getItem(STORAGE_KEY) === 'true',
);
const drawerOpen = ref(false);

// Plain matchMedia rather than vueuse's useMediaQuery: this lives at module scope, outside any
// component, where useMediaQuery's mounted check never passes. SSR has no window: it renders
// the desktop layout and the client corrects it on hydration.
const MOBILE_QUERY = '(max-width: 1023.98px)';
const isMobile = ref(false);

if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia(MOBILE_QUERY);
    isMobile.value = mq.matches;
    mq.addEventListener('change', (e) => {
        isMobile.value = e.matches;
        drawerOpen.value = false;
    });
}

/** The rail look applies only to the docked desktop sidebar. */
const collapsed = computed(() => collapsedPref.value && !isMobile.value);

let navigationHooked = false;

export function useCrmShell() {
    if (!navigationHooked && typeof window !== 'undefined') {
        navigationHooked = true;
        // A link in the drawer navigates away: put the drawer back so the new page is visible.
        router.on('navigate', () => {
            drawerOpen.value = false;
        });
    }

    function toggleSidebar(): void {
        if (isMobile.value) {
            drawerOpen.value = !drawerOpen.value;

            return;
        }

        collapsedPref.value = !collapsedPref.value;

        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, String(collapsedPref.value));
        }
    }

    function closeDrawer(): void {
        drawerOpen.value = false;
    }

    /** Whether the sidebar is currently showing its labels (for the toggle's aria state). */
    const expanded = computed(() =>
        isMobile.value ? drawerOpen.value : !collapsedPref.value,
    );

    return {
        collapsed,
        isMobile,
        drawerOpen,
        expanded,
        toggleSidebar,
        closeDrawer,
    };
}
