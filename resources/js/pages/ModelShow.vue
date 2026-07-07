<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import {
    ArrowLeft,
    Bell,
    Gift,
    Heart,
    Link2,
    MessageSquareHeart,
    Settings2,
    UserSearch,
    Users,
} from '@lucide/vue';
import { onMounted, reactive, ref } from 'vue';
import SsModelFans from '@/components/crm/models/SsModelFans.vue';
import SsModelLinks from '@/components/crm/models/SsModelLinks.vue';
import SsModelNotifications from '@/components/crm/models/SsModelNotifications.vue';
import SsModelPromotions from '@/components/crm/models/SsModelPromotions.vue';
import SsModelSettings from '@/components/crm/models/SsModelSettings.vue';
import SsModelUsers from '@/components/crm/models/SsModelUsers.vue';
import SsModelWelcome from '@/components/crm/models/SsModelWelcome.vue';
import { ofModel } from '@/lib/onlyfansModel';
import type { ChatterOption, CreatorModel, OfAccountStatus } from '@/types/crm';

const props = defineProps<{
    model: CreatorModel;
    connected: boolean;
    chatters: ChatterOption[];
}>();

const draft = reactive<CreatorModel>({
    ...props.model,
    assigned: [...props.model.assigned],
});

function initials(name: string): string {
    return (
        name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0])
            .join('')
            .toUpperCase() || '?'
    );
}

// ---- live OnlyFans connection status ----
const status = ref<OfAccountStatus | null>(null);
const statusError = ref<string | null>(null);
const statusLoading = ref(false);

async function loadStatus() {
    if (!props.connected) {
        return;
    }

    statusLoading.value = true;

    try {
        const r = await ofModel.status(props.model.id);
        status.value = r.status;
    } catch (e) {
        statusError.value =
            e instanceof Error ? e.message : 'Connection check failed.';
    } finally {
        statusLoading.value = false;
    }
}

// ---- model field + assignment editing ----
const savingSettings = ref(false);
const savingAssign = ref(false);

function saveSettings() {
    savingSettings.value = true;
    router.put(
        `/models/${draft.id}`,
        {
            name: draft.name,
            tier: draft.tier,
            prompt: draft.prompt,
            content_library: draft.content_library,
            feedback_rules: draft.feedback_rules,
            of_account_id: draft.of_account_id,
        },
        {
            preserveScroll: true,
            preserveState: true,
            onFinish: () => (savingSettings.value = false),
        },
    );
}

function saveAssignments() {
    savingAssign.value = true;
    router.put(
        `/models/${draft.id}/assignments`,
        { user_ids: draft.assigned },
        {
            preserveScroll: true,
            preserveState: true,
            onFinish: () => (savingAssign.value = false),
        },
    );
}

function toggleAssign(id: number) {
    const i = draft.assigned.indexOf(id);

    if (i >= 0) {
        draft.assigned.splice(i, 1);
    } else {
        draft.assigned.push(id);
    }
}

// ---- OF tabs (lazy-mount on first activation, kept alive after) ----
type Tab =
    | 'fans'
    | 'settings'
    | 'welcome'
    | 'notifications'
    | 'users'
    | 'links'
    | 'promotions';
const tab = ref<Tab>('fans');
const visited = reactive(new Set<Tab>(['fans']));
const TABS: { key: Tab; label: string; icon: typeof Users }[] = [
    { key: 'fans', label: 'Fans', icon: Heart },
    { key: 'settings', label: 'Settings', icon: Settings2 },
    { key: 'welcome', label: 'Welcome', icon: MessageSquareHeart },
    { key: 'notifications', label: 'Notifications', icon: Bell },
    { key: 'users', label: 'Users', icon: UserSearch },
    { key: 'links', label: 'Links', icon: Link2 },
    { key: 'promotions', label: 'Promotions', icon: Gift },
];

function openTab(t: Tab) {
    tab.value = t;
    visited.add(t);
}

onMounted(loadStatus);
</script>

<template>
    <Head :title="model.name" />

    <div class="mx-auto max-w-7xl space-y-5">
        <Link
            href="/models"
            class="inline-flex items-center gap-1 text-[13px] font-medium text-ss-text-3 hover:text-ss-text"
        >
            <ArrowLeft :size="15" /> Creator Models
        </Link>

        <!-- Header + live status -->
        <div
            class="flex flex-wrap items-center gap-4 rounded-xl border border-ss-border bg-ss-surface p-5"
        >
            <span
                class="grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-ss-surface-2 text-base font-bold text-ss-text-2"
            >
                <img
                    v-if="status?.avatar"
                    :src="status.avatar"
                    :alt="model.name"
                    class="h-full w-full object-cover"
                />
                <template v-else>{{ initials(model.name) }}</template>
            </span>
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                    <h2 class="truncate text-xl font-bold text-ss-text">
                        {{ model.name }}
                    </h2>
                    <span
                        v-if="model.tier"
                        class="rounded-full bg-ss-surface-2 px-2 py-0.5 text-[11px] font-medium text-ss-text-3 capitalize"
                        >{{ model.tier }}</span
                    >
                </div>
                <!-- connection line -->
                <div class="mt-1 flex items-center gap-2 text-[12px]">
                    <template v-if="!connected">
                        <span class="h-2 w-2 rounded-full bg-ss-text-3/40" />
                        <span class="text-ss-text-3"
                            >Not connected — add an OnlyFans account id
                            below.</span
                        >
                    </template>
                    <template v-else-if="statusLoading">
                        <span
                            class="h-2 w-2 animate-pulse rounded-full bg-ss-warn"
                        />
                        <span class="text-ss-text-3">Checking connection…</span>
                    </template>
                    <template v-else-if="status?.isAuth">
                        <span class="h-2 w-2 rounded-full bg-ss-pos" />
                        <span class="font-medium text-ss-pos">Connected</span>
                        <span class="text-ss-text-3"
                            >· @{{ status.username }} ·
                            {{ status.subscribersCount ?? 0 }} subscribers</span
                        >
                    </template>
                    <template v-else>
                        <span class="h-2 w-2 rounded-full bg-ss-neg" />
                        <span class="font-medium text-ss-neg">{{
                            statusError
                                ? 'Connection error'
                                : 'Needs re-authentication'
                        }}</span>
                    </template>
                </div>
            </div>
        </div>

        <!-- Model fields + assignments -->
        <div class="grid gap-5 lg:grid-cols-2">
            <div
                class="space-y-3 rounded-xl border border-ss-border bg-ss-surface p-5"
            >
                <h3 class="text-base font-semibold text-ss-text">
                    Model settings
                </h3>
                <div class="grid gap-3 sm:grid-cols-2">
                    <label class="block">
                        <span class="mb-1 block text-[12px] text-ss-text-2"
                            >Name</span
                        >
                        <input
                            v-model="draft.name"
                            type="text"
                            class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                        />
                    </label>
                    <label class="block">
                        <span class="mb-1 block text-[12px] text-ss-text-2"
                            >Tier</span
                        >
                        <input
                            v-model="draft.tier"
                            type="text"
                            class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                        />
                    </label>
                </div>
                <label class="block">
                    <span class="mb-1 block text-[12px] text-ss-text-2"
                        >OnlyFans account id</span
                    >
                    <input
                        v-model="draft.of_account_id"
                        type="text"
                        placeholder="acct_…"
                        class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 font-ss-mono text-sm text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
                    />
                </label>
                <label class="block">
                    <span class="mb-1 block text-[12px] text-ss-text-2"
                        >Persona prompt</span
                    >
                    <textarea
                        v-model="draft.prompt"
                        rows="5"
                        class="w-full resize-y rounded-lg border border-ss-border bg-ss-bg p-2.5 text-[13px] text-ss-text focus:border-ss-accent focus:outline-none"
                    />
                </label>
                <label class="block">
                    <span class="mb-1 block text-[12px] text-ss-text-2"
                        >Content library</span
                    >
                    <textarea
                        v-model="draft.content_library"
                        rows="4"
                        class="w-full resize-y rounded-lg border border-ss-border bg-ss-bg p-2.5 font-ss-mono text-[12px] text-ss-text focus:border-ss-accent focus:outline-none"
                    />
                </label>
                <label class="block">
                    <span class="mb-1 block text-[12px] text-ss-text-2"
                        >Learned rules</span
                    >
                    <textarea
                        v-model="draft.feedback_rules"
                        rows="3"
                        class="w-full resize-y rounded-lg border border-ss-border bg-ss-bg p-2.5 text-[12px] text-ss-text focus:border-ss-accent focus:outline-none"
                    />
                </label>
                <button
                    type="button"
                    class="rounded-lg bg-ss-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                    :disabled="savingSettings"
                    @click="saveSettings"
                >
                    {{ savingSettings ? 'Saving…' : 'Save settings' }}
                </button>
            </div>

            <div
                class="space-y-3 rounded-xl border border-ss-border bg-ss-surface p-5"
            >
                <h3
                    class="flex items-center gap-1.5 text-base font-semibold text-ss-text"
                >
                    <Users :size="16" /> Chatter assignments
                </h3>
                <p class="text-[12px] text-ss-text-3">
                    Chatters assigned here can open this creator's
                    conversations.
                </p>
                <div class="flex flex-wrap gap-1.5">
                    <button
                        v-for="c in chatters"
                        :key="c.id"
                        type="button"
                        class="rounded-md border px-2.5 py-1 text-[12px] transition-colors"
                        :class="
                            draft.assigned.includes(c.id)
                                ? 'border-ss-accent bg-ss-accent-soft text-ss-accent-text'
                                : 'border-ss-border text-ss-text-3 hover:text-ss-text'
                        "
                        @click="toggleAssign(c.id)"
                    >
                        {{ c.name }}
                    </button>
                    <p
                        v-if="!chatters.length"
                        class="text-[12px] text-ss-text-3"
                    >
                        No chatters or managers to assign.
                    </p>
                </div>
                <button
                    type="button"
                    class="rounded-lg border border-ss-border px-4 py-2 text-[13px] font-medium text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-50"
                    :disabled="savingAssign"
                    @click="saveAssignments"
                >
                    {{ savingAssign ? 'Saving…' : 'Save assignments' }}
                </button>
            </div>
        </div>

        <!-- Live OnlyFans data -->
        <div
            v-if="connected"
            class="flex flex-col overflow-hidden rounded-xl border border-ss-border sm:flex-row"
        >
            <!-- left sidebar nav -->
            <nav
                class="flex shrink-0 gap-1 border-b border-ss-border bg-ss-surface p-2 sm:w-48 sm:flex-col sm:border-r sm:border-b-0"
            >
                <button
                    v-for="t in TABS"
                    :key="t.key"
                    type="button"
                    class="flex flex-1 items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors sm:flex-none"
                    :class="
                        tab === t.key
                            ? 'bg-ss-accent-soft font-semibold text-ss-accent-text'
                            : 'font-medium text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text-2'
                    "
                    @click="openTab(t.key)"
                >
                    <component :is="t.icon" :size="15" class="shrink-0" />
                    <span class="truncate">{{ t.label }}</span>
                </button>
            </nav>
            <div class="min-h-[420px] min-w-0 flex-1 bg-ss-bg/40 p-4">
                <SsModelFans
                    v-if="visited.has('fans')"
                    v-show="tab === 'fans'"
                    :model-id="model.id"
                />
                <SsModelSettings
                    v-if="visited.has('settings')"
                    v-show="tab === 'settings'"
                    :model-id="model.id"
                />
                <SsModelWelcome
                    v-if="visited.has('welcome')"
                    v-show="tab === 'welcome'"
                    :model-id="model.id"
                />
                <SsModelNotifications
                    v-if="visited.has('notifications')"
                    v-show="tab === 'notifications'"
                    :model-id="model.id"
                />
                <SsModelUsers
                    v-if="visited.has('users')"
                    v-show="tab === 'users'"
                    :model-id="model.id"
                />
                <SsModelLinks
                    v-if="visited.has('links')"
                    v-show="tab === 'links'"
                    :model-id="model.id"
                />
                <SsModelPromotions
                    v-if="visited.has('promotions')"
                    v-show="tab === 'promotions'"
                    :model-id="model.id"
                />
            </div>
        </div>
    </div>
</template>
