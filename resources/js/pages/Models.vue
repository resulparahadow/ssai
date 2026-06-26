<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import { Plus, Trash2, Users } from '@lucide/vue';
import { reactive, ref } from 'vue';
import type { ChatterOption, CreatorModel } from '@/types/crm';

const props = defineProps<{ models: CreatorModel[]; chatters: ChatterOption[] }>();

// Editable copies, merged from props so per-field edits survive saves.
const drafts = reactive<Record<number, CreatorModel>>({});

function syncDrafts() {
    const ids = new Set(props.models.map((m) => m.id));
    props.models.forEach((m) => {
        if (!drafts[m.id]) {
drafts[m.id] = { ...m, assigned: [...m.assigned] };
}
    });
    Object.keys(drafts).forEach((k) => {
        if (!ids.has(Number(k))) {
delete drafts[Number(k)];
}
    });
}
syncDrafts();

const newName = ref('');

function addModel() {
    if (!newName.value.trim()) {
return;
}

    router.post('/models', { name: newName.value.trim() }, {
        preserveScroll: true,
        onSuccess: () => {
            newName.value = '';
            syncDrafts();
        },
    });
}

function save(m: CreatorModel) {
    router.put(`/models/${m.id}`, {
        name: m.name,
        tier: m.tier,
        prompt: m.prompt,
        content_library: m.content_library,
        feedback_rules: m.feedback_rules,
        of_account_id: m.of_account_id,
    }, { preserveScroll: true, preserveState: true });
}

function saveAssignments(m: CreatorModel) {
    router.put(`/models/${m.id}/assignments`, { user_ids: m.assigned }, { preserveScroll: true, preserveState: true });
}

function destroy(m: CreatorModel) {
    if (!confirm(`Delete ${m.name}? This also removes its chatter assignments.`)) {
return;
}

    router.delete(`/models/${m.id}`, { preserveScroll: true, onSuccess: syncDrafts });
}

function toggleAssign(m: CreatorModel, id: number) {
    const i = m.assigned.indexOf(id);

    if (i >= 0) {
m.assigned.splice(i, 1);
} else {
m.assigned.push(id);
}
}
</script>

<template>
    <Head title="Creator Models" />

    <div class="mx-auto max-w-4xl space-y-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
                <h2 class="text-xl font-bold text-ss-text">Creator Models</h2>
                <p class="text-sm text-ss-text-2">Persona, content library, learned rules, and chatter assignments.</p>
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
                    :disabled="!newName.trim()"
                    @click="addModel"
                >
                    <Plus :size="15" /> Add
                </button>
            </div>
        </div>

        <div
            v-for="m in drafts"
            :key="m.id"
            class="space-y-3 rounded-xl border border-ss-border bg-ss-surface p-5"
        >
            <div class="flex items-center justify-between">
                <h3 class="text-base font-semibold text-ss-text">{{ m.name }}</h3>
                <button type="button" class="grid h-8 w-8 place-items-center rounded-lg text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-neg" @click="destroy(m)">
                    <Trash2 :size="15" />
                </button>
            </div>

            <div class="grid gap-3 sm:grid-cols-2">
                <label class="block">
                    <span class="mb-1 block text-[12px] text-ss-text-2">Tier</span>
                    <input v-model="m.tier" type="text" class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none" />
                </label>
                <label class="block">
                    <span class="mb-1 block text-[12px] text-ss-text-2">OnlyFans account id</span>
                    <input v-model="m.of_account_id" type="text" placeholder="acct_…" class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 font-ss-mono text-sm text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none" />
                </label>
            </div>

            <label class="block">
                <span class="mb-1 block text-[12px] text-ss-text-2">Persona prompt</span>
                <textarea v-model="m.prompt" rows="5" class="w-full resize-y rounded-lg border border-ss-border bg-ss-bg p-2.5 text-[13px] text-ss-text focus:border-ss-accent focus:outline-none" />
            </label>

            <label class="block">
                <span class="mb-1 block text-[12px] text-ss-text-2">Content library</span>
                <textarea v-model="m.content_library" rows="4" class="w-full resize-y rounded-lg border border-ss-border bg-ss-bg p-2.5 font-ss-mono text-[12px] text-ss-text focus:border-ss-accent focus:outline-none" />
            </label>

            <label class="block">
                <span class="mb-1 block text-[12px] text-ss-text-2">Learned rules</span>
                <textarea v-model="m.feedback_rules" rows="3" class="w-full resize-y rounded-lg border border-ss-border bg-ss-bg p-2.5 text-[12px] text-ss-text focus:border-ss-accent focus:outline-none" />
            </label>

            <div>
                <div class="mb-1.5 flex items-center gap-1.5 text-[12px] text-ss-text-2"><Users :size="13" /> Assigned chatters</div>
                <div class="flex flex-wrap gap-1.5">
                    <button
                        v-for="c in chatters"
                        :key="c.id"
                        type="button"
                        class="rounded-md border px-2.5 py-1 text-[12px] transition-colors"
                        :class="m.assigned.includes(c.id)
                            ? 'border-ss-accent bg-ss-accent-soft text-ss-accent-text'
                            : 'border-ss-border text-ss-text-3 hover:text-ss-text'"
                        @click="toggleAssign(m, c.id)"
                    >
                        {{ c.name }}
                    </button>
                </div>
            </div>

            <div class="flex items-center gap-2 border-t border-ss-border pt-3">
                <button type="button" class="rounded-lg bg-ss-accent px-4 py-2 text-[13px] font-semibold text-white" @click="save(m)">Save settings</button>
                <button type="button" class="rounded-lg border border-ss-border px-4 py-2 text-[13px] font-medium text-ss-text-2 hover:bg-ss-surface-2" @click="saveAssignments(m)">Save assignments</button>
            </div>
        </div>

        <p v-if="!Object.keys(drafts).length" class="rounded-xl border border-ss-border bg-ss-surface p-8 text-center text-[13px] text-ss-text-3">
            No models yet. Add one above.
        </p>
    </div>
</template>
