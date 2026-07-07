<?php

namespace App\Services\Doctrine;

use App\Models\Doctrine;

/**
 * Storage-level doctrine helpers (active row + integrity hash). The legacy
 * three-layer tamper check (structural headers, in-code SHA256, Supabase row
 * SHA256) collapses here to: the active row's stored sha256 must equal the
 * hash of its own prompt. The structural/behavioural verifier is part of the
 * engine-port spec.
 */
class DoctrineService
{
    /** The single active doctrine row, if any. */
    public function active(): ?Doctrine
    {
        return Doctrine::query()->active()->latest('id')->first();
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
