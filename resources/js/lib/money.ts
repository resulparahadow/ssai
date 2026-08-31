const usdFmt = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
});

/** Currency mask: 1234.5 → "$1,234.50". null/undefined → em-dash. */
export function usd(n: number | null | undefined): string {
    return n == null ? '—' : usdFmt.format(n);
}
