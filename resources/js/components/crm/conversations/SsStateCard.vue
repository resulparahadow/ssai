<script setup lang="ts">
import { Gauge, LoaderCircle } from '@lucide/vue';
import { computed } from 'vue';
import {
    SWITCHES,
    parseSwitchValue,
    rowSelected,
    rowValue,
} from '@/lib/stateSwitches';
import type { SwitchKey, SwitchValue } from '@/lib/stateSwitches';
import type { OfFanProfile } from '@/types/crm';

/**
 * "SSAI state" — SSAI's current read of the fan, one row per §5b switch, and the chatter's way
 * to correct it. A row on Auto shows SSAI's own read in muted text; a manual row is highlighted
 * and stays until someone sets it back to Auto. Saving is the parent's job (optimistic, with
 * rollback): this card only renders and emits the change.
 */
const props = defineProps<{
    profile: OfFanProfile;
    saving: Partial<Record<SwitchKey, boolean>>;
    error: string | null;
}>();

const emit = defineEmits<{
    change: [key: SwitchKey, value: SwitchValue | null];
}>();

const rows = computed(() =>
    SWITCHES.map((sw) => ({
        sw,
        view: rowValue(sw.key, props.profile),
        selected: rowSelected(sw.key, props.profile),
    })).filter((r) => !r.view.hidden),
);

const manualCount = computed(
    () => rows.value.filter((r) => r.view.manual).length,
);

function onSelect(key: SwitchKey, e: Event) {
    const raw = (e.target as HTMLSelectElement).value;
    emit('change', key, parseSwitchValue(key, raw));
}
</script>

<template>
    <div
        class="space-y-2 rounded-lg border border-ss-border bg-ss-bg-2 p-3"
        data-testid="state-card"
    >
        <div class="flex items-center justify-between gap-2">
            <div class="flex items-center gap-1.5">
                <Gauge :size="14" class="text-ss-accent" />
                <span class="text-[12px] font-semibold text-ss-text"
                    >SSAI state</span
                >
            </div>
            <span
                v-if="manualCount > 0"
                class="rounded-full bg-ss-accent-soft px-2 py-0.5 text-[10px] font-semibold text-ss-accent-text"
                >{{ manualCount }} set by agent</span
            >
            <span v-else class="text-[10px] text-ss-text-3">All auto</span>
        </div>

        <p class="text-[10px] leading-snug text-ss-text-3">
            Correct SSAI when it misreads him. A setting stays until you set it
            back to Auto.
        </p>

        <p v-if="error" class="text-[11px] text-ss-neg" role="alert">
            {{ error }}
        </p>

        <div class="divide-y divide-ss-border/60">
            <div
                v-for="r in rows"
                :key="r.sw.key"
                class="flex items-center justify-between gap-2 py-1"
                :data-testid="`state-row-${r.sw.key}`"
                :data-manual="r.view.manual ? 'true' : 'false'"
            >
                <span
                    class="flex min-w-0 items-center gap-1.5 text-[11px]"
                    :class="
                        r.view.manual
                            ? 'font-semibold text-ss-text'
                            : 'text-ss-text-3'
                    "
                >
                    <span
                        class="h-1.5 w-1.5 shrink-0 rounded-full"
                        :class="
                            r.view.manual ? 'bg-ss-accent' : 'bg-transparent'
                        "
                        aria-hidden="true"
                    />
                    {{ r.sw.label }}
                    <LoaderCircle
                        v-if="saving[r.sw.key]"
                        :size="10"
                        class="animate-spin text-ss-text-3"
                        aria-label="Saving"
                    />
                </span>

                <!-- The timewaster flag wins over Posture: show why, not a dead dropdown. -->
                <span
                    v-if="r.view.disabled"
                    class="max-w-[60%] truncate rounded-md border border-dashed border-ss-border px-2 py-1 text-[11px] text-ss-text-3"
                    :title="r.view.reason"
                    :data-testid="`state-value-${r.sw.key}`"
                    >{{ r.view.text }}</span
                >
                <select
                    v-else
                    :value="r.selected"
                    :aria-label="r.sw.label"
                    :title="r.view.text"
                    :data-testid="`state-select-${r.sw.key}`"
                    class="max-w-[60%] min-w-0 truncate rounded-md border px-1.5 py-1 text-[11px]"
                    :class="
                        r.view.manual
                            ? 'border-ss-accent/60 bg-ss-accent-soft font-semibold text-ss-accent-text'
                            : 'border-ss-border bg-ss-surface text-ss-text-3'
                    "
                    @change="onSelect(r.sw.key, $event)"
                >
                    <option v-if="r.sw.auto" value="">
                        {{ r.view.manual ? 'Auto' : r.view.text }}
                    </option>
                    <!-- A stored value outside the list (a trust pinned at L0 in the Memory card). -->
                    <option
                        v-if="
                            r.selected !== '' &&
                            !r.sw.values.some(
                                (v) => String(v.value) === r.selected,
                            )
                        "
                        :value="r.selected"
                    >
                        {{ r.view.text }}
                    </option>
                    <option
                        v-for="v in r.sw.values"
                        :key="String(v.value)"
                        :value="String(v.value)"
                    >
                        {{ v.label }}
                    </option>
                </select>
            </div>
        </div>
    </div>
</template>
