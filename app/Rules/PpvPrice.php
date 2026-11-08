<?php

namespace App\Rules;

use Closure;
use Illuminate\Contracts\Validation\ValidationRule;

/**
 * The OnlyFans PPV price rule, mirrored client-side by `isValidPpvPrice` in lib/money.ts:
 * free (0) or $3–$200, at most two decimals (verified live 2026-11-07 — the vendor 422s
 * anything else, after billing the call). Validated here so a bad price never reaches it.
 */
class PpvPrice implements ValidationRule
{
    public const MESSAGE = 'Price must be free, or between $3 and $200.';

    public function validate(string $attribute, mixed $value, Closure $fail): void
    {
        if (! is_numeric($value)) {
            $fail(self::MESSAGE);

            return;
        }

        $price = (float) $value;

        // Two decimals max: compare against the value rounded to cents.
        if (abs($price - round($price, 2)) > 1e-9) {
            $fail('Price can have at most two decimals.');

            return;
        }

        if ($price == 0.0) {
            return;
        }

        if ($price < 3 || $price > 200) {
            $fail(self::MESSAGE);
        }
    }
}
