<script setup lang="ts">
import {
    Check,
    ChevronLeft,
    ChevronRight,
    Eye,
    Film,
    Image as ImageIcon,
    ListOrdered,
    LoaderCircle,
    MoreHorizontal,
    Music,
    Undo2,
    X,
} from '@lucide/vue';
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import {
    recallOpenScript,
    rememberOpenScript,
    scriptsCache,
} from '@/lib/conversationCache';
import { relativeTime } from '@/lib/datetime';
import { usd } from '@/lib/money';
import { mediaSrc, ofApi } from '@/lib/onlyfans';
import { scriptProgress } from '@/lib/scriptProgress';
import type { OfMessage, Script, ScriptStatus, ScriptStep } from '@/types/crm';

/**
 * The composer's Scripts panel (CreatorHero's layout): level 1 = the creator's scripts with the
 * OPEN fan's progress, level 2 = one script's steps, level 3 = a step preview with paging and
 * Use. Picking a step emits `load` — the page's `loadStep` owns the composer rules (replace
 * confirm, labels, stale-reply guard). Use only: scripts are built on the /scripts page.
 *
 * Progress comes from SSAI's ledger — sends made with a step loaded, plus manual "Mark sent"
 * rows for steps sent outside SSAI.
 */
const props = defineProps<{
    modelId: number;
    chatId: string | null;
    messages: OfMessage[];
    /** Bumped by the page after a step send so progress re-reads the ledger. */
    statusKey: number;
}>();
const emit = defineEmits<{ load: [step: ScriptStep]; close: [] }>();

const scripts = ref<Script[]>(scriptsCache.get(props.modelId) ?? []);
const loading = ref(false);
const error = ref<string | null>(null);
const status = ref<ScriptStatus>({});
const openId = ref<number | null>(recallOpenScript(props.modelId));
const previewIdx = ref<number | null>(null); // index into the open script's steps
const active = ref(0); // keyboard cursor in the current list
const actionsFor = ref<number | null>(null); // step whose Mark sent / Unmark row is showing
const busy = ref<number | null>(null);
const root = ref<HTMLElement | null>(null);

let scriptsToken = 0;
let lastScript: number | null = openId.value; // where level 1's cursor lands on Back
let statusToken = 0;

async function loadScripts() {
    const mine = ++scriptsToken;
    const modelId = props.modelId;
    // Show the cache at once, then revalidate: a manager may have edited on /scripts.
    loading.value = !scriptsCache.has(modelId);
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
    root.value?.focus({ preventScroll: true });
});
watch(
    () => props.modelId,
    () => {
        scripts.value = scriptsCache.get(props.modelId) ?? [];
        openId.value = recallOpenScript(props.modelId);
        previewIdx.value = null;
        void loadScripts();
    },
);
watch(
    () => [props.modelId, props.chatId, props.statusKey],
    () => void loadStatus(),
);

const openScript = computed(
    () => scripts.value.find((s) => s.id === openId.value) ?? null,
);
const previewStep = computed(() =>
    openScript.value && previewIdx.value !== null
        ? (openScript.value.steps[previewIdx.value] ?? null)
        : null,
);
const level = computed<'scripts' | 'steps' | 'preview'>(() =>
    previewStep.value ? 'preview' : openScript.value ? 'steps' : 'scripts',
);

function goScript(id: number | null) {
    openId.value = id;
    previewIdx.value = null;
    actionsFor.value = null;
    rememberOpenScript(props.modelId, id);
    // Land the cursor on the Next step (or the script just left), so Enter does the obvious.
    const s = scripts.value.find((x) => x.id === id);
    const next = s ? progress.value.get(s.id)?.nextStepId : null;
    const idx = s ? s.steps.findIndex((t) => t.id === next) : -1;
    active.value =
        id === null
            ? Math.max(
                  0,
                  scripts.value.findIndex((x) => x.id === lastScript),
              )
            : Math.max(0, idx);
    lastScript = id ?? lastScript;
    focusActive();
}

function back() {
    if (level.value === 'preview') {
        active.value = previewIdx.value ?? 0;
        previewIdx.value = null;
        focusActive();
    } else if (level.value === 'steps') {
        goScript(null);
    }
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

function isNext(step: ScriptStep): boolean {
    return (
        !!props.chatId &&
        progress.value.get(step.scriptId)?.nextStepId === step.id
    );
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

    const sends = rows.filter((r) => r.source === 'send').length;
    const how = sends > 0 ? `Sent ${sends}× from SSAI` : 'Marked sent by hand';
    const title = `${how} · last ${relativeTime(rows[0].sentAt)}`;
    const bought =
        !step.needsMedia &&
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

function isSent(step: ScriptStep): boolean {
    return (status.value[String(step.id)]?.length ?? 0) > 0;
}

function hasManualMark(step: ScriptStep): boolean {
    return (status.value[String(step.id)] ?? []).some(
        (r) => r.source === 'manual',
    );
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

/** The step's badge. needsMedia BEFORE kind: such a step reads 'text' server-side. */
function badge(step: ScriptStep): { label: string; cls: string } | null {
    if (step.needsMedia) {
        return { label: 'Needs media', cls: 'bg-ss-warn/15 text-ss-warn' };
    }

    if (step.kind === 'ppv') {
        return {
            label: `PPV ${usd(step.price)}`,
            cls: 'bg-ss-accent-soft text-ss-accent-text',
        };
    }

    return step.kind === 'free'
        ? { label: 'Free', cls: 'border border-ss-border text-ss-text-2' }
        : null; // text steps carry no badge
}

const NEEDS_MEDIA = 'Ask a manager to add media';

// ---- actions ----------------------------------------------------------------------

function use(step: ScriptStep) {
    if (!step.needsMedia) {
        emit('load', step);
    }
}

function preview(index: number) {
    previewIdx.value = index;
    actionsFor.value = null;
    nextTick(() => root.value?.focus({ preventScroll: true }));
}

function page(dir: -1 | 1) {
    const s = openScript.value;

    if (!s || previewIdx.value === null) {
        return;
    }

    const i = previewIdx.value + dir;

    if (i >= 0 && i < s.steps.length) {
        previewIdx.value = i;
    }
}

async function write(step: ScriptStep, fn: () => Promise<unknown>) {
    busy.value = step.id;
    error.value = null;

    try {
        await fn();
        await loadStatus();
        actionsFor.value = null;
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);
    } finally {
        busy.value = null;
    }
}

function mark(step: ScriptStep) {
    const chat = props.chatId;

    if (chat) {
        void write(step, () => ofApi.markStep(props.modelId, chat, step.id));
    }
}

function unmark(step: ScriptStep) {
    const chat = props.chatId;

    if (chat) {
        void write(step, () => ofApi.unmarkStep(props.modelId, chat, step.id));
    }
}

// ---- keyboard ---------------------------------------------------------------------

const listLength = computed(() =>
    level.value === 'scripts'
        ? scripts.value.length
        : (openScript.value?.steps.length ?? 0),
);

function focusActive() {
    nextTick(() => {
        root.value
            ?.querySelector(`[data-idx="${active.value}"]`)
            ?.scrollIntoView({ block: 'nearest' });
    });
}

function onKeydown(e: KeyboardEvent) {
    const target = e.target as HTMLElement;

    // Let a focused button handle its own Enter/Space.
    if (target !== root.value && e.key === 'Enter') {
        return;
    }

    if (level.value === 'preview') {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            e.preventDefault();
            page(-1);
        } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            e.preventDefault();
            page(1);
        } else if (e.key === 'Enter' && previewStep.value) {
            e.preventDefault();
            use(previewStep.value);
        } else if (e.key === 'Backspace') {
            e.preventDefault();
            back();
        }

        return;
    }

    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = listLength.value;

        if (n) {
            active.value =
                (active.value + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
            focusActive();
        }
    } else if (e.key === 'Enter') {
        e.preventDefault();

        if (level.value === 'scripts') {
            const s = scripts.value[active.value];

            if (s) {
                goScript(s.id);
            }
        } else {
            const step = openScript.value?.steps[active.value];

            if (step) {
                use(step);
            }
        }
    } else if (e.key === 'ArrowLeft' || e.key === 'Backspace') {
        e.preventDefault();
        back();
    } else if (e.key === 'ArrowRight' && level.value === 'scripts') {
        e.preventDefault();
        const s = scripts.value[active.value];

        if (s) {
            goScript(s.id);
        }
    }
}

// Preview media failing to load (a deleted vault item, usually) shows a neutral tile.
const broken = ref(new Set<string>());

function markBroken(id: string) {
    broken.value = new Set(broken.value).add(id);
}

const ICON_BTN =
    'grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ss-text-3 transition-colors hover:bg-ss-surface-2 hover:text-ss-text-2 focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none disabled:opacity-40 disabled:hover:bg-transparent';
</script>

<template>
    <div
        ref="root"
        tabindex="-1"
        class="flex max-h-[min(28rem,60vh)] flex-col overflow-hidden rounded-xl border border-ss-border bg-ss-surface font-ss shadow-[0_12px_40px_-8px_rgb(0_0_0/0.35)] focus:outline-none"
        role="dialog"
        aria-label="Scripts"
        data-testid="scripts-panel"
        @keydown="onKeydown"
    >
        <!-- Header: title per level, back arrow, close -->
        <div
            class="flex shrink-0 items-center gap-1 border-b border-ss-border px-2 py-1.5"
        >
            <button
                v-if="level !== 'scripts'"
                type="button"
                :class="ICON_BTN"
                :title="
                    level === 'preview'
                        ? 'Back to the steps'
                        : 'Back to scripts'
                "
                aria-label="Back"
                data-testid="scripts-back"
                @click="back"
            >
                <ChevronLeft :size="16" />
            </button>
            <ListOrdered
                v-else
                :size="15"
                class="mx-1.5 shrink-0 text-ss-text-3"
            />
            <span
                class="min-w-0 flex-1 truncate text-[13px] font-semibold text-ss-text"
                >{{ openScript ? openScript.name : 'Scripts' }}</span
            >
            <template v-if="level === 'preview' && openScript">
                <button
                    type="button"
                    :class="ICON_BTN"
                    :disabled="previewIdx === 0"
                    title="Previous step"
                    aria-label="Previous step"
                    @click="page(-1)"
                >
                    <ChevronLeft :size="15" />
                </button>
                <span
                    class="text-[12px] font-semibold text-ss-text-2 tabular-nums"
                    data-testid="preview-pos"
                    >{{ (previewIdx ?? 0) + 1 }}/{{
                        openScript.steps.length
                    }}</span
                >
                <button
                    type="button"
                    :class="ICON_BTN"
                    :disabled="previewIdx === openScript.steps.length - 1"
                    title="Next step"
                    aria-label="Next step"
                    @click="page(1)"
                >
                    <ChevronRight :size="15" />
                </button>
            </template>
            <span
                v-else-if="level === 'steps' && openScript"
                class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums"
                :class="progressClass(openScript.id)"
                >{{ progress.get(openScript.id)?.sent ?? 0 }}/{{
                    openScript.steps.length
                }}</span
            >
            <button
                type="button"
                :class="ICON_BTN"
                title="Close (Esc)"
                aria-label="Close scripts"
                @click="emit('close')"
            >
                <X :size="15" />
            </button>
        </div>

        <p
            v-if="error"
            class="shrink-0 border-b border-ss-border px-3 py-1.5 text-[12px] text-ss-neg"
        >
            {{ error }}
        </p>

        <div class="min-h-0 flex-1 overflow-y-auto">
            <!-- Level 1: scripts -->
            <template v-if="level === 'scripts'">
                <div
                    v-if="loading && !scripts.length"
                    class="grid place-items-center py-8"
                >
                    <LoaderCircle
                        :size="18"
                        class="animate-spin text-ss-text-3"
                    />
                </div>
                <p
                    v-else-if="!scripts.length && !error"
                    class="px-4 py-8 text-center text-[12px] text-ss-text-3"
                >
                    No scripts for this creator yet. A manager builds them on
                    the Scripts page.
                </p>
                <ul v-else class="divide-y divide-ss-border">
                    <li v-for="(script, i) in scripts" :key="script.id">
                        <button
                            type="button"
                            class="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-ss-surface-2 focus-visible:bg-ss-surface-2 focus-visible:outline-none"
                            :class="active === i ? 'bg-ss-surface-2' : ''"
                            :data-idx="i"
                            :data-testid="`panel-script-${script.id}`"
                            @click="goScript(script.id)"
                            @mouseenter="active = i"
                        >
                            <span
                                class="min-w-0 flex-1 truncate text-[13px] font-medium text-ss-text"
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
                            <ChevronRight
                                :size="14"
                                class="shrink-0 text-ss-text-3"
                            />
                        </button>
                    </li>
                </ul>
            </template>

            <!-- Level 2: steps -->
            <template v-else-if="level === 'steps' && openScript">
                <p
                    v-if="!openScript.steps.length"
                    class="px-4 py-8 text-center text-[12px] text-ss-text-3"
                >
                    No steps in this script yet.
                </p>
                <ol v-else class="divide-y divide-ss-border">
                    <li
                        v-for="(step, i) in openScript.steps"
                        :key="step.id"
                        :data-idx="i"
                        :data-testid="`step-${step.id}`"
                        @mouseenter="active = i"
                    >
                        <div
                            class="flex items-center gap-1 pr-2 transition-colors"
                            :class="[
                                isNext(step) ? 'bg-ss-accent-soft/50' : '',
                                active === i
                                    ? isNext(step)
                                        ? 'bg-ss-accent-soft'
                                        : 'bg-ss-surface-2'
                                    : '',
                            ]"
                        >
                            <button
                                type="button"
                                class="min-w-0 flex-1 px-3 py-2 text-left focus-visible:outline-none focus-visible:[&>span:first-child]:underline"
                                :class="
                                    step.needsMedia ? 'cursor-not-allowed' : ''
                                "
                                :aria-disabled="step.needsMedia"
                                :title="
                                    step.needsMedia
                                        ? NEEDS_MEDIA
                                        : `Load “${step.title}” into the message box`
                                "
                                @click="use(step)"
                            >
                                <span class="flex min-w-0 items-center gap-1.5">
                                    <span
                                        class="min-w-0 truncate text-[12px] font-semibold"
                                        :class="
                                            isSent(step) || step.needsMedia
                                                ? 'text-ss-text-2'
                                                : 'text-ss-text'
                                        "
                                        >{{ step.title }}</span
                                    >
                                    <span
                                        v-if="badge(step)"
                                        class="shrink-0 rounded px-1 py-px text-[10px] font-semibold"
                                        :class="badge(step)!.cls"
                                        data-testid="kind-badge"
                                        >{{ badge(step)!.label }}</span
                                    >
                                    <span
                                        v-if="counts(step).photo"
                                        class="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-ss-text-3"
                                        ><ImageIcon :size="10" />{{
                                            counts(step).photo
                                        }}</span
                                    >
                                    <span
                                        v-if="counts(step).video"
                                        class="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-ss-text-3"
                                        ><Film :size="10" />{{
                                            counts(step).video
                                        }}</span
                                    >
                                    <span
                                        v-if="counts(step).audio"
                                        class="inline-flex shrink-0 items-center gap-0.5 text-[10px] text-ss-text-3"
                                        ><Music :size="10" />{{
                                            counts(step).audio
                                        }}</span
                                    >
                                    <span
                                        v-if="isNext(step)"
                                        class="shrink-0 rounded-full bg-ss-accent px-1.5 text-[10px] leading-4 font-semibold text-white"
                                        data-testid="next-marker"
                                        >Next</span
                                    >
                                    <span
                                        v-if="pillFor(step)"
                                        class="shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold"
                                        :class="pillFor(step)!.cls"
                                        :title="pillFor(step)!.title"
                                        >{{ pillFor(step)!.label }}</span
                                    >
                                </span>
                                <span
                                    class="mt-0.5 block truncate text-[11px]"
                                    :class="
                                        step.needsMedia
                                            ? 'text-ss-warn'
                                            : 'text-ss-text-3'
                                    "
                                    >{{
                                        step.needsMedia
                                            ? NEEDS_MEDIA
                                            : step.text || '—'
                                    }}</span
                                >
                            </button>
                            <button
                                type="button"
                                :class="ICON_BTN"
                                title="Preview"
                                aria-label="Preview step"
                                data-testid="step-preview"
                                @click="preview(i)"
                            >
                                <Eye :size="14" />
                            </button>
                            <button
                                v-if="props.chatId"
                                type="button"
                                :class="ICON_BTN"
                                title="Mark sent / Unmark"
                                aria-label="Step actions"
                                :aria-expanded="actionsFor === step.id"
                                @click="
                                    actionsFor =
                                        actionsFor === step.id ? null : step.id
                                "
                            >
                                <LoaderCircle
                                    v-if="busy === step.id"
                                    :size="13"
                                    class="animate-spin"
                                />
                                <MoreHorizontal v-else :size="14" />
                            </button>
                        </div>
                        <!-- In-flow action row: no popover to clip at the bottom of the scroller. -->
                        <div
                            v-if="actionsFor === step.id && props.chatId"
                            class="flex items-center gap-1.5 px-3 pb-2"
                        >
                            <button
                                v-if="!isSent(step)"
                                type="button"
                                class="inline-flex items-center gap-1 rounded-lg border border-ss-border px-2 py-1 text-[11px] font-semibold text-ss-text-2 transition-colors hover:bg-ss-surface-2 focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none"
                                title="This fan already had this step (sent outside SSAI)"
                                :disabled="busy === step.id"
                                @click="mark(step)"
                            >
                                <Check :size="12" /> Mark sent
                            </button>
                            <button
                                v-if="hasManualMark(step)"
                                type="button"
                                class="inline-flex items-center gap-1 rounded-lg border border-ss-border px-2 py-1 text-[11px] font-semibold text-ss-text-2 transition-colors hover:bg-ss-surface-2 focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none"
                                title="Remove the manual mark (real sends stay in history)"
                                :disabled="busy === step.id"
                                @click="unmark(step)"
                            >
                                <Undo2 :size="12" /> Unmark
                            </button>
                            <span
                                v-if="isSent(step) && !hasManualMark(step)"
                                class="text-[11px] text-ss-text-3"
                                >Sent from SSAI</span
                            >
                        </div>
                    </li>
                </ol>
            </template>

            <!-- Level 3: preview -->
            <div
                v-else-if="previewStep"
                class="space-y-2.5 p-3"
                data-testid="step-preview-view"
            >
                <div class="flex min-w-0 items-center gap-1.5">
                    <span
                        class="min-w-0 truncate text-[13px] font-semibold text-ss-text"
                        >{{ previewStep.title }}</span
                    >
                    <span
                        v-if="badge(previewStep)"
                        class="shrink-0 rounded px-1 py-px text-[10px] font-semibold"
                        :class="badge(previewStep)!.cls"
                        >{{ badge(previewStep)!.label }}</span
                    >
                    <span
                        v-if="pillFor(previewStep)"
                        class="shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold"
                        :class="pillFor(previewStep)!.cls"
                        >{{ pillFor(previewStep)!.label }}</span
                    >
                </div>
                <p
                    class="text-[13px] leading-relaxed whitespace-pre-wrap text-ss-text"
                    :class="previewStep.text ? '' : 'text-ss-text-3 italic'"
                >
                    {{ previewStep.text || 'No text.' }}
                </p>
                <div
                    v-if="previewStep.media.length"
                    class="flex flex-wrap gap-1.5"
                >
                    <div
                        v-for="m in previewStep.media"
                        :key="m.id"
                        class="relative grid h-16 w-16 place-items-center overflow-hidden rounded-lg bg-ss-surface-2 text-ss-text-3"
                    >
                        <img
                            v-if="m.thumb && !broken.has(m.id)"
                            :src="mediaSrc(props.modelId, m.thumb)"
                            alt=""
                            class="h-full w-full object-cover"
                            loading="lazy"
                            @error="markBroken(m.id)"
                        />
                        <Film v-else-if="m.type === 'video'" :size="16" />
                        <Music v-else-if="m.type === 'audio'" :size="16" />
                        <ImageIcon v-else :size="16" />
                        <Film
                            v-if="
                                m.type === 'video' &&
                                m.thumb &&
                                !broken.has(m.id)
                            "
                            :size="12"
                            class="absolute right-1 bottom-1 text-white drop-shadow"
                        />
                    </div>
                </div>
                <p
                    v-if="previewStep.needsMedia"
                    class="text-[12px] text-ss-warn"
                >
                    This step is waiting for its media. {{ NEEDS_MEDIA }}.
                </p>
            </div>
        </div>

        <!-- Preview footer: Use -->
        <div
            v-if="level === 'preview' && previewStep"
            class="flex shrink-0 items-center justify-end gap-2 border-t border-ss-border px-3 py-2"
        >
            <span
                v-if="!previewStep.needsMedia && previewStep.media.length"
                class="mr-auto text-[12px] font-semibold text-ss-text-2"
                >{{
                    previewStep.price > 0
                        ? `Price to view ${usd(previewStep.price)}`
                        : 'Free media'
                }}</span
            >
            <button
                type="button"
                :disabled="previewStep.needsMedia"
                class="rounded-lg bg-ss-accent px-3.5 py-1.5 text-[12px] font-semibold text-white transition-[filter,opacity] hover:brightness-110 focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ss-surface focus-visible:outline-none disabled:opacity-50 disabled:hover:brightness-100"
                :title="
                    previewStep.needsMedia
                        ? NEEDS_MEDIA
                        : 'Load into the message box'
                "
                data-testid="step-use"
                @click="use(previewStep)"
            >
                Use
            </button>
        </div>
    </div>
</template>
