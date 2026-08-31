<script setup lang="ts">
import { Ban, BadgeCheck, LoaderCircle, RefreshCw, ShieldBan } from '@lucide/vue';
import { onMounted, ref } from 'vue';
import { absoluteTime, relativeTime } from '@/lib/datetime';
import { ofModel } from '@/lib/onlyfansModel';
import type { OfUserDetail } from '@/types/crm';

/**
 * The creator's blocked / restricted users, live from OnlyFans (nothing persisted).
 *
 * Both buckets return the same user shape, so this component is driven by `bucket`.
 * OnlyFans exposes no "blocked at"/"restricted at" timestamp — `lastSeen` is the only date
 * on these records, so the list can't be ordered by when the action happened.
 */
const props = defineProps<{ modelId: number; bucket: 'blocked' | 'restricted' }>();

const PAGE = 50; // OnlyFans caps `limit` at 50 on both lists

const users = ref<OfUserDetail[]>([]);
const hasMore = ref(false);
const nextOffset = ref<number | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const error = ref<string | null>(null);
const busy = ref<string | null>(null);

async function load(reset = true) {
    if (reset) {
        loading.value = true;
        users.value = [];
    } else {
        loadingMore.value = true;
    }

    error.value = null;

    try {
        const r = await ofModel.moderatedUsers(props.modelId, props.bucket, {
            limit: PAGE,
            offset: reset ? 0 : (nextOffset.value ?? 0),
        });
        users.value = reset ? r.users : [...users.value, ...r.users];
        // `hasMore` is the only trustworthy end-of-list signal — nextOffset keeps
        // advancing (offset+limit) even on the last page.
        hasMore.value = r.hasMore;
        nextOffset.value = r.nextOffset;
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Could not load the list.';
    } finally {
        loading.value = false;
        loadingMore.value = false;
    }
}

/**
 * Toggle in place rather than dropping the row: a row that no longer belongs to this bucket
 * is dimmed instead of vanishing, so an accidental unblock stays undoable without having to
 * look the fan up by id again. Refresh re-pulls the true list from OnlyFans.
 */
async function toggle(u: OfUserDetail, action: 'block' | 'restrict') {
    if (!u.id) {
        return;
    }

    const key = action === 'block' ? 'isBlocked' : 'isRestricted';
    const next = !u[key];
    busy.value = `${u.id}:${action}`;
    error.value = null;

    try {
        await ofModel.setUserState(props.modelId, u.id, action, next);
        u[key] = next;
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Action failed.';
    } finally {
        busy.value = null;
    }
}

/** Still in this bucket? Drives the dimming after a toggle. */
function inBucket(u: OfUserDetail): boolean {
    return props.bucket === 'blocked' ? u.isBlocked : u.isRestricted;
}

function subLabel(u: OfUserDetail): string | null {
    if (u.subscribedOn && !u.subscribedOnExpired) {
        return u.subscribedOnDuration ? `Subscriber · ${u.subscribedOnDuration}` : 'Subscriber';
    }

    // A lapsed fan still carries the duration they were subscribed for.
    if (u.subscribedOnDuration) {
        return `Ex-subscriber · ${u.subscribedOnDuration}`;
    }

    return null;
}

onMounted(() => load());
</script>

<template>
    <div class="space-y-3">
        <div class="flex items-center justify-between gap-2">
            <p class="text-[12px] text-ss-text-3">
                {{ users.length }}{{ hasMore ? '+' : '' }}
                {{ bucket === 'blocked' ? 'blocked' : 'restricted' }}
                {{ users.length === 1 ? 'user' : 'users' }} · live from OnlyFans
            </p>
            <button
                type="button"
                :disabled="loading"
                class="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-50"
                @click="load()"
            >
                <RefreshCw :size="12" :class="loading ? 'animate-spin' : ''" />
                Refresh
            </button>
        </div>

        <p
            v-if="error"
            class="rounded-lg border border-ss-border bg-ss-surface p-3 text-center text-[12px] text-ss-neg"
        >
            {{ error }}
        </p>

        <p
            v-if="loading"
            class="flex items-center justify-center gap-2 py-10 text-[13px] text-ss-text-3"
        >
            <LoaderCircle :size="16" class="animate-spin" /> Loading…
        </p>

        <p
            v-else-if="!users.length"
            class="rounded-xl border border-dashed border-ss-border p-8 text-center text-[13px] text-ss-text-3"
        >
            No {{ bucket }} users.
        </p>

        <div
            v-else
            class="overflow-hidden rounded-xl border border-ss-border bg-ss-surface"
        >
            <div
                v-for="u in users"
                :key="u.id ?? u.username ?? ''"
                class="flex items-center gap-3 border-b border-ss-border p-3 transition-opacity last:border-b-0"
                :class="inBucket(u) ? '' : 'opacity-50'"
            >
                <span
                    class="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-ss-surface-2 text-[12px] font-semibold text-ss-text-2"
                >
                    <img
                        v-if="u.avatar"
                        :src="u.avatar"
                        :alt="u.name ?? ''"
                        class="h-full w-full object-cover"
                    />
                    <template v-else>{{ u.initials }}</template>
                </span>

                <div class="min-w-0 flex-1">
                    <div
                        class="flex items-center gap-1 text-[13px] font-medium text-ss-text"
                    >
                        <span class="truncate">{{ u.name || u.username }}</span>
                        <BadgeCheck
                            v-if="u.isVerified"
                            :size="13"
                            class="shrink-0 text-ss-accent"
                        />
                    </div>
                    <div
                        class="flex flex-wrap items-center gap-x-2 text-[11px] text-ss-text-3"
                    >
                        <span>@{{ u.username }}</span>
                        <span
                            v-if="u.lastSeen"
                            :title="absoluteTime(u.lastSeen)"
                            >Last seen {{ relativeTime(u.lastSeen) }}</span
                        >
                        <span v-if="subLabel(u)">{{ subLabel(u) }}</span>
                    </div>
                </div>

                <!-- Both states show: OnlyFans commonly has a user blocked AND restricted. -->
                <div class="flex shrink-0 gap-1">
                    <span
                        v-if="u.isBlocked"
                        class="rounded-full bg-ss-neg/10 px-1.5 py-0.5 text-[10px] font-medium text-ss-neg"
                        >Blocked</span
                    >
                    <span
                        v-if="u.isRestricted"
                        class="rounded-full bg-ss-warn/15 px-1.5 py-0.5 text-[10px] font-medium text-ss-warn"
                        >Restricted</span
                    >
                </div>

                <div class="flex shrink-0 gap-1.5">
                    <button
                        type="button"
                        class="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50"
                        :class="
                            u.isBlocked
                                ? 'border-ss-neg bg-ss-neg/10 text-ss-neg'
                                : 'border-ss-border text-ss-text-2 hover:bg-ss-surface-2'
                        "
                        :disabled="busy === `${u.id}:block`"
                        @click="toggle(u, 'block')"
                    >
                        <LoaderCircle
                            v-if="busy === `${u.id}:block`"
                            :size="12"
                            class="animate-spin"
                        />
                        <Ban v-else :size="12" />
                        {{ u.isBlocked ? 'Unblock' : 'Block' }}
                    </button>
                    <button
                        type="button"
                        class="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11px] font-medium transition-colors disabled:opacity-50"
                        :class="
                            u.isRestricted
                                ? 'border-ss-warn bg-ss-warn/15 text-ss-warn'
                                : 'border-ss-border text-ss-text-2 hover:bg-ss-surface-2'
                        "
                        :disabled="busy === `${u.id}:restrict`"
                        @click="toggle(u, 'restrict')"
                    >
                        <LoaderCircle
                            v-if="busy === `${u.id}:restrict`"
                            :size="12"
                            class="animate-spin"
                        />
                        <ShieldBan v-else :size="12" />
                        {{ u.isRestricted ? 'Unrestrict' : 'Restrict' }}
                    </button>
                </div>
            </div>
        </div>

        <button
            v-if="hasMore && !loading"
            type="button"
            :disabled="loadingMore"
            class="w-full rounded-lg border border-ss-border py-2 text-[12px] font-medium text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-50"
            @click="load(false)"
        >
            {{ loadingMore ? 'Loading…' : 'Load more' }}
        </button>
    </div>
</template>
