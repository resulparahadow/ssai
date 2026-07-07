<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ values: number[]; color?: string }>();

const stroke = computed(() => props.color ?? 'var(--ss-accent)');

const points = computed(() => {
    const v = props.values?.length ? props.values : [0, 0];
    const max = Math.max(...v);
    const min = Math.min(...v);
    const range = max - min || 1;
    const n = v.length;

    return v
        .map((y, i) => {
            const x = n === 1 ? 0 : (i / (n - 1)) * 100;
            const yy = 96 - ((y - min) / range) * 92;

            return `${x.toFixed(1)},${yy.toFixed(1)}`;
        })
        .join(' ');
});
</script>

<template>
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" class="h-8 w-full">
        <polyline
            :points="points"
            fill="none"
            :stroke="stroke"
            stroke-width="3"
            vector-effect="non-scaling-stroke"
            stroke-linecap="round"
            stroke-linejoin="round"
        />
    </svg>
</template>
