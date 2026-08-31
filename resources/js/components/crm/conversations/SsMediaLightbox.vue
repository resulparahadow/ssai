<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import {
    ChevronLeft,
    ChevronRight,
    FolderOpen,
    LoaderCircle,
    Lock,
    X,
} from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { mediaSrc, ofApi } from '@/lib/onlyfans';
import type { OfMedia } from '@/types/crm';

const props = defineProps<{
    items: OfMedia[];
    index: number;
    modelId: number;
}>();
const emit = defineEmits<{ 'update:index': [n: number]; close: [] }>();

const current = computed(() => props.items[props.index] ?? null);
const hasMany = computed(() => props.items.length > 1);

// Full-resolution first; a DRM video has no plain url, so fall back to the poster.
// mediaSrc proxies only the IP-locked OnlyFans CDN urls.
const proxy = (cdn: string) => mediaSrc(props.modelId, cdn);
const rawSrc = computed(
    () =>
        current.value?.full ||
        current.value?.preview ||
        current.value?.thumb ||
        null,
);
const src = computed(() => (rawSrc.value ? proxy(rawSrc.value) : null));
// --- progressive image loading ----------------------------------------------
// The grid thumbnail is already in the browser cache, so show it upscaled and blurred the
// instant the lightbox opens, then swap to the full-size file once it has downloaded. Without
// this the stage is blank for as long as the (often multi-MB) full image takes to arrive.
const fullLoaded = ref(false);
const displaySrc = ref<string | null>(null);

const placeholderSrc = computed(() => {
    const cdn = current.value?.thumb || current.value?.preview;

    return cdn ? proxy(cdn) : null;
});

// Reserve the exact box the full image will occupy, so sharpening doesn't resize the stage.
const ratio = computed(() => {
    const m = current.value;

    return m?.width && m?.height ? m.width / m.height : null;
});
const stageStyle = computed(() =>
    !fullLoaded.value && ratio.value
        ? {
              aspectRatio: String(ratio.value),
              height: `min(85vh, calc(92vw / ${ratio.value}))`,
              width: 'auto',
          }
        : {},
);

watch(
    [() => props.index, src],
    () => {
        fullLoaded.value = false;
        displaySrc.value = placeholderSrc.value ?? src.value;

        const target = src.value;

        if (!target || typeof Image === 'undefined') {
            return;
        }

        // Nothing better to upgrade to.
        if (target === displaySrc.value) {
            fullLoaded.value = true;

            return;
        }

        const img = new Image();
        const settle = () => {
            if (src.value === target) {
                displaySrc.value = target;
                fullLoaded.value = true;
            }
        };
        // On error too: let the <img> render its own broken state rather than blurring forever.
        img.onload = settle;
        img.onerror = settle;
        img.src = target;
    },
    { immediate: true },
);

const isVideo = computed(() => current.value?.type === 'video');
const isPlayable = computed(() => isVideo.value && !!current.value?.source);
const videoSrc = computed(() =>
    current.value?.source ? proxy(current.value.source) : null,
);

// --- DRM playback -----------------------------------------------------------
// A DRM-protected video has no plain `source` — the only playable copy comes from the DRM
// download endpoint, which decrypts it upstream. Opening the video starts that fetch straight
// away and shows a spinner; the server caches the result, so re-opening it is instant.
const drmSrc = ref<string | null>(null);
const drmLoading = ref(false);
const drmError = ref<string | null>(null);
// The DRM endpoint resolves Media Vault ids only, so a chat-message media id 404s. Retrying
// can never help — offer the vault (same creator, via the app-wide creator context) instead.
const drmVaultOnly = ref(false);
let drmAbort: AbortController | null = null;

const canLoadDrm = computed(
    () =>
        isVideo.value &&
        !current.value?.source &&
        !!current.value?.drm &&
        !!current.value?.id,
);

async function loadDrm() {
    const media = current.value;

    if (!media?.id || drmLoading.value) {
        return;
    }

    const ctrl = new AbortController();
    drmAbort = ctrl;
    drmLoading.value = true;
    drmError.value = null;
    drmVaultOnly.value = false;

    const url = ofApi.drmMediaUrl(props.modelId, media.id);

    try {
        // Ask for one byte first. A bare <video> reports every failure as an opaque `error`
        // event, so this is the only way to show the real reason (out of credits, not actually
        // DRM-protected). It also warms the server-side cache, so the <video> then loads at once.
        const res = await fetch(url, {
            headers: { Range: 'bytes=0-0' },
            signal: ctrl.signal,
        });

        if (!res.ok) {
            const body = await res.json().catch(() => null);
            // OnlyFans resolves this endpoint for Media Vault ids only — a chat-message
            // media id comes back 404 "Media Not Found" (verified live 2026-08-24).
            drmVaultOnly.value = res.status === 404;
            drmError.value = drmVaultOnly.value
                ? 'This video can only be played from the Media Vault.'
                : body?.message ||
                  body?.error ||
                  `Could not load the video (${res.status}).`;

            return;
        }

        drmSrc.value = url;
    } catch {
        if (!ctrl.signal.aborted) {
            drmError.value = 'Could not reach the server.';
        }
    } finally {
        if (drmAbort === ctrl) {
            drmLoading.value = false;
            drmAbort = null;
        }
    }
}

// Opening a DRM video (or moving to one) starts its download immediately and drops any
// in-flight download for the item we just left.
watch(
    () => props.index,
    () => {
        drmAbort?.abort();
        drmAbort = null;
        drmSrc.value = null;
        drmError.value = null;
        drmVaultOnly.value = false;
        drmLoading.value = false;

        if (canLoadDrm.value) {
            loadDrm();
        }
    },
    { immediate: true },
);

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
    drmAbort?.abort();
});
</script>

<template>
    <Teleport to="body">
        <div
            class="fixed inset-0 z-50 grid place-items-center bg-black/90 p-4"
            @click.self="emit('close')"
        >
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
            <span
                v-if="hasMany"
                class="absolute top-5 left-1/2 -translate-x-1/2 text-[12px] font-medium text-white/70"
                >{{ index + 1 }} / {{ items.length }}</span
            >

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
            <div
                class="flex max-h-[90vh] max-w-[92vw] flex-col items-center gap-2"
            >
                <video
                    v-if="isPlayable && videoSrc"
                    :src="videoSrc"
                    controls
                    autoplay
                    class="max-h-[90vh] max-w-[92vw] rounded-lg"
                />
                <!-- decrypted DRM copy, once the download finishes -->
                <video
                    v-else-if="drmSrc"
                    :src="drmSrc"
                    controls
                    autoplay
                    class="max-h-[90vh] max-w-[92vw] rounded-lg"
                />
                <template v-else-if="displaySrc">
                    <!-- A DRM video's poster sweeps while the decrypt downloads; a photo stays
                         blurred until its full-size file lands. Both keep the image visible. -->
                    <div
                        class="relative max-h-[85vh] max-w-[92vw] rounded-lg"
                        :class="drmLoading && 'ss-shimmer'"
                        :style="stageStyle"
                    >
                        <img
                            :src="displaySrc"
                            class="max-h-[85vh] max-w-[92vw] rounded-lg object-contain transition-[filter] duration-300"
                            :class="
                                fullLoaded
                                    ? ''
                                    : 'h-full w-full scale-[1.02] blur-xl'
                            "
                        />
                        <span
                            v-if="!fullLoaded"
                            class="absolute inset-0 grid place-items-center"
                        >
                            <LoaderCircle
                                :size="26"
                                class="animate-spin text-white/80"
                            />
                        </span>
                    </div>
                    <div
                        v-if="canLoadDrm"
                        class="flex flex-col items-center gap-1.5"
                    >
                        <p
                            v-if="drmLoading"
                            class="inline-flex items-center gap-2 rounded-full bg-white/10 px-3.5 py-1.5 text-[12px] text-white/80"
                        >
                            <LoaderCircle :size="13" class="animate-spin" />
                            Loading video…
                        </p>
                        <template v-else-if="drmError">
                            <p
                                class="max-w-xs text-center text-[12px] text-white/70"
                            >
                                {{ drmError }}
                            </p>
                            <Link
                                v-if="drmVaultOnly"
                                href="/media-vault"
                                class="inline-flex items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-white/25"
                            >
                                <FolderOpen :size="13" />
                                Open Media Vault
                            </Link>
                            <button
                                v-else
                                type="button"
                                class="rounded-full bg-white/15 px-3.5 py-1.5 text-[12px] font-medium text-white hover:bg-white/25"
                                @click="loadDrm"
                            >
                                Try again
                            </button>
                        </template>
                    </div>
                    <p
                        v-else-if="isVideo"
                        class="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-[12px] text-white/70"
                    >
                        <Lock :size="12" />
                        Locked video — can't be played here
                    </p>
                </template>
                <div
                    v-else
                    class="grid h-40 w-64 place-items-center rounded-lg bg-white/10 text-white/70"
                >
                    <div class="text-center">
                        <Lock :size="22" class="mx-auto mb-1" />
                        <span class="text-[12px]">Locked media</span>
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>
