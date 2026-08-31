<script setup lang="ts">
import { TriangleAlert } from '@lucide/vue';

const props = defineProps<{ message: string }>();

// OnlyFans-side / upstream failures get an amber "external issue" badge; anything
// else is treated as a hard error (red). The backend prefixes upstream messages
// with "OnlyFans", so we key off that.
const isUpstream = props.message.toLowerCase().includes('onlyfans');
</script>

<template>
    <div
        class="flex items-start gap-2 rounded-lg border px-3 py-2 text-[12px]"
        :class="
            isUpstream
                ? 'border-ss-warn/30 bg-ss-warn/10 text-ss-warn'
                : 'border-ss-neg/30 bg-ss-neg/10 text-ss-neg'
        "
    >
        <TriangleAlert :size="14" class="mt-0.5 shrink-0" />
        <span>
            <span v-if="isUpstream" class="font-semibold">OnlyFans API: </span>
            {{ message }}
        </span>
    </div>
</template>
