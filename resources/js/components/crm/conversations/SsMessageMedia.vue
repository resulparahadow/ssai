<script setup lang="ts">
import { ImageOff, LoaderCircle, Lock, Play } from '@lucide/vue';
import { computed, ref } from 'vue';
import { ofApi } from '@/lib/onlyfans';
import type { OfMedia } from '@/types/crm';
import SsMediaLightbox from './SsMediaLightbox.vue';

const props = defineProps<{
    media: OfMedia[];
    price?: number;
    modelId: number;
}>();

// CDN urls are IP-locked, so the thumbnail must load through our proxy. `direct`
// media (e.g. an optimistic Giphy preview) is already browser-loadable as-is.
function poster(m: OfMedia): string | null {
    const cdn = m.preview || m.thumb || null;

    if (!cdn) {
        return null;
    }

    return m.direct ? cdn : ofApi.mediaUrl(props.modelId, cdn);
}

function usable(m: OfMedia): boolean {
    return m.canView && !!poster(m);
}

// Per-tile load state so each proxied image shows a skeleton while it downloads
// and a failure state if it errors (defaults to 'loading' until @load/@error).
type LoadState = 'loading' | 'loaded' | 'error';
const imgState = ref<Record<string, LoadState>>({});

function tileKey(m: OfMedia, i: number): string {
    return String(m.id ?? i);
}

function loadState(m: OfMedia, i: number): LoadState {
    return imgState.value[tileKey(m, i)] ?? 'loading';
}

function markLoaded(m: OfMedia, i: number): void {
    imgState.value[tileKey(m, i)] = 'loaded';
}

function markError(m: OfMedia, i: number): void {
    imgState.value[tileKey(m, i)] = 'error';
}

function fmtDuration(s: number | null): string {
    if (!s || s < 0) {
        return '';
    }

    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);

    return `${m}:${sec.toString().padStart(2, '0')}`;
}

// Show at most 4 tiles; the 4th carries a "+N" overlay when there are more.
const visible = computed(() => props.media.slice(0, 4));
const extra = computed(() => Math.max(0, props.media.length - 4));

const gridClass = computed(() =>
    props.media.length === 1 ? '' : 'grid grid-cols-2 gap-1',
);

const lightboxOpen = ref(false);
const lightboxIndex = ref(0);

function open(i: number) {
    if (!usable(props.media[i])) {
        return;
    }

    lightboxIndex.value = i;
    lightboxOpen.value = true;
}
</script>

<template>
    <div class="my-1">
        <div :class="gridClass">
            <button
                v-for="(m, i) in visible"
                :key="m.id ?? i"
                type="button"
                class="group relative block overflow-hidden rounded-lg bg-ss-surface-2"
                :class="[
                    media.length === 1
                        ? usable(m) && loadState(m, i) !== 'loaded'
                            ? 'aspect-3/4 w-[240px]'
                            : 'max-w-[260px]'
                        : 'aspect-square w-full',
                    usable(m) ? 'cursor-zoom-in' : 'cursor-default',
                ]"
                @click="open(i)"
            >
                <!-- viewable photo / video poster -->
                <template v-if="usable(m)">
                    <img
                        :src="poster(m)!"
                        :alt="m.type"
                        class="h-full w-full transition-[transform,opacity] duration-200 group-hover:scale-[1.02]"
                        :class="[
                            media.length === 1
                                ? 'max-h-[320px] w-full object-cover'
                                : 'object-cover',
                            loadState(m, i) === 'loaded'
                                ? 'opacity-100'
                                : 'opacity-0',
                        ]"
                        @load="markLoaded(m, i)"
                        @error="markError(m, i)"
                    />

                    <!-- loading skeleton -->
                    <span
                        v-if="loadState(m, i) === 'loading'"
                        class="absolute inset-0 grid animate-pulse place-items-center bg-ss-surface-2"
                    >
                        <LoaderCircle
                            :size="18"
                            class="animate-spin text-ss-text-3"
                        />
                    </span>

                    <!-- failed to load -->
                    <span
                        v-else-if="loadState(m, i) === 'error'"
                        class="absolute inset-0 grid place-items-center bg-ss-surface-2 p-3 text-center text-ss-text-3"
                    >
                        <span>
                            <ImageOff :size="20" class="mx-auto mb-1" />
                            <span class="block text-[10px] font-medium"
                                >Couldn't load
                                {{ m.type === 'video' ? 'video' : 'image' }}</span
                            >
                        </span>
                    </span>

                    <!-- affordances only once the poster is in -->
                    <template v-if="loadState(m, i) === 'loaded'">
                        <!-- video affordances -->
                        <span
                            v-if="m.type === 'video'"
                            class="absolute inset-0 grid place-items-center"
                        >
                            <span
                                class="grid h-10 w-10 place-items-center rounded-full bg-black/55 text-white backdrop-blur-sm"
                            >
                                <Play :size="18" fill="currentColor" />
                            </span>
                        </span>
                        <span
                            v-if="m.type === 'video' && m.duration"
                            class="absolute right-1.5 bottom-1.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white"
                        >
                            {{ fmtDuration(m.duration) }}
                        </span>
                        <!-- "+N more" on the last visible tile -->
                        <span
                            v-if="i === 3 && extra > 0"
                            class="absolute inset-0 grid place-items-center bg-black/55 text-lg font-semibold text-white"
                            >+{{ extra }}</span
                        >
                    </template>
                </template>

                <!-- locked / pay-to-view -->
                <span
                    v-else
                    class="grid h-full w-full place-items-center p-4"
                    :class="media.length === 1 ? 'aspect-4/3' : ''"
                >
                    <span class="text-center text-ss-text-3">
                        <Lock :size="20" class="mx-auto mb-1" />
                        <span class="block text-[11px] font-medium">{{
                            m.type === 'video' ? 'Locked video' : 'Locked photo'
                        }}</span>
                        <span
                            v-if="price"
                            class="mt-1 inline-block rounded-full bg-ss-accent px-2 py-0.5 text-[11px] font-semibold text-white"
                            >${{ price }}</span
                        >
                    </span>
                </span>
            </button>
        </div>

        <SsMediaLightbox
            v-if="lightboxOpen"
            :items="media"
            :model-id="modelId"
            v-model:index="lightboxIndex"
            @close="lightboxOpen = false"
        />
    </div>
</template>
