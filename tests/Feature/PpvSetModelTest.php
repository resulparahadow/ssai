<?php

use App\Models\ModelAssignment;
use App\Models\PpvSet;
use App\Models\PpvSetSend;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

function ppvChatter(string $creator): User
{
    $user = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $user->id, 'creator_model' => $creator]);

    return $user;
}

function ppvSet(string $creator, string $name = 'Red set'): PpvSet
{
    return PpvSet::create([
        'creator_model' => $creator,
        'name' => $name,
        'price' => 20,
        'media' => [['id' => '1', 'type' => 'photo', 'thumb' => null]],
    ]);
}

it("scopes ppv sets to the chatter's assigned creators", function () {
    ppvSet('Camila', 'Red set');
    ppvSet('Nina', 'Nina set');

    $this->actingAs(ppvChatter('Camila'));

    expect(PpvSet::pluck('name')->all())->toBe(['Red set']);
});

it('casts media to an array and price to a 2-decimal string', function () {
    $set = ppvSet('Camila')->fresh();

    expect($set->media)->toBe([['id' => '1', 'type' => 'photo', 'thumb' => null]])
        ->and($set->price)->toBe('20.00');
});

it('stamps the sender on a ledger row and cascades on set delete', function () {
    $set = ppvSet('Camila');
    $this->actingAs(ppvChatter('Camila'));

    $row = PpvSetSend::create([
        'ppv_set_id' => $set->id,
        'creator_model' => 'Camila',
        'of_fan_id' => '101',
        'price' => 20,
        'sent_at' => now(),
    ]);

    expect($row->user_id)->toBe(auth()->id())
        ->and($set->sends()->count())->toBe(1);

    $set->delete();

    expect(PpvSetSend::withoutGlobalScopes()->count())->toBe(0);
});
