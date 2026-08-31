import { reqJson } from '@/lib/api';
import type {
    OfAccountStatus,
    OfBundle,
    OfFanRow,
    OfFanSummary,
    OfLinkStats,
    OfNotification,
    OfNotificationCounts,
    OfProfile,
    OfPromotion,
    OfSettings,
    OfSmartLink,
    OfSmartLinkClick,
    OfSmartLinkConversion,
    OfSmartLinkConversionsSummary,
    OfSmartLinkFan,
    OfSmartLinkFansSummary,
    OfSmartLinkSpender,
    OfSubscriptionRecord,
    OfTrackingLink,
    OfTrialLink,
    OfUserDetail,
    OfWelcomeMessage,
} from '@/types/crm';

/** Live OnlyFans account-management proxy for the Creator Model show page. All calls
 *  hit /models/{model}/of/… and return the controller's normalised JSON. Manager/admin
 *  only (gated server-side). Nothing is persisted. */

const base = (modelId: number) => `/models/${modelId}/of`;

/** Build a query string, dropping undefined/empty values. */
const qs = (params: Record<string, unknown>) =>
    new URLSearchParams(
        Object.entries(params)
            .filter(([, v]) => v !== undefined && v !== '')
            .map(([k, v]) => [k, String(v)]),
    ).toString();

export interface FansParams {
    bucket?: 'active' | 'all' | 'expired' | 'top';
    by?: string;
    limit?: number;
    offset?: number;
    query?: string;
    start_date?: string;
    end_date?: string;
}

export const ofModel = {
    status: (m: number) =>
        reqJson<{ status: OfAccountStatus }>('GET', `${base(m)}/status`),
    fans: (m: number, params: FansParams = {}) => {
        const q = new URLSearchParams(
            Object.entries(params)
                .filter(([, v]) => v !== undefined && v !== '')
                .map(([k, v]) => [k, String(v)]),
        );

        return reqJson<{
            fans: OfFanRow[];
            hasMore: boolean;
            next: Record<string, string> | null;
        }>('GET', `${base(m)}/fans?${q}`);
    },
    /** All-time spenders (fans with lifetime spend >= floor) for the Spender-Brackets
     *  page. Bucketing happens client-side; `fresh` bypasses the short server cache. */
    spenders: (m: number, floor: number, fresh = false) =>
        reqJson<{
            spenders: OfFanRow[];
            floor: number;
            count: number;
            truncated: boolean;
        }>('GET', `${base(m)}/spenders?${qs({ floor, fresh: fresh ? 1 : undefined })}`),
    fanHistory: (m: number, fanId: string) =>
        reqJson<{ history: OfSubscriptionRecord[] }>(
            'GET',
            `${base(m)}/fans/${fanId}/history`,
        ),
    fanSummary: (m: number, fanId: string) =>
        reqJson<OfFanSummary>('GET', `${base(m)}/fans/${fanId}/summary`),
    generateFanSummary: (m: number, fanId: string, regenerate = false) =>
        reqJson<{ status: string; message: string }>(
            'POST',
            `${base(m)}/fans/${fanId}/summary`,
            regenerate ? { regenerate: true } : {},
        ),
    settings: (m: number) =>
        reqJson<{ settings: OfSettings; profile: OfProfile }>(
            'GET',
            `${base(m)}/settings`,
        ),
    saveProfile: (
        m: number,
        body: Partial<
            Pick<
                OfProfile,
                'name' | 'about' | 'location' | 'website' | 'wishlist'
            >
        >,
    ) => reqJson<{ ok: boolean }>('POST', `${base(m)}/settings/profile`, body),
    saveSubscriptionPrice: (m: number, price: string) =>
        reqJson<{ ok: boolean }>(
            'PATCH',
            `${base(m)}/settings/subscription-price`,
            { price },
        ),
    welcome: (m: number) =>
        reqJson<{ welcome: OfWelcomeMessage }>(
            'GET',
            `${base(m)}/welcome-message`,
        ),
    saveWelcome: (m: number, body: { text: string; lockedText?: boolean }) =>
        reqJson<{ ok: boolean }>('POST', `${base(m)}/welcome-message`, body),
    toggleWelcome: (m: number, enabled: boolean) =>
        reqJson<{ ok: boolean }>('PATCH', `${base(m)}/welcome-message`, {
            enabled,
        }),

    // ---- Notifications ----
    notifications: (
        m: number,
        params: { type?: string; limit?: number; from_id?: string } = {},
    ) => {
        const q = new URLSearchParams(
            Object.entries(params)
                .filter(([, v]) => v !== undefined && v !== '')
                .map(([k, v]) => [k, String(v)]),
        );

        return reqJson<{
            notifications: OfNotification[];
            hasMore: boolean;
            next: string | null;
        }>('GET', `${base(m)}/notifications?${q}`);
    },
    notificationCounts: (m: number) =>
        reqJson<{ counts: OfNotificationCounts }>(
            'GET',
            `${base(m)}/notifications/counts`,
        ),
    markNotificationsRead: (m: number) =>
        reqJson<{ ok: boolean }>(
            'POST',
            `${base(m)}/notifications/mark-read`,
            {},
        ),

    // ---- Users · lookup + moderation ----
    /** OnlyFans caps `limit` at 50 on both moderation lists. */
    moderatedUsers: (
        m: number,
        bucket: 'blocked' | 'restricted',
        params: { limit?: number; offset?: number; query?: string } = {},
    ) =>
        reqJson<{
            users: OfUserDetail[];
            hasMore: boolean;
            nextOffset: number | null;
        }>(
            'GET',
            `${base(m)}/users/${bucket}?${new URLSearchParams(
                Object.entries(params)
                    .filter(([, v]) => v !== undefined && v !== '')
                    .map(([k, v]) => [k, String(v)]),
            )}`,
        ),
    lookupUser: (m: number, user: string) =>
        reqJson<{ user: OfUserDetail }>(
            'GET',
            `${base(m)}/users/${encodeURIComponent(user)}`,
        ),
    userDetails: (m: number, ids: string[]) =>
        reqJson<{ users: OfUserDetail[] }>(
            'GET',
            `${base(m)}/users/list?ids=${encodeURIComponent(ids.join(','))}`,
        ),
    setUserState: (
        m: number,
        user: string,
        action: 'block' | 'restrict' | 'subscribe',
        on: boolean,
    ) =>
        reqJson<{ ok: boolean; data: unknown }>(
            on ? 'POST' : 'DELETE',
            `${base(m)}/users/${encodeURIComponent(user)}/${action}`,
            on ? {} : undefined,
        ),

    // ---- Trial & Tracking links ----
    trackingLinks: (
        m: number,
        params: { limit?: number; offset?: number } = {},
    ) => {
        const q = new URLSearchParams(
            Object.entries(params)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k, String(v)]),
        );

        return reqJson<{
            links: OfTrackingLink[];
            hasMore: boolean;
            next: Record<string, string> | null;
        }>('GET', `${base(m)}/tracking-links?${q}`);
    },
    createTrackingLink: (m: number, body: { name: string; tags?: string[] }) =>
        reqJson<{ ok: boolean; data: unknown }>(
            'POST',
            `${base(m)}/tracking-links`,
            body,
        ),
    deleteTrackingLink: (m: number, id: string) =>
        reqJson<{ ok: boolean }>('DELETE', `${base(m)}/tracking-links/${id}`),
    trackingLinkStats: (m: number, id: string) =>
        reqJson<{ stats: OfLinkStats }>(
            'GET',
            `${base(m)}/tracking-links/${id}/stats`,
        ),
    trialLinks: (
        m: number,
        params: { limit?: number; offset?: number } = {},
    ) => {
        const q = new URLSearchParams(
            Object.entries(params)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => [k, String(v)]),
        );

        return reqJson<{
            links: OfTrialLink[];
            hasMore: boolean;
            next: Record<string, string> | null;
        }>('GET', `${base(m)}/trial-links?${q}`);
    },
    createTrialLink: (
        m: number,
        body: {
            duration: number;
            offerExpiration: number;
            offerLimit: number;
            name?: string;
            tags?: string[];
        },
    ) =>
        reqJson<{ ok: boolean; data: unknown }>(
            'POST',
            `${base(m)}/trial-links`,
            body,
        ),
    deleteTrialLink: (m: number, id: string) =>
        reqJson<{ ok: boolean }>('DELETE', `${base(m)}/trial-links/${id}`),
    trialLinkStats: (m: number, id: string) =>
        reqJson<{ stats: OfLinkStats }>(
            'GET',
            `${base(m)}/trial-links/${id}/stats`,
        ),

    // ---- Smart links ----
    smartLinks: (
        m: number,
        params: { limit?: number; offset?: number; name?: string } = {},
    ) =>
        reqJson<{ links: OfSmartLink[] }>(
            'GET',
            `${base(m)}/smart-links?${qs(params)}`,
        ),
    createSmartLink: (
        m: number,
        body: {
            name: string;
            link_type: 'free_trial' | 'tracking_link';
            free_trial_days?: number;
        },
    ) =>
        reqJson<{ ok: boolean; data: unknown }>(
            'POST',
            `${base(m)}/smart-links`,
            body,
        ),
    deleteSmartLink: (m: number, id: string) =>
        reqJson<{ ok: boolean }>('DELETE', `${base(m)}/smart-links/${id}`),
    smartLinkStats: (m: number, id: string) =>
        reqJson<{ stats: OfLinkStats }>(
            'GET',
            `${base(m)}/smart-links/${id}/stats`,
        ),
    smartLinkFans: (
        m: number,
        id: string,
        params: { limit?: number; sort?: string } = {},
    ) =>
        reqJson<{ summary: OfSmartLinkFansSummary; rows: OfSmartLinkFan[] }>(
            'GET',
            `${base(m)}/smart-links/${id}/fans?${qs(params)}`,
        ),
    smartLinkSpenders: (
        m: number,
        id: string,
        params: { limit?: number; minSpend?: number } = {},
    ) =>
        reqJson<{ rows: OfSmartLinkSpender[] }>(
            'GET',
            `${base(m)}/smart-links/${id}/spenders?${qs(params)}`,
        ),
    smartLinkClicks: (m: number, id: string, params: { limit?: number } = {}) =>
        reqJson<{ total: number; rows: OfSmartLinkClick[] }>(
            'GET',
            `${base(m)}/smart-links/${id}/clicks?${qs(params)}`,
        ),
    smartLinkConversions: (
        m: number,
        id: string,
        params: { limit?: number; conversion_type?: string } = {},
    ) =>
        reqJson<{
            summary: OfSmartLinkConversionsSummary;
            rows: OfSmartLinkConversion[];
        }>('GET', `${base(m)}/smart-links/${id}/conversions?${qs(params)}`),
    smartLinkTags: (m: number, id: string) =>
        reqJson<{ tags: string[] }>('GET', `${base(m)}/smart-links/${id}/tags`),
    addSmartLinkTags: (m: number, id: string, tags: string[]) =>
        reqJson<{ tags: string[] }>(
            'POST',
            `${base(m)}/smart-links/${id}/tags`,
            { tags },
        ),
    removeSmartLinkTags: (m: number, id: string, tags: string[]) =>
        reqJson<{ tags: string[] }>(
            'DELETE',
            `${base(m)}/smart-links/${id}/tags`,
            { tags },
        ),

    // ---- Link tags (agency-wide; optional type filter) ----
    linkTags: (
        m: number,
        type?: 'trial_links' | 'tracking_links' | 'smart_links',
    ) =>
        reqJson<{ tags: string[] }>(
            'GET',
            `${base(m)}/link-tags${type ? `?type=${type}` : ''}`,
        ),

    // ---- Promotions ----
    promotions: (m: number, params: { limit?: number; offset?: number } = {}) =>
        reqJson<{ promotions: OfPromotion[]; hasMore: boolean }>(
            'GET',
            `${base(m)}/promotions?${qs(params)}`,
        ),
    createPromotion: (
        m: number,
        body: {
            type: 'new' | 'expired' | 'new_and_expired';
            discount: number;
            offerLimit: number;
            expirationDays: number;
            freeTrialDays?: number;
            message?: string;
        },
    ) =>
        reqJson<{ ok: boolean; data: unknown }>(
            'POST',
            `${base(m)}/promotions`,
            body,
        ),
    stopPromotion: (m: number, id: string) =>
        reqJson<{ ok: boolean }>(
            'POST',
            `${base(m)}/promotions/${id}/stop`,
            {},
        ),
    deletePromotion: (m: number, id: string) =>
        reqJson<{ ok: boolean }>('DELETE', `${base(m)}/promotions/${id}`),

    // ---- Subscription bundles ----
    bundles: (m: number) =>
        reqJson<{ bundles: OfBundle[] }>('GET', `${base(m)}/bundles`),
    createBundle: (m: number, body: { discount: number; duration: number }) =>
        reqJson<{ ok: boolean; data: unknown }>(
            'POST',
            `${base(m)}/bundles`,
            body,
        ),
    deleteBundle: (m: number, id: string) =>
        reqJson<{ ok: boolean }>('DELETE', `${base(m)}/bundles/${id}`),
};
