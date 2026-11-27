<script setup lang="ts">
import { Link, usePage } from '@inertiajs/vue3';
import { ChevronDown, ChevronRight, Lock, X } from '@lucide/vue';
import { onClickOutside, onKeyStroke } from '@vueuse/core';
import { computed, ref, watch } from 'vue';
import SsCreatorSelect from '@/components/crm/SsCreatorSelect.vue';
import { useCrmShell } from '@/composables/useCrmShell';
import { can, NAV } from '@/crm/nav';
import type { NavNode } from '@/crm/nav';
import type { Role } from '@/types/auth';

const props = defineProps<{ role: Role }>();
const page = usePage();
const { collapsed, isMobile, drawerOpen, toggleSidebar, closeDrawer } =
    useCrmShell();

const expanded = ref<Record<string, boolean>>({
    analytics: true,
});

function toggleGroup(key: string): void {
    expanded.value[key] = !expanded.value[key];
}

const currentPath = computed(() => page.url.split('?')[0]);

function isActive(href?: string): boolean {
    if (!href) {
        return false;
    }

    // Settings is a leaf whose href is /settings/profile but it owns every /settings/*
    // subpath (Security, Appearance, Notifications), so match by prefix for it only.
    if (href.startsWith('/settings')) {
        return currentPath.value.startsWith('/settings');
    }

    return currentPath.value === href;
}

function allowed(node: NavNode): boolean {
    return !!node.alwaysOn || can(props.role, node.cap);
}

/**
 * Only built views show. A node with no route yet (a leaf without `href`, a group none of whose
 * children has one) and every unrouted child are left out entirely; their entries stay in
 * `NAV` as the roadmap and appear here once they get a route.
 */
const orderedNav = computed<NavNode[]>(() =>
    NAV.filter((n) => allowed(n) || !n.hideWhenLocked).flatMap((n) => {
        if (!n.children) {
            return n.href ? [n] : [];
        }

        const children = n.children.filter((c) => c.href);

        return children.length ? [{ ...n, children }] : [];
    }),
);

/** A group owns the page when one of its children is the current route. */
function groupActive(node: NavNode): boolean {
    return !!node.children?.some((c) => isActive(c.href));
}

// ---- Collapsed rail: a group opens as a flyout beside its icon -------------------------------
// The nav scrolls (overflow-y-auto), which would clip an absolutely positioned menu, so the
// flyout is `fixed` at the clicked icon's position.
const flyout = ref<{ key: string; top: number; left: number } | null>(null);
const flyoutRef = ref<HTMLElement | null>(null);
const flyoutNode = computed(
    () => orderedNav.value.find((n) => n.key === flyout.value?.key) ?? null,
);

function onGroupClick(node: NavNode, event: MouseEvent): void {
    if (!allowed(node)) {
        return;
    }

    if (!collapsed.value) {
        toggleGroup(node.key);

        return;
    }

    if (flyout.value?.key === node.key) {
        flyout.value = null;

        return;
    }

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    flyout.value = { key: node.key, top: rect.top, left: rect.right + 8 };
}

onClickOutside(flyoutRef, () => (flyout.value = null), {
    ignore: ['[data-flyout-trigger]'],
});
watch([collapsed, currentPath], () => (flyout.value = null));

// ---- Keyboard ---------------------------------------------------------------------------------
onKeyStroke('Escape', () => {
    flyout.value = null;
    closeDrawer();
});

/** `[` toggles the sidebar (Linear's key), except while typing. */
onKeyStroke('[', (e) => {
    const t = e.target as HTMLElement | null;

    if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        t?.closest('input, textarea, select, [contenteditable="true"]')
    ) {
        return;
    }

    e.preventDefault();
    toggleSidebar();
});
</script>

<template>
    <!-- Drawer backdrop (narrow screens only) -->
    <Transition
        enter-active-class="transition-opacity duration-200"
        enter-from-class="opacity-0"
        leave-active-class="transition-opacity duration-150"
        leave-to-class="opacity-0"
    >
        <div
            v-if="isMobile && drawerOpen"
            class="fixed inset-0 z-40 bg-black/40"
            aria-hidden="true"
            @click="closeDrawer"
        />
    </Transition>

    <aside
        id="ss-sidebar"
        class="flex shrink-0 flex-col border-r border-ss-border bg-ss-surface"
        :class="
            isMobile
                ? [
                      'fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] shadow-xl transition-transform duration-200 ease-out',
                      drawerOpen ? 'translate-x-0' : '-translate-x-full',
                  ]
                : [
                      'transition-[width] duration-200 ease-out',
                      collapsed ? 'w-[72px]' : 'w-64',
                  ]
        "
        :inert="isMobile && !drawerOpen"
        aria-label="Main navigation"
    >
        <!-- Brand -->
        <div class="flex h-14 shrink-0 items-center gap-2.5 px-4">
            <div
                class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ss-accent text-sm font-bold text-white"
            >
                S
            </div>
            <div v-if="!collapsed" class="min-w-0 flex-1 leading-tight">
                <div class="text-sm font-semibold text-ss-text">SmartStars</div>
                <div class="font-ss-mono text-[10px] text-ss-text-3">
                    CRM · v0.5
                </div>
            </div>
            <button
                v-if="isMobile"
                type="button"
                class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ss-text-2 hover:bg-ss-surface-2"
                aria-label="Close menu"
                @click="closeDrawer"
            >
                <X :size="18" />
            </button>
        </div>

        <!-- Global creator context: the creator the whole app operates within -->
        <SsCreatorSelect :role="role" />

        <!-- Nav -->
        <nav class="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
            <template v-for="node in orderedNav" :key="node.key">
                <!-- Group with children -->
                <div v-if="node.children">
                    <button
                        type="button"
                        data-flyout-trigger
                        class="flex w-full items-center gap-2.5 rounded-lg py-2 text-sm transition-colors"
                        :class="[
                            collapsed ? 'justify-center px-0' : 'px-3',
                            !allowed(node)
                                ? 'cursor-default text-ss-text-3'
                                : collapsed && groupActive(node)
                                  ? 'bg-ss-accent-soft text-ss-accent-text'
                                  : 'text-ss-text-2 hover:bg-ss-surface-2',
                        ]"
                        :title="collapsed ? node.label : undefined"
                        :aria-label="collapsed ? node.label : undefined"
                        :aria-expanded="
                            allowed(node)
                                ? collapsed
                                    ? flyout?.key === node.key
                                    : !!expanded[node.key]
                                : undefined
                        "
                        @click="onGroupClick(node, $event)"
                    >
                        <component
                            :is="node.icon"
                            :size="19"
                            class="shrink-0"
                        />
                        <template v-if="!collapsed">
                            <span class="flex-1 text-left font-medium">{{
                                node.label
                            }}</span>
                            <Lock v-if="!allowed(node)" :size="15" />
                            <component
                                v-else
                                :is="
                                    expanded[node.key]
                                        ? ChevronDown
                                        : ChevronRight
                                "
                                :size="15"
                            />
                        </template>
                    </button>

                    <div
                        v-if="allowed(node) && expanded[node.key] && !collapsed"
                        class="mt-0.5 space-y-0.5 pl-3"
                    >
                        <Link
                            v-for="child in node.children"
                            :key="child.key"
                            :href="child.href!"
                            class="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors"
                            :class="
                                isActive(child.href)
                                    ? 'bg-ss-accent-soft font-medium text-ss-accent-text'
                                    : 'text-ss-text-2 hover:bg-ss-surface-2'
                            "
                        >
                            <span
                                class="h-1.5 w-1.5 rounded-full"
                                :class="
                                    isActive(child.href)
                                        ? 'bg-ss-accent'
                                        : 'bg-ss-text-3'
                                "
                            />
                            {{ child.label }}
                        </Link>
                    </div>
                </div>

                <!-- Leaf: real link -->
                <Link
                    v-else-if="allowed(node) && node.href"
                    :href="node.href"
                    class="flex items-center gap-2.5 rounded-lg py-2 text-sm font-medium transition-colors"
                    :class="[
                        collapsed ? 'justify-center px-0' : 'px-3',
                        isActive(node.href)
                            ? 'bg-ss-accent text-white'
                            : 'text-ss-text-2 hover:bg-ss-surface-2',
                    ]"
                    :title="collapsed ? node.label : undefined"
                    :aria-label="collapsed ? node.label : undefined"
                >
                    <component :is="node.icon" :size="19" class="shrink-0" />
                    <span v-if="!collapsed">{{ node.label }}</span>
                </Link>

                <!-- Leaf: locked for this role -->
                <div
                    v-else
                    class="flex cursor-default items-center gap-2.5 rounded-lg py-2 text-sm font-medium text-ss-text-3"
                    :class="collapsed ? 'justify-center px-0' : 'px-3'"
                    :title="
                        collapsed
                            ? `${node.label} — not available for your role`
                            : 'Not available for your role'
                    "
                >
                    <component :is="node.icon" :size="19" class="shrink-0" />
                    <template v-if="!collapsed">
                        <span class="flex-1">{{ node.label }}</span>
                        <Lock :size="15" />
                    </template>
                </div>
            </template>
        </nav>
    </aside>

    <!-- Collapsed rail: a group's links, beside its icon -->
    <Teleport to="body">
        <div
            v-if="flyout && flyoutNode"
            ref="flyoutRef"
            role="menu"
            :aria-label="flyoutNode.label"
            class="fixed z-50 w-56 rounded-xl border border-ss-border bg-ss-surface p-1.5 font-ss shadow-xl"
            :style="{ top: `${flyout.top}px`, left: `${flyout.left}px` }"
        >
            <div
                class="px-2.5 pt-1 pb-1.5 text-[12px] font-semibold text-ss-text"
            >
                {{ flyoutNode.label }}
            </div>
            <Link
                v-for="child in flyoutNode.children"
                :key="child.key"
                :href="child.href!"
                role="menuitem"
                class="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors"
                :class="
                    isActive(child.href)
                        ? 'bg-ss-accent-soft font-medium text-ss-accent-text'
                        : 'text-ss-text-2 hover:bg-ss-surface-2'
                "
            >
                <span
                    class="h-1.5 w-1.5 rounded-full"
                    :class="
                        isActive(child.href) ? 'bg-ss-accent' : 'bg-ss-text-3'
                    "
                />
                {{ child.label }}
            </Link>
        </div>
    </Teleport>
</template>
