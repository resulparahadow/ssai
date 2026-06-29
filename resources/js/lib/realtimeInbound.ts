import { echo } from '@laravel/echo-vue';
import type { OfMessage } from '@/types/crm';

// Single owner of the live OnlyFans inbound subscriptions (Reverb private `creator.{id}`
// channels). Previously Conversations.vue subscribed/left channels itself; that fights an
// app-wide notifier (one `echo().leave` tears the channel down for everyone). Instead this
// module subscribes once per creator for the app's lifetime and fans each `messages.received`
// event out to any number of registered handlers (the page UI updater + the notifier).

export interface InboundPayload {
    creatorId: number;
    chatId: string;
    message: OfMessage;
    fan: { id: string; name: string | null; username: string | null; avatar: string | null };
}

type Handler = (payload: InboundPayload) => void;

const handlers = new Set<Handler>();
const joined = new Set<number>();

function dispatch(payload: InboundPayload): void {
    for (const handler of handlers) {
        try {
            handler(payload);
        } catch (e) {
            console.error('[realtime] inbound handler failed', e);
        }
    }
}

/**
 * Subscribe to the given creators' private channels. Idempotent (skips already-joined
 * ids) and browser-only. Subscriptions are kept for the session so notifications keep
 * working across page navigation.
 */
export function ensureSubscribed(creatorIds: number[]): void {
    if (import.meta.env.SSR) {
        return;
    }

    for (const id of creatorIds) {
        if (joined.has(id)) {
            continue;
        }

        echo()
            .private(`creator.${id}`)
            .listen('.message.received', (e: unknown) => dispatch(e as InboundPayload));
        joined.add(id);
    }
}

/** Register an inbound handler; returns an unsubscribe fn. */
export function onInboundMessage(handler: Handler): () => void {
    handlers.add(handler);

    return () => {
        handlers.delete(handler);
    };
}

// ---- active-chat tracking ----
// Lets the notifier stay quiet when the user is already looking at the exact chat that
// just received a message (the thread appends it live), in a focused tab.

let activeChat: { creatorId: number; chatId: string } | null = null;

export function setActiveChat(creatorId: number | null, chatId: string | null): void {
    activeChat = creatorId != null && chatId != null ? { creatorId, chatId } : null;
}

export function isViewingChat(creatorId: number, chatId: string): boolean {
    return activeChat?.creatorId === creatorId && activeChat?.chatId === chatId;
}
