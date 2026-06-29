<script setup lang="ts">
import { Head, Link, router } from '@inertiajs/vue3';
import { ChevronRight, Plus, Trash2, Users } from '@lucide/vue';
import { ref } from 'vue';
import type { ChatterOption, CreatorModel } from '@/types/crm';

const props = defineProps<{ models: CreatorModel[]; chatters: ChatterOption[] }>();

const newName = ref('');
const adding = ref(false);

function initials(name: string): string {
    return (
        name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0])
            .join('')
            .toUpperCase() || '?'
    );
}

function chatterName(id: number): string {
    return props.chatters.find((c) => c.id === id)?.name ?? `#${id}`;
}

function addModel() {
    const name = newName.value.trim();

    if (!name) {
        return;
    }

    adding.value = true;
    router.post(
        '/models',
        { name },
        {
            preserveScroll: true,
            onSuccess: () => {
                newName.value = '';
            },
            onFinish: () => {
                adding.value = false;
            },
        },
    );
}

function destroy(m: CreatorModel) {
    if (!confirm(`Delete ${m.name}? This also removes its chatter assignments.`)) {
        return;
    }

    router.delete(`/models/${m.id}`, { preserveScroll: true });
}
</script>

<template>
    <Head title="Creator Models" />

    <div class="mx-auto max-w-6xl space-y-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
                <h2 class="text-xl font-bold text-ss-text">Creator Models</h2>
                <p class="text-sm text-ss-text-2">Persona, content library, learned rules, OnlyFans account, and chatter assignments.</p>
            </div>
            <div class="flex items-center gap-2">
                <input
                    v-model="newName"
                    type="text"
                    placeholder="New model name"
                    class="h-9 w-44 rounded-lg border border-ss-border bg-ss-surface px-3 text-sm text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
                    @keyup.enter="addModel"
                />
                <button
                    type="button"
                    class="flex items-center gap-1.5 rounded-lg bg-ss-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                    :disabled="!newName.trim() || adding"
                    @click="addModel"
                >
                    <Plus :size="15" /> Add
                </button>
            </div>
        </div>

        <div v-if="models.length" class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <div
                v-for="m in models"
                :key="m.id"
                class="group flex flex-col rounded-xl border border-ss-border bg-ss-surface p-5 transition-colors hover:border-ss-accent/40"
            >
                <div class="flex items-start gap-3">
                    <span class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-ss-surface-2 text-[13px] font-bold text-ss-text-2">
                        {{ initials(m.name) }}
                    </span>
                    <div class="min-w-0 flex-1">
                        <div class="truncate text-base font-semibold text-ss-text">{{ m.name }}</div>
                        <span v-if="m.tier" class="mt-0.5 inline-block rounded-full bg-ss-surface-2 px-2 py-0.5 text-[11px] font-medium text-ss-text-3 capitalize">{{ m.tier }}</span>
                    </div>
                    <button
                        type="button"
                        class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ss-text-3 opacity-0 transition group-hover:opacity-100 hover:bg-ss-surface-2 hover:text-ss-neg"
                        title="Delete model"
                        @click="destroy(m)"
                    >
                        <Trash2 :size="15" />
                    </button>
                </div>

                <!-- OnlyFans connection -->
                <div class="mt-4 flex items-center gap-2 text-[12px]">
                    <span class="relative flex h-2 w-2">
                        <span v-if="m.of_account_id" class="absolute inline-flex h-full w-full animate-ping rounded-full bg-ss-pos opacity-60" />
                        <span class="relative inline-flex h-2 w-2 rounded-full" :class="m.of_account_id ? 'bg-ss-pos' : 'bg-ss-text-3/40'" />
                    </span>
                    <span :class="m.of_account_id ? 'font-medium text-ss-pos' : 'text-ss-text-3'">
                        {{ m.of_account_id ? 'OnlyFans connected' : 'Not connected' }}
                    </span>
                </div>

                <!-- Assignments -->
                <div class="mt-2 flex items-center gap-1.5 text-[12px] text-ss-text-3">
                    <Users :size="13" />
                    <span v-if="m.assigned.length" class="truncate">
                        {{ m.assigned.length }} chatter{{ m.assigned.length === 1 ? '' : 's' }} ·
                        {{ m.assigned.slice(0, 2).map(chatterName).join(', ') }}{{ m.assigned.length > 2 ? '…' : '' }}
                    </span>
                    <span v-else>No chatters assigned</span>
                </div>

                <Link
                    :href="`/models/${m.id}`"
                    class="mt-4 flex items-center justify-center gap-1 rounded-lg border border-ss-border py-2 text-[13px] font-semibold text-ss-text-2 transition-colors hover:border-ss-accent hover:bg-ss-accent-soft hover:text-ss-accent-text"
                >
                    Manage <ChevronRight :size="15" />
                </Link>
            </div>
        </div>

        <p v-else class="rounded-xl border border-ss-border bg-ss-surface p-8 text-center text-[13px] text-ss-text-3">
            No models yet. Add one above.
        </p>
    </div>
</template>
