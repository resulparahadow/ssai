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

export interface OfChat {
    id: string; // fan user id (= chat id)
    name: string;
    username: string | null;
    avatar: string | null;
    initials: string;
    preview: string;
    time: string | null;
    unread: number;
    canSend: boolean;
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
