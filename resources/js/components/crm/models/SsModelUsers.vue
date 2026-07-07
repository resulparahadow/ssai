<script setup lang="ts">
import {
    Ban,
    BadgeCheck,
    Heart,
    LoaderCircle,
    Search,
    ShieldBan,
} from '@lucide/vue';
import { ref } from 'vue';
import { ofModel } from '@/lib/onlyfansModel';
import type { OfUserDetail } from '@/types/crm';

const props = defineProps<{ modelId: number }>();

const query = ref('');
const user = ref<OfUserDetail | null>(null);
const results = ref<OfUserDetail[] | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);
const busy = ref<'block' | 'restrict' | 'subscribe' | null>(null);

async function lookup() {
    const ids = query.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

    if (!ids.length) {
        return;
    }

    loading.value = true;
    error.value = null;
    user.value = null;
    results.value = null;

    try {
        if (ids.length > 1) {
            // mass lookup (up to 10 numeric ids) → pick a result to manage
            const users = (
                await ofModel.userDetails(props.modelId, ids.slice(0, 10))
            ).users;

            if (!users.length) {
                error.value = 'No users found for those ids.';
            } else if (users.length === 1) {
                user.value = users[0];
            } else {
                results.value = users;
            }
        } else {
            user.value = (await ofModel.lookupUser(props.modelId, ids[0])).user;
        }
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'User not found.';
    } finally {
        loading.value = false;
    }
}

function select(u: OfUserDetail) {
    user.value = u;
    results.value = null;
}

async function toggle(action: 'block' | 'restrict' | 'subscribe') {
    if (!user.value?.id) {
        return;
    }

    const stateKey =
        action === 'block'
            ? 'isBlocked'
            : action === 'restrict'
              ? 'isRestricted'
              : 'subscribedBy';
    const next = !user.value[stateKey];
    busy.value = action;
    error.value = null;

    try {
        await ofModel.setUserState(props.modelId, user.value.id, action, next);
        user.value[stateKey] = next;
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Action failed.';
    } finally {
        busy.value = null;
    }
}

function money(n: number | null): string {
    if (n == null) {
        return '—';
    }

    return n === 0 ? 'Free' : `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
}
</script>

<template>
    <div class="space-y-4">
        <!-- lookup -->
        <div class="relative flex items-center">
            <Search :size="15" class="absolute left-3 text-ss-text-3" />
            <input
                v-model="query"
                type="text"
                placeholder="User id or @username — or comma-separate up to 10 ids"
                class="h-10 w-full rounded-lg border border-ss-border bg-ss-bg pr-24 pl-9 text-sm text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
                @keyup.enter="lookup"
            />
            <button
                type="button"
                class="absolute right-1.5 rounded-md bg-ss-accent px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50"
                :disabled="loading || !query.trim()"
                @click="lookup"
            >
                Look up
            </button>
        </div>

        <p
            v-if="loading"
            class="flex items-center justify-center gap-2 py-8 text-[13px] text-ss-text-3"
        >
            <LoaderCircle :size="16" class="animate-spin" /> Looking up…
        </p>
        <p
            v-else-if="error"
            class="rounded-lg border border-ss-border bg-ss-surface p-4 text-center text-[12px] text-ss-neg"
        >
            {{ error }}
        </p>

        <!-- mass-lookup results → click one to manage -->
        <div
            v-else-if="results"
            class="overflow-hidden rounded-xl border border-ss-border bg-ss-surface"
        >
            <button
                v-for="u in results"
                :key="u.id ?? u.username ?? ''"
                type="button"
                class="flex w-full items-center gap-3 border-b border-ss-border p-3 text-left last:border-b-0 hover:bg-ss-surface-2"
                @click="select(u)"
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
                    <div class="text-[11px] text-ss-text-3">
                        @{{ u.username }}
                    </div>
                </div>
                <div class="flex shrink-0 gap-1">
                    <span
                        v-if="u.subscribedBy"
                        class="rounded-full bg-ss-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-ss-accent-text"
                        >Sub</span
                    >
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
            </button>
        </div>

        <div
            v-else-if="user"
            class="space-y-4 rounded-xl border border-ss-border bg-ss-surface p-5"
        >
            <div class="flex items-start gap-3">
                <span
                    class="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-full bg-ss-surface-2 text-[13px] font-semibold text-ss-text-2"
                >
                    <img
                        v-if="user.avatar"
                        :src="user.avatar"
                        :alt="user.name ?? ''"
                        class="h-full w-full object-cover"
                    />
                    <template v-else>{{ user.initials }}</template>
                </span>
                <div class="min-w-0 flex-1">
                    <div
                        class="flex items-center gap-1 text-[15px] font-semibold text-ss-text"
                    >
                        <span class="truncate">{{
                            user.name || user.username
                        }}</span>
                        <BadgeCheck
                            v-if="user.isVerified"
                            :size="14"
                            class="shrink-0 text-ss-accent"
                        />
                    </div>
                    <div class="text-[12px] text-ss-text-3">
                        @{{ user.username }}
                    </div>
                    <p
                        v-if="user.about"
                        class="mt-1 line-clamp-2 text-[12px] text-ss-text-2"
                    >
                        {{ user.about }}
                    </p>
                </div>
            </div>

            <!-- relationship chips -->
            <div class="flex flex-wrap gap-1.5 text-[11px]">
                <span
                    class="rounded-full bg-ss-surface-2 px-2 py-0.5 text-ss-text-2"
                    >Sub price: {{ money(user.subscribePrice) }}</span
                >
                <span
                    v-if="user.location"
                    class="rounded-full bg-ss-surface-2 px-2 py-0.5 text-ss-text-2"
                    >{{ user.location }}</span
                >
                <span
                    v-if="user.subscribedBy"
                    class="rounded-full bg-ss-accent-soft px-2 py-0.5 font-medium text-ss-accent-text"
                    >You subscribe to them</span
                >
                <span
                    v-if="user.isBlocked"
                    class="rounded-full bg-ss-neg/10 px-2 py-0.5 font-medium text-ss-neg"
                    >Blocked</span
                >
                <span
                    v-if="user.isRestricted"
                    class="rounded-full bg-ss-warn/15 px-2 py-0.5 font-medium text-ss-warn"
                    >Restricted</span
                >
            </div>

            <!-- moderation actions -->
            <div class="flex flex-wrap gap-2 border-t border-ss-border pt-3">
                <button
                    type="button"
                    class="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors disabled:opacity-50"
                    :class="
                        user.isBlocked
                            ? 'border-ss-neg bg-ss-neg/10 text-ss-neg'
                            : 'border-ss-border text-ss-text-2 hover:bg-ss-surface-2'
                    "
                    :disabled="busy === 'block'"
                    @click="toggle('block')"
                >
                    <Ban :size="14" />
                    {{ user.isBlocked ? 'Unblock' : 'Block' }}
                </button>
                <button
                    type="button"
                    class="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors disabled:opacity-50"
                    :class="
                        user.isRestricted
                            ? 'border-ss-warn bg-ss-warn/15 text-ss-warn'
                            : 'border-ss-border text-ss-text-2 hover:bg-ss-surface-2'
                    "
                    :disabled="busy === 'restrict'"
                    @click="toggle('restrict')"
                >
                    <ShieldBan :size="14" />
                    {{ user.isRestricted ? 'Unrestrict' : 'Restrict' }}
                </button>
                <button
                    type="button"
                    class="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[12px] font-medium transition-colors disabled:opacity-50"
                    :class="
                        user.subscribedBy
                            ? 'border-ss-accent bg-ss-accent-soft text-ss-accent-text'
                            : 'border-ss-border text-ss-text-2 hover:bg-ss-surface-2'
                    "
                    :disabled="busy === 'subscribe'"
                    @click="toggle('subscribe')"
                >
                    <Heart
                        :size="14"
                        :fill="user.subscribedBy ? 'currentColor' : 'none'"
                    />
                    {{ user.subscribedBy ? 'Unsubscribe' : 'Subscribe' }}
                </button>
            </div>
        </div>

        <p
            v-else
            class="rounded-xl border border-dashed border-ss-border p-8 text-center text-[13px] text-ss-text-3"
        >
            Enter a fan's user id or username to view their profile and
            moderate.
        </p>
    </div>
</template>
