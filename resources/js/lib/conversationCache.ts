import { reactive } from 'vue';
import type {
    AiStrategy,
    ComposerAttachment,
    ComposerStep,
    DraftRejection,
    IntentRef,
    MessageTag,
    OfChat,
    OfChatFilter,
    OfChatOrder,
    OfFan,
    OfFanProfile,
    OfGif,
    OfMessage,
    Script,
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
// Which view (filter|order|search) the cached rows + cursor above were fetched for. Rows are
// only reusable for the SAME view: an "All" cache shown under "Unread" would list read chats,
// and its cursor would page on from the wrong result set.
export const chatsViewCache = new Map<number, string>();
// The conversations list's filter chip + sort toggle. Module-scoped like the caches, so the
// chatter's choice survives switching creators; a reload resets it to every chat, newest first.
export const chatListView = reactive<{
    filter: OfChatFilter;
    order: OfChatOrder;
}>({ filter: '', order: 'recent' });
/** Creator id → scripts with their steps (loaded once per page session; refetched after any manager edit). */
export const scriptsCache = new Map<number, Script[]>();

export const msgCache = new Map<string, OfMessage[]>();
export const fanCache = new Map<string, OfFan>();

// The pagination cursor for loading OLDER messages in a chat (the OnlyFans
// `_pagination.next_page` params, normalised to `{ id, order, … }`). Keyed by
// chat id alongside msgCache; `null` once the oldest page has been reached, and
// absent until the chat's first page has loaded. Drives the thread's "Load
// older messages" button.
export const nextCache = new Map<string, Record<string, string> | null>();

// Stored per-message PPV tags for each chat (message id → tag), fetched beside the thread and
// served stale-while-revalidate like msgCache. Feeds the intent bar's counters.
export const tagsCache = new Map<string, Record<string, MessageTag>>();

// Each fan's persisted profile (memory, toggles, §5b state switches, §5c counters), keyed by chat
// id. Reactive because two places read it: the Fan tab edits it, and the page derives support
// mode, the Fan type override, counters and the ladder from it for the intent bar / strip / pill.
// Every writer keys by the chat id it captured BEFORE its await (a generate lands 25-45s later,
// often with another chat open).
export const fanProfiles = reactive(new Map<string, OfFanProfile>());

// Per-chat composer state, keyed by chat id. Each chat keeps its own draft,
// loading/sending flags, error, and AI strategy — so generating in chat A and
// switching to chat B no longer bleeds A's spinner/result into B, and an
// unsent draft is preserved when you come back. Reactive + module-scoped so it
// also survives page remounts.
export interface ComposerState {
    draft: string; // what's in the typing bar (unsent) — drives the list "Draft:" badge
    context: string; // agent directive for the next generate ("he just tipped $50", etc.) — steers the AI, not sent to the fan
    suggestion: string | null; // the AI-generated message awaiting Accept / Accept & Send
    // What `suggestion` was generated for: null = a normal reply (also with a Text step loaded),
    // else the media step id whose caption it is. Accept commits strategy memory only for a
    // reply, and a draft whose mode/step no longer matches the composer is dropped
    // (lib/ppvComposer.ts).
    suggestionFor: number | null;
    // The intent of the generate in flight; undefined = no generate owns the composer (dismiss, send or
    // step load invalidated it), so a landing result is dropped (generationStillApplies).
    requestedIntent: IntentRef | null | undefined;
    intent: IntentRef | null; // the agent intent `suggestion` was generated for (any agent intent chip); null = a plain reply or caption
    noteDropped: boolean; // `suggestion` was generated without the typed override note (Aftersale)
    gif: OfGif | null; // a Giphy GIF attached to the next send
    attachment: ComposerAttachment | null; // media attached to the next send (excl. with gif)
    ppvPending: boolean; // the PPV chip opened the Scripts panel: caption the step the chatter loads (cleared on load / panel close / chat switch)
    stepLoads: number; // steps loaded so far; a Generate started before the latest load is dropped (lib/ppvComposer.ts)
    generateSeq: number; // token of the latest Generate: an older run's result, error and finally are ignored (generationOutcome)
    step: ComposerStep | null; // a loaded script step: logged on send; a media step adds vault media + price (excl. with gif/attachment)
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
            suggestionFor: null,
            intent: null,
            noteDropped: false,
            requestedIntent: undefined,
            gif: null,
            attachment: null,
            step: null,
            ppvPending: false,
            stepLoads: 0,
            generateSeq: 0,
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

// ---------------------------------------------------------------------------------------
// Which script the composer's Scripts panel last had open, per creator, so it reopens on the
// same script fan after fan. Per TAB (sessionStorage), like the open chat above; ids only. A
// convenience — any storage failure just opens on the script list.
const SCRIPT_OPEN_KEY = 'ss_script_open';

function readScriptOpen(): Record<string, number> {
    try {
        const parsed = JSON.parse(
            sessionStorage.getItem(SCRIPT_OPEN_KEY) ?? 'null',
        );

        return parsed && typeof parsed === 'object'
            ? (parsed as Record<string, number>)
            : {};
    } catch {
        return {};
    }
}

/** The script the panel last had open for a creator (null = the script list). */
export function recallOpenScript(modelId: number): number | null {
    const id = readScriptOpen()[modelId];

    return Number.isInteger(id) ? id : null;
}

export function rememberOpenScript(modelId: number, id: number | null): void {
    const map = readScriptOpen();

    if (id === null) {
        delete map[modelId];
    } else {
        map[modelId] = id;
    }

    try {
        sessionStorage.setItem(SCRIPT_OPEN_KEY, JSON.stringify(map));
    } catch {
        // See readScriptOpen.
    }
}
