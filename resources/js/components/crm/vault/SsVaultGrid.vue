<script setup lang="ts">
import {
    AlertCircle,
    Check,
    CheckCircle2,
    FolderPlus,
    Link2,
    ListPlus,
    LoaderCircle,
    Trash2,
    Upload,
    X,
} from '@lucide/vue';
import { computed, onMounted, ref, watch } from 'vue';
import SsMediaLightbox from '@/components/crm/conversations/SsMediaLightbox.vue';
import { ofApi } from '@/lib/onlyfans';
import type { OfMedia, OfVaultList } from '@/types/crm';

const props = defineProps<{
    modelId: number;
    canManage: boolean;
    reload: number;
}>();

const FILTERS = [
    { label: 'All', value: '' },
    { label: 'Photo', value: 'photo' },
    { label: 'Video', value: 'video' },
    { label: 'GIF', value: 'gif' },
    { label: 'Audio', value: 'audio' },
] as const;

const PAGE = 48; // API caps `limit` at 100
const POLL_MS = 1500;
const POLL_MAX = 60; // ~90s, then give up rather than poll forever
const MAX_BYTES = 100 * 1024 * 1024; // 100MB — OnlyFans' direct-upload cap

const items = ref<OfMedia[]>([]);
const filter = ref('');
const loading = ref(false);
const hasMore = ref(false);
const error = ref<string | null>(null);
const actionError = ref<string | null>(null);
let token = 0;

// --- Selection --------------------------------------------------------------
const selectionMode = ref(false);
const selected = ref<Set<string>>(new Set());

// --- Lightbox ---------------------------------------------------------------
const lightboxIndex = ref<number | null>(null);
const enriched = new Set<string>();

// --- Upload -----------------------------------------------------------------
interface VaultUpload {
    key: number;
    name: string;
    progress: number;
    status: 'uploading' | 'processing' | 'ready' | 'failed';
    error: string | null;
}
let uid = 0;
const uploads = ref<VaultUpload[]>([]);
const showUpload = ref(false);
const urlInput = ref('');
const uploadingUrl = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

// --- Add-to-list picker -----------------------------------------------------
const showListPicker = ref(false);
const lists = ref<OfVaultList[]>([]);
const listsLoading = ref(false);
const listsError = ref<string | null>(null);
const newListName = ref('');
const busyList = ref(false);

const deleting = ref(false);

async function load(reset: boolean) {
    loading.value = true;
    error.value = null;
    const mine = ++token;
    const offset = reset ? 0 : items.value.length;

    try {
        const params: Record<string, string> = {
            limit: String(PAGE),
            offset: String(offset),
        };

        if (filter.value) {
            params.type = filter.value;
        }

        const r = await ofApi.vault(props.modelId, params);

        if (mine !== token) {
            return;
        }

        items.value = reset ? r.items : [...items.value, ...r.items];
        hasMore.value = r.hasMore; // the only honest end-of-list signal
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

function pickFilter(f: string) {
    filter.value = f;
    clearSelection();
    load(true);
}

/** Vault thumbs are fansapi.com presigned urls (direct); only onlyfans.com needs the proxy. */
function tileSrc(m: OfMedia): string {
    const cdn = (m.thumb ?? m.preview) as string;

    return m.direct ? cdn : ofApi.mediaUrl(props.modelId, cdn);
}

onMounted(() => load(true));
watch(
    () => props.modelId,
    () => {
        filter.value = '';
        clearSelection();
        uploads.value = [];
        load(true);
    },
);
watch(
    () => props.reload,
    () => load(true),
);

// --- Selection --------------------------------------------------------------
function toggleSelectionMode() {
    selectionMode.value = !selectionMode.value;

    if (!selectionMode.value) {
        clearSelection();
    }
}

function clearSelection() {
    selected.value = new Set();
}

async function onTile(m: OfMedia, i: number) {
    if (selectionMode.value) {
        toggleSelect(m);

        return;
    }

    await enrichVideo(m, i);
    lightboxIndex.value = i;
}

/**
 * The vault LIST payload omits the playable video source; the single-media detail endpoint
 * returns it. Fetch + merge before opening so a non-DRM video plays instead of showing the DRM
 * fallback. A genuinely DRM-protected video still resolves to no source (message then correct).
 * Cached per id so re-opening doesn't refetch.
 */
async function enrichVideo(m: OfMedia, i: number) {
    if (m.type !== 'video' || m.source || !m.id || enriched.has(m.id)) {
        return;
    }

    enriched.add(m.id);

    try {
        const r = await ofApi.vaultMediaItem(props.modelId, m.id);

        if (r.item && items.value[i]?.id === m.id) {
            items.value[i] = { ...items.value[i], ...r.item };
        }
    } catch {
        // Leave the list item as-is; the lightbox shows the no-source fallback.
    }
}

function toggleSelect(m: OfMedia) {
    if (!m.id) {
        return;
    }

    const s = new Set(selected.value);

    if (s.has(m.id)) {
        s.delete(m.id);
    } else {
        s.add(m.id);
    }

    selected.value = s;
}

// --- Upload -----------------------------------------------------------------
function onFilesPicked(e: Event) {
    const input = e.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = ''; // reset so the same file can be re-picked

    for (const file of files) {
        uploadFile(file);
    }
}

async function uploadFile(file: File) {
    if (file.size > MAX_BYTES) {
        uploads.value.unshift({
            key: ++uid,
            name: file.name,
            progress: 0,
            status: 'failed',
            error: 'File is larger than 100MB.',
        });

        return;
    }

    const up: VaultUpload = {
        key: ++uid,
        name: file.name,
        progress: 0,
        status: 'uploading',
        error: null,
    };
    uploads.value.unshift(up);

    try {
        const r = await ofApi.uploadToVault(props.modelId, file, (pct) => {
            up.progress = pct;
        });
        up.status = 'processing';
        await pollUpload(r.id, up);
    } catch (e) {
        up.status = 'failed';
        up.error = e instanceof Error ? e.message : 'Upload failed.';
    }
}

async function submitUrl() {
    const url = urlInput.value.trim();

    if (!url) {
        return;
    }

    uploadingUrl.value = true;
    const up: VaultUpload = {
        key: ++uid,
        name: url,
        progress: 100,
        status: 'processing',
        error: null,
    };
    uploads.value.unshift(up);

    try {
        const r = await ofApi.uploadToVaultByUrl(props.modelId, url);
        urlInput.value = '';
        await pollUpload(r.id, up);
    } catch (e) {
        up.status = 'failed';
        up.error = e instanceof Error ? e.message : 'Upload failed.';
    } finally {
        uploadingUrl.value = false;
    }
}

async function pollUpload(id: string, up: VaultUpload) {
    for (let i = 0; i < POLL_MAX; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));

        try {
            const s = await ofApi.uploadStatus(props.modelId, id);

            if (s.status === 'completed') {
                up.status = 'ready';
                load(true); // the finished media now appears in the vault

                return;
            }

            if (s.status === 'failed') {
                up.status = 'failed';
                up.error = s.error ?? 'OnlyFans could not process this file.';

                return;
            }
        } catch (e) {
            up.status = 'failed';
            up.error =
                e instanceof Error ? e.message : 'Upload status check failed.';

            return;
        }
    }

    up.status = 'failed';
    up.error = 'Timed out waiting for OnlyFans to process this file.';
}

const uploadsBusy = computed(() =>
    uploads.value.some(
        (u) => u.status === 'uploading' || u.status === 'processing',
    ),
);

// --- Add to list ------------------------------------------------------------
async function openListPicker() {
    showListPicker.value = true;
    listsError.value = null;
    listsLoading.value = true;

    try {
        const r = await ofApi.vaultLists(props.modelId, { limit: '100' });
        lists.value = r.lists;
    } catch (e) {
        listsError.value =
            e instanceof Error ? e.message : 'Failed to load lists.';
    } finally {
        listsLoading.value = false;
    }
}

async function addToList(listId: string | null) {
    if (!listId || !selected.value.size) {
        return;
    }

    busyList.value = true;
    listsError.value = null;

    try {
        await ofApi.addToVaultList(props.modelId, listId, [...selected.value]);
        showListPicker.value = false;
        selectionMode.value = false;
        clearSelection();
    } catch (e) {
        listsError.value =
            e instanceof Error ? e.message : 'Failed to add to list.';
    } finally {
        busyList.value = false;
    }
}

async function createAndAdd() {
    const name = newListName.value.trim();

    if (!name) {
        return;
    }

    busyList.value = true;
    listsError.value = null;

    try {
        const r = await ofApi.createVaultList(props.modelId, name);
        newListName.value = '';
        await addToList(r.list.id);
    } catch (e) {
        listsError.value =
            e instanceof Error ? e.message : 'Failed to create list.';
        busyList.value = false;
    }
}

// --- Delete -----------------------------------------------------------------
async function deleteSelected() {
    if (!selected.value.size) {
        return;
    }

    if (
        !confirm(
            `Permanently delete ${selected.value.size} media from the vault? This cannot be undone.`,
        )
    ) {
        return;
    }

    deleting.value = true;
    actionError.value = null;

    try {
        await ofApi.deleteVaultMedia(props.modelId, [...selected.value]);
        selectionMode.value = false;
        clearSelection();
        load(true);
    } catch (e) {
        actionError.value = e instanceof Error ? e.message : 'Delete failed.';
    } finally {
        deleting.value = false;
    }
}
</script>

<template>
    <div class="p-4">
        <!-- Toolbar -->
        <div class="mb-3 flex flex-wrap items-center gap-2">
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

            <button
                type="button"
                class="flex items-center gap-1.5 rounded-lg border border-ss-border px-3 py-1.5 text-[12px] font-semibold transition-colors"
                :class="
                    selectionMode
                        ? 'bg-ss-surface-2 text-ss-text'
                        : 'text-ss-text-2 hover:bg-ss-surface-2'
                "
                @click="toggleSelectionMode"
            >
                <Check :size="14" />
                {{ selectionMode ? 'Cancel' : 'Select' }}
            </button>

            <button
                type="button"
                class="flex items-center gap-1.5 rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90"
                @click="showUpload = !showUpload"
            >
                <Upload :size="14" />
                Upload
            </button>
        </div>

        <!-- Upload panel -->
        <div
            v-if="showUpload"
            class="mb-3 rounded-xl border border-ss-border bg-ss-surface-2 p-3"
        >
            <div class="flex flex-wrap items-center gap-2">
                <input
                    ref="fileInput"
                    type="file"
                    multiple
                    accept="image/*,video/*,audio/*"
                    class="hidden"
                    @change="onFilesPicked"
                />
                <button
                    type="button"
                    class="flex items-center gap-1.5 rounded-lg border border-ss-border bg-ss-surface px-3 py-1.5 text-[12px] font-semibold text-ss-text-2 hover:bg-ss-surface-2"
                    @click="fileInput?.click()"
                >
                    <Upload :size="14" />
                    Choose files
                </button>
                <span class="text-[11px] text-ss-text-3">or</span>
                <div class="flex min-w-[220px] flex-1 items-center gap-2">
                    <div
                        class="flex flex-1 items-center gap-1.5 rounded-lg border border-ss-border bg-ss-surface px-2"
                    >
                        <Link2 :size="14" class="shrink-0 text-ss-text-3" />
                        <input
                            v-model="urlInput"
                            type="url"
                            placeholder="Paste a media URL (https://…)"
                            class="w-full bg-transparent py-1.5 text-[12px] text-ss-text outline-none placeholder:text-ss-text-3"
                            @keyup.enter="submitUrl"
                        />
                    </div>
                    <button
                        type="button"
                        class="flex items-center gap-1 rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                        :disabled="!urlInput.trim() || uploadingUrl"
                        @click="submitUrl"
                    >
                        <LoaderCircle
                            v-if="uploadingUrl"
                            :size="14"
                            class="animate-spin"
                        />
                        Add
                    </button>
                </div>
            </div>
            <p class="mt-1.5 text-[11px] text-ss-text-3">
                Files up to 100MB; URLs up to 1GB. Uploads process in the
                background and appear here when ready.
            </p>

            <!-- Upload progress list -->
            <ul v-if="uploads.length" class="mt-2 space-y-1">
                <li
                    v-for="u in uploads"
                    :key="u.key"
                    class="flex items-center gap-2 rounded-lg bg-ss-surface px-2.5 py-1.5 text-[12px]"
                >
                    <LoaderCircle
                        v-if="
                            u.status === 'uploading' ||
                            u.status === 'processing'
                        "
                        :size="14"
                        class="shrink-0 animate-spin text-ss-accent-text"
                    />
                    <CheckCircle2
                        v-else-if="u.status === 'ready'"
                        :size="14"
                        class="shrink-0 text-ss-pos"
                    />
                    <AlertCircle
                        v-else
                        :size="14"
                        class="shrink-0 text-ss-neg"
                    />
                    <span class="min-w-0 flex-1 truncate text-ss-text-2">{{
                        u.name
                    }}</span>
                    <span
                        v-if="u.status === 'uploading'"
                        class="font-ss-mono text-[11px] text-ss-text-3"
                        >{{ u.progress }}%</span
                    >
                    <span
                        v-else-if="u.status === 'processing'"
                        class="text-[11px] text-ss-text-3"
                        >Processing…</span
                    >
                    <span
                        v-else-if="u.status === 'ready'"
                        class="text-[11px] text-ss-pos"
                        >Ready</span
                    >
                    <span v-else class="truncate text-[11px] text-ss-neg">{{
                        u.error
                    }}</span>
                </li>
            </ul>
            <div v-if="uploads.length && !uploadsBusy" class="mt-2 text-right">
                <button
                    type="button"
                    class="text-[11px] font-semibold text-ss-text-3 hover:text-ss-text-2"
                    @click="uploads = []"
                >
                    Clear
                </button>
            </div>
        </div>

        <!-- Selection action bar -->
        <div
            v-if="selectionMode"
            class="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-ss-accent/40 bg-ss-accent-soft px-3 py-2"
        >
            <span class="text-[12px] font-semibold text-ss-accent-text">
                {{ selected.size }} selected
            </span>
            <span class="flex-1" />
            <button
                type="button"
                class="flex items-center gap-1.5 rounded-lg border border-ss-border bg-ss-surface px-3 py-1.5 text-[12px] font-semibold text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-50"
                :disabled="!selected.size"
                @click="openListPicker"
            >
                <ListPlus :size="14" />
                Add to list
            </button>
            <button
                v-if="canManage"
                type="button"
                class="flex items-center gap-1.5 rounded-lg border border-ss-neg/40 bg-ss-neg/10 px-3 py-1.5 text-[12px] font-semibold text-ss-neg hover:bg-ss-neg/20 disabled:opacity-50"
                :disabled="!selected.size || deleting"
                @click="deleteSelected"
            >
                <LoaderCircle v-if="deleting" :size="14" class="animate-spin" />
                <Trash2 v-else :size="14" />
                Delete
            </button>
        </div>

        <p v-if="actionError" class="mb-2 text-[12px] text-ss-neg">
            {{ actionError }}
        </p>

        <!-- Grid -->
        <p v-if="error" class="py-6 text-center text-[12px] text-ss-neg">
            {{ error }}
        </p>
        <p
            v-else-if="!loading && items.length === 0"
            class="py-12 text-center text-[12px] text-ss-text-3"
        >
            Nothing in the vault for this filter.
        </p>
        <div
            v-else
            class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8"
        >
            <button
                v-for="(m, i) in items"
                :key="`${m.id}-${i}`"
                type="button"
                class="group relative aspect-square overflow-hidden rounded-lg border bg-ss-surface-2"
                :class="
                    m.id && selected.has(m.id)
                        ? 'border-ss-accent ring-2 ring-ss-accent'
                        : 'border-ss-border hover:border-ss-accent'
                "
                :title="m.type"
                @click="onTile(m, i)"
            >
                <img
                    v-if="m.thumb || m.preview"
                    :src="tileSrc(m)"
                    :alt="m.type"
                    class="h-full w-full object-cover"
                    loading="lazy"
                />
                <span
                    v-else
                    class="grid h-full w-full place-items-center text-[10px] font-semibold text-ss-text-3 uppercase"
                    >{{ m.type }}</span
                >

                <!-- Selection check -->
                <span
                    v-if="selectionMode"
                    class="absolute top-1 left-1 grid h-5 w-5 place-items-center rounded-full border"
                    :class="
                        m.id && selected.has(m.id)
                            ? 'border-ss-accent bg-ss-accent text-white'
                            : 'border-white/70 bg-black/40 text-transparent'
                    "
                >
                    <Check :size="12" />
                </span>

                <span
                    v-if="m.duration"
                    class="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[9px] text-white"
                    >{{ m.duration }}s</span
                >
            </button>
        </div>

        <div class="mt-3 grid place-items-center">
            <LoaderCircle
                v-if="loading"
                :size="18"
                class="animate-spin text-ss-text-3"
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

        <!-- Lightbox -->
        <SsMediaLightbox
            v-if="lightboxIndex !== null"
            :items="items"
            :index="lightboxIndex"
            :model-id="props.modelId"
            @update:index="lightboxIndex = $event"
            @close="lightboxIndex = null"
        />

        <!-- Add-to-list picker -->
        <div
            v-if="showListPicker"
            class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
            @click.self="showListPicker = false"
        >
            <div
                class="flex max-h-[70vh] w-full max-w-sm flex-col overflow-hidden rounded-2xl border border-ss-border bg-ss-surface shadow-2xl"
            >
                <div
                    class="flex items-center gap-2 border-b border-ss-border p-3"
                >
                    <p class="text-[14px] font-semibold text-ss-text">
                        Add {{ selected.size }} to a list
                    </p>
                    <span class="flex-1" />
                    <button
                        type="button"
                        class="grid h-7 w-7 place-items-center rounded text-ss-text-3 hover:bg-ss-surface-2"
                        @click="showListPicker = false"
                    >
                        <X :size="15" />
                    </button>
                </div>

                <div class="min-h-0 flex-1 overflow-y-auto p-3">
                    <p v-if="listsError" class="mb-2 text-[12px] text-ss-neg">
                        {{ listsError }}
                    </p>
                    <div
                        v-if="listsLoading"
                        class="grid place-items-center py-6"
                    >
                        <LoaderCircle
                            :size="18"
                            class="animate-spin text-ss-text-3"
                        />
                    </div>
                    <template v-else>
                        <button
                            v-for="l in lists"
                            :key="l.id ?? l.name"
                            type="button"
                            class="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-50"
                            :disabled="busyList"
                            @click="addToList(l.id)"
                        >
                            <FolderPlus
                                :size="15"
                                class="shrink-0 text-ss-text-3"
                            />
                            <span class="flex-1 truncate">{{ l.name }}</span>
                            <span class="text-[11px] text-ss-text-3"
                                >{{
                                    l.photosCount +
                                    l.videosCount +
                                    l.gifsCount +
                                    l.audiosCount
                                }}
                            </span>
                        </button>
                        <p
                            v-if="!lists.length"
                            class="py-3 text-center text-[12px] text-ss-text-3"
                        >
                            No lists yet — create one below.
                        </p>
                    </template>
                </div>

                <div
                    class="flex items-center gap-2 border-t border-ss-border p-3"
                >
                    <input
                        v-model="newListName"
                        type="text"
                        placeholder="New list name"
                        class="w-full rounded-lg border border-ss-border bg-ss-surface-2 px-2.5 py-1.5 text-[12px] text-ss-text outline-none placeholder:text-ss-text-3"
                        @keyup.enter="createAndAdd"
                    />
                    <button
                        type="button"
                        class="flex shrink-0 items-center gap-1 rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                        :disabled="!newListName.trim() || busyList"
                        @click="createAndAdd"
                    >
                        <LoaderCircle
                            v-if="busyList"
                            :size="14"
                            class="animate-spin"
                        />
                        <FolderPlus v-else :size="14" />
                        Create & add
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
