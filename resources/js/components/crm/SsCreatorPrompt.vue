<script setup lang="ts">
import { ArrowUpLeft } from '@lucide/vue';
import type { Component } from 'vue';

/**
 * Centered empty-state shown on pages that operate on a single creator (Conversations, Media
 * Vault, …) when the app-wide context is "All creators" or none is selected. Presentational
 * only — the caller passes the icon/copy and a height class (h-full / flex-1) that falls through
 * to the root.
 */
defineProps<{
    icon: Component;
    title: string;
    description: string;
    /** Optional pointer to the sidebar selector (renders an ↖ chip). */
    hint?: string;
}>();
</script>

<template>
    <div class="grid place-items-center px-6 font-ss">
        <div class="flex max-w-sm flex-col items-center text-center">
            <div
                class="grid h-14 w-14 place-items-center rounded-2xl bg-ss-accent-soft text-ss-accent-text"
            >
                <component :is="icon" :size="26" />
            </div>
            <h2 class="mt-4 text-[15px] font-semibold text-ss-text">
                {{ title }}
            </h2>
            <p class="mt-1.5 text-[13px] leading-relaxed text-ss-text-2">
                {{ description }}
            </p>
            <div
                v-if="hint"
                class="mt-4 flex items-center gap-1.5 rounded-lg border border-ss-border bg-ss-surface-2 px-3 py-1.5 text-[12px] font-medium text-ss-text-2"
            >
                <ArrowUpLeft :size="14" class="text-ss-accent-text" />
                {{ hint }}
            </div>
        </div>
    </div>
</template>
