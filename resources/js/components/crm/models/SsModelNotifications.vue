<script setup lang="ts">
import { BadgeCheck, CheckCheck, LoaderCircle, UserRound } from '@lucide/vue';
import { onMounted, ref } from 'vue';
import { ofModel } from '@/lib/onlyfansModel';
import type {
    OfNotification,
    OfNotificationCounts,
    OfUserDetail,
} from '@/types/crm';

const props = defineProps<{ modelId: number }>();

// Tabs the OnlyFans API supports for the `type` filter (label → query value).
const TYPES: { key: string; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'subscriptions', label: 'Subscriptions' },
    { key: 'tips', label: 'Tips' },
    { key: 'purchases', label: 'Purchases' },
    { key: 'mentions', label: 'Mentions' },
    { key: 'comments', label: 'Comments' },
    { key: 'likes', label: 'Likes' },
    { key: 'promotions', label: 'Promotions' },
];
// counts keys differ slightly from the filter keys; map the common ones for the badge.
const COUNT_KEY: Record<string, string> = {
    subscriptions: 'subscribed',
    tips: 'tip',
    comments: 'commented',
    mentions: 'mentioned',
    likes: 'favorited',
};

const type = ref('all');
const items = ref<OfNotification[]>([]);
const counts = ref<OfNotificationCounts>({});
const loading = ref(false);
const error = ref<string | null>(null);
const hasMore = ref(false);
const fromId = ref<string | null>(null);
const marking = ref(false);

// On-demand fan lookup per notification userId (fetched only when the button is
// clicked, then cached so revisiting the row doesn't re-hit the OnlyFans API).
const users = ref<Record<string, OfUserDetail | 'loading' | null>>({});
const userError = ref<Record<string, string>>({});

function countFor(key: string): number {
    return counts.value[COUNT_KEY[key] ?? key] ?? 0;
}

async function showUser(userId: string | null): Promise<void> {
    if (!userId || users.value[userId] === 'loading' || subscriber(userId)) {
        return;
    }

    users.value[userId] = 'loading';
    delete userError.value[userId];

    try {
        users.value[userId] = (
            await ofModel.lookupUser(props.modelId, userId)
        ).user;
    } catch (e) {
        users.value[userId] = null;
        userError.value[userId] =
            e instanceof Error ? e.message : 'Failed to load user.';
    }
}

function subscriber(userId: string | null): OfUserDetail | null {
    const s = userId ? users.value[userId] : null;

    return s && s !== 'loading' ? s : null;
}

function isLoadingUser(userId: string | null): boolean {
    return !!userId && users.value[userId] === 'loading';
}

function userErr(userId: string | null): string | null {
    return userId ? (userError.value[userId] ?? null) : null;
}

async function load(reset = true) {
    if (reset) {
        fromId.value = null;
        items.value = [];
    }

    loading.value = true;
    error.value = null;

    try {
        const r = await ofModel.notifications(props.modelId, {
            type: type.value,
            limit: 20,
            from_id: reset ? undefined : (fromId.value ?? undefined),
        });
        items.value = reset
            ? r.notifications
            : [...items.value, ...r.notifications];
        hasMore.value = r.hasMore;
        fromId.value = r.next;
    } catch (e) {
        error.value =
            e instanceof Error ? e.message : 'Failed to load notifications.';
    } finally {
        loading.value = false;
    }
}

function switchType(t: string) {
    if (type.value === t) {
        return;
    }

    type.value = t;
    load(true);
}

async function markAllRead() {
    marking.value = true;

    try {
        await ofModel.markNotificationsRead(props.modelId);
        items.value = items.value.map((n) => ({ ...n, isRead: true }));
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to mark read.';
    } finally {
        marking.value = false;
    }
}

function fmtTime(t: string | null): string {
    if (!t) {
        return '';
    }

    const d = new Date(t);

    return isNaN(d.getTime())
        ? ''
        : d.toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
          });
}

onMounted(async () => {
    try {
        counts.value = (await ofModel.notificationCounts(props.modelId)).counts;
    } catch {
        // counts are best-effort (badges only)
    }

    load(true);
});
</script>

<template>
    <div class="space-y-3">
        <div class="flex items-center justify-between gap-2">
            <div class="flex flex-wrap items-center gap-1.5">
                <button
                    v-for="t in TYPES"
                    :key="t.key"
                    type="button"
                    class="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors"
                    :class="
                        type === t.key
                            ? 'bg-ss-surface-2 text-ss-text'
                            : 'text-ss-text-3 hover:text-ss-text-2'
                    "
                    @click="switchType(t.key)"
                >
                    {{ t.label }}
                    <span
                        v-if="countFor(t.key)"
                        class="rounded-full bg-ss-accent-soft px-1.5 text-[10px] font-semibold text-ss-accent-text"
                        >{{ countFor(t.key) }}</span
                    >
                </button>
            </div>
            <button
                type="button"
                class="flex shrink-0 items-center gap-1 rounded-lg border border-ss-border px-2.5 py-1.5 text-[12px] font-medium text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-50"
                :disabled="marking"
                @click="markAllRead"
            >
                <CheckCheck :size="13" /> Mark all read
            </button>
        </div>

        <p
            v-if="error"
            class="rounded-lg border border-ss-border bg-ss-surface p-4 text-center text-[12px] text-ss-neg"
        >
            {{ error }}
        </p>

        <div
            v-if="items.length"
            class="overflow-hidden rounded-xl border border-ss-border bg-ss-surface"
        >
            <div
                v-for="(n, i) in items"
                :key="n.id ?? i"
                class="flex items-start gap-3 border-b border-ss-border p-3 last:border-b-0"
                :class="{ 'bg-ss-accent-soft/40': !n.isRead }"
            >
                <span
                    class="mt-1.5 h-2 w-2 shrink-0 rounded-full"
                    :class="n.isRead ? 'bg-transparent' : 'bg-ss-accent'"
                />
                <div class="min-w-0 flex-1">
                    <p class="text-[13px] leading-snug text-ss-text">
                        {{ n.text || n.type }}
                    </p>
                    <p class="mt-0.5 text-[11px] text-ss-text-3">
                        {{ fmtTime(n.createdAt) }}
                    </p>

                    <!-- Who is this fan? (lazy OnlyFans user lookup, cached) -->
                    <div v-if="n.userId" class="mt-2">
                        <div
                            v-if="subscriber(n.userId)"
                            class="flex items-center gap-2 rounded-lg border border-ss-border bg-ss-bg p-2"
                        >
                            <span
                                class="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-ss-surface-2 text-[11px] font-semibold text-ss-text-2"
                            >
                                <img
                                    v-if="subscriber(n.userId)?.avatar"
                                    :src="subscriber(n.userId)?.avatar ?? ''"
                                    :alt="subscriber(n.userId)?.name ?? ''"
                                    class="h-full w-full object-cover"
                                />
                                <template v-else>{{
                                    subscriber(n.userId)?.initials
                                }}</template>
                            </span>
                            <div class="min-w-0 flex-1">
                                <div
                                    class="flex items-center gap-1 text-[12px] font-medium text-ss-text"
                                >
                                    <span class="truncate">{{
                                        subscriber(n.userId)?.name ||
                                        subscriber(n.userId)?.username
                                    }}</span>
                                    <BadgeCheck
                                        v-if="subscriber(n.userId)?.isVerified"
                                        :size="12"
                                        class="shrink-0 text-ss-accent"
                                    />
                                </div>
                                <div class="text-[11px] text-ss-text-3">
                                    @{{ subscriber(n.userId)?.username }}
                                </div>
                            </div>
                        </div>

                        <p
                            v-else-if="isLoadingUser(n.userId)"
                            class="flex items-center gap-1.5 text-[11px] text-ss-text-3"
                        >
                            <LoaderCircle :size="12" class="animate-spin" />
                            Loading…
                        </p>

                        <template v-else>
                            <p
                                v-if="userErr(n.userId)"
                                class="mb-1 text-[11px] text-ss-neg"
                            >
                                {{ userErr(n.userId) }}
                            </p>
                            <button
                                type="button"
                                class="flex items-center gap-1 rounded-md border border-ss-border px-2 py-1 text-[11px] font-medium text-ss-text-2 hover:bg-ss-surface-2"
                                @click="showUser(n.userId)"
                            >
                                <UserRound :size="12" />
                                {{
                                    n.type === 'subscribed'
                                        ? 'Who subscribed?'
                                        : 'Show user'
                                }}
                            </button>
                        </template>
                    </div>
                </div>
            </div>
        </div>

        <p
            v-else-if="!loading"
            class="rounded-xl border border-ss-border bg-ss-surface p-6 text-center text-[13px] text-ss-text-3"
        >
            No notifications.
        </p>

        <div class="flex justify-center">
            <button
                v-if="hasMore"
                type="button"
                class="rounded-lg border border-ss-border px-4 py-2 text-[12px] font-medium text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-50"
                :disabled="loading"
                @click="load(false)"
            >
                Load more
            </button>
            <LoaderCircle
                v-if="loading"
                :size="18"
                class="animate-spin text-ss-text-3"
            />
        </div>
    </div>
</template>
