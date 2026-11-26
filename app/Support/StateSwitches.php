<?php

namespace App\Support;

use App\Models\CustomerProfile;
use Illuminate\Validation\Rule;

/**
 * The §5b state switches: per-fan manual values the chatter sets on the Fan tab's SSAI state
 * card. Stored in `customer_profiles.state_overrides` (an absent key = Auto), loaded server-side
 * on every generate and sent to the engine as `stateOverrides` (engine/stateNote.js). Trust is
 * NOT here: it is the existing locked `trust_level`.
 *
 * See docs/superpowers/specs/2026-11-27-state-switches-design.md §4, §6, §10a.
 */
final class StateSwitches
{
    /** Storage keys, in the spec §4 order (the order the engine's note lists them). */
    public const KEYS = ['phase', 'rls_beat', 'fan_type', 'lane', 'posture', 'promise', 'language', 'support'];

    public const PHASES = ['warm_up', 'rapport', 'link', 'sale', 'loop', 'aftersale'];

    public const FAN_TYPES = ['new', 'returning', 'spender'];

    /** 'normal' is not stored: lane normal = no key. */
    public const LANES = ['sex_only', 'rude'];

    public const POSTURES = ['normal', 'frame_hold', 'timewaster'];

    public const PROMISES = ['not_asked', 'asked', 'reinforced_1', 'reinforced_2'];

    public const LANGUAGES = ['es', 'en'];

    public const RLS_BEAT_MAX = 12;

    /** Intents refused while support mode is on (client chips + server 422). */
    public const SELLING_INTENTS = ['ppv', 'repitch', 'reoffer_mppv', 'cta', 'tip_ask', 'promise', 'free_picture'];

    public const SUPPORT_ERROR = 'Support mode is on — no selling.';

    private const POSTURE_TO_ENGINE = ['normal' => 'WARM_BUILD', 'frame_hold' => 'PRESSURE', 'timewaster' => 'TIMEWASTER'];

    private const PROMISE_TO_ENGINE = [
        'not_asked' => 'not_started',
        'asked' => 'in_progress',
        'reinforced_1' => 'reinforcement',
        'reinforced_2' => 'assumed',
    ];

    private const PHASE_FROM_LEGACY = [
        'chit_chat' => 'rapport', 'rapport' => 'rapport', 'warm_welcome' => 'rapport', 'yes_flow' => 'rapport',
        'cta1' => 'link', 'promise_ritual' => 'link',
        'sell' => 'sale', 'cta2' => 'sale', 'send_content' => 'sale', 'objection' => 'sale',
        'warmup_between_rungs' => 'loop',
        'aftercare' => 'aftersale', 'close' => 'aftersale',
    ];

    private const POSTURE_FROM_LEGACY = [
        'WARM_BUILD' => 'normal', 'PROBE' => 'normal', 'PRESSURE' => 'frame_hold',
        'TIMEWASTER' => 'timewaster', 'FLAGGED_TW' => 'timewaster',
    ];

    private const PROMISE_FROM_LEGACY = [
        'not_started' => 'not_asked',
        'in_progress' => 'asked', 'verbally_committed' => 'asked',
        'complete' => 'reinforced_1', 'reinforcement' => 'reinforced_1',
        'assumed' => 'reinforced_2',
    ];

    /**
     * Laravel rules for a PATCH `state_overrides` object. Null removes a key; lane `normal` and
     * support `false` are accepted as removals. `language` only for a bilingual creator.
     *
     * @return array<string, mixed>
     */
    public static function rules(bool $bilingual): array
    {
        return [
            'state_overrides' => 'sometimes|array:'.implode(',', self::KEYS),
            'state_overrides.phase' => ['nullable', Rule::in(self::PHASES)],
            'state_overrides.rls_beat' => 'nullable|integer|min:1|max:'.self::RLS_BEAT_MAX,
            'state_overrides.fan_type' => ['nullable', Rule::in(self::FAN_TYPES)],
            'state_overrides.lane' => ['nullable', Rule::in([...self::LANES, 'normal'])],
            'state_overrides.posture' => ['nullable', Rule::in(self::POSTURES)],
            'state_overrides.promise' => ['nullable', Rule::in(self::PROMISES)],
            'state_overrides.language' => $bilingual
                ? ['nullable', Rule::in(self::LANGUAGES)]
                : ['nullable', 'prohibited'],
            'state_overrides.support' => 'nullable|boolean',
        ];
    }

    /**
     * Merge a PATCH into the stored overrides, per key. Null / lane normal / support off remove
     * the key. The result keeps the §4 key order.
     *
     * @param  array<string, mixed>  $current
     * @param  array<string, mixed>  $patch
     * @return array<string, mixed>
     */
    public static function merge(array $current, array $patch): array
    {
        foreach ($patch as $key => $value) {
            if (! in_array($key, self::KEYS, true)) {
                continue;
            }
            $remove = $value === null
                || ($key === 'lane' && $value === 'normal')
                || ($key === 'support' && ! filter_var($value, FILTER_VALIDATE_BOOLEAN));
            if ($remove) {
                unset($current[$key]);

                continue;
            }
            $current[$key] = match ($key) {
                'rls_beat' => (int) $value,
                'support' => true,
                default => (string) $value,
            };
        }

        $ordered = [];
        foreach (array_merge(self::KEYS, array_keys($current)) as $key) {
            if (array_key_exists($key, $current) && ! array_key_exists($key, $ordered)) {
                $ordered[$key] = $current[$key];
            }
        }

        return $ordered;
    }

    /**
     * The engine's legacy-shaped `stateOverrides` (contract). [] when nothing is manual, and the
     * caller then omits the key, so an all-Auto generate reaches the engine byte-identical.
     *
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>
     */
    public static function toEngine(array $overrides): array
    {
        $out = [];
        if (isset($overrides['phase'])) {
            $out['phase'] = (string) $overrides['phase'];
        }
        if (isset($overrides['rls_beat'])) {
            $out['rlsBeat'] = (int) $overrides['rls_beat'];
        }
        if (isset($overrides['fan_type'])) {
            $out['fanTier'] = $overrides['fan_type'] === 'new' ? 'new' : 'old';
            if ($overrides['fan_type'] === 'spender') {
                $out['spender'] = true;
            }
        }
        if (isset($overrides['lane'])) {
            $out['lane'] = (string) $overrides['lane'];
        }
        if (isset($overrides['posture'], self::POSTURE_TO_ENGINE[$overrides['posture']])) {
            $out['posture'] = self::POSTURE_TO_ENGINE[$overrides['posture']];
            if ($overrides['posture'] === 'frame_hold') {
                $out['frameHold'] = true;
            }
        }
        if (isset($overrides['promise'], self::PROMISE_TO_ENGINE[$overrides['promise']])) {
            $out['promiseStatus'] = self::PROMISE_TO_ENGINE[$overrides['promise']];
        }
        if (isset($overrides['language'])) {
            $out['language'] = (string) $overrides['language'];
        }
        if (! empty($overrides['support'])) {
            $out['support'] = true;
        }

        return $out;
    }

    /**
     * SSAI's own read for the Auto rows (contract `auto_read`).
     *
     * - phase / language: the last stored strategy;
     * - posture / promise: the last telemetry (promise: the committed chat state wins upstream);
     * - fan type: legacy's `computeCustomerTier` rule over the profile (spend > 0 or trust ≥ 2 →
     *   old); `fan_type_from_trust` when only trust made him old.
     *
     * @param  array<string, mixed>|null  $lastStrategy
     * @param  array<string, mixed>|null  $telemetry
     * @return array{phase: ?string, fan_type: ?string, fan_type_from_trust: bool, posture: ?string, promise: ?string, language: ?string}
     */
    public static function autoRead(?array $lastStrategy, ?array $telemetry, ?CustomerProfile $p): array
    {
        $fanType = null;
        $fromTrust = false;
        if ($p !== null) {
            $spend = (float) $p->total_spend + (float) $p->tips_spend;
            // Legacy: parseInt(profile.trust_level || 1) — an unset trust reads as 1.
            $trust = (int) $p->trust_level ?: 1;
            if ($spend > 0) {
                $fanType = 'spender';
            } elseif ($trust >= 2) {
                $fanType = 'returning';
                $fromTrust = true;
            } else {
                $fanType = 'new';
            }
        }

        $lang = strtolower((string) ($lastStrategy['customer_language'] ?? ''));

        return [
            'phase' => self::PHASE_FROM_LEGACY[(string) ($lastStrategy['phase'] ?? '')] ?? null,
            'fan_type' => $fanType,
            'fan_type_from_trust' => $fromTrust,
            'posture' => self::POSTURE_FROM_LEGACY[strtoupper((string) ($telemetry['posture'] ?? ''))] ?? null,
            'promise' => self::PROMISE_FROM_LEGACY[(string) ($telemetry['promiseStatus'] ?? '')] ?? null,
            'language' => match (true) {
                str_starts_with($lang, 'es') || str_starts_with($lang, 'span') => 'es',
                str_starts_with($lang, 'en') => 'en',
                default => null,
            },
        ];
    }

    /** True when a selling intent must be refused for these overrides. */
    public static function blocksIntent(array $overrides, ?string $intent): bool
    {
        return ! empty($overrides['support']) && $intent !== null && in_array($intent, self::SELLING_INTENTS, true);
    }
}
