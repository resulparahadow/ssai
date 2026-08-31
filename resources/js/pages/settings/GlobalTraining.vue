<script setup lang="ts">
import { Head, router } from '@inertiajs/vue3';
import * as pdfjs from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { computed, ref } from 'vue';

pdfjs.GlobalWorkerOptions.workerSrc = pdfWorker;

const props = defineProps<{
    content: string;
    version: string;
    shaShort: string;
    words: number;
    integrity: { ok: boolean; reason: string; missing: string[] };
    isDefault: boolean;
    updatedAt: string | null;
}>();

const content = ref(props.content);
const saving = ref(false);
const resetting = ref(false);

// Live word count as the admin edits (server re-checks on save).
const wordCount = computed(() =>
    content.value.trim() ? content.value.trim().split(/\s+/).length : 0,
);
const dirty = computed(() => content.value !== props.content);

// Typed override for saving an integrity-failing doctrine ("SAVE ANYWAY").
const contentError = ref('');
const forcePhrase = ref('');
const canForce = computed(() => forcePhrase.value.trim() === 'SAVE ANYWAY');

function save(force = false) {
    saving.value = true;
    router.put(
        '/settings/global-training',
        { content: content.value, force },
        {
            preserveScroll: true,
            onSuccess: () => {
                contentError.value = '';
                forcePhrase.value = '';
            },
            onError: (errors) => {
                contentError.value =
                    (errors as Record<string, string>).content ?? '';
            },
            onFinish: () => {
                saving.value = false;
            },
        },
    );
}

// Typed confirm for reverting to the engine default ("RESET DOCTRINE").
const showReset = ref(false);
const resetPhrase = ref('');
const canReset = computed(() => resetPhrase.value.trim() === 'RESET DOCTRINE');

function reset() {
    resetting.value = true;
    router.post(
        '/settings/global-training/reset',
        {},
        {
            preserveScroll: true,
            onFinish: () => {
                resetting.value = false;
                showReset.value = false;
                resetPhrase.value = '';
            },
        },
    );
}

// Client-side PDF text extraction (mirrors legacy extractPdf) — fills the textarea,
// does NOT auto-save. The admin reviews then Saves.
const pdfStatus = ref('');
const pdfError = ref(false);

async function onPdfInput(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];

    if (file) {
        await extractPdf(file);
    }
}

async function onPdfDrop(e: DragEvent) {
    const file = e.dataTransfer?.files?.[0];

    if (!file) {
        return;
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
        pdfError.value = true;
        pdfStatus.value = 'PDF files only';

        return;
    }

    await extractPdf(file);
}

async function extractPdf(file: File) {
    pdfError.value = false;
    pdfStatus.value = 'Reading PDF…';

    try {
        const buffer = await file.arrayBuffer();
        const pdf = await pdfjs.getDocument({ data: buffer }).promise;
        let text = `TRAINING DOCUMENT: ${file.name}\n\n`;

        for (let i = 1; i <= pdf.numPages; i++) {
            const pageObj = await pdf.getPage(i);
            const textContent = await pageObj.getTextContent();
            text +=
                textContent.items
                    .map((item) => ('str' in item ? item.str : ''))
                    .join(' ') + '\n';
        }

        content.value = text;
        pdfStatus.value = `✓ Extracted ${pdf.numPages} pages from ${file.name}`;
    } catch (err) {
        pdfError.value = true;
        pdfStatus.value =
            'Error reading PDF: ' +
            (err instanceof Error ? err.message : String(err));
    }
}
</script>

<template>
    <Head title="Global training" />

    <h1 class="sr-only">Global training</h1>

    <div class="space-y-6">
        <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
            <div class="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                    <h3 class="text-sm font-semibold text-ss-text">
                        Global training
                    </h3>
                    <p class="max-w-2xl text-sm text-ss-text-2">
                        The global agency knowledge base — Layer 1 injected into
                        every AI generation. Model prompts are loaded on top and
                        override these rules. Changes apply agency-wide.
                    </p>
                </div>
                <span
                    class="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium"
                    :class="
                        isDefault
                            ? 'bg-ss-surface-2 text-ss-text-2'
                            : 'bg-ss-accent-soft text-ss-accent-text'
                    "
                >
                    {{ isDefault ? 'Default (canonical)' : 'Custom edit' }}
                </span>
            </div>

            <!-- Status row -->
            <div
                class="mb-4 flex flex-wrap gap-x-6 gap-y-1 text-xs text-ss-text-2"
            >
                <span
                    >Version:
                    <strong class="text-ss-text">{{ version }}</strong></span
                >
                <span
                    >Words:
                    <strong class="text-ss-text">{{ wordCount }}</strong></span
                >
                <span
                    >SHA:
                    <strong class="font-mono text-ss-text"
                        >{{ shaShort }}…</strong
                    ></span
                >
                <span v-if="updatedAt"
                    >Updated: {{ new Date(updatedAt).toLocaleString() }}</span
                >
                <span
                    :class="
                        integrity.ok ? 'text-emerald-500' : 'text-amber-500'
                    "
                >
                    {{
                        integrity.ok
                            ? '✓ integrity ok'
                            : `⚠ ${integrity.reason}`
                    }}
                </span>
            </div>

            <!-- PDF upload -->
            <div class="mb-4">
                <label
                    class="flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-ss-border px-4 py-5 text-center text-sm text-ss-text-2 hover:bg-ss-surface-2"
                    @dragover.prevent
                    @drop.prevent="onPdfDrop"
                >
                    <span
                        >Click or drop a training PDF to extract its text</span
                    >
                    <span class="text-xs"
                        >Extracted text fills the box below — review, then
                        Save.</span
                    >
                    <input
                        type="file"
                        accept="application/pdf"
                        class="hidden"
                        @change="onPdfInput"
                    />
                </label>
                <p
                    v-if="pdfStatus"
                    class="mt-1.5 text-xs"
                    :class="pdfError ? 'text-red-500' : 'text-ss-text-2'"
                >
                    {{ pdfStatus }}
                </p>
            </div>

            <!-- Editor -->
            <textarea
                v-model="content"
                spellcheck="false"
                class="min-h-[420px] w-full rounded-lg border border-ss-border bg-ss-surface-2 p-3 font-mono text-xs leading-relaxed text-ss-text focus:border-ss-accent focus:outline-none"
            ></textarea>

            <!-- Integrity override (only after a rejected save) -->
            <div
                v-if="contentError"
                class="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
            >
                <p class="font-medium text-amber-600 dark:text-amber-400">
                    Integrity check failed: {{ contentError }}
                </p>
                <p class="mt-1 text-ss-text-2">
                    Saving an incomplete brain degrades AI behavior across all
                    sessions. To override, type
                    <strong>SAVE ANYWAY</strong> below.
                </p>
                <div class="mt-2 flex items-center gap-2">
                    <input
                        v-model="forcePhrase"
                        type="text"
                        placeholder="SAVE ANYWAY"
                        class="rounded-lg border border-ss-border bg-ss-surface px-2 py-1 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                    />
                    <button
                        type="button"
                        :disabled="!canForce || saving"
                        class="rounded-lg bg-amber-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-40"
                        @click="save(true)"
                    >
                        Save anyway
                    </button>
                </div>
            </div>

            <!-- Actions -->
            <div class="mt-4 flex flex-wrap items-center gap-3">
                <button
                    type="button"
                    :disabled="saving || !dirty"
                    class="rounded-lg bg-ss-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                    @click="save(false)"
                >
                    {{ saving ? 'Saving…' : 'Save training' }}
                </button>
                <button
                    type="button"
                    class="rounded-lg border border-ss-border px-4 py-2 text-sm text-ss-text-2 hover:bg-ss-surface-2"
                    @click="showReset = !showReset"
                >
                    Reset to default
                </button>
                <span v-if="dirty" class="text-xs text-ss-text-2"
                    >Unsaved changes</span
                >
            </div>

            <!-- Reset typed confirm -->
            <div
                v-if="showReset"
                class="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm"
            >
                <p class="text-ss-text-2">
                    This reverts generation to the canonical default doctrine.
                    Type <strong>RESET DOCTRINE</strong> to confirm.
                </p>
                <div class="mt-2 flex items-center gap-2">
                    <input
                        v-model="resetPhrase"
                        type="text"
                        placeholder="RESET DOCTRINE"
                        class="rounded-lg border border-ss-border bg-ss-surface px-2 py-1 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                    />
                    <button
                        type="button"
                        :disabled="!canReset || resetting"
                        class="rounded-lg bg-red-600 px-3 py-1 text-sm font-medium text-white disabled:opacity-40"
                        @click="reset"
                    >
                        {{ resetting ? 'Resetting…' : 'Reset to default' }}
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
