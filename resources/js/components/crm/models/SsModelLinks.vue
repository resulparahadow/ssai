<script setup lang="ts">
import { BarChart3, Copy, LoaderCircle, Plus, Trash2 } from '@lucide/vue';
import { onMounted, reactive, ref } from 'vue';
import SsModelLinkTags from '@/components/crm/models/SsModelLinkTags.vue';
import SsModelSmartLinks from '@/components/crm/models/SsModelSmartLinks.vue';
import { ofModel } from '@/lib/onlyfansModel';
import type { OfLinkStats, OfTrackingLink, OfTrialLink } from '@/types/crm';

const props = defineProps<{ modelId: number }>();

type Kind = 'trial' | 'tracking' | 'smart' | 'tags';
const KINDS: { key: Kind; label: string }[] = [
    { key: 'trial', label: 'Free trial' },
    { key: 'tracking', label: 'Tracking' },
    { key: 'smart', label: 'Smart links' },
    { key: 'tags', label: 'Link tags' },
];
const kind = ref<Kind>('trial');
// child-driven subtabs (smart/tags) are lazy-mounted on first open, then kept alive.
const visited = reactive(new Set<Kind>(['trial']));

const tracking = ref<OfTrackingLink[]>([]);
const trial = ref<OfTrialLink[]>([]);
const loaded = reactive<Record<Kind, boolean>>({
    trial: false,
    tracking: false,
    smart: false,
    tags: false,
});
const loading = ref(false);
const error = ref<string | null>(null);

const showCreate = ref(false);
const creating = ref(false);

// tracking form
const tName = ref('');
const tTags = ref('');
// trial form
const trName = ref('');
const trTags = ref('');
const trDuration = ref(30);
const trExpiration = ref(0);
const trLimit = ref(0);

const DURATIONS = [1, 3, 7, 14, 30, 90, 180, 360];
const LIMITS = [0, 1, 2, 3, 5, 10, 50, 100];

// per-link stats cache
const stats = reactive<Record<string, OfLinkStats | 'loading'>>({});
const expanded = ref<string | null>(null);

async function load(k: Kind) {
    loading.value = true;
    error.value = null;

    try {
        if (k === 'tracking') {
            tracking.value = (
                await ofModel.trackingLinks(props.modelId, { limit: 20 })
            ).links;
        } else {
            trial.value = (
                await ofModel.trialLinks(props.modelId, { limit: 20 })
            ).links;
        }

        loaded[k] = true;
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to load links.';
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
    expanded.value = null;
    visited.add(k);

    if ((k === 'tracking' || k === 'trial') && !loaded[k]) {
        load(k);
    }
}

async function toggleStats(k: Kind, id: string | null) {
    if (!id) {
        return;
    }

    const key = `${k}:${id}`;

    if (expanded.value === key) {
        expanded.value = null;

        return;
    }

    expanded.value = key;

    if (!stats[key]) {
        stats[key] = 'loading';

        try {
            const r =
                k === 'tracking'
                    ? await ofModel.trackingLinkStats(props.modelId, id)
                    : await ofModel.trialLinkStats(props.modelId, id);
            stats[key] = r.stats;
        } catch {
            delete stats[key];
            expanded.value = null;
        }
    }
}

async function create() {
    creating.value = true;
    error.value = null;

    try {
        if (kind.value === 'tracking') {
            await ofModel.createTrackingLink(props.modelId, {
                name: tName.value.trim(),
                tags: parseTags(tTags.value),
            });
            tName.value = '';
            tTags.value = '';
        } else {
            await ofModel.createTrialLink(props.modelId, {
                name: trName.value.trim() || undefined,
                duration: trDuration.value,
                offerExpiration: trExpiration.value,
                offerLimit: trLimit.value,
                tags: parseTags(trTags.value),
            });
            trName.value = '';
            trTags.value = '';
        }

        showCreate.value = false;
        loaded[kind.value] = false;
        await load(kind.value);
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to create link.';
    } finally {
        creating.value = false;
    }
}

async function remove(k: Kind, id: string | null) {
    if (!id || !confirm('Delete this link? This cannot be undone.')) {
        return;
    }

    try {
        if (k === 'tracking') {
            await ofModel.deleteTrackingLink(props.modelId, id);
        } else {
            await ofModel.deleteTrialLink(props.modelId, id);
        }

        loaded[k] = false;
        await load(k);
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to delete link.';
    }
}

function parseTags(s: string): string[] {
    return s
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
}

function copy(url: string | null) {
    if (url) {
        navigator.clipboard?.writeText(url);
    }
}

function money(n: number): string {
    return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
}

onMounted(() => load('trial'));
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
                v-if="kind === 'tracking' || kind === 'trial'"
                type="button"
                class="flex shrink-0 items-center gap-1 rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white"
                @click="showCreate = !showCreate"
            >
                <Plus :size="14" /> New
                {{ kind === 'tracking' ? 'tracking' : 'trial' }} link
            </button>
        </div>

        <!-- Smart links + Link tags are self-contained child panels (lazy-mounted, kept alive) -->
        <SsModelSmartLinks
            v-if="visited.has('smart')"
            v-show="kind === 'smart'"
            :model-id="modelId"
        />
        <SsModelLinkTags
            v-if="visited.has('tags')"
            v-show="kind === 'tags'"
            :model-id="modelId"
        />

        <!-- create form -->
        <div
            v-if="showCreate"
            class="space-y-3 rounded-xl border border-ss-border bg-ss-surface p-4"
        >
            <template v-if="kind === 'tracking'">
                <label class="block">
                    <span class="mb-1 block text-[12px] text-ss-text-2"
                        >Campaign name</span
                    >
                    <input
                        v-model="tName"
                        type="text"
                        placeholder="Instagram bio"
                        class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                    />
                </label>
                <label class="block">
                    <span class="mb-1 block text-[12px] text-ss-text-2"
                        >Tags (comma-separated)</span
                    >
                    <input
                        v-model="tTags"
                        type="text"
                        placeholder="Instagram, Promo"
                        class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                    />
                </label>
            </template>
            <template v-else>
                <div class="grid gap-3 sm:grid-cols-3">
                    <label class="block">
                        <span class="mb-1 block text-[12px] text-ss-text-2"
                            >Free days</span
                        >
                        <select
                            v-model.number="trDuration"
                            class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                        >
                            <option v-for="d in DURATIONS" :key="d" :value="d">
                                {{ d }} days
                            </option>
                        </select>
                    </label>
                    <label class="block">
                        <span class="mb-1 block text-[12px] text-ss-text-2"
                            >Expires in (days)</span
                        >
                        <input
                            v-model.number="trExpiration"
                            type="number"
                            min="0"
                            max="30"
                            class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                        />
                    </label>
                    <label class="block">
                        <span class="mb-1 block text-[12px] text-ss-text-2"
                            >Claim limit</span
                        >
                        <select
                            v-model.number="trLimit"
                            class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                        >
                            <option v-for="l in LIMITS" :key="l" :value="l">
                                {{ l === 0 ? 'No limit' : l }}
                            </option>
                        </select>
                    </label>
                </div>
                <div class="grid gap-3 sm:grid-cols-2">
                    <label class="block">
                        <span class="mb-1 block text-[12px] text-ss-text-2"
                            >Name (optional)</span
                        >
                        <input
                            v-model="trName"
                            type="text"
                            maxlength="64"
                            placeholder="Summer promo"
                            class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                        />
                    </label>
                    <label class="block">
                        <span class="mb-1 block text-[12px] text-ss-text-2"
                            >Tags (comma-separated)</span
                        >
                        <input
                            v-model="trTags"
                            type="text"
                            placeholder="Instagram, Promo"
                            class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                        />
                    </label>
                </div>
            </template>
            <div class="flex items-center gap-2">
                <button
                    type="button"
                    class="rounded-lg bg-ss-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                    :disabled="
                        creating || (kind === 'tracking' && !tName.trim())
                    "
                    @click="create"
                >
                    {{ creating ? 'Creating…' : 'Create link' }}
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

        <!-- Tracking list -->
        <div v-if="kind === 'tracking'">
            <div
                v-if="tracking.length"
                class="overflow-hidden rounded-xl border border-ss-border bg-ss-surface"
            >
                <div
                    v-for="l in tracking"
                    :key="l.id ?? ''"
                    class="border-b border-ss-border last:border-b-0"
                >
                    <div class="flex items-center gap-3 p-3">
                        <div class="min-w-0 flex-1">
                            <div
                                class="truncate text-[13px] font-medium text-ss-text"
                            >
                                {{ l.name || 'Untitled' }}
                            </div>
                            <button
                                type="button"
                                class="flex items-center gap-1 truncate text-[11px] text-ss-text-3 hover:text-ss-accent-text"
                                @click="copy(l.url)"
                            >
                                <Copy :size="11" /> {{ l.url }}
                            </button>
                            <div
                                v-if="l.tags.length"
                                class="mt-1 flex flex-wrap gap-1"
                            >
                                <span
                                    v-for="t in l.tags"
                                    :key="t"
                                    class="rounded bg-ss-surface-2 px-1.5 py-0.5 text-[10px] text-ss-text-3"
                                    >{{ t }}</span
                                >
                            </div>
                        </div>
                        <div
                            class="shrink-0 text-right text-[11px] text-ss-text-3"
                        >
                            <div class="text-[13px] font-semibold text-ss-pos">
                                {{ money(l.revenue) }}
                            </div>
                            {{ l.clicks }} clicks · {{ l.subscribers }} subs
                        </div>
                        <button
                            type="button"
                            class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text"
                            title="Stats"
                            @click="toggleStats('tracking', l.id)"
                        >
                            <BarChart3 :size="15" />
                        </button>
                        <button
                            type="button"
                            class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-neg"
                            title="Delete"
                            @click="remove('tracking', l.id)"
                        >
                            <Trash2 :size="15" />
                        </button>
                    </div>
                    <div
                        v-if="expanded === `tracking:${l.id}`"
                        class="border-t border-ss-border bg-ss-bg/40 p-3"
                    >
                        <p
                            v-if="stats[`tracking:${l.id}`] === 'loading'"
                            class="text-[11px] text-ss-text-3"
                        >
                            Loading stats…
                        </p>
                        <div
                            v-else-if="stats[`tracking:${l.id}`]"
                            class="grid grid-cols-4 gap-2 text-center"
                        >
                            <div
                                v-for="(val, lbl) in {
                                    Clicks: (
                                        stats[`tracking:${l.id}`] as OfLinkStats
                                    ).clicks,
                                    Subs: (
                                        stats[`tracking:${l.id}`] as OfLinkStats
                                    ).subs,
                                    Spenders: (
                                        stats[`tracking:${l.id}`] as OfLinkStats
                                    ).spenders,
                                    Revenue: money(
                                        (
                                            stats[
                                                `tracking:${l.id}`
                                            ] as OfLinkStats
                                        ).revenue,
                                    ),
                                }"
                                :key="lbl"
                                class="rounded-lg bg-ss-surface p-2"
                            >
                                <div
                                    class="text-[12px] font-semibold text-ss-text"
                                >
                                    {{ val }}
                                </div>
                                <div class="text-[10px] text-ss-text-3">
                                    {{ lbl }}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <p
                v-else-if="!loading"
                class="rounded-xl border border-ss-border bg-ss-surface p-6 text-center text-[13px] text-ss-text-3"
            >
                No tracking links yet.
            </p>
        </div>

        <!-- Trial list -->
        <div v-else-if="kind === 'trial'">
            <div
                v-if="trial.length"
                class="overflow-hidden rounded-xl border border-ss-border bg-ss-surface"
            >
                <div
                    v-for="l in trial"
                    :key="l.id ?? ''"
                    class="border-b border-ss-border last:border-b-0"
                >
                    <div class="flex items-center gap-3 p-3">
                        <div class="min-w-0 flex-1">
                            <div
                                class="flex items-center gap-1.5 text-[13px] font-medium text-ss-text"
                            >
                                <span class="truncate">{{
                                    l.name || 'Trial link'
                                }}</span>
                                <span
                                    class="rounded bg-ss-surface-2 px-1.5 py-0.5 text-[10px] text-ss-text-3"
                                    >{{ l.subscribeDays }}d free</span
                                >
                                <span
                                    v-if="l.isFinished"
                                    class="rounded bg-ss-neg/10 px-1.5 py-0.5 text-[10px] text-ss-neg"
                                    >Finished</span
                                >
                            </div>
                            <button
                                type="button"
                                class="flex items-center gap-1 truncate text-[11px] text-ss-text-3 hover:text-ss-accent-text"
                                @click="copy(l.url)"
                            >
                                <Copy :size="11" /> {{ l.url }}
                            </button>
                        </div>
                        <div
                            class="shrink-0 text-right text-[11px] text-ss-text-3"
                        >
                            <div class="text-[13px] font-semibold text-ss-pos">
                                {{ money(l.revenue) }}
                            </div>
                            {{ l.claimCounts }} claims ·
                            {{ l.subscribeCounts }} subs
                        </div>
                        <button
                            type="button"
                            class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text"
                            title="Stats"
                            @click="toggleStats('trial', l.id)"
                        >
                            <BarChart3 :size="15" />
                        </button>
                        <button
                            type="button"
                            class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-neg"
                            title="Delete"
                            @click="remove('trial', l.id)"
                        >
                            <Trash2 :size="15" />
                        </button>
                    </div>
                    <div
                        v-if="expanded === `trial:${l.id}`"
                        class="border-t border-ss-border bg-ss-bg/40 p-3"
                    >
                        <p
                            v-if="stats[`trial:${l.id}`] === 'loading'"
                            class="text-[11px] text-ss-text-3"
                        >
                            Loading stats…
                        </p>
                        <div
                            v-else-if="stats[`trial:${l.id}`]"
                            class="grid grid-cols-4 gap-2 text-center"
                        >
                            <div
                                v-for="(val, lbl) in {
                                    Clicks: (
                                        stats[`trial:${l.id}`] as OfLinkStats
                                    ).clicks,
                                    Subs: (
                                        stats[`trial:${l.id}`] as OfLinkStats
                                    ).subs,
                                    Spenders: (
                                        stats[`trial:${l.id}`] as OfLinkStats
                                    ).spenders,
                                    Revenue: money(
                                        (stats[`trial:${l.id}`] as OfLinkStats)
                                            .revenue,
                                    ),
                                }"
                                :key="lbl"
                                class="rounded-lg bg-ss-surface p-2"
                            >
                                <div
                                    class="text-[12px] font-semibold text-ss-text"
                                >
                                    {{ val }}
                                </div>
                                <div class="text-[10px] text-ss-text-3">
                                    {{ lbl }}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
            <p
                v-else-if="!loading"
                class="rounded-xl border border-ss-border bg-ss-surface p-6 text-center text-[13px] text-ss-text-3"
            >
                No trial links yet.
            </p>
        </div>

        <div v-if="loading" class="flex justify-center">
            <LoaderCircle :size="18" class="animate-spin text-ss-text-3" />
        </div>
    </div>
</template>
