<script setup lang="ts">
import { Check, ChevronDown, DollarSign } from '@lucide/vue';
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import {
    effectiveTag,
    MESSAGE_TAGS,
    tagChipLabel,
    tagLabel,
} from '@/lib/chatCounters';
import { usd } from '@/lib/money';
import { messagePayInfo } from '@/lib/onlyfans';
import type { MessageTag, OfMessage } from '@/types/crm';

const props = defineProps<{
    message: OfMessage;
    /** Stored per-message tag overrides for this chat. */
    tags?: Record<string, MessageTag>;
}>();

const emit = defineEmits<{ tag: [tag: MessageTag | null] }>();

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

// The PPV tag (Chat PPV / Mass / Free preview) is the one indicator of how a PPV was sent;
// a mass-blast PPV is tagged so chatters know SSAI ignores it unless bought. Only settled
// bubbles with a real id can be re-tagged.
const tags = computed(() => props.tags ?? {});
const tag = computed(() => effectiveTag(props.message, tags.value));
const taggable = computed(
    () =>
        tag.value !== null &&
        props.message.id !== null &&
        !props.message.pending &&
        !props.message.failed,
);
const auto = computed(
    () =>
        props.message.id === null ||
        !MESSAGE_TAGS.includes(tags.value[props.message.id]),
);

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);

function items(): HTMLButtonElement[] {
    return Array.from(
        root.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ??
            [],
    );
}

function outside(e: PointerEvent) {
    if (!root.value?.contains(e.target as Node)) {
        close(false);
    }
}

async function toggle() {
    if (open.value) {
        close(true);

        return;
    }

    open.value = true;
    document.addEventListener('pointerdown', outside);
    await nextTick();
    (items().find((b) => b.dataset.active === 'true') ?? items()[0])?.focus();
}

function close(refocus: boolean) {
    open.value = false;
    document.removeEventListener('pointerdown', outside);

    if (refocus) {
        trigger.value?.focus();
    }
}

onBeforeUnmount(() => document.removeEventListener('pointerdown', outside));

function pick(t: MessageTag | null) {
    close(true);

    // Re-picking what is already stored changes nothing.
    if (t !== null && !auto.value && t === tag.value) {
        return;
    }

    if (t === null && auto.value) {
        return;
    }

    emit('tag', t);
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);

        return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = items();
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        const next =
            (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        list[next]?.focus();
    }
}
</script>

<template>
    <!-- green = paid / tip received, amber = unpaid PPV -->
    <span v-if="pay" class="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span
            class="inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
            :class="
                paid ? 'bg-ss-pos/15 text-ss-pos' : 'bg-ss-warn/15 text-ss-warn'
            "
        >
            <DollarSign :size="11" />
            {{ label }}
            <Check v-if="paid" :size="11" />
        </span>
        <span
            v-if="taggable && tag"
            ref="root"
            class="relative inline-flex"
            @keydown="onKey"
        >
            <button
                ref="trigger"
                type="button"
                class="inline-flex items-center gap-0.5 rounded-full border border-ss-border px-2 py-0.5 text-[11px] font-semibold text-ss-text-2 hover:bg-ss-surface-2 hover:text-ss-text"
                :class="tag === 'mppv' ? 'border-ss-accent/40' : ''"
                title="How this PPV was sent — click to change"
                aria-haspopup="menu"
                :aria-expanded="open"
                data-testid="tag-chip"
                @click="toggle"
            >
                {{ tagChipLabel(tag, auto) }}
                <ChevronDown :size="10" />
            </button>
            <span
                v-if="open"
                role="menu"
                aria-label="Tag this PPV"
                class="absolute top-full right-0 z-30 mt-1 flex min-w-[9rem] flex-col rounded-lg border border-ss-border bg-ss-surface p-1 shadow-lg"
                data-testid="tag-menu"
            >
                <button
                    v-for="t in MESSAGE_TAGS"
                    :key="t"
                    type="button"
                    role="menuitem"
                    class="flex items-center justify-between gap-3 rounded px-2 py-1 text-left text-[12px] text-ss-text hover:bg-ss-surface-2 focus:bg-ss-surface-2 focus:outline-none"
                    :data-active="!auto && t === tag"
                    @click="pick(t)"
                >
                    {{ tagLabel(t) }}
                    <Check v-if="!auto && t === tag" :size="11" />
                </button>
                <button
                    type="button"
                    role="menuitem"
                    class="flex items-center justify-between gap-3 rounded border-t border-ss-border px-2 py-1 text-left text-[12px] text-ss-text-2 hover:bg-ss-surface-2 focus:bg-ss-surface-2 focus:outline-none"
                    :data-active="auto"
                    @click="pick(null)"
                >
                    Auto
                    <Check v-if="auto" :size="11" />
                </button>
            </span>
        </span>
    </span>
</template>
