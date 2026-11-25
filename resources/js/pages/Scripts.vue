<script setup lang="ts">
import { Head, usePage } from '@inertiajs/vue3';
import { ScrollText, Users } from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import SsScriptsManager from '@/components/crm/scripts/SsScriptsManager.vue';
import SsCreatorPrompt from '@/components/crm/SsCreatorPrompt.vue';
import { useCreatorContext } from '@/composables/useCreatorContext';
import type { SidebarCreator } from '@/types/crm';

/**
 * Scripts management (manager/admin; the route is `can:manage-team`) — CreatorHero's Creator
 * Settings → Scripts. A thin shell like Media Vault: the creator comes from the app-wide
 * creator context, and the manager below fetches and writes `onlyfans/{model}/scripts…`.
 * Scripts live in our DB, so a creator without an OnlyFans account can still be managed
 * (only the step editor's media picker needs the account).
 */

// The creator selection lives in localStorage, which SSR can't read — render a neutral
// placeholder until mounted so server and client agree (see MediaVault.vue).
const hydrated = ref(false);
onMounted(() => (hydrated.value = true));

const page = usePage();
const { selectedId } = useCreatorContext();

const creators = computed<SidebarCreator[]>(
    () => (page.props.creators as SidebarCreator[]) ?? [],
);
const model = computed<SidebarCreator | null>(
    () => creators.value.find((c) => c.id === selectedId.value) ?? null,
);
</script>

<template>
    <Head title="Scripts" />

    <div class="flex h-full flex-col font-ss">
        <div
            class="flex items-center gap-3 border-b border-ss-border px-5 py-3"
        >
            <ScrollText :size="20" class="shrink-0 text-ss-accent-text" />
            <div class="min-w-0">
                <h1 class="truncate text-[15px] font-semibold text-ss-text">
                    Scripts
                </h1>
                <p class="truncate text-[12px] text-ss-text-3">
                    <template v-if="hydrated && model"
                        >{{ model.name }} ·
                    </template>
                    Folders of ordered scripts (messages) chatters work through,
                    fan by fan.
                </p>
            </div>
        </div>

        <div v-if="!hydrated" class="h-full" />
        <SsCreatorPrompt
            v-else-if="!creators.length"
            class="flex-1"
            :icon="Users"
            title="No creators assigned"
            description="You don’t have any creator models assigned yet. Ask an admin to assign one to manage its scripts."
        />
        <SsCreatorPrompt
            v-else-if="!model"
            class="flex-1"
            :icon="ScrollText"
            title="Select a creator"
            description="Pick a creator model to manage its scripts. The whole app follows whichever creator you choose."
            hint="Creator selector · top of the sidebar"
        />
        <SsScriptsManager
            v-else
            :key="model.id"
            class="min-h-0 flex-1"
            :model-id="model.id"
            :model-name="model.name"
        />
    </div>
</template>
