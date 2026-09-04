<script setup lang="ts">
import { Link, router } from '@inertiajs/vue3';
import { AlertCircle, Check, LoaderCircle, Plus, RefreshCw } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import { ofModel } from '@/lib/onlyfansModel';
import type { CreatorModel, OfConnectedAccount } from '@/types/crm';

/**
 * The OnlyFans accounts connected to the agency's OnlyFansAPI key, listed on the Creator
 * Models page. Clicking an account brings it INTO the system — the server creates an
 * `aich_models` row named after the account with its `of_account_id` already wired up, then
 * sends the manager to that model's page to fill in persona, tier and assignments.
 *
 * Accounts already in the system stay listed but show which model owns them, so the panel
 * answers "what have we connected, and what is still missing?" in one place.
 *
 * Live and unpersisted: this reflects OnlyFansAPI, never a local copy.
 */
const props = defineProps<{ models: CreatorModel[] }>();

const accounts = ref<OfConnectedAccount[]>([]);
const loading = ref(true);
const error = ref<string | null>(null);
const adding = ref<string | null>(null);
const addError = ref<string | null>(null);

/** The creator model already wired to an account id, if any. */
const modelFor = computed(() => {
    const byAccount = new Map<string, CreatorModel>();

    for (const m of props.models) {
        if (m.of_account_id) {
            byAccount.set(m.of_account_id, m);
        }
    }

    return byAccount;
});

/** Accounts still missing a creator model come first — they're the actionable ones. */
const sorted = computed(() =>
    [...accounts.value].sort((a, b) => {
        const aHas = modelFor.value.has(a.id) ? 1 : 0;
        const bHas = modelFor.value.has(b.id) ? 1 : 0;

        return aHas - bHas || a.name.localeCompare(b.name);
    }),
);

const unlinkedCount = computed(
    () => accounts.value.filter((a) => !modelFor.value.has(a.id)).length,
);

async function load() {
    loading.value = true;
    error.value = null;

    try {
        accounts.value = (await ofModel.accounts()).accounts;
    } catch (e) {
        error.value =
            e instanceof Error
                ? e.message
                : 'Could not load connected accounts.';
    } finally {
        loading.value = false;
    }
}

/**
 * Hand the account id to the server, which re-checks it against the live list and names the
 * model itself — the redirect lands on the new model so the other fields can be set.
 */
function add(account: OfConnectedAccount) {
    adding.value = account.id;
    addError.value = null;

    router.post(
        '/models/from-account',
        { of_account_id: account.id },
        {
            preserveScroll: true,
            onError: (errors) => {
                addError.value =
                    errors.of_account_id ?? 'Could not add that account.';
            },
            onFinish: () => {
                adding.value = null;
            },
        },
    );
}

onMounted(load);
</script>

<template>
    <section class="rounded-xl border border-ss-border bg-ss-surface">
        <header
            class="flex flex-wrap items-center justify-between gap-2 border-b border-ss-border px-5 py-3.5"
        >
            <div>
                <h3 class="text-[15px] font-semibold text-ss-text">
                    Connected OnlyFans accounts
                </h3>
                <p class="text-[12px] text-ss-text-3">
                    <template v-if="loading"
                        >Loading from OnlyFansAPI…</template
                    >
                    <template v-else-if="error"
                        >Couldn't load accounts.</template
                    >
                    <template v-else-if="!accounts.length">
                        No accounts are connected to this OnlyFansAPI key yet.
                    </template>
                    <template v-else-if="unlinkedCount">
                        {{ unlinkedCount }} of {{ accounts.length }} not yet
                        added — click to bring one into the system.
                    </template>
                    <template v-else>
                        All {{ accounts.length }} accounts are set up as creator
                        models.
                    </template>
                </p>
            </div>
            <button
                type="button"
                class="flex items-center gap-1.5 rounded-lg border border-ss-border px-2.5 py-1.5 text-[12px] font-medium text-ss-text-2 transition-colors hover:border-ss-accent hover:text-ss-accent disabled:opacity-50"
                :disabled="loading"
                @click="load"
            >
                <RefreshCw :size="13" :class="loading && 'animate-spin'" />
                Refresh
            </button>
        </header>

        <p
            v-if="addError"
            class="flex items-start gap-1.5 border-b border-ss-border bg-ss-surface-2 px-5 py-2.5 text-[12px] text-ss-neg"
        >
            <AlertCircle :size="13" class="mt-px shrink-0" />
            {{ addError }}
        </p>

        <p
            v-if="loading"
            class="flex items-center gap-2 px-5 py-6 text-[13px] text-ss-text-3"
        >
            <LoaderCircle :size="14" class="animate-spin" />
            Loading connected accounts…
        </p>

        <p v-else-if="error" class="px-5 py-6 text-[13px] text-ss-neg">
            {{ error }}
        </p>

        <p
            v-else-if="!accounts.length"
            class="px-5 py-6 text-[13px] text-ss-text-3"
        >
            Connect a creator's account in OnlyFansAPI and it will appear here.
        </p>

        <ul v-else class="divide-y divide-ss-border">
            <li
                v-for="a in sorted"
                :key="a.id"
                class="flex flex-wrap items-center gap-3 px-5 py-3"
            >
                <img
                    v-if="a.avatar"
                    :src="a.avatar"
                    alt=""
                    class="h-9 w-9 shrink-0 rounded-full object-cover"
                />
                <span
                    v-else
                    class="h-9 w-9 shrink-0 rounded-full bg-ss-surface-2"
                />

                <div class="min-w-0 flex-1">
                    <div class="flex items-center gap-2">
                        <span
                            class="truncate text-[13px] font-medium text-ss-text"
                            >{{ a.name }}</span
                        >
                        <span
                            v-if="!a.isAuthenticated"
                            class="shrink-0 rounded-full bg-ss-surface-2 px-1.5 py-0.5 text-[10px] font-medium text-ss-neg"
                            >Needs re-auth</span
                        >
                    </div>
                    <div
                        class="flex flex-wrap items-center gap-x-2 text-[11px] text-ss-text-3"
                    >
                        <span class="truncate">@{{ a.username }}</span>
                        <span v-if="a.subscribersCount !== null"
                            >· {{ a.subscribersCount }} subscribers</span
                        >
                    </div>
                </div>

                <Link
                    v-if="modelFor.get(a.id)"
                    :href="`/models/${modelFor.get(a.id)?.id}`"
                    class="flex shrink-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-medium text-ss-text-3 transition-colors hover:bg-ss-surface-2 hover:text-ss-accent"
                >
                    <Check :size="13" class="text-ss-pos" />
                    {{ modelFor.get(a.id)?.name }}
                </Link>
                <button
                    v-else
                    type="button"
                    class="flex shrink-0 items-center gap-1.5 rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                    :disabled="adding !== null"
                    @click="add(a)"
                >
                    <LoaderCircle
                        v-if="adding === a.id"
                        :size="13"
                        class="animate-spin"
                    />
                    <Plus v-else :size="13" />
                    {{ adding === a.id ? 'Adding…' : 'Add as creator model' }}
                </button>
            </li>
        </ul>
    </section>
</template>
