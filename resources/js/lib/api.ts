/** Minimal JSON POST helper for authenticated same-origin endpoints (sends the
 *  Laravel XSRF cookie as a header). Used by interactive CRM widgets that want a
 *  JSON response rather than an Inertia visit. */
function cookie(name: string): string {
    const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));

    return m ? decodeURIComponent(m[2]) : '';
}

/** Generic same-origin JSON request (GET/POST/PUT/PATCH/DELETE) with the XSRF header. */
export async function reqJson<T = unknown>(
    method: string,
    url: string,
    body?: unknown,
): Promise<T> {
    const res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-XSRF-TOKEN': cookie('XSRF-TOKEN'),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
        const b = await res.json().catch(() => ({}));

        throw new Error(
            // Prefer the human `message` over the machine `error` code. OnlyFansAPI answers
            // with BOTH (e.g. error: "SERVICE_UNAVAILABLE" / "SESSION_EXPIRED:NEEDS_REAUTHENTICATION"
            // alongside "This Account can't be used. It needs re-authentication…"), and showing
            // the code alone turned an actionable account-state problem into an opaque string in
            // the conversations list. Our own endpoints put their human text under `error` and
            // carry no `message`, so they still read correctly through the fallback.
            b.message || b.error || `Request failed (${res.status})`,
        );
    }

    return res.json();
}

export function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
    return reqJson<T>('POST', url, body);
}
