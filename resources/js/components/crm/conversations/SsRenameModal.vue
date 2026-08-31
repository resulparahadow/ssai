<script setup lang="ts">
import { X } from '@lucide/vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { ofApi } from '@/lib/onlyfans';

/**
 * Set the fan's OnlyFans custom name. The server resolves the resulting label (custom name if
 * set, else the fan's real name) and echoes it back for the caller to update the row with.
 */
const props = defineProps<{
    modelId: number;
    chatId: string;
    current: string;
}>();
const emit = defineEmits<{ close: []; renamed: [name: string] }>();

const text = ref(props.current);
const saving = ref(false);
const error = ref<string | null>(null);
const input = ref<HTMLInputElement | null>(null);

async function save() {
    saving.value = true;
    error.value = null;
    const next = text.value.trim();

    try {
        const r = await ofApi.rename(props.modelId, props.chatId, next === '' ? null : next);
        // Prefer OnlyFans' own echo; fall back to what we sent.
        emit('renamed', r.name ?? next);
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
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    input.value?.focus();
    input.value?.select();
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
            <form
                class="w-full max-w-sm rounded-xl border border-ss-border bg-ss-surface p-5 shadow-xl"
                @submit.prevent="save"
            >
                <div class="mb-1 flex items-center justify-between">
                    <h3 class="text-base font-semibold text-ss-text">
                        Rename user
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
                    Sets this fan’s custom name on OnlyFans. Leave empty to
                    clear it.
                </p>

                <p
                    v-if="error"
                    class="mb-2 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[12px] text-red-400"
                >
                    {{ error }}
                </p>

                <input
                    ref="input"
                    v-model="text"
                    maxlength="255"
                    placeholder="e.g. 🐳 Whale ($100+)"
                    class="w-full rounded-md border border-ss-border bg-ss-surface px-2 py-1.5 text-[13px] text-ss-text"
                />

                <div class="mt-4 flex items-center justify-end gap-2">
                    <button
                        type="button"
                        class="rounded-lg px-3 py-1.5 text-[12px] text-ss-text-2 hover:bg-ss-surface-2"
                        @click="emit('close')"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        :disabled="saving"
                        class="rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-medium text-white disabled:opacity-40"
                    >
                        {{ saving ? 'Saving…' : 'Save' }}
                    </button>
                </div>
            </form>
        </div>
    </Teleport>
</template>
