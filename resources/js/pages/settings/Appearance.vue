<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import AppearanceTabs from '@/components/AppearanceTabs.vue';
</script>

<template>
    <Head title="Appearance settings" />

    <h1 class="sr-only">Appearance settings</h1>

    <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
        <div class="mb-4">
            <h3 class="text-sm font-semibold text-ss-text">
                Appearance settings
            </h3>
            <p class="text-sm text-ss-text-2">
                Update the appearance settings for your account
            </p>
        </div>
        <AppearanceTabs />
    </div>
</template>
