<script setup lang="ts">
import type { OfFan } from '@/types/crm';

defineProps<{ fan: OfFan | null }>();
</script>

<template>
    <div class="flex flex-1 flex-col overflow-hidden">
        <div class="border-b border-ss-border p-4">
            <div class="flex items-center gap-3">
                <span class="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-ss-surface-2 text-sm font-semibold text-ss-text-2">
                    <img v-if="fan?.avatar" :src="fan.avatar" :alt="fan.name ?? ''" class="h-full w-full object-cover" />
                    <template v-else>{{ (fan?.name ?? '?').slice(0, 2).toUpperCase() }}</template>
                </span>
                <div class="min-w-0">
                    <div class="truncate text-sm font-semibold text-ss-text">{{ fan?.name ?? '—' }}</div>
                    <div class="truncate text-[12px] text-ss-text-3">@{{ fan?.username ?? '—' }}</div>
                </div>
            </div>
        </div>

        <div class="flex-1 space-y-3 overflow-y-auto p-4 text-[13px]">
            <p class="text-[11px] text-ss-text-3">Live from OnlyFans</p>
            <div v-for="row in [
                { label: 'Location', value: fan?.location },
                { label: 'Subscribe price', value: fan?.subscribePrice != null ? '$' + fan.subscribePrice : null },
                { label: 'Last seen', value: fan?.lastSeen },
            ]" :key="row.label" class="flex items-center justify-between gap-2">
                <span class="text-ss-text-3">{{ row.label }}</span>
                <span class="truncate font-medium text-ss-text">{{ row.value ?? '—' }}</span>
            </div>

            <div v-if="fan?.about">
                <div class="mb-1 text-[11px] font-semibold text-ss-text-3">About</div>
                <p class="rounded-lg bg-ss-bg-2 p-2.5 text-[13px] text-ss-text-2">{{ fan.about }}</p>
            </div>

            <p v-if="!fan" class="text-ss-text-3">Open a conversation to load fan details.</p>
        </div>
    </div>
</template>
