<script setup lang="ts">
import { Head, Link, router, usePage } from '@inertiajs/vue3';
import { AlertCircle, Plus, RefreshCw } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import SsCreatorRow from '@/components/crm/models/SsCreatorRow.vue';
import { ofModel } from '@/lib/onlyfansModel';
import type {
    ChatterOption,
    CreatorModel,
    OfConnectedAccount,
    OfProviderStatus,
} from '@/types/crm';

/**
 * Creator Models, grouped by provider. Each creator appears once: as the OnlyFans account a
 * provider lists (with the creator model wired to it, or an Add button when there is none),
 * or — for models no provider lists — in "Not linked". The two providers give the same
 * creator DIFFERENT account ids, so an account is matched to a model only within its own
 * provider's list; only the active provider's creators load in Conversations.
 */
const props = defineProps<{
    models: CreatorModel[];
    chatters: ChatterOption[];
}>();

const page = usePage();
const isAdmin = computed(() => page.props.auth?.user?.role === 'admin');

// ---- Connected accounts (both providers, live, nothing persisted) -------------------------

const accounts = ref<OfConnectedAccount[]>([]);
const providers = ref<OfProviderStatus[]>([]);
const loading = ref(true);
const loadError = ref<string | null>(null);

async function loadAccounts() {
    loading.value = true;
    loadError.value = null;

    try {
        const res = await ofModel.accounts();
        accounts.value = res.accounts;
        providers.value = res.providers ?? [];
    } catch (e) {
        loadError.value =
            e instanceof Error
                ? e.message
                : 'Could not load connected accounts.';
    } finally {
        loading.value = false;
    }
}

onMounted(loadAccounts);

const activeProvider = computed(() => providers.value.find((p) => p.active));

const modelByAccount = computed(
    () =>
        new Map(
            props.models
                .filter((m) => m.of_account_id)
                .map((m) => [m.of_account_id as string, m]),
        ),
);

interface Row {
    key: string;
    account: OfConnectedAccount | null;
    model: CreatorModel | null;
    missing: boolean;
}

/** One section per provider with a key, the active one first. Set-up creators first. */
const sections = computed(() =>
    [...providers.value]
        .filter((p) => p.configured)
        .sort((a, b) => Number(b.active) - Number(a.active))
        .map((p) => {
            const rows: Row[] = accounts.value
                .filter((a) => a.provider === p.key)
                .map((a) => ({
                    key: `${p.key}:${a.id}`,
                    account: a,
                    model: modelByAccount.value.get(a.id) ?? null,
                    missing: false,
                }))
                .sort(
                    (a, b) =>
                        Number(!a.model) - Number(!b.model) ||
                        (a.model?.name ?? a.account?.name ?? '').localeCompare(
                            b.model?.name ?? b.account?.name ?? '',
                        ),
                );

            return {
                provider: p,
                rows,
                toAdd: rows.filter((r) => !r.model).length,
            };
        }),
);

/** Models no provider lists: never connected, or their account id is in no list. */
const unlinked = computed<Row[]>(() => {
    const listed = new Set(accounts.value.map((a) => a.id));

    // No provider loaded: still list every model, so the page stays usable.
    if (loadError.value) {
        return props.models.map((m) => ({
            key: `model:${m.id}`,
            account: null,
            model: m,
            missing: false,
        }));
    }

    return props.models
        .filter((m) => !m.of_account_id || !listed.has(m.of_account_id))
        .map((m) => ({
            key: `model:${m.id}`,
            account: null,
            model: m,
            missing: !!m.of_account_id,
        }));
});

const someProviderFailed = computed(() =>
    providers.value.some((p) => p.configured && p.error),
);

// ---- Actions ------------------------------------------------------------------------------

const newName = ref('');
const creating = ref(false);
const adding = ref<string | null>(null);
const addError = ref<string | null>(null);

function chatterNames(m: CreatorModel | null): string[] {
    return (m?.assigned ?? []).map(
        (id) => props.chatters.find((c) => c.id === id)?.name ?? `#${id}`,
    );
}

function createModel() {
    const name = newName.value.trim();

    if (!name) {
        return;
    }

    creating.value = true;
    router.post(
        '/models',
        { name },
        {
            preserveScroll: true,
            onSuccess: () => {
                newName.value = '';
            },
            onFinish: () => {
                creating.value = false;
            },
        },
    );
}

/** The server re-checks the id against that provider's live list and names the model. */
function addAccount(row: Row) {
    if (!row.account) {
        return;
    }

    adding.value = row.key;
    addError.value = null;

    router.post(
        '/models/from-account',
        { of_account_id: row.account.id, provider: row.account.provider },
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

function destroy(m: CreatorModel) {
    if (
        !confirm(`Delete ${m.name}? This also removes its chatter assignments.`)
    ) {
        return;
    }

    router.delete(`/models/${m.id}`, { preserveScroll: true });
}
</script>

<template>
    <Head title="Creator Models" />

    <div class="mx-auto max-w-5xl space-y-6">
        <!-- Header -->
        <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
                <h2 class="text-xl font-bold text-ss-text">Creator Models</h2>
                <p class="text-sm text-ss-text-2">
                    Every creator, grouped by the provider their OnlyFans
                    account is connected through.
                </p>
            </div>
            <form
                class="flex w-full items-center gap-2 sm:w-auto"
                @submit.prevent="createModel"
            >
                <label for="new-model" class="sr-only">New model name</label>
                <input
                    id="new-model"
                    v-model="newName"
                    type="text"
                    placeholder="New model name"
                    class="h-9 min-w-0 flex-1 rounded-lg border border-ss-border bg-ss-surface px-3 text-sm text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none sm:w-48 sm:flex-none"
                />
                <button
                    type="submit"
                    class="flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-ss-accent px-3 text-sm font-semibold text-white disabled:opacity-50"
                    :disabled="!newName.trim() || creating"
                >
                    <Plus :size="15" /> Add model
                </button>
            </form>
        </div>

        <!-- Which provider chats run through -->
        <div
            class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ss-border bg-ss-surface px-4 py-3 sm:px-5"
        >
            <p class="text-[13px] text-ss-text-2">
                <template v-if="loading">Checking providers…</template>
                <template v-else-if="activeProvider">
                    Chats run through
                    <span class="font-semibold text-ss-text">{{
                        activeProvider.label
                    }}</span
                    >. Only creators listed under it load in Conversations.
                    <Link
                        v-if="isAdmin"
                        href="/settings/integrations"
                        class="font-medium whitespace-nowrap text-ss-accent-text underline-offset-2 hover:underline"
                        >Change provider</Link
                    >
                </template>
                <template v-else>Couldn't check the providers.</template>
            </p>
            <button
                type="button"
                class="flex items-center gap-1.5 rounded-lg border border-ss-border px-2.5 py-1.5 text-[12px] font-medium text-ss-text-2 transition-colors hover:border-ss-accent hover:text-ss-accent-text disabled:opacity-50"
                :disabled="loading"
                @click="loadAccounts"
            >
                <RefreshCw :size="13" :class="loading && 'animate-spin'" />
                Refresh accounts
            </button>
        </div>

        <p
            v-if="addError"
            role="alert"
            class="flex items-start gap-2 rounded-xl border border-ss-neg/30 bg-ss-neg/5 px-4 py-3 text-[13px] text-ss-neg"
        >
            <AlertCircle :size="15" class="mt-px shrink-0" />
            {{ addError }}
        </p>

        <!-- Loading -->
        <section
            v-if="loading"
            class="overflow-hidden rounded-xl border border-ss-border bg-ss-surface"
            aria-busy="true"
        >
            <div class="border-b border-ss-border bg-ss-surface-2 px-5 py-3">
                <div class="h-3.5 w-28 animate-pulse rounded bg-ss-border" />
            </div>
            <div
                v-for="i in 4"
                :key="i"
                class="flex items-center gap-3 border-b border-ss-border px-5 py-3.5 last:border-b-0"
            >
                <div
                    class="h-9 w-9 animate-pulse rounded-full bg-ss-surface-2"
                />
                <div class="flex-1 space-y-1.5">
                    <div
                        class="h-3 w-36 animate-pulse rounded bg-ss-surface-2"
                    />
                    <div
                        class="h-2.5 w-24 animate-pulse rounded bg-ss-surface-2"
                    />
                </div>
            </div>
        </section>

        <template v-else>
            <!-- Couldn't load any provider -->
            <p
                v-if="loadError"
                role="alert"
                class="flex items-start gap-2 rounded-xl border border-ss-neg/30 bg-ss-neg/5 px-4 py-3 text-[13px] text-ss-neg"
            >
                <AlertCircle :size="15" class="mt-px shrink-0" />
                <span
                    >Couldn't load the connected accounts: {{ loadError }}
                    <button
                        type="button"
                        class="ml-1 font-semibold underline underline-offset-2"
                        @click="loadAccounts"
                    >
                        Try again
                    </button></span
                >
            </p>

            <!-- One section per provider -->
            <section
                v-for="s in sections"
                :key="s.provider.key"
                class="overflow-hidden rounded-xl border bg-ss-surface"
                :class="
                    s.provider.active
                        ? 'border-ss-accent/40'
                        : 'border-ss-border'
                "
                :aria-label="s.provider.label"
            >
                <header
                    class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-ss-border bg-ss-surface-2 px-4 py-3 sm:px-5"
                >
                    <div class="flex items-center gap-2">
                        <h3 class="text-[14px] font-semibold text-ss-text">
                            {{ s.provider.label }}
                        </h3>
                        <span
                            v-if="s.provider.active"
                            class="rounded-full bg-ss-accent px-2 py-0.5 text-[10px] font-semibold text-white"
                            >Active</span
                        >
                        <span
                            v-else
                            class="rounded-full border border-ss-border px-2 py-0.5 text-[10px] font-medium text-ss-text-3"
                            >Not active</span
                        >
                    </div>
                    <span class="text-[12px] text-ss-text-3 tabular-nums">
                        {{ s.rows.length }}
                        {{ s.rows.length === 1 ? 'account' : 'accounts' }}
                        <template v-if="s.toAdd">
                            · {{ s.toAdd }} not added</template
                        >
                    </span>
                    <p
                        v-if="!s.provider.active"
                        class="basis-full text-[12px] text-ss-text-3"
                    >
                        These creators won't load in Conversations while
                        {{ activeProvider?.label ?? 'another provider' }} is
                        active.
                    </p>
                </header>

                <p
                    v-if="s.provider.error"
                    class="flex items-start gap-2 px-5 py-4 text-[13px] text-ss-neg"
                >
                    <AlertCircle :size="15" class="mt-px shrink-0" />
                    Couldn't load {{ s.provider.label }}:
                    {{ s.provider.error }}
                </p>

                <p
                    v-else-if="!s.rows.length"
                    class="px-5 py-5 text-[13px] text-ss-text-3"
                >
                    No OnlyFans accounts are connected in
                    {{ s.provider.label }} yet.
                </p>

                <ul v-else class="@container divide-y divide-ss-border">
                    <SsCreatorRow
                        v-for="r in s.rows"
                        :key="r.key"
                        :account="r.account"
                        :model="r.model"
                        :chatter-names="chatterNames(r.model)"
                        :adding="adding === r.key"
                        :add-disabled="adding !== null"
                        @add="addAccount(r)"
                        @delete="r.model && destroy(r.model)"
                    />
                </ul>
            </section>

            <!-- Models no provider lists -->
            <section
                v-if="unlinked.length"
                class="overflow-hidden rounded-xl border border-ss-border bg-ss-surface"
                :aria-label="
                    loadError
                        ? 'All creator models'
                        : 'Not linked to a provider'
                "
            >
                <header
                    class="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-ss-border bg-ss-surface-2 px-4 py-3 sm:px-5"
                >
                    <h3 class="text-[14px] font-semibold text-ss-text">
                        {{
                            loadError
                                ? 'All creator models'
                                : 'Not linked to a provider'
                        }}
                    </h3>
                    <span class="text-[12px] text-ss-text-3 tabular-nums">
                        {{ unlinked.length }}
                        {{ unlinked.length === 1 ? 'model' : 'models' }}
                    </span>
                    <p
                        v-if="!loadError"
                        class="basis-full text-[12px] text-ss-text-3"
                    >
                        These don't appear anywhere else in SSAI (creator
                        selector, Conversations, dashboards). Open one and set
                        its OnlyFans account, or add the creator from a provider
                        above.
                        <template v-if="someProviderFailed">
                            A provider failed to load, so some may belong to
                            it.</template
                        >
                    </p>
                </header>
                <ul class="@container divide-y divide-ss-border">
                    <SsCreatorRow
                        v-for="r in unlinked"
                        :key="r.key"
                        :model="r.model"
                        :missing="r.missing"
                        :chatter-names="chatterNames(r.model)"
                        @delete="r.model && destroy(r.model)"
                    />
                </ul>
            </section>

            <p
                v-if="!sections.length && !unlinked.length"
                class="rounded-xl border border-ss-border bg-ss-surface p-8 text-center text-[13px] text-ss-text-3"
            >
                No creators yet. Connect an OnlyFans account in a provider, or
                add a model above.
            </p>
        </template>
    </div>
</template>
