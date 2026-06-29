<script setup lang="ts">
import { BadgeCheck, ChevronDown, LoaderCircle } from '@lucide/vue';
import { onMounted, ref } from 'vue';
import { ofModel } from '@/lib/onlyfansModel';
import type { OfFanRow, OfSubscriptionRecord } from '@/types/crm';

const props = defineProps<{ modelId: number }>();

type Bucket = 'active' | 'top';

const bucket = ref<Bucket>('active');
const fans = ref<OfFanRow[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const hasMore = ref(false);
const offset = ref(0);
const PAGE = 20;

const expanded = ref<string | null>(null);
const history = ref<Record<string, OfSubscriptionRecord[] | 'loading'>>({});

async function load(reset = true) {
    if (reset) {
        offset.value = 0;
        fans.value = [];
    }

    loading.value = true;
    error.value = null;

    try {
        const r = await ofModel.fans(props.modelId, {
            bucket: bucket.value,
            limit: PAGE,
            offset: offset.value,
        });
        fans.value = reset ? r.fans : [...fans.value, ...r.fans];
        hasMore.value = r.hasMore;
        offset.value += r.fans.length;
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to load fans.';
    } finally {
        loading.value = false;
    }
}

function switchBucket(b: Bucket) {
    if (bucket.value === b) {
        return;
    }

    bucket.value = b;
    expanded.value = null;
    load(true);
}

async function toggle(fan: OfFanRow) {
    if (!fan.id) {
        return;
    }

    if (expanded.value === fan.id) {
        expanded.value = null;

        return;
    }

    expanded.value = fan.id;

    if (!history.value[fan.id]) {
        history.value[fan.id] = 'loading';

        try {
            const r = await ofModel.fanHistory(props.modelId, fan.id);
            history.value[fan.id] = r.history;
        } catch {
            history.value[fan.id] = [];
        }
    }
}

function money(n: number | null): string {
    if (!n) {
        return '$0';
    }

    return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
}

function fmtDate(t: string | null): string {
    if (!t) {
        return '—';
    }

    const d = new Date(t);

    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

onMounted(() => load(true));
</script>

<template>
    <div class="space-y-3">
        <!-- bucket switch -->
        <div class="flex items-center gap-1.5">
            <button
                v-for="b in (['active', 'top'] as Bucket[])"
                :key="b"
                type="button"
                class="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors"
                :class="bucket === b ? 'bg-ss-surface-2 text-ss-text' : 'text-ss-text-3 hover:text-ss-text-2'"
                @click="switchBucket(b)"
            >
                {{ b === 'active' ? 'Active fans' : 'Top spenders' }}
            </button>
        </div>

        <p v-if="error" class="rounded-lg border border-ss-border bg-ss-surface p-4 text-center text-[12px] text-ss-neg">{{ error }}</p>

        <div v-if="fans.length" class="overflow-hidden rounded-xl border border-ss-border bg-ss-surface">
            <div v-for="fan in fans" :key="fan.id ?? fan.username ?? ''" class="border-b border-ss-border last:border-b-0">
                <button type="button" class="flex w-full items-center gap-3 p-3 text-left transition-colors hover:bg-ss-surface-2" @click="toggle(fan)">
                    <span class="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-ss-surface-2 text-[11px] font-semibold text-ss-text-2">
                        <img v-if="fan.avatar" :src="fan.avatar" :alt="fan.name ?? ''" class="h-full w-full object-cover" />
                        <template v-else>{{ fan.initials }}</template>
                    </span>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1 text-[13px] font-medium text-ss-text">
                            <span class="truncate">{{ fan.name || fan.username || 'Unknown' }}</span>
                            <BadgeCheck v-if="fan.isVerified" :size="13" class="shrink-0 text-ss-accent" />
                        </div>
                        <div class="truncate text-[11px] text-ss-text-3">
                            @{{ fan.username }}<template v-if="fan.durationLabel"> · {{ fan.durationLabel }}</template>
                        </div>
                    </div>
                    <div class="shrink-0 text-right">
                        <div class="text-[13px] font-semibold text-ss-pos">{{ money(fan.totalSpent) }}</div>
                        <div class="text-[10px] text-ss-text-3">spent</div>
                    </div>
                    <ChevronDown :size="15" class="shrink-0 text-ss-text-3 transition-transform" :class="{ 'rotate-180': expanded === fan.id }" />
                </button>

                <!-- expanded: subscription history -->
                <div v-if="expanded === fan.id" class="border-t border-ss-border bg-ss-bg/40 px-3 py-2.5">
                    <div class="mb-2 grid grid-cols-3 gap-2 text-center">
                        <div class="rounded-lg bg-ss-surface p-2">
                            <div class="text-[12px] font-semibold text-ss-text">{{ money(fan.tips) }}</div>
                            <div class="text-[10px] text-ss-text-3">Tips</div>
                        </div>
                        <div class="rounded-lg bg-ss-surface p-2">
                            <div class="text-[12px] font-semibold text-ss-text">{{ fan.subscribePrice != null ? money(fan.subscribePrice) : '—' }}</div>
                            <div class="text-[10px] text-ss-text-3">Sub price</div>
                        </div>
                        <div class="rounded-lg bg-ss-surface p-2">
                            <div class="text-[12px] font-semibold text-ss-text">{{ fmtDate(fan.lastSeen) }}</div>
                            <div class="text-[10px] text-ss-text-3">Last seen</div>
                        </div>
                    </div>
                    <div class="text-[11px] font-medium text-ss-text-2">Subscription history</div>
                    <p v-if="history[fan.id ?? ''] === 'loading'" class="py-2 text-[11px] text-ss-text-3">Loading…</p>
                    <template v-else>
                        <div
                            v-for="(h, i) in (history[fan.id ?? ''] as OfSubscriptionRecord[])"
                            :key="i"
                            class="flex items-center justify-between py-1 text-[11px] text-ss-text-2"
                        >
                            <span>{{ fmtDate(h.subscribeDate) }} → {{ fmtDate(h.expireDate) }}</span>
                            <span class="font-medium text-ss-text">{{ money(h.price) }}</span>
                        </div>
                        <p v-if="!(history[fan.id ?? ''] as OfSubscriptionRecord[])?.length" class="py-1 text-[11px] text-ss-text-3">No history.</p>
                    </template>
                </div>
            </div>
        </div>

        <p v-else-if="!loading" class="rounded-xl border border-ss-border bg-ss-surface p-6 text-center text-[13px] text-ss-text-3">No fans found.</p>

        <div class="flex justify-center">
            <button
                v-if="hasMore && bucket === 'active'"
                type="button"
                class="rounded-lg border border-ss-border px-4 py-2 text-[12px] font-medium text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-50"
                :disabled="loading"
                @click="load(false)"
            >
                Load more
            </button>
            <LoaderCircle v-if="loading" :size="18" class="animate-spin text-ss-text-3" />
        </div>
    </div>
</template>
