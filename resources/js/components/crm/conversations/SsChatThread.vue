<script setup lang="ts">
import {
    AlertCircle,
    Bell,
    BellOff,
    Ellipsis,
    Heart,
    Image,
    LoaderCircle,
    NotebookPen,
    Pin,
    PinOff,
    RefreshCw,
    Search,
    ShieldMinus,
    Trash2,
    Wallet,
    X,
} from '@lucide/vue';
import { computed, nextTick, ref, watch } from 'vue';
import SsFanSettingsMenu from '@/components/crm/conversations/SsFanSettingsMenu.vue';
import SsMessageMedia from '@/components/crm/conversations/SsMessageMedia.vue';
import SsNoteModal from '@/components/crm/conversations/SsNoteModal.vue';
import SsPayPill from '@/components/crm/conversations/SsPayPill.vue';
import SsPinnedModal from '@/components/crm/conversations/SsPinnedModal.vue';
import SsRenameModal from '@/components/crm/conversations/SsRenameModal.vue';
import { usd } from '@/lib/money';
import { ofApi } from '@/lib/onlyfans';
import type { Role } from '@/types/auth';
import type { OfChat, OfFan, OfMessage } from '@/types/crm';

const props = defineProps<{
    modelId: number;
    chat: OfChat;
    fan: OfFan | null;
    role: Role;
    messages: OfMessage[];
    loading: boolean;
    error: string | null;
    hasMore: boolean;
    loadingMore: boolean;
    loadMoreError: string | null;
    spend: number | null; // fan's live lifetime spend; null while loading
}>();

const emit = defineEmits<{
    like: [m: OfMessage];
    delete: [m: OfMessage];
    resend: [m: OfMessage];
    loadMore: [];
    /** Server state changed — patch the chat row (and its cache) in place. */
    'chat-changed': [patch: Partial<OfChat>];
    /** The chat was hidden on OnlyFans and should leave the list. */
    hidden: [];
}>();

// ---- search (server, with client-filter fallback) ----
const query = ref('');
const searchResults = ref<OfMessage[] | null>(null);

async function runSearch() {
    const q = query.value.trim();

    if (!q) {
        searchResults.value = null;

        return;
    }

    try {
        const r = await ofApi.search(props.modelId, props.chat.id, q);
        searchResults.value = r.messages as OfMessage[];
    } catch {
        // fall back to filtering already-loaded messages
        searchResults.value = props.messages.filter((m) =>
            m.text.toLowerCase().includes(q.toLowerCase()),
        );
    }
}

function clearSearch() {
    query.value = '';
    searchResults.value = null;
}

const shown = computed(() => searchResults.value ?? props.messages);

// Open/refresh at the newest message (bottom), like any chat app — except while paginating
// older history (scroll-to-top auto-load), where we hold the viewport steady on what the
// user was reading. `prependAnchor` records the distance from the bottom just before we
// emit; since prepending only adds height above the viewport, restoring that same distance
// keeps the previously-visible messages in place.
const threadEl = ref<HTMLElement | null>(null);
const prependAnchor = ref<number | null>(null);

// Distance from the top (px) at which we start pulling the next older page.
const LOAD_OLDER_THRESHOLD = 140;
// After older messages prepend, land this far ABOVE the exact-preserve point so a slice of
// the just-loaded messages peeks into view (confirms the load instead of sitting still).
const REVEAL_ON_LOAD = 80;

function scrollToBottom() {
    const el = threadEl.value;

    if (el) {
        el.scrollTop = el.scrollHeight;
    }
}

// Anchor the current view and ask the parent for the next older page. Also the manual retry
// target, so it deliberately ignores loadMoreError — the auto path below gates on it.
function requestOlder() {
    const el = threadEl.value;

    if (
        !el ||
        !props.hasMore ||
        props.loadingMore ||
        props.loading ||
        !props.messages.length || // never paginate before the first page exists
        searchResults.value
    ) {
        return;
    }

    prependAnchor.value = el.scrollHeight - el.scrollTop;
    emit('loadMore');
}

// Auto-load older history when the user scrolls near the top. Deliberately NOT triggered by
// an unscrollable/short thread — with 100-message pages that just means there's no real older
// history, and firing there produced a wasteful second "loading" right after the first page.
// Never auto-retries after an error — the user does that via the Retry button.
function maybeAutoLoad() {
    const el = threadEl.value;

    if (!el || props.loadMoreError) {
        return;
    }

    if (el.scrollTop <= LOAD_OLDER_THRESHOLD) {
        requestOlder();
    }
}

watch(
    () => props.messages,
    () => {
        const el = threadEl.value;
        const anchor = prependAnchor.value;
        prependAnchor.value = null; // consume on any change so it can't go stale

        // This change came from an older-history load → hold the from-bottom anchor. This
        // must apply even when the page added nothing (end of history): scrollHeight is
        // unchanged, so restoring the anchor keeps the exact position instead of jumping
        // to the newest message.
        if (anchor != null && el) {
            nextTick(() => {
                // Land slightly ABOVE the exact-preserve point so a slice of the just-loaded
                // older messages shows; clamp so we never scroll past the very top.
                el.scrollTop = Math.max(0, el.scrollHeight - anchor - REVEAL_ON_LOAD);
                maybeAutoLoad(); // a short page can still leave us near the top — keep going
            });

            return;
        }

        nextTick(scrollToBottom);
    },
);

// If an older-history fetch ends without changing the thread (a network error — the messages
// watcher above never fires to consume the anchor), drop the stale anchor so the next real
// update (e.g. a live inbound) still scrolls to the newest message as usual.
watch(
    () => props.loadingMore,
    (loading) => {
        if (!loading) {
            prependAnchor.value = null;
        }
    },
);

function fmtTime(t: string | null): string {
    if (!t) {
        return '';
    }

    const d = new Date(t);

    return isNaN(d.getTime())
        ? ''
        : d.toLocaleString([], {
              month: 'short',
              day: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
          });
}

// ---- header actions (mute / pinned / note / rename / fan settings) ----
const showPinned = ref(false);
const showNote = ref(false);
const showRename = ref(false);
const showSettings = ref(false);
const muting = ref(false);
const muteError = ref<string | null>(null);

/**
 * Mute is optimistic: flip the row (which is a live reference into the chat list, so the list
 * and its cache update together) and roll back if OnlyFans rejects it.
 */
async function toggleMute() {
    const next = !props.chat.muted;
    muting.value = true;
    muteError.value = null;
    emit('chat-changed', { muted: next });

    try {
        await (next
            ? ofApi.mute(props.modelId, props.chat.id)
            : ofApi.unmute(props.modelId, props.chat.id));
    } catch (e) {
        emit('chat-changed', { muted: !next });
        muteError.value = e instanceof Error ? e.message : String(e);
    } finally {
        muting.value = false;
    }
}

/** Scroll a pinned message into view in the thread, if it's already loaded. */
function jumpTo(m: OfMessage) {
    showPinned.value = false;

    if (!m.id) {
        return;
    }

    nextTick(() => {
        const el = document.getElementById(`msg-${m.id}`);

        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            el.classList.add('ring-2', 'ring-ss-accent');
            setTimeout(() => el.classList.remove('ring-2', 'ring-ss-accent'), 1600);
        }
    });
}

async function togglePin(m: OfMessage) {
    if (!m.id || m.pinning) {
        return;
    }

    const next = !m.isPinned;
    m.pinning = true;

    try {
        await (next
            ? ofApi.pin(props.modelId, props.chat.id, m.id)
            : ofApi.unpin(props.modelId, props.chat.id, m.id));
        m.isPinned = next;
        emit('chat-changed', {
            pinnedCount: Math.max(0, props.chat.pinnedCount + (next ? 1 : -1)),
        });
    } catch (e) {
        alert(e instanceof Error ? e.message : String(e));
    } finally {
        m.pinning = false;
    }
}

// ---- media gallery ----
const showMedia = ref(false);
const mediaItems = ref<Record<string, unknown>[]>([]);
const mediaLoading = ref(false);

// The component instance is reused across chat/creator switches, so close the gallery and
// drop its items when the chat changes — otherwise a new chat shows the previous one's media.
// Same reason the header's overlays are reset here.
watch(
    () => [props.modelId, props.chat.id],
    () => {
        showMedia.value = false;
        mediaItems.value = [];
        showPinned.value = false;
        showNote.value = false;
        showRename.value = false;
        showSettings.value = false;
        muteError.value = null;
    },
);

async function openMedia() {
    showMedia.value = true;
    mediaLoading.value = true;

    try {
        const r = await ofApi.media(props.modelId, props.chat.id);
        mediaItems.value = (r.items as Record<string, unknown>[]) ?? [];
    } catch {
        mediaItems.value = [];
    } finally {
        mediaLoading.value = false;
    }
}

// The gallery returns raw OnlyFans items in a few possible shapes — pull a CDN url from the
// flat fields or the nested `files.*.url`, then load it through our proxy (the raw cdn urls are
// IP-locked and 403 in the browser, same as message media).
function thumb(item: Record<string, unknown>): string | null {
    const files = (item.files ?? {}) as Record<
        string,
        { url?: string } | undefined
    >;
    const cdn = (item.thumb ||
        item.preview ||
        item.squarePreview ||
        item.src ||
        item.full ||
        item.url ||
        files.thumb?.url ||
        files.preview?.url ||
        files.squarePreview?.url ||
        files.full?.url ||
        null) as string | null;

    return cdn ? ofApi.mediaUrl(props.modelId, cdn) : null;
}
</script>

<template>
    <div
        class="relative flex min-w-0 flex-1 flex-col rounded-xl border border-ss-border bg-ss-surface"
    >
        <!-- Header -->
        <div class="flex items-center gap-3 border-b border-ss-border p-3">
            <span
                class="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-lg bg-ss-surface-2 text-[11px] font-semibold text-ss-text-2"
            >
                <img
                    v-if="chat.avatar"
                    :src="chat.avatar"
                    :alt="chat.name"
                    class="h-full w-full object-cover"
                />
                <template v-else>{{ chat.initials }}</template>
            </span>
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5">
                    <span class="truncate text-sm font-semibold text-ss-text">
                        {{ chat.name }}
                    </span>
                    <!-- Restricted state comes free on the chat list payload; it stays in
                         sync because the fan-settings menu patches the same row. -->
                    <span
                        v-if="chat.restricted"
                        class="inline-flex shrink-0 items-center gap-1 rounded-full bg-ss-warn/12 px-1.5 py-0.5 text-[10px] font-semibold text-ss-warn"
                        title="This fan is restricted on OnlyFans — they can't see or comment on this creator's posts"
                    >
                        <ShieldMinus :size="11" />
                        Restricted
                    </span>
                </div>
                <div class="truncate text-[12px] text-ss-text-3">
                    @{{ chat.username }}
                </div>
            </div>
            <!-- fan's total lifetime spend (currency-masked); hidden until loaded -->
            <span
                v-if="spend != null"
                class="inline-flex shrink-0 items-center gap-1 rounded-full bg-ss-pos/12 px-2.5 py-1 text-[12px] font-semibold text-ss-pos"
                title="Total lifetime spend"
            >
                <Wallet :size="13" />
                {{ usd(spend) }}
            </span>
            <div class="relative flex items-center">
                <Search :size="13" class="absolute left-2 text-ss-text-3" />
                <input
                    v-model="query"
                    type="text"
                    placeholder="Search"
                    class="h-8 w-36 rounded-lg border border-ss-border bg-ss-bg pr-6 pl-7 text-[12px] text-ss-text placeholder:text-ss-text-3 focus:w-48 focus:border-ss-accent focus:outline-none"
                    @keyup.enter="runSearch"
                />
                <button
                    v-if="searchResults"
                    type="button"
                    class="absolute right-1.5 text-ss-text-3 hover:text-ss-text"
                    @click="clearSearch"
                >
                    <X :size="13" />
                </button>
            </div>
            <!-- Chat actions -->
            <div class="flex shrink-0 items-center gap-0.5">
                <button
                    type="button"
                    :disabled="muting"
                    class="grid h-8 w-8 place-items-center rounded-lg hover:bg-ss-surface-2 disabled:opacity-40"
                    :class="chat.muted ? 'text-ss-warn' : 'text-ss-text-2'"
                    :title="
                        muteError ??
                        (chat.muted
                            ? 'Unmute notifications'
                            : 'Mute notifications')
                    "
                    @click="toggleMute"
                >
                    <component
                        :is="chat.muted ? BellOff : Bell"
                        :size="16"
                    />
                </button>

                <button
                    type="button"
                    :disabled="chat.pinnedCount === 0"
                    class="relative grid h-8 w-8 place-items-center rounded-lg text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-30 disabled:hover:bg-transparent"
                    :title="
                        chat.pinnedCount === 0
                            ? 'No pinned messages'
                            : `Pinned messages (${chat.pinnedCount})`
                    "
                    @click="showPinned = true"
                >
                    <Pin :size="16" />
                    <span
                        v-if="chat.pinnedCount > 0"
                        class="absolute -top-0.5 -right-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-ss-accent px-1 text-[9px] font-bold text-white"
                        >{{ chat.pinnedCount }}</span
                    >
                </button>

                <button
                    type="button"
                    class="grid h-8 w-8 place-items-center rounded-lg text-ss-text-2 hover:bg-ss-surface-2"
                    title="Edit OnlyFans note"
                    @click="showNote = true"
                >
                    <NotebookPen :size="16" />
                </button>

                <button
                    type="button"
                    class="grid h-8 w-8 place-items-center rounded-lg text-ss-text-2 hover:bg-ss-surface-2"
                    title="Chat media gallery"
                    @click="openMedia"
                >
                    <Image :size="16" />
                </button>

                <div class="relative">
                    <button
                        type="button"
                        class="grid h-8 w-8 place-items-center rounded-lg hover:bg-ss-surface-2"
                        :class="
                            showSettings ? 'text-ss-text' : 'text-ss-text-2'
                        "
                        title="Fan settings"
                        @click.stop="showSettings = !showSettings"
                    >
                        <Ellipsis :size="16" />
                    </button>
                    <SsFanSettingsMenu
                        v-if="showSettings"
                        :model-id="modelId"
                        :chat="chat"
                        :fan="fan"
                        :role="role"
                        @close="showSettings = false"
                        @rename="
                            showSettings = false;
                            showRename = true;
                        "
                        @changed="emit('chat-changed', $event)"
                        @hidden="emit('hidden')"
                    />
                </div>
            </div>
        </div>

        <SsPinnedModal
            v-if="showPinned"
            :model-id="modelId"
            :chat-id="chat.id"
            :creator="chat.name"
            @close="showPinned = false"
            @jump="jumpTo"
            @unpinned="
                emit('chat-changed', {
                    pinnedCount: Math.max(0, chat.pinnedCount - 1),
                })
            "
        />
        <SsNoteModal
            v-if="showNote"
            :model-id="modelId"
            :chat-id="chat.id"
            :fan-name="chat.name"
            @close="showNote = false"
        />
        <SsRenameModal
            v-if="showRename"
            :model-id="modelId"
            :chat-id="chat.id"
            :current="chat.name"
            @close="showRename = false"
            @renamed="emit('chat-changed', { name: $event })"
        />

        <!-- Thread -->
        <div
            ref="threadEl"
            class="flex-1 scrollbar-gutter-stable space-y-3 overflow-y-auto p-4"
            @scroll.passive="maybeAutoLoad"
        >
            <!-- Older-history status: a zero-height sticky overlay so it floats over the top
                 of the thread WITHOUT shifting the messages. Scroll-driven (auto-loads as the
                 user nears the top); shown only once a first page exists. -->
            <div
                v-if="!searchResults && shown.length && (loadingMore || loadMoreError)"
                class="pointer-events-none sticky top-2 z-10 flex h-0 justify-center overflow-visible"
            >
                <span
                    v-if="loadingMore"
                    class="inline-flex items-center gap-1.5 rounded-full border border-ss-border bg-ss-surface-2 px-4 py-1.5 text-[12px] text-ss-text-2 shadow-sm"
                >
                    <LoaderCircle :size="12" class="animate-spin" />
                    Loading older messages…
                </span>
                <span
                    v-else
                    class="pointer-events-auto inline-flex items-center gap-2 rounded-full border border-ss-border bg-ss-surface-2 px-4 py-1.5 text-[11px] shadow-sm"
                >
                    <span class="text-ss-neg">{{ loadMoreError }}</span>
                    <button
                        type="button"
                        class="inline-flex items-center gap-1 font-medium text-ss-text-2 transition-colors hover:text-ss-text"
                        @click="requestOlder"
                    >
                        <RefreshCw :size="11" /> Retry
                    </button>
                </span>
            </div>
            <p
                v-if="searchResults"
                class="text-center text-[11px] text-ss-text-3"
            >
                {{ shown.length }} result(s) ·
                <button class="text-ss-accent-text" @click="clearSearch">
                    clear
                </button>
            </p>
            <div
                v-for="(m, i) in shown"
                :id="m.id ? `msg-${m.id}` : undefined"
                :key="m.id ?? i"
                class="group flex flex-col rounded-2xl transition-shadow"
                :class="m.from === 'creator' ? 'items-end' : 'items-start'"
            >
                <div
                    class="flex items-center gap-1.5"
                    :class="m.from === 'creator' ? 'flex-row-reverse' : ''"
                >
                    <div
                        class="max-w-[78%] rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed transition-opacity"
                        :class="[
                            m.from === 'creator'
                                ? 'bg-ss-accent text-white'
                                : 'border border-ss-border bg-ss-surface-2 text-ss-text',
                            m.pending ? 'opacity-60' : '',
                        ]"
                    >
                        <SsMessageMedia
                            v-if="m.media?.length"
                            :media="m.media"
                            :price="m.price"
                            :model-id="modelId"
                            hide-price
                        />
                        <span v-if="m.text">{{ m.text }}</span>
                        <!-- fallback: count-only when the API gave us no media objects (e.g. cached/locked with no preview) -->
                        <span
                            v-else-if="!m.media?.length && m.mediaCount"
                            class="text-[12px] opacity-80"
                            >📎 {{ m.mediaCount }} media</span
                        >
                        <span
                            v-else-if="!m.text && !m.media?.length"
                            class="text-[12px] opacity-70"
                            >(no text)</span
                        >
                    </div>
                    <!-- actions (real messages only): a liked heart stays visible; delete shows on hover -->
                    <div
                        v-if="!m.pending && !m.failed"
                        class="flex shrink-0 items-center gap-0.5"
                    >
                        <button
                            type="button"
                            class="grid h-6 w-6 place-items-center rounded transition-opacity hover:text-ss-neg disabled:cursor-default"
                            :class="
                                m.isLiked || m.liking
                                    ? 'text-ss-neg opacity-100'
                                    : 'text-ss-text-3 opacity-0 group-hover:opacity-100'
                            "
                            :title="m.liking ? 'Saving…' : 'Like / unlike'"
                            :disabled="m.liking"
                            @click="emit('like', m)"
                        >
                            <LoaderCircle
                                v-if="m.liking"
                                :size="13"
                                class="animate-spin"
                            />
                            <Heart
                                v-else
                                :size="13"
                                :fill="m.isLiked ? 'currentColor' : 'none'"
                            />
                        </button>
                        <button
                            type="button"
                            class="grid h-6 w-6 place-items-center rounded transition-opacity disabled:cursor-default"
                            :class="
                                m.isPinned || m.pinning
                                    ? 'text-ss-accent opacity-100'
                                    : 'text-ss-text-3 opacity-0 group-hover:opacity-100 hover:text-ss-text'
                            "
                            :title="
                                m.pinning
                                    ? 'Saving…'
                                    : m.isPinned
                                      ? 'Unpin'
                                      : 'Pin message'
                            "
                            :disabled="m.pinning"
                            @click="togglePin(m)"
                        >
                            <LoaderCircle
                                v-if="m.pinning"
                                :size="13"
                                class="animate-spin"
                            />
                            <PinOff v-else-if="m.isPinned" :size="13" />
                            <Pin v-else :size="13" />
                        </button>
                        <button
                            type="button"
                            class="grid h-6 w-6 place-items-center rounded text-ss-text-3 opacity-0 transition-opacity group-hover:opacity-100 hover:text-ss-neg"
                            title="Delete on OnlyFans"
                            @click="emit('delete', m)"
                        >
                            <Trash2 :size="13" />
                        </button>
                    </div>
                </div>
                <!-- price + paid/unpaid (PPV) or tip; renders nothing for free messages -->
                <SsPayPill :message="m" />
                <span
                    class="mt-1 flex items-center gap-1 px-1 text-[10px] text-ss-text-3"
                >
                    {{
                        m.from === 'creator' ? chat.name + ' · you' : chat.name
                    }}
                    <template v-if="m.pending">
                        ·
                        <LoaderCircle :size="11" class="animate-spin" />
                        sending…
                    </template>
                    <template v-else-if="m.failed">
                        · <AlertCircle :size="11" class="text-ss-neg" />
                        <span class="text-ss-neg">not sent</span>
                        <button
                            type="button"
                            class="ml-1 inline-flex items-center gap-0.5 rounded px-1 font-medium text-ss-accent-text hover:bg-ss-accent-soft"
                            title="Resend this message"
                            @click="emit('resend', m)"
                        >
                            <RefreshCw :size="10" /> Resend
                        </button>
                    </template>
                    <template v-else>· {{ fmtTime(m.time) }}</template>
                </span>
            </div>

            <p
                v-if="loading"
                class="py-10 text-center text-[13px] text-ss-text-3"
            >
                Loading messages…
            </p>
            <p
                v-else-if="error"
                class="py-10 text-center text-[12px] text-ss-neg"
            >
                {{ error }}
            </p>
            <p
                v-else-if="!shown.length"
                class="py-10 text-center text-[13px] text-ss-text-3"
            >
                No messages.
            </p>
        </div>

        <slot name="composer" />

        <!-- Media gallery overlay -->
        <div
            v-if="showMedia"
            class="absolute inset-0 z-10 flex flex-col rounded-xl bg-ss-surface"
        >
            <div
                class="flex items-center justify-between border-b border-ss-border p-3"
            >
                <span class="text-sm font-semibold text-ss-text"
                    >Chat media</span
                >
                <button
                    type="button"
                    class="grid h-8 w-8 place-items-center rounded-lg text-ss-text-2 hover:bg-ss-surface-2"
                    @click="showMedia = false"
                >
                    <X :size="16" />
                </button>
            </div>
            <div class="flex-1 overflow-y-auto p-3">
                <p
                    v-if="mediaLoading"
                    class="py-8 text-center text-[13px] text-ss-text-3"
                >
                    Loading media…
                </p>
                <p
                    v-else-if="!mediaItems.length"
                    class="py-8 text-center text-[13px] text-ss-text-3"
                >
                    No media in this chat.
                </p>
                <div v-else class="grid grid-cols-3 gap-2">
                    <div
                        v-for="(item, i) in mediaItems"
                        :key="i"
                        class="aspect-square overflow-hidden rounded-lg bg-ss-surface-2"
                    >
                        <img
                            v-if="thumb(item)"
                            :src="thumb(item) as string"
                            class="h-full w-full object-cover"
                        />
                        <div
                            v-else
                            class="grid h-full place-items-center text-[11px] text-ss-text-3"
                        >
                            media
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
