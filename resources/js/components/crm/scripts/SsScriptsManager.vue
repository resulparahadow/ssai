<script setup lang="ts">
import {
    ArrowDown,
    ArrowUp,
    ChevronRight,
    CircleAlert,
    FileUp,
    Folder,
    FolderOpen,
    GripVertical,
    Image as ImageIcon,
    LoaderCircle,
    Pencil,
    Plus,
    RefreshCw,
    Search,
    Trash2,
    X,
} from '@lucide/vue';
import { computed, onMounted, ref } from 'vue';
import SsScriptStepModal from '@/components/crm/conversations/SsScriptStepModal.vue';
import SsScriptImportModal from '@/components/crm/scripts/SsScriptImportModal.vue';
import { scriptsCache } from '@/lib/conversationCache';
import { usd } from '@/lib/money';
import { ofApi } from '@/lib/onlyfans';
import type { Script, ScriptImportResult, ScriptStep } from '@/types/crm';

/**
 * The Scripts page's library: scripts as expandable folders, their steps as indented rows
 * (CreatorHero's Settings → Scripts table). Search over step title + text (and script name),
 * create / rename / delete scripts, add / edit / delete steps (the shared SsScriptStepModal),
 * reorder both by drag or ↑/↓, and the CreatorHero CSV import.
 *
 * Every write refetches the whole library (one local DB call) and writes it into
 * `scriptsCache`, so the composer's Scripts panel opens on the fresh list, not a stale one.
 */
const props = defineProps<{ modelId: number; modelName: string }>();

const scripts = ref<Script[]>(scriptsCache.get(props.modelId) ?? []);
const loading = ref(false);
const loaded = ref(scriptsCache.has(props.modelId));
const error = ref<string | null>(null);
const query = ref('');
const open = ref(new Set<number>());
const busy = ref<string | null>(null); // 's:{id}' / 't:{id}' / 'new' while a write runs
const renaming = ref<number | null>(null);
const renameText = ref('');
const creating = ref(false);
const newName = ref('');
const editor = ref<{ step: ScriptStep | null; scriptId: number } | null>(null);
const showImport = ref(false);
const notice = ref<string | null>(null); // the last import's summary

let token = 0;

async function load() {
    const mine = ++token;
    loading.value = true;
    error.value = null;

    try {
        const res = await ofApi.scripts(props.modelId);

        if (mine !== token) {
            return;
        }

        scripts.value = res.scripts;
        scriptsCache.set(props.modelId, res.scripts);
        loaded.value = true;
    } catch (e) {
        if (mine === token) {
            error.value = e instanceof Error ? e.message : String(e);
        }
    } finally {
        if (mine === token) {
            loading.value = false;
        }
    }
}

onMounted(load);

/** Run a write, then refetch the library rather than patch it. */
async function write(key: string, fn: () => Promise<unknown>) {
    busy.value = key;
    error.value = null;

    try {
        await fn();
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        busy.value = null;
    }

    await load();
}

// ---- search ---------------------------------------------------------------------

const q = computed(() => query.value.trim().toLowerCase());
const searching = computed(() => q.value !== '');

function stepMatches(step: ScriptStep): boolean {
    return (
        step.title.toLowerCase().includes(q.value) ||
        (step.text ?? '').toLowerCase().includes(q.value)
    );
}

/** Scripts to show, each with the steps to show. A script-name hit shows all its steps. */
const view = computed(() => {
    if (!searching.value) {
        return scripts.value.map((s) => ({ script: s, steps: s.steps }));
    }

    return scripts.value
        .map((s) => ({
            script: s,
            steps: s.name.toLowerCase().includes(q.value)
                ? s.steps
                : s.steps.filter(stepMatches),
        }))
        .filter(
            (v) =>
                v.steps.length > 0 ||
                v.script.name.toLowerCase().includes(q.value),
        );
});

const matchCount = computed(() =>
    view.value.reduce((n, v) => n + v.steps.length, 0),
);

function isOpen(id: number): boolean {
    return searching.value || open.value.has(id);
}

function toggle(id: number) {
    const next = new Set(open.value);

    if (next.has(id)) {
        next.delete(id);
    } else {
        next.add(id);
    }

    open.value = next;
}

const allOpen = computed(
    () =>
        scripts.value.length > 0 &&
        scripts.value.every((s) => open.value.has(s.id)),
);

function toggleAll() {
    open.value = allOpen.value
        ? new Set()
        : new Set(scripts.value.map((s) => s.id));
}

// ---- row display ----------------------------------------------------------------

function needsMediaCount(s: Script): number {
    return s.steps.filter((st) => st.needsMedia).length;
}

// needsMedia first: the server's kind() says 'text' for a needs-media priced step.
function kindLabel(step: ScriptStep): string {
    if (step.needsMedia) {
        return 'Needs media';
    }

    return { text: 'Text', free: 'Free', ppv: 'PPV' }[step.kind];
}

function kindClass(step: ScriptStep): string {
    if (step.needsMedia) {
        return 'bg-ss-warn/15 text-ss-warn';
    }

    if (step.kind === 'ppv') {
        return 'bg-ss-accent-soft text-ss-accent-text';
    }

    return step.kind === 'free'
        ? 'border border-ss-border text-ss-text-2'
        : 'text-ss-text-3';
}

function priceLabel(step: ScriptStep): string {
    return step.price > 0 ? usd(step.price) : '—';
}

// ---- scripts --------------------------------------------------------------------

function startCreate() {
    creating.value = true;
    newName.value = '';
}

function createScript() {
    const name = newName.value.trim();

    if (!name) {
        return;
    }

    creating.value = false;
    void write('new', async () => {
        const res = await ofApi.createScript(props.modelId, name);
        open.value = new Set([...open.value, res.script.id]); // next move: add steps
    });
}

function startRename(s: Script) {
    renaming.value = s.id;
    renameText.value = s.name;
}

function saveRename(s: Script) {
    if (renaming.value !== s.id) {
        return; // Enter already saved; this is the blur of the input going away
    }

    const name = renameText.value.trim();
    renaming.value = null;

    if (!name || name === s.name) {
        return;
    }

    void write(`s:${s.id}`, () =>
        ofApi.renameScript(props.modelId, s.id, name),
    );
}

function deleteScript(s: Script) {
    const n = s.steps.length;

    if (
        !window.confirm(
            `Delete "${s.name}" and its ${n} step${n === 1 ? '' : 's'}? Send history is kept.`,
        )
    ) {
        return;
    }

    void write(`s:${s.id}`, () => ofApi.deleteScript(props.modelId, s.id));
}

function deleteStep(step: ScriptStep) {
    if (
        !window.confirm(
            `Delete the step "${step.title}"? Send history is kept.`,
        )
    ) {
        return;
    }

    void write(`t:${step.id}`, () => ofApi.deleteStep(props.modelId, step.id));
}

// ---- reorder (↑/↓ always, drag when not searching) --------------------------------
// Orders are always computed on the FULL list: the server renumbers from the ids it gets, so
// sending a search-filtered list would scramble the rest.

function moved(ids: number[], from: number, to: number): number[] | null {
    if (from === to || from < 0 || to < 0 || to >= ids.length) {
        return null;
    }

    const next = [...ids];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);

    return next;
}

function moveScript(s: Script, to: number) {
    const ids = scripts.value.map((x) => x.id);
    const next = moved(ids, ids.indexOf(s.id), to);

    if (next) {
        void write(`s:${s.id}`, () =>
            ofApi.reorderScripts(props.modelId, next),
        );
    }
}

function moveStep(s: Script, step: ScriptStep, to: number) {
    const ids = s.steps.map((x) => x.id);
    const next = moved(ids, ids.indexOf(step.id), to);

    if (next) {
        void write(`t:${step.id}`, () =>
            ofApi.reorderSteps(props.modelId, s.id, next),
        );
    }
}

function scriptIndex(s: Script): number {
    return scripts.value.findIndex((x) => x.id === s.id);
}

function stepIndex(s: Script, step: ScriptStep): number {
    return s.steps.findIndex((x) => x.id === step.id);
}

// Native HTML drag: a script row drops onto another script row, a step onto a step of the
// SAME script (moving between scripts is the editor's Script field).
type Drag =
    | { kind: 's'; id: number }
    | { kind: 't'; id: number; script: number };
const drag = ref<Drag | null>(null);
const dropKey = ref<string | null>(null);

function onDragStart(e: DragEvent, d: Drag) {
    drag.value = d;
    e.dataTransfer?.setData('text/plain', `${d.kind}:${d.id}`);

    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
    }
}

function canDrop(kind: 's' | 't', scriptId: number): boolean {
    const d = drag.value;

    return !!d && d.kind === kind && (d.kind === 's' || d.script === scriptId);
}

function onDragOver(
    e: DragEvent,
    key: string,
    kind: 's' | 't',
    scriptId: number,
) {
    if (canDrop(kind, scriptId)) {
        e.preventDefault();
        dropKey.value = key;
    }
}

function onDrop(s: Script, step: ScriptStep | null) {
    const d = drag.value;
    drag.value = null;
    dropKey.value = null;

    if (!d) {
        return;
    }

    if (d.kind === 's' && !step) {
        const from = scripts.value.find((x) => x.id === d.id);

        if (from) {
            moveScript(from, scriptIndex(s));
        }
    } else if (d.kind === 't' && step && d.script === s.id) {
        const from = s.steps.find((x) => x.id === d.id);

        if (from) {
            moveStep(s, from, stepIndex(s, step));
        }
    }
}

function onDragEnd() {
    drag.value = null;
    dropKey.value = null;
}

// ---- editor + import --------------------------------------------------------------

const scriptOptions = computed(() =>
    scripts.value.map((s) => ({ id: s.id, name: s.name })),
);

function onSaved() {
    editor.value = null;
    void load();
}

function onImported(res: ScriptImportResult) {
    showImport.value = false;
    const made = res.scripts.filter((s) => !s.skipped);
    const steps = made.reduce((n, s) => n + s.steps, 0);
    const needs = made.reduce((n, s) => n + s.needsMedia, 0);
    const parts = [
        `Imported ${made.length} script${made.length === 1 ? '' : 's'} (${steps} step${steps === 1 ? '' : 's'}).`,
    ];

    if (res.totals.skipped) {
        parts.push(
            `${res.totals.skipped} skipped — a script with that name already exists.`,
        );
    }

    if (needs) {
        parts.push(
            `${needs} step${needs === 1 ? '' : 's'} need${needs === 1 ? 's' : ''} media before chatters can use ${needs === 1 ? 'it' : 'them'}.`,
        );
    }

    notice.value = parts.join(' ');
    void load();
}

// Focus an input as it appears (`autofocus` only works on page load).
const vFocus = { mounted: (el: HTMLElement) => el.focus() };

const ICON_BTN =
    'grid h-7 w-7 place-items-center rounded-md text-ss-text-3 transition-colors hover:bg-ss-surface-2 hover:text-ss-text focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30';
const ICON_DANGER =
    'grid h-7 w-7 place-items-center rounded-md text-ss-text-3 transition-colors hover:bg-ss-neg/10 hover:text-ss-neg focus-visible:ring-2 focus-visible:ring-ss-neg focus-visible:outline-none disabled:pointer-events-none disabled:opacity-30';
const BTN =
    'flex h-8 items-center gap-1.5 rounded-lg border border-ss-border px-3 text-[12px] font-semibold text-ss-text-2 transition-colors hover:bg-ss-surface-2 hover:text-ss-text focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none';
const BTN_PRIMARY =
    'flex h-8 items-center gap-1.5 rounded-lg bg-ss-accent px-3 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ss-bg focus-visible:outline-none';
// handle · name · type · media · price · actions
const GRID =
    'grid grid-cols-[1.25rem_minmax(0,1fr)_6.75rem_2.75rem_4rem_10.5rem] items-center gap-x-2 xl:grid-cols-[1.5rem_minmax(0,1fr)_7.5rem_4rem_4.5rem_10.5rem] xl:gap-x-3';
</script>

<template>
    <div class="flex flex-col font-ss" data-testid="scripts-manager">
        <!-- Toolbar -->
        <div class="flex flex-wrap items-center gap-2 px-5 py-3">
            <label class="relative w-full max-w-xs">
                <span class="sr-only">Search scripts</span>
                <Search
                    :size="14"
                    class="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ss-text-3"
                />
                <input
                    v-model="query"
                    type="search"
                    placeholder="Search step titles and text"
                    class="h-8 w-full rounded-lg border border-ss-border bg-ss-surface pr-2.5 pl-8 text-[13px] text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:ring-2 focus:ring-ss-accent/20 focus:outline-none"
                />
            </label>
            <span v-if="searching" class="text-[12px] text-ss-text-3">
                {{ matchCount }} step{{ matchCount === 1 ? '' : 's' }} in
                {{ view.length }} script{{ view.length === 1 ? '' : 's' }}
            </span>
            <span class="flex-1" />
            <button
                type="button"
                :class="ICON_BTN"
                title="Refresh"
                aria-label="Refresh"
                @click="load"
            >
                <RefreshCw
                    :size="14"
                    :class="loading && loaded ? 'animate-spin' : ''"
                />
            </button>
            <button type="button" :class="BTN" @click="showImport = true">
                <FileUp :size="14" /> Import CSV
            </button>
            <button type="button" :class="BTN_PRIMARY" @click="startCreate">
                <Plus :size="14" /> New script
            </button>
        </div>

        <div
            v-if="notice"
            class="mx-5 mb-3 flex items-start gap-2 rounded-lg border border-ss-pos/30 bg-ss-pos/10 px-3 py-2 text-[12px] text-ss-text"
            role="status"
            data-testid="import-notice"
        >
            <span class="min-w-0 flex-1">{{ notice }}</span>
            <button
                type="button"
                class="grid h-5 w-5 place-items-center rounded text-ss-text-3 hover:text-ss-text focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none"
                aria-label="Dismiss"
                @click="notice = null"
            >
                <X :size="13" />
            </button>
        </div>

        <p
            v-if="error"
            class="mx-5 mb-3 rounded-lg border border-ss-neg/30 bg-ss-neg/10 px-3 py-2 text-[12px] text-ss-neg"
            role="alert"
        >
            {{ error }}
        </p>

        <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
            <!-- First load -->
            <div
                v-if="loading && !loaded"
                class="grid place-items-center py-16"
            >
                <LoaderCircle :size="20" class="animate-spin text-ss-text-3" />
            </div>

            <!-- Empty library -->
            <div
                v-else-if="loaded && !scripts.length && !creating"
                class="mx-auto mt-10 flex max-w-sm flex-col items-center text-center"
                data-testid="scripts-empty"
            >
                <div
                    class="grid h-12 w-12 place-items-center rounded-2xl bg-ss-accent-soft text-ss-accent-text"
                >
                    <Folder :size="22" />
                </div>
                <h2 class="mt-3 text-[15px] font-semibold text-ss-text">
                    No scripts yet
                </h2>
                <p class="mt-1 text-[13px] leading-relaxed text-ss-text-2">
                    A script is an ordered run of messages — text, free media
                    and PPVs — that chatters send fan by fan. Build one here, or
                    bring {{ props.modelName }}’s scripts over from CreatorHero.
                </p>
                <div class="mt-4 flex gap-2">
                    <button
                        type="button"
                        :class="BTN"
                        @click="showImport = true"
                    >
                        <FileUp :size="14" /> Import CSV
                    </button>
                    <button
                        type="button"
                        :class="BTN_PRIMARY"
                        @click="startCreate"
                    >
                        <Plus :size="14" /> New script
                    </button>
                </div>
            </div>

            <div
                v-else-if="loaded"
                class="overflow-hidden rounded-xl border border-ss-border bg-ss-surface"
                role="table"
                aria-label="Scripts"
            >
                <!-- Header -->
                <div
                    :class="GRID"
                    class="border-b border-ss-border bg-ss-surface-2 px-3 py-2 text-[11px] font-semibold tracking-wide text-ss-text-3 uppercase"
                    role="row"
                >
                    <span role="columnheader"
                        ><span class="sr-only">Order</span></span
                    >
                    <span role="columnheader" class="flex items-center gap-2">
                        Script / step
                        <button
                            v-if="!searching && scripts.length"
                            type="button"
                            class="rounded px-1 text-[11px] font-medium tracking-normal text-ss-accent-text normal-case hover:underline focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none"
                            @click="toggleAll"
                        >
                            {{ allOpen ? 'Collapse all' : 'Expand all' }}
                        </button>
                    </span>
                    <span role="columnheader">Type</span>
                    <span role="columnheader" class="text-right">Media</span>
                    <span role="columnheader" class="text-right">Price</span>
                    <span role="columnheader"
                        ><span class="sr-only">Actions</span></span
                    >
                </div>

                <!-- New script (inline) -->
                <form
                    v-if="creating"
                    :class="GRID"
                    class="border-b border-ss-border bg-ss-accent-soft/40 px-3 py-2"
                    @submit.prevent="createScript"
                >
                    <span />
                    <span class="flex items-center gap-2">
                        <Folder :size="15" class="shrink-0 text-ss-text-3" />
                        <input
                            v-model="newName"
                            v-focus
                            type="text"
                            maxlength="120"
                            aria-label="New script name"
                            placeholder="Script name, e.g. Master Script"
                            class="h-7 w-full max-w-sm rounded-md border border-ss-accent bg-ss-surface px-2 text-[13px] text-ss-text focus:ring-2 focus:ring-ss-accent/20 focus:outline-none"
                            @keydown.esc="creating = false"
                        />
                    </span>
                    <span class="col-span-4 flex justify-end gap-1.5">
                        <button
                            type="button"
                            class="h-7 rounded-md px-2.5 text-[12px] font-semibold text-ss-text-2 hover:bg-ss-surface-2 focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none"
                            @click="creating = false"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            :disabled="!newName.trim()"
                            class="h-7 rounded-md bg-ss-accent px-2.5 text-[12px] font-semibold text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none disabled:opacity-50"
                        >
                            Create
                        </button>
                    </span>
                </form>

                <p
                    v-if="searching && !view.length"
                    class="px-4 py-8 text-center text-[13px] text-ss-text-3"
                >
                    No step matches “{{ query.trim() }}”.
                </p>

                <div
                    v-for="v in view"
                    :key="v.script.id"
                    class="border-b border-ss-border last:border-b-0"
                    role="rowgroup"
                    :data-testid="`script-${v.script.id}`"
                >
                    <!-- Script (folder) row -->
                    <div
                        :class="[
                            GRID,
                            dropKey === `s:${v.script.id}`
                                ? 'shadow-[inset_0_2px_0_var(--ss-accent)]'
                                : '',
                            drag?.kind === 's' && drag.id === v.script.id
                                ? 'opacity-50'
                                : '',
                        ]"
                        class="group px-3 py-1.5 hover:bg-ss-surface-2/60"
                        role="row"
                        @dragover="
                            onDragOver(
                                $event,
                                `s:${v.script.id}`,
                                's',
                                v.script.id,
                            )
                        "
                        @dragleave="dropKey = null"
                        @drop.prevent="onDrop(v.script, null)"
                    >
                        <span
                            class="grid h-7 place-items-center text-ss-text-3"
                            :class="
                                searching
                                    ? 'opacity-30'
                                    : 'cursor-grab active:cursor-grabbing'
                            "
                            :draggable="!searching"
                            :title="
                                searching
                                    ? 'Clear the search to reorder'
                                    : 'Drag to reorder'
                            "
                            aria-hidden="true"
                            @dragstart="
                                onDragStart($event, {
                                    kind: 's',
                                    id: v.script.id,
                                })
                            "
                            @dragend="onDragEnd"
                        >
                            <GripVertical :size="14" />
                        </span>

                        <span class="flex min-w-0 items-center gap-1.5">
                            <template v-if="renaming === v.script.id">
                                <FolderOpen
                                    :size="15"
                                    class="ml-6 shrink-0 text-ss-text-3"
                                />
                                <input
                                    v-model="renameText"
                                    v-focus
                                    type="text"
                                    maxlength="120"
                                    aria-label="Script name"
                                    class="h-7 w-full max-w-sm rounded-md border border-ss-accent bg-ss-surface px-2 text-[13px] text-ss-text focus:ring-2 focus:ring-ss-accent/20 focus:outline-none"
                                    @keydown.enter.prevent="
                                        saveRename(v.script)
                                    "
                                    @keydown.esc="renaming = null"
                                    @blur="saveRename(v.script)"
                                />
                            </template>
                            <button
                                v-else
                                type="button"
                                class="flex min-w-0 items-center gap-1.5 rounded-md py-1 pr-2 text-left focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none"
                                :aria-expanded="isOpen(v.script.id)"
                                @click="toggle(v.script.id)"
                            >
                                <ChevronRight
                                    :size="15"
                                    class="shrink-0 text-ss-text-3 transition-transform"
                                    :class="
                                        isOpen(v.script.id) ? 'rotate-90' : ''
                                    "
                                />
                                <component
                                    :is="
                                        isOpen(v.script.id)
                                            ? FolderOpen
                                            : Folder
                                    "
                                    :size="15"
                                    class="shrink-0 text-ss-accent-text"
                                />
                                <span
                                    class="truncate text-[13px] font-semibold text-ss-text"
                                    >{{ v.script.name }}</span
                                >
                                <span
                                    class="shrink-0 text-[12px] text-ss-text-3 tabular-nums"
                                    >{{ v.script.steps.length }} step{{
                                        v.script.steps.length === 1 ? '' : 's'
                                    }}</span
                                >
                            </button>
                            <LoaderCircle
                                v-if="busy === `s:${v.script.id}`"
                                :size="13"
                                class="shrink-0 animate-spin text-ss-text-3"
                            />
                        </span>

                        <span>
                            <span
                                v-if="needsMediaCount(v.script)"
                                class="inline-flex items-center gap-1 rounded-full bg-ss-warn/15 px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap text-ss-warn"
                                :title="`${needsMediaCount(v.script)} step(s) were imported without their media`"
                            >
                                <CircleAlert :size="11" />
                                {{ needsMediaCount(v.script) }} need media
                            </span>
                        </span>
                        <span />
                        <span />

                        <span class="flex items-center justify-end gap-0.5">
                            <button
                                type="button"
                                :class="ICON_BTN"
                                :disabled="scriptIndex(v.script) === 0"
                                title="Move up"
                                :aria-label="`Move ${v.script.name} up`"
                                @click="
                                    moveScript(
                                        v.script,
                                        scriptIndex(v.script) - 1,
                                    )
                                "
                            >
                                <ArrowUp :size="14" />
                            </button>
                            <button
                                type="button"
                                :class="ICON_BTN"
                                :disabled="
                                    scriptIndex(v.script) === scripts.length - 1
                                "
                                title="Move down"
                                :aria-label="`Move ${v.script.name} down`"
                                @click="
                                    moveScript(
                                        v.script,
                                        scriptIndex(v.script) + 1,
                                    )
                                "
                            >
                                <ArrowDown :size="14" />
                            </button>
                            <button
                                type="button"
                                :class="ICON_BTN"
                                title="New step"
                                :aria-label="`New step in ${v.script.name}`"
                                @click="
                                    editor = {
                                        step: null,
                                        scriptId: v.script.id,
                                    }
                                "
                            >
                                <Plus :size="14" />
                            </button>
                            <button
                                type="button"
                                :class="ICON_BTN"
                                title="Rename"
                                :aria-label="`Rename ${v.script.name}`"
                                @click="startRename(v.script)"
                            >
                                <Pencil :size="13" />
                            </button>
                            <button
                                type="button"
                                :class="ICON_DANGER"
                                title="Delete script"
                                :aria-label="`Delete ${v.script.name}`"
                                @click="deleteScript(v.script)"
                            >
                                <Trash2 :size="13" />
                            </button>
                        </span>
                    </div>

                    <!-- Steps -->
                    <template v-if="isOpen(v.script.id)">
                        <div
                            v-for="step in v.steps"
                            :key="step.id"
                            :class="[
                                GRID,
                                dropKey === `t:${step.id}`
                                    ? 'shadow-[inset_0_2px_0_var(--ss-accent)]'
                                    : '',
                                drag?.kind === 't' && drag.id === step.id
                                    ? 'opacity-50'
                                    : '',
                            ]"
                            class="border-t border-ss-border/60 bg-ss-surface px-3 py-1.5 hover:bg-ss-surface-2/60"
                            role="row"
                            :data-testid="`step-${step.id}`"
                            @dragover="
                                onDragOver(
                                    $event,
                                    `t:${step.id}`,
                                    't',
                                    v.script.id,
                                )
                            "
                            @dragleave="dropKey = null"
                            @drop.prevent="onDrop(v.script, step)"
                        >
                            <span
                                class="grid h-7 place-items-center text-ss-text-3"
                                :class="
                                    searching
                                        ? 'opacity-30'
                                        : 'cursor-grab active:cursor-grabbing'
                                "
                                :draggable="!searching"
                                :title="
                                    searching
                                        ? 'Clear the search to reorder'
                                        : 'Drag to reorder'
                                "
                                aria-hidden="true"
                                @dragstart="
                                    onDragStart($event, {
                                        kind: 't',
                                        id: step.id,
                                        script: v.script.id,
                                    })
                                "
                                @dragend="onDragEnd"
                            >
                                <GripVertical :size="14" />
                            </span>

                            <span
                                class="flex min-w-0 items-start gap-2 pl-4 xl:pl-7"
                            >
                                <span
                                    class="mt-px w-5 shrink-0 text-right text-[11px] text-ss-text-3 tabular-nums"
                                    >{{ stepIndex(v.script, step) + 1 }}</span
                                >
                                <button
                                    type="button"
                                    class="min-w-0 flex-1 rounded-md text-left focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none"
                                    :title="`Edit ${step.title}`"
                                    @click="
                                        editor = { step, scriptId: v.script.id }
                                    "
                                >
                                    <span
                                        class="block truncate text-[13px] font-medium text-ss-text"
                                        >{{ step.title }}</span
                                    >
                                    <span
                                        class="block truncate text-[12px] text-ss-text-3"
                                        >{{ step.text || '(media only)' }}</span
                                    >
                                </button>
                                <LoaderCircle
                                    v-if="busy === `t:${step.id}`"
                                    :size="13"
                                    class="mt-0.5 shrink-0 animate-spin text-ss-text-3"
                                />
                            </span>

                            <span>
                                <span
                                    class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap"
                                    :class="kindClass(step)"
                                    :data-testid="
                                        step.needsMedia
                                            ? 'needs-media-badge'
                                            : undefined
                                    "
                                    :title="
                                        step.needsMedia
                                            ? 'Imported without its media — chatters can’t load it until you add some'
                                            : undefined
                                    "
                                >
                                    <CircleAlert
                                        v-if="step.needsMedia"
                                        :size="11"
                                    />
                                    {{ kindLabel(step) }}
                                </span>
                            </span>
                            <span
                                class="flex items-center justify-end gap-1 text-[12px] text-ss-text-2 tabular-nums"
                            >
                                <template v-if="step.media.length">
                                    <ImageIcon
                                        :size="12"
                                        class="text-ss-text-3"
                                    />
                                    {{ step.media.length }}
                                </template>
                                <span v-else class="text-ss-text-3">—</span>
                            </span>
                            <span
                                class="text-right text-[12px] tabular-nums"
                                :class="
                                    step.price > 0
                                        ? 'font-semibold text-ss-text'
                                        : 'text-ss-text-3'
                                "
                                >{{ priceLabel(step) }}</span
                            >

                            <span class="flex items-center justify-end gap-0.5">
                                <button
                                    type="button"
                                    :class="ICON_BTN"
                                    :disabled="stepIndex(v.script, step) === 0"
                                    title="Move up"
                                    :aria-label="`Move ${step.title} up`"
                                    @click="
                                        moveStep(
                                            v.script,
                                            step,
                                            stepIndex(v.script, step) - 1,
                                        )
                                    "
                                >
                                    <ArrowUp :size="14" />
                                </button>
                                <button
                                    type="button"
                                    :class="ICON_BTN"
                                    :disabled="
                                        stepIndex(v.script, step) ===
                                        v.script.steps.length - 1
                                    "
                                    title="Move down"
                                    :aria-label="`Move ${step.title} down`"
                                    @click="
                                        moveStep(
                                            v.script,
                                            step,
                                            stepIndex(v.script, step) + 1,
                                        )
                                    "
                                >
                                    <ArrowDown :size="14" />
                                </button>
                                <span class="w-7" />
                                <button
                                    type="button"
                                    :class="ICON_BTN"
                                    title="Edit step"
                                    :aria-label="`Edit ${step.title}`"
                                    @click="
                                        editor = { step, scriptId: v.script.id }
                                    "
                                >
                                    <Pencil :size="13" />
                                </button>
                                <button
                                    type="button"
                                    :class="ICON_DANGER"
                                    title="Delete step"
                                    :aria-label="`Delete ${step.title}`"
                                    @click="deleteStep(step)"
                                >
                                    <Trash2 :size="13" />
                                </button>
                            </span>
                        </div>

                        <div
                            v-if="!searching"
                            class="border-t border-ss-border/60 py-1.5 pr-3 pl-[3.25rem] xl:pl-[4.25rem]"
                        >
                            <button
                                type="button"
                                class="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[12px] font-semibold text-ss-accent-text hover:bg-ss-accent-soft focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none"
                                @click="
                                    editor = {
                                        step: null,
                                        scriptId: v.script.id,
                                    }
                                "
                            >
                                <Plus :size="13" />
                                {{
                                    v.script.steps.length
                                        ? 'New step'
                                        : 'Add the first step'
                                }}
                            </button>
                        </div>
                    </template>
                </div>
            </div>
        </div>

        <SsScriptStepModal
            v-if="editor"
            :model-id="props.modelId"
            :step="editor.step"
            :script-id="editor.scriptId"
            :scripts="scriptOptions"
            @saved="onSaved"
            @close="editor = null"
        />
        <SsScriptImportModal
            v-if="showImport"
            :model-id="props.modelId"
            :model-name="props.modelName"
            @imported="onImported"
            @close="showImport = false"
        />
    </div>
</template>
