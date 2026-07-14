<script setup lang="ts">
import { Head, usePage } from '@inertiajs/vue3';
import { ChevronDown, Plus, RefreshCw, RotateCcw, X } from '@lucide/vue';
import { computed, onMounted, reactive, ref } from 'vue';
import { ofModel } from '@/lib/onlyfansModel';
import {
    DEFAULT_THRESHOLDS,
    resetThresholds,
    setThresholds,
    thresholdStore,
} from '@/lib/spenderThresholds';
import type { OfFanRow, SidebarCreator } from '@/types/crm';

// ---- shared creators (app-wide prop) ----
const page = usePage<{ creators: SidebarCreator[] }>();
const creators = computed<SidebarCreator[]>(() => page.props.creators ?? []);
const connected = computed(() => creators.value.filter((c) => c.hasOf));

// ---- thresholds ----
const thresholds = computed(() => thresholdStore.values);
const floor = computed(() =>
    thresholds.value.length ? Math.min(...thresholds.value) : 200,
);
// editable draft (committed on Apply so mid-typing doesn't churn the table/refetch)
const draft = ref<number[]>([...thresholds.value]);

function addBracket(): void {
    const max = draft.value.length ? Math.max(...draft.value) : 100;
    draft.value.push(max * 2);
}
function removeBracket(i: number): void {
    if (draft.value.length > 1) {
        draft.value.splice(i, 1);
    }
}
function applyThresholds(): void {
    setThresholds(draft.value);
    draft.value = [...thresholds.value];
    loadAll(false); // re-fetch only creators whose fetched floor is now too high
}
function resetToDefaults(): void {
    resetThresholds();
    draft.value = [...thresholds.value];
    loadAll(false);
}
const draftDirty = computed(
    () => JSON.stringify(draft.value) !== JSON.stringify(thresholds.value),
);

// ---- per-creator live state ----
interface CreatorState {
    status: 'idle' | 'loading' | 'loaded' | 'error';
    spenders: OfFanRow[];
    floor: number; // the floor this data was fetched at
    truncated: boolean;
    error: string;
}
const rows = reactive<Record<number, CreatorState>>({});

function stateFor(id: number): CreatorState {
    if (!rows[id]) {
        rows[id] = {
            status: 'idle',
            spenders: [],
            floor: Infinity,
            truncated: false,
            error: '',
        };
    }

    return rows[id];
}

async function loadCreator(c: SidebarCreator, fresh: boolean): Promise<void> {
    const st = stateFor(c.id);
    st.status = 'loading';
    st.error = '';

    try {
        const res = await ofModel.spenders(c.id, floor.value, fresh);
        st.spenders = res.spenders;
        st.floor = res.floor;
        st.truncated = res.truncated;
        st.status = 'loaded';
    } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to load';
        st.error = msg.includes('503')
            ? 'OnlyFans API not configured'
            : msg;
        st.status = 'error';
    }
}

/** Run async work with a small concurrency limit (be gentle on the OF API). */
async function runPool<T>(
    items: T[],
    limit: number,
    fn: (item: T) => Promise<void>,
): Promise<void> {
    const queue = [...items];
    const workers = Array.from(
        { length: Math.min(limit, queue.length) },
        async () => {
            while (queue.length) {
                const item = queue.shift();

                if (item !== undefined) {
                    await fn(item);
                }
            }
        },
    );
    await Promise.all(workers);
}

const anyLoading = ref(false);

async function loadAll(fresh: boolean): Promise<void> {
    anyLoading.value = true;
    const todo = connected.value.filter((c) => {
        if (fresh) {
            return true;
        }

        const st = stateFor(c.id);

        // fetch if never loaded, previously errored, or the current floor dips
        // below what we already fetched (existing data wouldn't cover it)
        return st.status !== 'loaded' || floor.value < st.floor;
    });
    await runPool(todo, 4, (c) => loadCreator(c, fresh));
    anyLoading.value = false;
}

onMounted(() => loadAll(false));

// ---- bucketing (client-side; recomputes when thresholds change) ----
interface CreatorRow {
    creator: SidebarCreator;
    st: CreatorState;
    counts: number[]; // aligned to thresholds
    cohortSpend: number; // sum of spend for fans >= lowest threshold
}

const perCreator = computed<CreatorRow[]>(() =>
    creators.value.map((creator) => {
        const st = stateFor(creator.id);
        const ts = thresholds.value;
        const counts = ts.map(
            (t) => st.spenders.filter((s) => s.totalSpent >= t).length,
        );
        const cohortSpend = st.spenders
            .filter((s) => s.totalSpent >= floor.value)
            .reduce((sum, s) => sum + s.totalSpent, 0);

        return { creator, st, counts, cohortSpend };
    }),
);

const totals = computed(() => {
    const counts = thresholds.value.map(() => 0);
    let cohortSpend = 0;

    for (const r of perCreator.value) {
        if (r.st.status !== 'loaded') {
            continue;
        }

        r.counts.forEach((n, i) => (counts[i] += n));
        cohortSpend += r.cohortSpend;
    }

    return { counts, cohortSpend };
});

const loadedCount = computed(
    () => perCreator.value.filter((r) => r.st.status === 'loaded').length,
);

// ---- drill-down ----
const drill = ref<{ id: number; threshold: number } | null>(null);

function toggleDrill(id: number, threshold: number): void {
    if (drill.value && drill.value.id === id && drill.value.threshold === threshold) {
        drill.value = null;
    } else {
        drill.value = { id, threshold };
    }
}

const drillList = computed<OfFanRow[]>(() => {
    if (!drill.value) {
        return [];
    }

    const st = stateFor(drill.value.id);

    return [...st.spenders]
        .filter((s) => s.totalSpent >= drill.value!.threshold)
        .sort((a, b) => b.totalSpent - a.totalSpent);
});

/** Round to cents. */
function r2(n: number): number {
    return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

interface FanSplit {
    fan: OfFanRow;
    total: number;
    ppv: number;
    tips: number;
    subs: number;
    // "Other" (paid posts / streams) is the plug = total − ppv − tips − subs,
    // derived from the already-rounded parts so the row reconciles to the total exactly.
    other: number;
}

const drillRows = computed<FanSplit[]>(() =>
    drillList.value.map((fan) => {
        const total = r2(fan.totalSpent);
        const ppv = r2(fan.ppv);
        const tips = r2(fan.tips);
        const subs = r2(fan.subs);

        return { fan, total, ppv, tips, subs, other: r2(total - ppv - tips - subs) };
    }),
);
const drillHasOther = computed(() =>
    drillRows.value.some((r) => r.other !== 0),
);
const drillTotals = computed(() =>
    drillRows.value.reduce(
        (a, r) => ({
            total: r2(a.total + r.total),
            ppv: r2(a.ppv + r.ppv),
            tips: r2(a.tips + r.tips),
            subs: r2(a.subs + r.subs),
            other: r2(a.other + r.other),
        }),
        { total: 0, ppv: 0, tips: 0, subs: 0, other: 0 },
    ),
);

// ---- formatting ----
const usd = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
});
const usd2 = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});
function money(n: number): string {
    return usd.format(Number.isFinite(n) ? n : 0);
}
/** Cents precision for the drill-down split so PPV+Tips+Subs+Other reconciles to Total. */
function money2(n: number): string {
    return usd2.format(Number.isFinite(n) ? n : 0);
}
/** Compact label for a threshold header: $200, $1k, $2.5k, $10k. */
function bracketLabel(n: number): string {
    if (n >= 1000) {
        const k = n / 1000;

        return '$' + (Number.isInteger(k) ? k : k.toFixed(1)) + 'k';
    }

    return '$' + n;
}
</script>

<template>
    <Head title="Spender brackets" />

    <div class="mx-auto max-w-7xl space-y-5">
        <!-- Header -->
        <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
                <h2 class="text-xl font-bold text-ss-text">Spender brackets</h2>
                <p class="text-sm text-ss-text-2">
                    How many fans each creator has above each lifetime-spend
                    threshold. Live from OnlyFans · all-time spend incl. churned.
                </p>
            </div>
            <button
                type="button"
                class="flex items-center gap-1.5 rounded-lg border border-ss-border px-3 py-1.5 text-[13px] font-medium text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-50"
                :disabled="anyLoading"
                @click="loadAll(true)"
            >
                <RefreshCw
                    :size="14"
                    :class="anyLoading ? 'animate-spin' : ''"
                />
                Refresh
            </button>
        </div>

        <!-- Thresholds editor -->
        <div class="rounded-xl border border-ss-border bg-ss-surface p-4">
            <div class="mb-2 flex items-center justify-between">
                <span class="text-[12px] font-medium text-ss-text-2">
                    Spend brackets (editable · saved to this browser)
                </span>
                <button
                    type="button"
                    class="flex items-center gap-1 text-[11px] text-ss-text-3 hover:text-ss-text"
                    @click="resetToDefaults"
                >
                    <RotateCcw :size="12" /> Reset
                </button>
            </div>
            <div class="flex flex-wrap items-center gap-2">
                <div
                    v-for="(_, i) in draft"
                    :key="i"
                    class="flex items-center gap-1 rounded-lg border border-ss-border bg-ss-surface-2 pl-2"
                >
                    <span class="text-[13px] text-ss-text-3">$</span>
                    <input
                        v-model.number="draft[i]"
                        type="number"
                        min="1"
                        class="w-20 bg-transparent py-1.5 text-[13px] text-ss-text outline-none"
                        @keyup.enter="applyThresholds"
                    />
                    <button
                        type="button"
                        class="px-1.5 text-ss-text-3 hover:text-ss-neg"
                        :disabled="draft.length <= 1"
                        @click="removeBracket(i)"
                    >
                        <X :size="13" />
                    </button>
                </div>
                <button
                    type="button"
                    class="flex items-center gap-1 rounded-lg border border-dashed border-ss-border px-2.5 py-1.5 text-[12px] text-ss-text-3 hover:text-ss-text"
                    @click="addBracket"
                >
                    <Plus :size="13" /> Add bracket
                </button>
                <button
                    v-if="draftDirty"
                    type="button"
                    class="rounded-lg bg-ss-accent px-3 py-1.5 text-[13px] font-medium text-white hover:opacity-90"
                    @click="applyThresholds"
                >
                    Apply
                </button>
            </div>
        </div>

        <!-- Bracket table -->
        <div
            class="overflow-hidden rounded-xl border border-ss-border bg-ss-surface"
        >
            <div class="overflow-x-auto">
                <table class="w-full border-collapse text-[13px]">
                    <thead
                        class="bg-ss-surface-2 text-left text-[11px] text-ss-text-3"
                    >
                        <tr>
                            <th class="px-4 py-2.5 font-medium">Creator</th>
                            <th
                                v-for="t in thresholds"
                                :key="t"
                                class="px-3 py-2.5 text-right font-medium whitespace-nowrap"
                            >
                                ≥ {{ bracketLabel(t) }}
                            </th>
                            <th
                                class="px-4 py-2.5 text-right font-medium whitespace-nowrap"
                            >
                                Cohort spend
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <template
                            v-for="row in perCreator"
                            :key="row.creator.id"
                        >
                            <tr class="border-t border-ss-border">
                                <td class="px-4 py-2.5">
                                    <div class="flex items-center gap-2">
                                        <span class="font-medium text-ss-text">
                                            {{ row.creator.name }}
                                        </span>
                                        <span
                                            v-if="row.st.truncated"
                                            class="text-ss-warn"
                                            title="Result capped — more spenders exist below the shown counts"
                                            >⚠</span
                                        >
                                    </div>
                                </td>

                                <!-- not connected -->
                                <template v-if="!row.creator.hasOf">
                                    <td
                                        :colspan="thresholds.length + 1"
                                        class="px-4 py-2.5 text-ss-text-3 italic"
                                    >
                                        No OnlyFans account connected
                                    </td>
                                </template>

                                <!-- loading -->
                                <template
                                    v-else-if="row.st.status === 'loading'"
                                >
                                    <td
                                        v-for="i in thresholds.length + 1"
                                        :key="i"
                                        class="px-3 py-2.5 text-right"
                                    >
                                        <span
                                            class="ml-auto inline-block h-3 w-8 animate-pulse rounded bg-ss-surface-2"
                                        />
                                    </td>
                                </template>

                                <!-- error -->
                                <template
                                    v-else-if="row.st.status === 'error'"
                                >
                                    <td
                                        :colspan="thresholds.length + 1"
                                        class="px-4 py-2.5 text-ss-neg"
                                    >
                                        {{ row.st.error }}
                                    </td>
                                </template>

                                <!-- loaded -->
                                <template v-else>
                                    <td
                                        v-for="(n, i) in row.counts"
                                        :key="i"
                                        class="px-3 py-2.5 text-right font-ss-mono tabular-nums"
                                        :class="
                                            n > 0
                                                ? 'cursor-pointer text-ss-text hover:text-ss-accent-text'
                                                : 'text-ss-text-3'
                                        "
                                        @click="
                                            n > 0 &&
                                            toggleDrill(
                                                row.creator.id,
                                                thresholds[i],
                                            )
                                        "
                                    >
                                        {{ n || '—' }}
                                    </td>
                                    <td
                                        class="px-4 py-2.5 text-right font-ss-mono tabular-nums text-ss-text-2"
                                    >
                                        {{ money(row.cohortSpend) }}
                                    </td>
                                </template>
                            </tr>

                            <!-- drill-down -->
                            <tr
                                v-if="
                                    drill && drill.id === row.creator.id
                                "
                                :key="`${row.creator.id}-drill`"
                                class="border-t border-ss-border bg-ss-surface-2"
                            >
                                <td
                                    :colspan="thresholds.length + 2"
                                    class="px-4 py-3"
                                >
                                    <div
                                        class="mb-2 flex items-center gap-1.5 text-[11px] text-ss-text-3"
                                    >
                                        <ChevronDown :size="13" />
                                        {{ row.creator.name }} — fans ≥
                                        {{ bracketLabel(drill.threshold) }}
                                        ({{ drillList.length }})
                                    </div>
                                    <div
                                        class="overflow-x-auto rounded-lg border border-ss-border bg-ss-surface"
                                    >
                                        <table
                                            class="w-full border-collapse text-[12px]"
                                        >
                                            <thead
                                                class="text-left text-[10px] tracking-wide text-ss-text-3 uppercase"
                                            >
                                                <tr>
                                                    <th
                                                        class="px-3 py-2 font-medium"
                                                    >
                                                        Fan
                                                    </th>
                                                    <th
                                                        class="px-3 py-2 text-right font-medium"
                                                    >
                                                        Total
                                                    </th>
                                                    <th
                                                        class="px-3 py-2 text-right font-medium"
                                                    >
                                                        PPV
                                                    </th>
                                                    <th
                                                        class="px-3 py-2 text-right font-medium"
                                                    >
                                                        Tips
                                                    </th>
                                                    <th
                                                        class="px-3 py-2 text-right font-medium"
                                                    >
                                                        Subs
                                                    </th>
                                                    <th
                                                        v-if="drillHasOther"
                                                        class="px-3 py-2 text-right font-medium"
                                                    >
                                                        Other
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr
                                                    v-for="sr in drillRows.slice(
                                                        0,
                                                        50,
                                                    )"
                                                    :key="
                                                        sr.fan.id ??
                                                        sr.fan.username ??
                                                        ''
                                                    "
                                                    class="border-t border-ss-border"
                                                >
                                                    <td class="px-3 py-2">
                                                        <span
                                                            class="text-ss-text"
                                                            >{{
                                                                sr.fan.name ||
                                                                sr.fan
                                                                    .username ||
                                                                'Fan'
                                                            }}</span
                                                        >
                                                        <span
                                                            v-if="sr.fan.username"
                                                            class="ml-1 text-ss-text-3"
                                                            >@{{
                                                                sr.fan.username
                                                            }}</span
                                                        >
                                                    </td>
                                                    <td
                                                        class="px-3 py-2 text-right font-ss-mono font-semibold tabular-nums text-ss-pos"
                                                    >
                                                        {{ money2(sr.total) }}
                                                    </td>
                                                    <td
                                                        class="px-3 py-2 text-right font-ss-mono tabular-nums text-ss-text-2"
                                                    >
                                                        {{ money2(sr.ppv) }}
                                                    </td>
                                                    <td
                                                        class="px-3 py-2 text-right font-ss-mono tabular-nums text-ss-text-2"
                                                    >
                                                        {{ money2(sr.tips) }}
                                                    </td>
                                                    <td
                                                        class="px-3 py-2 text-right font-ss-mono tabular-nums text-ss-text-2"
                                                    >
                                                        {{ money2(sr.subs) }}
                                                    </td>
                                                    <td
                                                        v-if="drillHasOther"
                                                        class="px-3 py-2 text-right font-ss-mono tabular-nums text-ss-text-3"
                                                    >
                                                        {{ money2(sr.other) }}
                                                    </td>
                                                </tr>
                                            </tbody>
                                            <tfoot>
                                                <tr
                                                    class="border-t-2 border-ss-border font-semibold text-ss-text"
                                                >
                                                    <td class="px-3 py-2">
                                                        Cohort ({{
                                                            drillList.length
                                                        }})
                                                    </td>
                                                    <td
                                                        class="px-3 py-2 text-right font-ss-mono tabular-nums"
                                                    >
                                                        {{
                                                            money2(
                                                                drillTotals.total,
                                                            )
                                                        }}
                                                    </td>
                                                    <td
                                                        class="px-3 py-2 text-right font-ss-mono tabular-nums"
                                                    >
                                                        {{
                                                            money2(
                                                                drillTotals.ppv,
                                                            )
                                                        }}
                                                    </td>
                                                    <td
                                                        class="px-3 py-2 text-right font-ss-mono tabular-nums"
                                                    >
                                                        {{
                                                            money2(
                                                                drillTotals.tips,
                                                            )
                                                        }}
                                                    </td>
                                                    <td
                                                        class="px-3 py-2 text-right font-ss-mono tabular-nums"
                                                    >
                                                        {{
                                                            money2(
                                                                drillTotals.subs,
                                                            )
                                                        }}
                                                    </td>
                                                    <td
                                                        v-if="drillHasOther"
                                                        class="px-3 py-2 text-right font-ss-mono tabular-nums"
                                                    >
                                                        {{
                                                            money2(
                                                                drillTotals.other,
                                                            )
                                                        }}
                                                    </td>
                                                </tr>
                                            </tfoot>
                                        </table>
                                    </div>
                                    <p
                                        v-if="drillList.length > 50"
                                        class="mt-2 text-[11px] text-ss-text-3"
                                    >
                                        Showing top 50 of
                                        {{ drillList.length }} — subtotal above
                                        covers all.
                                    </p>
                                </td>
                            </tr>
                        </template>

                        <!-- empty -->
                        <tr v-if="!creators.length">
                            <td
                                :colspan="thresholds.length + 2"
                                class="px-4 py-10 text-center text-ss-text-3"
                            >
                                No creators available.
                            </td>
                        </tr>
                    </tbody>

                    <!-- totals -->
                    <tfoot v-if="loadedCount > 0">
                        <tr
                            class="border-t-2 border-ss-border bg-ss-surface-2 font-semibold"
                        >
                            <td class="px-4 py-2.5 text-ss-text">
                                Agency total
                                <span class="text-[11px] text-ss-text-3"
                                    >({{ loadedCount }} creators)</span
                                >
                            </td>
                            <td
                                v-for="(n, i) in totals.counts"
                                :key="i"
                                class="px-3 py-2.5 text-right font-ss-mono tabular-nums text-ss-text"
                            >
                                {{ n }}
                            </td>
                            <td
                                class="px-4 py-2.5 text-right font-ss-mono tabular-nums text-ss-text"
                            >
                                {{ money(totals.cohortSpend) }}
                            </td>
                        </tr>
                    </tfoot>
                </table>
            </div>
        </div>

        <p class="text-[11px] text-ss-text-3">
            "Cohort spend" = combined lifetime spend of fans at or above your
            lowest bracket ({{ bracketLabel(floor) }}). Click a count to list the
            fans in that bracket. Defaults:
            {{ DEFAULT_THRESHOLDS.map(bracketLabel).join(' · ') }}.
        </p>
    </div>
</template>
