<script setup lang="ts">
import { TriangleAlert, X } from '@lucide/vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { ofApi } from '@/lib/onlyfans';

/**
 * The fan's OnlyFans-native note. OnlyFans owns the value; saving here writes it there and
 * the server mirrors it locally so AI generation can read it without a billed call.
 *
 * `synced: false` means a note exists only in our database (written before the OnlyFans sync
 * existed) — it is shown as-is and pushed up on the next save, never silently dropped.
 */
const props = defineProps<{
    modelId: number;
    chatId: string;
    fanName: string;
}>();
const emit = defineEmits<{ close: []; saved: [notes: string] }>();

const text = ref('');
const loading = ref(true);
const saving = ref(false);
const error = ref<string | null>(null);
const synced = ref(true);

async function load() {
    loading.value = true;
    error.value = null;

    try {
        const r = await ofApi.getNotes(props.modelId, props.chatId);
        text.value = r.notes;
        synced.value = r.synced;
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        loading.value = false;
    }
}

async function save() {
    saving.value = true;
    error.value = null;

    try {
        const r = await ofApi.saveNotes(props.modelId, props.chatId, text.value);
        synced.value = r.synced;
        emit('saved', r.notes);
        emit('close');
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        saving.value = false;
    }
}

async function clear() {
    if (!confirm('Clear this fan’s OnlyFans note?')) {
        return;
    }

    saving.value = true;
    error.value = null;

    try {
        await ofApi.clearNotes(props.modelId, props.chatId);
        text.value = '';
        synced.value = true;
        emit('saved', '');
        emit('close');
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        saving.value = false;
    }
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        emit('close');
    }
}

onMounted(() => {
    load();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
});

onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey);
    document.body.style.overflow = '';
});
</script>

<template>
    <Teleport to="body">
        <div
            class="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4 backdrop-blur-sm"
            @click.self="emit('close')"
        >
            <div
                class="w-full max-w-md rounded-xl border border-ss-border bg-ss-surface p-5 shadow-xl"
            >
                <div class="mb-1 flex items-center justify-between">
                    <h3 class="text-base font-semibold text-ss-text">
                        OnlyFans note
                    </h3>
                    <button
                        type="button"
                        class="grid h-7 w-7 place-items-center rounded-lg text-ss-text-2 hover:bg-ss-surface-2"
                        title="Close (Esc)"
                        @click="emit('close')"
                    >
                        <X :size="16" />
                    </button>
                </div>
                <p class="mb-3 text-[11px] text-ss-text-3">
                    Saved to {{ fanName }}’s profile on OnlyFans. Also given to
                    the AI when drafting replies.
                </p>

                <p
                    v-if="error"
                    class="mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[12px] text-red-400"
                >
                    {{ error }}
                </p>

                <p
                    v-if="!loading && !synced"
                    class="mb-2 flex items-start gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-500"
                >
                    <TriangleAlert :size="13" class="mt-px shrink-0" />
                    <span
                        >This note is only in the CRM — it was written before
                        notes synced to OnlyFans. Save to push it up.</span
                    >
                </p>

                <div
                    v-if="loading"
                    class="h-24 animate-pulse rounded-md bg-ss-surface-2"
                />
                <textarea
                    v-else
                    v-model="text"
                    rows="5"
                    maxlength="5000"
                    placeholder="e.g. prefers “babe”, hard no on feet, works nights"
                    class="w-full resize-y rounded-md border border-ss-border bg-ss-surface px-2 py-1.5 text-[13px] text-ss-text"
                />

                <div class="mt-4 flex items-center justify-between">
                    <button
                        type="button"
                        :disabled="loading || saving || text.trim() === ''"
                        class="rounded-lg px-2.5 py-1.5 text-[12px] text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-40"
                        @click="clear"
                    >
                        Clear
                    </button>
                    <div class="flex items-center gap-2">
                        <button
                            type="button"
                            class="rounded-lg px-3 py-1.5 text-[12px] text-ss-text-2 hover:bg-ss-surface-2"
                            @click="emit('close')"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            :disabled="loading || saving"
                            class="rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
                            @click="save"
                        >
                            {{ saving ? 'Saving…' : 'Save' }}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    </Teleport>
</template>
