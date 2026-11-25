<script setup lang="ts">
import { ImagePlus, LoaderCircle, Music, Play, X } from '@lucide/vue';
import { computed, nextTick, ref } from 'vue';
import SsVaultPickerModal from '@/components/crm/conversations/SsVaultPickerModal.vue';
import { isValidPpvPrice } from '@/lib/money';
import { mediaSrc, ofApi } from '@/lib/onlyfans';
import type { ScriptStep, ScriptStepMedia } from '@/types/crm';

/**
 * Create / edit a script step (manager+; the server gates the write): title, text with name
 * labels, fallback name, optional vault media, a price (only with media) and the script it
 * belongs to. The kind is never chosen — no media is a Text step, media at 0 is Free, media
 * with a price is a PPV. Validation mirrors ScriptController: a step needs text or media, a
 * price needs media, price free or $3–$200, at most 40 media.
 */
const props = defineProps<{
    modelId: number;
    step: ScriptStep | null; // null → create
    scriptId: number; // the step's script (create: the one "Add step" was clicked in)
    scripts: { id: number; name: string }[];
}>();
const emit = defineEmits<{ saved: []; close: [] }>();

const MAX_MEDIA = 40;
// The six tokens fillLabels understands, grouped by source; each button shows the case it inserts.
const LABEL_GROUPS = [
    {
        name: 'Fan name',
        labels: [
            { token: '{Fan Name}', sample: 'Jake' },
            { token: '{FAN NAME}', sample: 'JAKE' },
            { token: '{fan name}', sample: 'jake' },
        ],
    },
    {
        name: 'Custom name',
        labels: [
            { token: '{Custom Name}', sample: 'Big J' },
            { token: '{CUSTOM NAME}', sample: 'BIG J' },
            { token: '{custom name}', sample: 'big j' },
        ],
    },
];

const title = ref(props.step?.title ?? '');
const text = ref(props.step?.text ?? '');
const fallbackName = ref(props.step?.fallbackName ?? '');
const targetScript = ref(props.scriptId);
const media = ref<ScriptStepMedia[]>(
    (props.step?.media ?? []).map((m) => ({ ...m })),
);
// NB: Vue casts v-model on a type=number input to a number, so this holds string | number.
const price = ref<string | number>(
    props.step && props.step.media.length ? String(props.step.price) : '',
);
const textarea = ref<HTMLTextAreaElement | null>(null);
const showPicker = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

const hasMedia = computed(() => media.value.length > 0);
const priceText = computed(() => String(price.value).trim());
const priceNum = computed(() => {
    const n = Number(priceText.value.replace(/[$,\s]/g, ''));

    return priceText.value === '' || !Number.isFinite(n) ? NaN : n;
});
const priceOk = computed(
    () => !hasMedia.value || isValidPpvPrice(priceNum.value),
);
const mediaChanged = computed(() => {
    const was = (props.step?.media ?? []).map((m) => m.id);
    const now = media.value.map((m) => m.id);

    return was.length !== now.length || was.some((id, i) => id !== now[i]);
});
const problem = computed<string | null>(() => {
    if (title.value.trim() === '') {
        return 'Give the step a title.';
    }

    if (text.value.trim() === '' && !hasMedia.value) {
        return 'A step needs text or media.';
    }

    if (media.value.length > MAX_MEDIA) {
        return `At most ${MAX_MEDIA} media.`;
    }

    if (!priceOk.value) {
        return 'Price: free (0), or $3–$200.';
    }

    return null;
});

/** Insert a name label at the caret (or over the selection), keeping focus in the text. */
function insertLabel(label: string) {
    const el = textarea.value;
    const start = el?.selectionStart ?? text.value.length;
    const end = el?.selectionEnd ?? text.value.length;

    text.value = text.value.slice(0, start) + label + text.value.slice(end);
    nextTick(() => {
        if (el) {
            el.focus();
            el.setSelectionRange(start + label.length, start + label.length);
        }
    });
}

function onPicked(picked: ScriptStepMedia[]) {
    media.value = picked;
    showPicker.value = false;
}

function removeMedia(id: string) {
    media.value = media.value.filter((m) => m.id !== id);
}

function thumbSrc(m: ScriptStepMedia): string | null {
    return m.thumb ? mediaSrc(props.modelId, m.thumb) : null;
}

function nullable(v: string): string | null {
    const t = v.trim();

    return t === '' ? null : t;
}

async function save() {
    if (problem.value !== null || saving.value) {
        return;
    }

    saving.value = true;
    error.value = null;

    const body = {
        title: title.value.trim(),
        text: nullable(text.value),
        fallbackName: nullable(fallbackName.value),
        // Always sent: clearing a step's media must also clear its price, or the server 422s.
        price: hasMedia.value ? priceNum.value : 0,
    };

    try {
        if (props.step) {
            await ofApi.updateStep(props.modelId, props.step.id, {
                ...body,
                ...(mediaChanged.value ? { media: media.value } : {}),
                ...(targetScript.value !== props.step.scriptId
                    ? { scriptId: targetScript.value }
                    : {}),
            });
        } else {
            await ofApi.createStep(props.modelId, targetScript.value, {
                ...body,
                media: media.value,
            });
        }

        emit('saved');
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        saving.value = false;
    }
}
</script>

<template>
    <div
        class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 font-ss"
        @click.self="emit('close')"
    >
        <form
            class="flex max-h-[90vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-ss-border bg-ss-surface shadow-2xl"
            role="dialog"
            aria-modal="true"
            :aria-label="props.step ? 'Edit step' : 'New step'"
            data-testid="script-step-modal"
            @submit.prevent="save"
        >
            <div class="flex items-center gap-2 border-b border-ss-border p-3">
                <p class="text-[14px] font-semibold text-ss-text">
                    {{ props.step ? 'Edit step' : 'New step' }}
                </p>
                <span class="flex-1" />
                <button
                    type="button"
                    class="grid h-7 w-7 place-items-center rounded text-ss-text-3 hover:bg-ss-surface-2"
                    title="Close"
                    @click="emit('close')"
                >
                    <X :size="15" />
                </button>
            </div>

            <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
                <label class="block">
                    <span
                        class="mb-1 block text-[11px] font-semibold text-ss-text-2"
                        >Title</span
                    >
                    <input
                        v-model="title"
                        type="text"
                        maxlength="120"
                        required
                        placeholder="e.g. MS 1.7 (PPV)"
                        class="w-full rounded-lg border border-ss-border bg-ss-surface-2 px-2.5 py-1.5 text-[13px] text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
                    />
                </label>

                <div>
                    <label
                        for="script-step-text"
                        class="mb-1 block text-[11px] font-semibold text-ss-text-2"
                        >Text</label
                    >
                    <textarea
                        id="script-step-text"
                        ref="textarea"
                        v-model="text"
                        rows="4"
                        maxlength="2000"
                        placeholder="What the chatter sends. Notes in [brackets] are flagged before sending."
                        class="w-full resize-y rounded-lg border border-ss-border bg-ss-surface-2 px-2.5 py-1.5 text-[13px] leading-snug text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
                    />
                    <div
                        class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-ss-text-3"
                    >
                        <span>Insert name:</span>
                        <span
                            v-for="group in LABEL_GROUPS"
                            :key="group.name"
                            class="inline-flex items-center gap-1"
                        >
                            <span class="text-ss-text-2">{{ group.name }}</span>
                            <button
                                v-for="label in group.labels"
                                :key="label.token"
                                type="button"
                                class="rounded-md border border-ss-border px-1.5 py-px text-[11px] text-ss-text-2 transition-colors hover:border-ss-accent hover:text-ss-accent-text focus-visible:border-ss-accent focus-visible:outline-none"
                                :title="`Insert ${label.token} — filled with the ${group.name.toLowerCase()} when the step loads`"
                                :aria-label="`Insert ${label.token}`"
                                @click="insertLabel(label.token)"
                            >
                                {{ label.sample }}
                            </button>
                        </span>
                    </div>
                </div>

                <label class="block">
                    <span
                        class="mb-1 block text-[11px] font-semibold text-ss-text-2"
                        >Fallback name (optional)</span
                    >
                    <input
                        v-model="fallbackName"
                        type="text"
                        maxlength="60"
                        placeholder="e.g. babe — used when the fan has no name"
                        class="w-full rounded-lg border border-ss-border bg-ss-surface-2 px-2.5 py-1.5 text-[13px] text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
                    />
                </label>

                <!-- Media (optional) -->
                <div>
                    <div class="mb-1 flex items-center">
                        <span class="text-[11px] font-semibold text-ss-text-2"
                            >Media (optional)</span
                        >
                        <span
                            v-if="hasMedia"
                            class="ml-1.5 text-[11px] text-ss-text-3"
                            >{{ media.length }} / {{ MAX_MEDIA }}</span
                        >
                        <span class="flex-1" />
                        <button
                            v-if="hasMedia"
                            type="button"
                            class="flex items-center gap-1 text-[11px] font-semibold text-ss-accent-text hover:underline"
                            @click="showPicker = true"
                        >
                            <ImagePlus :size="12" /> Change media
                        </button>
                    </div>

                    <button
                        v-if="!hasMedia"
                        type="button"
                        class="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-ss-border bg-ss-surface-2 px-3 py-3 text-[12px] font-semibold text-ss-text-2 transition-colors hover:border-ss-accent hover:text-ss-accent-text"
                        @click="showPicker = true"
                    >
                        <ImagePlus :size="15" /> Add media from the vault
                    </button>

                    <ul v-else class="grid grid-cols-5 gap-1.5">
                        <li
                            v-for="m in media"
                            :key="m.id"
                            class="group relative aspect-square overflow-hidden rounded-lg border border-ss-border bg-ss-surface-2"
                        >
                            <img
                                v-if="thumbSrc(m)"
                                :src="thumbSrc(m) as string"
                                :alt="m.type"
                                class="h-full w-full object-cover"
                                loading="lazy"
                            />
                            <span
                                v-else
                                class="grid h-full w-full place-items-center text-ss-text-3"
                            >
                                <Music v-if="m.type === 'audio'" :size="16" />
                                <span
                                    v-else
                                    class="text-[9px] font-semibold uppercase"
                                    >{{ m.type }}</span
                                >
                            </span>
                            <span
                                v-if="m.type === 'video'"
                                class="absolute right-1 bottom-1 grid h-4 w-4 place-items-center rounded-full bg-black/70 text-white"
                            >
                                <Play :size="8" fill="currentColor" />
                            </span>
                            <button
                                type="button"
                                class="absolute top-0.5 right-0.5 grid h-5 w-5 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-ss-neg focus:opacity-100"
                                :title="`Remove this ${m.type}`"
                                @click="removeMedia(m.id)"
                            >
                                <X :size="11" />
                            </button>
                        </li>
                    </ul>
                </div>

                <!-- Price only means something with media (a price needs media). -->
                <label v-if="hasMedia" class="block">
                    <span
                        class="mb-1 block text-[11px] font-semibold text-ss-text-2"
                        >Price to view ($)</span
                    >
                    <input
                        v-model="price"
                        type="number"
                        inputmode="decimal"
                        min="0"
                        max="200"
                        step="any"
                        required
                        placeholder="0 for free"
                        aria-label="Price to view"
                        class="w-full rounded-lg border bg-ss-surface-2 px-2.5 py-1.5 text-[13px] text-ss-text placeholder:text-ss-text-3 focus:outline-none"
                        :class="
                            priceText !== '' && !priceOk
                                ? 'border-ss-neg'
                                : 'border-ss-border focus:border-ss-accent'
                        "
                    />
                    <span class="mt-1 block text-[11px] text-ss-text-3"
                        >Free (0), or $3–$200.</span
                    >
                </label>

                <label class="block">
                    <span
                        class="mb-1 block text-[11px] font-semibold text-ss-text-2"
                        >Script</span
                    >
                    <select
                        v-model="targetScript"
                        class="w-full rounded-lg border border-ss-border bg-ss-surface-2 px-2 py-1.5 text-[13px] text-ss-text focus:border-ss-accent focus:outline-none"
                    >
                        <option
                            v-for="s in props.scripts"
                            :key="s.id"
                            :value="s.id"
                        >
                            {{ s.name }}
                        </option>
                    </select>
                </label>

                <p v-if="error" class="text-[12px] text-ss-neg">{{ error }}</p>
            </div>

            <div class="flex items-center gap-2 border-t border-ss-border p-3">
                <p
                    v-if="problem && (title || text || hasMedia)"
                    class="min-w-0 flex-1 truncate text-[11px] text-ss-text-3"
                >
                    {{ problem }}
                </p>
                <span v-else class="flex-1" />
                <button
                    type="button"
                    class="rounded-lg border border-ss-border px-3 py-1.5 text-[12px] font-semibold text-ss-text-2 hover:bg-ss-surface-2"
                    @click="emit('close')"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    :disabled="problem !== null || saving"
                    class="flex items-center gap-1.5 rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                    <LoaderCircle
                        v-if="saving"
                        :size="13"
                        class="animate-spin"
                    />
                    {{ props.step ? 'Save' : 'Add step' }}
                </button>
            </div>
        </form>

        <SsVaultPickerModal
            v-if="showPicker"
            :model-id="props.modelId"
            :initial="media"
            :max="MAX_MEDIA"
            @add="onPicked"
            @close="showPicker = false"
        />
    </div>
</template>
