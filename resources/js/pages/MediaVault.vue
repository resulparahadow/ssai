<script setup lang="ts">
import { Head, usePage } from '@inertiajs/vue3';
import { FolderOpen, Images, RefreshCw, Users } from '@lucide/vue';
import { computed, ref } from 'vue';
import SsCreatorPrompt from '@/components/crm/SsCreatorPrompt.vue';
import SsVaultGrid from '@/components/crm/vault/SsVaultGrid.vue';
import SsVaultLists from '@/components/crm/vault/SsVaultLists.vue';
import { useCreatorContext } from '@/composables/useCreatorContext';
import { can } from '@/crm/nav';
import type { Role } from '@/types/auth';
import type { SidebarCreator } from '@/types/crm';

const page = usePage();
const { selectedId } = useCreatorContext();

const creators = computed<SidebarCreator[]>(
    () => (page.props.creators as SidebarCreator[]) ?? [],
);
// The globally-selected creator (from the sidebar). Null when "All creators" is active or none
// is set — the view then prompts to pick one.
const model = computed<SidebarCreator | null>(
    () => creators.value.find((c) => c.id === selectedId.value) ?? null,
);

// UI-only role gate — the server's `can:manage-team` on the delete routes is the real bar.
const role = computed<Role>(
    () =>
        (page.props.auth as { user?: { role?: Role } })?.user?.role ??
        'chatter',
);
const canManage = computed(() => can(role.value, 'manageTeam'));

const tab = ref<'media' | 'lists'>('media');
// Bumped by Refresh; the children watch it and reload.
const reloadNonce = ref(0);

const TABS = [
    { key: 'media', label: 'All media', icon: Images },
    { key: 'lists', label: 'Lists', icon: FolderOpen },
] as const;
</script>

<template>
    <Head title="Media Vault" />

    <div class="flex h-full flex-col font-ss">
        <!-- Header -->
        <div
            class="flex items-center gap-3 border-b border-ss-border px-5 py-3"
        >
            <Images :size="20" class="shrink-0 text-ss-accent-text" />
            <div class="min-w-0">
                <h1 class="truncate text-[15px] font-semibold text-ss-text">
                    Media Vault
                </h1>
                <p
                    v-if="model"
                    class="flex items-center gap-1.5 text-[12px] text-ss-text-3"
                >
                    <span
                        class="h-1.5 w-1.5 rounded-full"
                        :class="model.hasOf ? 'bg-ss-pos' : 'bg-ss-text-3'"
                    />
                    {{ model.name }}
                </p>
            </div>
            <span class="flex-1" />
            <button
                v-if="model && model.hasOf"
                type="button"
                class="grid h-8 w-8 place-items-center rounded-lg border border-ss-border text-ss-text-2 hover:bg-ss-surface-2"
                title="Refresh"
                @click="reloadNonce++"
            >
                <RefreshCw :size="15" />
            </button>
        </div>

        <SsCreatorPrompt
            v-if="!creators.length"
            class="flex-1"
            :icon="Users"
            title="No creators assigned"
            description="You don’t have any creator models assigned yet. Ask an admin to assign one to browse its vault."
        />
        <SsCreatorPrompt
            v-else-if="!model"
            class="flex-1"
            :icon="Images"
            title="Select a creator"
            description="Pick a creator model to open its media vault. The whole app follows whichever creator you choose."
            hint="Creator selector · top of the sidebar"
        />

        <div
            v-else-if="!model.hasOf"
            class="grid flex-1 place-items-center px-6 text-center text-[13px] text-ss-text-3"
        >
            {{ model.name }} has no OnlyFans account connected. Connect one in
            Creator Models to manage its vault.
        </div>

        <template v-else>
            <!-- Sub-switch: All media / Lists -->
            <div class="flex gap-1 border-b border-ss-border px-5 py-2">
                <button
                    v-for="t in TABS"
                    :key="t.key"
                    type="button"
                    class="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-semibold transition-colors"
                    :class="
                        tab === t.key
                            ? 'bg-ss-accent-soft text-ss-accent-text'
                            : 'text-ss-text-2 hover:bg-ss-surface-2'
                    "
                    @click="tab = t.key"
                >
                    <component :is="t.icon" :size="15" />
                    {{ t.label }}
                </button>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto">
                <SsVaultGrid
                    v-show="tab === 'media'"
                    :model-id="model.id"
                    :can-manage="canManage"
                    :reload="reloadNonce"
                />
                <SsVaultLists
                    v-show="tab === 'lists'"
                    :model-id="model.id"
                    :can-manage="canManage"
                    :reload="reloadNonce"
                />
            </div>
        </template>
    </div>
</template>
