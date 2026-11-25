<script setup lang="ts">
import {
    CircleAlert,
    FileSpreadsheet,
    FileUp,
    LoaderCircle,
    X,
} from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ofApi } from '@/lib/onlyfans';
import type { ScriptImportResult } from '@/types/crm';

/**
 * Import scripts from a CreatorHero Scripts → Export CSV. Picking a file posts it for a
 * server-side PREVIEW (nothing written); Import posts it again with commit. Scripts whose name
 * already exists for the creator are skipped, never merged. The file is held only in this
 * modal's state for those two requests and dropped when it closes — never stored.
 */
const props = defineProps<{ modelId: number; modelName: string }>();
const emit = defineEmits<{ imported: [res: ScriptImportResult]; close: [] }>();

const input = ref<HTMLInputElement | null>(null);
const file = ref<File | null>(null);
const preview = ref<ScriptImportResult | null>(null);
const phase = ref<'idle' | 'previewing' | 'importing'>('idle');
const error = ref<string | null>(null);

const toCreate = computed(
    () => preview.value?.scripts.filter((s) => !s.skipped) ?? [],
);
const newSteps = computed(() =>
    toCreate.value.reduce((n, s) => n + s.steps, 0),
);
const newNeeds = computed(() =>
    toCreate.value.reduce((n, s) => n + s.needsMedia, 0),
);

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function choose() {
    input.value?.click();
}

async function onPick(e: Event) {
    const el = e.target as HTMLInputElement;
    const picked = el.files?.[0] ?? null;
    el.value = ''; // so picking the same file again still fires `change`

    if (!picked) {
        return;
    }

    file.value = picked;
    preview.value = null;
    error.value = null;
    phase.value = 'previewing';

    try {
        preview.value = await ofApi.importScripts(props.modelId, picked, false);
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
        file.value = null;
    } finally {
        phase.value = 'idle';
    }
}

async function commit() {
    if (!file.value || !toCreate.value.length || phase.value !== 'idle') {
        return;
    }

    phase.value = 'importing';
    error.value = null;

    try {
        const res = await ofApi.importScripts(props.modelId, file.value, true);
        file.value = null;
        emit('imported', res);
    } catch (err) {
        error.value = err instanceof Error ? err.message : String(err);
    } finally {
        phase.value = 'idle';
    }
}

function close() {
    if (phase.value !== 'importing') {
        file.value = null;
        emit('close');
    }
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        close();
    }
}
onMounted(() => document.addEventListener('keydown', onKey));
onBeforeUnmount(() => document.removeEventListener('keydown', onKey));
</script>

<template>
    <div
        class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 font-ss"
        @click.self="close"
    >
        <div
            class="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-ss-border bg-ss-surface shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="script-import-title"
            data-testid="script-import-modal"
        >
            <div class="flex items-start gap-2 border-b border-ss-border p-4">
                <div class="min-w-0">
                    <p
                        id="script-import-title"
                        class="text-[14px] font-semibold text-ss-text"
                    >
                        Import scripts from CreatorHero
                    </p>
                    <p class="mt-0.5 text-[12px] text-ss-text-3">
                        In CreatorHero: Creator Settings → Scripts → Export.
                        Imports into {{ props.modelName }}.
                    </p>
                </div>
                <span class="flex-1" />
                <button
                    type="button"
                    class="grid h-7 w-7 place-items-center rounded text-ss-text-3 hover:bg-ss-surface-2 focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none"
                    aria-label="Close"
                    @click="close"
                >
                    <X :size="15" />
                </button>
            </div>

            <input
                ref="input"
                type="file"
                accept=".csv,text/csv"
                class="sr-only"
                tabindex="-1"
                aria-hidden="true"
                data-testid="script-import-file"
                @change="onPick"
            />

            <div class="min-h-0 flex-1 overflow-y-auto p-4">
                <!-- Pick a file -->
                <button
                    v-if="!preview"
                    type="button"
                    class="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-ss-border bg-ss-surface-2 px-4 py-8 text-center transition-colors hover:border-ss-accent focus-visible:border-ss-accent focus-visible:ring-2 focus-visible:ring-ss-accent/30 focus-visible:outline-none disabled:pointer-events-none"
                    :disabled="phase === 'previewing'"
                    @click="choose"
                >
                    <LoaderCircle
                        v-if="phase === 'previewing'"
                        :size="22"
                        class="animate-spin text-ss-text-3"
                    />
                    <FileSpreadsheet
                        v-else
                        :size="22"
                        class="text-ss-accent-text"
                    />
                    <span class="text-[13px] font-semibold text-ss-text">
                        {{
                            phase === 'previewing'
                                ? `Reading ${file?.name ?? 'the file'}…`
                                : 'Choose the exported CSV'
                        }}
                    </span>
                    <span class="text-[12px] text-ss-text-3">
                        .csv, up to 1 MB. Nothing is saved until you click
                        Import.
                    </span>
                </button>

                <!-- Preview -->
                <template v-else>
                    <p
                        class="text-[13px] text-ss-text"
                        data-testid="script-import-summary"
                    >
                        <span class="font-semibold">{{
                            plural(preview.totals.scripts, 'folder')
                        }}</span
                        >, {{ plural(preview.totals.steps, 'script')
                        }}<template v-if="preview.totals.needsMedia"
                            >; {{ preview.totals.needsMedia }} need
                            media</template
                        ><template v-if="preview.totals.skipped">
                            · {{ preview.totals.skipped }} already exist{{
                                preview.totals.skipped === 1 ? 's' : ''
                            }}
                            and will be skipped</template
                        >.
                    </p>
                    <p class="mt-0.5 truncate text-[12px] text-ss-text-3">
                        {{ file?.name }}
                    </p>

                    <div
                        class="mt-3 overflow-hidden rounded-lg border border-ss-border"
                    >
                        <table class="w-full table-fixed text-left text-[12px]">
                            <thead
                                class="bg-ss-surface-2 text-[11px] font-semibold tracking-wide text-ss-text-3 uppercase"
                            >
                                <tr>
                                    <th class="px-3 py-2 font-semibold">
                                        Folder
                                    </th>
                                    <th
                                        class="w-16 px-3 py-2 text-right font-semibold"
                                    >
                                        Scripts
                                    </th>
                                    <th
                                        class="w-28 px-3 py-2 text-right font-semibold"
                                    >
                                        Need media
                                    </th>
                                    <th class="w-48 px-3 py-2 font-semibold">
                                        Status
                                    </th>
                                </tr>
                            </thead>
                            <tbody>
                                <tr
                                    v-for="s in preview.scripts"
                                    :key="s.name"
                                    class="border-t border-ss-border"
                                    :class="s.skipped ? 'text-ss-text-3' : ''"
                                >
                                    <td
                                        class="truncate px-3 py-1.5 font-medium"
                                        :class="s.skipped ? '' : 'text-ss-text'"
                                        :title="s.name"
                                    >
                                        {{ s.name }}
                                    </td>
                                    <td
                                        class="px-3 py-1.5 text-right text-ss-text-2 tabular-nums"
                                    >
                                        {{ s.steps }}
                                    </td>
                                    <td
                                        class="px-3 py-1.5 text-right tabular-nums"
                                        :class="
                                            s.needsMedia && !s.skipped
                                                ? 'font-semibold text-ss-warn'
                                                : 'text-ss-text-3'
                                        "
                                    >
                                        {{ s.needsMedia || '—' }}
                                    </td>
                                    <td class="px-3 py-1.5 whitespace-nowrap">
                                        <span
                                            v-if="s.skipped"
                                            class="text-ss-text-3"
                                            >Skipped — already exists</span
                                        >
                                        <span
                                            v-else
                                            class="font-medium text-ss-pos"
                                            >New</span
                                        >
                                    </td>
                                </tr>
                            </tbody>
                        </table>
                    </div>

                    <div v-if="preview.warnings.length" class="mt-3">
                        <p
                            class="mb-1 flex items-center gap-1.5 text-[12px] font-semibold text-ss-text-2"
                        >
                            <CircleAlert :size="13" class="text-ss-text-3" />
                            {{ plural(preview.warnings.length, 'note') }} from
                            the file
                        </p>
                        <ul
                            class="max-h-32 space-y-0.5 overflow-y-auto rounded-lg border border-ss-border bg-ss-surface-2 px-3 py-2 text-[12px] [overflow-wrap:anywhere] text-ss-text-2"
                            data-testid="script-import-warnings"
                        >
                            <li v-for="(w, i) in preview.warnings" :key="i">
                                {{ w }}
                            </li>
                        </ul>
                    </div>

                    <p
                        v-if="newNeeds"
                        class="mt-3 text-[12px] leading-relaxed text-ss-text-2"
                    >
                        CreatorHero’s export has no media, so
                        {{ plural(newNeeds, 'script') }} with a price or a
                        (PPV)/(FREE) title come in as
                        <span class="font-semibold text-ss-warn"
                            >Needs media</span
                        >
                        — price kept, not loadable in chat until you attach
                        media in the script editor.
                    </p>
                </template>

                <p
                    v-if="error"
                    class="mt-3 rounded-lg border border-ss-neg/30 bg-ss-neg/10 px-3 py-2 text-[12px] text-ss-neg"
                    role="alert"
                >
                    {{ error }}
                </p>
            </div>

            <div class="flex items-center gap-2 border-t border-ss-border p-3">
                <button
                    v-if="preview"
                    type="button"
                    class="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-ss-text-2 hover:bg-ss-surface-2 focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none disabled:opacity-50"
                    :disabled="phase !== 'idle'"
                    @click="choose"
                >
                    <FileUp :size="13" /> Choose another file
                </button>
                <span class="flex-1" />
                <button
                    type="button"
                    class="rounded-lg border border-ss-border px-3 py-1.5 text-[12px] font-semibold text-ss-text-2 hover:bg-ss-surface-2 focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none disabled:opacity-50"
                    :disabled="phase === 'importing'"
                    @click="close"
                >
                    Cancel
                </button>
                <button
                    type="button"
                    class="flex items-center gap-1.5 rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ss-surface focus-visible:outline-none disabled:opacity-50"
                    :disabled="!preview || !toCreate.length || phase !== 'idle'"
                    data-testid="script-import-commit"
                    @click="commit"
                >
                    <LoaderCircle
                        v-if="phase === 'importing'"
                        :size="13"
                        class="animate-spin"
                    />
                    {{
                        preview && !toCreate.length
                            ? 'Nothing new to import'
                            : toCreate.length
                              ? `Import ${plural(toCreate.length, 'folder')} (${plural(newSteps, 'script')})`
                              : 'Import'
                    }}
                </button>
            </div>
        </div>
    </div>
</template>
