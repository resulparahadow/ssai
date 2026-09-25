import type { DraftRejection, OfMessage } from '@/types/crm';

// Which rejected drafts are still steering the AI, for the list the chatter sees. The SERVER
// decides what the AI actually gets (DraftRejectionService::active) — this mirrors it so the
// list shows the same set. Keep the two in step.

/** Mirror of DraftRejectionService::LIMIT — only the newest few reach the AI. */
export const REJECTION_LIMIT = 5;

/**
 * Mirror of DraftRejectionService::isActive: a rejection lasts until the chat goes quiet for
 * longer than the session gap after it — walking from the rejection through every later
 * message to now. All values in ms.
 */
export function isRejectionActive(
    at: number,
    times: number[],
    now: number,
    gap: number,
): boolean {
    let prev = at;

    for (const t of times) {
        if (t <= at) {
            continue;
        }

        if (t - prev > gap) {
            return false;
        }

        prev = t;
    }

    return now - prev <= gap;
}

/** The rejections the next generate will send to the AI, oldest first. */
export function activeRejections(
    list: DraftRejection[],
    messages: OfMessage[],
    gapHours: number,
    now = Date.now(),
): DraftRejection[] {
    const gap = gapHours * 3_600_000;
    const times = messages
        .map((m) => (m.time ? Date.parse(m.time) : NaN))
        .filter(Number.isFinite)
        .sort((a, b) => a - b);

    return list
        .filter(
            (r) =>
                r.createdAt !== null &&
                isRejectionActive(Date.parse(r.createdAt), times, now, gap),
        )
        .slice(-REJECTION_LIMIT);
}
