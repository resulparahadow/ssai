<script setup lang="ts">
import { RefreshCw, Send, Sparkles } from '@lucide/vue';
import { ref, watch } from 'vue';
import { ofApi } from '@/lib/onlyfans';
import type { OfMessage } from '@/types/crm';

const props = defineProps<{ modelId: number; chatId: string; creator: string; messages: OfMessage[] }>();
const emit = defineEmits<{ sent: [] }>();

const draft = ref('');
const reason = ref('');
const posture = ref('');
const generating = ref(false);
const sending = ref(false);
const error = ref<string | null>(null);

watch(
    () => props.chatId,
    () => {
        draft.value = '';
        reason.value = '';
        posture.value = '';
        error.value = null;
    },
);

async function generate() {
    generating.value = true;
    error.value = null;

    try {
        const data = await ofApi.generate(props.modelId, props.chatId, {
            messages: props.messages.map((m) => ({ from: m.from, text: m.text, time: m.time })),
            customer: { id: props.chatId },
            api: 'claude',
        });
        draft.value = data.draft || '';
        reason.value = (data.strategy?.next_move as string) || (data.strategy?.message_purpose as string) || '';
        posture.value = (data.telemetry?.posture as string) || '';

        if (!draft.value) {
error.value = 'Engine returned an empty draft (is the engine running with an API key?).';
}
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        generating.value = false;
    }
}

async function send() {
    if (!draft.value.trim()) {
return;
}

    sending.value = true;
    error.value = null;

    try {
        await ofApi.send(props.modelId, props.chatId, draft.value.trim());
        draft.value = '';
        reason.value = '';
        posture.value = '';
        emit('sent');
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        sending.value = false;
    }
}
</script>

<template>
    <div class="border-t border-ss-border p-3">
        <div class="mb-2 rounded-xl border border-ss-border bg-ss-bg-2 p-3">
            <div class="mb-2 flex items-center justify-between">
                <span class="flex items-center gap-1.5 text-[12px] font-semibold text-ss-accent-text">
                    <Sparkles :size="14" /> AI suggestion · in {{ creator }}'s voice
                </span>
                <button
                    type="button"
                    :disabled="generating"
                    class="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-50"
                    @click="generate"
                >
                    <RefreshCw :size="12" :class="generating ? 'animate-spin' : ''" />
                    {{ generating ? 'Generating…' : draft ? 'Regenerate' : 'Generate' }}
                </button>
            </div>

            <textarea
                v-model="draft"
                rows="2"
                placeholder="Click Generate for an AI draft, or type your own…"
                class="w-full resize-none rounded-lg border border-ss-border bg-ss-surface p-2.5 text-[14px] text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
            />

            <p v-if="reason || posture" class="mt-1.5 text-[11px] text-ss-text-3">
                <span v-if="reason">Why: {{ reason }}</span>
                <span v-if="posture" class="ml-2 font-ss-mono">· {{ posture }}</span>
            </p>
            <p v-if="error" class="mt-1.5 text-[11px] text-ss-neg">{{ error }}</p>
        </div>

        <div class="flex items-center justify-end">
            <button
                type="button"
                :disabled="sending || !draft.trim()"
                class="flex items-center gap-1.5 rounded-lg bg-ss-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                @click="send"
            >
                <Send :size="14" /> {{ sending ? 'Sending…' : 'Send to OnlyFans' }}
            </button>
        </div>
    </div>
</template>
