<script setup lang="ts">
import { Film, Image as ImageIcon, Lock, Music, Tag, X } from '@lucide/vue';
import { computed, nextTick, ref, watch } from 'vue';
import { isValidPpvPrice, usd } from '@/lib/money';
import { mediaSrc } from '@/lib/onlyfans';
import type { ComposerPpv, PpvSetMedia } from '@/types/crm';

/**
 * The loaded PPV set, shown above the typing bar: set name, media tiles, and the editable
 * "Price to View" chip (CreatorHero's composer, which the team is used to). Price edits are
 * validated against the vendor rule (free, or $3–$200) so Send stays disabled on a bad value
 * instead of paying for a vendor 422.
 */
const props = defineProps<{ ppv: ComposerPpv; modelId: number }>();
const emit = defineEmits<{ 'update:price': [value: number]; remove: [] }>();

const MAX_TILES = 6;

const visible = computed(() => props.ppv.media.slice(0, MAX_TILES));
const overflow = computed(() =>
    Math.max(0, props.ppv.media.length - MAX_TILES),
);
const priceOk = computed(() => isValidPpvPrice(props.ppv.price));

// Inline price editor: a chip that turns into a number input on click.
const editing = ref(false);
// NB: Vue casts v-model on a type=number input to a number, so this holds string | number.
const draftPrice = ref<string | number>(String(props.ppv.price));
const input = ref<HTMLInputElement | null>(null);

watch(
    () => props.ppv.price,
    (p) => {
        if (!editing.value) {
            draftPrice.value = String(p);
        }
    },
);

function startEdit() {
    draftPrice.value = String(props.ppv.price);
    editing.value = true;
    nextTick(() => input.value?.select());
}

function commit() {
    const n = Number(String(draftPrice.value).replace(/[$,\s]/g, ''));
    emit('update:price', Number.isFinite(n) ? n : props.ppv.price);
    editing.value = false;
}

function cancel() {
    editing.value = false;
    draftPrice.value = String(props.ppv.price);
}

function tileIcon(m: PpvSetMedia) {
    return m.type === 'video' ? Film : m.type === 'audio' ? Music : ImageIcon;
}
</script>

<template>
    <div
        class="rounded-xl border border-ss-warn/40 bg-ss-warn/5 p-2.5"
        data-testid="ppv-strip"
    >
        <div class="mb-2 flex items-center gap-2">
            <span
                class="inline-flex items-center gap-1 rounded-full bg-ss-warn/15 px-2 py-0.5 text-[11px] font-semibold text-ss-warn"
            >
                <Lock :size="11" />
                PPV set · {{ props.ppv.setName }}
            </span>

            <span class="flex-1" />

            <!-- Price to View chip → inline editor -->
            <form
                v-if="editing"
                class="flex items-center gap-1"
                @submit.prevent="commit"
            >
                <span class="text-[12px] text-ss-text-3">$</span>
                <input
                    ref="input"
                    v-model="draftPrice"
                    type="number"
                    inputmode="decimal"
                    min="0"
                    max="200"
                    step="1"
                    class="h-7 w-20 rounded-lg border border-ss-border bg-ss-surface px-2 text-[12px] text-ss-text focus:border-ss-accent focus:outline-none"
                    aria-label="Price to view"
                    @blur="commit"
                    @keydown.enter.prevent="commit"
                    @keydown.esc.prevent="cancel"
                />
            </form>
            <button
                v-else
                type="button"
                class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                :class="
                    !priceOk
                        ? 'bg-ss-neg/15 text-ss-neg'
                        : props.ppv.price === 0
                          ? 'bg-ss-warn/15 text-ss-warn'
                          : 'bg-ss-accent-soft text-ss-accent-text'
                "
                title="Click to change the price"
                @click="startEdit"
            >
                <Tag :size="11" />
                {{
                    props.ppv.price === 0
                        ? 'Free'
                        : `Price to View: ${usd(props.ppv.price)}`
                }}
            </button>

            <button
                type="button"
                class="grid h-7 w-7 shrink-0 place-items-center rounded text-ss-text-3 hover:bg-ss-surface hover:text-ss-text-2"
                title="Remove the PPV set"
                @click="emit('remove')"
            >
                <X :size="14" />
            </button>
        </div>

        <div class="flex items-center gap-1.5">
            <div
                v-for="(m, i) in visible"
                :key="m.id"
                class="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-ss-surface"
            >
                <img
                    v-if="m.thumb"
                    :src="mediaSrc(props.modelId, m.thumb)"
                    alt=""
                    class="h-full w-full object-cover"
                    loading="lazy"
                />
                <span
                    v-else
                    class="grid h-full w-full place-items-center text-ss-text-3"
                >
                    <component :is="tileIcon(m)" :size="16" />
                </span>
                <span
                    v-if="m.type === 'video' && m.thumb"
                    class="absolute right-1 bottom-1 grid h-4 w-4 place-items-center rounded bg-black/60 text-white"
                >
                    <Film :size="10" />
                </span>
                <span
                    v-if="i === visible.length - 1 && overflow > 0"
                    class="absolute inset-0 grid place-items-center bg-black/60 text-[12px] font-bold text-white"
                    >+{{ overflow }}</span
                >
            </div>
        </div>

        <p v-if="!priceOk" class="mt-1.5 text-[11px] text-ss-neg">
            $3–$200, or free (0). Up to two decimals.
        </p>
    </div>
</template>
