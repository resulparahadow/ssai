<script setup lang="ts">
import { AlertCircle, Heart, Image, LoaderCircle, RefreshCw, Search, Trash2, X } from '@lucide/vue';
import { computed, nextTick, ref, watch } from 'vue';
import SsMessageMedia from '@/components/crm/conversations/SsMessageMedia.vue';
import { ofApi } from '@/lib/onlyfans';
import type { OfChat, OfMessage } from '@/types/crm';

const props = defineProps<{
    modelId: number;
    chat: OfChat;
    messages: OfMessage[];
    loading: boolean;
    error: string | null;
}>();

const emit = defineEmits<{ like: [m: OfMessage]; delete: [m: OfMessage]; resend: [m: OfMessage] }>();

// ---- search (server, with client-filter fallback) ----
const query = ref('');
const searchResults = ref<OfMessage[] | null>(null);

async function runSearch() {
    const q = query.value.trim();

    if (!q) {
        searchResults.value = null;

        return;
    }

    try {
        const r = await ofApi.search(props.modelId, props.chat.id, q);
        searchResults.value = r.messages as OfMessage[];
    } catch {
        // fall back to filtering already-loaded messages
        searchResults.value = props.messages.filter((m) => m.text.toLowerCase().includes(q.toLowerCase()));
    }
}

function clearSearch() {
    query.value = '';
    searchResults.value = null;
}

const shown = computed(() => searchResults.value ?? props.messages);

// Open/refresh at the newest message (bottom), like any chat app.
const threadEl = ref<HTMLElement | null>(null);
function scrollToBottom() {
    const el = threadEl.value;

    if (el) {
el.scrollTop = el.scrollHeight;
}
}
watch(() => props.messages, () => nextTick(scrollToBottom));

function fmtTime(t: string | null): string {
    if (!t) {
return '';
}

    const d = new Date(t);

    return isNaN(d.getTime()) ? '' : d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---- media gallery ----
const showMedia = ref(false);
const mediaItems = ref<Record<string, unknown>[]>([]);
const mediaLoading = ref(false);

// The component instance is reused across chat/creator switches, so close the gallery and
// drop its items when the chat changes — otherwise a new chat shows the previous one's media.
watch(
    () => [props.modelId, props.chat.id],
    () => {
        showMedia.value = false;
        mediaItems.value = [];
    },
);

async function openMedia() {
    showMedia.value = true;
    mediaLoading.value = true;

    try {
        const r = await ofApi.media(props.modelId, props.chat.id);
        mediaItems.value = (r.items as Record<string, unknown>[]) ?? [];
    } catch {
        mediaItems.value = [];
    } finally {
        mediaLoading.value = false;
    }
}

// The gallery returns raw OnlyFans items in a few possible shapes — pull a CDN url from the
// flat fields or the nested `files.*.url`, then load it through our proxy (the raw cdn urls are
// IP-locked and 403 in the browser, same as message media).
function thumb(item: Record<string, unknown>): string | null {
    const files = (item.files ?? {}) as Record<string, { url?: string } | undefined>;
    const cdn = (item.thumb ||
        item.preview ||
        item.squarePreview ||
        item.src ||
        item.full ||
        item.url ||
        files.thumb?.url ||
        files.preview?.url ||
        files.squarePreview?.url ||
        files.full?.url ||
        null) as string | null;

    return cdn ? ofApi.mediaUrl(props.modelId, cdn) : null;
}
</script>

<template>
    <div class="relative flex min-w-0 flex-1 flex-col rounded-xl border border-ss-border bg-ss-surface">
        <!-- Header -->
        <div class="flex items-center gap-3 border-b border-ss-border p-3">
            <span class="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-ss-surface-2 text-[11px] font-semibold text-ss-text-2">
                <img v-if="chat.avatar" :src="chat.avatar" :alt="chat.name" class="h-full w-full object-cover" />
                <template v-else>{{ chat.initials }}</template>
            </span>
            <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-semibold text-ss-text">{{ chat.name }}</div>
                <div class="truncate text-[12px] text-ss-text-3">@{{ chat.username }}</div>
            </div>
            <div class="relative flex items-center">
                <Search :size="13" class="absolute left-2 text-ss-text-3" />
                <input
                    v-model="query"
                    type="text"
                    placeholder="Search"
                    class="h-8 w-36 rounded-lg border border-ss-border bg-ss-bg pr-6 pl-7 text-[12px] text-ss-text placeholder:text-ss-text-3 focus:w-48 focus:border-ss-accent focus:outline-none"
                    @keyup.enter="runSearch"
                />
                <button v-if="searchResults" type="button" class="absolute right-1.5 text-ss-text-3 hover:text-ss-text" @click="clearSearch"><X :size="13" /></button>
            </div>
            <button type="button" class="grid h-8 w-8 place-items-center rounded-lg text-ss-text-2 hover:bg-ss-surface-2" title="Chat media gallery" @click="openMedia">
                <Image :size="16" />
            </button>
        </div>

        <!-- Thread -->
        <div ref="threadEl" class="flex-1 space-y-3 overflow-y-auto p-4 scrollbar-gutter-stable">
            <p v-if="searchResults" class="text-center text-[11px] text-ss-text-3">{{ shown.length }} result(s) · <button class="text-ss-accent-text" @click="clearSearch">clear</button></p>
            <div
                v-for="(m, i) in shown"
                :key="m.id ?? i"
                class="group flex flex-col"
                :class="m.from === 'creator' ? 'items-end' : 'items-start'"
            >
                <div class="flex items-center gap-1.5" :class="m.from === 'creator' ? 'flex-row-reverse' : ''">
                    <div
                        class="max-w-[78%] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed transition-opacity"
                        :class="[m.from === 'creator' ? 'bg-ss-accent text-white' : 'border border-ss-border bg-ss-surface-2 text-ss-text', m.pending ? 'opacity-60' : '']"
                    >
                        <SsMessageMedia v-if="m.media?.length" :media="m.media" :price="m.price" :model-id="modelId" />
                        <span v-if="m.text">{{ m.text }}</span>
                        <!-- fallback: count-only when the API gave us no media objects (e.g. cached/locked with no preview) -->
                        <span v-else-if="!m.media?.length && m.mediaCount" class="text-[12px] opacity-80">📎 {{ m.mediaCount }} media{{ m.price ? ` · $${m.price}` : '' }}</span>
                        <span v-else-if="!m.text && !m.media?.length" class="text-[12px] opacity-70">(no text)</span>
                    </div>
                    <!-- hover actions (real messages only) -->
                    <div v-if="!m.pending && !m.failed" class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button type="button" class="grid h-6 w-6 place-items-center rounded text-ss-text-3 hover:text-ss-neg" :class="{ 'text-ss-neg': m.isLiked }" title="Like / unlike" @click="emit('like', m)">
                            <Heart :size="13" :fill="m.isLiked ? 'currentColor' : 'none'" />
                        </button>
                        <button type="button" class="grid h-6 w-6 place-items-center rounded text-ss-text-3 hover:text-ss-neg" title="Delete on OnlyFans" @click="emit('delete', m)">
                            <Trash2 :size="13" />
                        </button>
                    </div>
                </div>
                <span class="mt-1 flex items-center gap-1 px-1 text-[10px] text-ss-text-3">
                    {{ m.from === 'creator' ? chat.name + ' · you' : chat.name }}
                    <template v-if="m.pending">
                        · <LoaderCircle :size="11" class="animate-spin" /> sending…
                    </template>
                    <template v-else-if="m.failed">
                        · <AlertCircle :size="11" class="text-ss-neg" /> <span class="text-ss-neg">not sent</span>
                        <button
                            type="button"
                            class="ml-1 inline-flex items-center gap-0.5 rounded px-1 font-medium text-ss-accent-text hover:bg-ss-accent-soft"
                            title="Resend this message"
                            @click="emit('resend', m)"
                        >
                            <RefreshCw :size="10" /> Resend
                        </button>
                    </template>
                    <template v-else>· {{ fmtTime(m.time) }}</template>
                    <span v-if="m.isTip" class="text-ss-tip">· tip</span>
                </span>
            </div>

            <p v-if="loading" class="py-10 text-center text-[13px] text-ss-text-3">Loading messages…</p>
            <p v-else-if="error" class="py-10 text-center text-[12px] text-ss-neg">{{ error }}</p>
            <p v-else-if="!shown.length" class="py-10 text-center text-[13px] text-ss-text-3">No messages.</p>
        </div>

        <slot name="composer" />

        <!-- Media gallery overlay -->
        <div v-if="showMedia" class="absolute inset-0 z-10 flex flex-col rounded-xl bg-ss-surface">
            <div class="flex items-center justify-between border-b border-ss-border p-3">
                <span class="text-sm font-semibold text-ss-text">Chat media</span>
                <button type="button" class="grid h-8 w-8 place-items-center rounded-lg text-ss-text-2 hover:bg-ss-surface-2" @click="showMedia = false"><X :size="16" /></button>
            </div>
            <div class="flex-1 overflow-y-auto p-3">
                <p v-if="mediaLoading" class="py-8 text-center text-[13px] text-ss-text-3">Loading media…</p>
                <p v-else-if="!mediaItems.length" class="py-8 text-center text-[13px] text-ss-text-3">No media in this chat.</p>
                <div v-else class="grid grid-cols-3 gap-2">
                    <div v-for="(item, i) in mediaItems" :key="i" class="aspect-square overflow-hidden rounded-lg bg-ss-surface-2">
                        <img v-if="thumb(item)" :src="thumb(item) as string" class="h-full w-full object-cover" />
                        <div v-else class="grid h-full place-items-center text-[11px] text-ss-text-3">media</div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
