<?php

namespace App\Services\AI;

use App\Models\AichUsageEvent;
use Illuminate\Support\Facades\Log;

/**
 * Persists the engine's per-call usage ledger as aich_usage_events rows (metadata only).
 * Best-effort: metering must NEVER fail or slow a generate, so every error is swallowed + logged.
 */
class AiUsageRecorder
{
    /**
     * @param  list<array<string, mixed>>  $usage  the engine response's `usage` ledger
     * @param  array{generation_id:string,user_id?:int|null,creator_model?:string|null,chat_id?:string|null,session_id?:int|null,source:string}  $context
     */
    public function record(array $usage, array $context): void
    {
        if ($usage === []) {
            return;
        }

        try {
            $now = now();
            $rows = [];

            foreach ($usage as $e) {
                if (! is_array($e)) {
                    continue;
                }

                $rows[] = [
                    'generation_id' => $context['generation_id'],
                    'user_id' => $context['user_id'] ?? null,
                    'creator_model' => $context['creator_model'] ?? null,
                    'chat_id' => $context['chat_id'] ?? null,
                    'session_id' => $context['session_id'] ?? null,
                    'source' => $context['source'],
                    'call_type' => $e['callType'] ?? null,
                    'model' => $e['modelUsed'] ?? null,
                    'input_tokens' => (int) ($e['input'] ?? 0),
                    'cache_read_tokens' => (int) ($e['cacheRead'] ?? 0),
                    'cache_create_tokens' => (int) ($e['cacheCreate'] ?? 0),
                    'output_tokens' => (int) ($e['output'] ?? 0),
                    'cost' => (float) ($e['cost'] ?? 0),
                    'cached' => (bool) ($e['cached'] ?? false),
                    'duration_ms' => isset($e['durationMs']) ? (int) $e['durationMs'] : null,
                    'tok_per_sec' => isset($e['tokPerSec']) && $e['tokPerSec'] !== null ? (float) $e['tokPerSec'] : null,
                    'sys_blocks' => isset($e['sysBlocks']) ? json_encode($e['sysBlocks']) : null,
                    'created_at' => $now,
                ];
            }

            if ($rows !== []) {
                AichUsageEvent::insert($rows);
            }
        } catch (\Throwable $ex) {
            Log::warning('AI usage metering failed: '.$ex->getMessage());
        }
    }
}
