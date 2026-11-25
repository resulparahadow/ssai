<script setup lang="ts">
import { computed } from 'vue';
import { intentLabel, intentLock, ppvChipLock } from '@/lib/chatCounters';
import { usd } from '@/lib/money';
import type { ChatCounters, IntentKey } from '@/types/crm';

const props = defineProps<{
    counters: ChatCounters;
    busy: boolean;
    // A send is in flight for this chat: its pending bubble rides in the generate payload, so a
    // Re-pitch could target the PPV still on its way out. Chips wait for the send to settle.
    sending: boolean;
    mediaLoaded: boolean; // a PPV/media step is loaded in the composer
    activeIntent: IntentKey | null; // what the pending suggestion was generated for
    generatingIntent: IntentKey | null; // the intent being generated right now
}>();

const emit = defineEmits<{ fire: [key: IntentKey] }>();

// Slice 1: PPV · Re-pitch · Re-offer MPPV, in that order.
const KEYS: IntentKey[] = ['ppv', 'repitch', 'reoffer_mppv'];

const chips = computed(() =>
    KEYS.map((key) => {
        const lock =
            key === 'ppv'
                ? ppvChipLock(props.counters, props.mediaLoaded)
                : intentLock(key, props.counters);
        let reason = lock.reason;
        let enabled = lock.enabled;

        // A loaded PPV is what the chatter is about to send; a re-pitch/re-offer would fight it.
        if (key !== 'ppv' && props.mediaLoaded) {
            enabled = false;
            reason = 'Remove the loaded PPV first';
        }

        if (enabled && props.sending) {
            enabled = false;
            reason = 'Sending…';
        }

        return {
            key,
            label: intentLabel(key),
            enabled: enabled && !props.busy,
            lit: key !== 'ppv' && lock.lit && enabled,
            reason: enabled ? null : reason,
            active: props.activeIntent === key && !props.busy,
            spinning: props.busy && props.generatingIntent === key,
        };
    }),
);

const summary = computed(() => {
    const c = props.counters;
    const parts = [`${c.total} msgs`];

    if (c.sinceLastPpv !== null) {
        parts.push(`${c.sinceLastPpv} since PPV`);
    }

    if (c.unpaidPpv !== null) {
        parts.push(`unpaid ${usd(c.unpaidPpv.price)}`);
        parts.push(`${c.unpaidPpv.since} ago`);
    }

    return parts.join(' · ');
});
</script>

<template>
    <div class="flex flex-wrap items-center gap-1.5" data-testid="intent-bar">
        <button
            v-for="c in chips"
            :key="c.key"
            type="button"
            :disabled="!c.enabled"
            :title="c.reason ?? undefined"
            :aria-describedby="c.reason ? `intent-why-${c.key}` : undefined"
            :data-testid="`intent-${c.key}`"
            class="inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45"
            :class="
                c.active
                    ? 'border-ss-accent bg-ss-accent text-white'
                    : c.lit
                      ? 'border-ss-accent/60 bg-ss-accent-soft text-ss-accent-text hover:bg-ss-accent/20'
                      : 'border-ss-border bg-ss-surface text-ss-text-2 hover:bg-ss-surface-2'
            "
            @click="emit('fire', c.key)"
        >
            <span
                v-if="c.spinning"
                class="mr-1.5 h-3 w-3 animate-spin rounded-full border-2 border-ss-accent/30 border-t-ss-accent"
                data-testid="intent-spinner"
                aria-hidden="true"
            />
            {{ c.label }}
            <span v-if="c.reason" :id="`intent-why-${c.key}`" class="sr-only">{{
                c.reason
            }}</span>
        </button>
        <span class="min-w-0 truncate text-[11px] text-ss-text-3">{{
            summary
        }}</span>
    </div>
</template>
