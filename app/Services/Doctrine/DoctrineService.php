<?php

namespace App\Services\Doctrine;

use App\Models\Doctrine;
use App\Services\Engine\EngineClient;
use Illuminate\Support\Facades\Cache;
use Throwable;

/**
 * Storage-level doctrine helpers (active row + integrity hash). The legacy
 * three-layer tamper check (structural headers, in-code SHA256, Supabase row
 * SHA256) collapses here to: the active row's stored sha256 must equal the
 * hash of its own prompt. The structural/behavioural verifier is part of the
 * engine-port spec.
 */
class DoctrineService
{
    /** Minimum word count a doctrine body must meet (legacy checkDoctrineIntegrity). */
    private const MIN_WORDS = 6000;

    /** Section headers a valid doctrine must contain (legacy REQUIRED_MARKERS). */
    private const REQUIRED_MARKERS = [
        'UNDERLYING FRAMEWORK', 'IDENTIFYING CUSTOMERS', 'CHAT SKELETON', 'PROMISE RITUAL',
        'POSTURE SYSTEM', 'OBJECTION HANDLING', 'GOODBYE FRAMEWORK', 'AFTERCARE', 'TOS', 'HARD RULES',
    ];

    /** The single active doctrine row, if any. */
    public function active(): ?Doctrine
    {
        return Doctrine::query()->active()->latest('id')->first();
    }

    /**
     * Structural integrity gate (port of legacy checkDoctrineIntegrity): the body
     * must have at least MIN_WORDS words and contain every required section marker.
     *
     * @return array{ok: bool, reason: string, missing: list<string>, words: int}
     */
    public function checkIntegrity(string $text): array
    {
        $trimmed = trim($text);

        if ($trimmed === '') {
            return ['ok' => false, 'reason' => 'empty or non-string', 'missing' => self::REQUIRED_MARKERS, 'words' => 0];
        }

        $words = count(preg_split('/\s+/', $trimmed) ?: []);
        $missing = array_values(array_filter(
            self::REQUIRED_MARKERS,
            fn (string $marker): bool => ! str_contains($text, $marker),
        ));

        if ($words < self::MIN_WORDS) {
            return ['ok' => false, 'reason' => "too short — {$words} words (min ".self::MIN_WORDS.')', 'missing' => $missing, 'words' => $words];
        }

        if ($missing !== []) {
            return ['ok' => false, 'reason' => 'missing '.count($missing).' required section markers', 'missing' => $missing, 'words' => $words];
        }

        return ['ok' => true, 'reason' => '', 'missing' => [], 'words' => $words];
    }

    /**
     * Persist a custom doctrine override: deactivate any prior active row and insert
     * a new active row (with recomputed sha256). Old rows are retained as history.
     */
    public function saveCustom(string $prompt, ?string $notes = null): Doctrine
    {
        Doctrine::query()->where('is_active', true)->update(['is_active' => false]);

        return Doctrine::query()->create([
            'version' => 'custom',
            'prompt' => $prompt,
            'sha256' => $this->hash($prompt),
            'tier' => 'system',
            'is_active' => true,
            'notes' => $notes,
        ]);
    }

    /** Revert to the engine canonical doctrine by deactivating all custom rows. */
    public function resetToDefault(): void
    {
        Doctrine::query()->where('is_active', true)->update(['is_active' => false]);
    }

    /**
     * The canonical default doctrine (engine's in-process DEFAULT_TRAINING), fetched
     * from the engine and short-cached. Falls back to the earliest seeded non-custom
     * row if the engine is unreachable.
     *
     * @return array{version: string, sha256: string, prompt: string}
     */
    public function defaultDoctrine(): array
    {
        return Cache::remember('doctrine.default', now()->addMinutes(5), function (): array {
            try {
                return app(EngineClient::class)->defaultDoctrine();
            } catch (Throwable) {
                $seed = Doctrine::query()->where('version', '!=', 'custom')->oldest('id')->first();

                return [
                    'version' => (string) ($seed->version ?? ''),
                    'sha256' => (string) ($seed->sha256 ?? ''),
                    'prompt' => (string) ($seed->prompt ?? ''),
                ];
            }
        });
    }

    /** Canonical hash of a doctrine body (sha256 hex of the UTF-8 bytes). */
    public function hash(string $prompt): string
    {
        return hash('sha256', $prompt);
    }

    /** True when the active row's stored hash matches its body. */
    public function integrityOk(): bool
    {
        $active = $this->active();

        return $active !== null && hash_equals($active->sha256, $this->hash($active->prompt));
    }
}
