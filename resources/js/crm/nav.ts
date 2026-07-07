import {
    BookOpen,
    ChartColumnBig,
    Crown,
    LayoutGrid,
    Megaphone,
    MessageSquare,
    Shield,
    SlidersHorizontal,
    Sparkles,
    Users,
    Zap,
} from '@lucide/vue';
import type { Component } from 'vue';
import type { Role } from '@/types/auth';

export type Cap = 'viewDashboard' | 'chat' | 'analytics' | 'manageTeam';

/**
 * Capability matrix mirrored from the design (PERM in SSAI-new-design.html) and
 * from the server gates in AppServiceProvider::configureGates(). The server is
 * the real enforcement; this drives nav visibility only.
 */
export const PERM: Record<Role, Record<Cap, boolean>> = {
    admin: {
        viewDashboard: true,
        chat: true,
        analytics: true,
        manageTeam: true,
    },
    manager: {
        viewDashboard: true,
        chat: true,
        analytics: true,
        manageTeam: true,
    },
    chatter: {
        viewDashboard: false,
        chat: true,
        analytics: false,
        manageTeam: false,
    },
};

export function can(role: Role, cap: Cap): boolean {
    return !!PERM[role]?.[cap];
}

export interface NavChild {
    key: string;
    label: string;
    href?: string;
}

export interface NavNode {
    key: string;
    label: string;
    icon: Component;
    cap: Cap;
    href?: string;
    children?: NavChild[];
    /** Children come from a shared Inertia prop at render time (e.g. 'creators'). */
    dynamic?: 'creators';
    /** Phase-1: Overview is the only built view, so it is visible to every role. */
    alwaysOn?: boolean;
}

export const NAV: NavNode[] = [
    // --- Built / working views (kept on top) ---------------------------------
    {
        key: 'overview',
        label: 'Overview',
        icon: LayoutGrid,
        cap: 'viewDashboard',
        href: '/dashboard',
        alwaysOn: true,
    },
    {
        key: 'chat',
        label: 'Conversations',
        icon: MessageSquare,
        cap: 'chat',
        dynamic: 'creators',
    },
    {
        key: 'models',
        label: 'Creator Models',
        icon: Users,
        cap: 'manageTeam',
        href: '/models',
    },
    {
        key: 'analytics',
        label: 'Analytics',
        icon: ChartColumnBig,
        cap: 'analytics',
        children: [
            {
                key: 'an-overview',
                label: 'Overview',
                href: '/analytics/overview',
            },
            { key: 'an-chatting', label: 'Chatting performance' },
            { key: 'an-ai', label: 'AI usage', href: '/analytics/ai-usage' },
            { key: 'an-qa', label: 'Conversation QA' },
            { key: 'an-content', label: 'Content performance' },
            { key: 'an-pl', label: 'Creator P&L' },
        ],
    },
    {
        key: 'team',
        label: 'Team & roles',
        icon: Shield,
        cap: 'manageTeam',
        href: '/team',
    },
    {
        key: 'settings',
        label: 'Settings',
        icon: SlidersHorizontal,
        cap: 'manageTeam',
        href: '/settings/profile',
        // Every user manages their own profile/password/notification prefs (the server
        // settings routes are per-user, not team-gated), so show it to all roles.
        alwaysOn: true,
    },

    // --- Coming soon (not built yet) -----------------------------------------
    { key: 'whales', label: 'Whales & churn', icon: Crown, cap: 'analytics' },
    { key: 'playbooks', label: 'Playbooks', icon: BookOpen, cap: 'analytics' },
    { key: 'automations', label: 'Automations', icon: Zap, cap: 'analytics' },
    {
        key: 'marketing',
        label: 'Marketing',
        icon: Megaphone,
        cap: 'analytics',
        children: [
            { key: 'mk-channels', label: 'Channels & spend' },
            { key: 'mk-links', label: 'Tracking & Smart Links' },
            { key: 'mk-creative', label: 'Creative performance' },
        ],
    },
    {
        key: 'planned',
        label: 'Planned · roadmap',
        icon: Sparkles,
        cap: 'analytics',
        children: [
            { key: 'needs', label: 'Needs attention' },
            { key: 'da', label: 'Weekly DA' },
            { key: 'ofmm', label: 'OFMM & MPPV' },
            { key: 'stories', label: 'Stories planner' },
            { key: 'ssai', label: 'SSAI assistant' },
        ],
    },
];

const COLOR_VAR: Record<string, string> = {
    accent: '--ss-accent',
    msg: '--ss-c-msg',
    tip: '--ss-c-tip',
    sub: '--ss-c-sub',
    pos: '--ss-pos',
    neg: '--ss-neg',
    warn: '--ss-warn',
    'text-3': '--ss-text-3',
};

/** Map a design color key (e.g. 'msg') to its CSS variable reference. */
export function ssColor(key: string): string {
    return `var(${COLOR_VAR[key] ?? '--ss-accent'})`;
}
