<script setup lang="ts">
import { Check, LoaderCircle, Play, Search, X } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import SsVaultRail from '@/components/crm/vault/SsVaultRail.vue';
import { mediaSrc, ofApi } from '@/lib/onlyfans';
import type { OfMedia, OfVaultList, PpvSetMedia } from '@/types/crm';

/**
 * Multi-select vault picker (folders left, that folder's media right), opened from the PPV set
 * modal. The selection is keyed by vault id and survives folder switches, so a set can be built
 * from several lists; `initial` pre-ticks the set's current media when editing. Nothing here
 * writes — the parent gets the picked media on **Add** and decides what to do with it.
 */
const props = withDefaults(
    defineProps<{
        modelId: number;
        initial?: PpvSetMedia[];
        max?: number;
    }>(),
    { initial: () => [], max: 40 },
);
const emit = defineEmits<{ add: [media: PpvSetMedia[]]; close: [] }>();

const FILTERS = [
    { label: 'All', value: '' },
    { label: 'Photo', value: 'photo' },
    { label: 'Video', value: 'video' },
    { label: 'GIF', value: 'gif' },
    { label: 'Audio', value: 'audio' },
] as const;

const PAGE = 48;

const listId = ref<string | null>(null);
const listName = ref('All media');
const items = ref<OfMedia[]>([]);
const filter = ref('');
const query = ref('');
const loading = ref(false);
const hasMore = ref(false);
const error = ref<string | null>(null);
let token = 0;
let searchTimer: ReturnType<typeof setTimeout> | null = null;

const selected = ref<Map<string, PpvSetMedia>>(
    new Map(props.initial.map((m) => [m.id, { ...m }])),
);
const count = computed(() => selected.value.size);
const full = computed(() => count.value >= props.max);
/** Order changed or membership changed vs. what we opened with. */
const changed = computed(() => {
    const a = props.initial.map((m) => m.id);
    const b = [...selected.value.keys()];

    return a.length !== b.length || a.some((id, i) => id !== b[i]);
});

async function load(reset: boolean) {
    loading.value = true;
    error.value = null;
    const mine = ++token;
    const offset = reset ? 0 : items.value.length;

    if (reset) {
        items.value = [];
        hasMore.value = false;
    }

    try {
        const params: Record<string, string> = {
            limit: String(PAGE),
            offset: String(offset),
        };

        if (filter.value) {
            params.type = filter.value;
        }

        if (listId.value) {
            params.list = listId.value;
        }

        if (query.value.trim()) {
            params.query = query.value.trim();
        }

        const r = await ofApi.vault(props.modelId, params);

        if (mine !== token) {
            return;
        }

        items.value = reset ? r.items : [...items.value, ...r.items];
        hasMore.value = r.hasMore;
    } catch (e) {
        if (mine === token) {
            error.value =
                e instanceof Error ? e.message : 'Failed to load the vault.';
        }
    } finally {
        if (mine === token) {
            loading.value = false;
        }
    }
}

function onList(l: OfVaultList | null) {
    listId.value = l?.id ?? null;
    listName.value = l?.name ?? 'All media';
    filter.value = '';
    query.value = '';
    load(true);
}

function pickFilter(f: string) {
    filter.value = f;
    load(true);
}

watch(query, () => {
    if (searchTimer) {
        clearTimeout(searchTimer);
    }

    searchTimer = setTimeout(() => load(true), 350);
});

function toPpvMedia(m: OfMedia): PpvSetMedia {
    return {
        id: m.id as string,
        type: (['photo', 'video', 'gif', 'audio'].includes(m.type)
            ? m.type
            : 'photo') as PpvSetMedia['type'],
        thumb: m.thumb ?? null,
    };
}

function toggle(m: OfMedia) {
    if (!m.id) {
        return;
    }

    const s = new Map(selected.value);

    if (s.has(m.id)) {
        s.delete(m.id);
    } else if (!full.value) {
        s.set(m.id, toPpvMedia(m));
    }

    selected.value = s;
}

function tileSrc(m: OfMedia): string {
    return mediaSrc(props.modelId, (m.thumb ?? m.preview) as string);
}

function add() {
    emit('add', [...selected.value.values()]);
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        emit('close');
    }
}

onMounted(() => {
    load(true);
    window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey);

    if (searchTimer) {
        clearTimeout(searchTimer);
    }
});
</script>

<template>
    <div
        class="fixed inset-0 z-[60] grid place-items-center bg-black/70 p-4 font-ss"
        @click.self="emit('close')"
    >
        <div
            class="flex h-[min(82vh,860px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-ss-border bg-ss-surface shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-label="Pick media from the vault"
        >
            <!-- Header -->
            <div
                class="flex items-center gap-3 border-b border-ss-border px-4 py-3"
            >
                <p class="text-[14px] font-semibold text-ss-text">Vault</p>
                <p class="text-[12px] text-ss-text-3">
                    Pick up to {{ props.max }} items for the set
                </p>
                <span class="flex-1" />
                <button
                    type="button"
                    class="grid h-7 w-7 place-items-center rounded text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text-2"
                    title="Close"
                    @click="emit('close')"
                >
                    <X :size="15" />
                </button>
            </div>

            <!-- Body: folders | media -->
            <div class="flex min-h-0 flex-1">
                <SsVaultRail
                    class="hidden w-60 shrink-0 sm:flex"
                    :model-id="props.modelId"
                    :can-manage="false"
                    :reload="0"
                    readonly
                    :selected-id="listId"
                    @select="onList"
                />

                <div class="flex min-w-0 flex-1 flex-col">
                    <div
                        class="flex flex-wrap items-center gap-2 border-b border-ss-border px-3 py-2"
                    >
                        <h3
                            class="min-w-0 truncate text-[13px] font-semibold text-ss-text"
                        >
                            {{ listName }}
                        </h3>
                        <div class="flex flex-wrap gap-1">
                            <button
                                v-for="f in FILTERS"
                                :key="f.value"
                                type="button"
                                class="rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors"
                                :class="
                                    filter === f.value
                                        ? 'border-ss-accent bg-ss-accent-soft text-ss-accent-text'
                                        : 'border-ss-border text-ss-text-2 hover:bg-ss-surface-2'
                                "
                                @click="pickFilter(f.value)"
                            >
                                {{ f.label }}
                            </button>
                        </div>
                        <span class="flex-1" />
                        <label
                            class="flex w-44 items-center gap-1.5 rounded-lg border border-ss-border bg-ss-surface-2 px-2"
                        >
                            <Search
                                :size="13"
                                class="shrink-0 text-ss-text-3"
                            />
                            <input
                                v-model="query"
                                type="search"
                                placeholder="Search vault"
                                class="w-full bg-transparent py-1.5 text-[12px] text-ss-text outline-none placeholder:text-ss-text-3"
                            />
                        </label>
                    </div>

                    <div class="min-h-0 flex-1 overflow-y-auto p-3">
                        <p
                            v-if="error"
                            class="py-6 text-center text-[12px] text-ss-neg"
                        >
                            {{ error }}
                        </p>

                        <p
                            v-else-if="!loading && items.length === 0"
                            class="py-10 text-center text-[12px] text-ss-text-3"
                        >
                            {{
                                filter || query.trim()
                                    ? 'Nothing here for this filter.'
                                    : 'This folder is empty.'
                            }}
                        </p>

                        <div
                            v-else
                            class="grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-5"
                        >
                            <button
                                v-for="(m, i) in items"
                                :key="`${m.id}-${i}`"
                                type="button"
                                class="group relative aspect-square overflow-hidden rounded-lg border bg-ss-surface-2 text-left transition-[border-color,opacity]"
                                :class="[
                                    m.id && selected.has(m.id)
                                        ? 'border-ss-accent ring-2 ring-ss-accent'
                                        : 'border-ss-border hover:border-ss-accent',
                                    full && !(m.id && selected.has(m.id))
                                        ? 'cursor-not-allowed opacity-50'
                                        : '',
                                ]"
                                :title="
                                    full && !(m.id && selected.has(m.id))
                                        ? `A set holds at most ${props.max} items`
                                        : m.type
                                "
                                :aria-pressed="!!(m.id && selected.has(m.id))"
                                @click="toggle(m)"
                            >
                                <img
                                    v-if="m.thumb || m.preview"
                                    :src="tileSrc(m)"
                                    :alt="m.type"
                                    class="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.02]"
                                    loading="lazy"
                                />
                                <span
                                    v-else
                                    class="grid h-full w-full place-items-center text-[10px] font-semibold text-ss-text-3 uppercase"
                                    >{{ m.type }}</span
                                >

                                <span
                                    class="absolute top-1.5 left-1.5 grid h-5 w-5 place-items-center rounded-full border transition-colors"
                                    :class="
                                        m.id && selected.has(m.id)
                                            ? 'border-ss-accent bg-ss-accent text-white'
                                            : 'border-white/70 bg-black/40 text-transparent group-hover:text-white/60'
                                    "
                                >
                                    <Check :size="12" />
                                </span>

                                <span
                                    v-if="m.type === 'video'"
                                    class="absolute right-1 bottom-1 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold text-white"
                                >
                                    <Play :size="9" fill="currentColor" />
                                    <template v-if="m.duration"
                                        >{{ m.duration }}s</template
                                    >
                                </span>
                            </button>
                        </div>

                        <div class="mt-3 grid place-items-center">
                            <LoaderCircle
                                v-if="loading"
                                :size="16"
                                class="animate-spin text-ss-accent-text"
                            />
                            <button
                                v-else-if="hasMore"
                                type="button"
                                class="rounded-lg border border-ss-border px-3 py-1.5 text-[12px] font-semibold text-ss-text-2 hover:bg-ss-surface-2"
                                @click="load(false)"
                            >
                                Load more
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <!-- Footer -->
            <div
                class="flex items-center gap-2 border-t border-ss-border px-4 py-3"
            >
                <p class="text-[12px] text-ss-text-2">
                    <span class="font-semibold text-ss-text">{{ count }}</span>
                    selected
                    <span v-if="full" class="text-ss-text-3">
                        · limit reached</span
                    >
                </p>
                <span class="flex-1" />
                <button
                    type="button"
                    class="rounded-lg border border-ss-border px-3 py-1.5 text-[12px] font-semibold text-ss-text-2 hover:bg-ss-surface-2"
                    @click="emit('close')"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    class="rounded-lg bg-ss-accent px-4 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                    :disabled="!count || !changed"
                    @click="add"
                >
                    {{
                        count
                            ? `Add ${count} item${count === 1 ? '' : 's'}`
                            : 'Add media'
                    }}
                </button>
            </div>
        </div>
    </div>
</template>
