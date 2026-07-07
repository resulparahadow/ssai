<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { useCurrentUrl } from '@/composables/useCurrentUrl';

// Rendered as the inner layout of [SmartStarsLayout, SsSettingsLayout]. The outer
// SmartStars shell owns the sidebar/topbar/background; this wrapper only lays out the
// settings sub-nav + the current settings page. inheritAttrs:false swallows any stray
// prop Inertia might spread onto the layout chain.
defineOptions({ inheritAttrs: false });

const items = [
    { title: 'Profile', href: '/settings/profile' },
    { title: 'Security', href: '/settings/security' },
    { title: 'Appearance', href: '/settings/appearance' },
    { title: 'Notifications', href: '/settings/notifications' },
];

const { isCurrentUrl } = useCurrentUrl();
</script>

<template>
    <div class="mx-auto max-w-4xl">
        <header class="mb-6">
            <h2 class="text-lg font-semibold text-ss-text">Settings</h2>
            <p class="text-sm text-ss-text-2">
                Manage your profile and account settings
            </p>
        </header>

        <div class="flex flex-col gap-8 lg:flex-row">
            <aside class="w-full shrink-0 lg:w-52">
                <nav class="flex gap-1 lg:flex-col" aria-label="Settings">
                    <Link
                        v-for="item in items"
                        :key="item.href"
                        :href="item.href"
                        class="rounded-lg px-3 py-2 text-sm transition-colors"
                        :class="
                            isCurrentUrl(item.href)
                                ? 'bg-ss-accent-soft font-medium text-ss-accent-text'
                                : 'text-ss-text-2 hover:bg-ss-surface-2'
                        "
                    >
                        {{ item.title }}
                    </Link>
                </nav>
            </aside>

            <div class="min-w-0 flex-1">
                <slot />
            </div>
        </div>
    </div>
</template>
