<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { ref } from 'vue';

type Provider = {
    key: 'onlyfansapi' | 'oopcrm';
    label: string;
    baseUrl: string;
    configured: boolean;
    webhookSecret: boolean;
};

const props = defineProps<{
    active: Provider['key'];
    providers: Provider[];
    updatedAt: string | null;
}>();

const saving = ref<Provider['key'] | null>(null);
const testing = ref<Provider['key'] | null>(null);
const error = ref('');

function activate(p: Provider) {
    const confirmed = window.confirm(
        `Switch every chat, send and media load to ${p.label}?\n\n` +
            `Only creators connected through ${p.label} will show across SSAI (creator selector, ` +
            'Conversations, Media Vault, Scripts, dashboards). Chatters should reload open pages afterwards.',
    );

    if (!confirmed) {
        return;
    }

    saving.value = p.key;
    router.put(
        '/settings/integrations',
        { provider: p.key },
        {
            preserveScroll: true,
            onSuccess: () => (error.value = ''),
            onError: (e) =>
                (error.value =
                    (e as Record<string, string>).provider ??
                    'Could not switch.'),
            onFinish: () => (saving.value = null),
        },
    );
}

function test(p: Provider) {
    testing.value = p.key;
    router.post(
        '/settings/integrations/test',
        { provider: p.key },
        {
            preserveScroll: true,
            preserveState: true,
            onFinish: () => (testing.value = null),
        },
    );
}

const since = props.updatedAt
    ? new Date(props.updatedAt).toLocaleString()
    : null;
</script>

<template>
    <Head title="Integrations" />

    <h1 class="sr-only">Integrations</h1>

    <div class="space-y-6">
        <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
            <h3 class="text-sm font-semibold text-ss-text">Chat connection</h3>
            <p class="mt-1 max-w-2xl text-sm text-ss-text-2">
                Where SSAI reads chats, fans and the vault, and where it sends
                messages. It applies to everyone at once: the app then shows
                only the creators connected through the active provider.
                Switching back is the same click.
            </p>
            <p v-if="since" class="mt-1 text-xs text-ss-text-3">
                Last changed {{ since }}
            </p>

            <p v-if="error" class="mt-3 text-sm text-ss-neg" role="alert">
                {{ error }}
            </p>

            <div class="mt-4 grid gap-3 sm:grid-cols-2">
                <div
                    v-for="p in providers"
                    :key="p.key"
                    class="rounded-lg border p-4"
                    :class="
                        p.key === active
                            ? 'border-ss-accent bg-ss-accent-soft'
                            : 'border-ss-border'
                    "
                >
                    <div class="flex items-center justify-between gap-2">
                        <span class="text-sm font-semibold text-ss-text">{{
                            p.label
                        }}</span>
                        <span
                            v-if="p.key === active"
                            class="rounded-full bg-ss-accent px-2 py-0.5 text-xs font-medium text-white"
                        >
                            Active
                        </span>
                    </div>

                    <p class="mt-2 font-mono text-xs break-all text-ss-text-2">
                        {{ p.baseUrl }}
                    </p>

                    <ul class="mt-2 space-y-0.5 text-xs">
                        <li
                            :class="
                                p.configured ? 'text-ss-pos' : 'text-ss-neg'
                            "
                        >
                            {{
                                p.configured
                                    ? 'API key set'
                                    : 'No API key on the server'
                            }}
                        </li>
                        <li
                            :class="
                                p.webhookSecret
                                    ? 'text-ss-text-2'
                                    : 'text-ss-text-3'
                            "
                        >
                            {{
                                p.webhookSecret
                                    ? 'Webhook secret set'
                                    : 'No webhook secret'
                            }}
                        </li>
                    </ul>

                    <div class="mt-3 flex gap-2">
                        <button
                            type="button"
                            class="rounded-lg border border-ss-border px-3 py-1.5 text-xs text-ss-text hover:bg-ss-surface-2 disabled:opacity-50"
                            :disabled="!p.configured || testing !== null"
                            @click="test(p)"
                        >
                            {{
                                testing === p.key
                                    ? 'Testing…'
                                    : 'Test connection'
                            }}
                        </button>
                        <button
                            v-if="p.key !== active"
                            type="button"
                            class="rounded-lg bg-ss-accent px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
                            :disabled="!p.configured || saving !== null"
                            @click="activate(p)"
                        >
                            {{
                                saving === p.key
                                    ? 'Switching…'
                                    : `Use ${p.label}`
                            }}
                        </button>
                    </div>
                </div>
            </div>

            <p class="mt-4 text-xs text-ss-text-3">
                API keys and webhook secrets live in the server's environment
                and are never shown here. OOP CRM: <code>OOPCRM_API_KEY</code>,
                <code>OOPCRM_WEBHOOK_SECRET</code>. OnlyFansAPI:
                <code>ONLYFANS_API_KEY</code>,
                <code>ONLYFANS_WEBHOOK_SECRET</code>.
            </p>
        </div>
    </div>
</template>
