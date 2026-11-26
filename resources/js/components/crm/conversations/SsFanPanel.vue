<script setup lang="ts">
import {
    Lock,
    LockOpen,
    LoaderCircle,
    NotebookPen,
    Sparkles,
} from '@lucide/vue';
import { computed, onBeforeUnmount, reactive, ref, watch } from 'vue';
import SsNoteModal from '@/components/crm/conversations/SsNoteModal.vue';
import SsStateCard from '@/components/crm/conversations/SsStateCard.vue';
import { fanProfiles } from '@/lib/conversationCache';
import { absoluteTime, coarseDuration, relativeTime } from '@/lib/datetime';
import { usd } from '@/lib/money';
import { ofApi } from '@/lib/onlyfans';
import { switchPatch } from '@/lib/stateSwitches';
import type { SwitchKey, SwitchValue } from '@/lib/stateSwitches';
import type {
    OfFan,
    OfFanProfile,
    OfFanSummary,
    OfLockableField,
    OfToggleMode,
} from '@/types/crm';

const props = defineProps<{
    fan: OfFan | null;
    modelId: number | null;
    // The open chat (= the fan's id). The profile loads by it on open, without waiting for the
    // OnlyFans fan-detail call: support mode and the counters must not hang on a slow vendor.
    chatId?: string | null;
}>();

/** Whose profile this panel shows and edits. */
const profileKey = computed(() => props.chatId ?? props.fan?.id ?? null);

// ---- Live subscription indicators (from the same getUser call as the rows) ---

const PILL =
    'inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold';
const PILL_ON = 'bg-ss-pos/15 text-ss-pos';
const PILL_OFF = 'bg-ss-text-3/15 text-ss-text-3';

/**
 * "Expired" only fits someone who once had a subscription. Chat partners the creator
 * merely follows come back subscribed=false with no subscribeAt — calling them
 * "Expired" would read as a lapsed fan worth winning back, which they never were.
 */
const subscribedLabel = computed(() => {
    const f = props.fan;

    if (!f || f.subscribed === null) {
        return null;
    }

    if (f.subscribed) {
        return 'Subscribed';
    }

    return f.subscribedAt ? 'Expired' : 'Not subscribed';
});

/** OF's own wording when it sends one, else our approximation from the start date. */
const durationText = computed(() =>
    props.fan?.durationLabel
        ? props.fan.durationLabel
        : props.fan?.subscribedAt
          ? coarseDuration(props.fan.subscribedAt)
          : '—',
);

// usd() / relativeTime() already render null as an em-dash.
const liveRows = computed(() => [
    { label: 'Subscribed for', value: durationText.value, title: null },
    { label: 'Location', value: props.fan?.location || '—', title: null },
    { label: 'Sub price', value: usd(props.fan?.subscribePrice), title: null },
    {
        label: 'Last seen',
        value: relativeTime(props.fan?.lastSeen),
        title: absoluteTime(props.fan?.lastSeen),
    },
]);

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

// Last-saved server state, from the shared per-chat store (the page reads support mode, the Fan
// type override, counters and the ladder from the same entry). A revisit paints the cached copy
// at once and revalidates.
const profile = computed<OfFanProfile | null>(() =>
    profileKey.value ? (fanProfiles.get(profileKey.value) ?? null) : null,
);
const profileLoading = ref(false);
const profileSaving = ref(false);
const profileError = ref<string | null>(null);
const showNote = ref(false);

/** Keep the displayed mirror in step after the modal writes the note to OnlyFans. */
function onNoteSaved(notes: string): void {
    if (profile.value) {
        profile.value.crm_notes = notes === '' ? null : notes;
    }
}

// Editable mirror; only fields that differ from `profile` are sent on save.
const form = reactive({
    archetype: '',
    trust_level: 0,
    temperature: '',
    key_details: '',
    is_timewaster: false,
    sexting_mode: 'AUTO' as OfToggleMode,
    tip_mode: 'AUTO' as OfToggleMode,
});

/** Store the server's profile for `fanId`; the form follows only if that fan is still open. */
function syncForm(fanId: string, p: OfFanProfile): void {
    fanProfiles.set(fanId, p);

    // A switch still saving keeps its optimistic value over this (older) snapshot.
    for (const [k, v] of statePending.get(fanId) ?? []) {
        putSwitch(fanProfiles.get(fanId)!, k, v);
    }

    if (profileKey.value !== fanId) {
        return;
    }

    form.archetype = p.archetype ?? '';
    form.trust_level = p.trust_level;
    form.temperature = p.temperature ?? '';
    form.key_details = p.key_details ?? '';
    form.is_timewaster = p.is_timewaster;
    form.sexting_mode = p.sexting_mode;
    form.tip_mode = p.tip_mode;
}

function isLocked(field: OfLockableField): boolean {
    return profile.value?.locked_fields.includes(field) ?? false;
}

async function fetchProfile(): Promise<void> {
    if (!profileKey.value || props.modelId == null) {
        return;
    }

    const fanId = profileKey.value;
    profileLoading.value = true;
    profileError.value = null;

    try {
        const { profile: p } = await ofApi.getProfile(props.modelId, fanId);
        syncForm(fanId, p);
    } catch (e) {
        profileError.value =
            e instanceof Error ? e.message : 'Failed to load memory.';
    } finally {
        profileLoading.value = false;
    }
}

/** Send only edited fields — editing an AI-owned field pins it server-side. */
async function saveProfile(): Promise<void> {
    if (!profileKey.value || props.modelId == null || !profile.value) {
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

    const fanId = profileKey.value;
    profileSaving.value = true;
    profileError.value = null;

    try {
        const { profile: next } = await ofApi.saveProfile(
            props.modelId,
            fanId,
            payload,
        );
        syncForm(fanId, next);
    } catch (e) {
        profileError.value = e instanceof Error ? e.message : 'Failed to save.';
    } finally {
        profileSaving.value = false;
    }
}

/** Hand a pinned field back to the AI (un-pins; the server clears it, except the memory log). */
async function unlockField(field: OfLockableField): Promise<void> {
    if (!profileKey.value || props.modelId == null) {
        return;
    }

    const fanId = profileKey.value;
    profileSaving.value = true;

    try {
        const { profile: next } = await ofApi.saveProfile(
            props.modelId,
            fanId,
            { unlock: [field] },
        );
        syncForm(fanId, next);
    } catch (e) {
        profileError.value =
            e instanceof Error ? e.message : 'Failed to unlock.';
    } finally {
        profileSaving.value = false;
    }
}

// ---- SSAI state switches (§5b): optimistic per row, rolled back on failure ----

// All three keyed `${fanId}:${key}`, so a save still in flight for the fan just left can't
// spin, claim or clear a row of the fan now open.
const stateSavingKeys = reactive(new Set<string>());
const stateSaving = computed(() => {
    const out: Partial<Record<SwitchKey, boolean>> = {};
    const id = profileKey.value;

    for (const k of stateSavingKeys) {
        const [fanId, key] = k.split(':') as [string, SwitchKey];

        if (fanId === id) {
            out[key] = true;
        }
    }

    return out;
});
const stateError = ref<string | null>(null);
// Per-row token: a fast double change can land out of order — only the latest owns the row.
const stateSeq = new Map<string, number>();
// Values still on their way to the server, re-applied over any response that predates them.
const statePending = new Map<string, Map<SwitchKey, SwitchValue | null>>();

/** A row's last value the server confirmed. A failed save rolls back to THIS, not to the value
 *  shown when that call started: with two quick changes A → B on one row, B's "before" is A's
 *  optimistic value, which may never have been saved. */
type RowSnapshot = {
    override: unknown;
    trust: number;
    locked: OfLockableField[];
};
const stateConfirmed = new Map<string, RowSnapshot>();

// Rows whose latest change failed and was rolled back while an OLDER save was still in flight:
// if that older save then lands, it is the server's value and the row must show it.
const stateRolledBack = new Set<string>();

/** Show a row's snapshot on the stored profile (a rollback, or a late older save landing). */
function applyRow(fanId: string, key: SwitchKey, snap: RowSnapshot): void {
    const cur = fanProfiles.get(fanId);

    if (!cur) {
        return;
    }

    if (key === 'trust') {
        cur.trust_level = snap.trust;
        cur.locked_fields = snap.locked;

        if (profileKey.value === fanId) {
            form.trust_level = snap.trust;
        }
    } else {
        putSwitch(cur, key, (snap.override ?? null) as SwitchValue | null);
    }
}

function rowSnapshot(p: OfFanProfile, key: SwitchKey): RowSnapshot {
    return {
        override: p.state_overrides[key as keyof typeof p.state_overrides],
        trust: p.trust_level,
        locked: [...p.locked_fields],
    };
}

/** Put one switch value on a stored profile (the optimistic write, and its re-apply). */
function putSwitch(
    p: OfFanProfile,
    key: SwitchKey,
    value: SwitchValue | null,
): void {
    if (key === 'trust') {
        const rest = p.locked_fields.filter((f) => f !== 'trust_level');

        if (value === null) {
            p.locked_fields = rest;
        } else {
            p.trust_level = Number(value);
            p.locked_fields = [...rest, 'trust_level'];
        }

        return;
    }

    const next = { ...p.state_overrides } as Record<string, unknown>;

    if (value === null || value === '') {
        delete next[key];
    } else {
        next[key] = value;
    }

    p.state_overrides = next;
}

/**
 * Take the server's state keys only. A card save must not go through syncForm: that rewrites the
 * whole Memory form and would wipe an unsaved edit there (a half-typed archetype). Trust follows
 * into the form only when the form still showed the old saved level (no unsaved trust edit).
 */
function applyStateKeys(fanId: string, next: OfFanProfile): void {
    const p = fanProfiles.get(fanId);

    if (!p) {
        fanProfiles.set(fanId, next);

        return;
    }

    if (profileKey.value === fanId && form.trust_level === p.trust_level) {
        form.trust_level = next.trust_level;
    }

    p.state_overrides = next.state_overrides;
    p.auto_read = next.auto_read;
    p.counters = next.counters;
    p.is_bilingual = next.is_bilingual;
    p.price_ladder = next.price_ladder;
    p.trust_level = next.trust_level;
    p.locked_fields = next.locked_fields;

    for (const [k, v] of statePending.get(fanId) ?? []) {
        putSwitch(p, k, v);
    }
}

async function setSwitch(key: SwitchKey, value: SwitchValue | null) {
    const fanId = profileKey.value;
    const p = profile.value;

    if (!fanId || props.modelId == null || !p) {
        return;
    }

    const rowId = `${fanId}:${key}`;

    // The first unconfirmed change on this row records the server's value to fall back to.
    if (!stateConfirmed.has(rowId)) {
        stateConfirmed.set(rowId, rowSnapshot(p, key));
    }

    const seq = (stateSeq.get(rowId) ?? 0) + 1;
    stateSeq.set(rowId, seq);
    stateRolledBack.delete(rowId); // this change owns the row now
    const pending = statePending.get(fanId) ?? new Map();
    statePending.set(fanId, pending);
    pending.set(key, value);

    putSwitch(p, key, value);

    if (key === 'trust' && value !== null) {
        form.trust_level = Number(value);
    }

    stateSavingKeys.add(rowId);
    stateError.value = null;

    try {
        const { profile: next } = await ofApi.saveProfile(
            props.modelId,
            fanId,
            switchPatch(key, value),
        );

        if (stateSeq.get(rowId) !== seq) {
            if (stateRolledBack.has(rowId)) {
                // The newer change already failed and rolled back to a value from before this
                // one: this save is the server's truth now, so show it.
                applyRow(fanId, key, rowSnapshot(next, key));
            } else {
                // A newer change is still in flight: this is now the value to roll back to.
                stateConfirmed.set(rowId, rowSnapshot(next, key));
            }

            return;
        }

        stateConfirmed.delete(rowId);
        stateRolledBack.delete(rowId);
        pending.delete(key);
        applyStateKeys(fanId, next);
    } catch (e) {
        if (stateSeq.get(rowId) !== seq) {
            return;
        }

        const before = stateConfirmed.get(rowId) ?? rowSnapshot(p, key);
        stateConfirmed.delete(rowId);
        stateRolledBack.add(rowId);
        pending.delete(key);
        // Roll back THIS row only: another row may have changed meanwhile.
        applyRow(fanId, key, before);

        if (profileKey.value === fanId) {
            stateError.value =
                e instanceof Error ? e.message : 'Failed to save the switch.';
        }
    } finally {
        if (stateSeq.get(rowId) === seq) {
            stateSavingKeys.delete(rowId);
        }
    }
}

watch(
    () => props.fan?.id,
    () => {
        stopPolling();
        summary.value = null;
        generating.value = false;
        error.value = null;
        showNote.value = false;

        if (props.fan && props.modelId != null) {
            fetchSummary();
        }
    },
    { immediate: true },
);

watch(
    profileKey,
    (key) => {
        profileError.value = null;
        stateError.value = null;

        // Paint the cached profile at once (stale-while-revalidate); the fetch below refreshes it.
        if (key && profile.value) {
            syncForm(key, profile.value);
        }

        if (key && props.modelId != null) {
            fetchProfile();
        }
    },
    { immediate: true },
);

onBeforeUnmount(stopPolling);
</script>

<template>
    <div class="flex flex-1 flex-col overflow-hidden">
        <SsNoteModal
            v-if="showNote && fan && modelId != null"
            :model-id="modelId"
            :chat-id="fan.id"
            :fan-name="fan.name ?? 'this fan'"
            @close="showNote = false"
            @saved="onNoteSaved"
        />
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

            <!--
              Hidden entirely when OnlyFans doesn't tell us the state — a defaulted
              pill would be a confident lie a chatter might act on.
            -->
            <div v-if="subscribedLabel" class="flex items-center">
                <span :class="[PILL, fan!.subscribed ? PILL_ON : PILL_OFF]">
                    <span
                        class="h-1.5 w-1.5 rounded-full"
                        :class="fan!.subscribed ? 'bg-ss-pos' : 'bg-ss-text-3'"
                    />
                    {{ subscribedLabel }}
                </span>
            </div>

            <div
                v-for="row in liveRows"
                :key="row.label"
                class="flex items-center justify-between gap-2"
            >
                <span class="text-ss-text-3">{{ row.label }}</span>
                <span
                    class="truncate font-medium text-ss-text"
                    :title="row.title ?? undefined"
                    >{{ row.value }}</span
                >
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
                                >Key details (AI memory log)</span
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
                        <!-- One dated entry per conversation; the AI rewrites only the newest. -->
                        <textarea
                            v-model="form.key_details"
                            rows="5"
                            placeholder="Facts the AI should remember about him — it adds a dated entry per conversation"
                            class="w-full resize-y rounded-md border border-ss-border bg-ss-surface px-2 py-1 text-[12px] text-ss-text"
                        />
                    </div>

                    <!-- The note lives on OnlyFans; this shows the local mirror (free) and
                         edits go through the modal, which reads/writes OnlyFans directly. -->
                    <div>
                        <div
                            class="mb-1 flex items-center justify-between gap-2"
                        >
                            <span class="text-[10px] text-ss-text-3"
                                >OnlyFans note</span
                            >
                            <button
                                type="button"
                                class="flex items-center gap-1 text-[10px] text-ss-text-3 hover:text-ss-text"
                                @click="showNote = true"
                            >
                                <NotebookPen :size="11" />
                                Edit
                            </button>
                        </div>
                        <p
                            v-if="profile?.crm_notes"
                            class="rounded-md border border-ss-border bg-ss-surface px-2 py-1 text-[12px] whitespace-pre-wrap text-ss-text"
                        >
                            {{ profile.crm_notes }}
                        </p>
                        <p
                            v-else
                            class="rounded-md border border-dashed border-ss-border px-2 py-1 text-[12px] text-ss-text-3"
                        >
                            No note yet.
                        </p>
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

            <!-- SSAI state (§5b switches): under Memory & controls -->
            <SsStateCard
                v-if="profile"
                :profile="profile"
                :saving="stateSaving"
                :error="stateError"
                @change="setSwitch"
            />

            <p v-if="!fan" class="text-ss-text-3">
                Open a conversation to load fan details.
            </p>
        </div>
    </div>
</template>
