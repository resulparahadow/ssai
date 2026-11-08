<script setup lang="ts">
import {
    Film,
    Image as ImageIcon,
    LoaderCircle,
    Lock,
    MoreVertical,
    Music,
    Pencil,
    Plus,
    Trash2,
} from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import SsPpvSetModal from '@/components/crm/conversations/SsPpvSetModal.vue';
import { invalidatePpvSets, ppvSetsCache } from '@/lib/conversationCache';
import { relativeTime } from '@/lib/datetime';
import { usd } from '@/lib/money';
import { mediaSrc, ofApi } from '@/lib/onlyfans';
import type { OfMessage, PpvSet, PpvSetStatus } from '@/types/crm';

/**
 * Right-rail "PPV" tab: the creator's saved PPV sets as cards (the CreatorHero PPV tab the
 * team is used to). Click → `load` (Conversations puts it in the composer). Each card carries
 * a Sent / Bought pill for the OPEN fan, read from SSAI's own send ledger joined with the
 * loaded thread — sends made from CreatorHero or OnlyFans directly are not visible to it.
 * Managers get Edit / Delete per card; chatters only load.
 */
const props = defineProps<{
    modelId: number;
    chatId: string | null;
    messages: OfMessage[];
    canManage: boolean;
    /** Bumped by the page after a PPV send so the Sent/Bought pill re-reads the ledger. */
    statusKey: number;
}>();
const emit = defineEmits<{ load: [set: PpvSet] }>();

const sets = ref<PpvSet[]>(ppvSetsCache.get(props.modelId) ?? []);
const loading = ref(false);
const error = ref<string | null>(null);
const status = ref<PpvSetStatus>({});
const menuFor = ref<number | null>(null);
const editing = ref<PpvSet | null>(null);
const creating = ref(false);
const deleting = ref<number | null>(null);

let setsToken = 0;
let statusToken = 0;

async function loadSets(force = false) {
    const cached = ppvSetsCache.get(props.modelId);

    if (cached && !force) {
        sets.value = cached;

        return;
    }

    const mine = ++setsToken;
    loading.value = true;
    error.value = null;

    try {
        const res = await ofApi.ppvSets(props.modelId);

        if (mine !== setsToken) {
            return;
        }

        ppvSetsCache.set(props.modelId, res.sets);
        sets.value = res.sets;
    } catch (e) {
        if (mine === setsToken) {
            error.value = e instanceof Error ? e.message : String(e);
        }
    } finally {
        if (mine === setsToken) {
            loading.value = false;
        }
    }
}

async function loadStatus() {
    const mine = ++statusToken;
    status.value = {};

    if (!props.chatId) {
        return;
    }

    try {
        const res = await ofApi.ppvSetStatus(props.modelId, props.chatId);

        if (mine === statusToken) {
            status.value = res.status ?? {};
        }
    } catch {
        // The pill is advisory; a failed status read just shows no pill.
    }
}

onMounted(() => {
    void loadSets();
    void loadStatus();
});
watch(
    () => props.modelId,
    () => {
        sets.value = ppvSetsCache.get(props.modelId) ?? [];
        void loadSets();
    },
);
watch(
    () => [props.chatId, props.statusKey],
    () => void loadStatus(),
);

// ---- per-fan pill -----------------------------------------------------------

type Pill = { label: 'Bought' | 'Sent'; cls: string; title: string } | null;

const openedIds = computed(
    () =>
        new Set(
            props.messages
                .filter((m) => m.from === 'creator' && m.isOpened && m.id)
                .map((m) => String(m.id)),
        ),
);

function pillFor(set: PpvSet): Pill {
    const sends = status.value[String(set.id)] ?? [];

    if (!sends.length) {
        return null;
    }

    const last = sends[0];
    const title = `Sent ${sends.length}× · last ${relativeTime(last.sentAt)} · tracked for sends made from SSAI`;
    const bought = sends.some(
        (s) => s.messageId && openedIds.value.has(String(s.messageId)),
    );

    return bought
        ? { label: 'Bought', cls: 'bg-ss-pos/15 text-ss-pos', title }
        : { label: 'Sent', cls: 'bg-ss-warn/15 text-ss-warn', title };
}

// ---- card helpers -------------------------------------------------------------

function cover(set: PpvSet): string | null {
    const withThumb = set.media.find((m) => m.thumb);

    return withThumb?.thumb ? mediaSrc(props.modelId, withThumb.thumb) : null;
}

function counts(set: PpvSet) {
    const c = { photo: 0, video: 0, audio: 0 };

    for (const m of set.media) {
        if (m.type === 'video') {
            c.video++;
        } else if (m.type === 'audio') {
            c.audio++;
        } else {
            c.photo++; // photos + GIFs
        }
    }

    return c;
}

// ---- manager actions ------------------------------------------------------------

function onSaved(set: PpvSet) {
    const isNew = creating.value;
    editing.value = null;
    creating.value = false;
    invalidatePpvSets(props.modelId);
    sets.value = isNew
        ? [...sets.value, set]
        : sets.value.map((s) => (s.id === set.id ? set : s));
    ppvSetsCache.set(props.modelId, sets.value);
}

async function remove(set: PpvSet) {
    menuFor.value = null;

    if (
        !window.confirm(
            `Delete the PPV set "${set.name}"? Chatters will no longer see it.`,
        )
    ) {
        return;
    }

    deleting.value = set.id;

    try {
        await ofApi.deletePpvSet(props.modelId, set.id);
        sets.value = sets.value.filter((s) => s.id !== set.id);
        ppvSetsCache.set(props.modelId, sets.value);
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        deleting.value = null;
    }
}

function closeMenu(e: MouseEvent) {
    if (!(e.target as HTMLElement).closest('[data-ppv-menu]')) {
        menuFor.value = null;
    }
}
onMounted(() => document.addEventListener('click', closeMenu));
onBeforeUnmount(() => document.removeEventListener('click', closeMenu));
</script>

<template>
    <div class="min-h-0 flex-1 overflow-y-auto p-2">
        <div v-if="props.canManage" class="mb-2 flex items-center gap-2 px-1">
            <p class="text-[11px] text-ss-text-3">
                {{ sets.length }} set{{ sets.length === 1 ? '' : 's' }}
            </p>
            <span class="flex-1" />
            <button
                type="button"
                class="flex items-center gap-1 rounded-lg border border-ss-border px-2 py-1 text-[11px] font-semibold text-ss-text-2 transition-colors hover:border-ss-accent hover:text-ss-accent-text"
                title="Create a PPV set: pick media from the vault, set a price and a caption"
                @click="creating = true"
            >
                <Plus :size="12" /> New set
            </button>
        </div>

        <p v-if="error" class="mb-2 text-[12px] text-ss-neg">{{ error }}</p>

        <div
            v-if="loading && !sets.length"
            class="grid place-items-center py-8"
        >
            <LoaderCircle :size="18" class="animate-spin text-ss-text-3" />
        </div>

        <div
            v-else-if="!sets.length"
            class="px-2 py-8 text-center text-[12px] text-ss-text-3"
        >
            <p>No PPV sets yet.</p>
            <p v-if="props.canManage" class="mt-1">
                Click <span class="font-semibold text-ss-text-2">New set</span>
                to build one from the vault.
            </p>
            <p v-else class="mt-1">A manager can add them.</p>
        </div>

        <ul v-else class="space-y-2">
            <li
                v-for="set in sets"
                :key="set.id"
                class="relative flex cursor-pointer gap-2.5 rounded-xl border border-ss-border bg-ss-surface-2 p-2 transition-colors hover:border-ss-accent/50"
                tabindex="0"
                role="button"
                :title="`Load “${set.name}” into the composer`"
                @click="emit('load', set)"
                @keydown.enter.prevent="emit('load', set)"
            >
                <!-- cover -->
                <div
                    class="relative h-16 w-14 shrink-0 overflow-hidden rounded-lg bg-ss-surface"
                >
                    <img
                        v-if="cover(set)"
                        :src="cover(set)!"
                        alt=""
                        class="h-full w-full object-cover"
                        loading="lazy"
                    />
                    <span
                        v-else
                        class="grid h-full w-full place-items-center text-ss-text-3"
                    >
                        <Lock :size="16" />
                    </span>
                </div>

                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-1.5">
                        <span class="text-[13px] font-bold text-ss-text">{{
                            set.price === 0 ? 'Free' : usd(set.price)
                        }}</span>
                        <span class="flex-1" />
                        <span
                            v-if="pillFor(set)"
                            class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                            :class="pillFor(set)!.cls"
                            :title="pillFor(set)!.title"
                            >{{ pillFor(set)!.label }}</span
                        >
                        <div
                            v-if="props.canManage"
                            class="relative"
                            data-ppv-menu
                        >
                            <button
                                type="button"
                                class="grid h-6 w-6 place-items-center rounded text-ss-text-3 hover:bg-ss-surface hover:text-ss-text-2"
                                title="Edit or delete this set"
                                @click.stop="
                                    menuFor = menuFor === set.id ? null : set.id
                                "
                            >
                                <LoaderCircle
                                    v-if="deleting === set.id"
                                    :size="13"
                                    class="animate-spin"
                                />
                                <MoreVertical v-else :size="13" />
                            </button>
                            <div
                                v-if="menuFor === set.id"
                                class="absolute top-7 right-0 z-10 w-32 overflow-hidden rounded-lg border border-ss-border bg-ss-surface shadow-xl"
                            >
                                <button
                                    type="button"
                                    class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-ss-text-2 hover:bg-ss-surface-2"
                                    @click.stop="
                                        editing = set;
                                        menuFor = null;
                                    "
                                >
                                    <Pencil :size="12" /> Edit
                                </button>
                                <button
                                    type="button"
                                    class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-ss-neg hover:bg-ss-neg/10"
                                    @click.stop="remove(set)"
                                >
                                    <Trash2 :size="12" /> Delete
                                </button>
                            </div>
                        </div>
                    </div>

                    <p
                        class="truncate text-[12px] font-semibold text-ss-text-2"
                    >
                        {{ set.name }}
                    </p>

                    <p
                        class="mt-0.5 flex items-center gap-2 text-[11px] text-ss-text-3"
                    >
                        <span
                            v-if="counts(set).photo"
                            class="inline-flex items-center gap-0.5"
                            ><ImageIcon :size="11" />
                            {{ counts(set).photo }}</span
                        >
                        <span
                            v-if="counts(set).video"
                            class="inline-flex items-center gap-0.5"
                            ><Film :size="11" /> {{ counts(set).video }}</span
                        >
                        <span
                            v-if="counts(set).audio"
                            class="inline-flex items-center gap-0.5"
                            ><Music :size="11" /> {{ counts(set).audio }}</span
                        >
                    </p>

                    <p
                        v-if="set.caption"
                        class="mt-1 line-clamp-2 text-[11px] leading-snug text-ss-text-3"
                    >
                        {{ set.caption }}
                    </p>
                </div>
            </li>
        </ul>

        <SsPpvSetModal
            v-if="editing || creating"
            :model-id="props.modelId"
            :set="editing"
            @saved="onSaved"
            @close="
                editing = null;
                creating = false;
            "
        />
    </div>
</template>
