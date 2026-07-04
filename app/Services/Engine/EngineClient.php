<?php

namespace App\Services\Engine;

use App\Models\AichModel;
use App\Models\AichSession;
use App\Models\CreatorStatus;
use App\Models\CustomerProfile;
use Illuminate\Support\Facades\Http;

/**
 * Talks to the Node engine sidecar (engine/server.js), which runs the REAL
 * legacy generate(). This class maps a MySQL AichSession (+ persona, profile,
 * creator status) into the legacy session shape the engine expects, calls it,
 * and returns the draft + strategy + telemetry. The doctrine is intentionally
 * NOT sent — the engine uses its in-process DEFAULT_TRAINING constant (the exact
 * canonical brain), which the doctrines table mirrors for the integrity layer.
 */
class EngineClient
{
    /** @return array<string, mixed> */
    public function generateForSession(AichSession $session, array $opts = []): array
    {
        return $this->call($this->buildPayload($session, $opts));
    }

    /**
     * Generate from LIVE OnlyFans data — no DB session/profile. The controller
     * passes engine-shaped messages (sender customer|model + text + ts_iso) and
     * the fan's basic identity. Intel/posture is recomputed from the messages.
     *
     * @param  list<array{sender:string,text:string,ts_iso?:string}>  $messages
     * @param  array{id?:string,name?:string,username?:string}  $customer
     * @return array<string, mixed>
     */
    public function generateFromLive(AichModel $model, array $messages, array $customer, array $opts = []): array
    {
        $status = CreatorStatus::query()->active()
            ->where('creator_model', $model->name)
            ->latest('created_at')->take(8)->get();

        // Persisted fan memory (see FanProfileService). When absent the path stays
        // fully transient with legacy defaults — nothing here is required.
        $profile = $opts['profile'] ?? null;

        return $this->call([
            'model' => [
                'name' => $model->name,
                'prompt' => (string) ($model->prompt ?? ''),
                'content_library' => $this->asText($model->content_library),
                'feedback_rules' => $this->asText($model->feedback_rules),
            ],
            'session' => [
                'id' => 'live-'.($customer['id'] ?? uniqid()),
                'creator_model' => $model->name,
                'customer_name' => $customer['name'] ?? ($customer['username'] ?? 'Fan'),
                'customer_username' => $customer['username'] ?? ('of_'.($customer['id'] ?? '')),
                'subscription_status' => $opts['subscription_status'] ?? 'subscribed',
                'time_on_page' => '?',
                'total_spend' => '$'.$this->num($opts['total_spend'] ?? 0),
                'tips_spend' => '$'.$this->num($opts['tips_spend'] ?? 0),
                'crm_notes' => (string) ($opts['crm_notes'] ?? ''),
                'vn_used' => [],
                'inputMode' => 'chat',
                'messages' => array_values($messages),
                '_profile' => $profile, // populated from CustomerProfile when present, else null
                '_sextingModeToggle' => $opts['sexting'] ?? 'AUTO',
                '_tipModeToggle' => $opts['tipMode'] ?? 'AUTO',
                '_promiseStatus' => 'not_started',
                '_storyFrameworkStep' => 0,
            ],
            'creatorStatus' => $status->map(fn (CreatorStatus $e) => [
                'category' => $e->category,
                'status_text' => $e->status_text,
                'created_at' => optional($e->created_at)->toIso8601String(),
            ])->all(),
            'api' => $opts['api'] ?? 'claude',
            'sender' => $opts['sender'] ?? 'customer',
            'context' => $opts['context'] ?? '',
        ]);
    }

    /** @return array<string, mixed> */
    public function buildPayload(AichSession $session, array $opts = []): array
    {
        $model = AichModel::query()->where('name', $session->creator_model)->first();
        $profile = CustomerProfile::withoutGlobalScopes()
            ->where('creator_model', $session->creator_model)
            ->where('customer_username', $session->customer_username)
            ->first();
        $status = CreatorStatus::query()->active()
            ->where('creator_model', $session->creator_model)
            ->latest('created_at')->take(8)->get();

        return [
            'model' => [
                'name' => $model?->name ?? $session->creator_model,
                'prompt' => (string) ($model?->prompt ?? ''),
                'content_library' => $this->asText($model?->content_library),
                'feedback_rules' => $this->asText($model?->feedback_rules),
            ],
            'session' => [
                'id' => (string) $session->id,
                'creator_model' => $session->creator_model,
                'customer_name' => $session->customer_name,
                'customer_username' => $session->customer_username,
                'subscription_status' => $profile?->subscription_status ?? 'subscribed',
                'time_on_page' => $profile?->time_on_page ? $profile->time_on_page.'m' : '?',
                'total_spend' => '$'.$this->num($session->total_spend),
                'tips_spend' => '$'.$this->num($session->tips_spend),
                'crm_notes' => (string) ($session->crm_notes ?? ''),
                'vn_used' => $session->vn_used ?? [],
                'inputMode' => 'chat',
                'messages' => $session->messages ?? [],
                '_profile' => $profile ? [
                    'trust_level' => (int) $profile->trust_level,
                    'archetype' => $profile->archetype ?? 'Unknown',
                    'temperature' => $profile->temperature ?? 'cold',
                    'total_spend' => (float) $profile->total_spend,
                    'tips_spend' => (float) $profile->tips_spend,
                    'key_details' => (string) ($profile->crm_notes ?? ''),
                ] : null,
                '_sextingModeToggle' => $opts['sexting'] ?? 'AUTO',
                '_tipModeToggle' => $opts['tipMode'] ?? 'AUTO',
                '_promiseStatus' => $session->promise_status ?? 'not_started',
                '_storyFrameworkStep' => (int) ($session->story_framework_step ?? 0),
            ],
            'creatorStatus' => $status->map(fn (CreatorStatus $e) => [
                'category' => $e->category,
                'status_text' => $e->status_text,
                'created_at' => optional($e->created_at)->toIso8601String(),
            ])->all(),
            'api' => $opts['api'] ?? 'claude',
            'sender' => $opts['sender'] ?? 'customer',
            'context' => $opts['context'] ?? '',
        ];
    }

    /** @param array<string, mixed> $payload @return array<string, mixed> */
    protected function call(array $payload): array
    {
        $base = rtrim((string) config('services.engine.url'), '/');

        $res = Http::timeout((int) config('services.engine.timeout', 60))
            ->acceptJson()
            ->post($base.'/generate', $payload);

        $res->throw();

        return $res->json();
    }

    private function asText(mixed $v): string
    {
        if ($v === null || $v === '') {
            return '';
        }

        return is_string($v) ? $v : (string) json_encode($v);
    }

    private function num(mixed $v): string
    {
        return rtrim(rtrim(number_format((float) $v, 2, '.', ''), '0'), '.') ?: '0';
    }
}
