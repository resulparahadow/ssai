/** Minimal JSON POST helper for authenticated same-origin endpoints (sends the
 *  Laravel XSRF cookie as a header). Used by interactive CRM widgets that want a
 *  JSON response rather than an Inertia visit. */
function cookie(name: string): string {
    const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));

    return m ? decodeURIComponent(m[2]) : '';
}

export async function postJson<T = unknown>(url: string, body: unknown): Promise<T> {
    const res = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'X-XSRF-TOKEN': cookie('XSRF-TOKEN'),
        },
        body: JSON.stringify(body),
    });

    if (!res.ok) {
        const b = await res.json().catch(() => ({}));

        throw new Error(b.error || b.message || `Request failed (${res.status})`);
    }

    return res.json();
}
