import { ref } from 'vue';
import type { Role } from '@/types/auth';

const STORAGE_KEY = 'ss_sidebar_collapsed';

const collapsed = ref<boolean>(
    typeof localStorage !== 'undefined' &&
        localStorage.getItem(STORAGE_KEY) === 'true',
);

// Admin-only "view as" preview of another role. Null = use the real role.
// This affects nav visibility only; server data stays scoped to the real role.
const previewRole = ref<Role | null>(null);

export function useCrmShell() {
    function toggleSidebar(): void {
        collapsed.value = !collapsed.value;

        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(STORAGE_KEY, String(collapsed.value));
        }
    }

    function setPreviewRole(role: Role | null): void {
        previewRole.value = role;
    }

    return { collapsed, previewRole, toggleSidebar, setPreviewRole };
}
