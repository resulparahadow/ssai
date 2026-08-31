<?php

namespace App\Services\OnlyFans;

use App\Models\AichModel;
use App\Models\CustomerProfile;

/**
 * Owns the live-path fan memory record (customer_profiles keyed by of_fan_id).
 * The AI's folded analysis auto-fills memory each generate; humans can pin fields
 * so auto never clobbers them. Spend is refreshed from OnlyFans (ground truth) and
 * is never manual/lockable. Nothing here stores message text.
 *
 * See docs/superpowers/specs/2026-07-03-fan-customer-profile-design.md.
 */
class FanProfileService
{
    public function __construct(protected OnlyFansService $of) {}

    /**
     * Load-or-create the fan's profile and refresh spend from OnlyFans (non-blocking).
     * `of_fan_id` is the chat id (which OnlyFans uses as the fan's user id).
     *
     * @param  array{id?:string,name?:string,username?:string}  $customer
     */
    public function loadForGenerate(AichModel $model, string $account, string $ofFanId, array $customer = []): CustomerProfile
    {
        $profile = $this->findOrNew($model, $ofFanId, $customer);
        $this->refreshSpend($profile, $account, $ofFanId);
        $profile->last_seen_at = now();
        $profile->save();

        return $profile;
    }

    /** GET-endpoint variant: return the stored profile without hitting OnlyFans or creating a row. */
    public function find(AichModel $model, string $ofFanId): ?CustomerProfile
    {
        return CustomerProfile::withoutGlobalScopes()
            ->where('creator_model', $model->name)
            ->where('of_fan_id', $ofFanId)
            ->first();
    }

    /** firstOrNew keyed on (creator_model, of_fan_id), stamping identity on a fresh row. */
    public function findOrNew(AichModel $model, string $ofFanId, array $customer = []): CustomerProfile
    {
        $profile = CustomerProfile::withoutGlobalScopes()->firstOrNew([
            'creator_model' => $model->name,
            'of_fan_id' => $ofFanId,
        ]);

        if (! $profile->exists) {
            $profile->customer_username = $customer['username'] ?? ('of_'.$ofFanId);
            $profile->customer_name = $customer['name'] ?? ($customer['username'] ?? 'Fan');
        }

        return $profile;
    }

    /**
     * Cache the fan's OnlyFans-native note locally. OnlyFans owns the note; this column is
     * only a mirror, so `generate` can feed it to the AI without paying a per-generation
     * billed call. Callers must mirror ONLY after OnlyFans confirms the write.
     */
    public function mirrorNote(AichModel $model, string $ofFanId, ?string $notes): CustomerProfile
    {
        $notes = $notes === null ? null : trim($notes);
        $profile = $this->findOrNew($model, $ofFanId);
        $profile->crm_notes = ($notes === null || $notes === '') ? null : $notes;
        $profile->save();

        return $profile;
    }

    /** The legacy `_profile` shape the engine reads (null-safe defaults match legacy). */
    public function toEngineProfile(CustomerProfile $profile): array
    {
        return [
            'trust_level' => (int) $profile->trust_level,
            'archetype' => $profile->archetype ?? 'Unknown',
            'temperature' => $profile->temperature ?? 'cold',
            'total_spend' => (float) $profile->total_spend,
            'tips_spend' => (float) $profile->tips_spend,
            'key_details' => (string) ($profile->key_details ?? ''),
            // Load-bearing cast: legacy `computeCustomerTier` short-circuits to the
            // 'flagged_tw' posture tier on a strict `is_timewaster===true`, so a truthy
            // 1/"1" would silently do nothing. Human-owned — never auto-set by analysis.
            'is_timewaster' => (bool) $profile->is_timewaster,
        ];
    }

    /**
     * Folded-analysis write-back: copy AI-owned fields from the strategy JSON onto
     * the record, skipping any the human has pinned. Fire-and-forget; caller swallows.
     *
     * @param  array<string, mixed>  $strategy
     */
    public function applyAnalysis(CustomerProfile $profile, array $strategy): void
    {
        $incoming = [
            'archetype' => $strategy['archetype'] ?? null,
            'trust_level' => $strategy['trust_level'] ?? null,
            'temperature' => $strategy['temperature'] ?? null,
            'key_details' => $strategy['key_details'] ?? null,
        ];

        foreach ($incoming as $field => $value) {
            if ($value === null || $value === '' || $profile->isLocked($field)) {
                continue;
            }
            $profile->{$field} = $field === 'trust_level' ? (int) $value : $value;
        }

        $profile->save();
    }

    /**
     * Apply a manual edit: setting an AI-owned field also pins it; `unlock[]` un-pins
     * (and clears so the next generate refills). Toggles/notes are set directly.
     *
     * @param  array<string, mixed>  $data
     */
    public function applyManualEdit(CustomerProfile $profile, array $data): CustomerProfile
    {
        $locked = $profile->locked_fields ?? [];

        foreach (CustomerProfile::AI_FIELDS as $field) {
            if (! array_key_exists($field, $data)) {
                continue;
            }
            $profile->{$field} = $field === 'trust_level' ? (int) $data[$field] : $data[$field];
            $locked[] = $field;
        }

        foreach (['crm_notes', 'is_timewaster', 'sexting_mode', 'tip_mode'] as $field) {
            if (array_key_exists($field, $data)) {
                $profile->{$field} = $data[$field];
            }
        }

        foreach ($data['unlock'] ?? [] as $field) {
            $locked = array_filter($locked, fn ($f) => $f !== $field);
            if (in_array($field, CustomerProfile::AI_FIELDS, true)) {
                $profile->{$field} = $field === 'trust_level' ? 0 : null;
            }
        }

        $profile->locked_fields = array_values(array_unique($locked));
        $profile->save();

        return $profile;
    }

    /** Compact shape for the FanPanel (memory + toggles + read-only spend + locks). */
    public function toPanel(?CustomerProfile $profile): array
    {
        return [
            'archetype' => $profile?->archetype,
            'trust_level' => (int) ($profile?->trust_level ?? 0),
            'temperature' => $profile?->temperature,
            'key_details' => $profile?->key_details,
            'crm_notes' => $profile?->crm_notes,
            'is_timewaster' => (bool) ($profile?->is_timewaster ?? false),
            'sexting_mode' => $profile?->sexting_mode ?? 'AUTO',
            'tip_mode' => $profile?->tip_mode ?? 'AUTO',
            'total_spend' => (float) ($profile?->total_spend ?? 0),
            'tips_spend' => (float) ($profile?->tips_spend ?? 0),
            'subscription_status' => $profile?->subscription_status,
            'locked_fields' => $profile?->locked_fields ?? [],
        ];
    }

    protected function refreshSpend(CustomerProfile $profile, string $account, string $ofFanId): void
    {
        try {
            $res = $this->of->getUser($account, $ofFanId);
            if (! $res->successful()) {
                return;
            }
            $spend = $this->of->extractFanSpend($res->json('data') ?? []);
            if ($spend['total'] !== null) {
                $profile->total_spend = $spend['total'];
            }
            if ($spend['tips'] !== null) {
                $profile->tips_spend = $spend['tips'];
            }
            if ($spend['status'] !== null) {
                $profile->subscription_status = $spend['status'];
            }
        } catch (\Throwable $e) {
            report($e);
        }
    }
}
