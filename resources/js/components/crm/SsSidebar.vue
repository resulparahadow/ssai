<script setup lang="ts">
import { Link, usePage } from '@inertiajs/vue3';
import { ChevronDown, ChevronRight, Lock } from '@lucide/vue';
import { computed, ref } from 'vue';
import { useCrmShell } from '@/composables/useCrmShell';
import { can, NAV  } from '@/crm/nav';
import type {NavNode} from '@/crm/nav';
import type { Role } from '@/types/auth';

interface CreatorEntry {
    id: number;
    name: string;
    hasOf: boolean;
}

const props = defineProps<{ role: Role }>();
const page = usePage();
const { collapsed } = useCrmShell();

const expanded = ref<Record<string, boolean>>({ chat: true, analytics: true });

function toggleGroup(key: string): void {
    expanded.value[key] = !expanded.value[key];
}

const currentPath = computed(() => page.url.split('?')[0]);

const currentCreator = computed(() => new URLSearchParams(page.url.split('?')[1] ?? '').get('creator'));

const creators = computed<CreatorEntry[]>(() => (page.props.creators as CreatorEntry[]) ?? []);

function isActive(href?: string): boolean {
    return !!href && currentPath.value === href;
}

function allowed(node: NavNode): boolean {
    return !!node.alwaysOn || can(props.role, node.cap);
}

function convoHref(name: string): string {
    return `/conversations?creator=${encodeURIComponent(name)}`;
}
</script>

<template>
    <aside
        class="flex shrink-0 flex-col border-r border-ss-border bg-ss-surface transition-[width] duration-200"
        :class="collapsed ? 'w-[72px]' : 'w-64'"
    >
        <!-- Brand -->
        <div class="flex h-14 items-center gap-2.5 px-4">
            <div class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ss-accent text-sm font-bold text-white">
                S
            </div>
            <div v-if="!collapsed" class="leading-tight">
                <div class="text-sm font-semibold text-ss-text">SmartStars</div>
                <div class="font-ss-mono text-[10px] text-ss-text-3">CRM · v0.5</div>
            </div>
        </div>

        <!-- Nav -->
        <nav class="flex-1 space-y-0.5 overflow-y-auto px-2 py-2">
            <template v-for="node in NAV" :key="node.key">
                <!-- Dynamic group: Conversations → one child per creator model -->
                <div v-if="node.dynamic === 'creators'">
                    <button
                        type="button"
                        class="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors"
                        :class="allowed(node) ? 'text-ss-text-2 hover:bg-ss-surface-2' : 'cursor-default text-ss-text-3'"
                        @click="allowed(node) && toggleGroup(node.key)"
                    >
                        <component :is="node.icon" :size="19" class="shrink-0" />
                        <template v-if="!collapsed">
                            <span class="flex-1 text-left font-medium">{{ node.label }}</span>
                            <Lock v-if="!allowed(node)" :size="15" />
                            <component v-else :is="expanded[node.key] ? ChevronDown : ChevronRight" :size="15" />
                        </template>
                    </button>

                    <div v-if="allowed(node) && expanded[node.key] && !collapsed" class="mt-0.5 space-y-0.5 pl-3">
                        <Link
                            v-for="c in creators"
                            :key="c.name"
                            :href="convoHref(c.name)"
                            class="flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors"
                            :class="currentPath === '/conversations' && currentCreator === c.name
                                ? 'bg-ss-accent-soft font-medium text-ss-accent-text'
                                : 'text-ss-text-2 hover:bg-ss-surface-2'"
                        >
                            <span
                                class="h-1.5 w-1.5 shrink-0 rounded-full"
                                :class="c.hasOf ? 'bg-ss-pos' : 'bg-ss-text-3'"
                                :title="c.hasOf ? 'OnlyFans connected' : 'No OnlyFans account set'"
                            />
                            <span class="flex-1 truncate">{{ c.name }}</span>
                        </Link>
                        <span v-if="!creators.length" class="block px-3 py-1.5 text-[12px] text-ss-text-3">No creators assigned</span>
                    </div>
                </div>

                <!-- Static group with children -->
                <div v-else-if="node.children">
                    <button
                        type="button"
                        class="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors"
                        :class="allowed(node) ? 'text-ss-text-2 hover:bg-ss-surface-2' : 'cursor-default text-ss-text-3'"
                        @click="allowed(node) && toggleGroup(node.key)"
                    >
                        <component :is="node.icon" :size="19" class="shrink-0" />
                        <template v-if="!collapsed">
                            <span class="flex-1 text-left font-medium">{{ node.label }}</span>
                            <Lock v-if="!allowed(node)" :size="15" />
                            <component v-else :is="expanded[node.key] ? ChevronDown : ChevronRight" :size="15" />
                        </template>
                    </button>

                    <div v-if="allowed(node) && expanded[node.key] && !collapsed" class="mt-0.5 space-y-0.5 pl-3">
                        <span
                            v-for="child in node.children"
                            :key="child.key"
                            class="flex cursor-default items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] text-ss-text-2"
                            :title="child.label + ' — built in a later phase'"
                        >
                            <span class="h-1.5 w-1.5 rounded-full bg-ss-text-3" />
                            {{ child.label }}
                        </span>
                    </div>
                </div>

                <!-- Leaf: real link -->
                <Link
                    v-else-if="allowed(node) && node.href"
                    :href="node.href"
                    class="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors"
                    :class="isActive(node.href) ? 'bg-ss-accent text-white' : 'text-ss-text-2 hover:bg-ss-surface-2'"
                >
                    <component :is="node.icon" :size="19" class="shrink-0" />
                    <span v-if="!collapsed">{{ node.label }}</span>
                </Link>

                <!-- Leaf: placeholder / locked -->
                <div
                    v-else
                    class="flex cursor-default items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium"
                    :class="allowed(node) ? 'text-ss-text-2' : 'text-ss-text-3'"
                    :title="allowed(node) ? node.label + ' — built in a later phase' : 'Not available for your role'"
                >
                    <component :is="node.icon" :size="19" class="shrink-0" />
                    <template v-if="!collapsed">
                        <span class="flex-1">{{ node.label }}</span>
                        <Lock v-if="!allowed(node)" :size="15" />
                    </template>
                </div>
            </template>
        </nav>
    </aside>
</template>
