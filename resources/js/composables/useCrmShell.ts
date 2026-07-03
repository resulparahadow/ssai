import { ref } from 'vue';

const STORAGE_KEY = 'ss_sidebar_collapsed';

const collapsed = ref<boolean>(
    typeof localStorage !== 'undefined' &&
        localStorage.getItem(STORAGE_KEY) === 'true',
);

export function useCrmShell() {
    function toggleSidebar(): void {
        collapsed.value = !collapsed.value;

        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, String(collapsed.value));
        }
    }

    return { collapsed, toggleSidebar };
}
