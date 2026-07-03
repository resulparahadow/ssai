<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { LoaderCircle } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import SsBarChart from '@/components/crm/SsBarChart.vue';
import SsInlineError from '@/components/crm/SsInlineError.vue';
import { ofAnalytics } from '@/lib/ofAnalytics';
import type {
    OfAnalyticsAccount,
    OfComparison,
    OfEarningsOverview,
    OfForecast,
    OfHistoricalPoint,
    OfProfitabilityHistoryRow,
    OfProfitabilityRow,
    OfTxnByType,
    OfTxnSummary,
    SeriesPoint,
} from '@/types/crm';

const props = defineProps<{ accounts: OfAnalyticsAccount[] }>();

const hasAccounts = computed(() => props.accounts.length > 0);

// ---- Shared account + date filter (drives earnings + transactions) ----------
const selected = ref<Set<string>>(
    new Set(props.accounts.map((a) => a.accountId)),
);
const selectedIds = computed(() => [...selected.value]);

function toggle(id: string): void {
    const s = new Set(selected.value);

    if (s.has(id)) {
        s.delete(id);
    } else {
        s.add(id);
    }

    selected.value = s;
}
function selectAll(): void {
    selected.value = new Set(props.accounts.map((a) => a.accountId));
}
function selectNone(): void {
    selected.value = new Set();
}

function isoDaysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);

    return d.toISOString().slice(0, 10);
}
const startDate = ref(isoDaysAgo(30));
const endDate = ref(isoDaysAgo(0));

// ---- helpers ----------------------------------------------------------------
function money(n: number | null | undefined): string {
    return '$' + Math.round(Number(n ?? 0)).toLocaleString();
}
function num(n: number | null | undefined): string {
    return Number(n ?? 0).toLocaleString();
}
function pct(n: number | null | undefined): string {
    return (Number(n ?? 0) >= 0 ? '+' : '') + Number(n ?? 0).toFixed(1) + '%';
}
const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
];

/** Generic async-section state wrapper. */
function section<T>() {
    return {
        data: ref<T | null>(null),
        loading: ref(false),
        error: ref<string | null>(null),
    };
}
function errMsg(e: unknown, fallback: string): string {
    return e instanceof Error ? e.message : fallback;
}

// ---- Earnings overview + Transactions (shared date range) -------------------
const earn = section<OfEarningsOverview>();
const txn = section<OfTxnSummary>();
const byType = section<OfTxnByType[]>();

async function loadRange(): Promise<void> {
    if (!hasAccounts.value) {
        return;
    }

    const range = { start_date: startDate.value, end_date: endDate.value };
    const ids = selectedIds.value;

    earn.loading.value = true;
    earn.error.value = null;
    ofAnalytics
        .earnings(ids, range)
        .then((d) => (earn.data.value = d))
        .catch(
            (e) => (earn.error.value = errMsg(e, 'Failed to load earnings.')),
        )
        .finally(() => (earn.loading.value = false));

    txn.loading.value = true;
    txn.error.value = null;
    ofAnalytics
        .transactionSummary(ids, range)
        .then((d) => (txn.data.value = d))
        .catch(
            (e) =>
                (txn.error.value = errMsg(e, 'Failed to load transactions.')),
        )
        .finally(() => (txn.loading.value = false));

    byType.loading.value = true;
    byType.error.value = null;
    ofAnalytics
        .transactionsByType(ids, range)
        .then((d) => (byType.data.value = d))
        .catch(
            (e) =>
                (byType.error.value = errMsg(e, 'Failed to load breakdown.')),
        )
        .finally(() => (byType.loading.value = false));
}

const earnCards = computed(() => {
    const d = earn.data.value;

    if (!d) {
        return [];
    }

    return [
        { label: 'Subscriptions', value: money(d.subscriptions) },
        { label: 'Messages', value: money(d.messages) },
        { label: 'Tips', value: money(d.tips) },
        { label: 'Posts', value: money(d.posts) },
        { label: 'Streams', value: money(d.streams) },
    ];
});
const byTypePoints = computed<SeriesPoint[]>(() =>
    (byType.data.value ?? []).map((t) => ({ label: t.type, value: t.total })),
);

// ---- Historical performance -------------------------------------------------
const hist = section<OfHistoricalPoint[]>();
const timeRange = ref<'3m' | '6m' | '12m' | 'ytd' | 'last-year'>('12m');
const TIME_RANGES = ['3m', '6m', '12m', 'ytd', 'last-year'] as const;

async function loadHistorical(): Promise<void> {
    hist.loading.value = true;
    hist.error.value = null;

    try {
        hist.data.value = await ofAnalytics.historical(timeRange.value);
    } catch (e) {
        hist.error.value = errMsg(e, 'Failed to load historical performance.');
    } finally {
        hist.loading.value = false;
    }
}
const histPoints = computed<SeriesPoint[]>(() =>
    (hist.data.value ?? []).map((p) => ({ label: p.period, value: p.value })),
);

// ---- Period comparison ------------------------------------------------------
const cmp = section<OfComparison>();
const aStart = ref(isoDaysAgo(60));
const aEnd = ref(isoDaysAgo(31));
const bStart = ref(isoDaysAgo(30));
const bEnd = ref(isoDaysAgo(0));
const granularity = ref<'months' | 'quarters' | 'half_years' | 'years'>(
    'months',
);
const statType = ref<
    | 'totalEarnings'
    | 'subscriptions'
    | 'posts'
    | 'messages'
    | 'tips'
    | 'streams'
>('totalEarnings');

async function loadComparison(): Promise<void> {
    if (!hasAccounts.value) {
        return;
    }

    cmp.loading.value = true;
    cmp.error.value = null;

    try {
        cmp.data.value = await ofAnalytics.comparison(selectedIds.value, {
            period_a: { start: aStart.value, end: aEnd.value },
            period_b: { start: bStart.value, end: bEnd.value },
            granularity: granularity.value,
            stat_type: statType.value,
        });
    } catch (e) {
        cmp.error.value = errMsg(e, 'Failed to load comparison.');
    } finally {
        cmp.loading.value = false;
    }
}

// ---- Revenue forecast -------------------------------------------------------
const fc = section<OfForecast>();
const metric = ref<'revenue' | 'churn_percentage'>('revenue');
const fcModel = ref<
    'moving_average' | 'linear_regression' | 'arima' | 'sarima'
>('linear_regression');
const historicalDays = ref(90);
const forecastDays = ref(30);

async function loadForecast(): Promise<void> {
    if (!hasAccounts.value) {
        return;
    }

    fc.loading.value = true;
    fc.error.value = null;

    try {
        fc.data.value = await ofAnalytics.forecast(selectedIds.value, {
            metric: metric.value,
            model: fcModel.value,
            historical_days: historicalDays.value,
            forecast_days: forecastDays.value,
        });
    } catch (e) {
        fc.error.value = errMsg(e, 'Failed to load forecast.');
    } finally {
        fc.loading.value = false;
    }
}
const forecastPoints = computed<SeriesPoint[]>(() => {
    const d = fc.data.value;

    if (!d) {
        return [];
    }

    return [...d.historical, ...d.forecast].map((p) => ({
        label: p.date.slice(5),
        value: p.value,
    }));
});

// ---- Profitability (month) --------------------------------------------------
const profit = section<OfProfitabilityRow[]>();
const now = new Date();
const year = ref(now.getFullYear());
const month = ref(now.getMonth() + 1);

async function loadProfitability(): Promise<void> {
    if (!hasAccounts.value) {
        return;
    }

    profit.loading.value = true;
    profit.error.value = null;

    try {
        profit.data.value = await ofAnalytics.profitability(
            selectedIds.value,
            year.value,
            month.value,
        );
    } catch (e) {
        profit.error.value = errMsg(e, 'Failed to load profitability.');
    } finally {
        profit.loading.value = false;
    }
}

// ---- Profitability history (per creator) ------------------------------------
const profitHist = section<OfProfitabilityHistoryRow[]>();
const histModelId = ref<number | null>(props.accounts[0]?.id ?? null);
const histMonths = ref(12);

async function loadProfitHistory(): Promise<void> {
    if (histModelId.value == null) {
        return;
    }

    profitHist.loading.value = true;
    profitHist.error.value = null;

    try {
        profitHist.data.value = await ofAnalytics.profitabilityHistory(
            histModelId.value,
            histMonths.value,
        );
    } catch (e) {
        profitHist.error.value = errMsg(
            e,
            'Failed to load profitability history.',
        );
    } finally {
        profitHist.loading.value = false;
    }
}
const profitHistPoints = computed<SeriesPoint[]>(() =>
    (profitHist.data.value ?? []).map((r) => ({
        label: `${MONTHS[r.month - 1]} ${String(r.year).slice(2)}`,
        value: r.profit,
    })),
);

onMounted(() => {
    if (hasAccounts.value) {
        loadRange();
        loadHistorical();
    }
});

// Compact select styling reused across the page.
const selectCls =
    'rounded-lg border border-ss-border bg-ss-surface px-2.5 py-1.5 text-[12px] text-ss-text';
const runBtnCls =
    'rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50';
</script>

<template>
    <Head title="Analytics" />

    <div class="mx-auto max-w-7xl space-y-6">
        <div>
            <h2 class="text-xl font-bold text-ss-text">Analytics</h2>
            <p class="text-sm text-ss-text-2">
                Live agency-wide earnings, transactions, profitability and
                forecasting across your connected OnlyFans accounts.
            </p>
        </div>

        <p
            v-if="!hasAccounts"
            class="rounded-xl border border-ss-border bg-ss-surface p-6 text-center text-sm text-ss-text-3"
        >
            No OnlyFans accounts are connected. Connect an account on a Creator
            Model to see analytics.
        </p>

        <template v-else>
            <!-- Account + date filter ---------------------------------------->
            <div
                class="space-y-3 rounded-xl border border-ss-border bg-ss-surface p-4"
            >
                <div class="flex items-center justify-between">
                    <span class="text-[12px] font-semibold text-ss-text-2"
                        >Accounts</span
                    >
                    <div class="flex gap-2 text-[11px]">
                        <button
                            type="button"
                            class="text-ss-accent hover:underline"
                            @click="selectAll"
                        >
                            All
                        </button>
                        <button
                            type="button"
                            class="text-ss-text-3 hover:underline"
                            @click="selectNone"
                        >
                            None
                        </button>
                    </div>
                </div>
                <div class="flex flex-wrap gap-1.5">
                    <button
                        v-for="a in accounts"
                        :key="a.accountId"
                        type="button"
                        class="rounded-lg px-2.5 py-1 text-[12px] font-medium transition-colors"
                        :class="
                            selected.has(a.accountId)
                                ? 'bg-ss-accent-soft text-ss-accent-text'
                                : 'bg-ss-surface-2 text-ss-text-3 hover:text-ss-text'
                        "
                        @click="toggle(a.accountId)"
                    >
                        {{ a.name }}
                    </button>
                </div>
                <div class="flex flex-wrap items-end gap-3 pt-1">
                    <label class="text-[11px] text-ss-text-3">
                        Start
                        <input
                            v-model="startDate"
                            type="date"
                            :class="selectCls + ' mt-1 block'"
                        />
                    </label>
                    <label class="text-[11px] text-ss-text-3">
                        End
                        <input
                            v-model="endDate"
                            type="date"
                            :class="selectCls + ' mt-1 block'"
                        />
                    </label>
                    <button
                        type="button"
                        :class="runBtnCls"
                        :disabled="!selected.size"
                        @click="loadRange"
                    >
                        Apply
                    </button>
                </div>
            </div>

            <!-- SUMMARY ======================================================-->
            <h3
                class="text-[13px] font-semibold tracking-wide text-ss-text-3 uppercase"
            >
                Summary
            </h3>

            <!-- Earnings overview -->
            <section class="space-y-3">
                <div
                    class="rounded-xl border border-ss-border bg-ss-surface p-4"
                >
                    <div class="mb-3 flex items-center justify-between">
                        <div>
                            <div class="text-[12px] text-ss-text-2">
                                Total earnings
                            </div>
                            <div class="text-2xl font-bold text-ss-text">
                                {{ money(earn.data.value?.total_earnings) }}
                            </div>
                        </div>
                        <LoaderCircle
                            v-if="earn.loading.value"
                            :size="18"
                            class="animate-spin text-ss-text-3"
                        />
                    </div>
                    <SsInlineError
                        v-if="earn.error.value"
                        :message="earn.error.value"
                    />
                    <div
                        v-else
                        class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5"
                    >
                        <div
                            v-for="c in earnCards"
                            :key="c.label"
                            class="rounded-lg bg-ss-surface-2 p-3"
                        >
                            <div class="text-[11px] text-ss-text-3">
                                {{ c.label }}
                            </div>
                            <div class="text-[15px] font-semibold text-ss-text">
                                {{ c.value }}
                            </div>
                        </div>
                    </div>
                    <div
                        v-if="earn.data.value"
                        class="mt-3 flex flex-wrap gap-4 text-[11px] text-ss-text-3"
                    >
                        <span
                            >{{
                                num(earn.data.value.total_accounts)
                            }}
                            accounts</span
                        >
                        <span
                            >{{
                                num(earn.data.value.total_messages)
                            }}
                            messages</span
                        >
                        <span
                            >{{
                                num(earn.data.value.total_images)
                            }}
                            images</span
                        >
                        <span
                            >{{
                                num(earn.data.value.total_videos)
                            }}
                            videos</span
                        >
                    </div>
                </div>
            </section>

            <!-- Historical performance -->
            <section
                class="space-y-3 rounded-xl border border-ss-border bg-ss-surface p-4"
            >
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <span class="text-[13px] font-semibold text-ss-text"
                        >Historical performance</span
                    >
                    <div class="flex items-center gap-1">
                        <button
                            v-for="r in TIME_RANGES"
                            :key="r"
                            type="button"
                            class="rounded-md px-2.5 py-1 text-[12px] font-medium transition-colors"
                            :class="
                                r === timeRange
                                    ? 'bg-ss-accent-soft text-ss-accent-text'
                                    : 'text-ss-text-3 hover:text-ss-text'
                            "
                            @click="
                                () => {
                                    timeRange = r;
                                    loadHistorical();
                                }
                            "
                        >
                            {{ r }}
                        </button>
                    </div>
                </div>
                <SsInlineError
                    v-if="hist.error.value"
                    :message="hist.error.value"
                />
                <div
                    v-else-if="hist.loading.value"
                    class="grid h-48 place-items-center"
                >
                    <LoaderCircle
                        :size="20"
                        class="animate-spin text-ss-text-3"
                    />
                </div>
                <SsBarChart
                    v-else-if="histPoints.length"
                    :points="histPoints"
                />
                <p v-else class="py-8 text-center text-[12px] text-ss-text-3">
                    No historical data.
                </p>
            </section>

            <!-- Period comparison -->
            <section
                class="space-y-3 rounded-xl border border-ss-border bg-ss-surface p-4"
            >
                <span class="text-[13px] font-semibold text-ss-text"
                    >Period comparison</span
                >
                <div class="flex flex-wrap items-end gap-3">
                    <label class="text-[11px] text-ss-text-3"
                        >A start<input
                            v-model="aStart"
                            type="date"
                            :class="selectCls + ' mt-1 block'"
                    /></label>
                    <label class="text-[11px] text-ss-text-3"
                        >A end<input
                            v-model="aEnd"
                            type="date"
                            :class="selectCls + ' mt-1 block'"
                    /></label>
                    <label class="text-[11px] text-ss-text-3"
                        >B start<input
                            v-model="bStart"
                            type="date"
                            :class="selectCls + ' mt-1 block'"
                    /></label>
                    <label class="text-[11px] text-ss-text-3"
                        >B end<input
                            v-model="bEnd"
                            type="date"
                            :class="selectCls + ' mt-1 block'"
                    /></label>
                    <select v-model="statType" :class="selectCls">
                        <option value="totalEarnings">Total earnings</option>
                        <option value="subscriptions">Subscriptions</option>
                        <option value="posts">Posts</option>
                        <option value="messages">Messages</option>
                        <option value="tips">Tips</option>
                        <option value="streams">Streams</option>
                    </select>
                    <select v-model="granularity" :class="selectCls">
                        <option value="months">Months</option>
                        <option value="quarters">Quarters</option>
                        <option value="half_years">Half years</option>
                        <option value="years">Years</option>
                    </select>
                    <button
                        type="button"
                        :class="runBtnCls"
                        :disabled="!selected.size || cmp.loading.value"
                        @click="loadComparison"
                    >
                        Compare
                    </button>
                </div>
                <SsInlineError
                    v-if="cmp.error.value"
                    :message="cmp.error.value"
                />
                <div v-else-if="cmp.data.value" class="grid grid-cols-3 gap-3">
                    <div class="rounded-lg bg-ss-surface-2 p-3">
                        <div class="text-[11px] text-ss-text-3">
                            {{ cmp.data.value.period_a_label || 'Period A' }}
                        </div>
                        <div class="text-lg font-bold text-ss-text">
                            {{ money(cmp.data.value.summary.period_a_total) }}
                        </div>
                    </div>
                    <div class="rounded-lg bg-ss-surface-2 p-3">
                        <div class="text-[11px] text-ss-text-3">
                            {{ cmp.data.value.period_b_label || 'Period B' }}
                        </div>
                        <div class="text-lg font-bold text-ss-text">
                            {{ money(cmp.data.value.summary.period_b_total) }}
                        </div>
                    </div>
                    <div class="rounded-lg bg-ss-surface-2 p-3">
                        <div class="text-[11px] text-ss-text-3">Change</div>
                        <div
                            class="text-lg font-bold"
                            :class="
                                cmp.data.value.summary.change >= 0
                                    ? 'text-ss-pos'
                                    : 'text-ss-neg'
                            "
                        >
                            {{ pct(cmp.data.value.summary.change_percentage) }}
                        </div>
                        <div class="text-[11px] text-ss-text-3">
                            {{ money(cmp.data.value.summary.change) }}
                        </div>
                    </div>
                </div>
            </section>

            <!-- FINANCIAL ====================================================-->
            <h3
                class="text-[13px] font-semibold tracking-wide text-ss-text-3 uppercase"
            >
                Financial
            </h3>

            <!-- Transaction summary + by type (shared date range) -->
            <section class="grid gap-4 lg:grid-cols-2">
                <div
                    class="rounded-xl border border-ss-border bg-ss-surface p-4"
                >
                    <div class="mb-3 flex items-center justify-between">
                        <span class="text-[13px] font-semibold text-ss-text"
                            >Transaction summary</span
                        >
                        <LoaderCircle
                            v-if="txn.loading.value"
                            :size="16"
                            class="animate-spin text-ss-text-3"
                        />
                    </div>
                    <SsInlineError
                        v-if="txn.error.value"
                        :message="txn.error.value"
                    />
                    <div v-else-if="txn.data.value" class="space-y-3">
                        <div class="grid grid-cols-3 gap-3">
                            <div class="rounded-lg bg-ss-surface-2 p-3">
                                <div class="text-[11px] text-ss-text-3">
                                    Succeeded
                                </div>
                                <div class="text-lg font-bold text-ss-pos">
                                    {{ num(txn.data.value.succeeded_count) }}
                                </div>
                            </div>
                            <div class="rounded-lg bg-ss-surface-2 p-3">
                                <div class="text-[11px] text-ss-text-3">
                                    Refunded
                                </div>
                                <div class="text-lg font-bold text-ss-warn">
                                    {{ num(txn.data.value.refunded_count) }}
                                </div>
                            </div>
                            <div class="rounded-lg bg-ss-surface-2 p-3">
                                <div class="text-[11px] text-ss-text-3">
                                    Disputed
                                </div>
                                <div class="text-lg font-bold text-ss-neg">
                                    {{ num(txn.data.value.disputed_count) }}
                                </div>
                            </div>
                        </div>
                        <div
                            class="flex justify-between border-t border-ss-border pt-2 text-[12px]"
                        >
                            <span class="text-ss-text-3"
                                >Gross
                                <b class="text-ss-text">{{
                                    money(txn.data.value.total_gross)
                                }}</b></span
                            >
                            <span class="text-ss-text-3"
                                >Net
                                <b class="text-ss-text">{{
                                    money(txn.data.value.total_net)
                                }}</b></span
                            >
                            <span class="text-ss-text-3"
                                >Fees
                                <b class="text-ss-text">{{
                                    money(txn.data.value.total_fees)
                                }}</b></span
                            >
                        </div>
                    </div>
                </div>

                <div
                    class="rounded-xl border border-ss-border bg-ss-surface p-4"
                >
                    <div class="mb-3 flex items-center justify-between">
                        <span class="text-[13px] font-semibold text-ss-text"
                            >Transactions by type</span
                        >
                        <LoaderCircle
                            v-if="byType.loading.value"
                            :size="16"
                            class="animate-spin text-ss-text-3"
                        />
                    </div>
                    <SsInlineError
                        v-if="byType.error.value"
                        :message="byType.error.value"
                    />
                    <template v-else>
                        <SsBarChart
                            v-if="byTypePoints.length"
                            :points="byTypePoints"
                        />
                        <div class="mt-2 space-y-1">
                            <div
                                v-for="t in byType.data.value ?? []"
                                :key="t.type"
                                class="flex justify-between text-[12px]"
                            >
                                <span class="text-ss-text-2 capitalize">{{
                                    t.type
                                }}</span>
                                <span class="text-ss-text-3"
                                    >{{ num(t.count) }} ·
                                    <b class="text-ss-text">{{
                                        money(t.total)
                                    }}</b></span
                                >
                            </div>
                        </div>
                    </template>
                </div>
            </section>

            <!-- Revenue forecast -->
            <section
                class="space-y-3 rounded-xl border border-ss-border bg-ss-surface p-4"
            >
                <span class="text-[13px] font-semibold text-ss-text"
                    >Revenue forecast</span
                >
                <div class="flex flex-wrap items-end gap-3">
                    <select v-model="metric" :class="selectCls">
                        <option value="revenue">Revenue</option>
                        <option value="churn_percentage">Churn %</option>
                    </select>
                    <select v-model="fcModel" :class="selectCls">
                        <option value="moving_average">Moving average</option>
                        <option value="linear_regression">
                            Linear regression
                        </option>
                        <option value="arima">ARIMA</option>
                        <option value="sarima">SARIMA</option>
                    </select>
                    <label class="text-[11px] text-ss-text-3"
                        >Historical days<input
                            v-model.number="historicalDays"
                            type="number"
                            min="30"
                            max="730"
                            :class="selectCls + ' mt-1 block w-24'"
                    /></label>
                    <label class="text-[11px] text-ss-text-3"
                        >Forecast days<input
                            v-model.number="forecastDays"
                            type="number"
                            min="7"
                            max="365"
                            :class="selectCls + ' mt-1 block w-24'"
                    /></label>
                    <button
                        type="button"
                        :class="runBtnCls"
                        :disabled="!selected.size || fc.loading.value"
                        @click="loadForecast"
                    >
                        Forecast
                    </button>
                </div>
                <SsInlineError
                    v-if="fc.error.value"
                    :message="fc.error.value"
                />
                <template v-else-if="fc.data.value">
                    <SsBarChart
                        v-if="forecastPoints.length"
                        :points="forecastPoints"
                    />
                    <p class="text-[11px] text-ss-text-3">
                        {{ fc.data.value.historical.length }} historical +
                        {{ fc.data.value.forecast.length }} forecasted points ·
                        {{ fc.data.value.model }}
                    </p>
                </template>
            </section>

            <!-- Profitability (month) -->
            <section
                class="space-y-3 rounded-xl border border-ss-border bg-ss-surface p-4"
            >
                <div class="flex flex-wrap items-end justify-between gap-3">
                    <span class="text-[13px] font-semibold text-ss-text"
                        >Profitability</span
                    >
                    <div class="flex items-end gap-2">
                        <select v-model.number="month" :class="selectCls">
                            <option
                                v-for="(m, i) in MONTHS"
                                :key="m"
                                :value="i + 1"
                            >
                                {{ m }}
                            </option>
                        </select>
                        <input
                            v-model.number="year"
                            type="number"
                            min="2015"
                            max="2100"
                            :class="selectCls + ' w-24'"
                        />
                        <button
                            type="button"
                            :class="runBtnCls"
                            :disabled="!selected.size || profit.loading.value"
                            @click="loadProfitability"
                        >
                            Run
                        </button>
                    </div>
                </div>
                <SsInlineError
                    v-if="profit.error.value"
                    :message="profit.error.value"
                />
                <div
                    v-else-if="(profit.data.value ?? []).length"
                    class="overflow-x-auto"
                >
                    <table class="w-full text-[12px]">
                        <thead>
                            <tr class="text-left text-ss-text-3">
                                <th class="py-1.5 pr-3 font-medium">Creator</th>
                                <th class="py-1.5 pr-3 font-medium">Gross</th>
                                <th class="py-1.5 pr-3 font-medium">Net</th>
                                <th class="py-1.5 pr-3 font-medium">Costs</th>
                                <th class="py-1.5 pr-3 font-medium">
                                    Commission
                                </th>
                                <th class="py-1.5 pr-3 font-medium">Profit</th>
                                <th class="py-1.5 font-medium">Margin</th>
                            </tr>
                        </thead>
                        <tbody>
                            <tr
                                v-for="r in profit.data.value ?? []"
                                :key="r.creator_id"
                                class="border-t border-ss-border"
                            >
                                <td class="py-1.5 pr-3 text-ss-text">
                                    {{ r.name }}
                                </td>
                                <td class="py-1.5 pr-3 text-ss-text-2">
                                    {{ money(r.gross_revenue) }}
                                </td>
                                <td class="py-1.5 pr-3 text-ss-text-2">
                                    {{ money(r.net_revenue) }}
                                </td>
                                <td class="py-1.5 pr-3 text-ss-text-2">
                                    {{ money(r.total_costs) }}
                                </td>
                                <td class="py-1.5 pr-3 text-ss-text-2">
                                    {{ money(r.commission) }}
                                </td>
                                <td
                                    class="py-1.5 pr-3 font-semibold"
                                    :class="
                                        r.profit >= 0
                                            ? 'text-ss-pos'
                                            : 'text-ss-neg'
                                    "
                                >
                                    {{ money(r.profit) }}
                                </td>
                                <td class="py-1.5 text-ss-text-2">
                                    {{ Number(r.margin ?? 0).toFixed(1) }}%
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p
                    v-else-if="profit.data.value"
                    class="py-6 text-center text-[12px] text-ss-text-3"
                >
                    No profitability data for this month.
                </p>
            </section>

            <!-- Profitability history (per creator) -->
            <section
                class="space-y-3 rounded-xl border border-ss-border bg-ss-surface p-4"
            >
                <div class="flex flex-wrap items-end justify-between gap-3">
                    <span class="text-[13px] font-semibold text-ss-text"
                        >Profitability history</span
                    >
                    <div class="flex items-end gap-2">
                        <select v-model.number="histModelId" :class="selectCls">
                            <option
                                v-for="a in accounts"
                                :key="a.id"
                                :value="a.id"
                            >
                                {{ a.name }}
                            </option>
                        </select>
                        <select v-model.number="histMonths" :class="selectCls">
                            <option :value="6">6 months</option>
                            <option :value="12">12 months</option>
                            <option :value="24">24 months</option>
                        </select>
                        <button
                            type="button"
                            :class="runBtnCls"
                            :disabled="
                                histModelId == null || profitHist.loading.value
                            "
                            @click="loadProfitHistory"
                        >
                            Run
                        </button>
                    </div>
                </div>
                <SsInlineError
                    v-if="profitHist.error.value"
                    :message="profitHist.error.value"
                />
                <SsBarChart
                    v-else-if="profitHistPoints.length"
                    :points="profitHistPoints"
                />
                <p
                    v-else-if="profitHist.data.value"
                    class="py-6 text-center text-[12px] text-ss-text-3"
                >
                    No history for this creator.
                </p>
            </section>
        </template>
    </div>
</template>
