<script setup lang="ts">
import {
    ChevronDown,
    ChevronRight,
    FolderPlus,
    LoaderCircle,
    Pencil,
    Plus,
    Search,
    Trash2,
    X,
} from '@lucide/vue';
import { onMounted, ref, watch } from 'vue';
import SsMediaLightbox from '@/components/crm/conversations/SsMediaLightbox.vue';
import { ofApi } from '@/lib/onlyfans';
import type { OfMedia, OfVaultList } from '@/types/crm';

const props = defineProps<{
    modelId: number;
    canManage: boolean;
    reload: number;
}>();

const PAGE = 24;

const lists = ref<OfVaultList[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const hasMore = ref(false);
const query = ref('');

const showCreate = ref(false);
const newName = ref('');
const creating = ref(false);

const expandedId = ref<string | null>(null);
const detail = ref<OfVaultList | null>(null);
const detailLoading = ref(false);
const detailError = ref<string | null>(null);

const renamingId = ref<string | null>(null);
const renameValue = ref('');
const busy = ref<string | null>(null);

const lightboxIndex = ref<number | null>(null);
const enriched = new Set<string>();

async function load(reset = true) {
    loading.value = true;
    error.value = null;
    const offset = reset ? 0 : lists.value.length;

    try {
        const params: Record<string, string> = {
            limit: String(PAGE),
            offset: String(offset),
        };

        if (query.value.trim()) {
            params.query = query.value.trim();
        }

        const r = await ofApi.vaultLists(props.modelId, params);
        lists.value = reset ? r.lists : [...lists.value, ...r.lists];
        hasMore.value = r.hasMore;
    } catch (e) {
        error.value =
            e instanceof Error ? e.message : 'Failed to load the lists.';
    } finally {
        loading.value = false;
    }
}

onMounted(() => load());
watch(
    () => props.modelId,
    () => {
        query.value = '';
        expandedId.value = null;
        detail.value = null;
        load();
    },
);
watch(
    () => props.reload,
    () => load(),
);

function count(l: OfVaultList): number {
    return l.photosCount + l.videosCount + l.gifsCount + l.audiosCount;
}

/** Vault thumbs are fansapi.com presigned urls (direct); only onlyfans.com needs the proxy. */
function tileSrc(m: OfMedia): string {
    const cdn = (m.thumb ?? m.preview) as string;

    return m.direct ? cdn : ofApi.mediaUrl(props.modelId, cdn);
}

async function create() {
    const name = newName.value.trim();

    if (!name) {
        return;
    }

    creating.value = true;
    error.value = null;

    try {
        await ofApi.createVaultList(props.modelId, name);
        newName.value = '';
        showCreate.value = false;
        await load();
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to create list.';
    } finally {
        creating.value = false;
    }
}

async function toggleExpand(l: OfVaultList) {
    if (!l.id) {
        return;
    }

    if (expandedId.value === l.id) {
        expandedId.value = null;
        detail.value = null;

        return;
    }

    expandedId.value = l.id;
    detail.value = null;
    detailError.value = null;
    detailLoading.value = true;

    try {
        const r = await ofApi.showVaultList(props.modelId, l.id);
        detail.value = r.list;
    } catch (e) {
        detailError.value =
            e instanceof Error ? e.message : 'Failed to load list contents.';
    } finally {
        detailLoading.value = false;
    }
}

function startRename(l: OfVaultList) {
    renamingId.value = l.id;
    renameValue.value = l.name;
}

async function saveRename(l: OfVaultList) {
    const name = renameValue.value.trim();

    if (!name || !l.id) {
        renamingId.value = null;

        return;
    }

    busy.value = l.id;
    error.value = null;

    try {
        const r = await ofApi.renameVaultList(props.modelId, l.id, name);
        l.name = r.list.name;
        renamingId.value = null;
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to rename list.';
    } finally {
        busy.value = null;
    }
}

async function remove(l: OfVaultList) {
    if (!l.id) {
        return;
    }

    if (
        !confirm(
            `Delete the list "${l.name}"? The media stays in the vault; only the list is removed.`,
        )
    ) {
        return;
    }

    busy.value = l.id;
    error.value = null;

    try {
        await ofApi.deleteVaultList(props.modelId, l.id);
        lists.value = lists.value.filter((x) => x.id !== l.id);

        if (expandedId.value === l.id) {
            expandedId.value = null;
            detail.value = null;
        }
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to delete list.';
    } finally {
        busy.value = null;
    }
}

/**
 * Resolve a video's playable source (absent from the list payload) via the single-media detail
 * endpoint before opening the lightbox — so non-DRM videos play instead of the DRM fallback.
 */
async function openMedia(m: OfMedia, i: number) {
    const arr = detail.value?.medias;

    if (m.type === 'video' && !m.source && m.id && !enriched.has(m.id) && arr) {
        enriched.add(m.id);

        try {
            const r = await ofApi.vaultMediaItem(props.modelId, m.id);

            if (r.item && arr[i]?.id === m.id) {
                arr[i] = { ...arr[i], ...r.item };
            }
        } catch {
            // Leave the item as-is; the lightbox shows the no-source fallback.
        }
    }

    lightboxIndex.value = i;
}

async function removeMedia(mediaId: string | null) {
    if (!mediaId || !detail.value?.id) {
        return;
    }

    busy.value = `m-${mediaId}`;
    detailError.value = null;

    try {
        await ofApi.removeFromVaultList(props.modelId, detail.value.id, [
            mediaId,
        ]);

        if (detail.value) {
            detail.value.medias = (detail.value.medias ?? []).filter(
                (m) => m.id !== mediaId,
            );
        }
    } catch (e) {
        detailError.value =
            e instanceof Error ? e.message : 'Failed to remove media.';
    } finally {
        busy.value = null;
    }
}
</script>

<template>
    <div class="p-4">
        <!-- Toolbar -->
        <div class="mb-3 flex flex-wrap items-center gap-2">
            <div
                class="flex min-w-[180px] flex-1 items-center gap-1.5 rounded-lg border border-ss-border bg-ss-surface-2 px-2 sm:max-w-xs"
            >
                <Search :size="14" class="shrink-0 text-ss-text-3" />
                <input
                    v-model="query"
                    type="text"
                    placeholder="Find a list…"
                    class="w-full bg-transparent py-1.5 text-[12px] text-ss-text outline-none placeholder:text-ss-text-3"
                    @keyup.enter="load()"
                />
            </div>
            <span class="flex-1" />
            <button
                type="button"
                class="flex items-center gap-1.5 rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90"
                @click="showCreate = !showCreate"
            >
                <Plus :size="14" />
                New list
            </button>
        </div>

        <!-- Create form -->
        <div
            v-if="showCreate"
            class="mb-3 flex items-center gap-2 rounded-xl border border-ss-border bg-ss-surface-2 p-3"
        >
            <input
                v-model="newName"
                type="text"
                placeholder="List name"
                class="w-full rounded-lg border border-ss-border bg-ss-surface px-2.5 py-1.5 text-[12px] text-ss-text outline-none placeholder:text-ss-text-3"
                @keyup.enter="create"
            />
            <button
                type="button"
                class="flex shrink-0 items-center gap-1 rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                :disabled="!newName.trim() || creating"
                @click="create"
            >
                <LoaderCircle v-if="creating" :size="14" class="animate-spin" />
                <FolderPlus v-else :size="14" />
                Create
            </button>
        </div>

        <p v-if="error" class="mb-2 text-[12px] text-ss-neg">{{ error }}</p>

        <div
            v-if="loading && !lists.length"
            class="grid place-items-center py-12"
        >
            <LoaderCircle :size="18" class="animate-spin text-ss-text-3" />
        </div>
        <p
            v-else-if="!lists.length"
            class="py-12 text-center text-[12px] text-ss-text-3"
        >
            No lists yet.
        </p>

        <!-- List rows -->
        <ul v-else class="space-y-1.5">
            <li
                v-for="l in lists"
                :key="l.id ?? l.name"
                class="overflow-hidden rounded-xl border border-ss-border bg-ss-surface"
            >
                <div class="flex items-center gap-2 px-3 py-2.5">
                    <button
                        type="button"
                        class="grid h-6 w-6 shrink-0 place-items-center rounded text-ss-text-3 hover:bg-ss-surface-2"
                        @click="toggleExpand(l)"
                    >
                        <component
                            :is="
                                expandedId === l.id ? ChevronDown : ChevronRight
                            "
                            :size="16"
                        />
                    </button>

                    <template v-if="renamingId === l.id">
                        <input
                            v-model="renameValue"
                            type="text"
                            class="min-w-0 flex-1 rounded-lg border border-ss-border bg-ss-surface-2 px-2 py-1 text-[13px] text-ss-text outline-none"
                            @keyup.enter="saveRename(l)"
                            @keyup.esc="renamingId = null"
                        />
                        <button
                            type="button"
                            class="rounded-lg bg-ss-accent px-2.5 py-1 text-[12px] font-semibold text-white hover:opacity-90"
                            @click="saveRename(l)"
                        >
                            Save
                        </button>
                        <button
                            type="button"
                            class="rounded-lg px-1.5 py-1 text-ss-text-3 hover:bg-ss-surface-2"
                            @click="renamingId = null"
                        >
                            <X :size="15" />
                        </button>
                    </template>

                    <template v-else>
                        <button
                            type="button"
                            class="flex min-w-0 flex-1 items-center gap-2 text-left"
                            @click="toggleExpand(l)"
                        >
                            <span
                                class="truncate text-[13px] font-medium text-ss-text"
                                >{{ l.name }}</span
                            >
                            <span
                                v-if="l.type !== 'custom'"
                                class="rounded-full bg-ss-surface-2 px-1.5 py-0.5 font-ss-mono text-[9px] font-semibold tracking-wide text-ss-text-3 uppercase"
                                >{{ l.type }}</span
                            >
                        </button>

                        <span
                            class="shrink-0 font-ss-mono text-[11px] text-ss-text-3"
                            >{{ count(l) }} items</span
                        >

                        <button
                            v-if="l.canUpdate"
                            type="button"
                            class="grid h-7 w-7 place-items-center rounded-lg text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text-2"
                            title="Rename"
                            @click="startRename(l)"
                        >
                            <Pencil :size="14" />
                        </button>
                        <button
                            v-if="canManage && l.canDelete"
                            type="button"
                            class="grid h-7 w-7 place-items-center rounded-lg text-ss-neg hover:bg-ss-neg/10 disabled:opacity-50"
                            title="Delete list"
                            :disabled="busy === l.id"
                            @click="remove(l)"
                        >
                            <LoaderCircle
                                v-if="busy === l.id"
                                :size="14"
                                class="animate-spin"
                            />
                            <Trash2 v-else :size="14" />
                        </button>
                    </template>
                </div>

                <!-- Expanded contents -->
                <div
                    v-if="expandedId === l.id"
                    class="border-t border-ss-border bg-ss-bg p-3"
                >
                    <div
                        v-if="detailLoading"
                        class="grid place-items-center py-6"
                    >
                        <LoaderCircle
                            :size="16"
                            class="animate-spin text-ss-text-3"
                        />
                    </div>
                    <p
                        v-else-if="detailError"
                        class="py-3 text-center text-[12px] text-ss-neg"
                    >
                        {{ detailError }}
                    </p>
                    <p
                        v-else-if="!detail?.medias?.length"
                        class="py-4 text-center text-[12px] text-ss-text-3"
                    >
                        This list is empty. Add media from the “All media” tab.
                    </p>
                    <div
                        v-else
                        class="grid grid-cols-4 gap-2 sm:grid-cols-6 md:grid-cols-8"
                    >
                        <div
                            v-for="(m, i) in detail.medias"
                            :key="`${m.id}-${i}`"
                            class="group relative aspect-square overflow-hidden rounded-lg border border-ss-border bg-ss-surface-2"
                        >
                            <img
                                v-if="m.thumb || m.preview"
                                :src="tileSrc(m)"
                                :alt="m.type"
                                class="h-full w-full cursor-pointer object-cover"
                                loading="lazy"
                                @click="openMedia(m, i)"
                            />
                            <span
                                v-else
                                class="grid h-full w-full place-items-center text-[10px] font-semibold text-ss-text-3 uppercase"
                                >{{ m.type }}</span
                            >
                            <button
                                type="button"
                                class="absolute top-1 right-1 grid h-6 w-6 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 hover:bg-ss-neg disabled:opacity-100"
                                title="Remove from list"
                                :disabled="busy === `m-${m.id}`"
                                @click="removeMedia(m.id)"
                            >
                                <LoaderCircle
                                    v-if="busy === `m-${m.id}`"
                                    :size="12"
                                    class="animate-spin"
                                />
                                <X v-else :size="13" />
                            </button>
                        </div>
                    </div>

                    <SsMediaLightbox
                        v-if="lightboxIndex !== null && detail?.medias"
                        :items="detail.medias"
                        :index="lightboxIndex"
                        :model-id="props.modelId"
                        @update:index="lightboxIndex = $event"
                        @close="lightboxIndex = null"
                    />
                </div>
            </li>
        </ul>

        <div v-if="hasMore" class="mt-3 grid place-items-center">
            <button
                type="button"
                class="rounded-lg border border-ss-border px-3 py-1.5 text-[12px] font-semibold text-ss-text-2 hover:bg-ss-surface-2"
                @click="load(false)"
            >
                Load more
            </button>
        </div>
    </div>
</template>
