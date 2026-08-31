<script setup lang="ts">
import { LoaderCircle, Plus, Square, Trash2 } from '@lucide/vue';
import { onMounted, reactive, ref } from 'vue';
import { ofModel } from '@/lib/onlyfansModel';
import type { OfBundle, OfPromotion } from '@/types/crm';

const props = defineProps<{ modelId: number }>();

type Kind = 'promotions' | 'bundles';
const KINDS: { key: Kind; label: string }[] = [
    { key: 'promotions', label: 'Promotions' },
    { key: 'bundles', label: 'Subscription bundles' },
];
const kind = ref<Kind>('promotions');

const promotions = ref<OfPromotion[]>([]);
const bundles = ref<OfBundle[]>([]);
const loaded = reactive<Record<Kind, boolean>>({
    promotions: false,
    bundles: false,
});
const loading = ref(false);
const error = ref<string | null>(null);

const showCreate = ref(false);
const creating = ref(false);
const busy = ref<string | null>(null);

// promotion form
const pType = ref<'new' | 'expired' | 'new_and_expired'>('new');
const pDiscount = ref(50);
const pOfferLimit = ref(0);
const pExpirationDays = ref(7);
const pFreeTrialDays = ref(7);
const pMessage = ref('');
// bundle form
const bDiscount = ref(10);
const bDuration = ref(3);

const PROMO_TYPES: { value: typeof pType.value; label: string }[] = [
    { value: 'new', label: 'New subscribers' },
    { value: 'expired', label: 'Expired subscribers' },
    { value: 'new_and_expired', label: 'New & expired' },
];
const DISCOUNTS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
const DURATIONS = [3, 6, 12];

async function load(k: Kind) {
    loading.value = true;
    error.value = null;

    try {
        if (k === 'promotions') {
            promotions.value = (
                await ofModel.promotions(props.modelId, { limit: 25 })
            ).promotions;
        } else {
            bundles.value = (await ofModel.bundles(props.modelId)).bundles;
        }

        loaded[k] = true;
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to load.';
    } finally {
        loading.value = false;
    }
}

function switchKind(k: Kind) {
    if (kind.value === k) {
        return;
    }

    kind.value = k;
    showCreate.value = false;

    if (!loaded[k]) {
        load(k);
    }
}

async function create() {
    creating.value = true;
    error.value = null;

    try {
        if (kind.value === 'promotions') {
            await ofModel.createPromotion(props.modelId, {
                type: pType.value,
                discount: pDiscount.value,
                offerLimit: pOfferLimit.value,
                expirationDays: pExpirationDays.value,
                freeTrialDays:
                    pDiscount.value === 100 ? pFreeTrialDays.value : undefined,
                message: pMessage.value.trim() || undefined,
            });
            pMessage.value = '';
        } else {
            await ofModel.createBundle(props.modelId, {
                discount: bDiscount.value,
                duration: bDuration.value,
            });
        }

        showCreate.value = false;
        loaded[kind.value] = false;
        await load(kind.value);
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to create.';
    } finally {
        creating.value = false;
    }
}

async function stopPromo(id: string | null) {
    if (!id || !confirm('Stop this promotion? Fans can no longer claim it.')) {
        return;
    }

    busy.value = id;

    try {
        await ofModel.stopPromotion(props.modelId, id);
        loaded.promotions = false;
        await load('promotions');
    } catch (e) {
        error.value =
            e instanceof Error ? e.message : 'Failed to stop promotion.';
    } finally {
        busy.value = null;
    }
}

async function removePromo(id: string | null) {
    if (!id || !confirm('Delete this promotion? This cannot be undone.')) {
        return;
    }

    busy.value = id;

    try {
        await ofModel.deletePromotion(props.modelId, id);
        loaded.promotions = false;
        await load('promotions');
    } catch (e) {
        error.value =
            e instanceof Error ? e.message : 'Failed to delete promotion.';
    } finally {
        busy.value = null;
    }
}

async function removeBundle(id: string | null) {
    if (!id || !confirm('Delete this bundle? This cannot be undone.')) {
        return;
    }

    busy.value = id;

    try {
        await ofModel.deleteBundle(props.modelId, id);
        loaded.bundles = false;
        await load('bundles');
    } catch (e) {
        error.value =
            e instanceof Error ? e.message : 'Failed to delete bundle.';
    } finally {
        busy.value = null;
    }
}

function promoLabel(t: string | null): string {
    return PROMO_TYPES.find((x) => x.value === t)?.label ?? t ?? 'Promotion';
}

onMounted(() => load('promotions'));
</script>

<template>
    <div class="space-y-3">
        <div class="flex items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-1.5">
                <button
                    v-for="k in KINDS"
                    :key="k.key"
                    type="button"
                    class="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors"
                    :class="
                        kind === k.key
                            ? 'bg-ss-surface-2 text-ss-text'
                            : 'text-ss-text-3 hover:text-ss-text-2'
                    "
                    @click="switchKind(k.key)"
                >
                    {{ k.label }}
                </button>
            </div>
            <button
                type="button"
                class="flex shrink-0 items-center gap-1 rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white"
                @click="showCreate = !showCreate"
            >
                <Plus :size="14" /> New
                {{ kind === 'promotions' ? 'promotion' : 'bundle' }}
            </button>
        </div>

        <!-- create form -->
        <div
            v-if="showCreate"
            class="space-y-3 rounded-xl border border-ss-border bg-ss-surface p-4"
        >
            <template v-if="kind === 'promotions'">
                <div class="grid gap-3 sm:grid-cols-2">
                    <label class="block">
                        <span class="mb-1 block text-[12px] text-ss-text-2"
                            >Audience</span
                        >
                        <select
                            v-model="pType"
                            class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                        >
                            <option
                                v-for="t in PROMO_TYPES"
                                :key="t.value"
                                :value="t.value"
                            >
                                {{ t.label }}
                            </option>
                        </select>
                    </label>
                    <label class="block">
                        <span class="mb-1 block text-[12px] text-ss-text-2"
                            >Discount (%)</span
                        >
                        <input
                            v-model.number="pDiscount"
                            type="number"
                            min="0"
                            max="100"
                            class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                        />
                    </label>
                    <label class="block">
                        <span class="mb-1 block text-[12px] text-ss-text-2"
                            >Subscriber limit (0 = no limit)</span
                        >
                        <input
                            v-model.number="pOfferLimit"
                            type="number"
                            min="0"
                            class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                        />
                    </label>
                    <label class="block">
                        <span class="mb-1 block text-[12px] text-ss-text-2"
                            >Expires in (days)</span
                        >
                        <input
                            v-model.number="pExpirationDays"
                            type="number"
                            min="1"
                            class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                        />
                    </label>
                    <label v-if="pDiscount === 100" class="block">
                        <span class="mb-1 block text-[12px] text-ss-text-2"
                            >Free trial days</span
                        >
                        <input
                            v-model.number="pFreeTrialDays"
                            type="number"
                            min="0"
                            class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                        />
                    </label>
                </div>
                <label class="block">
                    <span class="mb-1 block text-[12px] text-ss-text-2"
                        >Message (optional)</span
                    >
                    <textarea
                        v-model="pMessage"
                        rows="2"
                        maxlength="1000"
                        placeholder="Limited-time offer just for you 💕"
                        class="w-full resize-y rounded-lg border border-ss-border bg-ss-bg p-2.5 text-[13px] text-ss-text focus:border-ss-accent focus:outline-none"
                    />
                </label>
            </template>
            <template v-else>
                <div class="grid gap-3 sm:grid-cols-2">
                    <label class="block">
                        <span class="mb-1 block text-[12px] text-ss-text-2"
                            >Discount (%)</span
                        >
                        <select
                            v-model.number="bDiscount"
                            class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                        >
                            <option v-for="d in DISCOUNTS" :key="d" :value="d">
                                {{ d }}%
                            </option>
                        </select>
                    </label>
                    <label class="block">
                        <span class="mb-1 block text-[12px] text-ss-text-2"
                            >Duration (months)</span
                        >
                        <select
                            v-model.number="bDuration"
                            class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                        >
                            <option v-for="d in DURATIONS" :key="d" :value="d">
                                {{ d }} months
                            </option>
                        </select>
                    </label>
                </div>
            </template>
            <div class="flex items-center gap-2">
                <button
                    type="button"
                    class="rounded-lg bg-ss-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                    :disabled="creating"
                    @click="create"
                >
                    {{
                        creating
                            ? 'Creating…'
                            : `Create ${kind === 'promotions' ? 'promotion' : 'bundle'}`
                    }}
                </button>
                <button
                    type="button"
                    class="rounded-lg border border-ss-border px-4 py-2 text-[13px] font-medium text-ss-text-2 hover:bg-ss-surface-2"
                    @click="showCreate = false"
                >
                    Cancel
                </button>
            </div>
        </div>

        <p
            v-if="error"
            class="rounded-lg border border-ss-border bg-ss-surface p-4 text-center text-[12px] text-ss-neg"
        >
            {{ error }}
        </p>

        <!-- Promotions list -->
        <div v-if="kind === 'promotions'">
            <div
                v-if="promotions.length"
                class="overflow-hidden rounded-xl border border-ss-border bg-ss-surface"
            >
                <div
                    v-for="p in promotions"
                    :key="p.id ?? ''"
                    class="flex items-center gap-3 border-b border-ss-border p-3 last:border-b-0"
                >
                    <div class="min-w-0 flex-1">
                        <div
                            class="flex items-center gap-1.5 text-[13px] font-medium text-ss-text"
                        >
                            <span class="truncate">{{
                                promoLabel(p.type)
                            }}</span>
                            <span
                                class="rounded bg-ss-surface-2 px-1.5 py-0.5 text-[10px] text-ss-text-3"
                                >{{ p.subscribeDays }}d</span
                            >
                            <span
                                v-if="p.isFinished"
                                class="rounded bg-ss-neg/10 px-1.5 py-0.5 text-[10px] text-ss-neg"
                                >Finished</span
                            >
                            <span
                                v-else-if="p.canClaim"
                                class="rounded bg-ss-pos/10 px-1.5 py-0.5 text-[10px] text-ss-pos"
                                >Active</span
                            >
                        </div>
                        <div
                            v-if="p.message"
                            class="truncate text-[11px] text-ss-text-3"
                        >
                            {{ p.message }}
                        </div>
                    </div>
                    <div class="shrink-0 text-right text-[11px] text-ss-text-3">
                        <div class="text-[13px] font-semibold text-ss-text">
                            ${{ p.price.toFixed(2) }}
                        </div>
                        {{ p.claimsCount }} claims ·
                        {{ p.subscribeCounts }} subs
                    </div>
                    <button
                        v-if="!p.isFinished"
                        type="button"
                        class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-warn disabled:opacity-50"
                        title="Stop"
                        :disabled="busy === p.id"
                        @click="stopPromo(p.id)"
                    >
                        <Square :size="14" />
                    </button>
                    <button
                        type="button"
                        class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-neg disabled:opacity-50"
                        title="Delete"
                        :disabled="busy === p.id"
                        @click="removePromo(p.id)"
                    >
                        <Trash2 :size="15" />
                    </button>
                </div>
            </div>
            <p
                v-else-if="!loading"
                class="rounded-xl border border-ss-border bg-ss-surface p-6 text-center text-[13px] text-ss-text-3"
            >
                No promotions yet.
            </p>
        </div>

        <!-- Bundles list -->
        <div v-else>
            <div
                v-if="bundles.length"
                class="overflow-hidden rounded-xl border border-ss-border bg-ss-surface"
            >
                <div
                    v-for="b in bundles"
                    :key="b.id ?? ''"
                    class="flex items-center gap-3 border-b border-ss-border p-3 last:border-b-0"
                >
                    <div class="min-w-0 flex-1">
                        <div
                            class="flex items-center gap-1.5 text-[13px] font-medium text-ss-text"
                        >
                            <span>{{ b.duration }} months</span>
                            <span
                                class="rounded bg-ss-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-ss-accent-text"
                                >{{ b.discount }}% off</span
                            >
                            <span
                                v-if="!b.canBuy"
                                class="rounded bg-ss-surface-2 px-1.5 py-0.5 text-[10px] text-ss-text-3"
                                >Unavailable</span
                            >
                        </div>
                    </div>
                    <div
                        class="shrink-0 text-right text-[13px] font-semibold text-ss-text"
                    >
                        ${{ b.price.toFixed(2) }}
                    </div>
                    <button
                        type="button"
                        class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-neg disabled:opacity-50"
                        title="Delete"
                        :disabled="busy === b.id"
                        @click="removeBundle(b.id)"
                    >
                        <Trash2 :size="15" />
                    </button>
                </div>
            </div>
            <p
                v-else-if="!loading"
                class="rounded-xl border border-ss-border bg-ss-surface p-6 text-center text-[13px] text-ss-text-3"
            >
                No subscription bundles yet.
            </p>
        </div>

        <div v-if="loading" class="flex justify-center">
            <LoaderCircle :size="18" class="animate-spin text-ss-text-3" />
        </div>
    </div>
</template>
