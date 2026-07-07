<?php

use App\Models\AichModel;
use App\Models\ModelAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia;

uses(RefreshDatabase::class);

it('lets a manager list models', function () {
    AichModel::create(['name' => 'Camila']);

    $this->actingAs(User::factory()->manager()->create())
        ->get('/models')
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $p) => $p->component('Models')->has('models', 1)->has('chatters'));
});

it('forbids chatters from the models section', function () {
    $this->actingAs(User::factory()->chatter()->create())
        ->get('/models')
        ->assertForbidden();
});

it('lets a manager create, update, assign, and delete a model', function () {
    $manager = User::factory()->manager()->create();
    $chatter = User::factory()->chatter()->create();
    $this->actingAs($manager);

    $this->post('/models', ['name' => 'Nova', 'tier' => 'A', 'prompt' => 'p'])->assertRedirect();
    $model = AichModel::where('name', 'Nova')->firstOrFail();

    $this->put("/models/{$model->id}", [
        'name' => 'Nova', 'tier' => 'B', 'prompt' => 'p2',
        'content_library' => 'lib text', 'feedback_rules' => 'rule', 'of_account_id' => 'acct_1',
    ])->assertRedirect();

    expect($model->fresh()->tier)->toBe('B')
        ->and($model->fresh()->content_library)->toBe('lib text');

    $this->put("/models/{$model->id}/assignments", ['user_ids' => [$chatter->id]])->assertRedirect();
    expect(ModelAssignment::where('creator_model', 'Nova')->where('user_id', $chatter->id)->exists())->toBeTrue();

    $this->delete("/models/{$model->id}")->assertRedirect();
    expect(AichModel::find($model->id))->toBeNull()
        ->and(ModelAssignment::where('creator_model', 'Nova')->exists())->toBeFalse();
});
