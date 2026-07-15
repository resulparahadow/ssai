<script setup lang="ts">
import {
    Ban,
    CheckCheck,
    ExternalLink,
    EyeOff,
    LoaderCircle,
    Mail,
    Pencil,
    ShieldMinus,
    UserMinus,
} from '@lucide/vue';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { can } from '@/crm/nav';
import { ofApi } from '@/lib/onlyfans';
import type { Role } from '@/types/auth';
import type { OfChat, OfFan } from '@/types/crm';

/**
 * Fan/chat management actions. The destructive ones (hide, unfollow, restrict, block) act on a
 * real fan's OnlyFans account, so they are manager/admin-only — hidden here and enforced by
 * `can:manage-team` on the route. Popover follows SsGifPicker (mousedown-outside + Escape).
 */
const props = defineProps<{
    modelId: number;
    chat: OfChat;
    fan: OfFan | null;
    role: Role;
}>();
const emit = defineEmits<{
    close: [];
    rename: [];
    /** A chat action changed server state the list should reflect. */
    changed: [patch: Partial<OfChat>];
    /** The chat was hidden on OnlyFans and should leave the list. */
    hidden: [];
}>();

const root = ref<HTMLElement | null>(null);
const busy = ref<string | null>(null);
const error = ref<string | null>(null);

const canManage = computed(() => can(props.role, 'manageTeam'));
const profileUrl = computed(() =>
    props.chat.username ? `https://onlyfans.com/${props.chat.username}` : null,
);

async function run(key: string, fn: () => Promise<unknown>, after?: () => void) {
    busy.value = key;
    error.value = null;

    try {
        await fn();
        after?.();
    } catch (e) {
        error.value = e instanceof Error ? e.message : String(e);

        return;
    } finally {
        busy.value = null;
    }

    emit('close');
}

function markRead() {
    run(
        'read',
        () => ofApi.markRead(props.modelId, props.chat.id),
        () => emit('changed', { unread: 0 }),
    );
}

function markUnread() {
    run(
        'unread',
        () => ofApi.markUnread(props.modelId, props.chat.id),
        () => emit('changed', { unread: Math.max(props.chat.unread, 1) }),
    );
}

function hide() {
    if (
        !confirm(
            `Hide the chat with ${props.chat.name}?\n\nIt disappears from the list on OnlyFans. The only way to bring it back is to send them a new message.`,
        )
    ) {
        return;
    }

    run('hide', () => ofApi.hide(props.modelId, props.chat.id), () => emit('hidden'));
}

function unfollow() {
    if (!confirm(`Unfollow ${props.chat.name} on OnlyFans?`)) {
        return;
    }

    run('unfollow', () => ofApi.unfollow(props.modelId, props.chat.id));
}

/**
 * Restricted state is read off the chat row, not the fan detail: the row is what the list and
 * header render, and patching it back on success keeps all three in step without refetching
 * the fan (whose cached `isRestricted` would otherwise go stale the moment we toggle).
 */
function restrict() {
    const on = props.chat.restricted;

    if (!on && !confirm(`Restrict ${props.chat.name} on OnlyFans?`)) {
        return;
    }

    run(
        'restrict',
        () =>
            on
                ? ofApi.unrestrict(props.modelId, props.chat.id)
                : ofApi.restrict(props.modelId, props.chat.id),
        () => emit('changed', { restricted: !on }),
    );
}

function block() {
    const on = props.fan?.isBlocked ?? false;

    if (
        !on &&
        !confirm(
            `Block ${props.chat.name} on OnlyFans?\n\nThey lose access to this creator's content.`,
        )
    ) {
        return;
    }

    run('block', () =>
        on
            ? ofApi.unblock(props.modelId, props.chat.id)
            : ofApi.block(props.modelId, props.chat.id),
    );
}

function onDocClick(e: MouseEvent) {
    if (root.value && !root.value.contains(e.target as Node)) {
        emit('close');
    }
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        emit('close');
    }
}

onMounted(() => {
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocClick);
    window.removeEventListener('keydown', onKey);
});
</script>

<template>
    <div
        ref="root"
        class="absolute top-full right-0 z-30 mt-2 w-56 overflow-hidden rounded-xl border border-ss-border bg-ss-surface p-1.5 shadow-xl"
    >
        <p
            v-if="error"
            class="mb-1 rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-400"
        >
            {{ error }}
        </p>

        <a
            v-if="profileUrl"
            :href="profileUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ss-text hover:bg-ss-surface-2"
            @click="emit('close')"
        >
            <ExternalLink :size="14" class="text-ss-text-3" />
            Open profile in OnlyFans
        </a>

        <button
            type="button"
            class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ss-text hover:bg-ss-surface-2"
            @click="emit('rename')"
        >
            <Pencil :size="14" class="text-ss-text-3" />
            Rename user
        </button>

        <!-- Both are offered unconditionally: opening a chat already zeroes `unread` locally
             (Conversations.vue), so gating "Mark as read" on it would make it unreachable. -->
        <button
            type="button"
            :disabled="busy === 'read'"
            class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ss-text hover:bg-ss-surface-2 disabled:opacity-40"
            @click="markRead"
        >
            <LoaderCircle
                v-if="busy === 'read'"
                :size="14"
                class="animate-spin text-ss-text-3"
            />
            <CheckCheck v-else :size="14" class="text-ss-text-3" />
            Mark as read
        </button>
        <button
            type="button"
            :disabled="busy === 'unread'"
            class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ss-text hover:bg-ss-surface-2 disabled:opacity-40"
            @click="markUnread"
        >
            <LoaderCircle
                v-if="busy === 'unread'"
                :size="14"
                class="animate-spin text-ss-text-3"
            />
            <Mail v-else :size="14" class="text-ss-text-3" />
            Mark as unread
        </button>

        <template v-if="canManage">
            <div class="my-1 h-px bg-ss-border" />

            <button
                type="button"
                :disabled="busy === 'hide'"
                class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ss-text hover:bg-ss-surface-2 disabled:opacity-40"
                @click="hide"
            >
                <EyeOff :size="14" class="text-ss-text-3" />
                Hide chat
            </button>

            <button
                type="button"
                :disabled="busy === 'unfollow'"
                class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ss-text hover:bg-ss-surface-2 disabled:opacity-40"
                @click="unfollow"
            >
                <UserMinus :size="14" class="text-ss-text-3" />
                Unfollow
            </button>

            <button
                type="button"
                :disabled="busy === 'restrict'"
                class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ss-text hover:bg-ss-surface-2 disabled:opacity-40"
                @click="restrict"
            >
                <ShieldMinus :size="14" class="text-ss-text-3" />
                {{ chat.restricted ? 'Unrestrict' : 'Restrict' }}
            </button>

            <button
                type="button"
                :disabled="busy === 'block'"
                class="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] text-ss-neg hover:bg-ss-surface-2 disabled:opacity-40"
                @click="block"
            >
                <Ban :size="14" />
                {{ fan?.isBlocked ? 'Unblock' : 'Block' }}
            </button>
        </template>
    </div>
</template>
