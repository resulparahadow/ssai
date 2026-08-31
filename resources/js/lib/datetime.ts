const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const dayMonthFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
});
const fullFmt = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function parse(iso: string | null | undefined): Date | null {
    if (!iso) {
        return null;
    }

    const d = new Date(iso);

    return isNaN(d.getTime()) ? null : d;
}

/**
 * Human-friendly elapsed time: "Online now" · "32 minutes ago" · "Yesterday" ·
 * "Jul 2". Beyond a week it goes absolute — "412 days ago" helps nobody.
 * null/unparseable → em-dash, same contract as usd().
 */
export function relativeTime(iso: string | null | undefined): string {
    const d = parse(iso);

    if (!d) {
        return '—';
    }

    // Negative elapsed = a future stamp (clock skew between OF and us); clamps here.
    const elapsed = Date.now() - d.getTime();

    if (elapsed < 5 * MINUTE) {
        return 'Online now';
    }

    if (elapsed < HOUR) {
        return rtf.format(-Math.floor(elapsed / MINUTE), 'minute');
    }

    if (elapsed < DAY) {
        return rtf.format(-Math.floor(elapsed / HOUR), 'hour');
    }

    if (elapsed < 2 * DAY) {
        return 'Yesterday';
    }

    if (elapsed < 7 * DAY) {
        return rtf.format(-Math.floor(elapsed / DAY), 'day');
    }

    return dayMonthFmt.format(d);
}

/** Exact timestamp for hover titles: "Jul 15, 2026, 01:04 PM". */
export function absoluteTime(iso: string | null | undefined): string {
    const d = parse(iso);

    return d ? fullFmt.format(d) : '—';
}

/**
 * Coarse elapsed span since a start date: "~3 weeks", "~5 months". Only used as a
 * fallback for "Subscribed for" when OnlyFans sends no duration label of its own —
 * the tilde marks it as our approximation rather than OF's word.
 */
export function coarseDuration(iso: string | null | undefined): string {
    const d = parse(iso);

    if (!d) {
        return '—';
    }

    const days = Math.floor((Date.now() - d.getTime()) / DAY);

    if (days < 1) {
        return 'Today';
    }

    const [n, unit] =
        days < 14
            ? [days, 'day']
            : days < 60
              ? [Math.floor(days / 7), 'week']
              : days < 365
                ? [Math.floor(days / 30), 'month']
                : [Math.floor(days / 365), 'year'];

    return `~${n} ${unit}${n === 1 ? '' : 's'}`;
}
