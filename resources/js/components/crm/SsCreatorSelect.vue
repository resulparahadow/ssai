<script setup lang="ts">
import { usePage } from '@inertiajs/vue3';
import { Check, ChevronsUpDown, Search, Users } from '@lucide/vue';
import { onClickOutside } from '@vueuse/core';
import { computed, nextTick, ref } from 'vue';
import { useCreatorContext } from '@/composables/useCreatorContext';
import { useCrmShell } from '@/composables/useCrmShell';
import { can } from '@/crm/nav';
import type { Role } from '@/types/auth';
import type { SidebarCreator } from '@/types/crm';

const props = defineProps<{ role: Role }>();
const page = usePage();
const { collapsed } = useCrmShell();
const { selectedId, isAll, select } = useCreatorContext();

const creators = computed<SidebarCreator[]>(
    () => (page.props.creators as SidebarCreator[]) ?? [],
);
// Only managers/admins get the aggregate "All creators" option (matches the server default).
const canSeeAll = computed(() => can(props.role, 'manageTeam'));

const selectedCreator = computed<SidebarCreator | null>(
    () => creators.value.find((c) => c.id === selectedId.value) ?? null,
);

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

const open = ref(false);
const query = ref('');
const rootRef = ref<HTMLElement | null>(null);
const searchRef = ref<HTMLInputElement | null>(null);
onClickOutside(rootRef, () => (open.value = false));

const filtered = computed<SidebarCreator[]>(() => {
    const q = query.value.trim().toLowerCase();

    return q
        ? creators.value.filter((c) => c.name.toLowerCase().includes(q))
        : creators.value;
});

function toggle(): void {
    open.value = !open.value;

    if (open.value) {
        query.value = '';
        void nextTick(() => searchRef.value?.focus());
    }
}

function pick(value: number | 'all'): void {
    select(value);
    open.value = false;
    query.value = '';
}
</script>

<template>
    <div ref="rootRef" class="relative px-2 pt-1 pb-2">
        <!-- Trigger -->
        <button
            type="button"
            class="flex w-full items-center gap-2.5 rounded-lg border border-ss-border bg-ss-surface-2 px-2 py-2 text-left transition-colors hover:border-ss-accent/40"
            :class="collapsed ? 'justify-center' : ''"
            :title="
                isAll
                    ? 'All creators'
                    : (selectedCreator?.name ?? 'Select a creator')
            "
            @click="toggle"
        >
            <!-- Avatar -->
            <span
                v-if="isAll"
                class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ss-accent-soft text-ss-accent-text"
            >
                <Users :size="16" />
            </span>
            <span
                v-else-if="selectedCreator"
                class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ss-accent-soft text-[11px] font-semibold text-ss-accent-text"
            >
                {{ initials(selectedCreator.name) }}
            </span>
            <span
                v-else
                class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ss-surface text-ss-text-3"
            >
                <Users :size="16" />
            </span>

            <template v-if="!collapsed">
                <span class="min-w-0 flex-1 leading-tight">
                    <span
                        class="block truncate text-[13px] font-semibold text-ss-text"
                    >
                        {{
                            isAll
                                ? 'All creators'
                                : (selectedCreator?.name ?? 'Select a creator')
                        }}
                    </span>
                    <span
                        class="flex items-center gap-1.5 text-[11px] text-ss-text-3"
                    >
                        <template v-if="isAll">Agency-wide</template>
                        <template v-else-if="selectedCreator">
                            <span
                                class="h-1.5 w-1.5 rounded-full"
                                :class="
                                    selectedCreator.hasOf
                                        ? 'bg-ss-pos'
                                        : 'bg-ss-text-3'
                                "
                            />
                            {{
                                selectedCreator.hasOf
                                    ? 'Connected'
                                    : 'No OnlyFans'
                            }}
                        </template>
                        <template v-else>Creator context</template>
                    </span>
                </span>
                <ChevronsUpDown :size="15" class="shrink-0 text-ss-text-3" />
            </template>
        </button>

        <!-- Popover -->
        <div
            v-if="open"
            class="absolute z-30 rounded-xl border border-ss-border bg-ss-surface p-1.5 shadow-xl"
            :class="
                collapsed
                    ? 'top-1 left-full ml-2 w-60'
                    : 'top-full right-2 left-2 mt-1'
            "
        >
            <!-- Search -->
            <div class="relative mb-1">
                <Search
                    :size="14"
                    class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ss-text-3"
                />
                <input
                    ref="searchRef"
                    v-model="query"
                    type="text"
                    placeholder="Search creators…"
                    class="w-full rounded-lg border border-ss-border bg-ss-surface-2 py-1.5 pr-2 pl-8 text-[13px] text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
                />
            </div>

            <div class="max-h-72 space-y-0.5 overflow-y-auto">
                <!-- All creators (manager/admin only) -->
                <button
                    v-if="canSeeAll && !query.trim()"
                    type="button"
                    class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors"
                    :class="
                        isAll
                            ? 'bg-ss-accent-soft text-ss-accent-text'
                            : 'text-ss-text-2 hover:bg-ss-surface-2'
                    "
                    @click="pick('all')"
                >
                    <span
                        class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ss-surface-2"
                    >
                        <Users :size="14" />
                    </span>
                    <span class="flex-1 truncate text-[13px] font-medium"
                        >All creators</span
                    >
                    <Check v-if="isAll" :size="15" class="shrink-0" />
                </button>

                <!-- Creators -->
                <button
                    v-for="c in filtered"
                    :key="c.id"
                    type="button"
                    class="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors"
                    :class="
                        selectedId === c.id
                            ? 'bg-ss-accent-soft text-ss-accent-text'
                            : 'text-ss-text-2 hover:bg-ss-surface-2'
                    "
                    @click="pick(c.id)"
                >
                    <span
                        class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-ss-accent-soft text-[10px] font-semibold text-ss-accent-text"
                    >
                        {{ initials(c.name) }}
                    </span>
                    <span class="flex min-w-0 flex-1 items-center gap-1.5">
                        <span
                            class="h-1.5 w-1.5 shrink-0 rounded-full"
                            :class="c.hasOf ? 'bg-ss-pos' : 'bg-ss-text-3'"
                            :title="
                                c.hasOf
                                    ? 'OnlyFans connected'
                                    : 'No OnlyFans account set'
                            "
                        />
                        <span class="truncate text-[13px] font-medium">{{
                            c.name
                        }}</span>
                    </span>
                    <Check
                        v-if="selectedId === c.id"
                        :size="15"
                        class="shrink-0"
                    />
                </button>

                <p
                    v-if="!creators.length"
                    class="px-2 py-2 text-[12px] text-ss-text-3"
                >
                    No creators assigned.
                </p>
                <p
                    v-else-if="!filtered.length"
                    class="px-2 py-2 text-[12px] text-ss-text-3"
                >
                    No matches.
                </p>
            </div>
        </div>
    </div>
</template>
