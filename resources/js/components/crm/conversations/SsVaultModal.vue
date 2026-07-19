<script setup lang="ts">
import { LoaderCircle, X } from '@lucide/vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { ofApi } from '@/lib/onlyfans';
import type { OfMedia } from '@/types/crm';

const props = defineProps<{ modelId: number }>();
const emit = defineEmits<{ select: [item: OfMedia]; close: [] }>();

const FILTERS = [
    { label: 'All', value: '' },
    { label: 'Photo', value: 'photo' },
    { label: 'Video', value: 'video' },
    { label: 'GIF', value: 'gif' },
    { label: 'Audio', value: 'audio' },
] as const;

const PAGE = 48; // API caps `limit` at 100

const items = ref<OfMedia[]>([]);
const filter = ref('');
const loading = ref(false);
const hasMore = ref(false);
const error = ref<string | null>(null);

let token = 0;

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
        // hasMore is the only honest end-of-list signal from this API.
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

function pick(f: string) {
    filter.value = f;
    load(true);
}

/** Vault thumbs are fansapi.com presigned urls (direct); only onlyfans.com needs the proxy. */
function tileSrc(m: OfMedia): string {
    const cdn = (m.thumb ?? m.preview) as string;

    return m.direct ? cdn : ofApi.mediaUrl(props.modelId, cdn);
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

onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
    <div
        class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
        @click.self="emit('close')"
    >
        <div
            class="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ss-border bg-ss-surface shadow-2xl"
        >
            <div class="flex items-center gap-2 border-b border-ss-border p-3">
                <p class="text-[14px] font-semibold text-ss-text">Vault</p>
                <div class="ml-2 flex flex-wrap gap-1">
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
                        @click="pick(f.value)"
                    >
                        {{ f.label }}
                    </button>
                </div>
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

            <div class="flex-1 overflow-y-auto p-3">
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
                    Nothing in the vault for this filter.
                </p>

                <div v-else class="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    <button
                        v-for="(m, i) in items"
                        :key="`${m.id}-${i}`"
                        type="button"
                        class="group relative aspect-square overflow-hidden rounded-lg border border-ss-border bg-ss-surface-2 hover:border-ss-accent"
                        :title="m.type"
                        @click="emit('select', m)"
                    >
                        <!-- Audio has no thumb (files.thumb is null), so show a label tile. -->
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
</template>
