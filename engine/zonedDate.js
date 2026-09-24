'use strict';
/**
 * A `Date` whose LOCAL-time view is a fixed IANA zone instead of the host's.
 *
 * Legacy builds its "current time" prompt lines from `new Date()` local getters and
 * `toLocale*String`, which in the browser meant the chatter's clock. The engine runs in a
 * UTC container, and `process.env.TZ` is process-wide — flipping it per request would race
 * concurrent generations. Instead each generation's VM context gets this class as its
 * `Date` (see loadEngine.buildSandbox), so the legacy code reads the creator's clock
 * unmodified.
 *
 * Scope: the local getters + `toLocale*String` — everything the generate path touches.
 * Constructing from local components (`new Date(y, m, d)`) and the local setters still
 * use the host zone; legacy only does that in DOM-only paths (OCR import, date pickers).
 */
const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const classes = new Map();

/** @param {string|undefined|null} timeZone IANA zone; empty → the host `Date`, unchanged. */
function makeZonedDate(timeZone) {
    if (!timeZone) return Date;
    if (classes.has(timeZone)) return classes.get(timeZone);

    let fmt;
    try {
        fmt = new Intl.DateTimeFormat('en-US', {
            timeZone, hourCycle: 'h23', weekday: 'short',
            year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', second: 'numeric',
        });
    } catch (e) {
        // A zone this Node's ICU doesn't know (PHP validated it against its own list, so
        // this is version skew). A wrong clock beats a dropped generation.
        console.warn(`[engine] unknown timezone "${timeZone}" — using the host clock`);
        return Date;
    }

    /** Zone-local calendar fields, or null for an Invalid Date (getters then yield NaN, as native). */
    const fields = (d) => {
        if (Number.isNaN(d.getTime())) return null;
        const p = {};
        for (const { type, value } of fmt.formatToParts(d)) p[type] = value;
        return p;
    };
    const num = (d, key, offset = 0) => {
        const p = fields(d);
        return p ? Number(p[key]) + offset : NaN;
    };
    // An explicit `timeZone` from the caller still wins.
    const zoned = (opts) => ({ timeZone, ...opts });

    class ZonedDate extends Date {
        getFullYear() { return num(this, 'year'); }
        getMonth() { return num(this, 'month', -1); }
        getDate() { return num(this, 'day'); }
        getDay() { const p = fields(this); return p ? WEEKDAYS[p.weekday] : NaN; }
        getHours() { return num(this, 'hour'); }
        getMinutes() { return num(this, 'minute'); }
        getSeconds() { return num(this, 'second'); }
        toLocaleString(locales, opts) { return super.toLocaleString(locales, zoned(opts)); }
        toLocaleDateString(locales, opts) { return super.toLocaleDateString(locales, zoned(opts)); }
        toLocaleTimeString(locales, opts) { return super.toLocaleTimeString(locales, zoned(opts)); }
    }

    classes.set(timeZone, ZonedDate);
    return ZonedDate;
}

module.exports = { makeZonedDate };
