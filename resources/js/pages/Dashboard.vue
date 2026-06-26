<script setup lang="ts">
import { Head, router, usePage } from '@inertiajs/vue3';
import { Calendar, Target } from '@lucide/vue';
import { computed } from 'vue';
import SsBarChart from '@/components/crm/SsBarChart.vue';
import SsDonut from '@/components/crm/SsDonut.vue';
import SsSparkline from '@/components/crm/SsSparkline.vue';
import { ssColor } from '@/crm/nav';
import type { User } from '@/types/auth';
import type { DashboardData } from '@/types/crm';

const props = defineProps<{ dashboard: DashboardData }>();

const page = usePage();
const firstName = computed(
    () => (page.props.auth.user as User).name.split(' ')[0],
);

const greeting = computed(() => {
    const h = new Date().getHours();

    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
});

const turnover = computed(
    () => props.dashboard.kpis.find((k) => k.key === 'turnover')?.value ?? '$0',
);

function setPeriod(period: string): void {
    router.get(
        '/dashboard',
        { period },
        { preserveScroll: true, preserveState: true, only: ['dashboard'] },
    );
}
</script>

<template>
    <Head title="Overview" />

    <div class="mx-auto max-w-7xl space-y-5">
        <!-- Header -->
        <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
                <h2 class="text-xl font-bold text-ss-text">
                    {{ greeting }}, {{ firstName }}
                </h2>
                <p class="text-sm text-ss-text-2">
                    Here's how the team is performing.
                </p>
            </div>
            <div
                class="flex items-center gap-1 rounded-lg border border-ss-border bg-ss-surface p-1"
            >
                <Calendar :size="15" class="ml-1.5 text-ss-text-3" />
                <button
                    v-for="p in dashboard.periodOptions"
                    :key="p"
                    type="button"
                    class="rounded-md px-3 py-1 text-[13px] font-medium transition-colors"
                    :class="
                        p === dashboard.period
                            ? 'bg-ss-accent-soft text-ss-accent-text'
                            : 'text-ss-text-3 hover:text-ss-text'
                    "
                    @click="setPeriod(p)"
                >
                    {{ p }}
                </button>
            </div>
        </div>

        <!-- KPI row -->
        <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div
                v-for="k in dashboard.kpis"
                :key="k.key"
                class="rounded-xl border border-ss-border bg-ss-surface p-4"
            >
                <div class="text-[12px] text-ss-text-2">{{ k.label }}</div>
                <div class="mt-1 text-2xl font-bold text-ss-text">
                    {{ k.value }}
                </div>
                <div class="mt-2 h-8">
                    <SsSparkline :values="k.spark" :color="ssColor(k.color)" />
                </div>
            </div>
        </div>

        <!-- Pace vs target + attribution -->
        <div class="grid gap-4 lg:grid-cols-3">
            <div
                class="rounded-xl border border-ss-border bg-ss-surface p-5 lg:col-span-2"
            >
                <div class="mb-4 flex items-center gap-2">
                    <Target :size="16" class="text-ss-accent" />
                    <h3 class="text-sm font-semibold text-ss-text">
                        Pace vs target
                    </h3>
                </div>
                <div class="space-y-4">
                    <div v-for="t in dashboard.targets" :key="t.label">
                        <div
                            class="mb-1 flex items-center justify-between text-[13px]"
                        >
                            <span class="text-ss-text-2">{{ t.label }}</span>
                            <span class="font-ss-mono text-ss-text"
                                >{{ t.current }} / {{ t.goal }}</span
                            >
                        </div>
                        <div
                            class="h-2 overflow-hidden rounded-full bg-ss-bg-2"
                        >
                            <div
                                class="h-full rounded-full"
                                :style="{
                                    width: t.pct + '%',
                                    background: ssColor(t.color),
                                }"
                            />
                        </div>
                    </div>
                </div>
            </div>

            <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
                <h3 class="mb-3 text-sm font-semibold text-ss-text">
                    Revenue attribution
                </h3>
                <SsDonut
                    :slices="dashboard.attribution"
                    :center-value="turnover"
                    center-label="turnover"
                />
                <div class="mt-4 space-y-2">
                    <div
                        v-for="a in dashboard.attribution"
                        :key="a.label"
                        class="flex items-center gap-2 text-[13px]"
                    >
                        <span
                            class="h-2.5 w-2.5 rounded-full"
                            :style="{ background: ssColor(a.color) }"
                        />
                        <span class="flex-1 text-ss-text-2">{{ a.label }}</span>
                        <span class="text-ss-text-3">{{ a.pct }}%</span>
                        <span
                            class="w-16 text-right font-ss-mono text-ss-text"
                            >{{ a.value }}</span
                        >
                    </div>
                </div>
            </div>
        </div>

        <!-- Revenue across the period -->
        <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
            <h3 class="text-sm font-semibold text-ss-text">
                Results across the period
            </h3>
            <p class="mb-4 text-[12px] text-ss-text-3">
                Revenue per
                {{ dashboard.period === 'Today' ? '4-hour block' : 'day' }}
            </p>
            <SsBarChart :points="dashboard.revenueSeries" />
        </div>

        <!-- Per-creator comparison -->
        <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
            <h3 class="mb-1 text-sm font-semibold text-ss-text">
                Detailed comparison
            </h3>
            <p class="mb-3 text-[12px] text-ss-text-3">
                Per creator · {{ dashboard.period }}
            </p>
            <div class="overflow-x-auto">
                <table class="w-full text-[13px]">
                    <thead>
                        <tr
                            class="border-b border-ss-border text-left text-[11px] text-ss-text-3"
                        >
                            <th class="py-2 font-medium">Creator</th>
                            <th class="py-2 text-right font-medium">
                                Total rev
                            </th>
                            <th class="py-2 text-right font-medium">
                                New paid
                            </th>
                            <th class="py-2 text-right font-medium">
                                New free
                            </th>
                            <th class="py-2 text-right font-medium">
                                Sales rev
                            </th>
                            <th class="py-2 text-right font-medium">
                                Chat ratio
                            </th>
                            <th class="py-2 text-right font-medium">
                                Avg spend
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="c in dashboard.creators"
                            :key="c.name"
                            class="border-b border-ss-border-2 last:border-0"
                        >
                            <td class="py-2.5">
                                <div class="flex items-center gap-2">
                                    <span
                                        class="grid h-7 w-7 place-items-center rounded-lg bg-ss-accent-soft text-[10px] font-semibold text-ss-accent-text"
                                        >{{ c.initials }}</span
                                    >
                                    <span class="font-medium text-ss-text">{{
                                        c.name
                                    }}</span>
                                </div>
                            </td>
                            <td
                                class="py-2.5 text-right font-ss-mono font-medium text-ss-text"
                            >
                                {{ c.revenue }}
                            </td>
                            <td class="py-2.5 text-right text-ss-text-2">
                                {{ c.newPaid }}
                            </td>
                            <td class="py-2.5 text-right text-ss-text-2">
                                {{ c.newFree }}
                            </td>
                            <td
                                class="py-2.5 text-right font-ss-mono text-ss-text-2"
                            >
                                {{ c.salesRevenue }}
                            </td>
                            <td class="py-2.5 text-right text-ss-text-2">
                                {{ c.chatRatio }}
                            </td>
                            <td
                                class="py-2.5 text-right font-ss-mono text-ss-text-2"
                            >
                                {{ c.avgSpend }}
                            </td>
                        </tr>
                        <tr v-if="!dashboard.creators.length">
                            <td
                                colspan="7"
                                class="py-6 text-center text-ss-text-3"
                            >
                                No data for this period.
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Chatter leaderboard -->
        <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
            <h3 class="mb-1 text-sm font-semibold text-ss-text">
                Chatter leaderboard
            </h3>
            <p class="mb-3 text-[12px] text-ss-text-3">
                {{ dashboard.period }} · all creators
            </p>
            <div class="overflow-x-auto">
                <table class="w-full text-[13px]">
                    <thead>
                        <tr
                            class="border-b border-ss-border text-left text-[11px] text-ss-text-3"
                        >
                            <th class="py-2 font-medium">Chatter</th>
                            <th class="py-2 font-medium">Role</th>
                            <th class="py-2 text-right font-medium">Revenue</th>
                            <th class="py-2 text-right font-medium">
                                Sent messages
                            </th>
                            <th class="py-2 text-right font-medium">
                                Conversations
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="r in dashboard.chatters"
                            :key="r.name"
                            class="border-b border-ss-border-2 last:border-0"
                        >
                            <td class="py-2.5">
                                <div class="flex items-center gap-2">
                                    <span
                                        class="grid h-7 w-7 place-items-center rounded-lg bg-ss-surface-2 text-[10px] font-semibold text-ss-text-2"
                                        >{{ r.initials }}</span
                                    >
                                    <span class="font-medium text-ss-text">{{
                                        r.name
                                    }}</span>
                                </div>
                            </td>
                            <td class="py-2.5 text-ss-text-2">{{ r.role }}</td>
                            <td
                                class="py-2.5 text-right font-ss-mono font-medium text-ss-text"
                            >
                                {{ r.revenue }}
                            </td>
                            <td class="py-2.5 text-right text-ss-text-2">
                                {{ r.sentMessages }}
                            </td>
                            <td class="py-2.5 text-right text-ss-text-2">
                                {{ r.conversations }}
                            </td>
                        </tr>
                        <tr v-if="!dashboard.chatters.length">
                            <td
                                colspan="5"
                                class="py-6 text-center text-ss-text-3"
                            >
                                No data for this period.
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>
