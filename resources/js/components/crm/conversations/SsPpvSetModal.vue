<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { Images, LoaderCircle, X } from '@lucide/vue';
import { computed, ref } from 'vue';
import { isValidPpvPrice } from '@/lib/money';
import { ofApi } from '@/lib/onlyfans';
import type { PpvSet, PpvSetMedia } from '@/types/crm';

/**
 * Create / edit a PPV set's name, price and caption (manager+; the server gates the write).
 * `set` null → create with `media` (the Media Vault selection); else update the metadata of
 * `set` — its media is re-picked in the Media Vault (`/media-vault?ppvSet=<id>`, linked below),
 * which has the grid and the folders this modal does not.
 */
const props = defineProps<{
    modelId: number;
    set: PpvSet | null;
    media: PpvSetMedia[];
}>();
const emit = defineEmits<{ saved: [set: PpvSet]; close: [] }>();

const name = ref(props.set?.name ?? '');
// NB: Vue casts v-model on a type=number input to a number, so this holds string | number.
const price = ref<string | number>(props.set ? String(props.set.price) : '');
const caption = ref(props.set?.caption ?? '');
const saving = ref(false);
const error = ref<string | null>(null);

const priceText = computed(() => String(price.value).trim());
const priceNum = computed(() => {
    const n = Number(priceText.value.replace(/[$,\s]/g, ''));

    return priceText.value === '' || !Number.isFinite(n) ? NaN : n;
});
const priceOk = computed(() => isValidPpvPrice(priceNum.value));
const mediaCount = computed(() =>
    props.set ? props.set.media.length : props.media.length,
);
const valid = computed(
    () => name.value.trim().length > 0 && priceOk.value && mediaCount.value > 0,
);

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
            ? await ofApi.updatePpvSet(props.modelId, props.set.id, body)
            : await ofApi.createPpvSet(props.modelId, {
                  ...body,
                  media: props.media,
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
        class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
        @click.self="emit('close')"
    >
        <form
            class="w-full max-w-sm overflow-hidden rounded-2xl border border-ss-border bg-ss-surface shadow-2xl"
            @submit.prevent="save"
        >
            <div class="flex items-center gap-2 border-b border-ss-border p-3">
                <p class="text-[14px] font-semibold text-ss-text">
                    {{ props.set ? 'Edit PPV set' : 'Save as PPV set' }}
                </p>
                <span class="flex-1" />
                <button
                    type="button"
                    class="grid h-7 w-7 place-items-center rounded text-ss-text-3 hover:bg-ss-surface-2"
                    @click="emit('close')"
                >
                    <X :size="15" />
                </button>
            </div>

            <div class="space-y-3 p-3">
                <p
                    class="flex flex-wrap items-center gap-x-2 text-[12px] text-ss-text-3"
                >
                    <span
                        >{{ mediaCount }} media item{{
                            mediaCount === 1 ? '' : 's'
                        }}</span
                    >
                    <Link
                        v-if="props.set"
                        :href="`/media-vault?ppvSet=${props.set.id}`"
                        class="inline-flex items-center gap-1 font-semibold text-ss-accent-text hover:underline"
                        title="Open the Media Vault with this set's media pre-selected"
                    >
                        <Images :size="12" /> Change media in Media Vault
                    </Link>
                </p>

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
                    class="flex items-center gap-1.5 rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50"
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
    </div>
</template>
