import { reactive } from 'vue';
import type {
    AiStrategy,
    ComposerAttachment,
    DraftRejection,
    OfChat,
    OfFan,
    OfGif,
    OfMessage,
} from '@/types/crm';

// Module-scoped stale-while-revalidate caches for the live Conversations view.
// Living outside the Vue component means they survive Inertia page transitions
// (the page can remount when navigating between creators), so re-selecting a
// creator or reopening a chat is instant and the lists never blank — the page
// just revalidates against OnlyFans in the background. Chats are keyed by model
// id; messages/fan by chat id (the fan's user id, globally unique).
export const chatsCache = new Map<number, OfChat[]>();
// The conversations list pages on scroll, so its cursor is cached alongside the rows:
// returning to a creator restores where the paging got to instead of starting over.
// `null` once the last page has been reached; absent until the first page has loaded.
export const chatsNextCache = new Map<number, Record<string, string> | null>();
export const msgCache = new Map<string, OfMessage[]>();
export const fanCache = new Map<string, OfFan>();

// The pagination cursor for loading OLDER messages in a chat (the OnlyFans
// `_pagination.next_page` params, normalised to `{ id, order, … }`). Keyed by
// chat id alongside msgCache; `null` once the oldest page has been reached, and
// absent until the chat's first page has loaded. Drives the thread's "Load
// older messages" button.
export const nextCache = new Map<string, Record<string, string> | null>();

// Per-chat composer state, keyed by chat id. Each chat keeps its own draft,
// loading/sending flags, error, and AI strategy — so generating in chat A and
// switching to chat B no longer bleeds A's spinner/result into B, and an
// unsent draft is preserved when you come back. Reactive + module-scoped so it
// also survives page remounts.
export interface ComposerState {
    draft: string; // what's in the typing bar (unsent) — drives the list "Draft:" badge
    context: string; // agent directive for the next generate ("he just tipped $50", etc.) — steers the AI, not sent to the fan
    suggestion: string | null; // the AI-generated message awaiting Accept / Accept & Send
    gif: OfGif | null; // a Giphy GIF attached to the next send
    attachment: ComposerAttachment | null; // media attached to the next send (excl. with gif)
    generating: boolean;
    sending: boolean;
    error: string | null;
    strategy: AiStrategy | null;
    strategyGeneratedAt: string | null; // ISO time the strategy was generated (for "generated X ago")
    telemetry: Record<string, unknown> | null; // last generate's telemetry (carry-forward state committed on accept/send)
    rejections: DraftRejection[] | null; // this chat's rejected drafts (server-stored, shared); null = not loaded yet
    rejecting: boolean; // a Reject & regenerate is saving
}

const composerStore = reactive<Record<string, ComposerState>>({});

export function chatComposer(chatId: string): ComposerState {
    if (!composerStore[chatId]) {
        composerStore[chatId] = {
            draft: '',
            context: '',
            suggestion: null,
            gif: null,
            attachment: null,
            generating: false,
            sending: false,
            error: null,
            strategy: null,
            strategyGeneratedAt: null,
            telemetry: null,
            rejections: null,
            rejecting: false,
        };
    }

    return composerStore[chatId];
}

/** Read a chat's unsent draft without creating a record (for the chat-list badge). */
export function chatDraft(chatId: string): string {
    return composerStore[chatId]?.draft ?? '';
}

/**
 * A chat's AI draft state for the chat-list "green light", without creating a record:
 * `generating` while a Generate is in flight, `ready` while a suggestion is waiting for
 * Accept / Accept & Send / Dismiss. A draft takes 25-45s, so chatters work other chats
 * meanwhile — this is how they find the one that's done.
 */
export function chatAiStatus(chatId: string): 'generating' | 'ready' | null {
    const st = composerStore[chatId];

    if (st?.generating) {
        return 'generating';
    }

    return st?.suggestion ? 'ready' : null;
}

// ---------------------------------------------------------------------------------------
// Which chat is open, per creator. Everything above is in-memory, so a page RELOAD loses the
// open conversation and drops the user back on the empty state. sessionStorage survives a
// reload but is scoped to the TAB, so two tabs can sit in different chats without overwriting
// each other (localStorage — what the creator context uses — would make them fight).
// Only the chat id is stored: never a name, a preview, or any message text.
const OPEN_KEY = 'ss_open_chat';

type OpenMap = Record<string, string>;

function readOpen(): OpenMap {
    try {
        const parsed = JSON.parse(sessionStorage.getItem(OPEN_KEY) ?? 'null');

        return parsed && typeof parsed === 'object' ? (parsed as OpenMap) : {};
    } catch {
        // Storage disabled (private mode), unavailable (SSR), or holding a corrupt value.
        // Remembering the open chat is a convenience — never a reason to break the page.
        return {};
    }
}

/** Remember the chat open for a creator, or forget it when `chatId` is null. */
export function rememberOpenChat(modelId: number, chatId: string | null): void {
    const map = readOpen();

    if (chatId) {
        map[modelId] = chatId;
    } else {
        delete map[modelId];
    }

    try {
        sessionStorage.setItem(OPEN_KEY, JSON.stringify(map));
    } catch {
        // See readOpen.
    }
}

/** The chat that was open for a creator before the reload, if any. */
export function recallOpenChat(modelId: number): string | null {
    return readOpen()[modelId] ?? null;
}
