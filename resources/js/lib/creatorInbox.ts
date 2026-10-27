import { reactive, ref } from 'vue';
import { messagePreviewKind } from '@/lib/onlyfans';
import type { InboundPayload } from '@/lib/realtimeInbound';
import type { OfPreviewKind } from '@/types/crm';

// The header bell's state: which creators got fan messages you haven't looked at yet. The
// toast + bing fire once and are gone, and the Conversations list only shows the creator it
// is open on, so a message for ANOTHER creator left no trace once the toast faded. This keeps
// a per-creator count until you open that creator's conversations.
//
// A creator is "seen" while Conversations is showing it (`setWatchedCreator`): its entry
// clears, and new messages for it aren't counted, because the chat list right there already
// carries them as unread badges.
//
// Counts survive a reload in sessionStorage (per TAB, like `rememberOpenChat`): creator id →
// chat id → {count, at}, ids and numbers only. The fan name + preview line is memory-only —
// no name or message text goes to disk — so after a reload a row reads "New messages from
// 2 fans" until the next message for it arrives.

const STORAGE_KEY = 'ss_creator_inbox';

interface ChatUnread {
    count: number;
    /** Epoch ms of the newest unseen message in this chat. */
    at: number;
}

type Unread = Record<string, Record<string, ChatUnread>>;

export interface InboxLatest {
    fanName: string;
    preview: string;
}

function read(): Unread {
    try {
        const parsed = JSON.parse(
            sessionStorage.getItem(STORAGE_KEY) ?? 'null',
        );

        return parsed && typeof parsed === 'object' ? (parsed as Unread) : {};
    } catch {
        // Storage disabled (private mode), unavailable (SSR), or holding a corrupt value.
        // The bell then starts empty — never a reason to break the page.
        return {};
    }
}

function persist(): void {
    try {
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(unread.value));
    } catch {
        // See read.
    }
}

const unread = ref<Unread>(read());
const latest = reactive<Record<string, InboxLatest>>({});

let watched: number | null = null;

// Webhook redeliveries carry the same message id; count each message once.
const seen = new Set<string>();
const SEEN_MAX = 500;

const KIND_LABEL: Record<OfPreviewKind, string> = {
    gif: 'GIF',
    photo: 'Photo',
    video: 'Video',
    audio: 'Voice message',
    tip: 'Tip',
    locked: 'Locked content',
    media: 'Media',
};

/** Count an inbound fan message against its creator (registered by the app-wide notifier). */
export function recordInbound(payload: InboundPayload): void {
    const { creatorId, chatId, message, fan } = payload;

    if (creatorId === watched) {
        return;
    }

    if (message.id != null) {
        if (seen.has(message.id)) {
            return;
        }

        seen.add(message.id);

        if (seen.size > SEEN_MAX) {
            seen.delete(seen.values().next().value as string);
        }
    }

    const key = String(creatorId);
    const at = message.time
        ? Date.parse(message.time) || Date.now()
        : Date.now();
    const chats = (unread.value[key] ??= {});
    const chat = (chats[chatId] ??= { count: 0, at });
    chat.count += 1;
    chat.at = Math.max(chat.at, at);
    persist();

    const kind = messagePreviewKind(message);
    latest[key] = {
        fanName: fan.name || fan.username || 'A fan',
        preview:
            message.text?.trim() || (kind ? KIND_LABEL[kind] : 'New message'),
    };
}

/** Drop a creator's entry — it has been opened. */
export function clearCreator(creatorId: number): void {
    const key = String(creatorId);

    if (!(key in unread.value) && !(key in latest)) {
        return;
    }

    delete unread.value[key];
    delete latest[key];
    persist();
}

export function clearAllCreators(): void {
    unread.value = {};

    for (const key of Object.keys(latest)) {
        delete latest[key];
    }

    persist();
}

/**
 * Tell the inbox which creator Conversations is showing (null when it shows none or
 * unmounts). That creator is cleared and stays uncounted until the page moves on.
 */
export function setWatchedCreator(creatorId: number | null): void {
    watched = creatorId;

    if (creatorId != null) {
        clearCreator(creatorId);
    }
}

export interface InboxEntry {
    creatorId: number;
    /** Unseen messages across all of this creator's chats. */
    count: number;
    /** How many chats those messages came from. */
    chats: number;
    /** Epoch ms of the newest one. */
    at: number;
    /** Newest fan + preview, when it arrived since the last reload. */
    latest: InboxLatest | null;
}

/** Creators with unseen messages, newest first. Reactive — read it inside a computed. */
export function inboxEntries(): InboxEntry[] {
    return Object.entries(unread.value)
        .map(([key, chats]) => {
            const list = Object.values(chats);

            return {
                creatorId: Number(key),
                count: list.reduce((n, c) => n + c.count, 0),
                chats: list.length,
                at: Math.max(...list.map((c) => c.at)),
                latest: latest[key] ?? null,
            };
        })
        .filter((e) => e.count > 0)
        .sort((a, b) => b.at - a.at);
}
