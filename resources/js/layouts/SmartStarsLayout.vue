<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import SsSidebar from '@/components/crm/SsSidebar.vue';
import SsTopbar from '@/components/crm/SsTopbar.vue';
import { useCrmShell } from '@/composables/useCrmShell';
import { NAV } from '@/crm/nav';
import type { Role, User } from '@/types/auth';

const page = usePage();
const { previewRole } = useCrmShell();

const user = computed(() => page.props.auth.user as User);
const effectiveRole = computed<Role>(
    () => previewRole.value ?? user.value.role,
);

const title = computed(() => {
    const path = page.url.split('?')[0];

    return NAV.find((n) => n.href === path)?.label ?? 'Overview';
});
</script>

<template>
    <div
        class="flex h-screen overflow-hidden bg-ss-bg font-ss text-ss-text antialiased"
    >
        <SsSidebar :role="effectiveRole" />
        <div class="flex min-w-0 flex-1 flex-col">
            <SsTopbar
                :title="title"
                :user="user"
                :effective-role="effectiveRole"
            />
            <main class="flex-1 overflow-y-auto p-5">
                <slot />
            </main>
        </div>
    </div>
</template>
