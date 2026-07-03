import { router } from '@inertiajs/vue3';
import { toast } from 'vue-sonner';
import { notificationPrefs } from '@/lib/notificationPrefs';
import {
    ensureSubscribed,
    isViewingChat,
    onInboundMessage,
} from '@/lib/realtimeInbound';
import type { InboundPayload } from '@/lib/realtimeInbound';
import { playBing, unlockAudioOnGesture } from '@/lib/sound';

export interface NotifyCreator {
    id: number;
    name: string;
}

// id → name, so a toast can deep-link to /conversations?creator=<name>. Refreshed on every
// call (the shared `creators` Inertia prop is the source of truth).
const creatorNames = new Map<number, string>();

let registered = false;

function notify(payload: InboundPayload): void {
    // Already looking at this exact chat in a focused tab? The thread appends it live —
    // no need to also bing/toast.
    if (
        isViewingChat(payload.creatorId, payload.chatId) &&
        typeof document !== 'undefined' &&
        document.hasFocus()
    ) {
        return;
    }

    if (notificationPrefs.playSound) {
        playBing(notificationPrefs.volume);
    }

    if (!notificationPrefs.showToast) {
        return;
    }

    const who = payload.fan.name || payload.fan.username || 'New message';
    const body = payload.message.text?.trim() || '📎 media';
    const creator = creatorNames.get(payload.creatorId);

    toast(who, {
        description: body.length > 120 ? `${body.slice(0, 120)}…` : body,
        action: creator
            ? {
                  label: 'Open',
                  onClick: () =>
                      router.visit(
                          `/conversations?creator=${encodeURIComponent(creator)}`,
                      ),
              }
            : undefined,
    });
}

/**
 * Start (once) the app-wide new-message notifier: subscribe to every assigned creator's
 * live channel and toast + bing on inbound, gated by the user's notification prefs.
 * Idempotent — safe to call from any authenticated layout on every navigation.
 */
export function useInboundNotifications(creators: NotifyCreator[]): void {
    for (const c of creators) {
        creatorNames.set(c.id, c.name);
    }

    ensureSubscribed(creators.map((c) => c.id));

    if (registered) {
        return;
    }

    registered = true;
    unlockAudioOnGesture();
    onInboundMessage(notify);
}
