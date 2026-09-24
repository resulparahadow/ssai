import { toast } from 'vue-sonner';
import { notificationPrefs } from '@/lib/notificationPrefs';
import { isViewingChat } from '@/lib/realtimeInbound';
import { playBing } from '@/lib/sound';

// Tells the chatter an AI draft they asked for has finished. A Generate takes 25-45s, so
// they usually move to another chat (or tab) meanwhile, and the only in-chat signal — the
// suggestion card — is invisible from there. Mirrors the inbound notifier: stay quiet when
// the chatter is already looking at that chat in a focused tab (the card itself is the
// signal), otherwise toast + bing. Failures alert too: a chatter waiting for a green light
// that will never come is the worse outcome.

export interface DraftOutcome {
    creatorId: number;
    chatId: string;
    fanName: string;
    /** The draft text, or null when the generation failed / came back empty. */
    draft: string | null;
    error: string | null;
    /** Jump to the chat (wired by the page — it knows whether it can open the row in place). */
    open: () => void;
}

export function alertDraftDone(o: DraftOutcome): void {
    const watching =
        isViewingChat(o.creatorId, o.chatId) &&
        typeof document !== 'undefined' &&
        document.hasFocus();

    if (!notificationPrefs.draftReady || watching) {
        return;
    }

    playBing(notificationPrefs.volume);

    const action = { label: 'Open', onClick: o.open };

    if (o.draft) {
        const preview = o.draft.trim();

        toast.success(`Draft ready — ${o.fanName}`, {
            description:
                preview.length > 120 ? `${preview.slice(0, 120)}…` : preview,
            action,
        });
    } else {
        toast.error(`Draft failed — ${o.fanName}`, {
            description: o.error ?? 'The AI returned no draft.',
            action,
        });
    }
}
