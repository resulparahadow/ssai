const usdFmt = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
});

/** Currency mask: 1234.5 → "$1,234.50". null/undefined → em-dash. */
export function usd(n: number | null | undefined): string {
    return n == null ? '—' : usdFmt.format(n);
}

/**
 * The OnlyFans PPV price rule, mirrored from App\Rules\PpvPrice: free (0) or $3–$200 with at
 * most two decimals. Checked client-side so Send is disabled before a billed vendor 422.
 */
export function isValidPpvPrice(n: number): boolean {
    if (!Number.isFinite(n) || n < 0) {
        return false;
    }

    if (Math.abs(n - Math.round(n * 100) / 100) > 1e-9) {
        return false;
    }

    return n === 0 || (n >= 3 && n <= 200);
}
