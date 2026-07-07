<?php

namespace App\Services\AI;

use RuntimeException;

/**
 * Server-side Anthropic (Claude) client. Replaces the legacy Supabase
 * `anthropic-proxy` Edge Function: the real API key lives in server config and
 * never reaches the browser (an improvement over the legacy low-value ssai_*
 * proxy token).
 *
 * Phase 1 = boundary only. The strategy + generator + analysis calls and the
 * prompt-cache discipline are part of the engine-port spec; until then the
 * methods throw so nothing silently no-ops.
 *
 * Intended foundation: the first-party Laravel AI SDK (Laravel 13+).
 */
class AnthropicService
{
    public function __construct(
        protected ?string $apiKey = null,
        protected string $model = 'claude-sonnet-4-6',
    ) {
        $this->apiKey ??= (string) config('services.anthropic.key');
        $this->model = (string) config('services.anthropic.model', $this->model);
    }

    /**
     * Run a single Claude completion.
     *
     * @param  array<int, array<string, mixed>>  $messages
     * @param  array<int, array<string, mixed>>  $system
     * @return array<string, mixed>
     */
    public function messages(array $messages, array $system = [], array $options = []): array
    {
        throw new RuntimeException('AnthropicService::messages() is not yet ported — see the Phase 2 engine-port spec.');
    }
}
