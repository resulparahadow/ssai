import type { Role } from './auth';

export interface KpiCard {
    key: string;
    label: string;
    value: string;
    color: string;
    spark: number[];
}

export interface TargetRow {
    label: string;
    current: string;
    goal: string;
    pct: number;
    color: string;
}

export interface AttributionSlice {
    label: string;
    value: string;
    pct: number;
    color: string;
}

export interface SeriesPoint {
    label: string;
    value: number;
}

export interface CreatorRow {
    name: string;
    initials: string;
    revenue: string;
    revenueRaw: number;
    newPaid: number;
    newFree: number;
    salesRevenue: string;
    chatRatio: string;
    avgSpend: string;
}

export interface ChatterRow {
    name: string;
    initials: string;
    role: string;
    revenue: string;
    revenueRaw: number;
    sentMessages: number;
    conversations: number;
}

export interface DashboardData {
    period: string;
    periodOptions: string[];
    role: Role;
    canViewAllCreators: boolean;
    canViewAgencyProfit: boolean;
    kpis: KpiCard[];
    targets: TargetRow[];
    attribution: AttributionSlice[];
    revenueSeries: SeriesPoint[];
    creators: CreatorRow[];
    chatters: ChatterRow[];
}

// ---- Conversations (live OnlyFans shapes) ----

/** Kind of a chat's last message when it has no text — drives the conversation-list indicator. */
export type OfPreviewKind =
    | 'gif'
    | 'photo'
    | 'video'
    | 'audio'
    | 'tip'
    | 'locked'
    | 'media';

export interface OfChat {
    id: string; // fan user id (= chat id)
    name: string;
    username: string | null;
    avatar: string | null;
    initials: string;
    preview: string;
    previewKind?: OfPreviewKind | null; // set when preview text is empty (GIF/photo/video/…)
    time: string | null;
    unread: number;
    canSend: boolean;
}

export interface OfMedia {
    id: string | null;
    type: 'photo' | 'video' | 'gif' | 'audio' | string;
    canView: boolean; // false = locked / pay-to-view
    thumb: string | null;
    preview: string | null; // poster for video; medium preview for photo
    full: string | null; // null for DRM video (no plain url)
    duration: number | null; // seconds, video
    width: number | null;
    height: number | null;
    direct?: boolean; // url is browser-loadable as-is (e.g. optimistic Giphy preview) — skip the OF media proxy
}

/** A Giphy result from the OF Giphy proxy. Preview/url are Giphy CDN (browser-loadable). */
export interface OfGif {
    id: string | null;
    title: string | null;
    preview: string | null;
    url: string | null;
    width: number;
    height: number;
}

export interface OfMessage {
    id: string | null;
    from: 'fan' | 'creator';
    text: string;
    time: string | null;
    price: number;
    isFree: boolean;
    isOpened: boolean;
    isLiked: boolean;
    isTip: boolean;
    mediaCount: number;
    media: OfMedia[];
    pending?: boolean; // optimistic: shown while the send is in flight
    failed?: boolean; // optimistic: the send failed
    liking?: boolean; // transient: a like/unlike request is in flight
}

export interface OfFan {
    id: string;
    name: string | null;
    username: string | null;
    avatar: string | null;
    about: string;
    location: string | null;
    subscribePrice: number | null;
    lastSeen: string | null;
    canEarn: boolean | null;
}

export interface SidebarCreator {
    id: number;
    name: string;
    hasOf: boolean;
}

// AI Intelligence — the strategy object the engine returns from /generate.
// The legacy "analysis" is folded into the strategy, so every field the AI
// Intelligence panel needs lives here. All optional (engine may omit any).
export interface AiStrategy {
    temperature?: 'cold' | 'warming' | 'warm' | 'hot' | string;
    temperature_reason?: string;
    trust_level?: number;
    trust_reason?: string;
    archetype?: string;
    archetype_reason?: string;
    phase?: string;
    phase_reason?: string;
    skeleton_step?: string;
    skeleton_step_justification?: string;
    message_purpose?: string;
    next_move?: string;
    power_position_check?: string;
    customer_sexual_level?: number;
    customer_emotional_level?: number;
    creator_target_sexual_level?: number;
    creator_target_emotional_level?: number;
    warnings?: string | null;
    warning?: string | null;
    _clampedBy?: string;
    _depthGated?: boolean;
    [key: string]: unknown;
}

// ---- Creator Models ----

export interface CreatorModel {
    id: number;
    name: string;
    tier: string | null;
    prompt: string | null;
    content_library: string | null;
    feedback_rules: string | null;
    of_account_id: string | null;
    assigned: number[];
}

export interface ChatterOption {
    id: number;
    name: string;
    role: string;
}

// ---- Team & roles (user management) ----

export interface TeamUser {
    id: number;
    name: string;
    email: string;
    role: Role;
    must_change_password: boolean;
    assigned: string[]; // creator model names
    is_self: boolean;
}

// ---- Creator Model · live OnlyFans account data (show page) ----

export interface OfAccountStatus {
    isAuth: boolean;
    id: string | null;
    username: string | null;
    name: string | null;
    avatar: string | null;
    subscribersCount: number | null;
    postsCount: number | null;
}

export interface OfFanRow {
    id: string | null;
    name: string | null;
    username: string | null;
    avatar: string | null;
    initials: string;
    isVerified: boolean;
    online: boolean;
    durationLabel: string | null;
    totalSpent: number;
    tips: number;
    subscribePrice: number | null;
    subscribedAt: string | null;
    expiresAt: string | null;
    lastSeen: string | null;
    blocked: boolean;
}

export interface OfSubscriptionRecord {
    subscribeDate: string | null;
    expireDate: string | null;
    price: number;
}

export interface OfSettings {
    isPrivate: boolean;
    isDrmEnabled: boolean;
    hasPaidPosts: boolean;
    blockedCountriesCount: number;
}

export interface OfProfile {
    name: string | null;
    about: string;
    location: string | null;
    website: string | null;
    wishlist: string | null;
    subscribePrice: number | null;
}

export interface OfWelcomeMessage {
    id: string | null;
    text: string; // raw HTML
    isActive: boolean;
    price: number;
    lockedText: boolean;
    mediaCount: number;
    media: OfMedia[];
}

export interface OfNotification {
    id: string | null;
    type: string;
    subType: string | null;
    createdAt: string | null;
    isRead: boolean;
    text: string; // placeholders substituted + stripped to plain text
    canGoToProfile: boolean;
    userId: string | null;
}

export type OfNotificationCounts = Record<string, number>;

export interface OfUserDetail {
    id: string | null;
    name: string | null;
    username: string | null;
    displayName: string | null;
    avatar: string | null;
    initials: string;
    about: string;
    location: string | null;
    subscribePrice: number | null;
    isVerified: boolean;
    isBlocked: boolean;
    isRestricted: boolean;
    subscribedBy: boolean;
    subscribedByExpire: string | null;
    canChat: boolean;
    postsCount: number;
    photosCount: number;
    videosCount: number;
    favoritedCount: number;
}

export interface OfTrackingLink {
    id: string | null;
    name: string | null;
    url: string | null;
    clicks: number;
    subscribers: number;
    createdAt: string | null;
    endDate: string | null;
    tags: string[];
    revenue: number;
    revenuePerSubscriber: number;
    revenuePerClick: number;
    spenders: number;
}

export interface OfTrialLink {
    id: string | null;
    name: string | null;
    url: string | null;
    subscribeDays: number;
    subscribeCounts: number;
    claimCounts: number;
    clicksCounts: number;
    createdAt: string | null;
    expiredAt: string | null;
    isFinished: boolean;
    tags: string[];
    revenue: number;
    revenuePerSubscriber: number;
    spenders: number;
}

export interface OfLinkStats {
    clicks: number;
    subs: number;
    revenue: number;
    spenders: number;
}

export interface OfPromotion {
    id: string | null;
    message: string | null;
    type: string | null;
    price: number;
    subscribeCounts: number;
    subscribeDays: number;
    claimsCount: number;
    canClaim: boolean;
    createdAt: string | null;
    finishedAt: string | null;
    isFinished: boolean;
}

export interface OfBundle {
    id: string | null;
    discount: number;
    duration: number;
    price: number;
    canBuy: boolean;
}

export interface OfSmartLink {
    id: string | null;
    name: string | null;
    linkType: string | null;
    url: string | null;
    freeTrialDays: number | null;
    clicks: number;
    conversions: number;
    subscribers: number;
    spenders: number;
    revenue: number;
    account: {
        id: string | null;
        displayName: string | null;
        username: string | null;
    };
    createdAt: string | null;
}

export interface OfSmartLinkFan {
    fanId: string | null;
    onlyfansId: string | null;
    username: string | null;
    name: string | null;
    avatar: string | null;
    revenueNet: number;
    tipsNet: number;
    messagesSentByFan: number;
    convertedAt: string | null;
}

export interface OfSmartLinkSpender {
    onlyfansId: string | null;
    username: string | null;
    revenue: number;
}

export interface OfSmartLinkClick {
    id: string | null;
    createdAt: string | null;
    referrer: string | null;
    countryCode: string | null;
    browserName: string | null;
    deviceType: string | null;
    isBot: boolean;
    isDuplicate: boolean;
    utmSource: string | null;
}

export interface OfSmartLinkConversion {
    id: string | null;
    conversionType: string | null;
    amountGross: number;
    amountNet: number;
    conversionAt: string | null;
    fan: {
        onlyfansId: string | null;
        username: string | null;
        name: string | null;
        avatar: string | null;
    };
}

export interface OfSmartLinkFansSummary {
    fansTotal: number;
    revenueNetTotal: number;
    tipsNetTotal: number;
}

export interface OfSmartLinkConversionsSummary {
    conversionsTotal: number;
    subscribersTotal: number;
    revenueTotal: number;
}

// ---- Analytics dashboard (live OnlyFansAPI Analytics endpoints) ------------

/** A connected creator the Analytics dashboard can query. */
export interface OfAnalyticsAccount {
    id: number;
    name: string;
    accountId: string;
}

export interface OfEarningsOverview {
    total_earnings: number;
    subscriptions: number;
    posts: number;
    messages: number;
    tips: number;
    streams: number;
    total_accounts: number;
    total_messages: number;
    total_images: number;
    total_videos: number;
}

export interface OfHistoricalPoint {
    period: string;
    value: number;
}

export interface OfComparison {
    summary: {
        period_a_total: number;
        period_b_total: number;
        change: number;
        change_percentage: number;
    };
    breakdown: unknown[];
    chart_data: unknown[];
    period_a_label: string;
    period_b_label: string;
}

export interface OfTxnSummary {
    succeeded_count: number;
    refunded_count: number;
    disputed_count: number;
    total_gross: number;
    total_net: number;
    total_fees: number;
}

export interface OfTxnByType {
    type: string;
    count: number;
    total: number;
}

export interface OfForecastPoint {
    date: string;
    value: number;
}

export interface OfForecast {
    metric: string;
    model: string;
    historical: OfForecastPoint[];
    forecast: OfForecastPoint[];
}

export interface OfProfitabilityRow {
    creator_id: number;
    name: string;
    gross_revenue: number;
    net_revenue: number;
    total_costs: number;
    commission: number;
    profit: number;
    margin: number;
}

export interface OfProfitabilityHistoryRow {
    year: number;
    month: number;
    gross_revenue: number;
    net_revenue: number;
    profit: number;
    margin: number;
}

/** AI-generated fan profile summary (Fans - AI Summary). */
export interface OfFanSummaryData {
    name: string;
    preferred_name: string;
    family_pets: string;
    travel_plans: string;
    kinks: string;
    hobbies: string;
    content_preferences: string;
    themes: string;
    requests: string;
    interests: string;
    other_notes: string;
}

export interface OfFanSummary {
    status: string; // 'completed' | 'processing' | 'failed' | ''
    summary_data: OfFanSummaryData | null;
    analyzed_message_count: number | null;
    last_analyzed_at: string | null;
    error_message: string | null;
}

export type OfToggleMode = 'AUTO' | 'FORCE_ON' | 'FORCE_OFF';

/** AI-owned memory field name that can be pinned so auto-analysis won't overwrite it. */
export type OfLockableField =
    | 'archetype'
    | 'trust_level'
    | 'temperature'
    | 'key_details';

/** Persisted per-fan memory + behavior toggles fed to AI generation (customer_profiles). */
export interface OfFanProfile {
    archetype: string | null;
    trust_level: number;
    temperature: string | null;
    key_details: string | null;
    crm_notes: string | null;
    is_timewaster: boolean;
    sexting_mode: OfToggleMode;
    tip_mode: OfToggleMode;
    total_spend: number; // read-only, from OnlyFans
    tips_spend: number; // read-only, from OnlyFans
    subscription_status: string | null;
    locked_fields: OfLockableField[];
}
