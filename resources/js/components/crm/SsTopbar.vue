<script setup lang="ts">
import { Link, router } from '@inertiajs/vue3';
import {
    Bell,
    ChevronDown,
    LogOut,
    Moon,
    PanelLeft,
    Settings,
    Sun,
} from '@lucide/vue';
import { onClickOutside } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useAppearance } from '@/composables/useAppearance';
import { useCrmShell } from '@/composables/useCrmShell';
import { logout } from '@/routes';
import { edit as profileEdit } from '@/routes/profile';
import type { User } from '@/types/auth';

const props = defineProps<{ title: string; user: User }>();

const { toggleSidebar } = useCrmShell();
const { resolvedAppearance, updateAppearance } = useAppearance();

function toggleTheme(): void {
    updateAppearance(resolvedAppearance.value === 'dark' ? 'light' : 'dark');
}

const initials = computed(() =>
    props.user.name
        .split(' ')
        .map((w) => w[0])
        .slice(0, 2)
        .join('')
        .toUpperCase(),
);

const roleLabel = computed(
    () => props.user.role.charAt(0).toUpperCase() + props.user.role.slice(1),
);

// ---- Profile dropdown -------------------------------------------------------
const profileOpen = ref(false);
const profileRef = ref<HTMLElement | null>(null);
onClickOutside(profileRef, () => (profileOpen.value = false));

function handleLogout(): void {
    profileOpen.value = false;
    router.flushAll();
}
</script>

<template>
    <header
        class="flex h-14 shrink-0 items-center gap-3 border-b border-ss-border bg-ss-surface px-4"
    >
        <button
            type="button"
            class="grid h-8 w-8 place-items-center rounded-lg text-ss-text-2 hover:bg-ss-surface-2"
            @click="toggleSidebar"
        >
            <PanelLeft :size="18" />
        </button>

        <h1 class="text-sm font-semibold text-ss-text">{{ title }}</h1>

        <div class="ml-auto flex items-center gap-1.5">
            <!-- Signals — coming soon -->
            <button
                type="button"
                disabled
                class="grid h-9 w-9 cursor-not-allowed place-items-center rounded-lg text-ss-text-3 opacity-60"
                title="Notifications — coming soon"
            >
                <Bell :size="18" />
            </button>

            <!-- Theme -->
            <button
                type="button"
                class="grid h-9 w-9 place-items-center rounded-lg text-ss-text-2 hover:bg-ss-surface-2"
                title="Toggle theme"
                @click="toggleTheme"
            >
                <component
                    :is="resolvedAppearance === 'dark' ? Sun : Moon"
                    :size="18"
                />
            </button>

            <!-- Role / user -->
            <div ref="profileRef" class="relative">
                <button
                    type="button"
                    class="flex items-center gap-2 rounded-lg py-1 pr-2 pl-1 hover:bg-ss-surface-2"
                    @click="profileOpen = !profileOpen"
                >
                    <span
                        class="grid h-8 w-8 place-items-center rounded-lg bg-ss-accent-soft text-[11px] font-semibold text-ss-accent-text"
                    >
                        {{ initials }}
                    </span>
                    <span class="hidden text-left leading-tight sm:block">
                        <span
                            class="block text-[13px] font-medium text-ss-text"
                            >{{ user.name }}</span
                        >
                        <span class="block text-[11px] text-ss-text-3">{{
                            roleLabel
                        }}</span>
                    </span>
                    <ChevronDown
                        :size="15"
                        class="text-ss-text-3 transition-transform"
                        :class="{ 'rotate-180': profileOpen }"
                    />
                </button>
                <div
                    v-if="profileOpen"
                    class="absolute right-0 z-20 mt-1 w-56 rounded-xl border border-ss-border bg-ss-surface p-2 shadow-xl"
                >
                    <div class="px-2 py-1.5">
                        <span class="block text-[13px] font-medium text-ss-text">{{
                            user.name
                        }}</span>
                        <span class="block truncate text-[11px] text-ss-text-3">{{
                            user.email
                        }}</span>
                    </div>
                    <div class="my-1 border-t border-ss-border" />
                    <Link
                        :href="profileEdit()"
                        class="flex items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] text-ss-text hover:bg-ss-surface-2"
                        @click="profileOpen = false"
                    >
                        <Settings :size="16" class="text-ss-text-2" />
                        Settings
                    </Link>
                    <Link
                        :href="logout()"
                        as="button"
                        class="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-[13px] text-ss-neg hover:bg-ss-surface-2"
                        data-test="logout-button"
                        @click="handleLogout"
                    >
                        <LogOut :size="16" />
                        Log out
                    </Link>
                </div>
            </div>
        </div>
    </header>
</template>
