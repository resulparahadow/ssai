<script setup lang="ts">
import { Lock, LockOpen, LoaderCircle, Sparkles } from '@lucide/vue';
import { onBeforeUnmount, reactive, ref, watch } from 'vue';
import { usd } from '@/lib/money';
import { ofApi } from '@/lib/onlyfans';
import type {
    OfFan,
    OfFanProfile,
    OfFanSummary,
    OfLockableField,
    OfToggleMode,
} from '@/types/crm';

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

// ---- Fan memory + controls (persisted customer_profiles, fed to AI) ----------
const TEMPS = ['cold', 'warm', 'hot'];
const MODES: OfToggleMode[] = ['AUTO', 'FORCE_ON', 'FORCE_OFF'];

const profile = ref<OfFanProfile | null>(null); // last-saved server state
const profileLoading = ref(false);
const profileSaving = ref(false);
const profileError = ref<string | null>(null);

// Editable mirror; only fields that differ from `profile` are sent on save.
const form = reactive({
    archetype: '',
    trust_level: 0,
    temperature: '',
    key_details: '',
    crm_notes: '',
    is_timewaster: false,
    sexting_mode: 'AUTO' as OfToggleMode,
    tip_mode: 'AUTO' as OfToggleMode,
});

function syncForm(p: OfFanProfile): void {
    profile.value = p;
    form.archetype = p.archetype ?? '';
    form.trust_level = p.trust_level;
    form.temperature = p.temperature ?? '';
    form.key_details = p.key_details ?? '';
    form.crm_notes = p.crm_notes ?? '';
    form.is_timewaster = p.is_timewaster;
    form.sexting_mode = p.sexting_mode;
    form.tip_mode = p.tip_mode;
}

function isLocked(field: OfLockableField): boolean {
    return profile.value?.locked_fields.includes(field) ?? false;
}

async function fetchProfile(): Promise<void> {
    if (!props.fan || props.modelId == null) {
        return;
    }

    const fanId = props.fan.id;
    profileLoading.value = true;
    profileError.value = null;

    try {
        const { profile: p } = await ofApi.getProfile(props.modelId, fanId);

        if (props.fan?.id === fanId) {
            syncForm(p);
        }
    } catch (e) {
        profileError.value =
            e instanceof Error ? e.message : 'Failed to load memory.';
    } finally {
        profileLoading.value = false;
    }
}

/** Send only edited fields — editing an AI-owned field pins it server-side. */
async function saveProfile(): Promise<void> {
    if (!props.fan || props.modelId == null || !profile.value) {
        return;
    }

    const p = profile.value;
    const payload: Record<string, unknown> = {};

    if (form.archetype !== (p.archetype ?? '')) {
        payload.archetype = form.archetype;
    }

    if (form.trust_level !== p.trust_level) {
        payload.trust_level = form.trust_level;
    }

    if (form.temperature !== (p.temperature ?? '')) {
        payload.temperature = form.temperature;
    }

    if (form.key_details !== (p.key_details ?? '')) {
        payload.key_details = form.key_details;
    }

    if (form.crm_notes !== (p.crm_notes ?? '')) {
        payload.crm_notes = form.crm_notes;
    }

    if (form.is_timewaster !== p.is_timewaster) {
        payload.is_timewaster = form.is_timewaster;
    }

    if (form.sexting_mode !== p.sexting_mode) {
        payload.sexting_mode = form.sexting_mode;
    }

    if (form.tip_mode !== p.tip_mode) {
        payload.tip_mode = form.tip_mode;
    }

    if (Object.keys(payload).length === 0) {
        return;
    }

    profileSaving.value = true;
    profileError.value = null;

    try {
        const { profile: next } = await ofApi.saveProfile(
            props.modelId,
            props.fan.id,
            payload,
        );
        syncForm(next);
    } catch (e) {
        profileError.value = e instanceof Error ? e.message : 'Failed to save.';
    } finally {
        profileSaving.value = false;
    }
}

/** Hand a pinned field back to the AI (clears + un-pins on the server). */
async function unlockField(field: OfLockableField): Promise<void> {
    if (!props.fan || props.modelId == null) {
        return;
    }

    profileSaving.value = true;

    try {
        const { profile: next } = await ofApi.saveProfile(
            props.modelId,
            props.fan.id,
            { unlock: [field] },
        );
        syncForm(next);
    } catch (e) {
        profileError.value =
            e instanceof Error ? e.message : 'Failed to unlock.';
    } finally {
        profileSaving.value = false;
    }
}

watch(
    () => props.fan?.id,
    () => {
        stopPolling();
        summary.value = null;
        generating.value = false;
        error.value = null;
        profile.value = null;
        profileError.value = null;

        if (props.fan && props.modelId != null) {
            fetchSummary();
            fetchProfile();
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

            <!-- Memory & Controls (persisted; fed to AI generation) ------------->
            <div
                v-if="fan"
                class="space-y-3 rounded-lg border border-ss-border bg-ss-bg-2 p-3"
            >
                <div class="flex items-center justify-between gap-2">
                    <span class="text-[12px] font-semibold text-ss-text"
                        >Memory &amp; controls</span
                    >
                    <button
                        type="button"
                        class="rounded-md bg-ss-accent px-2.5 py-1 text-[11px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        :disabled="profileSaving || profileLoading"
                        @click="saveProfile"
                    >
                        {{ profileSaving ? 'Saving…' : 'Save' }}
                    </button>
                </div>

                <p v-if="profileError" class="text-[11px] text-ss-neg">
                    {{ profileError }}
                </p>

                <div
                    v-if="profileLoading"
                    class="flex items-center gap-2 py-1 text-[11px] text-ss-text-3"
                >
                    <LoaderCircle :size="13" class="animate-spin" /> Loading
                    memory…
                </div>

                <template v-else>
                    <!-- Read-only spend from OnlyFans -->
                    <div
                        class="grid grid-cols-3 gap-2 rounded-lg bg-ss-surface-2 p-2 text-center"
                    >
                        <div>
                            <div class="text-[10px] text-ss-text-3">Spent</div>
                            <div class="text-[12px] font-semibold text-ss-text">
                                {{
                                    usd(
                                        fan?.totalSpent ??
                                            profile?.total_spend ??
                                            null,
                                    )
                                }}
                            </div>
                        </div>
                        <div>
                            <div class="text-[10px] text-ss-text-3">Tips</div>
                            <div class="text-[12px] font-semibold text-ss-text">
                                {{
                                    usd(
                                        fan?.tips ??
                                            profile?.tips_spend ??
                                            null,
                                    )
                                }}
                            </div>
                        </div>
                        <div>
                            <div class="text-[10px] text-ss-text-3">Sub</div>
                            <div class="text-[12px] font-semibold text-ss-text">
                                {{ profile?.subscription_status ?? '—' }}
                            </div>
                        </div>
                    </div>

                    <!-- AI-owned memory fields (each pinnable) -->
                    <div>
                        <div
                            class="mb-1 flex items-center justify-between text-[10px]"
                        >
                            <span class="text-ss-text-3">Archetype</span>
                            <button
                                v-if="isLocked('archetype')"
                                type="button"
                                class="flex items-center gap-1 text-ss-accent"
                                @click="unlockField('archetype')"
                            >
                                <Lock :size="10" /> pinned · let AI manage
                            </button>
                            <span
                                v-else
                                class="flex items-center gap-1 text-ss-text-3"
                                ><LockOpen :size="10" /> AI</span
                            >
                        </div>
                        <input
                            v-model="form.archetype"
                            type="text"
                            placeholder="e.g. Explorer, Whale"
                            class="w-full rounded-md border border-ss-border bg-ss-surface px-2 py-1 text-[12px] text-ss-text"
                        />
                    </div>

                    <div class="grid grid-cols-2 gap-2">
                        <div>
                            <div
                                class="mb-1 flex items-center justify-between text-[10px]"
                            >
                                <span class="text-ss-text-3">Trust</span>
                                <button
                                    v-if="isLocked('trust_level')"
                                    type="button"
                                    class="flex items-center gap-1 text-ss-accent"
                                    @click="unlockField('trust_level')"
                                >
                                    <Lock :size="10" />
                                </button>
                            </div>
                            <select
                                v-model.number="form.trust_level"
                                class="w-full rounded-md border border-ss-border bg-ss-surface px-2 py-1 text-[12px] text-ss-text"
                            >
                                <option
                                    v-for="n in [0, 1, 2, 3, 4, 5]"
                                    :key="n"
                                    :value="n"
                                >
                                    L{{ n }}
                                </option>
                            </select>
                        </div>
                        <div>
                            <div
                                class="mb-1 flex items-center justify-between text-[10px]"
                            >
                                <span class="text-ss-text-3">Temperature</span>
                                <button
                                    v-if="isLocked('temperature')"
                                    type="button"
                                    class="flex items-center gap-1 text-ss-accent"
                                    @click="unlockField('temperature')"
                                >
                                    <Lock :size="10" />
                                </button>
                            </div>
                            <select
                                v-model="form.temperature"
                                class="w-full rounded-md border border-ss-border bg-ss-surface px-2 py-1 text-[12px] text-ss-text"
                            >
                                <option value="">—</option>
                                <option v-for="t in TEMPS" :key="t" :value="t">
                                    {{ t }}
                                </option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <div
                            class="mb-1 flex items-center justify-between text-[10px]"
                        >
                            <span class="text-ss-text-3"
                                >Key details (AI memory)</span
                            >
                            <button
                                v-if="isLocked('key_details')"
                                type="button"
                                class="flex items-center gap-1 text-ss-accent"
                                @click="unlockField('key_details')"
                            >
                                <Lock :size="10" /> pinned · let AI manage
                            </button>
                        </div>
                        <textarea
                            v-model="form.key_details"
                            rows="2"
                            placeholder="Facts the AI should remember about him"
                            class="w-full resize-y rounded-md border border-ss-border bg-ss-surface px-2 py-1 text-[12px] text-ss-text"
                        />
                    </div>

                    <div>
                        <div class="mb-1 text-[10px] text-ss-text-3">Notes</div>
                        <textarea
                            v-model="form.crm_notes"
                            rows="2"
                            placeholder="Private notes (hard NOs, reminders)"
                            class="w-full resize-y rounded-md border border-ss-border bg-ss-surface px-2 py-1 text-[12px] text-ss-text"
                        />
                    </div>

                    <!-- Behavior toggles -->
                    <div
                        v-for="t in [
                            { key: 'sexting_mode' as const, label: 'Sexting' },
                            { key: 'tip_mode' as const, label: 'Tip-led' },
                        ]"
                        :key="t.key"
                        class="flex items-center justify-between gap-2"
                    >
                        <span class="text-[11px] text-ss-text-3">{{
                            t.label
                        }}</span>
                        <div
                            class="flex rounded-md border border-ss-border bg-ss-surface p-0.5"
                        >
                            <button
                                v-for="mode in MODES"
                                :key="mode"
                                type="button"
                                class="rounded px-1.5 py-0.5 text-[10px] font-medium transition-colors"
                                :class="
                                    form[t.key] === mode
                                        ? 'bg-ss-accent-soft text-ss-accent-text'
                                        : 'text-ss-text-3 hover:text-ss-text'
                                "
                                @click="form[t.key] = mode"
                            >
                                {{
                                    mode === 'AUTO'
                                        ? 'Auto'
                                        : mode === 'FORCE_ON'
                                          ? 'On'
                                          : 'Off'
                                }}
                            </button>
                        </div>
                    </div>

                    <label
                        class="flex items-center gap-2 text-[11px] text-ss-text-2"
                    >
                        <input v-model="form.is_timewaster" type="checkbox" />
                        Mark as timewaster
                    </label>
                </template>
            </div>

            <p v-if="!fan" class="text-ss-text-3">
                Open a conversation to load fan details.
            </p>
        </div>
    </div>
</template>
