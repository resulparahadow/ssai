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
    Video,
} from '@lucide/vue';
import { computed, ref } from 'vue';
import type { Component } from 'vue';
import SsNotifyMenu from '@/components/crm/conversations/SsNotifyMenu.vue';
import { chatDraft } from '@/lib/conversationCache';
import { usd } from '@/lib/money';
import type { OfChat, OfPreviewKind } from '@/types/crm';

const props = defineProps<{
    chats: OfChat[];
    loading: boolean;
    error: string | null;
    creator: string | null;
    selectedId: string | null;
}>();

const emit = defineEmits<{ select: [chat: OfChat]; refresh: [] }>();

const search = ref('');

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

const filtered = computed(() => {
    const q = search.value.toLowerCase().trim();

    return props.chats.filter(
        (c) =>
            !q ||
            c.name.toLowerCase().includes(q) ||
            c.preview.toLowerCase().includes(q),
    );
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
                    v-model="search"
                    type="text"
                    placeholder="Filter customers"
                    class="h-8 w-full rounded-lg border border-ss-border bg-ss-bg pr-2 pl-8 text-[13px] text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
                />
            </div>
        </div>

        <div class="flex-1 overflow-y-auto p-2">
            <button
                v-for="c in filtered"
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
                        <span
                            class="truncate text-[13px] font-medium text-ss-text"
                            >{{ c.name }}</span
                        >
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
                v-else-if="!filtered.length"
                class="px-2 py-6 text-center text-[13px] text-ss-text-3"
            >
                No conversations.
            </p>

            <!-- Revalidating / paginating with rows already shown: a subtle footer
                 so it's clear more conversations are still streaming in. -->
            <div
                v-if="loading && chats.length"
                class="flex items-center justify-center gap-2 px-2 py-3 text-[12px] text-ss-text-3"
                role="status"
            >
                <LoaderCircle :size="13" class="animate-spin" />
                Loading more…
            </div>
        </div>
    </aside>
</template>
