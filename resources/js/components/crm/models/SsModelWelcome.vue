<script setup lang="ts">
import { Check, LoaderCircle } from '@lucide/vue';
import { onMounted, ref } from 'vue';
import SsMessageMedia from '@/components/crm/conversations/SsMessageMedia.vue';
import { ofModel } from '@/lib/onlyfansModel';
import type { OfWelcomeMessage } from '@/types/crm';

const props = defineProps<{ modelId: number }>();

const loading = ref(true);
const error = ref<string | null>(null);
const welcome = ref<OfWelcomeMessage | null>(null);

const text = ref('');
const saving = ref(false);
const saved = ref(false);
const toggling = ref(false);

/** Strip HTML tags to plain text for the editor/preview (avoids v-html / XSS). */
function stripHtml(html: string): string {
    const el = document.createElement('div');
    el.innerHTML = html;

    return (el.textContent || '').trim();
}

async function load() {
    loading.value = true;
    error.value = null;

    try {
        const r = await ofModel.welcome(props.modelId);
        welcome.value = r.welcome;
        text.value = stripHtml(r.welcome.text);
    } catch (e) {
        error.value =
            e instanceof Error ? e.message : 'Failed to load welcome message.';
    } finally {
        loading.value = false;
    }
}

async function save() {
    if (!text.value.trim()) {
        return;
    }

    saving.value = true;
    error.value = null;

    try {
        await ofModel.saveWelcome(props.modelId, { text: text.value });
        saved.value = true;
        setTimeout(() => (saved.value = false), 2000);
    } catch (e) {
        error.value =
            e instanceof Error ? e.message : 'Failed to save welcome message.';
    } finally {
        saving.value = false;
    }
}

async function toggleActive() {
    if (!welcome.value) {
        return;
    }

    const next = !welcome.value.isActive;
    toggling.value = true;
    error.value = null;

    try {
        await ofModel.toggleWelcome(props.modelId, next);
        welcome.value.isActive = next;
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to toggle.';
    } finally {
        toggling.value = false;
    }
}

onMounted(load);
</script>

<template>
    <div class="space-y-4">
        <p
            v-if="loading"
            class="flex items-center justify-center gap-2 py-8 text-[13px] text-ss-text-3"
        >
            <LoaderCircle :size="16" class="animate-spin" /> Loading welcome
            message…
        </p>
        <p
            v-else-if="error && !welcome"
            class="rounded-lg border border-ss-border bg-ss-surface p-4 text-center text-[12px] text-ss-neg"
        >
            {{ error }}
        </p>

        <template v-else-if="welcome">
            <!-- Active toggle -->
            <div
                class="flex items-center justify-between rounded-xl border border-ss-border bg-ss-surface p-4"
            >
                <div>
                    <div class="text-[13px] font-semibold text-ss-text">
                        Auto welcome message
                    </div>
                    <div class="text-[11px] text-ss-text-3">
                        Sent automatically to new subscribers.
                    </div>
                </div>
                <button
                    type="button"
                    role="switch"
                    :aria-checked="welcome.isActive"
                    class="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors disabled:opacity-50"
                    :class="welcome.isActive ? 'bg-ss-pos' : 'bg-ss-text-3/30'"
                    :disabled="toggling"
                    @click="toggleActive"
                >
                    <span
                        class="inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform"
                        :class="
                            welcome.isActive
                                ? 'translate-x-5'
                                : 'translate-x-0.5'
                        "
                    />
                </button>
            </div>

            <!-- Media preview (read-only) -->
            <div
                v-if="welcome.media.length"
                class="rounded-xl border border-ss-border bg-ss-surface p-4"
            >
                <div class="mb-2 text-[12px] font-medium text-ss-text-2">
                    Attached media
                </div>
                <SsMessageMedia
                    :media="welcome.media"
                    :price="welcome.price || undefined"
                    :model-id="modelId"
                />
            </div>

            <!-- Editable text -->
            <div
                class="space-y-2 rounded-xl border border-ss-border bg-ss-surface p-4"
            >
                <div class="flex items-center justify-between">
                    <h4 class="text-[13px] font-semibold text-ss-text">
                        Message text
                    </h4>
                    <span
                        v-if="saved"
                        class="flex items-center gap-1 text-[11px] font-medium text-ss-pos"
                        ><Check :size="13" /> Saved</span
                    >
                </div>
                <textarea
                    v-model="text"
                    rows="4"
                    placeholder="Hey, welcome to my page! 💕"
                    class="w-full resize-y rounded-lg border border-ss-border bg-ss-bg p-2.5 text-[13px] text-ss-text focus:border-ss-accent focus:outline-none"
                />
                <p v-if="error" class="text-[11px] text-ss-neg">{{ error }}</p>
                <button
                    type="button"
                    class="rounded-lg bg-ss-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                    :disabled="saving || !text.trim()"
                    @click="save"
                >
                    {{ saving ? 'Saving…' : 'Save message' }}
                </button>
            </div>
        </template>
    </div>
</template>
