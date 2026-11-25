import type { MessageTag, OfMedia, OfMessage } from '@/types/crm';
import { effectiveTag } from './chatCounters.ts';

export interface SentPpv {
    id: string;
    price: number;
    opened: boolean;
    mass: boolean;
    /** Tagged Free preview: shown in the list, labelled instead of the Mass suffix. */
    freePreview: boolean;
    photos: number; // photos + GIFs
    videos: number;
    thumb: OfMedia | null;
    text: string;
    createdAt: string | null;
}

/**
 * The right rail's PPV tab: every priced message WITH media the creator sent in the loaded
 * thread, newest first. Built from the thread itself (not SSAI's ledger), so PPVs sent from
 * CreatorHero or OnlyFans show too. The thread is chronological (oldest first), so newest-first
 * is its reverse. Optimistic bubbles (in flight or failed) are left out: not sent yet.
 */
export function sentPpvs(
    messages: OfMessage[],
    tags: Record<string, MessageTag> = {},
): SentPpv[] {
    const out: SentPpv[] = [];

    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        const media = m.media ?? [];

        if (
            m.from !== 'creator' ||
            !(m.price > 0) ||
            !media.length ||
            !m.id ||
            m.pending ||
            m.failed
        ) {
            continue;
        }

        let photos = 0;
        let videos = 0;

        for (const x of media) {
            if (x.type === 'video') {
                videos++;
            } else if (x.type !== 'audio') {
                photos++;
            }
        }

        out.push({
            id: String(m.id),
            price: m.price,
            opened: m.isOpened,
            // Same rule as the bubble chip (effectiveTag); a priced message the helper
            // declines (flagged free) falls back to the queue heuristic.
            mass:
                (effectiveTag(m, tags) ?? (m.fromQueue ? 'mppv' : null)) ===
                'mppv',
            freePreview: effectiveTag(m, tags) === 'free_preview',
            photos,
            videos,
            thumb: media[0] ?? null,
            text: m.text ?? '',
            createdAt: m.time,
        });
    }

    return out;
}
