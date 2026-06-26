import { postJson } from '@/lib/api';

/** Live OnlyFans proxy client. All calls hit /onlyfans/{model}/… and return the
 *  controller's normalised JSON. Nothing is cached/persisted. */

function cookie(name: string): string {
    const m = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));

    return m ? decodeURIComponent(m[2]) : '';
}

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
    const res = await fetch(url, {
        method,
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-XSRF-TOKEN': cookie('XSRF-TOKEN') },
        body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!res.ok) {
        const b = await res.json().catch(() => ({}));

        throw new Error(b.error || b.message || `Request failed (${res.status})`);
    }

    return res.json();
}

const base = (modelId: number) => `/onlyfans/${modelId}`;

export const ofApi = {
    chats: (m: number, params: Record<string, string> = {}) =>
        req<{ chats: unknown[]; next: Record<string, string> | null }>('GET', `${base(m)}/chats?${new URLSearchParams(params)}`),
    messages: (m: number, chat: string, params: Record<string, string> = {}) =>
        req<{ messages: unknown[]; next: Record<string, string> | null }>('GET', `${base(m)}/chats/${chat}/messages?${new URLSearchParams(params)}`),
    search: (m: number, chat: string, query: string) =>
        req<{ messages: unknown[] }>('GET', `${base(m)}/chats/${chat}/messages/search?query=${encodeURIComponent(query)}`),
    media: (m: number, chat: string) =>
        req<{ items: unknown[]; hasMore: boolean; next: number | null }>('GET', `${base(m)}/chats/${chat}/media`),
    send: (m: number, chat: string, text: string) =>
        postJson<{ message: unknown }>(`${base(m)}/chats/${chat}/messages`, { text }),
    deleteMessage: (m: number, chat: string, id: string) =>
        req<{ ok: boolean }>('DELETE', `${base(m)}/chats/${chat}/messages/${id}`),
    like: (m: number, chat: string, id: string) =>
        postJson<{ ok: boolean }>(`${base(m)}/chats/${chat}/messages/${id}/like`, {}),
    unlike: (m: number, chat: string, id: string) =>
        postJson<{ ok: boolean }>(`${base(m)}/chats/${chat}/messages/${id}/unlike`, {}),
    fan: (m: number, fanId: string) =>
        req<{ fan: unknown }>('GET', `${base(m)}/users/${fanId}`),
    generate: (m: number, chat: string, payload: object) =>
        postJson<{ draft: string; strategy: Record<string, unknown> | null; telemetry: Record<string, unknown> | null }>(`${base(m)}/chats/${chat}/generate`, payload),
};
