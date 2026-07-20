<script setup lang="ts">
import { Link, usePage } from '@inertiajs/vue3';
import { ChevronDown, ChevronRight, Lock } from '@lucide/vue';
import { computed, ref } from 'vue';
import SsCreatorSelect from '@/components/crm/SsCreatorSelect.vue';
import { useCrmShell } from '@/composables/useCrmShell';
import { can, NAV } from '@/crm/nav';
import type { NavNode } from '@/crm/nav';
import type { Role } from '@/types/auth';

const props = defineProps<{ role: Role }>();
const page = usePage();
const { collapsed } = useCrmShell();

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

/** A leaf node (no children) with no route is not built yet. */
function leafSoon(node: NavNode): boolean {
    return !node.children && !node.href;
}

/** A group is "coming soon" when none of its children are built (routed) yet. */
function groupSoon(node: NavNode): boolean {
    return !!node.children && node.children.every((c) => !c.href);
}

/** Any node with no working destination yet (leaf without a route, or a fully-unbuilt group). */
function nodeSoon(node: NavNode): boolean {
    return leafSoon(node) || groupSoon(node);
}

/** Built items first, "coming soon" ones sink to the bottom (stable within each group). */
const orderedNav = computed(() => [
    ...NAV.filter((n) => !nodeSoon(n)),
    ...NAV.filter((n) => nodeSoon(n)),
]);
</script>

<template>
    <aside
        class="flex shrink-0 flex-col border-r border-ss-border bg-ss-surface transition-[width] duration-200"
        :class="collapsed ? 'w-[72px]' : 'w-64'"
    >
        <!-- Brand -->
        <div class="flex h-14 items-center gap-2.5 px-4">
            <div
                class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ss-accent text-sm font-bold text-white"
            >
                S
            </div>
            <div v-if="!collapsed" class="leading-tight">
                <div class="text-sm font-semibold text-ss-text">SmartStars</div>
                <div class="font-ss-mono text-[10px] text-ss-text-3">
                    CRM · v0.5
                </div>
            </div>
        </div>

        <!-- Global creator context: the creator the whole app operates within -->
        <SsCreatorSelect :role="role" />

        <!-- Nav -->
        <nav class="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
            <template v-for="node in orderedNav" :key="node.key">
                <!-- Static group with children -->
                <div v-if="node.children">
                    <button
                        type="button"
                        class="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors"
                        :class="
                            allowed(node)
                                ? 'text-ss-text-2 hover:bg-ss-surface-2'
                                : 'cursor-default text-ss-text-3'
                        "
                        @click="allowed(node) && toggleGroup(node.key)"
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
                            <span
                                v-if="allowed(node) && groupSoon(node)"
                                class="rounded-full bg-ss-surface-2 px-1.5 py-0.5 font-ss-mono text-[9px] font-semibold tracking-wide text-ss-text-3 uppercase"
                                >Soon</span
                            >
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
                        <template
                            v-for="child in node.children"
                            :key="child.key"
                        >
                            <!-- Built child → real link -->
                            <Link
                                v-if="child.href"
                                :href="child.href"
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
                            <!-- Placeholder child -->
                            <span
                                v-else
                                class="flex cursor-default items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] text-ss-text-3"
                                title="Coming soon"
                            >
                                <span
                                    class="h-1.5 w-1.5 rounded-full bg-ss-text-3"
                                />
                                <span class="flex-1 truncate">{{
                                    child.label
                                }}</span>
                                <span
                                    class="rounded-full bg-ss-surface-2 px-1.5 py-0.5 font-ss-mono text-[9px] font-semibold tracking-wide text-ss-text-3 uppercase"
                                    >Soon</span
                                >
                            </span>
                        </template>
                    </div>
                </div>

                <!-- Leaf: real link -->
                <Link
                    v-else-if="allowed(node) && node.href"
                    :href="node.href"
                    class="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                    :class="
                        isActive(node.href)
                            ? 'bg-ss-accent text-white'
                            : 'text-ss-text-2 hover:bg-ss-surface-2'
                    "
                >
                    <component :is="node.icon" :size="19" class="shrink-0" />
                    <span v-if="!collapsed">{{ node.label }}</span>
                </Link>

                <!-- Leaf: placeholder / locked -->
                <div
                    v-else
                    class="flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ss-text-3"
                    :title="
                        allowed(node)
                            ? 'Coming soon'
                            : 'Not available for your role'
                    "
                >
                    <component :is="node.icon" :size="19" class="shrink-0" />
                    <template v-if="!collapsed">
                        <span class="flex-1">{{ node.label }}</span>
                        <span
                            v-if="allowed(node) && leafSoon(node)"
                            class="rounded-full bg-ss-surface-2 px-1.5 py-0.5 font-ss-mono text-[9px] font-semibold tracking-wide text-ss-text-3 uppercase"
                            >Soon</span
                        >
                        <Lock v-if="!allowed(node)" :size="15" />
                    </template>
                </div>
            </template>
        </nav>
    </aside>
</template>
