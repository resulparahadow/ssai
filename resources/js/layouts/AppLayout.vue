<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';
import { useInboundNotifications } from '@/composables/useInboundNotifications';
import AppLayout from '@/layouts/app/AppSidebarLayout.vue';
import type { BreadcrumbItem } from '@/types';
import type { SidebarCreator } from '@/types/crm';

const { breadcrumbs = [] } = defineProps<{
    breadcrumbs?: BreadcrumbItem[];
}>();

// Keep the new-message notifier running on non-CRM pages too (settings, etc.).
useInboundNotifications((usePage().props.creators as SidebarCreator[]) ?? []);
</script>

<template>
    <AppLayout :breadcrumbs="breadcrumbs">
        <slot />
    </AppLayout>
</template>
