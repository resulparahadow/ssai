<?php

use App\Models\AichModel;
use App\Models\ModelAssignment;
use App\Models\PpvSet;
use App\Models\PpvSetSend;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['services.onlyfans.key' => 'test-key']);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
    $this->nina = AichModel::create(['name' => 'Nina', 'prompt' => 'You are Nina.', 'of_account_id' => 'acct_nina']);
    $this->url = "/onlyfans/{$this->model->id}/ppv-sets";
    $this->manager = User::factory()->manager()->create();
});

function ppvAssigned(string $creator): User
{
    $user = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $user->id, 'creator_model' => $creator]);

    return $user;
}

function ppvRow(string $creator, string $name, int $sort = 0, float $price = 20): PpvSet
{
    return PpvSet::create([
        'creator_model' => $creator,
        'name' => $name,
        'price' => $price,
        'media' => [['id' => 'v1', 'type' => 'photo', 'thumb' => 'https://cdn2.onlyfans.com/t.jpg']],
        'sort_order' => $sort,
    ]);
}

function ppvBody(array $over = []): array
{
    return array_merge([
        'name' => 'Red set',
        'caption' => 'a little something',
        'price' => 20,
        'media' => [
            ['id' => 'v1', 'type' => 'photo', 'thumb' => 'https://cdn2.onlyfans.com/files/t1.jpg?Signature=x'],
            ['id' => 'v2', 'type' => 'video', 'thumb' => 'https://cdn.fansapi.com/x/t2.jpg?X-Amz-Expires=900'],
        ],
    ], $over);
}

// ---- reads -------------------------------------------------------------------------------

it('lists sets for an assigned chatter in sort order', function () {
    ppvRow('Camila', 'Second', 2);
    ppvRow('Camila', 'First', 1);
    ppvRow('Nina', 'Other', 0);

    $this->actingAs(ppvAssigned('Camila'))
        ->getJson($this->url)
        ->assertOk()
        ->assertJsonPath('sets.0.name', 'First')
        ->assertJsonPath('sets.1.name', 'Second')
        ->assertJsonCount(2, 'sets')
        ->assertJsonPath('sets.0.price', 20)
        ->assertJsonPath('sets.0.media.0.thumb', 'https://cdn2.onlyfans.com/t.jpg')
        ->assertJsonPath('sets.0.sortOrder', 1);
});

it('refuses a chatter not assigned to the creator', function () {
    $this->actingAs(ppvAssigned('Nina'))->getJson($this->url)->assertForbidden();
});

it('returns per-fan send status grouped by set, newest first', function () {
    $a = ppvRow('Camila', 'A');
    $b = ppvRow('Camila', 'B');
    $this->actingAs($this->manager);
    PpvSetSend::create(['ppv_set_id' => $a->id, 'creator_model' => 'Camila', 'of_fan_id' => '101', 'of_message_id' => 'm1', 'price' => 20, 'sent_at' => now()->subDay()]);
    PpvSetSend::create(['ppv_set_id' => $a->id, 'creator_model' => 'Camila', 'of_fan_id' => '101', 'of_message_id' => 'm2', 'price' => 25, 'sent_at' => now()]);
    PpvSetSend::create(['ppv_set_id' => $a->id, 'creator_model' => 'Camila', 'of_fan_id' => '102', 'of_message_id' => 'm3', 'price' => 20, 'sent_at' => now()]);
    PpvSetSend::create(['ppv_set_id' => $b->id, 'creator_model' => 'Camila', 'of_fan_id' => '102', 'of_message_id' => 'm4', 'price' => 20, 'sent_at' => now()]);

    $this->actingAs(ppvAssigned('Camila'))
        ->getJson("/onlyfans/{$this->model->id}/chats/101/ppv-sets/status")
        ->assertOk()
        ->assertJsonCount(2, "status.{$a->id}")
        ->assertJsonPath("status.{$a->id}.0.messageId", 'm2')
        ->assertJsonPath("status.{$a->id}.0.price", 25)
        ->assertJsonMissingPath("status.{$b->id}");
});

// ---- writes (manager only) ---------------------------------------------------------------

it('lets a manager create a set and nulls a non-onlyfans thumb', function () {
    $this->actingAs($this->manager)
        ->postJson($this->url, ppvBody())
        ->assertCreated()
        ->assertJsonPath('set.name', 'Red set')
        ->assertJsonPath('set.price', 20)
        ->assertJsonPath('set.media.0.thumb', 'https://cdn2.onlyfans.com/files/t1.jpg?Signature=x')
        ->assertJsonPath('set.media.1.thumb', null)
        ->assertJsonPath('set.media.1.type', 'video');

    $row = PpvSet::sole();
    expect($row->creator_model)->toBe('Camila')
        ->and($row->created_by)->toBe($this->manager->id)
        ->and($row->sort_order)->toBe(0);
});

it('appends new sets after the existing ones', function () {
    ppvRow('Camila', 'Existing', 4);

    $this->actingAs($this->manager)->postJson($this->url, ppvBody())->assertCreated()->assertJsonPath('set.sortOrder', 5);
});

it('refuses a chatter creating a set', function () {
    $this->actingAs(ppvAssigned('Camila'))->postJson($this->url, ppvBody())->assertForbidden();
});

it('accepts free and 3..200 prices', function (float|int $price) {
    $this->actingAs($this->manager)->postJson($this->url, ppvBody(['price' => $price]))->assertCreated();
})->with([0, 3, 20.5, 200]);

it('rejects prices outside the vendor rule with a clear message', function (float $price) {
    $this->actingAs($this->manager)
        ->postJson($this->url, ppvBody(['price' => $price]))
        ->assertStatus(422)
        ->assertJsonPath('error', 'Price must be free, or between $3 and $200.');
})->with([2.99, 200.01, 1]);

it('rejects more than two decimals', function () {
    $this->actingAs($this->manager)->postJson($this->url, ppvBody(['price' => 19.999]))->assertStatus(422);
});

it('validates media count 1..40 and the type enum', function () {
    $this->actingAs($this->manager);

    $this->postJson($this->url, ppvBody(['media' => []]))->assertStatus(422);
    $this->postJson($this->url, ppvBody(['media' => array_fill(0, 41, ['id' => 'x', 'type' => 'photo'])]))->assertStatus(422);
    $this->postJson($this->url, ppvBody(['media' => [['id' => 'x', 'type' => 'doc']]]))->assertStatus(422);
    $this->postJson($this->url, ppvBody(['media' => array_fill(0, 40, ['id' => 'x', 'type' => 'gif'])]))->assertCreated();
});

it('updates name, caption and price without touching media when omitted', function () {
    $set = ppvRow('Camila', 'Old');

    $this->actingAs($this->manager)
        ->putJson("{$this->url}/{$set->id}", ['name' => 'New', 'caption' => 'hey', 'price' => 45])
        ->assertOk()
        ->assertJsonPath('set.name', 'New')
        ->assertJsonPath('set.caption', 'hey')
        ->assertJsonPath('set.price', 45)
        ->assertJsonPath('set.media.0.id', 'v1');
});

it("does not leak another creator's set on update or delete", function () {
    $set = ppvRow('Nina', 'Nina set');

    $this->actingAs($this->manager)->putJson("{$this->url}/{$set->id}", ['name' => 'X'])->assertNotFound();
    $this->actingAs($this->manager)->deleteJson("{$this->url}/{$set->id}")->assertNotFound();
});

it('deletes a set and its ledger rows', function () {
    $set = ppvRow('Camila', 'Gone');
    $this->actingAs($this->manager);
    PpvSetSend::create(['ppv_set_id' => $set->id, 'creator_model' => 'Camila', 'of_fan_id' => '101', 'price' => 20, 'sent_at' => now()]);

    $this->deleteJson("{$this->url}/{$set->id}")->assertOk()->assertJsonPath('ok', true);

    expect(PpvSet::withoutGlobalScopes()->count())->toBe(0)
        ->and(PpvSetSend::withoutGlobalScopes()->count())->toBe(0);
});

it('reorders by ids', function () {
    $a = ppvRow('Camila', 'A', 0);
    $b = ppvRow('Camila', 'B', 1);

    $this->actingAs($this->manager)
        ->putJson("{$this->url}/order", ['ids' => [$b->id, $a->id]])
        ->assertOk();

    expect($a->fresh()->sort_order)->toBe(1)->and($b->fresh()->sort_order)->toBe(0);
});
