import type { OfMedia, OfMessage } from '@/types/crm';

export interface SentPpv {
    id: string;
    price: number;
    opened: boolean;
    mass: boolean;
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
export function sentPpvs(messages: OfMessage[]): SentPpv[] {
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
            mass: m.fromQueue,
            photos,
            videos,
            thumb: media[0] ?? null,
            text: m.text ?? '',
            createdAt: m.time,
        });
    }

    return out;
}
