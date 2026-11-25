/** Name labels + script-note detection for script steps (spec: "Name labels", "Bracket guard"). */

const TOKEN = /\{(fan name|custom name)\}/gi;

/** A raw OnlyFans id-style name ("u12345678") is not a real name. */
function usable(v: string | null | undefined): string | null {
    const s = (v ?? '').trim();

    return s === '' || /^u\d+$/.test(s) ? null : s;
}

/** Match the token's casing: UPPER, lower, else as stored. */
function cased(token: string, value: string): string {
    if (token === token.toUpperCase()) {
        return value.toUpperCase();
    }

    if (token === token.toLowerCase()) {
        return value.toLowerCase();
    }

    return value;
}

/**
 * Replace {Fan Name}/{Custom Name} (any of Title/UPPER/lower case). An empty or `uNNN` value
 * uses `fallback`; with no fallback the token is removed and the gap tidied.
 */
export function fillLabels(
    text: string,
    fan: { fanName: string; customName: string },
    fallback: string | null,
): string {
    let removed = false;
    const out = text.replace(TOKEN, (token: string, which: string) => {
        const value =
            usable(
                which.toLowerCase() === 'fan name'
                    ? fan.fanName
                    : fan.customName,
            ) ?? usable(fallback);

        if (value === null) {
            removed = true;

            return '';
        }

        return cased(token.slice(1, -1), value);
    });

    return removed
        ? out
              .replace(/ {2,}/g, ' ')
              .replace(/ +([,.!?])/g, '$1')
              .trim()
        : out;
}

/**
 * The first `[ … ]` span on one line with something inside (a chatter's instruction left in a
 * step, which must not be sent). `end` is exclusive. Null when there is none.
 */
export function findScriptNote(
    text: string,
): { start: number; end: number } | null {
    const re = /\[([^\]\n]*)\]/g;
    let m: RegExpExecArray | null;

    while ((m = re.exec(text)) !== null) {
        if (m[1].trim() !== '') {
            return { start: m.index, end: m.index + m[0].length };
        }
    }

    return null;
}
