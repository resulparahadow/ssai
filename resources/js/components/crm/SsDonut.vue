<script setup lang="ts">
import { computed } from 'vue';
import { ssColor } from '@/crm/nav';
import type { AttributionSlice } from '@/types/crm';

const props = defineProps<{
    slices: AttributionSlice[];
    centerValue: string;
    centerLabel: string;
}>();

const RADIUS = 42;
const CIRC = 2 * Math.PI * RADIUS;

const segments = computed(() => {
    let offset = 0;

    return props.slices.map((s) => {
        const len = (s.pct / 100) * CIRC;
        const seg = {
            color: ssColor(s.color),
            dash: `${len} ${CIRC - len}`,
            offset: -offset,
        };
        offset += len;

        return seg;
    });
});
</script>

<template>
    <div class="relative grid place-items-center">
        <svg viewBox="0 0 100 100" class="h-40 w-40 -rotate-90">
            <circle
                cx="50"
                cy="50"
                :r="RADIUS"
                fill="none"
                stroke="var(--ss-border)"
                stroke-width="11"
            />
            <circle
                v-for="(seg, i) in segments"
                :key="i"
                cx="50"
                cy="50"
                :r="RADIUS"
                fill="none"
                :stroke="seg.color"
                stroke-width="11"
                :stroke-dasharray="seg.dash"
                :stroke-dashoffset="seg.offset"
                stroke-linecap="butt"
            />
        </svg>
        <div class="absolute flex flex-col items-center">
            <span class="text-lg font-bold text-ss-text">{{
                centerValue
            }}</span>
            <span class="text-[11px] text-ss-text-3">{{ centerLabel }}</span>
        </div>
    </div>
</template>
