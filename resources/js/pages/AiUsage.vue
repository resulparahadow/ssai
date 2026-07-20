<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { Calendar, Copy } from '@lucide/vue';
import { computed, watch } from 'vue';
import { toast } from 'vue-sonner';
import { useCreatorContext } from '@/composables/useCreatorContext';

interface SysBlock {
    idx: number;
    hasCacheControl: boolean;
    chars: number;
    estTokens: number;
}

interface UsageRow {
    id: number;
    ts: string | null;
    callType: string | null;
    model: string | null;
    source: string;
    creatorModel: string | null;
    input: number;
    cacheRead: number;
    cacheCreate: number;
    output: number;
    cost: number;
    cached: boolean;
    durationMs: number | null;
    tokPerSec: number | null;
    sysBlocks: SysBlock[];
}

interface UsagePayload {
    period: string;
    periodOptions: string[];
    summary: {
        totalCost: number;
        totalCalls: number;
        generations: number;
        costPerMsg: number;
        cacheHitRate: number;
        cacheLabel: string;
        cacheColor: 'pos' | 'neg' | 'neutral';
    };
    recent: UsageRow[];
}

const props = defineProps<{ usage: UsagePayload }>();

const { selection } = useCreatorContext();

// Re-fetch the (server-rendered) usage payload when the global creator context changes.
watch(selection, () => {
    router.reload({ only: ['usage'] });
});

const s = computed(() => props.usage.summary);

const cacheColorClass = computed(
    () =>
        ({ pos: 'text-ss-pos', neg: 'text-ss-neg', neutral: 'text-ss-text' })[
            s.value.cacheColor
        ],
);

function setPeriod(period: string): void {
    router.get(
        '/analytics/ai-usage',
        { period },
        { preserveScroll: true, preserveState: true, only: ['usage'] },
    );
}

function money(n: number, dp = 4): string {
    return '$' + n.toFixed(dp);
}

// Cache state per call — mirrors openCostDiagnostic (legacy js/api.js:215).
function cacheState(r: UsageRow): { label: string; cls: string } {
    if (r.cacheRead > 0) {
        return { label: 'HIT', cls: 'text-ss-pos' };
    }

    if (r.cacheCreate > 0) {
        return { label: 'MISS (wrote cache)', cls: 'text-ss-warn' };
    }

    return { label: 'NO CACHE', cls: 'text-ss-neg' };
}

// Per-block breakdown with the cumulative-prefix <1024 warning (legacy js/api.js:221-222):
// the 1024-token cache minimum applies to the whole prefix THROUGH a cache_control breakpoint.
function sysBreakdown(blocks: SysBlock[]): { text: string; warn: boolean }[] {
    let cum = 0;

    return blocks.map((b) => {
        cum += b.estTokens;
        const warn = b.hasCacheControl && cum < 1024;

        return {
            text: `#${b.idx}:${b.estTokens}t${b.hasCacheControl ? '✓' : ''}`,
            warn,
        };
    });
}

function copyDiagnostic(): void {
    const dump = {
        version: 'ai-usage/v1',
        period: props.usage.period,
        totalCost: s.value.totalCost,
        totalCalls: s.value.totalCalls,
        cacheHitRate: s.value.cacheHitRate,
        recentCalls: props.usage.recent.map((e) => ({
            callType: e.callType,
            modelUsed: e.model,
            cached: e.cached,
            tokens: {
                regular: e.input,
                cacheRead: e.cacheRead,
                cacheCreate: e.cacheCreate,
                output: e.output,
            },
            cost: Number(e.cost.toFixed(5)),
            sysBlocks: e.sysBlocks,
        })),
    };

    navigator.clipboard
        ?.writeText(JSON.stringify(dump, null, 2))
        .then(() => toast.success('Diagnostic copied to clipboard'))
        .catch(() => toast.error('Copy failed'));
}
</script>

<template>
    <Head title="AI usage" />

    <div class="mx-auto max-w-7xl space-y-5">
        <!-- Header + period filter -->
        <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
                <h2 class="text-xl font-bold text-ss-text">
                    AI usage &amp; cost
                </h2>
                <p class="text-sm text-ss-text-2">
                    Per-message generation cost and prompt-cache health.
                </p>
            </div>
            <div
                class="flex items-center gap-1 rounded-lg border border-ss-border bg-ss-surface p-1"
            >
                <Calendar :size="15" class="ml-1.5 text-ss-text-3" />
                <button
                    v-for="p in usage.periodOptions"
                    :key="p"
                    type="button"
                    class="rounded-md px-3 py-1 text-[13px] font-medium transition-colors"
                    :class="
                        p === usage.period
                            ? 'bg-ss-accent-soft text-ss-accent-text'
                            : 'text-ss-text-3 hover:text-ss-text'
                    "
                    @click="setPeriod(p)"
                >
                    {{ p }}
                </button>
            </div>
        </div>

        <!-- Summary cards ($/msg · Cache) -->
        <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <div class="rounded-xl border border-ss-border bg-ss-surface p-4">
                <div class="text-[12px] text-ss-text-2">Cost / message</div>
                <div class="mt-1 text-2xl font-bold text-ss-text">
                    {{ money(s.costPerMsg, 3) }}
                </div>
                <div class="mt-0.5 text-[11px] text-ss-text-3">
                    across {{ s.generations }} generation{{
                        s.generations === 1 ? '' : 's'
                    }}
                </div>
            </div>
            <div class="rounded-xl border border-ss-border bg-ss-surface p-4">
                <div class="text-[12px] text-ss-text-2">Total cost</div>
                <div class="mt-1 text-2xl font-bold text-ss-text">
                    {{ money(s.totalCost, 3) }}
                </div>
                <div class="mt-0.5 text-[11px] text-ss-text-3">
                    {{ s.totalCalls }} API call{{
                        s.totalCalls === 1 ? '' : 's'
                    }}
                </div>
            </div>
            <div class="rounded-xl border border-ss-border bg-ss-surface p-4">
                <div class="text-[12px] text-ss-text-2">Cache hit rate</div>
                <div class="mt-1 text-2xl font-bold" :class="cacheColorClass">
                    {{ s.cacheLabel }}
                </div>
                <div class="mt-0.5 text-[11px] text-ss-text-3">
                    green ≥70% · red &lt;40%
                </div>
            </div>
            <div class="rounded-xl border border-ss-border bg-ss-surface p-4">
                <div class="text-[12px] text-ss-text-2">Generations</div>
                <div class="mt-1 text-2xl font-bold text-ss-text">
                    {{ s.generations }}
                </div>
                <div class="mt-0.5 text-[11px] text-ss-text-3">
                    {{ s.totalCalls }} calls total
                </div>
            </div>
        </div>

        <!-- Recent-calls cost diagnostic -->
        <div
            class="overflow-hidden rounded-xl border border-ss-border bg-ss-surface"
        >
            <div
                class="flex items-center justify-between gap-2 border-b border-ss-border px-4 py-3"
            >
                <h3 class="text-base font-semibold text-ss-text">
                    Recent calls
                </h3>
                <button
                    type="button"
                    class="flex items-center gap-1.5 rounded-lg border border-ss-border px-3 py-1.5 text-[12px] font-medium text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-50"
                    :disabled="!usage.recent.length"
                    @click="copyDiagnostic"
                >
                    <Copy :size="13" /> Copy diagnostic JSON
                </button>
            </div>

            <p class="px-4 py-2 text-[10px] text-ss-text-3">
                <b>Legend:</b> r = regular input · cR = cache_read · cW =
                cache_create · sys block ✓ = has cache_control ·
                <span class="text-ss-neg">⚠</span> = cumulative prefix through
                this breakpoint under the 1024-token cache minimum (won't
                cache).
            </p>

            <div v-if="usage.recent.length" class="overflow-x-auto">
                <table class="w-full border-collapse text-[12px]">
                    <thead
                        class="bg-ss-surface-2 text-left text-[11px] text-ss-text-3"
                    >
                        <tr>
                            <th class="px-3 py-2 font-medium">When</th>
                            <th class="px-3 py-2 font-medium">Type</th>
                            <th class="px-3 py-2 font-medium">Model</th>
                            <th class="px-3 py-2 font-medium">Cache</th>
                            <th class="px-3 py-2 font-medium">Tokens</th>
                            <th class="px-3 py-2 font-medium">Breakdown</th>
                            <th class="px-3 py-2 font-medium">Cost</th>
                            <th class="px-3 py-2 font-medium">Sys blocks</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="r in usage.recent"
                            :key="r.id"
                            class="border-t border-ss-border"
                        >
                            <td
                                class="px-3 py-2 whitespace-nowrap text-ss-text-3"
                            >
                                {{
                                    r.ts ? new Date(r.ts).toLocaleString() : '—'
                                }}
                            </td>
                            <td class="px-3 py-2 text-ss-text">
                                {{ r.callType || '?' }}
                            </td>
                            <td
                                class="px-3 py-2 font-ss-mono text-[11px] text-ss-text-3"
                            >
                                {{ r.model }}
                            </td>
                            <td
                                class="px-3 py-2 font-semibold"
                                :class="cacheState(r).cls"
                            >
                                {{ cacheState(r).label }}
                            </td>
                            <td
                                class="px-3 py-2 font-ss-mono whitespace-nowrap text-ss-text-2"
                            >
                                in:{{ r.input + r.cacheRead + r.cacheCreate }} ·
                                out:{{ r.output }}
                            </td>
                            <td
                                class="px-3 py-2 font-ss-mono whitespace-nowrap text-ss-text-3"
                            >
                                r:{{ r.input }} · cR:{{ r.cacheRead }} · cW:{{
                                    r.cacheCreate
                                }}
                            </td>
                            <td
                                class="px-3 py-2 font-ss-mono whitespace-nowrap text-ss-text"
                            >
                                {{ money(r.cost) }}
                            </td>
                            <td class="px-3 py-2 text-[10px] text-ss-text-3">
                                <template v-if="r.sysBlocks.length">
                                    <span
                                        v-for="(b, i) in sysBreakdown(
                                            r.sysBlocks,
                                        )"
                                        :key="i"
                                    >
                                        {{ b.text
                                        }}<span
                                            v-if="b.warn"
                                            class="text-ss-neg"
                                            >⚠</span
                                        ><span
                                            v-if="i < r.sysBlocks.length - 1"
                                        >
                                            ·
                                        </span>
                                    </span>
                                </template>
                                <span v-else>(string sys)</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
            <p v-else class="px-4 py-10 text-center text-[13px] text-ss-text-3">
                No AI calls logged in this period. Generate a draft in
                Conversations to see usage here.
            </p>
        </div>
    </div>
</template>
