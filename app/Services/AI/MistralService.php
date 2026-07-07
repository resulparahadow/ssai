<?php

namespace App\Services\AI;

use RuntimeException;

/**
 * Server-side Mistral (via OpenRouter) client. Replaces the legacy
 * `mistral-proxy` Edge Function. Used for explicit content the Anthropic models
 * refuse; the routing decision (auto|claude|mistral) belongs to the engine port.
 *
 * Phase 1 = boundary only.
 */
class MistralService
{
    public function __construct(
        protected ?string $apiKey = null,
        protected string $model = 'mistralai/mistral-nemo',
    ) {
        $this->apiKey ??= (string) config('services.openrouter.key');
        $this->model = (string) config('services.openrouter.model', $this->model);
    }

    /**
     * @param  array<int, array<string, mixed>>  $messages
     * @return array<string, mixed>
     */
    public function complete(array $messages, array $options = []): array
    {
        throw new RuntimeException('MistralService::complete() is not yet ported — see the Phase 2 engine-port spec.');
    }
}
