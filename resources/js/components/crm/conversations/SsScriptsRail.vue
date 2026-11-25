<script setup lang="ts">
import {
    ArrowDown,
    ArrowUp,
    Check,
    ChevronRight,
    Film,
    Image as ImageIcon,
    LoaderCircle,
    MoreVertical,
    Music,
    Pencil,
    Plus,
    Trash2,
    Undo2,
} from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import SsScriptStepModal from '@/components/crm/conversations/SsScriptStepModal.vue';
import {
    recallScriptsOpen,
    rememberScriptsOpen,
    scriptsCache,
} from '@/lib/conversationCache';
import { relativeTime } from '@/lib/datetime';
import { usd } from '@/lib/money';
import { ofApi } from '@/lib/onlyfans';
import { scriptProgress } from '@/lib/scriptProgress';
import type { OfMessage, Script, ScriptStatus, ScriptStep } from '@/types/crm';

/**
 * Right-rail "Scripts" tab: the creator's scripts as collapsible rows with the OPEN fan's
 * progress (`3/23`), each expanding to its steps in order. Click a step → `load` (the page puts
 * it in the composer). Progress comes from SSAI's ledger — sends made with a step loaded, plus
 * manual "Mark sent" rows for steps sent outside SSAI. Managers build and order the library
 * here too (the CreatorHero habit); chatters load and mark.
 */
const props = defineProps<{
    modelId: number;
    chatId: string | null;
    messages: OfMessage[];
    canManage: boolean;
    /** Bumped by the page after a step send so progress re-reads the ledger. */
    statusKey: number;
}>();
const emit = defineEmits<{ load: [step: ScriptStep] }>();

const scripts = ref<Script[]>(scriptsCache.get(props.modelId) ?? []);
const loading = ref(false);
const error = ref<string | null>(null);
const status = ref<ScriptStatus>({});
const open = ref(new Set<number>(recallScriptsOpen(props.modelId)));
const menuFor = ref<string | null>(null); // 's:{id}' (script) or 't:{id}' (step)
const busy = ref<string | null>(null); // same keys, while a write is in flight
const renaming = ref<number | null>(null);
const renameText = ref('');
const creatingScript = ref(false);
const newScriptName = ref('');
// The step editor: `step` null = a new step in `scriptId`.
const editor = ref<{ step: ScriptStep | null; scriptId: number } | null>(null);

let scriptsToken = 0;
let statusToken = 0;

async function loadScripts(force = false) {
    const cached = scriptsCache.get(props.modelId);

    if (cached && !force) {
        // Invalidate a fetch still in flight for the creator just left, or it would land
        // here and show that creator's scripts in this rail.
        ++scriptsToken;
        loading.value = false;
        error.value = null;
        scripts.value = cached;

        return;
    }

    const mine = ++scriptsToken;
    const modelId = props.modelId;
    loading.value = true;
    error.value = null;

    try {
        const res = await ofApi.scripts(modelId);

        if (mine !== scriptsToken) {
            return;
        }

        scriptsCache.set(modelId, res.scripts);
        scripts.value = res.scripts;
    } catch (e) {
        if (mine === scriptsToken) {
            error.value = e instanceof Error ? e.message : String(e);
        }
    } finally {
        if (mine === scriptsToken) {
            loading.value = false;
        }
    }
}

async function loadStatus() {
    const mine = ++statusToken;

    if (!props.chatId) {
        status.value = {};

        return;
    }

    try {
        const res = await ofApi.scriptStatus(props.modelId, props.chatId);

        if (mine === statusToken) {
            status.value = res.status ?? {};
        }
    } catch {
        // Progress is advisory; a failed read just shows nothing sent.
        if (mine === statusToken) {
            status.value = {};
        }
    }
}

onMounted(() => {
    void loadScripts();
    void loadStatus();
});
watch(
    () => props.modelId,
    () => {
        scripts.value = scriptsCache.get(props.modelId) ?? [];
        open.value = new Set(recallScriptsOpen(props.modelId));
        void loadScripts();
    },
);
watch(
    () => [props.modelId, props.chatId, props.statusKey],
    () => void loadStatus(),
);

function toggle(id: number) {
    const next = new Set(open.value);

    if (next.has(id)) {
        next.delete(id);
    } else {
        next.add(id);
    }

    open.value = next;
    rememberScriptsOpen(props.modelId, [...next]);
}

// ---- per-fan progress -----------------------------------------------------------

const progress = computed(
    () =>
        new Map(
            scripts.value.map((s) => [s.id, scriptProgress(s, status.value)]),
        ),
);

function progressClass(id: number): string {
    const p = progress.value.get(id);

    if (!p || p.sent === 0) {
        return 'bg-ss-surface-2 text-ss-text-3';
    }

    return p.sent >= p.total
        ? 'bg-ss-pos/15 text-ss-pos'
        : 'bg-ss-accent-soft text-ss-accent-text';
}

const openedIds = computed(
    () =>
        new Set(
            props.messages
                .filter((m) => m.from === 'creator' && m.isOpened && m.id)
                .map((m) => String(m.id)),
        ),
);

type Pill = { label: 'Bought' | 'Sent'; cls: string; title: string } | null;

function pillFor(step: ScriptStep): Pill {
    const rows = status.value[String(step.id)] ?? [];

    if (!rows.length) {
        return null;
    }

    const last = rows[0];
    const sends = rows.filter((r) => r.source === 'send').length;
    const how = sends > 0 ? `Sent ${sends}× from SSAI` : 'Marked sent by hand';
    const title = `${how} · last ${relativeTime(last.sentAt)}`;
    const bought =
        step.kind === 'ppv' &&
        rows.some(
            (r) => r.messageId && openedIds.value.has(String(r.messageId)),
        );

    return bought
        ? { label: 'Bought', cls: 'bg-ss-pos/15 text-ss-pos', title }
        : {
              label: 'Sent',
              cls: 'border border-ss-border text-ss-text-2',
              title,
          };
}

function hasManualMark(step: ScriptStep): boolean {
    return (status.value[String(step.id)] ?? []).some(
        (r) => r.source === 'manual',
    );
}

function isSent(step: ScriptStep): boolean {
    return (status.value[String(step.id)]?.length ?? 0) > 0;
}

function counts(step: ScriptStep) {
    const c = { photo: 0, video: 0, audio: 0 };

    for (const m of step.media) {
        if (m.type === 'video') {
            c.video++;
        } else if (m.type === 'audio') {
            c.audio++;
        } else {
            c.photo++; // photos + GIFs
        }
    }

    return c;
}

function kindLabel(step: ScriptStep): string {
    if (step.kind === 'text') {
        return 'Text';
    }

    return step.kind === 'free' ? 'Free' : `PPV ${usd(step.price)}`;
}

function kindClass(step: ScriptStep): string {
    if (step.kind === 'ppv') {
        return 'bg-ss-accent-soft text-ss-accent-text';
    }

    return step.kind === 'free'
        ? 'border border-ss-border text-ss-text-2'
        : 'text-ss-text-3';
}

// ---- writes -----------------------------------------------------------------------

/** Run a write, then refetch the whole library (one local DB call) rather than patch it. */
async function write(key: string, fn: () => Promise<unknown>) {
    menuFor.value = null;
    busy.value = key;
    error.value = null;

    try {
        await fn();
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        busy.value = null;
    }
}

async function writeLibrary(key: string, fn: () => Promise<unknown>) {
    await write(key, fn);
    await loadScripts(true);
}

function mark(step: ScriptStep) {
    const chat = props.chatId;

    if (chat) {
        void write(`t:${step.id}`, async () => {
            await ofApi.markStep(props.modelId, chat, step.id);
            await loadStatus();
        });
    }
}

function unmark(step: ScriptStep) {
    const chat = props.chatId;

    if (chat) {
        void write(`t:${step.id}`, async () => {
            await ofApi.unmarkStep(props.modelId, chat, step.id);
            await loadStatus();
        });
    }
}

function startCreateScript() {
    creatingScript.value = true;
    newScriptName.value = '';
}

function createScript() {
    const name = newScriptName.value.trim();

    if (!name) {
        return;
    }

    creatingScript.value = false;
    void writeLibrary('new', async () => {
        const res = await ofApi.createScript(props.modelId, name);

        if (!open.value.has(res.script.id)) {
            toggle(res.script.id); // open it: the next move is adding steps
        }
    });
}

function startRename(script: Script) {
    menuFor.value = null;
    renaming.value = script.id;
    renameText.value = script.name;
}

function saveRename(script: Script) {
    if (renaming.value !== script.id) {
        return; // Enter already saved it; this is the blur of the input going away
    }

    const name = renameText.value.trim();
    renaming.value = null;

    if (!name || name === script.name) {
        return;
    }

    void writeLibrary(`s:${script.id}`, () =>
        ofApi.renameScript(props.modelId, script.id, name),
    );
}

function deleteScript(script: Script) {
    menuFor.value = null;
    const n = script.steps.length;

    if (
        !window.confirm(
            `Delete "${script.name}" and its ${n} step${n === 1 ? '' : 's'}? Send history is kept.`,
        )
    ) {
        return;
    }

    void writeLibrary(`s:${script.id}`, () =>
        ofApi.deleteScript(props.modelId, script.id),
    );
}

function deleteStep(step: ScriptStep) {
    menuFor.value = null;

    if (
        !window.confirm(
            `Delete the step "${step.title}"? Send history is kept.`,
        )
    ) {
        return;
    }

    void writeLibrary(`t:${step.id}`, () =>
        ofApi.deleteStep(props.modelId, step.id),
    );
}

/** Swap an item with its neighbour, as an id list in the new order (null at either end). */
function swapped<T extends { id: number }>(
    list: T[],
    id: number,
    dir: -1 | 1,
): number[] | null {
    const i = list.findIndex((x) => x.id === id);
    const j = i + dir;

    if (i === -1 || j < 0 || j >= list.length) {
        return null;
    }

    const ids = list.map((x) => x.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];

    return ids;
}

function moveScript(script: Script, dir: -1 | 1) {
    const ids = swapped(scripts.value, script.id, dir);

    if (ids) {
        void writeLibrary(`s:${script.id}`, () =>
            ofApi.reorderScripts(props.modelId, ids),
        );
    }
}

function moveStep(script: Script, step: ScriptStep, dir: -1 | 1) {
    const ids = swapped(script.steps, step.id, dir);

    if (ids) {
        void writeLibrary(`t:${step.id}`, () =>
            ofApi.reorderSteps(props.modelId, script.id, ids),
        );
    }
}

function onSaved() {
    editor.value = null;
    void loadScripts(true);
}

const scriptOptions = computed(() =>
    scripts.value.map((s) => ({ id: s.id, name: s.name })),
);

function closeMenu(e: MouseEvent) {
    if (!(e.target as HTMLElement).closest('[data-script-menu]')) {
        menuFor.value = null;
    }
}
onMounted(() => document.addEventListener('click', closeMenu));
onBeforeUnmount(() => document.removeEventListener('click', closeMenu));

// Focus an input as it appears (the HTML `autofocus` attribute only works on page load).
const vFocus = { mounted: (el: HTMLElement) => el.focus() };

const MENU_ITEM =
    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-40 disabled:hover:bg-transparent';
const MENU_DANGER =
    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] text-ss-neg hover:bg-ss-neg/10';
</script>

<template>
    <div class="flex min-h-0 flex-1 flex-col" data-testid="scripts-rail">
        <div class="min-h-0 flex-1 overflow-y-auto p-2">
            <p v-if="error" class="mb-2 px-1 text-[12px] text-ss-neg">
                {{ error }}
            </p>

            <div
                v-if="loading && !scripts.length"
                class="grid place-items-center py-8"
            >
                <LoaderCircle :size="18" class="animate-spin text-ss-text-3" />
            </div>

            <div
                v-else-if="!scripts.length && !creatingScript && !error"
                class="px-2 py-8 text-center text-[12px] text-ss-text-3"
            >
                <p>No scripts yet.</p>
                <button
                    v-if="props.canManage"
                    type="button"
                    class="mt-3 inline-flex items-center gap-1 rounded-lg border border-ss-border px-2.5 py-1 text-[12px] font-semibold text-ss-text-2 transition-colors hover:border-ss-accent hover:text-ss-accent-text"
                    @click="startCreateScript"
                >
                    <Plus :size="12" /> New script
                </button>
            </div>

            <ul v-else class="space-y-1.5">
                <li
                    v-for="(script, si) in scripts"
                    :key="script.id"
                    class="rounded-xl border border-ss-border bg-ss-surface-2"
                    :data-testid="`script-${script.id}`"
                >
                    <!-- Script header -->
                    <div class="flex items-center gap-1 p-1.5">
                        <form
                            v-if="renaming === script.id"
                            class="flex min-w-0 flex-1 items-center gap-1"
                            @submit.prevent="saveRename(script)"
                        >
                            <input
                                v-model="renameText"
                                type="text"
                                maxlength="120"
                                aria-label="Script name"
                                class="min-w-0 flex-1 rounded-lg border border-ss-accent bg-ss-surface px-2 py-1 text-[12px] text-ss-text focus:outline-none"
                                v-focus
                                @keydown.esc.prevent="renaming = null"
                                @blur="saveRename(script)"
                            />
                        </form>
                        <button
                            v-else
                            type="button"
                            class="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1 py-1 text-left"
                            :aria-expanded="open.has(script.id)"
                            @click="toggle(script.id)"
                        >
                            <ChevronRight
                                :size="14"
                                class="shrink-0 text-ss-text-3 transition-transform"
                                :class="open.has(script.id) ? 'rotate-90' : ''"
                            />
                            <span
                                class="min-w-0 flex-1 truncate text-[13px] font-semibold text-ss-text"
                                >{{ script.name }}</span
                            >
                            <span
                                class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                                :class="progressClass(script.id)"
                                :title="
                                    props.chatId
                                        ? 'Steps sent to this fan'
                                        : 'Open a chat to see progress'
                                "
                                data-testid="script-progress"
                                >{{ progress.get(script.id)?.sent ?? 0 }}/{{
                                    script.steps.length
                                }}</span
                            >
                        </button>

                        <div
                            v-if="props.canManage"
                            class="relative shrink-0"
                            data-script-menu
                        >
                            <button
                                type="button"
                                class="grid h-6 w-6 place-items-center rounded text-ss-text-3 hover:bg-ss-surface hover:text-ss-text-2"
                                title="Script actions"
                                aria-label="Script actions"
                                @click.stop="
                                    menuFor =
                                        menuFor === `s:${script.id}`
                                            ? null
                                            : `s:${script.id}`
                                "
                            >
                                <LoaderCircle
                                    v-if="busy === `s:${script.id}`"
                                    :size="13"
                                    class="animate-spin"
                                />
                                <MoreVertical v-else :size="13" />
                            </button>
                            <div
                                v-if="menuFor === `s:${script.id}`"
                                class="absolute top-7 right-0 z-10 w-36 overflow-hidden rounded-lg border border-ss-border bg-ss-surface shadow-xl"
                            >
                                <button
                                    type="button"
                                    :class="MENU_ITEM"
                                    @click.stop="
                                        menuFor = null;
                                        editor = {
                                            step: null,
                                            scriptId: script.id,
                                        };
                                    "
                                >
                                    <Plus :size="12" /> Add step
                                </button>
                                <button
                                    type="button"
                                    :class="MENU_ITEM"
                                    @click.stop="startRename(script)"
                                >
                                    <Pencil :size="12" /> Rename
                                </button>
                                <button
                                    type="button"
                                    :class="MENU_ITEM"
                                    :disabled="si === 0"
                                    @click.stop="moveScript(script, -1)"
                                >
                                    <ArrowUp :size="12" /> Move up
                                </button>
                                <button
                                    type="button"
                                    :class="MENU_ITEM"
                                    :disabled="si === scripts.length - 1"
                                    @click.stop="moveScript(script, 1)"
                                >
                                    <ArrowDown :size="12" /> Move down
                                </button>
                                <button
                                    type="button"
                                    :class="MENU_DANGER"
                                    @click.stop="deleteScript(script)"
                                >
                                    <Trash2 :size="12" /> Delete
                                </button>
                            </div>
                        </div>
                    </div>

                    <!-- Steps -->
                    <div
                        v-if="open.has(script.id)"
                        class="border-t border-ss-border"
                    >
                        <p
                            v-if="!script.steps.length"
                            class="px-3 py-2.5 text-[11px] text-ss-text-3"
                        >
                            No steps yet.
                        </p>
                        <ol v-else class="divide-y divide-ss-border">
                            <li
                                v-for="(step, ti) in script.steps"
                                :key="step.id"
                                class="relative cursor-pointer px-2.5 py-2 transition-colors"
                                :class="
                                    progress.get(script.id)?.nextStepId ===
                                        step.id && props.chatId
                                        ? 'bg-ss-accent-soft/50 hover:bg-ss-accent-soft'
                                        : 'hover:bg-ss-surface'
                                "
                                :title="`Load “${step.title}” into the composer`"
                                :data-testid="`step-${step.id}`"
                                @click="emit('load', step)"
                            >
                                <div class="flex items-center gap-1.5">
                                    <!-- The keyboard way in; the whole card is the mouse target. -->
                                    <button
                                        type="button"
                                        class="min-w-0 flex-1 truncate text-left text-[12px] font-semibold focus:outline-none focus-visible:underline"
                                        :class="
                                            isSent(step)
                                                ? 'text-ss-text-2'
                                                : 'text-ss-text'
                                        "
                                        @click.stop="emit('load', step)"
                                    >
                                        {{ step.title }}
                                    </button>
                                    <span
                                        v-if="
                                            progress.get(script.id)
                                                ?.nextStepId === step.id &&
                                            props.chatId
                                        "
                                        class="shrink-0 rounded-full bg-ss-accent px-1.5 text-[10px] leading-4 font-semibold text-white"
                                        data-testid="next-marker"
                                        >Next</span
                                    >
                                    <span
                                        v-if="pillFor(step)"
                                        class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                                        :class="pillFor(step)!.cls"
                                        :title="pillFor(step)!.title"
                                        >{{ pillFor(step)!.label }}</span
                                    >
                                    <div
                                        v-if="props.chatId || props.canManage"
                                        class="relative shrink-0"
                                        data-script-menu
                                    >
                                        <button
                                            type="button"
                                            class="grid h-5 w-5 place-items-center rounded text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text-2"
                                            title="Step actions"
                                            aria-label="Step actions"
                                            @click.stop="
                                                menuFor =
                                                    menuFor === `t:${step.id}`
                                                        ? null
                                                        : `t:${step.id}`
                                            "
                                            @keydown.enter.stop
                                        >
                                            <LoaderCircle
                                                v-if="busy === `t:${step.id}`"
                                                :size="12"
                                                class="animate-spin"
                                            />
                                            <MoreVertical v-else :size="12" />
                                        </button>
                                        <div
                                            v-if="menuFor === `t:${step.id}`"
                                            class="absolute top-6 right-0 z-10 w-36 overflow-hidden rounded-lg border border-ss-border bg-ss-surface shadow-xl"
                                            @click.stop
                                            @keydown.enter.stop
                                        >
                                            <button
                                                v-if="
                                                    props.chatId &&
                                                    !isSent(step)
                                                "
                                                type="button"
                                                :class="MENU_ITEM"
                                                title="This fan already had this step (sent outside SSAI)"
                                                @click="mark(step)"
                                            >
                                                <Check :size="12" /> Mark sent
                                            </button>
                                            <button
                                                v-if="
                                                    props.chatId &&
                                                    hasManualMark(step)
                                                "
                                                type="button"
                                                :class="MENU_ITEM"
                                                title="Remove the manual mark (real sends stay in history)"
                                                @click="unmark(step)"
                                            >
                                                <Undo2 :size="12" /> Unmark
                                            </button>
                                            <template v-if="props.canManage">
                                                <button
                                                    type="button"
                                                    :class="MENU_ITEM"
                                                    @click="
                                                        menuFor = null;
                                                        editor = {
                                                            step,
                                                            scriptId: script.id,
                                                        };
                                                    "
                                                >
                                                    <Pencil :size="12" /> Edit
                                                </button>
                                                <button
                                                    type="button"
                                                    :class="MENU_ITEM"
                                                    :disabled="ti === 0"
                                                    @click="
                                                        moveStep(
                                                            script,
                                                            step,
                                                            -1,
                                                        )
                                                    "
                                                >
                                                    <ArrowUp :size="12" />
                                                    Move up
                                                </button>
                                                <button
                                                    type="button"
                                                    :class="MENU_ITEM"
                                                    :disabled="
                                                        ti ===
                                                        script.steps.length - 1
                                                    "
                                                    @click="
                                                        moveStep(
                                                            script,
                                                            step,
                                                            1,
                                                        )
                                                    "
                                                >
                                                    <ArrowDown :size="12" />
                                                    Move down
                                                </button>
                                                <button
                                                    type="button"
                                                    :class="MENU_DANGER"
                                                    @click="deleteStep(step)"
                                                >
                                                    <Trash2 :size="12" />
                                                    Delete
                                                </button>
                                            </template>
                                            <p
                                                v-if="
                                                    !props.canManage &&
                                                    isSent(step) &&
                                                    !hasManualMark(step)
                                                "
                                                class="px-2.5 py-1.5 text-[11px] text-ss-text-3"
                                            >
                                                Sent from SSAI
                                            </p>
                                        </div>
                                    </div>
                                </div>

                                <p
                                    class="mt-0.5 flex min-w-0 items-center gap-1.5 text-[10px] text-ss-text-3"
                                >
                                    <!-- Text steps carry no badge: no media, no price is the default. -->
                                    <span
                                        v-if="step.kind !== 'text'"
                                        class="shrink-0 rounded px-1 py-px font-semibold"
                                        :class="kindClass(step)"
                                        data-testid="kind-badge"
                                        >{{ kindLabel(step) }}</span
                                    >
                                    <span
                                        v-if="counts(step).photo"
                                        class="inline-flex items-center gap-0.5"
                                        ><ImageIcon :size="10" />
                                        {{ counts(step).photo }}</span
                                    >
                                    <span
                                        v-if="counts(step).video"
                                        class="inline-flex items-center gap-0.5"
                                        ><Film :size="10" />
                                        {{ counts(step).video }}</span
                                    >
                                    <span
                                        v-if="counts(step).audio"
                                        class="inline-flex items-center gap-0.5"
                                        ><Music :size="10" />
                                        {{ counts(step).audio }}</span
                                    >
                                    <span
                                        v-if="step.text"
                                        class="min-w-0 flex-1 truncate text-[11px]"
                                        :title="step.text"
                                        >{{ step.text }}</span
                                    >
                                </p>
                            </li>
                        </ol>

                        <button
                            v-if="props.canManage"
                            type="button"
                            class="flex w-full items-center gap-1 rounded-b-xl border-t border-ss-border px-2.5 py-1.5 text-[11px] font-semibold text-ss-text-3 transition-colors hover:bg-ss-surface hover:text-ss-accent-text"
                            @click="
                                editor = { step: null, scriptId: script.id }
                            "
                        >
                            <Plus :size="11" /> Add step
                        </button>
                    </div>
                </li>
            </ul>
        </div>

        <!-- Footer: New script (managers) -->
        <div
            v-if="props.canManage && (scripts.length || creatingScript)"
            class="shrink-0 border-t border-ss-border p-2"
        >
            <form
                v-if="creatingScript"
                class="flex items-center gap-1.5"
                @submit.prevent="createScript"
            >
                <input
                    v-model="newScriptName"
                    type="text"
                    maxlength="120"
                    placeholder="Script name, e.g. Master Script"
                    aria-label="New script name"
                    class="min-w-0 flex-1 rounded-lg border border-ss-border bg-ss-surface-2 px-2 py-1 text-[12px] text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none"
                    v-focus
                    @keydown.esc.prevent="creatingScript = false"
                />
                <button
                    type="submit"
                    :disabled="!newScriptName.trim()"
                    class="rounded-lg bg-ss-accent px-2.5 py-1 text-[12px] font-semibold text-white disabled:opacity-50"
                >
                    Create
                </button>
                <button
                    type="button"
                    class="rounded-lg px-1.5 py-1 text-[12px] font-semibold text-ss-text-3 hover:text-ss-text-2"
                    @click="creatingScript = false"
                >
                    Cancel
                </button>
            </form>
            <button
                v-else
                type="button"
                class="flex w-full items-center justify-center gap-1 rounded-lg border border-ss-border py-1.5 text-[12px] font-semibold text-ss-text-2 transition-colors hover:border-ss-accent hover:text-ss-accent-text"
                :disabled="busy === 'new'"
                @click="startCreateScript"
            >
                <Plus :size="12" /> New script
            </button>
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
    </div>
</template>
