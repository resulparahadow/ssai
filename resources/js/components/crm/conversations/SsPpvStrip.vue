<script setup lang="ts">
import {
    AlertTriangle,
    Film,
    Image as ImageIcon,
    Lock,
    Music,
    Sparkles,
    Tag,
    X,
} from '@lucide/vue';
import { computed, nextTick, ref, watch } from 'vue';
import { isValidPpvPrice, usd } from '@/lib/money';
import { mediaSrc } from '@/lib/onlyfans';
import { parsePpvPriceInput, priceSuggestionView } from '@/lib/ppvComposer';
import type { ComposerStep, ScriptStepMedia } from '@/types/crm';

/**
 * A loaded script step WITH media, shown above the typing bar: step title, media tiles, and
 * the editable "Price to View" chip (CreatorHero's composer, which the team is used to). Price edits are
 * validated against the vendor rule (free, or $3–$200) so Send stays disabled on a bad value
 * instead of paying for a vendor 422.
 */
const props = defineProps<{
    step: ComposerStep;
    modelId: number;
    generating: boolean;
}>();
const emit = defineEmits<{
    'update:price': [value: number];
    'update:media': [value: ScriptStepMedia[]];
    remove: [];
}>();

const MAX_TILES = 6;

const visible = computed(() => props.step.media.slice(0, MAX_TILES));
const overflow = computed(() =>
    Math.max(0, props.step.media.length - MAX_TILES),
);
const priceOk = computed(() => isValidPpvPrice(props.step.price));

// The AI's price read, beside the chip. Advice only: "Use" is the one way it reaches the price.
// A free step is captioned without a price read (its suggestion is discarded), so it never
// shows "AI pricing…" either.
const aiPrice = computed(() =>
    priceSuggestionView(
        props.step.priceSuggestion,
        props.generating && props.step.price > 0,
        props.step.price,
    ),
);

// Inline price editor: a chip that turns into a number input on click.
const editing = ref(false);
// NB: Vue casts v-model on a type=number input to a number, so this holds string | number.
const draftPrice = ref<string | number>(String(props.step.price));
const input = ref<HTMLInputElement | null>(null);

watch(
    () => props.step.price,
    (p) => {
        if (!editing.value) {
            draftPrice.value = String(p);
        }
    },
);

function startEdit() {
    draftPrice.value = String(props.step.price);
    editing.value = true;
    nextTick(() => input.value?.select());
}

function commit() {
    // An empty/junk edit reverts to the previous price — never to free (lib/ppvComposer.ts).
    emit(
        'update:price',
        parsePpvPriceInput(draftPrice.value, props.step.price),
    );
    editing.value = false;
}

function cancel() {
    editing.value = false;
    draftPrice.value = String(props.step.price);
}

// Tiles whose thumbnail failed to load. Usually the item was deleted from the creator's vault
// after the step was saved (verified live: the vault then 404s the id), so sending it would
// fail too; a stale CDN link looks the same from here, hence "didn't load", not "deleted".
const broken = ref(new Set<string>());

watch(
    () => props.step.stepId,
    () => (broken.value = new Set()),
);

function markBroken(id: string) {
    broken.value = new Set(broken.value).add(id);
}

const brokenCount = computed(
    () => props.step.media.filter((m) => broken.value.has(m.id)).length,
);

/** Drop the items that didn't load from THIS send only — the saved step is untouched. */
function removeBroken() {
    const kept = props.step.media.filter((m) => !broken.value.has(m.id));

    if (kept.length === 0) {
        emit('remove');
    } else {
        emit('update:media', kept);
    }
}

function tileIcon(m: ScriptStepMedia) {
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
                Script · {{ props.step.title }}
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
                        : props.step.price === 0
                          ? 'bg-ss-warn/15 text-ss-warn'
                          : 'bg-ss-accent-soft text-ss-accent-text'
                "
                title="Click to change the price"
                @click="startEdit"
            >
                <Tag :size="11" />
                {{
                    props.step.price === 0
                        ? 'Free'
                        : `Price to View: ${usd(props.step.price)}`
                }}
            </button>

            <button
                type="button"
                class="grid h-7 w-7 shrink-0 place-items-center rounded text-ss-text-3 hover:bg-ss-surface hover:text-ss-text-2"
                title="Remove the script (media and price go with it)"
                @click="emit('remove')"
            >
                <X :size="14" />
            </button>
        </div>

        <div
            v-if="aiPrice.kind !== 'none'"
            class="mb-2 flex min-w-0 items-center gap-1.5 text-[11px]"
            data-testid="ppv-ai-price"
        >
            <Sparkles :size="11" class="shrink-0 text-ss-text-3" />
            <span
                v-if="aiPrice.kind === 'pricing'"
                class="text-ss-text-3 italic"
                >AI pricing…</span
            >
            <span
                v-else-if="aiPrice.kind === 'error'"
                class="text-ss-text-3"
                :title="aiPrice.error"
                >AI price unavailable</span
            >
            <template
                v-else-if="aiPrice.kind === 'agree' || aiPrice.kind === 'offer'"
            >
                <span
                    class="min-w-0 truncate text-ss-text-2"
                    :title="aiPrice.reason"
                >
                    <b class="font-semibold text-ss-text">
                        {{ aiPrice.kind === 'agree' ? 'AI agrees:' : 'AI:' }}
                        {{ usd(aiPrice.price) }}
                    </b>
                    <template v-if="aiPrice.reason">
                        · {{ aiPrice.reason }}</template
                    >
                </span>
                <button
                    v-if="aiPrice.kind === 'offer'"
                    type="button"
                    class="shrink-0 rounded-full border border-ss-border px-2 py-0.5 font-semibold text-ss-accent-text hover:bg-ss-accent-soft"
                    :title="`Set the price to ${usd(aiPrice.price)}`"
                    @click="emit('update:price', aiPrice.price)"
                >
                    Use
                </button>
            </template>
        </div>

        <div class="flex items-center gap-1.5">
            <div
                v-for="(m, i) in visible"
                :key="m.id"
                class="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-ss-surface"
                :class="broken.has(m.id) ? 'ring-1 ring-ss-neg/50' : ''"
                :title="
                    broken.has(m.id)
                        ? 'This item didn\'t load — it may have been deleted from the vault'
                        : undefined
                "
            >
                <img
                    v-if="m.thumb && !broken.has(m.id)"
                    :src="mediaSrc(props.modelId, m.thumb)"
                    alt=""
                    class="h-full w-full object-cover"
                    loading="lazy"
                    @error="markBroken(m.id)"
                />
                <span
                    v-else-if="broken.has(m.id)"
                    class="grid h-full w-full place-items-center bg-ss-neg/10 text-ss-neg"
                >
                    <AlertTriangle :size="16" />
                </span>
                <span
                    v-else
                    class="grid h-full w-full place-items-center text-ss-text-3"
                >
                    <component :is="tileIcon(m)" :size="16" />
                </span>
                <span
                    v-if="m.type === 'video' && m.thumb && !broken.has(m.id)"
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

        <div
            v-if="brokenCount > 0"
            class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ss-text"
            data-testid="ppv-broken"
        >
            <AlertTriangle :size="13" class="shrink-0 text-ss-neg" />
            <span class="min-w-0 flex-1">
                {{ brokenCount }}
                {{ brokenCount === 1 ? "item didn't" : "items didn't" }}
                load. They may have been deleted from the vault.
            </span>
            <button
                type="button"
                class="shrink-0 rounded-full border border-ss-border px-2 py-0.5 text-[11px] font-semibold text-ss-text-2 hover:bg-ss-surface hover:text-ss-text"
                title="Send without them — the saved script is not changed"
                @click="removeBroken"
            >
                Remove from this send
            </button>
        </div>

        <p v-if="!priceOk" class="mt-1.5 text-[11px] text-ss-neg">
            $3–$200, or free (0). Up to two decimals.
        </p>
    </div>
</template>
