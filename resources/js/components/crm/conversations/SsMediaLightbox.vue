<script setup lang="ts">
import { ChevronLeft, ChevronRight, Lock, X } from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted } from 'vue';
import { ofApi } from '@/lib/onlyfans';
import type { OfMedia } from '@/types/crm';

const props = defineProps<{ items: OfMedia[]; index: number; modelId: number }>();
const emit = defineEmits<{ 'update:index': [n: number]; close: [] }>();

const current = computed(() => props.items[props.index] ?? null);
const hasMany = computed(() => props.items.length > 1);

// IP-locked CDN urls must load through our proxy. Full-resolution first; DRM video has no
// plain url, so fall back to the poster.
const proxy = (cdn: string) => ofApi.mediaUrl(props.modelId, cdn);
const rawSrc = computed(() => current.value?.full || current.value?.preview || current.value?.thumb || null);
const src = computed(() => (rawSrc.value ? proxy(rawSrc.value) : null));
const isVideo = computed(() => current.value?.type === 'video');
const isPlayable = computed(() => isVideo.value && !!current.value?.full);
const videoSrc = computed(() => (current.value?.full ? proxy(current.value.full) : null));

function go(delta: number) {
    const next = props.index + delta;

    if (next >= 0 && next < props.items.length) {
        emit('update:index', next);
    }
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        emit('close');
    } else if (e.key === 'ArrowLeft') {
        go(-1);
    } else if (e.key === 'ArrowRight') {
        go(1);
    }
}

onMounted(() => {
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
});

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
});
</script>

<template>
    <Teleport to="body">
        <div class="fixed inset-0 z-50 grid place-items-center bg-black/90 p-4" @click.self="emit('close')">
            <!-- close -->
            <button
                type="button"
                class="absolute top-4 right-4 grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
                title="Close (Esc)"
                @click="emit('close')"
            >
                <X :size="18" />
            </button>

            <!-- counter -->
            <span v-if="hasMany" class="absolute top-5 left-1/2 -translate-x-1/2 text-[12px] font-medium text-white/70">{{ index + 1 }} / {{ items.length }}</span>

            <!-- prev / next -->
            <button
                v-if="hasMany"
                type="button"
                :disabled="index === 0"
                class="absolute left-3 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30"
                @click="go(-1)"
            >
                <ChevronLeft :size="22" />
            </button>
            <button
                v-if="hasMany"
                type="button"
                :disabled="index === items.length - 1"
                class="absolute right-3 grid h-10 w-10 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:opacity-30"
                @click="go(1)"
            >
                <ChevronRight :size="22" />
            </button>

            <!-- media -->
            <div class="flex max-h-[90vh] max-w-[92vw] flex-col items-center gap-2">
                <video v-if="isPlayable && videoSrc" :src="videoSrc" controls autoplay class="max-h-[90vh] max-w-[92vw] rounded-lg" />
                <template v-else-if="src">
                    <img :src="src" class="max-h-[85vh] max-w-[92vw] rounded-lg object-contain" />
                    <p v-if="isVideo" class="text-[12px] text-white/60">Video preview · full playback isn't available (protected)</p>
                </template>
                <div v-else class="grid h-40 w-64 place-items-center rounded-lg bg-white/10 text-white/70">
                    <div class="text-center">
                        <Lock :size="22" class="mx-auto mb-1" />
                        <span class="text-[12px]">Locked media</span>
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>
