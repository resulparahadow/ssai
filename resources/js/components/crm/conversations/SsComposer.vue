<script setup lang="ts">
import {
    Check,
    MessageSquareText,
    Paperclip,
    RefreshCw,
    Send,
    Smile,
    Sparkles,
    X,
} from '@lucide/vue';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import type { ComposerAttachment, OfGif, OfMedia } from '@/types/crm';
import SsEmojiPicker from './SsEmojiPicker.vue';
import SsGifPicker from './SsGifPicker.vue';
import SsVaultModal from './SsVaultModal.vue';

const props = defineProps<{
    creator: string;
    modelId: number;
    draft: string;
    context: string;
    suggestion: string | null;
    attachedGif: OfGif | null;
    attachment: ComposerAttachment | null;
    generating: boolean;
    sending: boolean;
    error: string | null;
    canSend: boolean;
    canSendReason: string | null;
}>();

const emit = defineEmits<{
    'update:draft': [value: string];
    'update:context': [value: string];
    'update:attachedGif': [value: OfGif | null];
    'update:attachment': [value: ComposerAttachment | null];
    'pick-file': [file: File];
    'pick-vault': [item: OfMedia];
    generate: [];
    send: [];
    accept: [];
    'accept-send': [];
    dismiss: [];
}>();

const showPicker = ref(false);
const showEmoji = ref(false);
// Opens the "guide the AI" box automatically when a directive is already set (e.g.
// switching back to a chat where one was typed) so it isn't silently in effect.
const showContext = ref(props.context.trim().length > 0);
const textarea = ref<HTMLTextAreaElement | null>(null);
const showVault = ref(false);
const dragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const attachBusy = computed(
    () =>
        props.attachment?.status === 'uploading' ||
        props.attachment?.status === 'processing',
);

const sendable = computed(
    () =>
        props.canSend &&
        !props.sending &&
        // An attachment that is still uploading/processing is not sendable yet.
        !attachBusy.value &&
        props.attachment?.status !== 'failed' &&
        (props.draft.trim().length > 0 ||
            props.attachedGif !== null ||
            props.attachment?.status === 'ready'),
);

const MAX_ROWS = 5;

/** Grow the textarea to fit its content up to MAX_ROWS lines, then scroll. A rows="1"
 *  textarea doesn't resize itself, so recompute the height on every content change. */
function autoGrow() {
    const el = textarea.value;

    if (!el) {
        return;
    }

    el.style.height = 'auto'; // reset so scrollHeight reflects the true content height

    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const border =
        parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const max = line * MAX_ROWS + padding + border;
    const fit = el.scrollHeight + border; // border-box: scrollHeight omits the border

    el.style.height = `${Math.min(fit, max)}px`;
    el.style.overflowY = fit > max ? 'auto' : 'hidden';
}

function onInput(e: Event) {
    emit('update:draft', (e.target as HTMLTextAreaElement).value);
    autoGrow();
}

// Grow on external draft changes too (Accept suggestion, chat switch, clear-after-send).
watch(
    () => props.draft,
    () => nextTick(autoGrow),
);

// Never leave a set directive hidden — a non-empty context silently steers the next
// generation, so reveal the box whenever one is present (e.g. after a chat switch).
watch(
    () => props.context,
    (v) => {
        if (v.trim().length > 0) {
            showContext.value = true;
        }
    },
);

onMounted(autoGrow);

function pickGif(gif: OfGif) {
    emit('update:attachedGif', gif);
    showPicker.value = false;
}

function onFileChange(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];

    if (f) {
        emit('pick-file', f);
    }

    // Reset so picking the SAME file twice still fires change.
    (e.target as HTMLInputElement).value = '';
}

function onDrop(e: DragEvent) {
    dragging.value = false;

    if (!props.canSend) {
        return;
    }

    const f = e.dataTransfer?.files?.[0];

    if (f) {
        emit('pick-file', f);
    }
}

function pickVault(item: OfMedia) {
    showVault.value = false;
    emit('pick-vault', item);
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

        <!-- Attached media preview -->
        <div
            v-if="props.attachment"
            class="flex items-center gap-2.5 rounded-xl border border-ss-border bg-ss-surface-2 p-2"
        >
            <img
                v-if="props.attachment.previewUrl && props.attachment.kind !== 'audio'"
                :src="props.attachment.previewUrl"
                alt=""
                class="h-12 w-12 shrink-0 rounded-lg object-cover"
            />
            <span
                v-else
                class="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-ss-surface text-[9px] font-semibold text-ss-text-3 uppercase"
                >{{ props.attachment.kind }}</span
            >

            <div class="min-w-0 flex-1">
                <p class="truncate text-[12px] font-medium text-ss-text">
                    {{ props.attachment.name ?? props.attachment.kind }}
                </p>

                <p
                    v-if="props.attachment.status === 'failed'"
                    class="text-[11px] text-ss-neg"
                >
                    {{ props.attachment.error ?? 'Upload failed.' }}
                </p>
                <p
                    v-else-if="props.attachment.status === 'processing'"
                    class="text-[11px] text-ss-text-3"
                >
                    Processing on OnlyFans…
                </p>
                <p
                    v-else-if="props.attachment.status === 'ready'"
                    class="text-[11px] text-ss-text-3"
                >
                    Ready to send
                </p>
                <div
                    v-else
                    class="mt-1 h-1.5 overflow-hidden rounded-full bg-ss-surface"
                >
                    <div
                        class="h-full rounded-full bg-ss-accent transition-[width]"
                        :style="{ width: `${props.attachment.progress}%` }"
                    />
                </div>
            </div>

            <button
                type="button"
                class="grid h-7 w-7 shrink-0 place-items-center rounded text-ss-text-3 hover:bg-ss-surface hover:text-ss-text-2"
                title="Remove attachment"
                @click="emit('update:attachment', null)"
            >
                <X :size="14" />
            </button>
        </div>

        <!-- Guide-the-AI box: a directive for the NEXT generate only. Steers the AI
             (wins over its default read); it is never sent to the fan. -->
        <div
            v-if="showContext"
            class="rounded-xl border border-ss-accent/30 bg-ss-accent-soft p-2.5"
        >
            <div class="mb-1.5 flex items-center gap-1.5">
                <MessageSquareText :size="13" class="text-ss-accent-text" />
                <span class="text-[11px] font-semibold text-ss-accent-text"
                    >Tell SSAI what to focus on · used on the next generate, not
                    sent to the fan</span
                >
                <span class="flex-1" />
                <button
                    v-if="props.context"
                    type="button"
                    class="text-[11px] font-medium text-ss-text-3 hover:text-ss-text-2"
                    title="Clear this directive"
                    @click="emit('update:context', '')"
                >
                    Clear
                </button>
            </div>
            <textarea
                :value="props.context"
                rows="2"
                placeholder="e.g. he just tipped $50 · coming back after 2 weeks cold · about to send a PPV, run the promise ritual · ghosted, need re-engagement"
                class="w-full resize-none rounded-lg border border-ss-border bg-ss-surface px-2.5 py-1.5 text-[13px] leading-snug text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
                @input="
                    emit(
                        'update:context',
                        ($event.target as HTMLTextAreaElement).value,
                    )
                "
            />
        </div>

        <!-- Can't-send notice (e.g. a muted fan): OnlyFans would 400 the send. -->
        <p v-if="!props.canSend" class="text-[11px] text-ss-text-3">
            Can't send to this chat{{
                props.canSendReason ? ` — ${props.canSendReason}` : ''
            }}
        </p>

        <!-- Typing bar -->
        <div
            class="relative flex items-end gap-2"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
        >
            <div
                v-if="dragging"
                class="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg border-2 border-dashed border-ss-accent bg-ss-accent-soft/90 text-[12px] font-semibold text-ss-accent-text"
            >
                Drop to attach
            </div>

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

            <button
                type="button"
                class="relative grid h-9 w-9 shrink-0 place-items-center rounded-lg border transition-colors"
                :class="
                    showContext
                        ? 'border-ss-accent bg-ss-accent-soft text-ss-accent-text'
                        : 'border-ss-border text-ss-text-2 hover:bg-ss-surface-2'
                "
                title="Guide the AI — tell SSAI what to focus on before generating"
                @click="showContext = !showContext"
            >
                <MessageSquareText :size="16" />
                <span
                    v-if="props.context.trim().length > 0"
                    class="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full border-2 border-ss-surface bg-ss-accent"
                    title="A directive is set for the next generate"
                />
            </button>

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
                class="min-h-9 w-full flex-1 resize-none rounded-lg border border-ss-border bg-ss-surface px-3 py-2 text-[14px] leading-5 text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none disabled:opacity-50"
                @input="onInput"
                @keydown="onKeydown"
            />

            <input
                ref="fileInput"
                type="file"
                accept="image/*,video/*,audio/*"
                class="hidden"
                @change="onFileChange"
            />
            <button
                type="button"
                :disabled="!props.canSend || attachBusy"
                class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-ss-border text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-40"
                title="Attach a photo, video, or audio file"
                @click="fileInput?.click()"
            >
                <Paperclip :size="16" />
            </button>
            <button
                type="button"
                :disabled="!props.canSend || attachBusy"
                class="grid h-9 shrink-0 place-items-center rounded-lg border border-ss-border px-2 text-[11px] font-bold text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-40"
                title="Attach from the OnlyFans vault"
                @click="showVault = true"
            >
                VAULT
            </button>

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

        <SsVaultModal
            v-if="showVault"
            :model-id="props.modelId"
            @select="pickVault"
            @close="showVault = false"
        />
    </div>
</template>
