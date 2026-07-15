<script setup lang="ts">
import {
    Bold,
    Check,
    Italic,
    RefreshCw,
    Send,
    Smile,
    Sparkles,
    X,
} from '@lucide/vue';
import { computed, nextTick, ref } from 'vue';
import type { OfGif } from '@/types/crm';
import SsEmojiPicker from './SsEmojiPicker.vue';
import SsGifPicker from './SsGifPicker.vue';

const props = defineProps<{
    creator: string;
    modelId: number;
    draft: string;
    suggestion: string | null;
    attachedGif: OfGif | null;
    generating: boolean;
    sending: boolean;
    error: string | null;
    canSend: boolean;
    canSendReason: string | null;
}>();

const emit = defineEmits<{
    'update:draft': [value: string];
    'update:attachedGif': [value: OfGif | null];
    generate: [];
    send: [];
    accept: [];
    'accept-send': [];
    dismiss: [];
}>();

const showPicker = ref(false);
const showEmoji = ref(false);
const textarea = ref<HTMLTextAreaElement | null>(null);

const sendable = computed(
    () =>
        props.canSend &&
        !props.sending &&
        (props.draft.trim().length > 0 || props.attachedGif !== null),
);

function onInput(e: Event) {
    emit('update:draft', (e.target as HTMLTextAreaElement).value);
}

function pickGif(gif: OfGif) {
    emit('update:attachedGif', gif);
    showPicker.value = false;
}

/** Replace the current selection (or insert at the caret), then restore focus + caret. */
function replaceSelection(
    build: (selected: string) => string,
    caretFor: (start: number, end: number, selected: string) => number,
) {
    const el = textarea.value;

    if (!el) {
        return;
    }

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = props.draft.slice(start, end);

    emit(
        'update:draft',
        props.draft.slice(0, start) + build(selected) + props.draft.slice(end),
    );

    nextTick(() => {
        el.focus();
        const caret = caretFor(start, end, selected);
        el.setSelectionRange(caret, caret);
    });
}

/** Wrap the selection in a marker pair. The server converts ** → strong, __ → em. */
function surround(marker: string) {
    replaceSelection(
        (selected) => `${marker}${selected}${marker}`,
        // Selection wrapped: caret after it. Nothing selected: caret between the markers.
        (start, end, selected) =>
            selected ? end + marker.length * 2 : start + marker.length,
    );
}

function insertEmoji(emoji: string) {
    showEmoji.value = false;
    replaceSelection(
        () => emoji,
        (start) => start + emoji.length,
    );
}

function onKeydown(e: KeyboardEvent) {
    // isComposing guards IME/emoji input — Enter commits the composition, it must not send.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();

        if (sendable.value) {
            emit('send');
        }

        return;
    }

    if (!(e.metaKey || e.ctrlKey)) {
        return;
    }

    if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        surround('**');
    } else if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        surround('__');
    }
}
</script>

<template>
    <div class="space-y-2 border-t border-ss-border p-3">
        <!-- AI suggestion card (above the typing bar) -->
        <div
            v-if="props.suggestion || props.generating"
            class="rounded-xl border border-ss-accent/30 bg-ss-accent-soft p-3"
        >
            <div class="mb-1.5 flex items-center gap-1.5">
                <Sparkles :size="14" class="text-ss-accent-text" />
                <span class="text-[12px] font-semibold text-ss-accent-text"
                    >AI suggestion · in {{ props.creator }}'s voice</span
                >
                <span class="flex-1" />
                <button
                    type="button"
                    :disabled="props.generating"
                    class="grid h-6 w-6 place-items-center rounded text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text-2 disabled:opacity-50"
                    title="Regenerate"
                    @click="emit('generate')"
                >
                    <RefreshCw
                        :size="13"
                        :class="props.generating ? 'animate-spin' : ''"
                    />
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

            <p v-if="props.generating" class="py-2 text-[13px] text-ss-text-3">
                Generating a draft…
            </p>
            <template v-else>
                <p
                    class="text-[14px] leading-relaxed whitespace-pre-wrap text-ss-text"
                >
                    {{ props.suggestion }}
                </p>
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
                        :disabled="props.sending || !props.canSend"
                        class="flex items-center gap-1.5 rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                        title="Send this message to OnlyFans now"
                        @click="emit('accept-send')"
                    >
                        <Send :size="13" />
                        {{ props.sending ? 'Sending…' : 'Accept & Send' }}
                    </button>
                </div>
            </template>
        </div>

        <p v-if="props.error" class="text-[11px] text-ss-neg">
            {{ props.error }}
        </p>

        <!-- Attached GIF preview -->
        <div v-if="props.attachedGif" class="relative inline-block">
            <img
                v-if="props.attachedGif.preview"
                :src="props.attachedGif.preview"
                :alt="props.attachedGif.title ?? 'GIF'"
                class="max-h-28 rounded-lg border border-ss-border"
            />
            <button
                type="button"
                class="absolute -top-2 -right-2 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-white hover:bg-black/90"
                title="Remove GIF"
                @click="emit('update:attachedGif', null)"
            >
                <X :size="13" />
            </button>
        </div>

        <!-- Can't-send notice (e.g. a muted fan): OnlyFans would 400 the send. -->
        <p v-if="!props.canSend" class="text-[11px] text-ss-text-3">
            Can't send to this chat{{
                props.canSendReason ? ` — ${props.canSendReason}` : ''
            }}
        </p>

        <!-- Typing bar -->
        <div class="flex items-end gap-2">
            <button
                type="button"
                :disabled="props.generating"
                class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-ss-border text-ss-accent-text hover:bg-ss-surface-2 disabled:opacity-50"
                title="Generate an AI draft"
                @click="emit('generate')"
            >
                <Sparkles
                    :size="16"
                    :class="props.generating ? 'animate-pulse' : ''"
                />
            </button>

            <div class="flex flex-1 flex-col gap-1">
                <!-- Formatting toolbar: inserts markers the server converts on send. -->
                <div class="flex items-center gap-0.5">
                    <button
                        type="button"
                        :disabled="!props.canSend"
                        class="grid h-6 w-6 place-items-center rounded text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text-2 disabled:opacity-40"
                        title="Bold (Ctrl+B)"
                        @click="surround('**')"
                    >
                        <Bold :size="13" />
                    </button>
                    <button
                        type="button"
                        :disabled="!props.canSend"
                        class="grid h-6 w-6 place-items-center rounded text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text-2 disabled:opacity-40"
                        title="Italic (Ctrl+I)"
                        @click="surround('__')"
                    >
                        <Italic :size="13" />
                    </button>
                </div>

                <textarea
                    ref="textarea"
                    :value="props.draft"
                    :disabled="!props.canSend"
                    rows="1"
                    :placeholder="
                        props.canSend
                            ? 'Type a message… (Enter sends, Shift+Enter for a new line)'
                            : 'Sending is disabled for this chat'
                    "
                    class="max-h-32 min-h-9 w-full resize-none rounded-lg border border-ss-border bg-ss-surface px-3 py-2 text-[14px] text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none disabled:opacity-50"
                    @input="onInput"
                    @keydown="onKeydown"
                />
            </div>

            <!-- Emoji picker -->
            <div class="relative shrink-0">
                <button
                    type="button"
                    :disabled="!props.canSend"
                    class="grid h-9 w-9 place-items-center rounded-lg border transition-colors disabled:opacity-40"
                    :class="
                        showEmoji
                            ? 'border-ss-accent bg-ss-accent-soft text-ss-accent-text'
                            : 'border-ss-border text-ss-text-2 hover:bg-ss-surface-2'
                    "
                    title="Insert an emoji"
                    @click="showEmoji = !showEmoji"
                >
                    <Smile :size="16" />
                </button>
                <SsEmojiPicker
                    v-if="showEmoji"
                    @select="insertEmoji"
                    @close="showEmoji = false"
                />
            </div>

            <!-- GIF picker -->
            <div class="relative shrink-0">
                <button
                    type="button"
                    :disabled="!props.canSend"
                    class="grid h-9 w-11 place-items-center rounded-lg border text-[12px] font-bold transition-colors disabled:opacity-40"
                    :class="
                        showPicker
                            ? 'border-ss-accent bg-ss-accent-soft text-ss-accent-text'
                            : 'border-ss-border text-ss-text-2 hover:bg-ss-surface-2'
                    "
                    title="Send a GIF"
                    @click="showPicker = !showPicker"
                >
                    GIF
                </button>
                <SsGifPicker
                    v-if="showPicker"
                    :model-id="props.modelId"
                    @select="pickGif"
                    @close="showPicker = false"
                />
            </div>

            <button
                type="button"
                :disabled="!sendable"
                class="flex shrink-0 items-center gap-1.5 rounded-lg bg-ss-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                @click="emit('send')"
            >
                <Send :size="14" /> {{ props.sending ? 'Sending…' : 'Send' }}
            </button>
        </div>
    </div>
</template>
