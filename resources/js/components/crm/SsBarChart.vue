<script setup lang="ts">
import { computed } from 'vue';
import type { SeriesPoint } from '@/types/crm';

const props = defineProps<{ points: SeriesPoint[] }>();

const max = computed(() => Math.max(1, ...props.points.map((p) => p.value)));

// Keep axis labels readable when there are many buckets (e.g. 30 days).
const labelEvery = computed(() =>
    props.points.length > 12 ? Math.ceil(props.points.length / 8) : 1,
);

function money(n: number): string {
    return '$' + Math.round(n).toLocaleString();
}
</script>

<template>
    <div class="flex h-48 items-end gap-1">
        <div
            v-for="(p, i) in points"
            :key="i"
            class="group flex h-full flex-1 flex-col items-center justify-end gap-1"
        >
            <div
                class="w-full rounded-t bg-ss-accent/80 transition-colors group-hover:bg-ss-accent"
                :style="{ height: Math.max(2, (p.value / max) * 100) + '%' }"
                :title="`${p.label} · ${money(p.value)}`"
            />
            <span
                v-if="i % labelEvery === 0"
                class="font-ss-mono text-[9px] whitespace-nowrap text-ss-text-3"
            >
                {{ p.label }}
            </span>
            <span v-else class="text-[9px]">&nbsp;</span>
        </div>
    </div>
</template>
