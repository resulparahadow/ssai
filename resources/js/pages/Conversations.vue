<script setup lang="ts">
import { Head, usePage } from '@inertiajs/vue3';
import { MessageSquare, Users } from '@lucide/vue';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import SsAiIntel from '@/components/crm/conversations/SsAiIntel.vue';
import SsChatThread from '@/components/crm/conversations/SsChatThread.vue';
import SsComposer from '@/components/crm/conversations/SsComposer.vue';
import SsConvoList from '@/components/crm/conversations/SsConvoList.vue';
import SsFanPanel from '@/components/crm/conversations/SsFanPanel.vue';
import SsCreatorPrompt from '@/components/crm/SsCreatorPrompt.vue';
import { useCreatorContext } from '@/composables/useCreatorContext';
import {
    chatComposer,
    chatsCache,
    fanCache,
    msgCache,
    nextCache,
} from '@/lib/conversationCache';
import type { ComposerState } from '@/lib/conversationCache';
import { mediaSrc, messagePreviewKind, ofApi } from '@/lib/onlyfans';
import {
    ensureSubscribed,
    onInboundMessage,
    setActiveChat,
} from '@/lib/realtimeInbound';
import type { InboundPayload } from '@/lib/realtimeInbound';
import type { Role } from '@/types/auth';
import type {
    ComposerAttachment,
    OfChat,
    OfFan,
    OfMedia,
    OfMessage,
    SidebarCreator,
} from '@/types/crm';

const page = usePage();
const { selectedId } = useCreatorContext();

const creators = computed<SidebarCreator[]>(
    () => (page.props.creators as SidebarCreator[]) ?? [],
);
// The globally-selected creator (from the sidebar). Null when "All creators" is active or none
// is set — the thread area then prompts to pick one.
const model = computed<SidebarCreator | null>(
    () => creators.value.find((c) => c.id === selectedId.value) ?? null,
);

const chats = ref<OfChat[]>([]);
const chatsLoading = ref(false);
const chatsError = ref<string | null>(null);
const selected = ref<OfChat | null>(null);
const activeModelId = ref<number | null>(null);

const messages = ref<OfMessage[]>([]);
const msgsLoading = ref(false);
const msgsError = ref<string | null>(null);
// Cursor + state for loading OLDER messages (pagination). `msgsNext` mirrors
// nextCache for the open chat: a cursor to fetch the next older page, or null
// when the oldest page has been reached.
const msgsNext = ref<Record<string, string> | null>(null);
const msgsLoadingMore = ref(false);
const msgsMoreError = ref<string | null>(null);
const fan = ref<OfFan | null>(null);

// Right rail: Fan / AI Intel tabs.
const rail = ref<'fan' | 'ai'>('fan');

// The open chat's composer state (draft / generating / AI strategy). Per-chat,
// so loading + results stay attached to the chat they belong to and drafts are
// preserved across switches.
const cur = computed(() =>
    selected.value ? chatComposer(selected.value.id) : null,
);

// Drives which fan-settings actions are offered. UI-only — `can:manage-team` on the
// route is the actual enforcement.
const role = computed<Role>(
    () =>
        (page.props.auth as { user?: { role?: Role } })?.user?.role ??
        'chatter',
);

/**
 * Patch the open chat's row after a server action. `selected` is a live reference into
 * `chats.value`, which shares its backing array with chatsCache — so an in-place mutation
 * updates the row, the list and the cache at once. Never reassign the array here.
 */
function patchChat(patch: Partial<OfChat>) {
    if (selected.value) {
        Object.assign(selected.value, patch);
    }
}

/** A hidden chat is gone from OnlyFans' list — drop it locally and close the thread. */
function dropChat() {
    const id = selected.value?.id;

    if (!id) {
        return;
    }

    const i = chats.value.findIndex((c) => c.id === id);

    if (i !== -1) {
        chats.value.splice(i, 1); // splice keeps the array identity chatsCache relies on
    }

    msgCache.delete(id);
    fanCache.delete(id);
    nextCache.delete(id);
    selected.value = null;
    messages.value = [];
    fan.value = null;
}

async function generate() {
    const m = model.value;
    const chat = selected.value;

    if (!m || !chat) {
        return;
    }

    const chatId = chat.id;
    const st = chatComposer(chatId);
    st.generating = true;
    st.error = null;

    try {
        // Use the cached thread for THIS chat, not whatever is on screen now.
        const thread =
            msgCache.get(chatId) ??
            (selected.value?.id === chatId ? messages.value : []);
        const data = await ofApi.generate(m.id, chatId, {
            messages: thread.map((mm) => ({
                from: mm.from,
                text: mm.text,
                time: mm.time,
                price: mm.price,
                isFree: mm.isFree,
                isOpened: mm.isOpened,
                isTip: mm.isTip,
            })),
            // Name + username are load-bearing, not decoration: the legacy prompt prints
            // "Customer: {name} (@{username})" and then tells the model "You already know
            // his name ({name})... use his name when it fits". Omitting them makes the
            // engine fall back to the literal string 'Fan', which the AI then uses as his name.
            customer: { id: chatId, name: chat.name, username: chat.username },
            api: 'claude',
            context: st.context.trim(),
        });

        st.suggestion = data.draft || null;
        st.strategy = data.strategy;
        st.strategyGeneratedAt = data.generatedAt ?? new Date().toISOString();
        st.telemetry = data.telemetry ?? null;

        if (!data.draft) {
            st.error =
                'Engine returned an empty draft (is the engine running with an API key?).';
        } else if (data.strategy && selected.value?.id === chatId) {
            rail.value = 'ai'; // surface intel only if this chat is still open
        }
    } catch (e) {
        st.error = e instanceof Error ? e.message : String(e);
    } finally {
        st.generating = false;
    }
}

/** Persist the adopted generation's strategy so the next Generate builds on it.
 *  Fire-and-forget — a failed commit must never block the chatter. */
function commitStrategyMemory(chatId: string) {
    const m = model.value;
    const st = chatComposer(chatId);

    if (!m || !st.strategy) {
        return;
    }

    ofApi
        .commitState(m.id, chatId, {
            strategy: st.strategy,
            telemetry: st.telemetry,
        })
        .catch(() => {});
}

/** Accept the suggestion into the typing bar to edit before sending. */
function acceptSuggestion() {
    const st = cur.value;
    const chatId = selected.value?.id;

    if (!st || !st.suggestion || !chatId) {
        return;
    }

    commitStrategyMemory(chatId);
    st.draft = st.suggestion;
    st.suggestion = null;
}

/** Accept the suggestion and send it straight to OnlyFans (without parking it in the typing bar). */
async function acceptAndSend() {
    const st = cur.value;
    const chatId = selected.value?.id;

    if (!st || !st.suggestion || !chatId) {
        return;
    }

    commitStrategyMemory(chatId);
    const text = st.suggestion;
    st.suggestion = null;
    await send(text);
}

function dismissSuggestion() {
    if (cur.value) {
        cur.value.suggestion = null;
    }
}

async function send(override?: string) {
    const m = model.value;
    const chat = selected.value;

    if (!m || !chat) {
        return;
    }

    const chatId = chat.id;
    const st = chatComposer(chatId);
    // Accept & Send passes the suggestion directly so it never lands in the typing bar.
    const text = (override ?? st.draft).trim();
    const gif = st.gif;
    // A ready attachment is sendable on its own (no caption required) — mirrors
    // SsComposer's `sendable` computed, which enables Send once the attachment is 'ready'.
    const att = st.attachment?.status === 'ready' ? st.attachment : null;

    if (!text && !gif && !att) {
        return;
    }

    st.sending = true;
    st.error = null;
    st.gif = null; // drop the attached-GIF preview from the composer the moment Send is clicked

    // The GIF we're sending, mapped to a renderable media item. Its Giphy CDN url isn't an
    // onlyfans.com host, so `mediaSrc` loads it as-is. Kept on the confirmed bubble too,
    // since OnlyFans' send response doesn't echo the GIF back as media.
    const gifMedia: OfMessage['media'] = gif
        ? [
              {
                  id: gif.id,
                  type: 'gif',
                  canView: true,
                  thumb: gif.preview,
                  preview: gif.preview,
                  full: gif.url,
                  source: null,
                  createdAt: null,
                  duration: null,
                  width: gif.width || null,
                  height: gif.height || null,
              },
          ]
        : [];

    // Optimistic bubble: show the message in the thread immediately with a
    // "sending" indicator, then reconcile with what OnlyFans returns.
    const tempId = `pending-${Date.now()}`;
    const optimistic: OfMessage = {
        id: tempId,
        from: 'creator',
        text,
        time: new Date().toISOString(),
        price: 0,
        isFree: true,
        isOpened: false,
        isLiked: false,
        isPinned: false,
        isTip: false,
        mediaCount: gifMedia.length + (att ? 1 : 0),
        media: att
            ? [
                  ...gifMedia,
                  {
                      id: att.id,
                      type: att.kind,
                      canView: true,
                      thumb: att.previewUrl,
                      preview: att.previewUrl,
                      full: att.previewUrl,
                      source: att.previewUrl,
                      createdAt: null,
                      duration: null,
                      width: null,
                      height: null,
                  },
              ]
            : gifMedia,
        pending: true,
    };

    if (selected.value?.id === chatId) {
        messages.value = [...messages.value, optimistic];
    }

    try {
        const res = await ofApi.send(
            m.id,
            chatId,
            text,
            gif?.id ?? undefined,
            att?.id ? [att.id] : undefined,
        );
        const sent = (res.message as OfMessage) ?? {
            ...optimistic,
            pending: false,
        };

        // OnlyFans' send response doesn't echo the GIF back as media, so carry over the
        // GIF we just sent — otherwise the confirmed bubble renders as "(no text)".
        if (gifMedia.length && !sent.media?.length) {
            sent.media = gifMedia;
            sent.mediaCount = gifMedia.length;
        }

        // A freshly-sent attachment echoes back canView:true but NOT yet transcoded — no
        // file URLs (isReady:false) — which the thread would otherwise paint as a "Locked"
        // tile. Keep the local blob preview we already showed; reconcileSentMedia() swaps in
        // the real (proxied) media once OnlyFans finishes, then frees the blob.
        const attPending = !!att && !mediaRenderable(sent);

        if (attPending) {
            sent.media = optimistic.media;
            sent.mediaCount = optimistic.media?.length ?? 0;
        }

        // Swap the temp bubble for the confirmed message + keep the cache in sync.
        const cached = msgCache.get(chatId);
        msgCache.set(chatId, cached ? [...cached, sent] : [sent]);

        if (selected.value?.id === chatId) {
            messages.value = messages.value.map((x) =>
                x.id === tempId ? sent : x,
            );
            rail.value = 'fan'; // the turn is done — back to the fan view
        }

        st.draft = '';
        st.suggestion = null;

        // Only clear the attachment that was actually sent — the user may have
        // replaced it with a new pick while this send was in flight.
        if (st.attachment === att) {
            st.attachment = null;
        }

        // Free the blob now if the media was already renderable; otherwise defer to
        // reconcileSentMedia() (the confirmed bubble is still showing that blob preview).
        if (att) {
            if (attPending && sent.id) {
                void reconcileSentMedia(m.id, chatId, sent.id, att);
            } else {
                revokeAttachment(att);
            }
        }
        // Keep st.strategy: the AI Intel for this chat stays available so reopening
        // the chat (or the AI Intel tab) still shows the last analysis. A new
        // Generate overwrites it.
    } catch (e) {
        st.error = e instanceof Error ? e.message : String(e);

        // Mark the optimistic bubble as failed so it doesn't look sent.
        if (selected.value?.id === chatId) {
            messages.value = messages.value.map((x) =>
                x.id === tempId ? { ...x, pending: false, failed: true } : x,
            );
        }
    } finally {
        st.sending = false;
    }
}

const POLL_MS = 1500;
const POLL_MAX = 60; // ~90s, then give up rather than poll forever

function attachmentKind(mime: string): ComposerAttachment['kind'] {
    if (mime.startsWith('video/')) {
        return 'video';
    }

    if (mime.startsWith('audio/')) {
        return 'audio';
    }

    if (mime === 'image/gif') {
        return 'gif';
    }

    return 'photo';
}

/** blob: previews are object URLs — free them or they leak for the session. */
function revokeAttachment(att: ComposerAttachment | null) {
    if (att?.source === 'upload' && att.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(att.previewUrl);
    }
}

/** A media item is renderable once OnlyFans has transcoded it: canView plus a poster/source
 *  URL. A just-sent attachment echoes back canView:true but with no files, so this guards
 *  against painting it as a locked tile. */
function mediaRenderable(msg: OfMessage): boolean {
    return !!msg.media?.some(
        (mm) =>
            mm.canView && !!(mm.preview || mm.thumb || mm.full || mm.source),
    );
}

/** Poll the thread until a just-sent attachment finishes transcoding, then swap the local
 *  blob preview for the real (proxied) media and free the blob. Media is usually ready within
 *  ~1s; on the rare timeout the blob preview stays and a manual Refresh corrects it. */
async function reconcileSentMedia(
    modelId: number,
    chatId: string,
    msgId: string,
    att: ComposerAttachment,
) {
    for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, i === 0 ? 800 : 1500));

        let real: OfMessage | undefined;

        try {
            const r = await ofApi.messages(modelId, chatId, { limit: '10' });
            real = (r.messages as OfMessage[]).find((x) => x.id === msgId);
        } catch {
            continue; // transient fetch error — keep the blob and retry
        }

        if (!real || !mediaRenderable(real)) {
            continue;
        }

        const swap = (list: OfMessage[]) =>
            list.map((x) =>
                x.id === msgId
                    ? { ...x, media: real!.media, mediaCount: real!.mediaCount }
                    : x,
            );

        const cached = msgCache.get(chatId);

        if (cached) {
            msgCache.set(chatId, swap(cached));
        }

        if (selected.value?.id === chatId) {
            messages.value = swap(messages.value);
        }

        revokeAttachment(att);

        return;
    }
}

async function onPickFile(file: File) {
    const m = model.value;
    const chat = selected.value;

    if (!m || !chat) {
        return;
    }

    const cur = chatComposer(chat.id);

    // 100MB = OnlyFans' cap, mirrored by nginx/PHP. Reject here so the user isn't
    // made to wait out a long transfer only to hit an unparseable nginx 413.
    if (file.size > 100 * 1024 * 1024) {
        revokeAttachment(cur.attachment);
        cur.attachment = {
            id: null,
            source: 'upload',
            status: 'failed',
            progress: 0,
            error: 'File is larger than 100MB.',
            name: file.name,
            kind: attachmentKind(file.type),
            previewUrl: null,
        };

        return;
    }

    revokeAttachment(cur.attachment);
    cur.gif = null; // media and GIF are mutually exclusive

    cur.attachment = {
        id: null,
        source: 'upload',
        status: 'uploading',
        progress: 0,
        error: null,
        name: file.name,
        kind: attachmentKind(file.type),
        previewUrl: file.type.startsWith('image/')
            ? URL.createObjectURL(file)
            : null,
    };
    // Work through the REACTIVE proxy Vue stored, NOT the raw literal above: reading
    // cur.attachment back yields a proxy that is never identity-equal to a raw object,
    // so `cur.attachment === rawLiteral` is always false — which would freeze progress
    // and abort the post-upload flow. Mutating through the proxy also drives reactivity.
    const att = cur.attachment;

    if (!att) {
        return;
    }

    try {
        const r = await ofApi.uploadMedia(m.id, file, (pct) => {
            if (cur.attachment === att) {
                att.progress = pct;
            }
        });

        if (cur.attachment !== att) {
            return; // removed or replaced mid-flight
        }

        att.id = r.id;
        att.status = 'processing';
        await pollUpload(m.id, cur, att);
    } catch (e) {
        if (cur.attachment === att) {
            att.status = 'failed';
            att.error = e instanceof Error ? e.message : 'Upload failed.';
        }
    }
}

async function pollUpload(
    modelId: number,
    cur: ComposerState,
    att: ComposerAttachment,
) {
    for (let i = 0; i < POLL_MAX; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));

        if (cur.attachment !== att || !att.id) {
            return;
        }

        try {
            const s = await ofApi.uploadStatus(modelId, att.id);

            if (cur.attachment !== att) {
                return;
            }

            if (s.status === 'completed') {
                att.status = 'ready';

                return;
            }

            if (s.status === 'failed') {
                att.status = 'failed';
                att.error = s.error ?? 'OnlyFans could not process this file.';

                return;
            }
        } catch (e) {
            att.status = 'failed';
            att.error =
                e instanceof Error ? e.message : 'Upload status check failed.';

            return;
        }
    }

    att.status = 'failed';
    att.error = 'Timed out waiting for OnlyFans to process this file.';
}

function onPickVault(item: OfMedia) {
    const m = model.value;
    const chat = selected.value;

    if (!m || !chat || !item.id) {
        return;
    }

    const cur = chatComposer(chat.id);

    revokeAttachment(cur.attachment);
    cur.gif = null;

    // Vault thumbs are fansapi.com presigned urls (direct); only onlyfans.com needs the proxy.
    const cdn = item.thumb ?? item.preview;
    let previewUrl: string | null = null;

    if (cdn) {
        previewUrl = mediaSrc(m.id, cdn);
    }

    cur.attachment = {
        id: item.id,
        source: 'vault',
        status: 'ready', // vault ids need no upload and are reusable
        progress: 100,
        error: null,
        name: null,
        kind: (item.type as ComposerAttachment['kind']) ?? 'photo',
        previewUrl,
    };
}

function setAttachment(value: ComposerAttachment | null) {
    const chat = selected.value;

    if (!chat) {
        return;
    }

    const cur = chatComposer(chat.id);

    revokeAttachment(cur.attachment);
    cur.attachment = value;
}

/** Retry a previously-failed optimistic message in place. */
async function resend(failed: OfMessage) {
    const m = model.value;
    const chat = selected.value;
    const tempId = failed.id;

    if (!m || !chat || !tempId || !failed.text) {
        return;
    }

    const chatId = chat.id;
    const setMsg = (patch: Partial<OfMessage>) => {
        if (selected.value?.id === chatId) {
            messages.value = messages.value.map((x) =>
                x.id === tempId ? { ...x, ...patch } : x,
            );
        }
    };

    setMsg({ pending: true, failed: false });

    try {
        const res = await ofApi.send(m.id, chatId, failed.text);
        const sent = (res.message as OfMessage) ?? {
            ...failed,
            pending: false,
            failed: false,
        };

        const cached = msgCache.get(chatId);
        msgCache.set(chatId, cached ? [...cached, sent] : [sent]);

        if (selected.value?.id === chatId) {
            messages.value = messages.value.map((x) =>
                x.id === tempId ? sent : x,
            );
        }
    } catch {
        setMsg({ pending: false, failed: true });
    }
}

async function loadChats() {
    const m = model.value;

    // Reset the open conversation only when the creator actually changes — not on
    // a same-creator revisit/Refresh (which would needlessly blank the thread).
    if (activeModelId.value !== (m?.id ?? null)) {
        selected.value = null;
        messages.value = [];
        fan.value = null;
        rail.value = 'fan';
        activeModelId.value = m?.id ?? null;
    }

    if (!m || !m.hasOf) {
        chats.value = [];
        chatsError.value =
            m && !m.hasOf
                ? 'No OnlyFans account connected for this creator (set it on Creator Models).'
                : null;

        return;
    }

    // Serve the cached list instantly so it never blanks on a revisit; show the
    // top indicator while we revalidate against OnlyFans in the background.
    const cached = chatsCache.get(m.id);
    chats.value = cached ?? [];
    chatsLoading.value = true;
    chatsError.value = null;

    try {
        // OnlyFans returns chats one page at a time (default 10, max 100). Follow the
        // offset cursor (`next`) until it runs out so the list shows EVERY chat, not
        // just the first page. Pages accumulate (deduped by id) and render
        // progressively; the page cap is a runaway-loop guard (200 × 100 = 20k chats).
        const list: OfChat[] = [];
        const seen = new Set<string>();
        // The currently-open chat has been seen — keep its badge cleared even if the
        // server still reports it unread, so a background revalidation can't flash it back.
        const openId = selected.value?.id;
        let cursor: Record<string, string> | null = { limit: '100' };

        for (let page = 0; cursor && page < 200; page++) {
            const r = await ofApi.chats(m.id, cursor);

            // Bail out if the user switched creators mid-load (finally still resets state).
            if (model.value?.id !== m.id) {
                return;
            }

            for (const chat of r.chats as OfChat[]) {
                if (seen.has(chat.id)) {
                    continue;
                }

                seen.add(chat.id);

                if (openId && chat.id === openId) {
                    chat.unread = 0;
                }

                list.push(chat);
            }

            cursor = r.next;

            // Render what we have so far, but never shrink a larger cached list mid-load.
            if (list.length >= chats.value.length) {
                chats.value = [...list];
            }
        }

        // Cache and display share ONE array reference so the realtime inbound handler's
        // in-place list mutations keep the cache in sync (see onInbound).
        chatsCache.set(m.id, list);

        if (model.value?.id === m.id) {
            chats.value = list;
        }
    } catch (e) {
        if (model.value?.id === m.id) {
            chatsError.value = e instanceof Error ? e.message : String(e);

            if (!cached) {
                chats.value = []; // keep the stale list if we had one cached
            }
        }
    } finally {
        if (model.value?.id === m.id) {
            chatsLoading.value = false;
        }
    }
}

// How many messages to pull per page (OnlyFans caps this at 100).
const MSG_PAGE = '100';

/**
 * Merge a freshly-fetched newest page into the already-loaded thread. The server page is
 * authoritative for its own window (so likes/edits/remote deletes within it reflect), while
 * anything OLDER than the window — history pulled by scrolling toward the top — is
 * kept, as are unconfirmed optimistic bubbles (which are newer than the window). Without this
 * a background revalidate would shrink the thread back to the newest page and drop the
 * history the user just loaded.
 */
function reconcileNewest(
    existing: OfMessage[],
    fresh: OfMessage[],
): OfMessage[] {
    if (!fresh.length) {
        return existing;
    }

    const windowStart = fresh[0].time ?? ''; // fresh is sorted oldest→newest
    const freshIds = new Set(fresh.map((m) => m.id));

    const older = existing.filter(
        (m) =>
            !m.pending &&
            !m.failed &&
            !freshIds.has(m.id) &&
            (m.time ?? '') < windowStart,
    );
    const optimistic = existing.filter((m) => m.pending || m.failed);

    return [...older, ...fresh, ...optimistic];
}

async function fetchMessages(chatId: string, background = false) {
    if (!model.value) {
        return;
    }

    if (!background) {
        msgsError.value = null;
        msgsLoading.value = true;
    }

    try {
        const r = await ofApi.messages(model.value.id, chatId, {
            limit: MSG_PAGE,
        });
        const fresh = r.messages as OfMessage[];
        const existing = msgCache.get(chatId) ?? [];
        const merged = existing.length
            ? reconcileNewest(existing, fresh)
            : fresh;
        msgCache.set(chatId, merged);

        // Establish the "load older" cursor on the first fetch of a chat (empty cache, or a
        // cache seeded by realtime inbound before we ever paged it). Don't reset it on later
        // revalidates — loadMore() has since advanced it deeper into the history.
        if (!existing.length || !nextCache.has(chatId)) {
            nextCache.set(chatId, r.next);

            if (selected.value?.id === chatId) {
                msgsNext.value = r.next;
            }
        }

        if (selected.value?.id === chatId) {
            messages.value = merged; // ignore if the user already moved on

            // The freshest thread (incl. any new inbound message) is now loaded and on
            // screen — the fan's messages have been seen, so clear the unread badge.
            if (selected.value.unread > 0) {
                selected.value.unread = 0;
            }
        }
    } catch (e) {
        if (!background && selected.value?.id === chatId) {
            msgsError.value = e instanceof Error ? e.message : String(e);
        }
    } finally {
        if (!background) {
            msgsLoading.value = false;
        }
    }
}

/** Load the next OLDER page and prepend it (older messages sort before the current oldest). */
async function loadMore() {
    const m = model.value;
    const chat = selected.value;

    if (!m || !chat || !msgsNext.value || msgsLoadingMore.value) {
        return;
    }

    const chatId = chat.id;
    const cursor = msgsNext.value;
    msgsLoadingMore.value = true;
    msgsMoreError.value = null;

    try {
        const r = await ofApi.messages(m.id, chatId, {
            ...cursor,
            limit: MSG_PAGE,
        });
        const older = r.messages as OfMessage[];

        const base = msgCache.get(chatId) ?? [];
        const baseIds = new Set(base.map((x) => x.id));
        const fresh = older.filter((x) => !baseIds.has(x.id));
        const merged = [...fresh, ...base];
        msgCache.set(chatId, merged);

        // OnlyFans keeps handing back a `next_page` even at the end of a thread, so a page
        // that adds nothing new IS the end — drop the cursor to retire the button. Otherwise
        // advance to the next older page.
        const cursorNext = fresh.length ? r.next : null;
        nextCache.set(chatId, cursorNext);

        if (selected.value?.id === chatId) {
            messages.value = merged; // reassign even when empty so the child consumes its anchor
            msgsNext.value = cursorNext;
        }
    } catch (e) {
        msgsMoreError.value = e instanceof Error ? e.message : String(e);
    } finally {
        msgsLoadingMore.value = false;
    }
}

async function fetchFan(chatId: string, background = false) {
    if (!model.value) {
        return;
    }

    try {
        const f = await ofApi.fan(model.value.id, chatId);
        const got = f.fan as OfFan;
        fanCache.set(chatId, got);

        // Reconcile restricted-state from the fresh getUser payload. The chat row's
        // `restricted` is derived from the chats-list `fan.isRestricted`, which OnlyFans
        // serves from an eventually-consistent cache that lags a restrict/unrestrict — so
        // on reload the header/list would otherwise revert to the stale value. getUser
        // reflects the change immediately (same source the model-show Users tab trusts),
        // so let it win. Mutate the list row in place to keep the chatsCache array identity.
        const row = chats.value.find((c) => c.id === chatId);

        if (row && row.restricted !== got.isRestricted) {
            row.restricted = got.isRestricted;
        }

        if (selected.value?.id === chatId) {
            fan.value = got;
        }
    } catch {
        if (!background && selected.value?.id === chatId) {
            fan.value = null;
        }
    }
}

function openChat(chat: OfChat) {
    if (!model.value) {
        return;
    }

    selected.value = chat;

    // Show AI Intel if this chat already has a generated strategy, else the Fan tab.
    rail.value = chatComposer(chat.id).strategy ? 'ai' : 'fan';

    // Load-older cursor: restore instantly from cache (revalidated by fetchMessages).
    msgsNext.value = nextCache.get(chat.id) ?? null;
    msgsMoreError.value = null;

    // Messages — serve cache instantly, then revalidate in the background.
    if (msgCache.has(chat.id)) {
        messages.value = msgCache.get(chat.id)!;
        msgsLoading.value = false;
        msgsError.value = null;
        fetchMessages(chat.id, true);
    } else {
        messages.value = [];
        fetchMessages(chat.id);
    }

    // Fan intel — same pattern.
    if (fanCache.has(chat.id)) {
        fan.value = fanCache.get(chat.id)!;
        fetchFan(chat.id, true);
    } else {
        fan.value = null;
        fetchFan(chat.id);
    }

    // AI Intel — hydrate/revalidate from the server (it persists per chat). Any
    // in-memory strategy already rendered instantly above; this refreshes it and
    // restores it after a reload. Race-safe: only apply while this chat is open.
    fetchIntel(chat.id);
}

async function fetchIntel(chatId: string) {
    const m = model.value;

    if (!m) {
        return;
    }

    try {
        const { strategy, generatedAt } = await ofApi.intel(m.id, chatId);

        if (!strategy || selected.value?.id !== chatId) {
            return;
        }

        const st = chatComposer(chatId);
        st.strategy = strategy;
        st.strategyGeneratedAt = generatedAt;

        // Surface restored intel if the user hasn't picked a tab away from the default.
        if (rail.value === 'fan') {
            rail.value = 'ai';
        }
    } catch {
        // Intel is best-effort — a fetch failure just leaves the Fan tab showing.
    }
}

async function onLike(m: OfMessage) {
    if (!model.value || !selected.value || !m.id || m.liking) {
        return;
    }

    m.liking = true;

    try {
        if (m.isLiked) {
            await ofApi.unlike(model.value.id, selected.value.id, m.id);
        } else {
            await ofApi.like(model.value.id, selected.value.id, m.id);
        }

        m.isLiked = !m.isLiked;
    } catch (e) {
        alert(e instanceof Error ? e.message : String(e));
    } finally {
        m.liking = false;
    }
}

async function onDelete(m: OfMessage) {
    if (!model.value || !selected.value || !m.id) {
        return;
    }

    if (!confirm('Delete this message on OnlyFans?')) {
        return;
    }

    try {
        await ofApi.deleteMessage(model.value.id, selected.value.id, m.id);
        messages.value = messages.value.filter((x) => x.id !== m.id);
    } catch (e) {
        alert(e instanceof Error ? e.message : String(e));
    }
}

watch(model, () => loadChats(), { immediate: true });

// ---- Realtime inbound (OnlyFans `messages.received` webhook → Reverb) ----
// We subscribe to the active creator's private channel and reflect new fan messages
// live: append to the open thread, and bump unread + preview/time in the chat list
// for chats that aren't open. Nothing is persisted.

function deriveInitials(name: string): string {
    return (
        name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0]?.toUpperCase() ?? '')
            .join('') || '?'
    );
}

function applyToChatList(
    chatId: string,
    message: OfMessage,
    fan: InboundPayload['fan'],
    isOpen: boolean,
) {
    const existing = chats.value.find((c) => c.id === chatId);

    const kind = messagePreviewKind(message);

    if (existing) {
        if (message.text) {
            existing.preview = message.text;
            existing.previewKind = null;
        } else if (kind) {
            // A text-less inbound (GIF/photo/video/…) — show the indicator, not the stale text.
            existing.preview = '';
            existing.previewKind = kind;
        }

        existing.time = message.time ?? existing.time;

        if (!isOpen) {
            existing.unread = (existing.unread ?? 0) + 1;
        }

        return;
    }

    // A fan we haven't loaded a chat card for yet — surface it at the top of the list.
    const name = fan.name || fan.username || chatId;
    chats.value.unshift({
        id: chatId,
        name,
        username: fan.username ?? null,
        avatar: fan.avatar ?? null,
        initials: deriveInitials(name),
        preview: message.text || '',
        previewKind: kind,
        time: message.time ?? null,
        unread: isOpen ? 0 : 1,
        canSend: true,
        canSendReason: null,
        totalSpent: null, // unknown from a live inbound; fills in on the next chat-list load
        muted: false, // ditto — the chat list is the source of truth for these three
        pinnedCount: 0,
        restricted: false,
    });
}

function onInbound(payload: InboundPayload) {
    const { chatId, message, fan } = payload;

    if (!model.value || payload.creatorId !== model.value.id) {
        return;
    }

    const isOpen = selected.value?.id === chatId;

    // Thread / msgCache — append (dedup by id), replacing the array so the open thread
    // re-renders and auto-scrolls. chats.value and chatsCache share their backing array,
    // so the list update below keeps the cache in sync without a separate write.
    const cachedThread = msgCache.get(chatId);

    if (cachedThread) {
        const dup =
            message.id != null && cachedThread.some((x) => x.id === message.id);

        if (!dup) {
            const next = [...cachedThread, message];
            msgCache.set(chatId, next);

            if (isOpen) {
                messages.value = next;
            }
        }
    } else if (isOpen) {
        const dup =
            message.id != null &&
            messages.value.some((x) => x.id === message.id);

        if (!dup) {
            messages.value = [...messages.value, message];
            msgCache.set(chatId, messages.value);
        }
    }

    applyToChatList(chatId, message, fan, isOpen);
}

// Channel subscriptions are owned by the shared realtime module (so the app-wide notifier
// and this page don't fight over leaving channels). We just ensure our creators are joined
// and register a handler that updates the live UI; the module fans events to every handler.
ensureSubscribed(creators.value.map((c) => c.id));
const stopInbound = onInboundMessage(onInbound);

// Tell the notifier which chat is open, so it stays quiet for the message you're watching.
watch(
    [() => model.value?.id ?? null, () => selected.value?.id ?? null],
    ([modelId, chatId]) => setActiveChat(modelId, chatId),
    { immediate: true },
);

onBeforeUnmount(() => {
    stopInbound();
    setActiveChat(null, null);
});
</script>

<template>
    <Head title="Conversations" />

    <SsCreatorPrompt
        v-if="!creators.length"
        class="h-full"
        :icon="Users"
        title="No creators assigned"
        description="You don’t have any creator models assigned yet. Ask an admin to assign one so you can start chatting."
    />
    <SsCreatorPrompt
        v-else-if="!model"
        class="h-full"
        :icon="MessageSquare"
        title="Select a creator"
        description="Pick a creator model to open its conversations. The whole app follows whichever creator you choose."
        hint="Creator selector · top of the sidebar"
    />

    <div v-else class="flex h-full gap-4">
        <SsConvoList
            :chats="chats"
            :loading="chatsLoading"
            :error="chatsError"
            :creator="model?.name ?? null"
            :selected-id="selected?.id ?? null"
            @select="openChat"
            @refresh="loadChats"
        />

        <template v-if="selected && model">
            <SsChatThread
                :model-id="model.id"
                :chat="selected"
                :fan="fan"
                :role="role"
                :messages="messages"
                :loading="msgsLoading"
                :error="msgsError"
                :has-more="!!msgsNext"
                :loading-more="msgsLoadingMore"
                :load-more-error="msgsMoreError"
                :spend="fan?.totalSpent ?? null"
                @like="onLike"
                @delete="onDelete"
                @resend="resend"
                @load-more="loadMore"
                @chat-changed="patchChat"
                @hidden="dropChat"
            >
                <template v-if="cur" #composer>
                    <SsComposer
                        :creator="model.name"
                        :model-id="model.id"
                        :draft="cur.draft"
                        :context="cur.context"
                        :suggestion="cur.suggestion"
                        :attached-gif="cur.gif"
                        :attachment="cur.attachment"
                        :generating="cur.generating"
                        :sending="cur.sending"
                        :error="cur.error"
                        :can-send="selected?.canSend ?? true"
                        :can-send-reason="selected?.canSendReason ?? null"
                        @update:draft="cur.draft = $event"
                        @update:context="cur.context = $event"
                        @update:attached-gif="cur.gif = $event"
                        @update:attachment="setAttachment"
                        @pick-file="onPickFile"
                        @pick-vault="onPickVault"
                        @generate="generate"
                        @send="send"
                        @accept="acceptSuggestion"
                        @accept-send="acceptAndSend"
                        @dismiss="dismissSuggestion"
                    />
                </template>
            </SsChatThread>

            <aside
                class="flex w-80 shrink-0 flex-col overflow-hidden rounded-xl border border-ss-border bg-ss-surface"
            >
                <div class="flex shrink-0 border-b border-ss-border p-1.5">
                    <button
                        type="button"
                        class="flex-1 rounded-lg py-1.5 text-[12px] font-semibold transition-colors"
                        :class="
                            rail === 'fan'
                                ? 'bg-ss-surface-2 text-ss-text'
                                : 'text-ss-text-3 hover:text-ss-text-2'
                        "
                        @click="rail = 'fan'"
                    >
                        Fan
                    </button>
                    <button
                        type="button"
                        class="flex-1 rounded-lg py-1.5 text-[12px] font-semibold transition-colors"
                        :class="
                            rail === 'ai'
                                ? 'bg-ss-surface-2 text-ss-text'
                                : 'text-ss-text-3 hover:text-ss-text-2'
                        "
                        @click="rail = 'ai'"
                    >
                        AI Intel
                    </button>
                </div>
                <SsFanPanel
                    v-show="rail === 'fan'"
                    :fan="fan"
                    :model-id="model?.id ?? null"
                />
                <SsAiIntel
                    v-show="rail === 'ai'"
                    :strategy="cur?.strategy ?? null"
                    :generated-at="cur?.strategyGeneratedAt ?? null"
                />
            </aside>
        </template>

        <div
            v-else
            class="grid flex-1 place-items-center rounded-xl border border-ss-border bg-ss-surface text-[13px] text-ss-text-3"
        >
            <span v-if="chatsError">{{ chatsError }}</span>
            <span v-else-if="chatsLoading">Loading chats…</span>
            <span v-else>Select a conversation.</span>
        </div>
    </div>
</template>
