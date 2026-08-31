<script setup lang="ts">
import {
    Check,
    FolderPlus,
    Image,
    LoaderCircle,
    Pencil,
    Search,
    Trash2,
    Video,
    X,
} from '@lucide/vue';
import { onMounted, ref, watch } from 'vue';
import { ofApi } from '@/lib/onlyfans';
import type { OfVaultList } from '@/types/crm';

const props = defineProps<{
    modelId: number;
    canManage: boolean;
    reload: number;
    /** Currently open list id, or null for "All media". */
    selectedId: string | null;
}>();

const emit = defineEmits<{ select: [list: OfVaultList | null] }>();

const PAGE = 30; // upstream caps the vault-lists limit at 30

const lists = ref<OfVaultList[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const hasMore = ref(false);
const query = ref('');

const showCreate = ref(false);
const newName = ref('');
const creating = ref(false);

const renamingId = ref<string | null>(null);
const renameValue = ref('');
const busy = ref<string | null>(null);

async function load(reset = true) {
    loading.value = true;
    error.value = null;

    try {
        const params: Record<string, string> = {
            limit: String(PAGE),
            offset: String(reset ? 0 : lists.value.length),
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
        emit('select', null);
        load();
    },
);
watch(
    () => props.reload,
    () => load(),
);

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
    if (
        !l.id ||
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

        // The right panel is showing a list that no longer exists.
        if (props.selectedId === l.id) {
            emit('select', null);
        }
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to delete list.';
    } finally {
        busy.value = null;
    }
}
</script>

<template>
    <div class="flex h-full min-h-0 flex-col border-r border-ss-border">
        <!-- Toolbar -->
        <div class="flex items-center gap-2 border-b border-ss-border p-3">
            <div
                class="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg border border-ss-border bg-ss-surface-2 px-2"
            >
                <Search :size="14" class="shrink-0 text-ss-text-3" />
                <input
                    v-model="query"
                    type="search"
                    placeholder="Search lists"
                    class="w-full bg-transparent py-1.5 text-[12px] text-ss-text outline-none placeholder:text-ss-text-3"
                    @keyup.enter="load()"
                    @search="load()"
                />
            </div>
            <button
                type="button"
                class="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-ss-border text-ss-text-2 hover:bg-ss-surface-2"
                title="New list"
                @click="showCreate = !showCreate"
            >
                <FolderPlus :size="15" />
            </button>
        </div>

        <!-- Create -->
        <div
            v-if="showCreate"
            class="flex gap-1.5 border-b border-ss-border p-2"
        >
            <input
                v-model="newName"
                type="text"
                placeholder="List name"
                class="min-w-0 flex-1 rounded-lg border border-ss-border bg-ss-surface-2 px-2 py-1.5 text-[12px] text-ss-text outline-none placeholder:text-ss-text-3"
                @keyup.enter="create"
            />
            <button
                type="button"
                class="rounded-lg bg-ss-accent px-2.5 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                :disabled="!newName.trim() || creating"
                @click="create"
            >
                <LoaderCircle v-if="creating" :size="14" class="animate-spin" />
                <span v-else>Add</span>
            </button>
        </div>

        <p v-if="error" class="px-3 py-2 text-[12px] text-ss-neg">
            {{ error }}
        </p>

        <!-- Lists -->
        <div class="min-h-0 flex-1 overflow-y-auto">
            <!-- All media -->
            <button
                type="button"
                class="flex w-full items-center gap-2 border-b border-ss-border px-3 py-2.5 text-left transition-colors"
                :class="
                    selectedId === null
                        ? 'bg-ss-accent text-white'
                        : 'text-ss-text hover:bg-ss-surface-2'
                "
                @click="emit('select', null)"
            >
                <span class="min-w-0 flex-1 truncate text-[13px] font-semibold"
                    >All media</span
                >
            </button>

            <div
                v-for="l in lists"
                :key="l.id ?? l.name"
                class="group flex items-center gap-2 border-b border-ss-border px-3 py-2.5 transition-colors"
                :class="
                    selectedId === l.id
                        ? 'bg-ss-accent text-white'
                        : 'hover:bg-ss-surface-2'
                "
            >
                <!-- Rename -->
                <template v-if="renamingId === l.id">
                    <input
                        v-model="renameValue"
                        type="text"
                        class="min-w-0 flex-1 rounded-lg border border-ss-border bg-ss-surface px-2 py-1 text-[12px] text-ss-text outline-none"
                        @keyup.enter="saveRename(l)"
                        @keyup.esc="renamingId = null"
                    />
                    <button
                        type="button"
                        class="grid h-6 w-6 place-items-center rounded text-ss-text-2 hover:bg-ss-surface"
                        @click="saveRename(l)"
                    >
                        <Check :size="13" />
                    </button>
                    <button
                        type="button"
                        class="grid h-6 w-6 place-items-center rounded text-ss-text-2 hover:bg-ss-surface"
                        @click="renamingId = null"
                    >
                        <X :size="13" />
                    </button>
                </template>

                <template v-else>
                    <button
                        type="button"
                        class="min-w-0 flex-1 text-left"
                        @click="emit('select', l)"
                    >
                        <span
                            class="block truncate text-[13px] font-medium"
                            :class="
                                selectedId === l.id
                                    ? 'text-white'
                                    : 'text-ss-text'
                            "
                            >{{ l.name }}</span
                        >
                        <span
                            class="mt-0.5 flex items-center gap-2.5 text-[11px]"
                            :class="
                                selectedId === l.id
                                    ? 'text-white/70'
                                    : 'text-ss-text-3'
                            "
                        >
                            <span
                                v-if="l.photosCount"
                                class="flex items-center gap-1"
                            >
                                <Image :size="11" />{{ l.photosCount }}
                            </span>
                            <span
                                v-if="l.videosCount"
                                class="flex items-center gap-1"
                            >
                                <Video :size="11" />{{ l.videosCount }}
                            </span>
                            <span v-if="l.gifsCount"
                                >{{ l.gifsCount }} GIF</span
                            >
                            <span v-if="l.audiosCount"
                                >{{ l.audiosCount }} audio</span
                            >
                        </span>
                    </button>

                    <LoaderCircle
                        v-if="busy === l.id"
                        :size="13"
                        class="shrink-0 animate-spin text-ss-text-3"
                    />
                    <template v-else-if="canManage && l.canUpdate">
                        <button
                            type="button"
                            class="grid h-6 w-6 shrink-0 place-items-center rounded text-ss-text-3 opacity-0 group-hover:opacity-100 hover:bg-ss-surface hover:text-ss-text"
                            title="Rename"
                            @click="startRename(l)"
                        >
                            <Pencil :size="12" />
                        </button>
                        <button
                            v-if="l.canDelete"
                            type="button"
                            class="grid h-6 w-6 shrink-0 place-items-center rounded text-ss-text-3 opacity-0 group-hover:opacity-100 hover:bg-ss-surface hover:text-ss-neg"
                            title="Delete list"
                            @click="remove(l)"
                        >
                            <Trash2 :size="12" />
                        </button>
                    </template>
                </template>
            </div>

            <div class="grid place-items-center p-3">
                <LoaderCircle
                    v-if="loading"
                    :size="16"
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
                <p v-else-if="!lists.length" class="text-[12px] text-ss-text-3">
                    No lists yet.
                </p>
            </div>
        </div>
    </div>
</template>
