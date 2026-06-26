<?php

namespace App\Enums;

/**
 * Access tiers. Legacy had manager|chatter; the new design adds an admin/owner
 * tier above manager (owner-only widgets such as agency profit per message).
 *
 * Hierarchy: Admin > Manager > Chatter.
 */
enum UserRole: string
{
    case Admin = 'admin';
    case Manager = 'manager';
    case Chatter = 'chatter';

    public function label(): string
    {
        return match ($this) {
            self::Admin => 'Admin',
            self::Manager => 'Manager',
            self::Chatter => 'Chatter',
        };
    }

    /** Admin + Manager see every creator's data; chatters are scoped to assignments. */
    public function canSeeAllCreators(): bool
    {
        return $this === self::Admin || $this === self::Manager;
    }

    /** Team management (assign creators, manage chatters) is manager and up. */
    public function canManageTeam(): bool
    {
        return $this === self::Admin || $this === self::Manager;
    }

    /** Owner-only financials (agency profit / margin) are admin only. */
    public function canViewAgencyProfit(): bool
    {
        return $this === self::Admin;
    }
}
