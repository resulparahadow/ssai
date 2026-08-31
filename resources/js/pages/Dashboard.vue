<script setup lang="ts">
import { Head, router, usePage } from '@inertiajs/vue3';
import { Calendar } from '@lucide/vue';
import { computed, watch } from 'vue';
import SsBarChart from '@/components/crm/SsBarChart.vue';
import SsSparkline from '@/components/crm/SsSparkline.vue';
import { useCreatorContext } from '@/composables/useCreatorContext';
import { ssColor } from '@/crm/nav';
import type { User } from '@/types/auth';
import type { DashboardData } from '@/types/crm';

defineProps<{ dashboard: DashboardData }>();

const page = usePage();
const { selection } = useCreatorContext();

const firstName = computed(
    () => (page.props.auth.user as User).name.split(' ')[0],
);

const greeting = computed(() => {
    const h = new Date().getHours();

    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
});

function setPeriod(period: string): void {
    router.get(
        '/dashboard',
        { period },
        { preserveScroll: true, preserveState: true, only: ['dashboard'] },
    );
}

// Re-fetch the (server-rendered) dashboard when the global creator context changes. The
// selection cookie is written synchronously before this fires, so the reload scopes correctly.
watch(selection, () => {
    router.reload({ only: ['dashboard'] });
});
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
                    {{
                        dashboard.selectedCreator
                            ? `Showing ${dashboard.selectedCreator}.`
                            : "Here's how the team is performing."
                    }}
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
                v-for="k in dashboard.aiKpis"
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

        <!--
          Pace vs target + Revenue attribution removed: both derived from the
          revenue tables that have no live data source. Revive alongside the
          dormant DashboardService revenue metrics when real revenue lands.
          Spec: docs/superpowers/specs/2026-07-07-dashboard-ai-operations-design.md
        -->

        <!-- AI cost across the period -->
        <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
            <h3 class="text-sm font-semibold text-ss-text">
                AI cost across the period
            </h3>
            <p class="mb-4 text-[12px] text-ss-text-3">
                Generation cost per
                {{ dashboard.period === 'Today' ? '4-hour block' : 'day' }}
            </p>
            <SsBarChart :points="dashboard.aiSeries" />
        </div>

        <!-- Creator models · AI activity -->
        <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
            <h3 class="mb-1 text-sm font-semibold text-ss-text">
                Creator models · AI activity
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
                                Generations
                            </th>
                            <th class="py-2 text-right font-medium">Calls</th>
                            <th class="py-2 text-right font-medium">AI cost</th>
                            <th class="py-2 text-right font-medium">$/msg</th>
                            <th class="py-2 text-right font-medium">Cache</th>
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
                            <td class="py-2.5 text-right text-ss-text-2">
                                {{ c.generations }}
                            </td>
                            <td class="py-2.5 text-right text-ss-text-2">
                                {{ c.calls }}
                            </td>
                            <td
                                class="py-2.5 text-right font-ss-mono font-medium text-ss-text"
                            >
                                {{ c.cost }}
                            </td>
                            <td
                                class="py-2.5 text-right font-ss-mono text-ss-text-2"
                            >
                                {{ c.perMsg }}
                            </td>
                            <td class="py-2.5 text-right text-ss-text-2">
                                {{ c.cachePct }}
                            </td>
                        </tr>
                        <tr v-if="!dashboard.creators.length">
                            <td
                                colspan="6"
                                class="py-6 text-center text-ss-text-3"
                            >
                                No AI activity for this period.
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- Chatter AI activity -->
        <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
            <h3 class="mb-1 text-sm font-semibold text-ss-text">
                Chatter AI activity
            </h3>
            <p class="mb-3 text-[12px] text-ss-text-3">
                {{ dashboard.period }} · AI generations
            </p>
            <div class="overflow-x-auto">
                <table class="w-full text-[13px]">
                    <thead>
                        <tr
                            class="border-b border-ss-border text-left text-[11px] text-ss-text-3"
                        >
                            <th class="py-2 font-medium">Chatter</th>
                            <th class="py-2 font-medium">Role</th>
                            <th class="py-2 text-right font-medium">
                                Generations
                            </th>
                            <th class="py-2 text-right font-medium">AI cost</th>
                            <th class="py-2 text-right font-medium">Cache</th>
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
                            <td class="py-2.5 text-right text-ss-text-2">
                                {{ r.generations }}
                            </td>
                            <td
                                class="py-2.5 text-right font-ss-mono font-medium text-ss-text"
                            >
                                {{ r.cost }}
                            </td>
                            <td class="py-2.5 text-right text-ss-text-2">
                                {{ r.cachePct }}
                            </td>
                        </tr>
                        <tr v-if="!dashboard.chatters.length">
                            <td
                                colspan="5"
                                class="py-6 text-center text-ss-text-3"
                            >
                                No AI activity for this period.
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</template>
