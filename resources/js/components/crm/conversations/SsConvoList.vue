<script setup lang="ts">
import { RefreshCw, Search } from '@lucide/vue';
import { computed, ref } from 'vue';
import SsNotifyMenu from '@/components/crm/conversations/SsNotifyMenu.vue';
import { chatDraft } from '@/lib/conversationCache';
import type { OfChat } from '@/types/crm';

const props = defineProps<{
    chats: OfChat[];
    loading: boolean;
    error: string | null;
    creator: string | null;
    selectedId: string | null;
}>();

const emit = defineEmits<{ select: [chat: OfChat]; refresh: [] }>();

const search = ref('');

const filtered = computed(() => {
    const q = search.value.toLowerCase().trim();

    return props.chats.filter((c) => !q || c.name.toLowerCase().includes(q) || c.preview.toLowerCase().includes(q));
});
</script>

<template>
    <aside class="flex w-72 shrink-0 flex-col rounded-xl border border-ss-border bg-ss-surface">
        <div class="space-y-2 border-b border-ss-border p-3">
            <div class="flex items-center justify-between">
                <span class="truncate text-[13px] font-semibold text-ss-text">{{ creator ?? 'Conversations' }}</span>
                <div class="flex shrink-0 items-center gap-1">
                    <SsNotifyMenu />
                    <button
                        type="button"
                        :disabled="loading"
                        class="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-50"
                        title="Reload chats from OnlyFans"
                        @click="emit('refresh')"
                    >
                        <RefreshCw :size="12" :class="loading ? 'animate-spin' : ''" />
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
                :class="c.id === selectedId ? 'bg-ss-accent-soft' : 'hover:bg-ss-surface-2'"
                @click="emit('select', c)"
            >
                <span class="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-ss-surface-2 text-[11px] font-semibold text-ss-text-2">
                    <img v-if="c.avatar" :src="c.avatar" :alt="c.name" class="h-full w-full object-cover" />
                    <template v-else>{{ c.initials }}</template>
                </span>
                <span class="min-w-0 flex-1">
                    <span class="flex items-center justify-between gap-2">
                        <span class="truncate text-[13px] font-medium text-ss-text">{{ c.name }}</span>
                        <span
                            v-if="c.unread > 0"
                            class="grid h-4 min-w-4 shrink-0 place-items-center rounded-full bg-ss-accent px-1 text-[10px] font-semibold text-white"
                        >{{ c.unread }}</span>
                    </span>
                    <span class="mt-0.5 block truncate text-[12px]">
                        <template v-if="chatDraft(c.id)">
                            <span class="font-medium text-ss-neg">Draft:</span>
                            <span class="text-ss-text-3"> {{ chatDraft(c.id) }}</span>
                        </template>
                        <span v-else class="text-ss-text-3">{{ c.preview || '—' }}</span>
                    </span>
                </span>
            </button>

            <p v-if="loading && !filtered.length" class="px-2 py-6 text-center text-[13px] text-ss-text-3">Loading chats…</p>
            <p v-else-if="error" class="px-2 py-6 text-center text-[12px] text-ss-neg">{{ error }}</p>
            <p v-else-if="!filtered.length" class="px-2 py-6 text-center text-[13px] text-ss-text-3">No conversations.</p>
        </div>
    </aside>
</template>
