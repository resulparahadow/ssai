<script setup lang="ts">
import { LoaderCircle, Sparkles } from '@lucide/vue';
import { onBeforeUnmount, ref, watch } from 'vue';
import { ofApi } from '@/lib/onlyfans';
import type { OfFan, OfFanSummary } from '@/types/crm';

const props = defineProps<{ fan: OfFan | null; modelId: number | null }>();

// ---- AI fan summary (generate → poll GET until it leaves `processing`) -------
const summary = ref<OfFanSummary | null>(null);
const loading = ref(false); // initial fetch
const generating = ref(false); // queued a generation, polling
const error = ref<string | null>(null);
let pollTimer: ReturnType<typeof setTimeout> | null = null;

function stopPolling(): void {
    if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
    }
}

async function fetchSummary(): Promise<void> {
    if (!props.fan || props.modelId == null) {
        return;
    }

    const fanId = props.fan.id;
    loading.value = true;
    error.value = null;

    try {
        const s = await ofApi.fanSummary(props.modelId, fanId);

        if (props.fan?.id !== fanId) {
            return;
        } // fan changed mid-flight

        summary.value = s;

        if (s.status === 'processing') {
            poll(fanId);
        }
    } catch (e) {
        error.value =
            e instanceof Error ? e.message : 'Failed to load summary.';
    } finally {
        loading.value = false;
    }
}

function poll(fanId: string): void {
    generating.value = true;
    stopPolling();
    pollTimer = setTimeout(async () => {
        if (!props.fan || props.fan.id !== fanId || props.modelId == null) {
            generating.value = false;

            return;
        }

        try {
            const s = await ofApi.fanSummary(props.modelId, fanId);

            if (props.fan?.id !== fanId) {
                return;
            }

            summary.value = s;

            if (s.status === 'processing') {
                poll(fanId);
            } else {
                generating.value = false;
            }
        } catch (e) {
            error.value =
                e instanceof Error ? e.message : 'Summary poll failed.';
            generating.value = false;
        }
    }, 3000);
}

async function generate(): Promise<void> {
    if (!props.fan || props.modelId == null) {
        return;
    }

    const fanId = props.fan.id;
    const regenerate = summary.value?.status === 'completed';
    error.value = null;
    generating.value = true;

    try {
        await ofApi.generateFanSummary(props.modelId, fanId, regenerate);

        if (props.fan?.id === fanId) {
            poll(fanId);
        }
    } catch (e) {
        error.value =
            e instanceof Error ? e.message : 'Failed to queue summary.';
        generating.value = false;
    }
}

// Rows worth showing (non-empty), in a friendly order.
const SUMMARY_FIELDS: {
    key: keyof NonNullable<OfFanSummary['summary_data']>;
    label: string;
}[] = [
    { key: 'preferred_name', label: 'Preferred name' },
    { key: 'interests', label: 'Interests' },
    { key: 'hobbies', label: 'Hobbies' },
    { key: 'content_preferences', label: 'Content preferences' },
    { key: 'themes', label: 'Themes' },
    { key: 'kinks', label: 'Kinks' },
    { key: 'requests', label: 'Requests' },
    { key: 'travel_plans', label: 'Travel plans' },
    { key: 'family_pets', label: 'Family & pets' },
    { key: 'other_notes', label: 'Other notes' },
];

watch(
    () => props.fan?.id,
    () => {
        stopPolling();
        summary.value = null;
        generating.value = false;
        error.value = null;

        if (props.fan && props.modelId != null) {
            fetchSummary();
        }
    },
    { immediate: true },
);

onBeforeUnmount(stopPolling);
</script>

<template>
    <div class="flex flex-1 flex-col overflow-hidden">
        <div class="border-b border-ss-border p-4">
            <div class="flex items-center gap-3">
                <span
                    class="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl bg-ss-surface-2 text-sm font-semibold text-ss-text-2"
                >
                    <img
                        v-if="fan?.avatar"
                        :src="fan.avatar"
                        :alt="fan.name ?? ''"
                        class="h-full w-full object-cover"
                    />
                    <template v-else>{{
                        (fan?.name ?? '?').slice(0, 2).toUpperCase()
                    }}</template>
                </span>
                <div class="min-w-0">
                    <div class="truncate text-sm font-semibold text-ss-text">
                        {{ fan?.name ?? '—' }}
                    </div>
                    <div class="truncate text-[12px] text-ss-text-3">
                        @{{ fan?.username ?? '—' }}
                    </div>
                </div>
            </div>
        </div>

        <div class="flex-1 space-y-3 overflow-y-auto p-4 text-[13px]">
            <p class="text-[11px] text-ss-text-3">Live from OnlyFans</p>
            <div
                v-for="row in [
                    { label: 'Location', value: fan?.location },
                    {
                        label: 'Subscribe price',
                        value:
                            fan?.subscribePrice != null
                                ? '$' + fan.subscribePrice
                                : null,
                    },
                    { label: 'Last seen', value: fan?.lastSeen },
                ]"
                :key="row.label"
                class="flex items-center justify-between gap-2"
            >
                <span class="text-ss-text-3">{{ row.label }}</span>
                <span class="truncate font-medium text-ss-text">{{
                    row.value ?? '—'
                }}</span>
            </div>

            <div v-if="fan?.about">
                <div class="mb-1 text-[11px] font-semibold text-ss-text-3">
                    About
                </div>
                <p
                    class="rounded-lg bg-ss-bg-2 p-2.5 text-[13px] text-ss-text-2"
                >
                    {{ fan.about }}
                </p>
            </div>

            <!-- AI profile summary --------------------------------------------->
            <div
                v-if="fan"
                class="rounded-lg border border-ss-border bg-ss-bg-2 p-3"
            >
                <div class="mb-2 flex items-center justify-between gap-2">
                    <div class="flex items-center gap-1.5">
                        <Sparkles :size="14" class="text-ss-accent" />
                        <span class="text-[12px] font-semibold text-ss-text"
                            >AI summary</span
                        >
                    </div>
                    <button
                        type="button"
                        class="rounded-md bg-ss-accent px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        :disabled="generating || loading"
                        @click="generate"
                    >
                        {{
                            summary?.status === 'completed'
                                ? 'Regenerate'
                                : 'Generate'
                        }}
                    </button>
                </div>

                <p v-if="error" class="text-[11px] text-ss-neg">{{ error }}</p>

                <div
                    v-else-if="loading || generating"
                    class="flex items-center gap-2 py-2 text-[11px] text-ss-text-3"
                >
                    <LoaderCircle :size="13" class="animate-spin" />
                    {{ generating ? 'Generating summary…' : 'Loading…' }}
                </div>

                <template
                    v-else-if="
                        summary?.status === 'completed' && summary.summary_data
                    "
                >
                    <div class="space-y-1.5">
                        <div
                            v-for="f in SUMMARY_FIELDS.filter(
                                (f) => summary?.summary_data?.[f.key],
                            )"
                            :key="f.key"
                        >
                            <div class="text-[10px] text-ss-text-3">
                                {{ f.label }}
                            </div>
                            <div class="text-[12px] text-ss-text-2">
                                {{ summary.summary_data[f.key] }}
                            </div>
                        </div>
                    </div>
                    <p
                        v-if="summary.analyzed_message_count"
                        class="mt-2 text-[10px] text-ss-text-3"
                    >
                        From {{ summary.analyzed_message_count }} analyzed
                        messages.
                    </p>
                </template>

                <p v-else class="py-1 text-[11px] text-ss-text-3">
                    No summary yet — generate one from this fan's messages (uses
                    200 API credits).
                </p>
            </div>

            <p v-if="!fan" class="text-ss-text-3">
                Open a conversation to load fan details.
            </p>
        </div>
    </div>
</template>
