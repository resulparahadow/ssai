<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import AppLogoIcon from '@/components/AppLogoIcon.vue';
import { home } from '@/routes';

defineProps<{
    title?: string;
    description?: string;
}>();

const year = new Date().getFullYear();

// Map the shared shadcn `ui/*` control tokens onto the SmartStars design
// palette so buttons/inputs/checkboxes adopt the dashboard's accent without
// forking each component. Custom properties cascade to every descendant.
const ssTokenOverrides = {
    '--primary': 'var(--ss-accent)',
    '--primary-foreground': '#ffffff',
    '--ring': 'var(--ss-accent)',
    '--border': 'var(--ss-border)',
    '--input': 'var(--ss-border)',
    '--background': 'var(--ss-surface)',
    '--foreground': 'var(--ss-text)',
    '--muted-foreground': 'var(--ss-text-2)',
} as const;
</script>

<template>
    <div
        class="ss-auth flex min-h-svh font-ss text-ss-text"
        :style="ssTokenOverrides"
    >
        <!-- Brand panel — always dark, hidden below lg -->
        <aside
            class="relative hidden w-[44%] max-w-2xl flex-col justify-between overflow-hidden bg-[#0f131b] p-12 lg:flex"
        >
            <div
                class="pointer-events-none absolute inset-0"
                style="
                    background:
                        radial-gradient(
                            120% 90% at 15% 0%,
                            rgba(79, 134, 247, 0.22),
                            transparent 55%
                        ),
                        radial-gradient(
                            90% 80% at 100% 100%,
                            rgba(79, 134, 247, 0.1),
                            transparent 60%
                        );
                "
            />

            <Link
                :href="home()"
                class="relative flex items-center gap-3 font-medium"
            >
                <span
                    class="grid h-11 w-11 place-items-center rounded-2xl bg-[#4f86f7] shadow-lg shadow-[#4f86f7]/30"
                >
                    <AppLogoIcon class="h-6 w-6 text-white" />
                </span>
                <span class="text-lg font-semibold text-[#eef1f6]">
                    SmartStars
                    <span class="font-normal text-[#646e7e]">CRM</span>
                </span>
            </Link>

            <div class="relative max-w-md">
                <h2 class="text-3xl leading-tight font-semibold text-[#eef1f6]">
                    AI-powered creator operations.
                </h2>
                <p class="mt-4 text-sm leading-relaxed text-[#9aa4b5]">
                    Manage conversations, models, and revenue in one place —
                    powered by SmartStars AI.
                </p>
            </div>

            <p class="relative text-xs text-[#646e7e]">
                © {{ year }} SmartStars. All rights reserved.
            </p>
        </aside>

        <!-- Form panel — theme-aware -->
        <main
            class="flex flex-1 flex-col items-center justify-center bg-ss-surface px-6 py-12"
        >
            <div class="w-full max-w-sm">
                <!-- Compact logo for small screens -->
                <Link
                    :href="home()"
                    class="mb-10 flex items-center gap-2.5 font-medium lg:hidden"
                >
                    <span
                        class="grid h-9 w-9 place-items-center rounded-xl bg-ss-accent"
                    >
                        <AppLogoIcon class="h-5 w-5 text-white" />
                    </span>
                    <span class="text-base font-semibold text-ss-text">
                        SmartStars
                        <span class="font-normal text-ss-text-3">CRM</span>
                    </span>
                </Link>

                <div class="mb-8">
                    <h1 class="text-2xl font-semibold text-ss-text">
                        {{ title }}
                    </h1>
                    <p v-if="description" class="mt-2 text-sm text-ss-text-2">
                        {{ description }}
                    </p>
                </div>

                <slot />
            </div>
        </main>
    </div>
</template>
