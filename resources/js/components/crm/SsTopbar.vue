<script setup lang="ts">
import {
    Bell,
    ChevronDown,
    Clock,
    Flame,
    Moon,
    PanelLeft,
    Search,
    Star,
    Sun,
    TriangleAlert,
} from '@lucide/vue';
import { onClickOutside } from '@vueuse/core';
import { computed, ref } from 'vue';
import { useAppearance } from '@/composables/useAppearance';
import { useCrmShell } from '@/composables/useCrmShell';
import { ssColor } from '@/crm/nav';
import type { Role, User } from '@/types/auth';

const props = defineProps<{ title: string; user: User; effectiveRole: Role }>();

const { toggleSidebar, setPreviewRole } = useCrmShell();
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

// ---- Signals dropdown (illustrative; live wiring is a later phase) ----------
const signalsOpen = ref(false);
const signalsRef = ref<HTMLElement | null>(null);
onClickOutside(signalsRef, () => (signalsOpen.value = false));

const signals = [
    {
        type: 'VIP online',
        text: 'Devin (VIP · $418 lifetime) is online now.',
        time: '2m',
        icon: Star,
        color: 'accent',
    },
    {
        type: 'High potential',
        text: 'Marcus is showing strong buying signals.',
        time: '8m',
        icon: Flame,
        color: 'pos',
    },
    {
        type: 'SLA breach',
        text: 'Theo has waited 6m — over the 3m target.',
        time: '11m',
        icon: Clock,
        color: 'warn',
    },
    {
        type: 'Flagged',
        text: 'A blacklisted word was blocked in Ray’s thread.',
        time: '20m',
        icon: TriangleAlert,
        color: 'neg',
    },
];

// ---- Role switcher (admin-only preview) -------------------------------------
const roleOpen = ref(false);
const roleRef = ref<HTMLElement | null>(null);
onClickOutside(roleRef, () => (roleOpen.value = false));

const roleOptions: { key: Role; label: string; desc: string }[] = [
    {
        key: 'admin',
        label: 'Admin · Owner',
        desc: 'Full access incl. profit & cut',
    },
    {
        key: 'manager',
        label: 'Manager',
        desc: 'Team & analytics · no profit/cut',
    },
    {
        key: 'chatter',
        label: 'Chatter / VA',
        desc: 'Only assigned conversations',
    },
];

function pickRole(role: Role): void {
    setPreviewRole(role);
    roleOpen.value = false;
}

const roleLabel = computed(
    () =>
        props.effectiveRole.charAt(0).toUpperCase() +
        props.effectiveRole.slice(1),
);
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

        <!-- Search -->
        <div class="relative ml-4 hidden max-w-sm flex-1 items-center md:flex">
            <Search :size="15" class="absolute left-3 text-ss-text-3" />
            <input
                type="text"
                placeholder="Search fans, messages…"
                class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg pr-12 pl-9 text-sm text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
            />
            <kbd
                class="absolute right-3 font-ss-mono text-[10px] text-ss-text-3"
                >⌘K</kbd
            >
        </div>

        <div class="ml-auto flex items-center gap-1.5">
            <!-- Signals -->
            <div ref="signalsRef" class="relative">
                <button
                    type="button"
                    class="relative grid h-9 w-9 place-items-center rounded-lg text-ss-text-2 hover:bg-ss-surface-2"
                    @click="signalsOpen = !signalsOpen"
                >
                    <Bell :size="18" />
                    <span
                        class="absolute top-2 right-2.5 h-1.5 w-1.5 rounded-full bg-ss-neg"
                    />
                </button>
                <div
                    v-if="signalsOpen"
                    class="absolute right-0 z-20 mt-1 w-80 rounded-xl border border-ss-border bg-ss-surface p-2 shadow-xl"
                >
                    <div class="flex items-center justify-between px-2 py-1.5">
                        <span class="text-sm font-semibold text-ss-text"
                            >Signals</span
                        >
                        <span class="text-[11px] text-ss-text-3"
                            >4 need attention</span
                        >
                    </div>
                    <div
                        v-for="(a, i) in signals"
                        :key="i"
                        class="flex gap-2.5 rounded-lg px-2 py-2 hover:bg-ss-surface-2"
                    >
                        <component
                            :is="a.icon"
                            :size="17"
                            :style="{ color: ssColor(a.color) }"
                            class="mt-0.5 shrink-0"
                        />
                        <div class="min-w-0 flex-1">
                            <div class="flex justify-between gap-2">
                                <span
                                    class="text-[13px] font-medium text-ss-text"
                                    >{{ a.type }}</span
                                >
                                <span
                                    class="shrink-0 text-[11px] text-ss-text-3"
                                    >{{ a.time }}</span
                                >
                            </div>
                            <p class="text-[12px] text-ss-text-2">
                                {{ a.text }}
                            </p>
                        </div>
                    </div>
                </div>
            </div>

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
            <div ref="roleRef" class="relative">
                <button
                    type="button"
                    class="flex items-center gap-2 rounded-lg py-1 pr-2 pl-1 hover:bg-ss-surface-2"
                    :class="{ 'cursor-default': user.role !== 'admin' }"
                    @click="user.role === 'admin' && (roleOpen = !roleOpen)"
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
                        v-if="user.role === 'admin'"
                        :size="15"
                        class="text-ss-text-3"
                    />
                </button>

                <div
                    v-if="roleOpen"
                    class="absolute right-0 z-20 mt-1 w-64 rounded-xl border border-ss-border bg-ss-surface p-2 shadow-xl"
                >
                    <div class="px-2 py-1.5 text-[11px] text-ss-text-3">
                        Viewing as · preview permissions
                    </div>
                    <button
                        v-for="o in roleOptions"
                        :key="o.key"
                        type="button"
                        class="block w-full rounded-lg px-2 py-2 text-left hover:bg-ss-surface-2"
                        :class="
                            o.key === effectiveRole ? 'bg-ss-accent-soft' : ''
                        "
                        @click="pickRole(o.key)"
                    >
                        <span
                            class="block text-[13px] font-medium"
                            :class="
                                o.key === effectiveRole
                                    ? 'text-ss-accent-text'
                                    : 'text-ss-text'
                            "
                            >{{ o.label }}</span
                        >
                        <span class="block text-[11px] text-ss-text-3">{{
                            o.desc
                        }}</span>
                    </button>
                </div>
            </div>
        </div>
    </header>
</template>
