<script setup lang="ts">
import { Link, router, usePage } from '@inertiajs/vue3';
import { Bell, Settings, X } from '@lucide/vue';
import { onClickOutside, useNow } from '@vueuse/core';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useCreatorContext } from '@/composables/useCreatorContext';
import {
    clearAllCreators,
    clearCreator,
    inboxEntries,
} from '@/lib/creatorInbox';
import { edit as notificationsEdit } from '@/routes/notifications';
import type { SidebarCreator } from '@/types/crm';

// Header bell: creators with fan messages you haven't looked at (see lib/creatorInbox).
// Picking one switches the creator context and opens its conversations.

const page = usePage();
const { select } = useCreatorContext();

const creators = computed<SidebarCreator[]>(
    () => (page.props.creators as SidebarCreator[]) ?? [],
);

// Only creators the user can still see: a stored entry can outlive an unassignment.
const entries = computed(() => {
    const names = new Map(creators.value.map((c) => [c.id, c.name]));

    return inboxEntries().flatMap((e) => {
        const name = names.get(e.creatorId);

        return name ? [{ ...e, name }] : [];
    });
});

const total = computed(() => entries.value.reduce((n, e) => n + e.count, 0));

// The counts live in sessionStorage, which the server render can't see — show them only
// once mounted so the SSR markup and the first client render agree.
const hydrated = ref(false);
onMounted(() => (hydrated.value = true));

const badge = computed(() =>
    hydrated.value && total.value > 0
        ? total.value > 99
            ? '99+'
            : String(total.value)
        : null,
);

// A brief ping ring on the badge when a message lands, so it catches the eye mid-chat.
const ping = ref(false);
let pingTimer: ReturnType<typeof setTimeout> | undefined;

watch(total, (next, prev) => {
    if (next > prev) {
        ping.value = true;
        clearTimeout(pingTimer);
        pingTimer = setTimeout(() => (ping.value = false), 2400);
    }
});

onBeforeUnmount(() => clearTimeout(pingTimer));

const open = ref(false);
const rootRef = ref<HTMLElement | null>(null);
onClickOutside(rootRef, () => (open.value = false));

const now = useNow({ interval: 30_000 });

/** Compact age for the row: "now" · "4m" · "2h" · "3d". */
function ago(at: number): string {
    const minutes = Math.floor((now.value.getTime() - at) / 60_000);

    if (minutes < 1) {
        return 'now';
    }

    if (minutes < 60) {
        return `${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);

    return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

function initials(name: string): string {
    return (
        name
            .split(' ')
            .map((w) => w[0])
            .slice(0, 2)
            .join('')
            .toUpperCase() || '?'
    );
}

function openCreator(creatorId: number): void {
    open.value = false;
    clearCreator(creatorId);
    select(creatorId);

    // Conversations follows the creator context, so on that page switching is enough
    // (the same as picking from the sidebar); anywhere else, go there.
    if (page.url.split('?')[0] !== '/conversations') {
        router.visit('/conversations');
    }
}
</script>

<template>
    <div ref="rootRef" class="relative" @keydown.esc="open = false">
        <button
            type="button"
            class="relative grid h-9 w-9 place-items-center rounded-lg text-ss-text-2 hover:bg-ss-surface-2"
            :class="{ 'bg-ss-surface-2 text-ss-text': open }"
            :title="badge ? `${total} new messages` : 'Notifications'"
            :aria-label="badge ? `${total} new messages` : 'Notifications'"
            aria-haspopup="true"
            :aria-expanded="open"
            @click="open = !open"
        >
            <Bell :size="18" />
            <span
                v-if="badge"
                class="absolute top-1 left-[19px] grid h-4 min-w-4 place-items-center rounded-full bg-ss-neg px-1 text-[10px] leading-none font-semibold text-white ring-2 ring-ss-surface"
            >
                <span
                    v-if="ping"
                    class="absolute inset-0 rounded-full bg-ss-neg opacity-75 motion-safe:animate-ping"
                />
                <span class="relative">{{ badge }}</span>
            </span>
        </button>

        <div
            v-if="open"
            class="absolute right-0 z-20 mt-1 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-ss-border bg-ss-surface shadow-xl"
        >
            <div class="flex items-center justify-between px-3.5 pt-3 pb-2">
                <span class="text-[13px] font-semibold text-ss-text">
                    New messages
                </span>
                <button
                    v-if="entries.length"
                    type="button"
                    class="rounded-md px-1.5 py-0.5 text-[12px] font-medium text-ss-accent-text hover:bg-ss-surface-2"
                    @click="clearAllCreators"
                >
                    Clear all
                </button>
            </div>

            <ul
                v-if="entries.length"
                class="max-h-96 space-y-0.5 overflow-y-auto px-1.5 pb-1.5"
            >
                <li
                    v-for="e in entries"
                    :key="e.creatorId"
                    class="group relative"
                >
                    <button
                        type="button"
                        class="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-ss-surface-2"
                        @click="openCreator(e.creatorId)"
                    >
                        <span
                            class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-ss-accent-soft text-[11px] font-semibold text-ss-accent-text"
                        >
                            {{ initials(e.name) }}
                        </span>
                        <span class="min-w-0 flex-1">
                            <span class="flex items-baseline gap-1.5">
                                <span
                                    class="truncate text-[13px] font-semibold text-ss-text"
                                    >{{ e.name }}</span
                                >
                                <span
                                    v-if="e.chats > 1"
                                    class="shrink-0 text-[11px] text-ss-text-3"
                                    >· {{ e.chats }} chats</span
                                >
                                <span
                                    class="ml-auto shrink-0 pl-2 font-ss-mono text-[11px] text-ss-text-3 group-hover:invisible"
                                    >{{ ago(e.at) }}</span
                                >
                            </span>
                            <span class="mt-0.5 flex items-center gap-2">
                                <span
                                    class="min-w-0 flex-1 truncate text-[12px] text-ss-text-2"
                                >
                                    <template v-if="e.latest">
                                        <span class="font-medium text-ss-text"
                                            >{{ e.latest.fanName }}:</span
                                        >
                                        {{ e.latest.preview }}
                                    </template>
                                    <template v-else>
                                        New
                                        {{
                                            e.count === 1
                                                ? 'message'
                                                : 'messages'
                                        }}
                                    </template>
                                </span>
                                <span
                                    class="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-ss-accent px-1.5 text-[11px] leading-none font-semibold text-white"
                                    >{{ e.count }}</span
                                >
                            </span>
                        </span>
                    </button>
                    <button
                        type="button"
                        class="absolute top-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-md bg-ss-surface-2 text-ss-text-3 opacity-0 group-hover:opacity-100 hover:text-ss-text focus-visible:opacity-100"
                        :title="`Dismiss ${e.name}`"
                        :aria-label="`Dismiss ${e.name}`"
                        @click="clearCreator(e.creatorId)"
                    >
                        <X :size="14" />
                    </button>
                </li>
            </ul>

            <div
                v-else
                class="flex flex-col items-center px-6 pt-3 pb-6 text-center"
            >
                <span
                    class="mb-2.5 grid h-10 w-10 place-items-center rounded-full bg-ss-surface-2 text-ss-text-3"
                >
                    <Bell :size="18" />
                </span>
                <span class="text-[13px] font-medium text-ss-text"
                    >You're all caught up</span
                >
                <span class="mt-0.5 text-[12px] text-ss-text-3">
                    Fan messages for creators you're not viewing show up here.
                </span>
            </div>

            <div class="border-t border-ss-border p-1.5">
                <Link
                    :href="notificationsEdit()"
                    class="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[12px] text-ss-text-2 hover:bg-ss-surface-2"
                    @click="open = false"
                >
                    <Settings :size="14" />
                    Notification settings
                </Link>
            </div>
        </div>
    </div>
</template>
