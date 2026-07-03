<script setup lang="ts">
import { computed } from 'vue';
import type { AiStrategy } from '@/types/crm';

const props = defineProps<{
    strategy: AiStrategy | null;
    generatedAt?: string | null;
    api?: string;
}>();

// "generated X ago" — the persisted intel is the latest generation, shown with
// its age so a chatter knows how fresh it is after reopening/reloading the chat.
const generatedLabel = computed(() => {
    if (!props.generatedAt) {
        return null;
    }

    const then = new Date(props.generatedAt).getTime();

    if (Number.isNaN(then)) {
        return null;
    }

    const secs = Math.max(0, Math.round((Date.now() - then) / 1000));

    if (secs < 60) {
        return 'just now';
    }

    const mins = Math.round(secs / 60);

    if (mins < 60) {
        return `${mins}m ago`;
    }

    const hrs = Math.round(mins / 60);

    if (hrs < 24) {
        return `${hrs}h ago`;
    }

    return `${Math.round(hrs / 24)}d ago`;
});

// ---- gauge (temperature) ----
// One consistent geometry: a 180° arc of radius R centred at (CX, CY). A fraction
// t in [0,1] runs left→right over the top; every band break-point and the needle
// are derived from it, so the curve is always smooth and the needle lands on it.
const CX = 80;
const CY = 80;
const R = 62; // band radius
const R_NEEDLE = 50; // needle length (sits just inside the band)

/** Point on the arc of radius `r` at gauge fraction t (0 = left/cold, 1 = right/hot). */
function arcPoint(t: number, r: number) {
    const a = (1 - t) * Math.PI; // π (left) → 0 (right)

    return { x: CX + r * Math.cos(a), y: CY - r * Math.sin(a) };
}

/** SVG arc path between two fractions along the band (clockwise over the top). */
function arcPath(t0: number, t1: number) {
    const p0 = arcPoint(t0, R);

    const p1 = arcPoint(t1, R);

    return `M ${p0.x.toFixed(2)} ${p0.y.toFixed(2)} A ${R} ${R} 0 0 1 ${p1.x.toFixed(2)} ${p1.y.toFixed(2)}`;
}

const TEMP_FRAC: Record<string, number> = {
    cold: 0.12,
    warming: 0.38,
    warm: 0.62,
    hot: 0.88,
};
const TEMP_COLOR: Record<string, string> = {
    cold: '#5b8dee',
    warming: '#f0a040',
    warm: '#3dd68c',
    hot: '#f06060',
};

// The four coloured zones, each an equal quarter of the sweep.
const BANDS = [
    { color: TEMP_COLOR.cold, t0: 0, t1: 0.25 },
    { color: TEMP_COLOR.warming, t0: 0.25, t1: 0.5 },
    { color: TEMP_COLOR.warm, t0: 0.5, t1: 0.75 },
    { color: TEMP_COLOR.hot, t0: 0.75, t1: 1 },
].map((b) => ({ ...b, d: arcPath(b.t0, b.t1) }));

const trackPath = arcPath(0, 1);

const temp = computed(() => (props.strategy?.temperature as string) || 'cold');
const tempColor = computed(() => TEMP_COLOR[temp.value] ?? TEMP_COLOR.cold);

const needle = computed(() => {
    const tip = arcPoint(TEMP_FRAC[temp.value] ?? 0, R_NEEDLE);

    return { cx: CX, cy: CY, x: tip.x, y: tip.y };
});

// ---- grid cards ----
const trustLevel = computed(() => Number(props.strategy?.trust_level ?? 1));
const segs = computed(() =>
    Array.from({ length: 5 }, (_, i) => i < trustLevel.value),
);

const archetype = computed(
    () => (props.strategy?.archetype as string) || 'Unknown',
);
const archColor = computed(() => {
    const a = archetype.value;

    if (a === 'Emotional' || a === 'Relationship') {
        return 'text-ss-pos';
    }

    if (a === 'Skeptical') {
        return 'text-ss-warn';
    }

    return 'text-ss-accent-text';
});

const phase = computed(() => (props.strategy?.phase as string) || 'rapport');
const phaseColor = computed(() => {
    const p = phase.value;

    if (p === 'sell' || p === 'aftercare') {
        return 'text-ss-pos';
    }

    if (p === 'link') {
        return 'text-ss-warn';
    }

    return 'text-ss-accent-text';
});

const engagement = computed(() => {
    switch (temp.value) {
        case 'hot':
            return { label: 'High', cls: 'text-ss-neg' };
        case 'warm':
            return { label: 'Good', cls: 'text-ss-pos' };
        case 'warming':
            return { label: 'Building', cls: 'text-ss-warn' };
        default:
            return { label: 'Low', cls: 'text-ss-warn' };
    }
});

// ---- framework calibration ----
const lvl = (v: unknown) => (v === null || v === undefined ? '—' : String(v));

const cal = computed(() => {
    const s = props.strategy;

    if (!s) {
        return null;
    }

    const power = (s.power_position_check as string) || '—';
    const pl = power.toLowerCase();

    return {
        step: (s.skeleton_step as string) || '—',
        cs: lvl(s.customer_sexual_level),
        ce: lvl(s.customer_emotional_level),
        ts: lvl(s.creator_target_sexual_level),
        te: lvl(s.creator_target_emotional_level),
        power,
        powerCls: pl.startsWith('preserves')
            ? 'text-ss-pos'
            : pl.startsWith('weakens')
              ? 'text-ss-neg'
              : 'text-ss-text',
        clampedBy: (s._clampedBy as string) || '',
        depthGated: Boolean(s._depthGated),
    };
});

const reason = (v: unknown) => String(v ?? '').slice(0, 80);
const warning = computed(
    () =>
        (props.strategy?.warnings as string) ||
        (props.strategy?.warning as string) ||
        '',
);
</script>

<template>
    <div class="flex flex-1 flex-col overflow-hidden">
        <div
            v-if="!strategy"
            class="grid flex-1 place-items-center p-6 text-center text-[13px] text-ss-text-3"
        >
            <div>
                <div class="mb-2 text-2xl opacity-20">◈</div>
                Generate a response<br />to activate AI Intelligence
            </div>
        </div>

        <div v-else class="flex-1 space-y-3 overflow-y-auto p-4">
            <div
                v-if="generatedLabel"
                class="text-right text-[10px] font-medium tracking-wide text-ss-text-3 uppercase"
            >
                Generated {{ generatedLabel }}
            </div>
            <!-- Temperature gauge -->
            <div class="grid place-items-center">
                <svg
                    viewBox="0 0 160 104"
                    class="h-24 w-40"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <!-- track + coloured zones (the active zone reads full strength) -->
                    <path
                        :d="trackPath"
                        stroke="var(--color-ss-border)"
                        stroke-width="9"
                        stroke-linecap="round"
                        fill="none"
                    />
                    <path
                        v-for="(b, i) in BANDS"
                        :key="i"
                        :d="b.d"
                        :stroke="b.color"
                        stroke-width="9"
                        stroke-linecap="round"
                        fill="none"
                        :opacity="
                            TEMP_FRAC[temp] >= b.t0 && TEMP_FRAC[temp] <= b.t1
                                ? 0.95
                                : 0.3
                        "
                    />
                    <!-- needle -->
                    <line
                        :x1="needle.cx"
                        :y1="needle.cy"
                        :x2="needle.x.toFixed(1)"
                        :y2="needle.y.toFixed(1)"
                        :stroke="tempColor"
                        stroke-width="2.5"
                        stroke-linecap="round"
                    />
                    <circle
                        :cx="needle.cx"
                        :cy="needle.cy"
                        r="4.5"
                        :fill="tempColor"
                    />
                    <circle
                        :cx="needle.cx"
                        :cy="needle.cy"
                        r="2"
                        fill="var(--color-ss-surface)"
                    />
                    <!-- endpoint + active labels -->
                    <text
                        x="16"
                        y="96"
                        font-size="8"
                        fill="currentColor"
                        class="text-ss-text-3"
                    >
                        cold
                    </text>
                    <text
                        x="80"
                        y="14"
                        font-size="8"
                        fill="currentColor"
                        text-anchor="middle"
                        class="text-ss-text-3"
                    >
                        warm
                    </text>
                    <text
                        x="144"
                        y="96"
                        font-size="8"
                        fill="currentColor"
                        text-anchor="end"
                        class="text-ss-text-3"
                    >
                        hot
                    </text>
                    <text
                        :x="needle.cx"
                        y="98"
                        font-size="11"
                        :fill="tempColor"
                        text-anchor="middle"
                        font-weight="600"
                    >
                        {{ temp }}
                    </text>
                </svg>
            </div>

            <!-- 2x2 metric grid -->
            <div class="grid grid-cols-2 gap-2">
                <div
                    class="rounded-lg border border-ss-border bg-ss-bg-2 p-2.5"
                >
                    <div
                        class="text-[10px] font-semibold tracking-wide text-ss-text-3 uppercase"
                    >
                        Connection
                    </div>
                    <div class="text-sm font-semibold text-ss-accent-text">
                        Level {{ trustLevel }}/5
                    </div>
                    <div class="mt-1 flex gap-0.5">
                        <span
                            v-for="(on, i) in segs"
                            :key="i"
                            class="h-1 flex-1 rounded-full"
                            :class="on ? 'bg-ss-accent' : 'bg-ss-border'"
                        />
                    </div>
                    <div class="mt-1 text-[11px] leading-snug text-ss-text-3">
                        {{ reason(strategy.trust_reason) }}
                    </div>
                </div>
                <div
                    class="rounded-lg border border-ss-border bg-ss-bg-2 p-2.5"
                >
                    <div
                        class="text-[10px] font-semibold tracking-wide text-ss-text-3 uppercase"
                    >
                        Customer Type
                    </div>
                    <div class="text-sm font-semibold" :class="archColor">
                        {{ archetype }}
                    </div>
                    <div class="mt-1 text-[11px] leading-snug text-ss-text-3">
                        {{ reason(strategy.archetype_reason) }}
                    </div>
                </div>
                <div
                    class="rounded-lg border border-ss-border bg-ss-bg-2 p-2.5"
                >
                    <div
                        class="text-[10px] font-semibold tracking-wide text-ss-text-3 uppercase"
                    >
                        Phase
                    </div>
                    <div class="text-sm font-semibold" :class="phaseColor">
                        {{ phase }}
                    </div>
                    <div class="mt-1 text-[11px] leading-snug text-ss-text-3">
                        {{
                            reason(
                                strategy.phase_reason ||
                                    strategy.skeleton_step_justification,
                            )
                        }}
                    </div>
                </div>
                <div
                    class="rounded-lg border border-ss-border bg-ss-bg-2 p-2.5"
                >
                    <div
                        class="text-[10px] font-semibold tracking-wide text-ss-text-3 uppercase"
                    >
                        Engagement
                    </div>
                    <div class="text-sm font-semibold" :class="engagement.cls">
                        {{ engagement.label }}
                    </div>
                    <div class="mt-1 text-[11px] leading-snug text-ss-text-3">
                        {{ reason(strategy.temperature_reason) }}
                    </div>
                </div>
            </div>

            <!-- Framework calibration -->
            <div
                v-if="cal"
                class="rounded-lg border border-ss-border bg-ss-bg-2 p-3"
            >
                <div
                    class="mb-1.5 text-[10px] font-semibold tracking-wide text-ss-text-3 uppercase"
                >
                    Framework Calibration
                </div>
                <div
                    class="space-y-1 text-[13px] leading-relaxed text-ss-text-2"
                >
                    <div>
                        <span class="text-ss-text-3">Skeleton Step:</span>
                        <b class="text-ss-text">{{ cal.step }}</b>
                    </div>
                    <div>
                        <span class="text-ss-text-3">Customer:</span> Sex
                        <b class="text-ss-text">{{ cal.cs }}/10</b> · Emo
                        <b class="text-ss-text">{{ cal.ce }}/10</b>
                    </div>
                    <div>
                        <span class="text-ss-text-3">Creator:</span> Sex
                        <b class="text-ss-text">{{ cal.ts }}/10</b> · Emo
                        <b class="text-ss-text">{{ cal.te }}/10</b>
                        <span
                            v-if="cal.clampedBy"
                            class="text-[10px] text-ss-warn"
                        >
                            · {{ cal.clampedBy }}</span
                        >
                        <span
                            v-if="cal.depthGated"
                            class="text-[10px] text-ss-accent-text"
                        >
                            · depth-gated</span
                        >
                    </div>
                    <div>
                        <span class="text-ss-text-3">Power:</span>
                        <b :class="cal.powerCls">{{ cal.power }}</b>
                    </div>
                </div>
            </div>

            <!-- Message purpose -->
            <div class="rounded-lg border border-ss-border bg-ss-bg-2 p-3">
                <div
                    class="mb-1 text-[10px] font-semibold tracking-wide text-ss-text-3 uppercase"
                >
                    Message Purpose
                </div>
                <p class="text-[13px] leading-relaxed text-ss-text-2">
                    {{ strategy.message_purpose || '—' }}
                </p>
            </div>

            <!-- Next move -->
            <div class="rounded-lg border border-ss-border bg-ss-bg-2 p-3">
                <div
                    class="mb-1 text-[10px] font-semibold tracking-wide text-ss-text-3 uppercase"
                >
                    Next Move
                </div>
                <p class="text-[13px] leading-relaxed text-ss-pos">
                    {{ strategy.next_move || '—' }}
                </p>
            </div>

            <!-- Warning -->
            <div
                v-if="warning"
                class="rounded-lg border border-ss-warn/40 bg-ss-bg-2 p-3"
            >
                <div
                    class="mb-1 text-[10px] font-semibold tracking-wide text-ss-warn uppercase"
                >
                    Warning
                </div>
                <p class="text-[13px] leading-relaxed text-ss-warn">
                    {{ warning }}
                </p>
            </div>
        </div>
    </div>
</template>
