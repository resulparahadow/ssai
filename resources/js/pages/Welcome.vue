<script setup lang="ts">
import { Head, Link } from '@inertiajs/vue3';
import { dashboard, login } from '@/routes';
</script>

<template>
    <Head title="SmartStars" />

    <main
        class="flex min-h-screen flex-col items-center justify-center gap-8 bg-ss-bg px-6 font-ss text-ss-text"
    >
        <div class="flex flex-col items-center gap-4">
            <div
                class="grid h-16 w-16 shrink-0 place-items-center rounded-2xl bg-ss-accent text-2xl font-bold text-white"
            >
                S
            </div>
            <div class="text-center leading-tight">
                <h1 class="text-3xl font-semibold tracking-tight text-ss-text">
                    SmartStars
                </h1>
                <p
                    class="mt-1 font-ss-mono text-xs tracking-wide text-ss-text-3"
                >
                    CRM · v0.5
                </p>
            </div>
        </div>

        <Link
            :href="$page.props.auth.user ? dashboard() : login()"
            class="rounded-lg border border-ss-border bg-ss-surface px-4 py-2 text-sm font-medium text-ss-text-2 transition-colors hover:border-ss-border-2 hover:text-ss-text"
        >
            {{ $page.props.auth.user ? 'Go to dashboard' : 'Log in' }}
            <span aria-hidden="true">→</span>
        </Link>
    </main>
</template>
