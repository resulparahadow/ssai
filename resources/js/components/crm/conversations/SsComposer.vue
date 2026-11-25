<script setup lang="ts">
import {
    AlertTriangle,
    Check,
    Images,
    ListOrdered,
    MessageSquareText,
    Paperclip,
    RefreshCw,
    Send,
    Smile,
    Sparkles,
    ThumbsDown,
    X,
} from '@lucide/vue';
import {
    computed,
    nextTick,
    onBeforeUnmount,
    onMounted,
    ref,
    watch,
} from 'vue';
import { intentLabel } from '@/lib/chatCounters';
import { isValidPpvPrice, usd } from '@/lib/money';
import { humanPlan } from '@/lib/ppvComposer';
import { findScriptNote } from '@/lib/scriptLabels';
import type {
    ComposerAttachment,
    ChatCounters,
    ComposerStep,
    DraftRejection,
    IntentKey,
    OfGif,
    OfMedia,
} from '@/types/crm';
import SsEmojiPicker from './SsEmojiPicker.vue';
import SsGifPicker from './SsGifPicker.vue';
import SsIntentBar from './SsIntentBar.vue';
import SsPpvStrip from './SsPpvStrip.vue';
import SsVaultModal from './SsVaultModal.vue';

const props = defineProps<{
    creator: string;
    modelId: number;
    chatId: string; // the open chat — a switch closes the Scripts panel
    draft: string;
    context: string;
    suggestion: string | null;
    attachedGif: OfGif | null;
    attachment: ComposerAttachment | null;
    step: ComposerStep | null; // a loaded script step (exclusive with gif/attachment)
    generating: boolean;
    sending: boolean;
    error: string | null;
    canSend: boolean;
    canSendReason: string | null;
    rejections: DraftRejection[]; // the rejected drafts the next generate sends to the AI
    rejecting: boolean;
    counters: ChatCounters;
    intent: IntentKey | null; // what the pending suggestion was generated for
}>();

const emit = defineEmits<{
    'update:draft': [value: string];
    'update:context': [value: string];
    'update:attachedGif': [value: OfGif | null];
    'update:attachment': [value: ComposerAttachment | null];
    'update:step': [value: ComposerStep | null];
    'pick-file': [file: File];
    'pick-vault': [item: OfMedia];
    generate: [];
    regenerate: [];
    intent: [key: IntentKey];
    send: [];
    accept: [];
    'accept-send': [];
    dismiss: [];
    reject: [feedback: string];
    'remove-rejection': [id: number];
}>();

const showPicker = ref(false);

// Scripts panel (CreatorHero's): a sheet over the bottom of the thread, toggled by the button at
// the top-right of the message box. The page fills the `scripts` slot (it owns the chat data
// and `loadStep`); the composer owns open/close: the button, Esc, a click outside, a chat switch.
const showScripts = ref(false);
const scriptsBtn = ref<HTMLButtonElement | null>(null);
const scriptsSheet = ref<HTMLElement | null>(null);

function closeScripts(refocus = false) {
    if (!showScripts.value) {
        return;
    }

    showScripts.value = false;

    if (refocus) {
        scriptsBtn.value?.focus();
    }
}

watch(
    () => props.chatId,
    () => closeScripts(),
);

function onDocPointer(e: PointerEvent) {
    const t = e.target as Node | null;

    if (
        showScripts.value &&
        t &&
        !scriptsSheet.value?.contains(t) &&
        !scriptsBtn.value?.contains(t)
    ) {
        closeScripts();
    }
}

function onDocKey(e: KeyboardEvent) {
    if (showScripts.value && e.key === 'Escape') {
        e.preventDefault();
        closeScripts(true);
    }
}

onMounted(() => {
    document.addEventListener('pointerdown', onDocPointer);
    document.addEventListener('keydown', onDocKey);
});
onBeforeUnmount(() => {
    document.removeEventListener('pointerdown', onDocPointer);
    document.removeEventListener('keydown', onDocKey);
});
// Reject with feedback: the reason box under the suggestion. Reset whenever the draft changes,
// so a half-typed reason never gets attached to a different draft.
const showReject = ref(false);
const rejectReason = ref('');

watch(
    () => props.suggestion,
    () => {
        showReject.value = false;
        rejectReason.value = '';
    },
);

function submitReject() {
    const reason = rejectReason.value.trim();

    if (reason && !props.rejecting) {
        emit('reject', reason);
    }
}

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

// A step with media goes out as a PPV / free media send (the strip); a Text step is plain text
// whose only extra is its chip, which logs the send as that step.
const mediaStep = computed(() =>
    props.step && props.step.media.length > 0 ? props.step : null,
);
const textStep = computed(() =>
    props.step && props.step.media.length === 0 ? props.step : null,
);

// A loaded media step is sendable on its own (caption optional) — but never on a price the
// vendor would 422 (free, or $3–$200), so Send stays disabled until the chip is fixed.
const ppvPriceOk = computed(
    () => mediaStep.value === null || isValidPpvPrice(mediaStep.value.price),
);

const sendable = computed(
    () =>
        props.canSend &&
        !props.sending &&
        // An attachment that is still uploading/processing is not sendable yet.
        !attachBusy.value &&
        props.attachment?.status !== 'failed' &&
        ppvPriceOk.value &&
        (props.draft.trim().length > 0 ||
            props.attachedGif !== null ||
            props.attachment?.status === 'ready' ||
            mediaStep.value !== null),
);

const sendLabel = computed(() => {
    if (props.sending) {
        return 'Sending…';
    }

    if (mediaStep.value) {
        return mediaStep.value.price > 0
            ? `Send PPV ${usd(mediaStep.value.price)}`
            : 'Send free media';
    }

    return 'Send';
});

function setPpvPrice(price: number) {
    if (props.step) {
        emit('update:step', { ...props.step, price });
    }
}

function setPpvMedia(media: ComposerStep['media']) {
    if (props.step) {
        emit('update:step', { ...props.step, media });
    }
}

// ---- script-note guard ------------------------------------------------------------
// A step's `[bracketed]` chatter instructions must not reach a fan. Every send (script or
// not — a pasted script line is the same risk) asks first; Cancel selects the note.
const NOTE_CONFIRM =
    'This message still contains script notes in [brackets]. Send anyway?';

function notesOk(text: string): boolean {
    return findScriptNote(text) === null || window.confirm(NOTE_CONFIRM);
}

/** Focus the typing bar with its first script note selected (after the draft re-renders). */
function selectNote() {
    nextTick(() => {
        const el = textarea.value;
        const note = el ? findScriptNote(el.value) : null;

        if (el && note) {
            el.focus();
            el.setSelectionRange(note.start, note.end);
        }
    });
}

function requestSend() {
    if (!sendable.value) {
        return;
    }

    if (!notesOk(props.draft)) {
        selectNote();

        return;
    }

    emit('send');
}

/** Accept & Send, guarded: on Cancel the draft is accepted into the typing bar to edit. */
function requestAcceptSend() {
    if (!props.suggestion) {
        return;
    }

    if (!notesOk(props.suggestion)) {
        emit('accept');
        selectNote();

        return;
    }

    emit('accept-send');
}

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
        requestSend();
    }
}
</script>

<template>
    <div class="relative space-y-2 border-t border-ss-border p-3">
        <!-- Scripts panel: over the thread's bottom, full composer width (CreatorHero's sheet) -->
        <div
            v-if="showScripts && $slots.scripts"
            ref="scriptsSheet"
            class="absolute inset-x-3 bottom-full z-20 mb-1"
        >
            <slot name="scripts" :close="() => closeScripts()" />
        </div>

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
                <!-- Same green light as the chat-list row, so "done" reads the same everywhere. -->
                <span
                    v-if="props.suggestion && !props.generating"
                    class="flex items-center gap-1 rounded-full bg-ss-pos/15 px-1.5 text-[10px] leading-4 font-semibold text-ss-pos"
                    ><span
                        class="h-1.5 w-1.5 rounded-full bg-ss-pos"
                    />Ready</span
                >
                <span class="flex-1" />
                <button
                    type="button"
                    :disabled="props.generating"
                    class="grid h-6 w-6 place-items-center rounded text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text-2 disabled:opacity-50"
                    title="Regenerate"
                    @click="emit('regenerate')"
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
                <!-- PPV caption only: SSAI's saved plan was a non-selling move (PpvReadiness). -->
                <p
                    v-if="props.step?.notReadyPlan"
                    class="mb-2 flex items-start gap-1.5 rounded-lg border border-ss-warn/30 bg-ss-warn/10 px-2 py-1.5 text-[12px] leading-snug text-ss-text"
                    data-testid="ppv-not-ready"
                >
                    <AlertTriangle
                        :size="13"
                        class="mt-px shrink-0 text-ss-warn"
                        aria-hidden="true"
                    />
                    <span>
                        <b class="font-semibold"
                            >SSAI planned
                            {{ humanPlan(props.step.notReadyPlan) }} next.</b
                        >
                        Caption written anyway, send only if he's ready to
                        unlock.
                    </span>
                </p>
                <p
                    v-if="props.intent"
                    class="mb-1 text-[11px] font-semibold text-ss-text-3"
                    data-testid="intent-label"
                >
                    Intent: {{ intentLabel(props.intent) }}
                </p>
                <p
                    class="text-[14px] leading-relaxed whitespace-pre-wrap text-ss-text"
                >
                    {{ props.suggestion }}
                </p>
                <!-- Reject with feedback: the reason is stored for this chat and every later
                     draft in this conversation is told not to repeat the mistake. -->
                <div v-if="showReject" class="mt-2.5 space-y-2">
                    <textarea
                        v-model="rejectReason"
                        rows="2"
                        placeholder="Why wasn't this good? e.g. don't sell yet, ask about his dog"
                        class="w-full resize-none rounded-lg border border-ss-border bg-ss-surface px-2.5 py-1.5 text-[13px] leading-snug text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
                        @keydown.enter.exact.prevent="submitReject"
                    />
                    <div class="flex items-center justify-end gap-2">
                        <button
                            type="button"
                            class="rounded-lg px-3 py-1.5 text-[12px] font-semibold text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text-2"
                            @click="showReject = false"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            :disabled="!rejectReason.trim() || props.rejecting"
                            class="flex items-center gap-1.5 rounded-lg bg-ss-neg px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
                            title="Save the reason and write a new draft that avoids it"
                            @click="submitReject"
                        >
                            <ThumbsDown :size="13" />
                            {{
                                props.rejecting
                                    ? 'Saving…'
                                    : 'Reject & regenerate'
                            }}
                        </button>
                    </div>
                </div>
                <div v-else class="mt-2.5 flex items-center justify-end gap-2">
                    <button
                        type="button"
                        class="mr-auto flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[12px] font-semibold text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-neg"
                        title="Reject with a reason — SSAI avoids it for the rest of this conversation"
                        @click="showReject = true"
                    >
                        <ThumbsDown :size="13" /> Reject
                    </button>
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
                        @click="requestAcceptSend"
                    >
                        <Send :size="13" />
                        {{ props.sending ? 'Sending…' : 'Accept & Send' }}
                    </button>
                </div>
            </template>
        </div>

        <!-- What the AI is avoiding in this conversation (rejected drafts + reasons). Shared by
             every chatter on this fan; expires once the chat goes quiet for the session gap. -->
        <div
            v-if="props.rejections.length"
            class="rounded-xl border border-ss-border bg-ss-surface-2 px-2.5 py-2"
        >
            <p class="mb-1 text-[11px] font-semibold text-ss-text-2">
                SSAI is avoiding · this conversation
            </p>
            <ul class="space-y-0.5">
                <li
                    v-for="r in props.rejections"
                    :key="r.id"
                    class="flex items-start gap-1.5 text-[12px] text-ss-text"
                    :title="`Rejected draft: ${r.draft}${r.by ? ` — by ${r.by}` : ''}`"
                >
                    <ThumbsDown
                        :size="11"
                        class="mt-1 shrink-0 text-ss-text-3"
                    />
                    <span class="min-w-0 flex-1">{{ r.feedback }}</span>
                    <button
                        type="button"
                        class="grid h-5 w-5 shrink-0 place-items-center rounded text-ss-text-3 hover:bg-ss-surface hover:text-ss-text-2"
                        title="No longer applies — stop avoiding this"
                        @click="emit('remove-rejection', r.id)"
                    >
                        <X :size="12" />
                    </button>
                </li>
            </ul>
        </div>

        <p v-if="props.error" class="text-[11px] text-ss-neg">
            {{ props.error }}
        </p>

        <!-- Loaded media step: media + price for the next send -->
        <SsPpvStrip
            v-if="mediaStep"
            :step="mediaStep"
            :model-id="props.modelId"
            :generating="props.generating"
            @update:price="setPpvPrice"
            @update:media="setPpvMedia"
            @remove="emit('update:step', null)"
        />

        <!-- Loaded Text step: the chip is what logs this send as the step. × keeps the text. -->
        <div v-if="textStep" class="flex" data-testid="script-chip">
            <span
                class="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full bg-ss-accent-soft py-0.5 pr-0.5 pl-2 text-[11px] font-semibold text-ss-accent-text"
                title="This send counts as this script. Remove it if what you send is no longer that script."
            >
                <ListOrdered :size="11" class="shrink-0" />
                <span class="truncate">Script · {{ textStep.title }}</span>
                <button
                    type="button"
                    class="grid h-4 w-4 shrink-0 place-items-center rounded-full hover:bg-ss-accent/20"
                    title="Not this script any more — keep the text, don't log it"
                    aria-label="Remove script"
                    @click="emit('update:step', null)"
                >
                    <X :size="10" />
                </button>
            </span>
        </div>

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
                v-if="
                    props.attachment.previewUrl &&
                    props.attachment.kind !== 'audio'
                "
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

        <!-- Agent intents: Re-pitch / Re-offer MPPV (and PPV) with their unlock state. -->
        <SsIntentBar
            :counters="props.counters"
            :busy="props.generating"
            :media-loaded="mediaStep !== null"
            :active-intent="props.intent"
            @fire="emit('intent', $event)"
        />

        <!-- Typing bar: the message gets the full width; tools sit in a row beneath it, so a
             narrow middle column never squeezes the textarea down to one word per line. -->
        <div
            class="@container relative rounded-xl border border-ss-border bg-ss-surface transition-colors focus-within:border-ss-accent"
            :class="!props.canSend ? 'bg-ss-surface-2' : ''"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
        >
            <div
                v-if="dragging"
                class="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-xl border-2 border-dashed border-ss-accent bg-ss-accent-soft/90 text-[12px] font-semibold text-ss-accent-text"
            >
                Drop to attach
            </div>

            <textarea
                ref="textarea"
                :value="props.draft"
                :disabled="!props.canSend"
                rows="1"
                aria-label="Message"
                :placeholder="
                    props.canSend
                        ? mediaStep
                            ? 'Add a caption (optional)… Enter sends, Shift+Enter for a new line'
                            : 'Type a message… Enter sends, Shift+Enter for a new line'
                        : 'Sending is disabled for this chat'
                "
                class="block min-h-10 w-full resize-none rounded-t-xl bg-transparent pt-2.5 pr-11 pb-1 pl-3 text-[14px] leading-5 text-ss-text placeholder:text-ss-text-3 focus:outline-none disabled:cursor-not-allowed"
                @input="onInput"
                @keydown="onKeydown"
            />

            <!-- Scripts: top-right of the message box, where CreatorHero puts it -->
            <button
                v-if="$slots.scripts"
                ref="scriptsBtn"
                type="button"
                class="absolute top-1.5 right-1.5 grid h-8 w-8 place-items-center rounded-lg transition-colors focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none"
                :class="
                    showScripts
                        ? 'bg-ss-accent-soft text-ss-accent-text'
                        : 'text-ss-text-2 hover:bg-ss-surface-2 hover:text-ss-text'
                "
                :aria-expanded="showScripts"
                aria-haspopup="dialog"
                title="Scripts"
                aria-label="Scripts"
                data-testid="scripts-button"
                @click="showScripts = !showScripts"
            >
                <ListOrdered :size="16" />
            </button>

            <input
                ref="fileInput"
                type="file"
                accept="image/*,video/*,audio/*"
                class="hidden"
                @change="onFileChange"
            />

            <div class="flex items-center gap-0.5 px-1.5 pb-1.5">
                <button
                    type="button"
                    :disabled="props.generating"
                    class="flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[12px] font-semibold text-ss-accent-text transition-colors hover:bg-ss-accent-soft disabled:opacity-50"
                    :title="
                        mediaStep
                            ? 'Generate caption — SSAI writes the PPV pitch for this fan'
                            : 'Generate an AI draft'
                    "
                    @click="emit('generate')"
                >
                    <Sparkles
                        :size="16"
                        :class="props.generating ? 'animate-pulse' : ''"
                    />
                    <span class="hidden @[26rem]:inline">{{
                        props.generating
                            ? 'Writing…'
                            : mediaStep
                              ? 'Caption'
                              : 'Generate'
                    }}</span>
                </button>

                <button
                    type="button"
                    class="relative grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors"
                    :class="
                        showContext
                            ? 'bg-ss-accent-soft text-ss-accent-text'
                            : 'text-ss-text-2 hover:bg-ss-surface-2 hover:text-ss-text'
                    "
                    :aria-pressed="showContext"
                    title="Guide the AI — tell SSAI what to focus on before generating"
                    @click="showContext = !showContext"
                >
                    <MessageSquareText :size="16" />
                    <span
                        v-if="props.context.trim().length > 0"
                        class="absolute top-1 right-1 h-2 w-2 rounded-full border border-ss-surface bg-ss-accent"
                        title="A directive is set for the next generate"
                    />
                </button>

                <span
                    class="mx-1 h-5 w-px shrink-0 bg-ss-border"
                    aria-hidden="true"
                />

                <button
                    type="button"
                    :disabled="!props.canSend || attachBusy"
                    class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ss-text-2 transition-colors hover:bg-ss-surface-2 hover:text-ss-text disabled:opacity-40"
                    title="Attach a photo, video, or audio file"
                    aria-label="Attach a file"
                    @click="fileInput?.click()"
                >
                    <Paperclip :size="16" />
                </button>
                <button
                    type="button"
                    :disabled="!props.canSend || attachBusy"
                    class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ss-text-2 transition-colors hover:bg-ss-surface-2 hover:text-ss-text disabled:opacity-40"
                    title="Attach from the OnlyFans vault"
                    aria-label="Attach from the vault"
                    @click="showVault = true"
                >
                    <Images :size="16" />
                </button>

                <!-- Emoji picker -->
                <div class="relative shrink-0">
                    <button
                        type="button"
                        :disabled="!props.canSend"
                        class="grid h-8 w-8 place-items-center rounded-lg transition-colors disabled:opacity-40"
                        :class="
                            showEmoji
                                ? 'bg-ss-accent-soft text-ss-accent-text'
                                : 'text-ss-text-2 hover:bg-ss-surface-2 hover:text-ss-text'
                        "
                        title="Insert an emoji"
                        aria-label="Insert an emoji"
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
                        class="grid h-8 place-items-center rounded-lg px-2 text-[11px] font-bold tracking-wide transition-colors disabled:opacity-40"
                        :class="
                            showPicker
                                ? 'bg-ss-accent-soft text-ss-accent-text'
                                : 'text-ss-text-2 hover:bg-ss-surface-2 hover:text-ss-text'
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

                <span class="min-w-1 flex-1" />

                <button
                    type="button"
                    :disabled="!sendable"
                    class="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-ss-accent px-3.5 text-[13px] font-semibold whitespace-nowrap text-white transition-[filter,opacity] hover:brightness-110 active:brightness-95 disabled:opacity-50 disabled:hover:brightness-100"
                    @click="requestSend"
                >
                    <Send :size="14" /> {{ sendLabel }}
                </button>
            </div>
        </div>

        <SsVaultModal
            v-if="showVault"
            :model-id="props.modelId"
            @select="pickVault"
            @close="showVault = false"
        />
    </div>
</template>
