<script setup lang="ts">
import { Check, DollarSign } from '@lucide/vue';
import { computed } from 'vue';
import { usd } from '@/lib/money';
import { messagePayInfo } from '@/lib/onlyfans';
import type { OfMessage } from '@/types/crm';

const props = defineProps<{ message: OfMessage }>();

// Money state of this message: a fan tip, a paid PPV, an unpaid PPV, or nothing.
const pay = computed(() => messagePayInfo(props.message));
const paid = computed(() => pay.value?.paid ?? false);

const label = computed(() => {
    const p = pay.value;

    if (!p) {
        return '';
    }

    if (p.kind === 'tip') {
        return `${usd(p.price)} · Tip`;
    }

    return `${usd(p.price)} · ${p.paid ? 'Paid' : 'Unpaid'}`;
});
</script>

<template>
    <!-- green = paid / tip received, amber = unpaid PPV -->
    <span
        v-if="pay"
        class="mt-1.5 inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
        :class="paid ? 'bg-ss-pos/15 text-ss-pos' : 'bg-ss-warn/15 text-ss-warn'"
    >
        <DollarSign :size="11" />
        {{ label }}
        <Check v-if="paid" :size="11" />
    </span>
</template>
