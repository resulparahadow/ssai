<?php

namespace App\Support;

/**
 * The engine's PPV price suggestion (legacy `fetchPpvSuggestion`), made sendable before the
 * chatter sees it: whole dollars, clamped into OnlyFans' paid range ($3–$200, App\Rules\PpvPrice),
 * so the composer's "Use" button can never set a price Send would refuse. A clamp is said out
 * loud in the reason rather than done silently.
 */
final class PpvPriceSuggestion
{
    public const MIN = 3;

    public const MAX = 200;

    private const REASON_MAX = 160;

    /** @return array{price: int, reason: string}|array{error: string}|null */
    public static function normalize(mixed $raw): ?array
    {
        if ($raw === null) {
            return null;
        }

        if (is_array($raw) && isset($raw['error']) && ! isset($raw['price'])) {
            return ['error' => mb_substr((string) $raw['error'], 0, self::REASON_MAX)];
        }

        $price = is_array($raw) ? ($raw['price'] ?? null) : null;

        if (! is_numeric($price) || (float) $price <= 0) {
            return ['error' => 'no usable price'];
        }

        $price = (int) round((float) $price);
        $reason = trim((string) ($raw['reason'] ?? ''));

        if ($price > self::MAX) {
            $price = self::MAX;
            $reason = ltrim($reason.' · capped at $'.self::MAX, ' ·');
        } elseif ($price < self::MIN) {
            $price = self::MIN;
            $reason = ltrim($reason.' · raised to the $'.self::MIN.' minimum', ' ·');
        }

        return ['price' => $price, 'reason' => mb_substr($reason, 0, self::REASON_MAX)];
    }
}
