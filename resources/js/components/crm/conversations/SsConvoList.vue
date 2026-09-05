<script setup lang="ts">
import {
    DollarSign,
    Image,
    ImagePlay,
    LoaderCircle,
    Lock,
    Mic,
    Paperclip,
    RefreshCw,
    Search,
    ShieldMinus,
    Video,
} from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { Component } from 'vue';
import SsNotifyMenu from '@/components/crm/conversations/SsNotifyMenu.vue';
import { chatDraft } from '@/lib/conversationCache';
import { usd } from '@/lib/money';
import type { OfChat, OfPreviewKind } from '@/types/crm';

const props = defineProps<{
    chats: OfChat[];
    loading: boolean;
    /** Fatal: nothing loaded, so this REPLACES the list. */
    error: string | null;
    /** Another page of conversations exists behind the scroll sentinel. */
    hasMore: boolean;
    loadingMore: boolean;
    /** A scroll page failed — shown as a retry in the footer, rows kept. */
    moreError: string | null;
    /** Current search term. Owned by the parent: it drives a SERVER query, not a local filter. */
    search: string;
    creator: string | null;
    selectedId: string | null;
}>();

const emit = defineEmits<{
    select: [chat: OfChat];
    refresh: [];
    loadMore: [];
    search: [q: string];
}>();

// Icon + label shown in the list when a chat's last message has no text (GIF/photo/video/…).
const PREVIEW_META: Record<OfPreviewKind, { icon: Component; label: string }> =
    {
        gif: { icon: ImagePlay, label: 'GIF' },
        photo: { icon: Image, label: 'Photo' },
        video: { icon: Video, label: 'Video' },
        audio: { icon: Mic, label: 'Voice message' },
        tip: { icon: DollarSign, label: 'Tip' },
        locked: { icon: Lock, label: 'Locked content' },
        media: { icon: Paperclip, label: 'Media' },
    };

function previewMeta(kind: OfPreviewKind) {
    return PREVIEW_META[kind] ?? PREVIEW_META.media;
}

// Placeholder bar widths for the cold-load skeleton — varied so the shimmer reads
// like real conversation rows rather than a uniform grid.
const SKELETON_ROWS = [
    { name: 'w-24', line: 'w-40' },
    { name: 'w-20', line: 'w-32' },
    { name: 'w-28', line: 'w-44' },
    { name: 'w-16', line: 'w-28' },
    { name: 'w-24', line: 'w-36' },
    { name: 'w-20', line: 'w-44' },
    { name: 'w-28', line: 'w-32' },
] as const;

// The rows are whatever has been paged in, and searching goes upstream (see `search`),
// so there is nothing left to filter locally — a client-side filter here would hide
// conversations the server had already matched.
const rows = computed(() => props.chats);

// Infinite scroll: a sentinel below the last row asks the parent for the next page as it
// nears the viewport. rootMargin starts the fetch before the user actually hits the end,
// so paging feels continuous. The parent no-ops spurious calls (in-flight / exhausted).
const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

onMounted(() => {
    if (typeof IntersectionObserver === 'undefined') {
        return;
    }

    observer = new IntersectionObserver(
        (entries) => {
            if (entries[0]?.isIntersecting) {
                emit('loadMore');
            }
        },
        { rootMargin: '300px' },
    );

    watch(
        sentinel,
        (el, _old, onCleanup) => {
            if (!el) {
                return;
            }

            observer?.observe(el);
            onCleanup(() => observer?.unobserve(el));
        },
        { immediate: true },
    );
});

onBeforeUnmount(() => {
    observer?.disconnect();
    observer = null;
});
</script>

<template>
    <aside
        class="flex w-72 shrink-0 flex-col rounded-xl border border-ss-border bg-ss-surface"
    >
        <div class="space-y-2 border-b border-ss-border p-3">
            <div class="flex items-center justify-between">
                <span class="truncate text-[13px] font-semibold text-ss-text">{{
                    creator ?? 'Conversations'
                }}</span>
                <div class="flex shrink-0 items-center gap-1">
                    <SsNotifyMenu />
                    <button
                        type="button"
                        :disabled="loading"
                        class="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-50"
                        title="Reload chats from OnlyFans"
                        @click="emit('refresh')"
                    >
                        <RefreshCw
                            :size="12"
                            :class="loading ? 'animate-spin' : ''"
                        />
                        {{ loading ? 'Loading…' : 'Refresh' }}
                    </button>
                </div>
            </div>
            <div class="relative flex items-center">
                <Search :size="14" class="absolute left-2.5 text-ss-text-3" />
                <input
                    :value="search"
                    type="text"
                    placeholder="Search customers"
                    class="h-8 w-full rounded-lg border border-ss-border bg-ss-bg pr-2 pl-8 text-[13px] text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
                    @input="
                        emit(
                            'search',
                            ($event.target as HTMLInputElement).value,
                        )
                    "
                />
            </div>
        </div>

        <div class="flex-1 overflow-y-auto p-2">
            <button
                v-for="c in rows"
                :key="c.id"
                type="button"
                class="flex w-full items-start gap-2.5 rounded-lg p-2 text-left transition-colors"
                :class="
                    c.id === selectedId
                        ? 'bg-ss-accent-soft'
                        : 'hover:bg-ss-surface-2'
                "
                @click="emit('select', c)"
            >
                <span
                    class="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-ss-surface-2 text-[11px] font-semibold text-ss-text-2"
                >
                    <img
                        v-if="c.avatar"
                        :src="c.avatar"
                        :alt="c.name"
                        class="h-full w-full object-cover"
                    />
                    <template v-else>{{ c.initials }}</template>
                </span>
                <span class="min-w-0 flex-1">
                    <span class="flex items-center justify-between gap-2">
                        <span class="flex min-w-0 items-center gap-1">
                            <!-- Restricted rides along on the chat list payload, so the
                                 row flags it without a per-fan lookup. -->
                            <span
                                v-if="c.restricted"
                                class="grid shrink-0 place-items-center text-ss-warn"
                                title="Restricted on OnlyFans"
                            >
                                <ShieldMinus :size="12" />
                            </span>
                            <span
                                class="truncate text-[13px] font-medium text-ss-text"
                                >{{ c.name }}</span
                            >
                        </span>
                        <span
                            v-if="c.unread > 0"
                            class="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-ss-accent px-1 text-[10px] font-semibold text-white"
                            >{{ c.unread }}</span
                        >
                    </span>
                    <span
                        class="mt-0.5 flex items-center justify-between gap-2 text-[12px]"
                    >
                        <span class="min-w-0 flex-1 truncate">
                            <template v-if="chatDraft(c.id)">
                                <span class="font-medium text-ss-neg"
                                    >Draft:</span
                                >
                                <span class="text-ss-text-3">
                                    {{ chatDraft(c.id) }}</span
                                >
                            </template>
                            <span
                                v-else-if="c.preview"
                                class="text-ss-text-3"
                                >{{ c.preview }}</span
                            >
                            <span
                                v-else-if="c.previewKind"
                                class="inline-flex items-center gap-1 text-ss-text-3"
                            >
                                <component
                                    :is="previewMeta(c.previewKind).icon"
                                    :size="12"
                                    class="shrink-0"
                                />
                                {{ previewMeta(c.previewKind).label }}
                            </span>
                            <span v-else class="text-ss-text-3">—</span>
                        </span>
                        <!-- lifetime spend, bottom-right; only for fans who've spent -->
                        <span
                            v-if="c.totalSpent && c.totalSpent > 0"
                            class="shrink-0 text-[11px] font-semibold text-ss-pos"
                            title="Total lifetime spend"
                            >{{ usd(c.totalSpent) }}</span
                        >
                    </span>
                </span>
            </button>

            <!-- Cold load (no chats yet): shimmer skeleton rows that mirror the real
                 row layout, so the panel never sits empty or jumps as data arrives. -->
            <div
                v-if="loading && !chats.length"
                class="animate-pulse space-y-1"
                role="status"
                aria-label="Loading conversations"
            >
                <div
                    v-for="(row, i) in SKELETON_ROWS"
                    :key="i"
                    class="flex items-start gap-2.5 rounded-lg p-2"
                >
                    <span class="h-9 w-9 shrink-0 rounded-lg bg-ss-surface-2" />
                    <span class="min-w-0 flex-1 space-y-2 pt-1.5">
                        <span
                            class="block h-3 rounded bg-ss-surface-2"
                            :class="row.name"
                        />
                        <span
                            class="block h-2.5 rounded bg-ss-surface-2"
                            :class="row.line"
                        />
                    </span>
                </div>
            </div>
            <p
                v-else-if="error"
                class="px-2 py-6 text-center text-[12px] text-ss-neg"
            >
                {{ error }}
            </p>
            <p
                v-else-if="!rows.length"
                class="px-2 py-6 text-center text-[13px] text-ss-text-3"
            >
                No conversations.
            </p>

            <!-- Scroll sentinel + paging footer. A failed page keeps every loaded row and
                 offers a retry, rather than throwing the list away over one bad request. -->
            <div
                v-if="moreError"
                class="mx-2 mb-2 space-y-1 rounded-lg border border-ss-warn/30 bg-ss-warn/10 px-2 py-1.5 text-[11px] text-ss-warn"
            >
                <p class="font-semibold">Couldn't load more conversations</p>
                <!-- The upstream reason, verbatim. A generic line here would throw away the
                     one thing that says whether to retry now, re-authenticate, or wait —
                     OnlyFansAPI's messages are already written for a human to act on. -->
                <p class="opacity-90">{{ moreError }}</p>
                <button
                    type="button"
                    class="font-semibold underline underline-offset-2 hover:no-underline"
                    @click="emit('loadMore')"
                >
                    Retry
                </button>
            </div>

            <div
                v-else-if="loadingMore"
                class="flex items-center justify-center gap-2 px-2 py-3 text-[12px] text-ss-text-3"
                role="status"
            >
                <LoaderCircle :size="13" class="animate-spin" />
                Loading more…
            </div>

            <div
                v-if="hasMore && !moreError"
                ref="sentinel"
                class="h-px w-full"
                aria-hidden="true"
            />

            <!-- Revalidating page one with rows already shown. Distinct from the paging
                 spinner above: that one is fetching the NEXT page, this is refreshing the
                 first — labelling both "Loading more" made the list look stuck in a loop. -->
            <div
                v-if="loading && chats.length"
                class="flex items-center justify-center gap-2 px-2 py-3 text-[12px] text-ss-text-3"
                role="status"
            >
                <LoaderCircle :size="13" class="animate-spin" />
                Refreshing…
            </div>
        </div>
    </aside>
</template>
