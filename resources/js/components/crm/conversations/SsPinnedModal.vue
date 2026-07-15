<script setup lang="ts">
import { Pin, PinOff, X } from '@lucide/vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import SsMessageMedia from '@/components/crm/conversations/SsMessageMedia.vue';
import { ofApi } from '@/lib/onlyfans';
import type { OfMessage } from '@/types/crm';

/** Pinned messages for a chat. OnlyFans exposes pins as a `filter` on the messages list. */
const props = defineProps<{
    modelId: number;
    chatId: string;
    creator: string;
}>();
const emit = defineEmits<{
    close: [];
    /** Jump to this message in the thread. */
    jump: [message: OfMessage];
    /** A pin was removed — lets the parent keep the header's pinned count honest. */
    unpinned: [id: string];
}>();

const messages = ref<OfMessage[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const busy = ref<string | null>(null);

async function load() {
    loading.value = true;
    error.value = null;

    try {
        const r = await ofApi.pinned(props.modelId, props.chatId);
        messages.value = r.messages as OfMessage[];
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        loading.value = false;
    }
}

async function unpin(m: OfMessage) {
    if (!m.id) {
        return;
    }

    busy.value = m.id;
    error.value = null;

    try {
        await ofApi.unpin(props.modelId, props.chatId, m.id);
        messages.value = messages.value.filter((x) => x.id !== m.id);
        emit('unpinned', m.id);
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        busy.value = null;
    }
}

function when(iso: string | null): string {
    if (!iso) {
        return '';
    }

    return new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        emit('close');
    }
}

onMounted(() => {
    load();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
});

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
});
</script>

<template>
    <Teleport to="body">
        <div
            class="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
            @click.self="emit('close')"
        >
            <div
                class="flex max-h-[80vh] w-full max-w-lg flex-col rounded-xl border border-ss-border bg-ss-surface shadow-xl"
            >
                <div
                    class="flex shrink-0 items-center justify-between border-b border-ss-border px-4 py-3"
                >
                    <h3
                        class="flex items-center gap-2 text-base font-semibold text-ss-text"
                    >
                        <Pin :size="15" />
                        Pinned messages
                        <span
                            v-if="!loading && messages.length"
                            class="text-[12px] font-normal text-ss-text-3"
                            >({{ messages.length }})</span
                        >
                    </h3>
                    <button
                        type="button"
                        class="grid h-7 w-7 place-items-center rounded-lg text-ss-text-2 hover:bg-ss-surface-2"
                        title="Close (Esc)"
                        @click="emit('close')"
                    >
                        <X :size="16" />
                    </button>
                </div>

                <div class="min-h-0 flex-1 overflow-y-auto p-3">
                    <p
                        v-if="error"
                        class="mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[12px] text-red-400"
                    >
                        {{ error }}
                    </p>

                    <div v-if="loading" class="space-y-2">
                        <div
                            v-for="i in 3"
                            :key="i"
                            class="h-14 animate-pulse rounded-lg bg-ss-surface-2"
                        />
                    </div>

                    <p
                        v-else-if="!messages.length"
                        class="py-8 text-center text-[13px] text-ss-text-3"
                    >
                        No pinned messages in this chat.
                    </p>

                    <ul v-else class="space-y-1.5">
                        <li
                            v-for="m in messages"
                            :key="m.id ?? ''"
                            class="group rounded-lg border border-ss-border bg-ss-bg-2 p-2.5"
                        >
                            <div class="flex items-start justify-between gap-2">
                                <button
                                    type="button"
                                    class="min-w-0 flex-1 text-left"
                                    title="Jump to this message"
                                    @click="emit('jump', m)"
                                >
                                    <div
                                        class="mb-0.5 flex items-center gap-1.5 text-[11px] text-ss-text-3"
                                    >
                                        <span class="font-medium text-ss-text-2">{{
                                            m.from === 'fan' ? 'Fan' : creator
                                        }}</span>
                                        <span>·</span>
                                        <span>{{ when(m.time) }}</span>
                                    </div>
                                    <p
                                        v-if="m.text"
                                        class="line-clamp-3 text-[13px] break-words text-ss-text"
                                    >
                                        {{ m.text }}
                                    </p>
                                    <p
                                        v-else-if="!m.media.length"
                                        class="text-[13px] text-ss-text-3 italic"
                                    >
                                        (no text)
                                    </p>
                                </button>
                                <button
                                    type="button"
                                    :disabled="busy === m.id"
                                    class="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-neg disabled:opacity-40"
                                    title="Unpin"
                                    @click="unpin(m)"
                                >
                                    <PinOff :size="14" />
                                </button>
                            </div>
                            <SsMessageMedia
                                v-if="m.media.length"
                                class="mt-1.5"
                                :media="m.media"
                                :model-id="modelId"
                                hide-price
                            />
                        </li>
                    </ul>
                </div>
            </div>
        </div>
    </Teleport>
</template>
