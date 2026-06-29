<script setup lang="ts">
import { Check, RefreshCw, Send, Sparkles, X } from '@lucide/vue';

const props = defineProps<{
    creator: string;
    draft: string;
    suggestion: string | null;
    generating: boolean;
    sending: boolean;
    error: string | null;
}>();

const emit = defineEmits<{
    'update:draft': [value: string];
    generate: [];
    send: [];
    accept: [];
    'accept-send': [];
    dismiss: [];
}>();

function onInput(e: Event) {
    emit('update:draft', (e.target as HTMLTextAreaElement).value);
}
</script>

<template>
    <div class="space-y-2 border-t border-ss-border p-3">
        <!-- AI suggestion card (above the typing bar) -->
        <div v-if="props.suggestion || props.generating" class="rounded-xl border border-ss-accent/30 bg-ss-accent-soft p-3">
            <div class="mb-1.5 flex items-center gap-1.5">
                <Sparkles :size="14" class="text-ss-accent-text" />
                <span class="text-[12px] font-semibold text-ss-accent-text">AI suggestion · in {{ props.creator }}'s voice</span>
                <span class="flex-1" />
                <button
                    type="button"
                    :disabled="props.generating"
                    class="grid h-6 w-6 place-items-center rounded text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text-2 disabled:opacity-50"
                    title="Regenerate"
                    @click="emit('generate')"
                >
                    <RefreshCw :size="13" :class="props.generating ? 'animate-spin' : ''" />
                </button>
                <button
                    v-if="props.suggestion && !props.generating"
                    type="button"
                    class="grid h-6 w-6 place-items-center rounded text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text-2"
                    title="Dismiss"
                    @click="emit('dismiss')"
                >
                    <X :size="13" />
                </button>
            </div>

            <p v-if="props.generating" class="py-2 text-[13px] text-ss-text-3">Generating a draft…</p>
            <template v-else>
                <p class="text-[14px] leading-relaxed whitespace-pre-wrap text-ss-text">{{ props.suggestion }}</p>
                <div class="mt-2.5 flex items-center justify-end gap-2">
                    <button
                        type="button"
                        class="flex items-center gap-1.5 rounded-lg border border-ss-border bg-ss-surface px-3 py-1.5 text-[12px] font-semibold text-ss-text-2 hover:bg-ss-surface-2"
                        title="Put this in the typing bar to edit before sending"
                        @click="emit('accept')"
                    >
                        <Check :size="13" /> Accept
                    </button>
                    <button
                        type="button"
                        :disabled="props.sending"
                        class="flex items-center gap-1.5 rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                        title="Send this message to OnlyFans now"
                        @click="emit('accept-send')"
                    >
                        <Send :size="13" /> {{ props.sending ? 'Sending…' : 'Accept & Send' }}
                    </button>
                </div>
            </template>
        </div>

        <p v-if="props.error" class="text-[11px] text-ss-neg">{{ props.error }}</p>

        <!-- Typing bar -->
        <div class="flex items-end gap-2">
            <button
                type="button"
                :disabled="props.generating"
                class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-ss-border text-ss-accent-text hover:bg-ss-surface-2 disabled:opacity-50"
                title="Generate an AI draft"
                @click="emit('generate')"
            >
                <Sparkles :size="16" :class="props.generating ? 'animate-pulse' : ''" />
            </button>

            <textarea
                :value="props.draft"
                rows="1"
                placeholder="Type a message, or generate an AI draft…"
                class="max-h-32 min-h-9 flex-1 resize-none rounded-lg border border-ss-border bg-ss-surface px-3 py-2 text-[14px] text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
                @input="onInput"
            />

            <button
                type="button"
                :disabled="props.sending || !props.draft.trim()"
                class="flex shrink-0 items-center gap-1.5 rounded-lg bg-ss-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                @click="emit('send')"
            >
                <Send :size="14" /> {{ props.sending ? 'Sending…' : 'Send' }}
            </button>
        </div>
    </div>
</template>
