<?php

use App\Models\AichChatState;
use App\Services\OnlyFans\PpvReadiness;
use Illuminate\Support\Carbon;

uses(Tests\TestCase::class);

/**
 * "SSAI planned X next" on a PPV caption: the forward plan saved when the chatter last accepted
 * a draft, shown only when it was a non-selling move AND still describes this point in the chat.
 */
const READY_T = 1_790_000_000; // commit time
const READY_GAP = 12 * 3600;

function readinessState(?string $plan): AichChatState
{
    $s = new AichChatState(['creator_model' => 'Camila', 'chat_id' => '101', 'next_planned_move' => $plan]);
    $s->updated_at = Carbon::createFromTimestamp(READY_T);

    return $s;
}

function msgAt(int $offset, string $from = 'creator', array $extra = []): array
{
    return ['from' => $from, 'text' => 'x', 'time' => date('c', READY_T + $offset)] + $extra;
}

function readiness(?string $plan, array $messages = [], int $now = READY_T + 600, bool $state = true): ?string
{
    return (new PpvReadiness)->plan($state ? readinessState($plan) : null, $messages, $now, READY_GAP);
}

it('warns for non-selling plans', function (string $plan) {
    expect(readiness($plan))->toBe($plan);
})->with(['rapport_beat', 'qualifying_question', 'aftercare', 'goodbye_script', 'manager_flag']);

it('does not warn for pitch moves, unknown values or no plan', function (?string $plan) {
    expect(readiness($plan))->toBeNull();
})->with(['send_ppv', 'cta1', 'cta2', 'seed_cta', 'tier_jump_test', 'exclusive_custom', 'weird_value', null]);

it('does not warn without saved state', function () {
    expect(readiness('rapport_beat', state: false))->toBeNull();
});

it('still warns after the accepted draft itself was sent', function () {
    expect(readiness('rapport_beat', [msgAt(5)]))->toBe('rapport_beat');
});

it('ignores fan messages when counting', function () {
    expect(readiness('rapport_beat', [msgAt(60, 'fan'), msgAt(5)]))->toBe('rapport_beat');
});

it('drops the plan after two creator messages', function () {
    expect(readiness('rapport_beat', [msgAt(5), msgAt(120)]))->toBeNull();
});

it('drops the plan after a PPV was sent', function () {
    expect(readiness('rapport_beat', [msgAt(5, 'creator', ['price' => 20, 'isFree' => false, 'isTip' => false])]))->toBeNull();
});

it('counts a tip-flagged priced message as a message, not a PPV', function () {
    expect(readiness('rapport_beat', [msgAt(5, 'creator', ['price' => 20, 'isFree' => false, 'isTip' => true])]))->toBe('rapport_beat');
});

it('drops the plan once the chat went quiet past the gap', function () {
    expect(readiness('rapport_beat', [], READY_T + 13 * 3600))->toBeNull();
});

it('drops the plan when the thread itself had a gap', function () {
    expect(readiness('rapport_beat', [msgAt(3600, 'fan'), msgAt(14 * 3600, 'fan')], READY_T + 14 * 3600 + 300))->toBeNull();
});
