<?php

use App\Models\AichMessageTag;
use App\Models\AichModel;
use App\Models\ModelAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'p', 'of_account_id' => 'acct_cam']);
    $this->other = AichModel::create(['name' => 'Bella', 'prompt' => 'p', 'of_account_id' => 'acct_bel']);
    $this->base = "/onlyfans/{$this->model->id}/chats/101";
});

function tagTestChatter(string $creator): User
{
    $user = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $user->id, 'creator_model' => $creator]);

    return $user;
}

it('stores, replaces and clears a tag', function () {
    $this->actingAs(User::factory()->admin()->create());

    $this->putJson("{$this->base}/messages/m1/tag", ['tag' => 'mppv'])->assertOk()->assertJson(['tag' => 'mppv']);
    $this->putJson("{$this->base}/messages/m1/tag", ['tag' => 'free_preview'])->assertOk();
    $this->getJson("{$this->base}/tags")->assertOk()->assertExactJson(['tags' => ['m1' => 'free_preview']]);
    expect(AichMessageTag::withoutGlobalScopes()->count())->toBe(1);

    $this->deleteJson("{$this->base}/messages/m1/tag")->assertNoContent();
    $this->getJson("{$this->base}/tags")->assertOk()->assertExactJson(['tags' => []]);
});

it('re-stamps the acting user on update', function () {
    $a = User::factory()->admin()->create();
    $b = User::factory()->admin()->create();
    $this->actingAs($a)->putJson("{$this->base}/messages/m1/tag", ['tag' => 'mppv'])->assertOk();
    $this->actingAs($b)->putJson("{$this->base}/messages/m1/tag", ['tag' => 'chat_ppv'])->assertOk();

    expect(AichMessageTag::withoutGlobalScopes()->first()->user_id)->toBe($b->id);
});

it('rejects an unknown tag', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->putJson("{$this->base}/messages/m1/tag", ['tag' => 'bogus'])
        ->assertStatus(422)->assertJsonStructure(['error', 'errors' => ['tag']]);
});

it('scopes tags to the chat and creator', function () {
    $this->actingAs(User::factory()->admin()->create());
    $this->putJson("{$this->base}/messages/m1/tag", ['tag' => 'mppv'])->assertOk();

    $this->getJson("/onlyfans/{$this->model->id}/chats/102/tags")->assertExactJson(['tags' => []]);
    $this->getJson("/onlyfans/{$this->other->id}/chats/101/tags")->assertExactJson(['tags' => []]);
    expect(AichMessageTag::forChat('Camila', '101'))->toBe(['m1' => 'mppv']);
});

it('forbids a chatter not assigned to the creator', function () {
    $this->actingAs(tagTestChatter('Bella'));

    $this->getJson("{$this->base}/tags")->assertForbidden();
    $this->putJson("{$this->base}/messages/m1/tag", ['tag' => 'mppv'])->assertForbidden();
    $this->deleteJson("{$this->base}/messages/m1/tag")->assertForbidden();
});

it('lets an assigned chatter tag', function () {
    $this->actingAs(tagTestChatter('Camila'));

    $this->putJson("{$this->base}/messages/m1/tag", ['tag' => 'chat_ppv'])->assertOk();
    $this->getJson("{$this->base}/tags")->assertOk()->assertJson(['tags' => ['m1' => 'chat_ppv']]);
});
