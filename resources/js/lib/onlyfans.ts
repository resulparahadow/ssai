import { postJson } from '@/lib/api';
import type {
    AiStrategy,
    OfFanNote,
    OfFanProfile,
    OfFanSummary,
    OfGif,
    OfLockableField,
    OfMedia,
    OfMessage,
    OfPreviewKind,
} from '@/types/crm';

/**
 * Classify a (text-less) message for the conversation-list preview indicator. Mirrors
 * OnlyFansService::lastMessageKind on the backend so live inbound messages get the same
 * GIF/photo/video/… label the listed chats do. Returns null when text is present.
 */
export function messagePreviewKind(m: OfMessage): OfPreviewKind | null {
    if (m.text.trim() !== '') {
        return null;
    }

    const media = m.media ?? [];

    if (media.length === 0) {
        if (m.mediaCount > 0) {
            return 'media';
        }

        return m.isTip ? 'tip' : null;
    }

    const types = new Set(media.map((x) => x.type));

    if (types.has('gif')) {
        return 'gif';
    }

    if (!media.some((x) => x.canView)) {
        return 'locked';
    }

    return (
        (['video', 'audio', 'photo'] as const).find((t) => types.has(t)) ??
        'media'
    );
}

/** Money state of a single message, or null if it carries no price. */
export type MessagePay = { kind: 'tip' | 'ppv'; price: number; paid: boolean };

/**
 * Classify the money state of a message for the bubble status pill:
 *  - a fan-sent tip is money already received (always "paid");
 *  - a creator-sent PPV is paid once the fan has opened it (opening requires purchase).
 * Everything else (free messages, optimistic sends with price 0) returns null.
 */
export function messagePayInfo(m: OfMessage): MessagePay | null {
    if (m.isTip && m.price > 0) {
        return { kind: 'tip', price: m.price, paid: true };
    }

    if (!m.isTip && !m.isFree && m.price > 0) {
        return { kind: 'ppv', price: m.price, paid: m.isOpened };
    }

    return null;
}

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
            b.error || b.message || `Request failed (${res.status})`,
        );
    }

    return res.json();
}

const base = (modelId: number) => `/onlyfans/${modelId}`;

export const ofApi = {
    chats: (m: number, params: Record<string, string> = {}) =>
        req<{ chats: unknown[]; next: Record<string, string> | null }>(
            'GET',
            `${base(m)}/chats?${new URLSearchParams(params)}`,
        ),
    messages: (m: number, chat: string, params: Record<string, string> = {}) =>
        req<{ messages: unknown[]; next: Record<string, string> | null }>(
            'GET',
            `${base(m)}/chats/${chat}/messages?${new URLSearchParams(params)}`,
        ),
    search: (m: number, chat: string, query: string) =>
        req<{ messages: unknown[] }>(
            'GET',
            `${base(m)}/chats/${chat}/messages/search?query=${encodeURIComponent(query)}`,
        ),
    media: (m: number, chat: string) =>
        req<{ items: unknown[]; hasMore: boolean; next: number | null }>(
            'GET',
            `${base(m)}/chats/${chat}/media`,
        ),
    /** Proxied URL for an IP-locked OnlyFans CDN file — safe to use as an <img>/<video> src. */
    mediaUrl: (m: number, cdnUrl: string) =>
        `${base(m)}/media?url=${encodeURIComponent(cdnUrl)}`,
    /**
     * Upload one file and return its media id.
     *
     * Deliberately XMLHttpRequest, not the fetch `req()` helper used everywhere else in
     * this file: fetch cannot report UPLOAD progress, and a 100MB file behind a bare
     * spinner is unusable. This is the only exception — everything else stays on fetch.
     */
    uploadMedia: (m: number, file: File, onProgress: (pct: number) => void) =>
        new Promise<{ id: string; status: string }>((resolve, reject) => {
            const form = new FormData();
            form.append('file', file);

            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${base(m)}/media/upload`);
            xhr.withCredentials = true;
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.setRequestHeader('X-XSRF-TOKEN', cookie('XSRF-TOKEN'));

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    onProgress(Math.round((e.loaded / e.total) * 100));
                }
            };

            xhr.onload = () => {
                let body: Record<string, string> = {};

                try {
                    body = JSON.parse(xhr.responseText);
                } catch {
                    // A 413 from nginx is an HTML page, not JSON — say something useful.
                    reject(new Error(`Upload failed (${xhr.status})`));

                    return;
                }

                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(body as unknown as { id: string; status: string });
                } else {
                    reject(
                        new Error(
                            body.error ||
                                body.message ||
                                `Upload failed (${xhr.status})`,
                        ),
                    );
                }
            };

            xhr.onerror = () =>
                reject(new Error('Upload failed — network error.'));
            xhr.onabort = () => reject(new Error('Upload cancelled.'));

            xhr.send(form);
        }),
    uploadStatus: (m: number, id: string) =>
        req<{ status: string; error: string | null }>(
            'GET',
            `${base(m)}/media/uploads/${encodeURIComponent(id)}/status`,
        ),
    vault: (m: number, params: Record<string, string> = {}) =>
        req<{ items: OfMedia[]; hasMore: boolean }>(
            'GET',
            `${base(m)}/media/vault?${new URLSearchParams(params)}`,
        ),
    send: (
        m: number,
        chat: string,
        text: string,
        giphyId?: string,
        mediaFiles?: string[],
    ) =>
        postJson<{ message: unknown }>(`${base(m)}/chats/${chat}/messages`, {
            text,
            giphyId,
            mediaFiles,
        }),
    giphyTrending: (m: number) =>
        req<{ gifs: OfGif[] }>('GET', `${base(m)}/giphy/trending`),
    giphySearch: (
        m: number,
        q: string,
        params: { limit?: number; offset?: number } = {},
    ) =>
        req<{ gifs: OfGif[] }>(
            'GET',
            `${base(m)}/giphy/search?${new URLSearchParams({
                q,
                ...Object.fromEntries(
                    Object.entries(params)
                        .filter(([, v]) => v !== undefined)
                        .map(([k, v]) => [k, String(v)]),
                ),
            })}`,
        ),
    deleteMessage: (m: number, chat: string, id: string) =>
        req<{ ok: boolean }>(
            'DELETE',
            `${base(m)}/chats/${chat}/messages/${id}`,
        ),
    like: (m: number, chat: string, id: string) =>
        postJson<{ ok: boolean }>(
            `${base(m)}/chats/${chat}/messages/${id}/like`,
            {},
        ),
    unlike: (m: number, chat: string, id: string) =>
        postJson<{ ok: boolean }>(
            `${base(m)}/chats/${chat}/messages/${id}/unlike`,
            {},
        ),
    fan: (m: number, fanId: string) =>
        req<{ fan: unknown }>('GET', `${base(m)}/users/${fanId}`),
    fanSummary: (m: number, fanId: string) =>
        req<OfFanSummary>('GET', `${base(m)}/fans/${fanId}/summary`),
    generateFanSummary: (m: number, fanId: string, regenerate = false) =>
        postJson<{ status: string; message: string }>(
            `${base(m)}/fans/${fanId}/summary`,
            regenerate ? { regenerate: true } : {},
        ),
    generate: (m: number, chat: string, payload: object) =>
        postJson<{
            draft: string;
            strategy: AiStrategy | null;
            telemetry: Record<string, unknown> | null;
            generatedAt: string | null;
        }>(`${base(m)}/chats/${chat}/generate`, payload),
    intel: (m: number, chat: string) =>
        req<{ strategy: AiStrategy | null; generatedAt: string | null }>(
            'GET',
            `${base(m)}/chats/${chat}/intel`,
        ),
    /** Persisted fan memory + toggles for a chat (chat id = of_fan_id). */
    getProfile: (m: number, chat: string) =>
        req<{ profile: OfFanProfile }>(
            'GET',
            `${base(m)}/chats/${chat}/profile`,
        ),
    /** Edit fan memory/toggles. Sending an AI-owned field pins it; `unlock` re-opens fields. */
    saveProfile: (
        m: number,
        chat: string,
        payload: Partial<
            Pick<
                OfFanProfile,
                | 'archetype'
                | 'trust_level'
                | 'temperature'
                | 'key_details'
                | 'is_timewaster'
                | 'sexting_mode'
                | 'tip_mode'
            >
        > & { unlock?: OfLockableField[] },
    ) =>
        req<{ profile: OfFanProfile }>(
            'PATCH',
            `${base(m)}/chats/${chat}/profile`,
            payload,
        ),

    // ---- Chat actions -----------------------------------------------------
    mute: (m: number, chat: string) =>
        postJson<{ ok: boolean }>(`${base(m)}/chats/${chat}/mute`, {}),
    unmute: (m: number, chat: string) =>
        req<{ ok: boolean }>('DELETE', `${base(m)}/chats/${chat}/mute`),
    markRead: (m: number, chat: string) =>
        postJson<{ ok: boolean }>(`${base(m)}/chats/${chat}/mark-as-read`, {}),
    markUnread: (m: number, chat: string) =>
        postJson<{ ok: boolean }>(
            `${base(m)}/chats/${chat}/mark-as-unread`,
            {},
        ),
    /** Manager+ only. OnlyFans unhides the chat only when the fan is messaged again. */
    hide: (m: number, chat: string) =>
        postJson<{ ok: boolean }>(`${base(m)}/chats/${chat}/hide`, {}),

    // ---- Pinned messages --------------------------------------------------
    pinned: (m: number, chat: string) =>
        req<{ messages: unknown[] }>('GET', `${base(m)}/chats/${chat}/pinned`),
    pin: (m: number, chat: string, id: string) =>
        postJson<{ ok: boolean }>(
            `${base(m)}/chats/${chat}/messages/${id}/pin`,
            {},
        ),
    unpin: (m: number, chat: string, id: string) =>
        req<{ ok: boolean }>(
            'DELETE',
            `${base(m)}/chats/${chat}/messages/${id}/unpin`,
        ),

    // ---- Fan note (OnlyFans-owned) ----------------------------------------
    getNotes: (m: number, chat: string) =>
        req<OfFanNote>('GET', `${base(m)}/chats/${chat}/notes`),
    saveNotes: (m: number, chat: string, notes: string) =>
        req<{ ok: boolean } & OfFanNote>(
            'PUT',
            `${base(m)}/chats/${chat}/notes`,
            { notes },
        ),
    clearNotes: (m: number, chat: string) =>
        req<{ ok: boolean } & OfFanNote>(
            'DELETE',
            `${base(m)}/chats/${chat}/notes`,
        ),
    /** Set the fan's OnlyFans custom name; '' or null clears it. */
    rename: (m: number, chat: string, customName: string | null) =>
        req<{ ok: boolean; name: string | null }>(
            'PUT',
            `${base(m)}/chats/${chat}/custom-name`,
            { custom_name: customName },
        ),

    // ---- Moderation (manager+; server-gated by can:manage-team) -----------
    block: (m: number, fanId: string) =>
        postJson<{ ok: boolean }>(`${base(m)}/users/${fanId}/block`, {}),
    unblock: (m: number, fanId: string) =>
        req<{ ok: boolean }>('DELETE', `${base(m)}/users/${fanId}/block`),
    restrict: (m: number, fanId: string) =>
        postJson<{ ok: boolean }>(`${base(m)}/users/${fanId}/restrict`, {}),
    unrestrict: (m: number, fanId: string) =>
        req<{ ok: boolean }>('DELETE', `${base(m)}/users/${fanId}/restrict`),
    /** Drop the creator's own subscription to the fan ("unfollow"). */
    unfollow: (m: number, fanId: string) =>
        req<{ ok: boolean }>('DELETE', `${base(m)}/users/${fanId}/subscribe`),
};
