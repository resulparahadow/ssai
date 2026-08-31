<script setup lang="ts">
import { LoaderCircle, Search, X } from '@lucide/vue';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ofApi } from '@/lib/onlyfans';
import type { OfGif } from '@/types/crm';

const props = defineProps<{ modelId: number }>();
const emit = defineEmits<{ select: [gif: OfGif]; close: [] }>();

const query = ref('');
const gifs = ref<OfGif[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const root = ref<HTMLElement | null>(null);

let searchToken = 0;
let debounce: ReturnType<typeof setTimeout> | undefined;

async function loadTrending() {
    loading.value = true;
    error.value = null;
    const token = ++searchToken;

    try {
        const r = await ofApi.giphyTrending(props.modelId);

        if (token === searchToken) {
            gifs.value = r.gifs;
        }
    } catch (e) {
        if (token === searchToken) {
            error.value =
                e instanceof Error ? e.message : 'Failed to load GIFs.';
        }
    } finally {
        if (token === searchToken) {
            loading.value = false;
        }
    }
}

async function runSearch(q: string) {
    loading.value = true;
    error.value = null;
    const token = ++searchToken;

    try {
        const r = await ofApi.giphySearch(props.modelId, q, { limit: 24 });

        if (token === searchToken) {
            gifs.value = r.gifs;
        }
    } catch (e) {
        if (token === searchToken) {
            error.value = e instanceof Error ? e.message : 'Search failed.';
        }
    } finally {
        if (token === searchToken) {
            loading.value = false;
        }
    }
}

watch(query, (q) => {
    clearTimeout(debounce);
    const trimmed = q.trim();
    loading.value = true; // immediate feedback while the keystroke debounces

    debounce = setTimeout(() => {
        if (trimmed) {
            runSearch(trimmed);
        } else {
            loadTrending();
        }
    }, 300);
});

function onDocClick(e: MouseEvent) {
    if (root.value && !root.value.contains(e.target as Node)) {
        emit('close');
    }
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        emit('close');
    }
}

onMounted(() => {
    loadTrending();
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
    clearTimeout(debounce);
    document.removeEventListener('mousedown', onDocClick);
    window.removeEventListener('keydown', onKey);
});
</script>

<template>
    <div
        ref="root"
        class="absolute right-0 bottom-full z-30 mb-2 w-80 overflow-hidden rounded-xl border border-ss-border bg-ss-surface shadow-xl"
    >
        <div class="flex items-center gap-2 border-b border-ss-border p-2">
            <div class="relative flex-1">
                <Search
                    :size="14"
                    class="absolute top-1/2 left-2.5 -translate-y-1/2 text-ss-text-3"
                />
                <input
                    v-model="query"
                    type="text"
                    placeholder="Search GIFs…"
                    autofocus
                    class="h-8 w-full rounded-lg border border-ss-border bg-ss-bg pr-8 pl-8 text-[13px] text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
                />
                <LoaderCircle
                    v-if="loading"
                    :size="14"
                    class="absolute top-1/2 right-2.5 -translate-y-1/2 animate-spin text-ss-accent-text"
                />
            </div>
            <button
                type="button"
                class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text"
                title="Close"
                @click="emit('close')"
            >
                <X :size="15" />
            </button>
        </div>

        <div class="h-64 overflow-y-auto p-2">
            <p v-if="error" class="py-8 text-center text-[12px] text-ss-neg">
                {{ error }}
            </p>
            <div
                v-else-if="loading && !gifs.length"
                class="grid h-full place-items-center"
            >
                <LoaderCircle :size="20" class="animate-spin text-ss-text-3" />
            </div>
            <p
                v-else-if="!gifs.length"
                class="py-8 text-center text-[12px] text-ss-text-3"
            >
                No GIFs found.
            </p>
            <div
                v-else
                class="columns-2 gap-2 transition-opacity *:mb-2"
                :class="loading ? 'pointer-events-none opacity-40' : ''"
            >
                <button
                    v-for="(g, i) in gifs"
                    :key="g.id ?? i"
                    type="button"
                    class="block w-full overflow-hidden rounded-lg bg-ss-surface-2 transition-opacity hover:opacity-80"
                    :title="g.title ?? 'GIF'"
                    @click="emit('select', g)"
                >
                    <img
                        v-if="g.preview"
                        :src="g.preview"
                        :alt="g.title ?? 'GIF'"
                        loading="lazy"
                        class="w-full"
                    />
                </button>
            </div>
        </div>

        <div
            class="border-t border-ss-border px-2 py-1 text-right text-[10px] text-ss-text-3"
        >
            Powered by GIPHY
        </div>
    </div>
</template>
