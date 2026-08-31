<script setup lang="ts">
import { Head, usePage } from '@inertiajs/vue3';
import { Images, RefreshCw, Users } from '@lucide/vue';
import { computed, ref } from 'vue';
import SsCreatorPrompt from '@/components/crm/SsCreatorPrompt.vue';
import SsVaultGrid from '@/components/crm/vault/SsVaultGrid.vue';
import SsVaultRail from '@/components/crm/vault/SsVaultRail.vue';
import { useCreatorContext } from '@/composables/useCreatorContext';
import { can } from '@/crm/nav';
import type { Role } from '@/types/auth';
import type { OfVaultList, SidebarCreator } from '@/types/crm';

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

// The open list (left rail selection); null = the whole vault.
const openList = ref<OfVaultList | null>(null);
const openListId = computed(() => openList.value?.id ?? null);
const openListName = computed(() => openList.value?.name ?? 'All media');

// Bumped by Refresh; the children watch it and reload.
const reloadNonce = ref(0);
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

        <!-- Lists on the left, that list's media on the right. -->
        <div v-else class="flex min-h-0 flex-1">
            <SsVaultRail
                class="w-72 shrink-0"
                :model-id="model.id"
                :can-manage="canManage"
                :reload="reloadNonce"
                :selected-id="openListId"
                @select="openList = $event"
            />
            <SsVaultGrid
                class="min-w-0 flex-1"
                :model-id="model.id"
                :can-manage="canManage"
                :reload="reloadNonce"
                :list-id="openListId"
                :list-name="openListName"
            />
        </div>
    </div>
</template>
