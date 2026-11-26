<script setup lang="ts">
import { ChevronDown } from '@lucide/vue';
import { computed, nextTick, onBeforeUnmount, ref } from 'vue';
import { intentLock, ppvChipLock } from '@/lib/chatCounters';
import { barLayout, findIntent, intentCatalogue } from '@/lib/intents';
import { usd } from '@/lib/money';
import { stateChipLock } from '@/lib/stateSwitches';
import type { ComposerFanState } from '@/lib/stateSwitches';
import type { ChatCounters, IntentKey, IntentRef } from '@/types/crm';

const props = defineProps<{
    counters: ChatCounters;
    busy: boolean;
    // A send is in flight for this chat: its pending bubble rides in the generate payload, so a
    // Re-pitch could target the PPV still on its way out. Chips wait for the send to settle.
    sending: boolean;
    mediaLoaded: boolean; // a PPV/media step is loaded in the composer
    activeIntent: IntentRef | null; // what the pending suggestion was generated for
    generatingIntent: IntentRef | null; // the intent being generated right now
    // The fan's §5b/§5c state: support mode locks the selling chips, the counters light
    // FreePicture / PPV, and the summary gains the ladder + counter parts.
    fanState: ComposerFanState;
}>();

const emit = defineEmits<{ fire: [ref: IntentRef] }>();

const layout = barLayout(intentCatalogue());

interface Chip {
    key: IntentKey;
    label: string;
    options: { key: string; label: string }[];
    enabled: boolean;
    lit: boolean;
    reason: string | null;
    hint: string | null; // why a lit chip is lit (its title)
    active: boolean;
    spinning: boolean;
}

function chipFor(key: IntentKey): Chip {
    const intent = findIntent(key);
    let lock: { enabled: boolean; lit: boolean; reason: string | null };

    if (key === 'ppv') {
        lock = ppvChipLock(props.counters, props.mediaLoaded);
    } else if (key === 'repitch' || key === 'reoffer_mppv') {
        lock = intentLock(key, props.counters);
    } else {
        lock = { enabled: true, lit: false, reason: null };
    }

    let reason = lock.reason;
    let enabled = lock.enabled;

    // A loaded PPV is what the chatter is about to send; any other intent (except the
    // client-side Free picture) would fight it.
    if (key !== 'ppv' && key !== 'free_picture' && props.mediaLoaded) {
        enabled = false;
        reason = 'Remove the loaded PPV first';
    }

    if (enabled && props.sending) {
        enabled = false;
        reason = 'Sending…';
    }

    // The fan's state goes last so support mode's reason wins over every other lock.
    const s = stateChipLock(
        key,
        { enabled, lit: lock.lit && enabled, reason },
        props.fanState,
    );

    return {
        key,
        label: intent?.label ?? key,
        options: intent?.options ?? [],
        enabled: s.enabled && !props.busy,
        lit: s.lit && s.enabled,
        reason: s.enabled ? null : s.reason,
        hint: s.enabled && s.lit ? s.hint : null,
        active: props.activeIntent?.key === key && !props.busy,
        spinning: props.busy && props.generatingIntent?.key === key,
    };
}

const barChips = computed(() => layout.bar.map(chipFor));
const moreChips = computed(() => layout.more.map(chipFor));
const moreActive = computed(() => moreChips.value.some((c) => c.active));
// A lit intent under More (FreePicture at 3 objections) would be invisible behind the trigger.
const moreLit = computed(() => moreChips.value.find((c) => c.lit) ?? null);
const moreSpinning = computed(() => moreChips.value.some((c) => c.spinning));

// One menu open at a time: a chip key (its options) or 'more'. In More, an intent with options
// expands its options inline beneath it.
const openMenu = ref<string | null>(null);
const expanded = ref<IntentKey | null>(null);
const root = ref<HTMLElement | null>(null);

function menuItems(): HTMLButtonElement[] {
    return Array.from(
        root.value?.querySelectorAll<HTMLButtonElement>(
            '[role="menu"] [role="menuitem"]:not(:disabled)',
        ) ?? [],
    );
}

function trigger(id: string): HTMLButtonElement | null {
    return (
        root.value?.querySelector<HTMLButtonElement>(
            `[data-trigger="${id}"]`,
        ) ?? null
    );
}

function outside(e: PointerEvent) {
    if (!root.value?.contains(e.target as Node)) {
        close(false);
    }
}

async function toggle(id: string) {
    if (openMenu.value === id) {
        close(true);

        return;
    }

    openMenu.value = id;
    expanded.value = null;
    document.addEventListener('pointerdown', outside);
    await nextTick();
    menuItems()[0]?.focus();
}

function close(refocus: boolean) {
    const id = openMenu.value;
    openMenu.value = null;
    expanded.value = null;
    document.removeEventListener('pointerdown', outside);

    if (refocus && id) {
        trigger(id)?.focus();
    }
}

onBeforeUnmount(() => document.removeEventListener('pointerdown', outside));

function fire(key: IntentKey, option: string | null) {
    close(true);
    emit('fire', { key, option });
}

function onChip(c: Chip) {
    if (c.options.length > 0) {
        void toggle(c.key);

        return;
    }

    fire(c.key, null);
}

async function onMoreItem(c: Chip) {
    if (c.options.length === 0) {
        fire(c.key, null);

        return;
    }

    expanded.value = expanded.value === c.key ? null : c.key;

    // The options open below the row, which may be past the menu's scroll edge.
    if (expanded.value) {
        await nextTick();
        root.value
            ?.querySelector(
                `[data-testid^="intent-option-${c.key}-"]:last-of-type`,
            )
            ?.scrollIntoView({ block: 'nearest' });
    }
}

function onKey(e: KeyboardEvent) {
    if (openMenu.value === null) {
        return;
    }

    if (e.key === 'Escape') {
        e.stopPropagation();
        close(true);

        return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const list = menuItems();
        const i = list.indexOf(document.activeElement as HTMLButtonElement);
        const next =
            (i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
        list[next]?.focus();
    }
}

const CHIP =
    'inline-flex h-7 items-center rounded-full border px-2.5 text-[11px] font-semibold transition-colors focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-45';
const MENU =
    'absolute bottom-full left-0 z-30 mb-1 flex max-h-72 min-w-[11rem] flex-col overflow-y-auto rounded-lg border border-ss-border bg-ss-surface p-1 shadow-lg';
const ITEM =
    'flex items-center justify-between gap-3 rounded px-2 py-1 text-left text-[12px] text-ss-text hover:bg-ss-surface-2 focus:bg-ss-surface-2 focus:outline-none disabled:cursor-not-allowed disabled:opacity-45';

function chipClass(c: Chip): string {
    return c.active
        ? 'border-ss-accent bg-ss-accent text-white'
        : c.lit
          ? 'border-ss-accent/60 bg-ss-accent-soft text-ss-accent-text hover:bg-ss-accent/20'
          : 'border-ss-border bg-ss-surface text-ss-text-2 hover:bg-ss-surface-2';
}

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

    parts.push(...props.fanState.parts);

    return parts.join(' · ');
});
</script>

<template>
    <div
        ref="root"
        class="flex flex-wrap items-center gap-1.5"
        data-testid="intent-bar"
        @keydown="onKey"
    >
        <span v-for="c in barChips" :key="c.key" class="relative inline-flex">
            <button
                type="button"
                :disabled="!c.enabled"
                :title="c.reason ?? c.hint ?? undefined"
                :aria-describedby="c.reason ? `intent-why-${c.key}` : undefined"
                :data-lit="c.lit ? 'true' : undefined"
                :aria-haspopup="c.options.length ? 'menu' : undefined"
                :aria-expanded="
                    c.options.length ? openMenu === c.key : undefined
                "
                :data-testid="`intent-${c.key}`"
                :data-trigger="c.key"
                :class="[CHIP, chipClass(c)]"
                @click="onChip(c)"
            >
                <span
                    v-if="c.spinning"
                    class="mr-1.5 h-3 w-3 animate-spin rounded-full border-2 border-ss-accent/30 border-t-ss-accent"
                    data-testid="intent-spinner"
                    aria-hidden="true"
                />
                {{ c.label }}
                <ChevronDown
                    v-if="c.options.length"
                    :size="11"
                    class="ml-0.5"
                    aria-hidden="true"
                />
                <span
                    v-if="c.reason"
                    :id="`intent-why-${c.key}`"
                    class="sr-only"
                    >{{ c.reason }}</span
                >
            </button>
            <span
                v-if="openMenu === c.key"
                role="menu"
                :aria-label="`${c.label} options`"
                :class="MENU"
                :data-testid="`intent-menu-${c.key}`"
            >
                <button
                    v-for="o in c.options"
                    :key="o.key"
                    type="button"
                    role="menuitem"
                    :class="ITEM"
                    :data-testid="`intent-option-${c.key}-${o.key}`"
                    @click="fire(c.key, o.key)"
                >
                    {{ o.label }}
                </button>
            </span>
        </span>

        <span class="relative inline-flex">
            <button
                type="button"
                aria-haspopup="menu"
                :aria-expanded="openMenu === 'more'"
                :title="moreLit?.hint ?? undefined"
                :data-lit="moreLit ? 'true' : undefined"
                data-testid="intent-more"
                data-trigger="more"
                :class="[
                    CHIP,
                    moreActive
                        ? 'border-ss-accent bg-ss-accent text-white'
                        : moreLit
                          ? 'border-ss-accent/60 bg-ss-accent-soft text-ss-accent-text hover:bg-ss-accent/20'
                          : 'border-ss-border bg-ss-surface text-ss-text-2 hover:bg-ss-surface-2',
                ]"
                @click="toggle('more')"
            >
                <span
                    v-if="moreSpinning"
                    class="mr-1.5 h-3 w-3 animate-spin rounded-full border-2 border-ss-accent/30 border-t-ss-accent"
                    data-testid="intent-spinner"
                    aria-hidden="true"
                />
                More
                <ChevronDown :size="11" class="ml-0.5" aria-hidden="true" />
            </button>
            <span
                v-if="openMenu === 'more'"
                role="menu"
                aria-label="More intents"
                :class="MENU"
                data-testid="intent-menu-more"
            >
                <template v-for="c in moreChips" :key="c.key">
                    <button
                        type="button"
                        role="menuitem"
                        :disabled="!c.enabled"
                        :title="c.reason ?? c.hint ?? undefined"
                        :aria-haspopup="c.options.length ? 'menu' : undefined"
                        :aria-expanded="
                            c.options.length ? expanded === c.key : undefined
                        "
                        :data-testid="`intent-${c.key}`"
                        :data-lit="c.lit ? 'true' : undefined"
                        :class="[
                            ITEM,
                            c.lit
                                ? 'bg-ss-accent-soft text-ss-accent-text'
                                : '',
                        ]"
                        @click="onMoreItem(c)"
                    >
                        <span class="flex flex-col items-start">
                            {{ c.label }}
                            <span
                                v-if="c.reason ?? c.hint"
                                class="text-[10px]"
                                :class="
                                    c.hint
                                        ? 'text-ss-accent-text'
                                        : 'text-ss-text-3'
                                "
                                >{{ c.reason ?? c.hint }}</span
                            >
                        </span>
                        <span
                            v-if="c.options.length"
                            class="text-ss-text-3"
                            aria-hidden="true"
                            >{{ expanded === c.key ? '▾' : '▸' }}</span
                        >
                    </button>
                    <template v-if="expanded === c.key">
                        <button
                            v-for="o in c.options"
                            :key="o.key"
                            type="button"
                            role="menuitem"
                            :class="[ITEM, 'ml-3']"
                            :data-testid="`intent-option-${c.key}-${o.key}`"
                            @click="fire(c.key, o.key)"
                        >
                            {{ o.label }}
                        </button>
                    </template>
                </template>
            </span>
        </span>
        <span class="min-w-0 truncate text-[11px] text-ss-text-3">{{
            summary
        }}</span>
    </div>
</template>
