<?php

use App\Support\PpvPriceSuggestion;

/**
 * The engine's PPV price suggestion is clamped into what OnlyFans accepts (whole dollars,
 * $3–$200) before the chatter sees it, so "Use" can never produce an unsendable price.
 */
it('normalizes the engine suggestion', function (mixed $raw, mixed $expected) {
    expect(PpvPriceSuggestion::normalize($raw))->toBe($expected);
})->with([
    'absent' => [null, null],
    'in range' => [['price' => 14, 'reason' => 'cold'], ['price' => 14, 'reason' => 'cold']],
    'rounds to whole dollars' => [['price' => 12.6, 'reason' => 'x'], ['price' => 13, 'reason' => 'x']],
    'caps at 200' => [['price' => 250, 'reason' => 'whale'], ['price' => 200, 'reason' => 'whale · capped at $200']],
    'raises to 3' => [['price' => 1, 'reason' => 'cold'], ['price' => 3, 'reason' => 'cold · raised to the $3 minimum']],
    'zero' => [['price' => 0], ['error' => 'no usable price']],
    'non-numeric' => [['price' => 'abc'], ['error' => 'no usable price']],
    'empty' => [[], ['error' => 'no usable price']],
    'engine error passes through' => [['error' => 'price suggestion timed out'], ['error' => 'price suggestion timed out']],
]);

it('truncates a long reason to 160 chars', function () {
    $out = PpvPriceSuggestion::normalize(['price' => 20, 'reason' => str_repeat('a', 300)]);

    expect(mb_strlen($out['reason']))->toBe(160);
});
