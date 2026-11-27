<script setup lang="ts">
import { Link } from '@inertiajs/vue3';
import { ChevronRight, LoaderCircle, Plus, Trash2, Users } from '@lucide/vue';
import { computed } from 'vue';
import type { CreatorModel, OfConnectedAccount } from '@/types/crm';

/**
 * One creator on the Creator Models page: an OnlyFans account, the creator model wired to
 * it, or both. The row says in one glance whether the creator is set up and usable, and
 * offers the one next step (Manage, or Add as creator model).
 */
const props = defineProps<{
    account?: OfConnectedAccount | null;
    model?: CreatorModel | null;
    /** The model has an account id that no provider lists. */
    missing?: boolean;
    chatterNames: string[];
    adding?: boolean;
    addDisabled?: boolean;
}>();

const emit = defineEmits<{ add: []; delete: [] }>();

const name = computed(
    () => props.model?.name ?? props.account?.name ?? 'Unnamed',
);

const initials = computed(
    () =>
        name.value
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0])
            .join('')
            .toUpperCase() || '?',
);

type Status = { label: string; tone: 'pos' | 'warn' | 'neg' | 'muted' };

const status = computed<Status>(() => {
    if (props.account && !props.model) {
        return { label: 'Not added', tone: 'muted' };
    }

    if (props.account && !props.account.isAuthenticated) {
        return { label: 'Needs re-auth', tone: 'warn' };
    }

    if (props.account) {
        return { label: 'Ready', tone: 'pos' };
    }

    if (props.missing) {
        return { label: 'Account missing', tone: 'neg' };
    }

    return { label: 'No account', tone: 'muted' };
});

const toneClass: Record<Status['tone'], string> = {
    pos: 'bg-ss-pos/10 text-ss-pos',
    warn: 'bg-ss-warn/10 text-ss-warn',
    neg: 'bg-ss-neg/10 text-ss-neg',
    muted: 'bg-ss-surface-2 text-ss-text-3',
};

const dotClass: Record<Status['tone'], string> = {
    pos: 'bg-ss-pos',
    warn: 'bg-ss-warn',
    neg: 'bg-ss-neg',
    muted: 'bg-ss-text-3/50',
};

const chatters = computed(() => {
    const n = props.chatterNames.length;

    if (!props.model) {
        return '';
    }

    if (!n) {
        return 'No chatters';
    }

    const shown = props.chatterNames.slice(0, 2).join(', ');

    return n > 2 ? `${shown} +${n - 2}` : shown;
});
</script>

<template>
    <li
        class="group grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3 @2xl:grid-cols-[minmax(0,1.6fr)_8rem_minmax(0,1fr)_8.5rem] @2xl:px-5"
    >
        <!-- Creator -->
        <div class="flex min-w-0 items-center gap-3">
            <img
                v-if="account?.avatar"
                :src="account.avatar"
                alt=""
                class="h-9 w-9 shrink-0 rounded-full bg-ss-surface-2 object-cover"
            />
            <span
                v-else
                class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-ss-surface-2 text-[11px] font-bold text-ss-text-2"
                >{{ initials }}</span
            >
            <div class="min-w-0">
                <div class="truncate text-[13px] font-semibold text-ss-text">
                    {{ name }}
                </div>
                <div class="truncate text-[12px] text-ss-text-3">
                    <template v-if="account">@{{ account.username }}</template>
                    <template v-if="account && model?.tier"> · </template>
                    <span v-if="model?.tier" class="capitalize">{{
                        model.tier
                    }}</span>
                    <template v-if="!account && !model?.tier"
                        >Creator model</template
                    >
                </div>
            </div>
        </div>

        <!-- Status + chatters: one line under the name when narrow, two columns when wide -->
        <div
            class="order-last col-span-2 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 pl-12 @2xl:contents"
        >
            <div>
                <span
                    class="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                    :class="toneClass[status.tone]"
                >
                    <span
                        class="h-1.5 w-1.5 rounded-full"
                        :class="dotClass[status.tone]"
                    />
                    {{ status.label }}
                </span>
            </div>

            <!-- Chatters -->
            <div
                class="flex min-w-0 items-center gap-1.5 text-[12px] text-ss-text-2"
            >
                <template v-if="model">
                    <Users :size="13" class="shrink-0 text-ss-text-3" />
                    <span
                        class="truncate"
                        :class="!chatterNames.length && 'text-ss-text-3'"
                        >{{ chatters }}</span
                    >
                </template>
            </div>
        </div>

        <!-- Action -->
        <div class="flex items-center justify-end gap-1">
            <template v-if="model">
                <button
                    type="button"
                    class="grid h-8 w-8 place-items-center rounded-lg text-ss-text-3 opacity-0 transition group-hover:opacity-100 hover:bg-ss-surface-2 hover:text-ss-neg focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
                    :title="`Delete ${model.name}`"
                    :aria-label="`Delete ${model.name}`"
                    @click="emit('delete')"
                >
                    <Trash2 :size="15" />
                </button>
                <Link
                    :href="`/models/${model.id}`"
                    class="flex items-center gap-0.5 rounded-lg border border-ss-border py-1.5 pr-2 pl-3 text-[12px] font-semibold text-ss-text-2 transition-colors hover:border-ss-accent hover:bg-ss-accent-soft hover:text-ss-accent-text"
                >
                    Manage <ChevronRight :size="14" />
                </Link>
            </template>
            <button
                v-else
                type="button"
                class="flex items-center gap-1.5 rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                :disabled="addDisabled"
                @click="emit('add')"
            >
                <LoaderCircle v-if="adding" :size="13" class="animate-spin" />
                <Plus v-else :size="13" />
                {{ adding ? 'Adding…' : 'Add' }}
            </button>
        </div>
    </li>
</template>
