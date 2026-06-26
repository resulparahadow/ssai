<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { Sparkles } from '@lucide/vue';
import { ref } from 'vue';

interface SessionOption {
    id: number;
    creator_model: string;
    label: string;
}

const props = defineProps<{ sessions: SessionOption[] }>();

const sessionId = ref<number | null>(props.sessions[0]?.id ?? null);
const context = ref('');
const api = ref<'claude' | 'auto' | 'mistral'>('claude');
const loading = ref(false);
const error = ref<string | null>(null);

const draft = ref('');
const strategy = ref<Record<string, unknown> | null>(null);
const telemetry = ref<Record<string, unknown> | null>(null);

function cookie(name: string): string {
    const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));

    return m ? decodeURIComponent(m[2]) : '';
}

async function generate() {
    if (!sessionId.value) {
return;
}

    loading.value = true;
    error.value = null;
    draft.value = '';
    strategy.value = null;
    telemetry.value = null;

    try {
        const res = await fetch(`/dev/generate/${sessionId.value}`, {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
                'X-XSRF-TOKEN': cookie('XSRF-TOKEN'),
            },
            body: JSON.stringify({ context: context.value, api: api.value }),
        });

        if (!res.ok) {
            const body = await res.json().catch(() => ({}));

            throw new Error(body.error || body.message || `Engine call failed (${res.status})`);
        }

        const data = await res.json();
        draft.value = data.draft || '(empty draft)';
        strategy.value = data.strategy;
        telemetry.value = data.telemetry;
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        loading.value = false;
    }
}
</script>

<template>
    <Head title="Engine · Dev" />

    <div class="mx-auto max-w-5xl space-y-5">
        <div>
            <h2 class="flex items-center gap-2 text-xl font-bold text-ss-text">
                <Sparkles :size="20" class="text-ss-accent" /> Generation engine (legacy parity)
            </h2>
            <p class="text-sm text-ss-text-2">
                Runs the exact legacy <code class="font-ss-mono text-ss-accent-text">generate()</code> via the Node sidecar. Pick a seeded
                conversation and generate a draft.
            </p>
        </div>

        <!-- Controls -->
        <div class="space-y-4 rounded-xl border border-ss-border bg-ss-surface p-5">
            <div class="grid gap-4 sm:grid-cols-2">
                <label class="block">
                    <span class="mb-1 block text-[12px] text-ss-text-2">Conversation</span>
                    <select
                        v-model="sessionId"
                        class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                    >
                        <option v-for="s in sessions" :key="s.id" :value="s.id">{{ s.label }}</option>
                    </select>
                </label>
                <label class="block">
                    <span class="mb-1 block text-[12px] text-ss-text-2">Model route</span>
                    <select
                        v-model="api"
                        class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                    >
                        <option value="claude">claude</option>
                        <option value="auto">auto</option>
                        <option value="mistral">mistral</option>
                    </select>
                </label>
            </div>

            <label class="block">
                <span class="mb-1 block text-[12px] text-ss-text-2">Agent context / override (optional)</span>
                <textarea
                    v-model="context"
                    rows="2"
                    placeholder="e.g. he just tipped, pitch the next tier…"
                    class="w-full rounded-lg border border-ss-border bg-ss-bg p-2 text-sm text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
                />
            </label>

            <div class="flex items-center gap-3">
                <button
                    type="button"
                    :disabled="loading || !sessionId"
                    class="rounded-lg bg-ss-accent px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    @click="generate"
                >
                    {{ loading ? 'Generating…' : 'Generate' }}
                </button>
                <p v-if="!sessions.length" class="text-[13px] text-ss-text-3">
                    No seeded conversations — run <code class="font-ss-mono">php artisan migrate:fresh --seed</code>.
                </p>
            </div>

            <p v-if="error" class="rounded-lg border border-ss-neg/40 bg-ss-neg/10 px-3 py-2 text-[13px] text-ss-neg">
                {{ error }}
            </p>
        </div>

        <!-- Result -->
        <div v-if="draft" class="space-y-4">
            <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
                <h3 class="mb-2 text-sm font-semibold text-ss-text">Draft</h3>
                <p class="rounded-lg bg-ss-bg-2 p-3 text-[15px] leading-relaxed text-ss-text">{{ draft }}</p>
            </div>

            <div v-if="telemetry" class="rounded-xl border border-ss-border bg-ss-surface p-5">
                <h3 class="mb-2 text-sm font-semibold text-ss-text">Telemetry</h3>
                <div class="flex flex-wrap gap-2">
                    <span
                        v-for="(v, k) in telemetry"
                        :key="k"
                        class="rounded-md bg-ss-surface-2 px-2 py-1 font-ss-mono text-[11px] text-ss-text-2"
                    >{{ k }}: {{ v === null ? '—' : v }}</span>
                </div>
            </div>

            <div v-if="strategy" class="rounded-xl border border-ss-border bg-ss-surface p-5">
                <h3 class="mb-2 text-sm font-semibold text-ss-text">Strategy JSON</h3>
                <pre class="max-h-80 overflow-auto rounded-lg bg-ss-bg-2 p-3 font-ss-mono text-[11px] text-ss-text-2">{{ JSON.stringify(strategy, null, 2) }}</pre>
            </div>
        </div>
    </div>
</template>
