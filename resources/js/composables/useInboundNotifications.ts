import { router } from '@inertiajs/vue3';
import { toast } from 'vue-sonner';
import { useCreatorContext } from '@/composables/useCreatorContext';
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

    toast(who, {
        description: body.length > 120 ? `${body.slice(0, 120)}…` : body,
        action: {
            label: 'Open',
            onClick: () => {
                // Switch the global creator context to this creator, then open Conversations.
                useCreatorContext().select(payload.creatorId);
                router.visit('/conversations');
            },
        },
    });
}

/**
 * Start (once) the app-wide new-message notifier: subscribe to every assigned creator's
 * live channel and toast + bing on inbound, gated by the user's notification prefs.
 * Idempotent — safe to call from any authenticated layout on every navigation.
 */
export function useInboundNotifications(creators: NotifyCreator[]): void {
    ensureSubscribed(creators.map((c) => c.id));

    if (registered) {
        return;
    }

    registered = true;
    unlockAudioOnGesture();
    onInboundMessage(notify);
}
