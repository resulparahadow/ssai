<script setup lang="ts">
import { ImagePlus, LoaderCircle, Music, Play, X } from '@lucide/vue';
import { computed, ref } from 'vue';
import SsVaultPickerModal from '@/components/crm/conversations/SsVaultPickerModal.vue';
import { isValidPpvPrice } from '@/lib/money';
import { mediaSrc, ofApi } from '@/lib/onlyfans';
import type { PpvSet, PpvSetMedia } from '@/types/crm';

/**
 * Create / edit a PPV set — name, price, caption AND media — in one place (manager+; the server
 * gates the write). Media is picked in `SsVaultPickerModal` (folders + grid, multi-select), so
 * the Media Vault page stays a browsing surface and never has to know about PPV sets.
 * `set` null → create; else update, sending `media` only when it actually changed.
 */
const props = withDefaults(
    defineProps<{
        modelId: number;
        set: PpvSet | null;
        /** Starting media for a NEW set (optional). */
        media?: PpvSetMedia[];
    }>(),
    { media: () => [] },
);
const emit = defineEmits<{ saved: [set: PpvSet]; close: [] }>();

const MAX_MEDIA = 40;

const name = ref(props.set?.name ?? '');
// NB: Vue casts v-model on a type=number input to a number, so this holds string | number.
const price = ref<string | number>(props.set ? String(props.set.price) : '');
const caption = ref(props.set?.caption ?? '');
const media = ref<PpvSetMedia[]>(
    (props.set ? props.set.media : props.media).map((m) => ({ ...m })),
);
const showPicker = ref(false);
const saving = ref(false);
const error = ref<string | null>(null);

const priceText = computed(() => String(price.value).trim());
const priceNum = computed(() => {
    const n = Number(priceText.value.replace(/[$,\s]/g, ''));

    return priceText.value === '' || !Number.isFinite(n) ? NaN : n;
});
const priceOk = computed(() => isValidPpvPrice(priceNum.value));
const mediaChanged = computed(() => {
    const was = (props.set?.media ?? []).map((m) => m.id);
    const now = media.value.map((m) => m.id);

    return was.length !== now.length || was.some((id, i) => id !== now[i]);
});
const valid = computed(
    () =>
        name.value.trim().length > 0 &&
        priceOk.value &&
        media.value.length > 0 &&
        media.value.length <= MAX_MEDIA,
);

function onPicked(picked: PpvSetMedia[]) {
    media.value = picked;
    showPicker.value = false;
}

function removeMedia(id: string) {
    media.value = media.value.filter((m) => m.id !== id);
}

function thumbSrc(m: PpvSetMedia): string | null {
    return m.thumb ? mediaSrc(props.modelId, m.thumb) : null;
}

async function save() {
    if (!valid.value || saving.value) {
        return;
    }

    saving.value = true;
    error.value = null;

    const body = {
        name: name.value.trim(),
        price: priceNum.value,
        caption: caption.value.trim() === '' ? null : caption.value.trim(),
    };

    try {
        const res = props.set
            ? await ofApi.updatePpvSet(props.modelId, props.set.id, {
                  ...body,
                  ...(mediaChanged.value ? { media: media.value } : {}),
              })
            : await ofApi.createPpvSet(props.modelId, {
                  ...body,
                  media: media.value,
              });
        emit('saved', res.set);
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
            @submit.prevent="save"
        >
            <div class="flex items-center gap-2 border-b border-ss-border p-3">
                <p class="text-[14px] font-semibold text-ss-text">
                    {{ props.set ? 'Edit PPV set' : 'New PPV set' }}
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
                <!-- Media -->
                <div>
                    <div class="mb-1 flex items-center">
                        <span class="text-[11px] font-semibold text-ss-text-2"
                            >Media</span
                        >
                        <span class="ml-1.5 text-[11px] text-ss-text-3"
                            >{{ media.length }} / {{ MAX_MEDIA }}</span
                        >
                        <span class="flex-1" />
                        <button
                            v-if="media.length"
                            type="button"
                            class="flex items-center gap-1 text-[11px] font-semibold text-ss-accent-text hover:underline"
                            @click="showPicker = true"
                        >
                            <ImagePlus :size="12" /> Change media
                        </button>
                    </div>

                    <button
                        v-if="!media.length"
                        type="button"
                        class="flex w-full flex-col items-center gap-1.5 rounded-xl border border-dashed border-ss-border bg-ss-surface-2 px-3 py-6 text-center transition-colors hover:border-ss-accent"
                        @click="showPicker = true"
                    >
                        <ImagePlus :size="20" class="text-ss-accent-text" />
                        <span class="text-[12px] font-semibold text-ss-text"
                            >Add media from the vault</span
                        >
                        <span class="text-[11px] text-ss-text-3"
                            >Photos, videos, GIFs or audio — up to
                            {{ MAX_MEDIA }}</span
                        >
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
                        <li>
                            <button
                                type="button"
                                class="grid aspect-square w-full place-items-center rounded-lg border border-dashed border-ss-border text-ss-text-3 transition-colors hover:border-ss-accent hover:text-ss-accent-text"
                                title="Add more media"
                                @click="showPicker = true"
                            >
                                <ImagePlus :size="16" />
                            </button>
                        </li>
                    </ul>
                </div>

                <label class="block">
                    <span
                        class="mb-1 block text-[11px] font-semibold text-ss-text-2"
                        >Name</span
                    >
                    <input
                        v-model="name"
                        type="text"
                        maxlength="120"
                        required
                        placeholder="e.g. Red lingerie tease"
                        class="w-full rounded-lg border border-ss-border bg-ss-surface-2 px-2.5 py-1.5 text-[13px] text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
                    />
                </label>

                <label class="block">
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
                        step="1"
                        required
                        placeholder="20"
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
                        >Default caption (optional)</span
                    >
                    <textarea
                        v-model="caption"
                        rows="3"
                        maxlength="2000"
                        placeholder="Loaded into the typing bar — Generate caption rewrites it for the fan"
                        class="w-full resize-none rounded-lg border border-ss-border bg-ss-surface-2 px-2.5 py-1.5 text-[13px] leading-snug text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
                    />
                </label>

                <p v-if="error" class="text-[12px] text-ss-neg">{{ error }}</p>
            </div>

            <div
                class="flex items-center justify-end gap-2 border-t border-ss-border p-3"
            >
                <button
                    type="button"
                    class="rounded-lg border border-ss-border px-3 py-1.5 text-[12px] font-semibold text-ss-text-2 hover:bg-ss-surface-2"
                    @click="emit('close')"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    :disabled="!valid || saving"
                    class="flex items-center gap-1.5 rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                >
                    <LoaderCircle
                        v-if="saving"
                        :size="13"
                        class="animate-spin"
                    />
                    {{ props.set ? 'Save' : 'Create set' }}
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
