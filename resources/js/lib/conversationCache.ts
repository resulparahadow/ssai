import { reactive } from 'vue';
import type { AiStrategy, OfChat, OfFan, OfMessage } from '@/types/crm';

// Module-scoped stale-while-revalidate caches for the live Conversations view.
// Living outside the Vue component means they survive Inertia page transitions
// (the page can remount when navigating between creators), so re-selecting a
// creator or reopening a chat is instant and the lists never blank — the page
// just revalidates against OnlyFans in the background. Chats are keyed by model
// id; messages/fan by chat id (the fan's user id, globally unique).
export const chatsCache = new Map<number, OfChat[]>();
export const msgCache = new Map<string, OfMessage[]>();
export const fanCache = new Map<string, OfFan>();

// Per-chat composer state, keyed by chat id. Each chat keeps its own draft,
// loading/sending flags, error, and AI strategy — so generating in chat A and
// switching to chat B no longer bleeds A's spinner/result into B, and an
// unsent draft is preserved when you come back. Reactive + module-scoped so it
// also survives page remounts.
export interface ComposerState {
    draft: string; // what's in the typing bar (unsent) — drives the list "Draft:" badge
    suggestion: string | null; // the AI-generated message awaiting Accept / Accept & Send
    generating: boolean;
    sending: boolean;
    error: string | null;
    strategy: AiStrategy | null;
}

const composerStore = reactive<Record<string, ComposerState>>({});

export function chatComposer(chatId: string): ComposerState {
    if (!composerStore[chatId]) {
        composerStore[chatId] = { draft: '', suggestion: null, generating: false, sending: false, error: null, strategy: null };
    }

    return composerStore[chatId];
}

/** Read a chat's unsent draft without creating a record (for the chat-list badge). */
export function chatDraft(chatId: string): string {
    return composerStore[chatId]?.draft ?? '';
}
