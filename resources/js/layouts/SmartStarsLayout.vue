<script setup lang="ts">
import { router, usePage } from '@inertiajs/vue3';
import { computed, onMounted } from 'vue';
import SsSidebar from '@/components/crm/SsSidebar.vue';
import SsTopbar from '@/components/crm/SsTopbar.vue';
import { Toaster } from '@/components/ui/sonner';
import { useCreatorContext } from '@/composables/useCreatorContext';
import { useInboundNotifications } from '@/composables/useInboundNotifications';
import { can, NAV } from '@/crm/nav';
import type { User } from '@/types/auth';
import type { CreatorContext, SidebarCreator } from '@/types/crm';

const page = usePage();

const user = computed(() => page.props.auth.user as User);

const creators = computed<SidebarCreator[]>(
    () => (page.props.creators as SidebarCreator[]) ?? [],
);

// App-wide new-message notifier: subscribe to every assigned creator's live channel so
// inbound DMs toast + bing on any CRM page (gated by the user's notification prefs).
useInboundNotifications(creators.value);

// Repair the persisted creator context against this user's scoped creators + role, and write
// the mirror cookie, so every page (and SSR aggregate pages) share one valid selection.
const creatorContext = useCreatorContext();
creatorContext.reconcile(creators.value, can(user.value.role, 'manageTeam'));

// If the client's repaired selection differs from what the server resolved for THIS request
// (e.g. the cookie was cleared/expired while localStorage persisted), the server-rendered pages
// were scoped to the wrong creator. The cookie is corrected now — reload once so SSR data
// matches the selector. No-op in the common case (cookie + store agree), so no first-load cost.
onMounted(() => {
    const serverCtx = (page.props.creatorContext as CreatorContext | null) ?? null;

    if (serverCtx && creatorContext.selectedId.value !== serverCtx.selectedId) {
        router.reload();
    }
});

const title = computed(() => {
    const path = page.url.split('?')[0];

    if (path.startsWith('/settings')) {
        return 'Settings';
    }

    return NAV.find((n) => n.href === path)?.label ?? 'Overview';
});
</script>

<template>
    <div
        class="flex h-screen overflow-hidden bg-ss-bg font-ss text-ss-text antialiased"
    >
        <SsSidebar :role="user.role" />
        <div class="flex min-w-0 flex-1 flex-col">
            <SsTopbar :title="title" :user="user" />
            <main class="flex-1 overflow-y-auto p-5">
                <slot />
            </main>
        </div>
        <Toaster />
    </div>
</template>
