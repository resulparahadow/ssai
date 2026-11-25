<?php

use App\Models\AichModel;
use App\Models\ModelAssignment;
use App\Models\Script;
use App\Models\ScriptStep;
use App\Models\ScriptStepSend;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;

uses(RefreshDatabase::class);

beforeEach(function () {
    config(['services.onlyfans.key' => 'test-key']);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
    $this->nina = AichModel::create(['name' => 'Nina', 'prompt' => 'You are Nina.', 'of_account_id' => 'acct_nina']);
    $this->base = "/onlyfans/{$this->model->id}";
    $this->url = "{$this->base}/scripts";
    $this->manager = User::factory()->manager()->create();
    $this->script = scriptRow('Camila', 'Main');
});

function scriptAssigned(string $creator): User
{
    $user = User::factory()->chatter()->create();
    ModelAssignment::create(['user_id' => $user->id, 'creator_model' => $creator]);

    return $user;
}

function scriptRow(string $creator, string $name, int $sort = 0): Script
{
    return Script::create(['creator_model' => $creator, 'name' => $name, 'sort_order' => $sort]);
}

function stepRow(Script $script, string $title, int $sort = 0, float $price = 20, ?array $media = null): ScriptStep
{
    return ScriptStep::create([
        'script_id' => $script->id,
        'creator_model' => $script->creator_model,
        'title' => $title,
        'price' => $price,
        'media' => $media ?? [['id' => 'v1', 'type' => 'photo', 'thumb' => 'https://cdn2.onlyfans.com/t.jpg']],
        'sort_order' => $sort,
    ]);
}

function stepBody(array $over = []): array
{
    return array_merge([
        'title' => 'Red set',
        'text' => 'a little something',
        'price' => 20,
        'media' => [
            ['id' => 'v1', 'type' => 'photo', 'thumb' => 'https://cdn2.onlyfans.com/files/t1.jpg?Signature=x'],
            ['id' => 'v2', 'type' => 'video', 'thumb' => 'https://cdn.fansapi.com/x/t2.jpg?X-Amz-Expires=900'],
        ],
    ], $over);
}

function ledger(?ScriptStep $step, string $fan, array $over = []): ScriptStepSend
{
    return ScriptStepSend::create(array_merge([
        'script_step_id' => $step?->id,
        'step_title' => $step?->title ?? 'Gone',
        'creator_model' => 'Camila',
        'of_fan_id' => $fan,
        'of_message_id' => 'm',
        'price' => 20,
        'sent_at' => now(),
    ], $over));
}

// ---- reads -------------------------------------------------------------------------------

it('lists scripts with their steps in order', function () {
    $b = scriptRow('Camila', 'Second', 1);
    stepRow($this->script, 'Two', 2);
    stepRow($this->script, 'One', 1);
    stepRow($b, 'Solo', 0, 0, []);
    scriptRow('Nina', 'Other');

    $this->actingAs(scriptAssigned('Camila'))
        ->getJson($this->url)
        ->assertOk()
        ->assertJsonCount(2, 'scripts')
        ->assertJsonPath('scripts.0.name', 'Main')
        ->assertJsonPath('scripts.0.sortOrder', 0)
        ->assertJsonPath('scripts.0.steps.0.title', 'One')
        ->assertJsonPath('scripts.0.steps.1.title', 'Two')
        ->assertJsonPath('scripts.0.steps.0.scriptId', $this->script->id)
        ->assertJsonPath('scripts.0.steps.0.kind', 'ppv')
        ->assertJsonPath('scripts.0.steps.0.price', 20)
        ->assertJsonPath('scripts.0.steps.0.media.0.thumb', 'https://cdn2.onlyfans.com/t.jpg')
        ->assertJsonPath('scripts.0.steps.0.sortOrder', 1)
        ->assertJsonPath('scripts.1.name', 'Second')
        ->assertJsonPath('scripts.1.steps.0.kind', 'text')
        ->assertJsonPath('scripts.1.steps.0.media', []);
});

it('refuses a chatter not assigned to the creator', function () {
    $this->actingAs(scriptAssigned('Nina'))->getJson($this->url)->assertForbidden();
});

it('returns per-fan send status grouped by step, newest first, skipping orphaned rows', function () {
    $a = stepRow($this->script, 'A');
    $b = stepRow($this->script, 'B');
    $this->actingAs($this->manager);
    ledger($a, '101', ['of_message_id' => 'm1', 'sent_at' => now()->subDay()]);
    ledger($a, '101', ['of_message_id' => 'm2', 'price' => 25]);
    ledger($a, '102', ['of_message_id' => 'm3']);
    ledger($b, '102', ['of_message_id' => 'm4']);
    ledger(null, '101', ['of_message_id' => 'orphan']);

    $this->actingAs(scriptAssigned('Camila'))
        ->getJson("{$this->base}/chats/101/scripts/status")
        ->assertOk()
        ->assertJsonCount(1, 'status')
        ->assertJsonCount(2, "status.{$a->id}")
        ->assertJsonPath("status.{$a->id}.0.messageId", 'm2')
        ->assertJsonPath("status.{$a->id}.0.price", 25)
        ->assertJsonPath("status.{$a->id}.0.source", 'send')
        ->assertJsonMissingPath("status.{$b->id}");
});

// ---- thumbs --------------------------------------------------------------------------------

it('serves a cached thumb to an assigned chatter and nothing to a stranger', function () {
    Storage::fake('local');
    Storage::disk('local')->put("ppv-thumbs/{$this->model->id}/v2", 'JPEGBYTES');

    $this->actingAs(scriptAssigned('Camila'))
        ->get("{$this->url}/thumb/v2")
        ->assertOk()
        ->assertHeader('Cache-Control', 'max-age=86400, private');

    $this->actingAs(scriptAssigned('Nina'))->get("{$this->url}/thumb/v2")->assertForbidden();
    $this->actingAs(scriptAssigned('Camila'))->get("{$this->url}/thumb/missing")->assertNotFound();
    // A slash never reaches the controller (the router rejects it); a dotted id does and is refused.
    $this->actingAs(scriptAssigned('Camila'))->get("{$this->url}/thumb/..%2Fsecret")->assertNotFound();
    $this->actingAs(scriptAssigned('Camila'))->get("{$this->url}/thumb/..")->assertStatus(400);
});

// ---- script writes (manager only) ------------------------------------------------------------

it('lets a manager create, rename, reorder and delete scripts', function () {
    $this->actingAs($this->manager);

    $id = $this->postJson($this->url, ['name' => '  Welcome  '])
        ->assertCreated()
        ->assertJsonPath('script.name', 'Welcome')
        ->assertJsonPath('script.sortOrder', 1)
        ->assertJsonPath('script.steps', [])
        ->json('script.id');

    expect(Script::withoutGlobalScopes()->find($id)->created_by)->toBe($this->manager->id);

    $this->putJson("{$this->url}/{$id}", ['name' => 'Renamed'])->assertOk()->assertJsonPath('script.name', 'Renamed');

    $this->putJson("{$this->url}/order", ['ids' => [$id, $this->script->id]])->assertOk();
    expect(Script::withoutGlobalScopes()->find($id)->sort_order)->toBe(0)
        ->and($this->script->fresh()->sort_order)->toBe(1);

    $this->deleteJson("{$this->url}/{$id}")->assertOk()->assertJsonPath('ok', true)->assertJsonPath('steps', 0);
    $this->postJson($this->url, ['name' => ''])->assertStatus(422);
});

it('registers order/steps routes above the wildcards', function () {
    $a = scriptRow('Camila', 'A', 0);
    $b = scriptRow('Camila', 'B', 1);
    $s1 = stepRow($a, 'One', 0);
    $s2 = stepRow($a, 'Two', 1);
    $this->actingAs($this->manager);

    // PUT scripts/order must hit reorder (an `update` would 404/422 on "order").
    $this->putJson("{$this->url}/order", ['ids' => [$b->id, $a->id]])->assertOk()->assertJsonPath('ok', true);
    expect($b->fresh()->sort_order)->toBe(0);

    $this->putJson("{$this->url}/{$a->id}/steps/order", ['ids' => [$s2->id, $s1->id]])->assertOk();
    expect($s2->fresh()->sort_order)->toBe(0)->and($s1->fresh()->sort_order)->toBe(1);

    // PUT scripts/steps/{step} must hit step update, not script update.
    $this->putJson("{$this->url}/steps/{$s1->id}", ['title' => 'Renamed'])->assertOk()->assertJsonPath('step.title', 'Renamed');
});

it('deleting a script keeps its send ledger', function () {
    $a = stepRow($this->script, 'A');
    $b = stepRow($this->script, 'B');
    $this->actingAs($this->manager);
    ledger($a, '101');
    ledger($b, '101');

    $this->deleteJson("{$this->url}/{$this->script->id}")->assertOk()->assertJsonPath('steps', 2);

    expect(ScriptStep::withoutGlobalScopes()->count())->toBe(0);
    $rows = ScriptStepSend::withoutGlobalScopes()->get();
    expect($rows)->toHaveCount(2)->and($rows->pluck('script_step_id')->filter()->all())->toBe([])
        ->and($rows->pluck('step_title')->sort()->values()->all())->toBe(['A', 'B']);

    $this->getJson("{$this->base}/chats/101/scripts/status")->assertOk()->assertJsonCount(0, 'status');
});

// ---- step writes (manager only) ----------------------------------------------------------------

it('lets a manager create a step, keeping an onlyfans thumb and caching a fansapi one locally', function () {
    Storage::fake('local');
    Http::fake(['cdn.fansapi.com/*' => Http::response('JPEGBYTES', 200, ['Content-Type' => 'image/jpeg'])]);

    $this->actingAs($this->manager)
        ->postJson("{$this->url}/{$this->script->id}/steps", stepBody(['fallbackName' => 'babe']))
        ->assertCreated()
        ->assertJsonPath('step.title', 'Red set')
        ->assertJsonPath('step.text', 'a little something')
        ->assertJsonPath('step.fallbackName', 'babe')
        ->assertJsonPath('step.scriptId', $this->script->id)
        ->assertJsonPath('step.price', 20)
        ->assertJsonPath('step.kind', 'ppv')
        ->assertJsonPath('step.media.0.thumb', 'https://cdn2.onlyfans.com/files/t1.jpg?Signature=x')
        ->assertJsonPath('step.media.1.thumb', "/onlyfans/{$this->model->id}/scripts/thumb/v2")
        ->assertJsonPath('step.media.1.type', 'video');

    Storage::disk('local')->assertExists("ppv-thumbs/{$this->model->id}/v2");

    $row = ScriptStep::sole();
    expect($row->creator_model)->toBe('Camila')
        ->and($row->created_by)->toBe($this->manager->id)
        ->and($row->sort_order)->toBe(0)
        ->and($row->media[1]['thumb'])->toBe('local');
});

it('stores a null thumb when the fansapi download fails, and never fetches other hosts', function () {
    Storage::fake('local');
    Http::fake(['cdn.fansapi.com/*' => Http::response('nope', 403)]);

    $this->actingAs($this->manager)
        ->postJson("{$this->url}/{$this->script->id}/steps", stepBody(['media' => [
            ['id' => 'v1', 'type' => 'photo', 'thumb' => 'https://cdn.fansapi.com/x/t1.jpg'],
            ['id' => 'v3', 'type' => 'photo', 'thumb' => 'https://evil.example.com/t3.jpg'],
        ]]))
        ->assertCreated()
        ->assertJsonPath('step.media.0.thumb', null)
        ->assertJsonPath('step.media.1.thumb', null);

    Http::assertSentCount(1);
    Http::assertNotSent(fn ($r) => str_contains($r->url(), 'evil.example.com'));
});

it('creates text-only and free steps', function () {
    $this->actingAs($this->manager);

    $this->postJson("{$this->url}/{$this->script->id}/steps", ['title' => 'Hi', 'text' => 'hey you', 'price' => 0, 'media' => []])
        ->assertCreated()->assertJsonPath('step.kind', 'text');
    $this->postJson("{$this->url}/{$this->script->id}/steps", stepBody(['price' => 0]))
        ->assertCreated()->assertJsonPath('step.kind', 'free');
});

it('appends new steps after the existing ones in that script', function () {
    stepRow($this->script, 'Existing', 4);
    $other = scriptRow('Camila', 'Other', 1);
    stepRow($other, 'Elsewhere', 9);

    $this->actingAs($this->manager)
        ->postJson("{$this->url}/{$this->script->id}/steps", stepBody())
        ->assertCreated()->assertJsonPath('step.sortOrder', 5);
});

it('refuses a chatter creating a step or script', function () {
    $this->actingAs(scriptAssigned('Camila'))->postJson("{$this->url}/{$this->script->id}/steps", stepBody())->assertForbidden();
    $this->actingAs(scriptAssigned('Camila'))->postJson($this->url, ['name' => 'X'])->assertForbidden();
});

it('accepts free and 3..200 prices', function (float|int $price) {
    $this->actingAs($this->manager)->postJson("{$this->url}/{$this->script->id}/steps", stepBody(['price' => $price]))->assertCreated();
})->with([0, 3, 20.5, 200]);

it('rejects prices outside the vendor rule with a clear message', function (float $price) {
    $this->actingAs($this->manager)
        ->postJson("{$this->url}/{$this->script->id}/steps", stepBody(['price' => $price]))
        ->assertStatus(422)
        ->assertJsonPath('error', 'Price must be free, or between $3 and $200.');
})->with([2.99, 200.01, 1]);

it('rejects more than two decimals', function () {
    $this->actingAs($this->manager)->postJson("{$this->url}/{$this->script->id}/steps", stepBody(['price' => 19.999]))->assertStatus(422);
});

it('rejects a step with neither text nor media', function () {
    $this->actingAs($this->manager)
        ->postJson("{$this->url}/{$this->script->id}/steps", ['title' => 'Empty', 'price' => 0, 'media' => []])
        ->assertStatus(422);
    $this->actingAs($this->manager)
        ->postJson("{$this->url}/{$this->script->id}/steps", ['title' => 'Blank', 'text' => '   ', 'price' => 0, 'media' => []])
        ->assertStatus(422);
});

it('rejects a price on a text step', function () {
    $this->actingAs($this->manager)
        ->postJson("{$this->url}/{$this->script->id}/steps", ['title' => 'Pay', 'text' => 'pay me', 'price' => 20, 'media' => []])
        ->assertStatus(422)
        ->assertJsonPath('error', 'A price needs media.');
});

it('validates media count 0..40 and the type enum', function () {
    $this->actingAs($this->manager);
    $u = "{$this->url}/{$this->script->id}/steps";

    $this->postJson($u, stepBody(['media' => array_fill(0, 41, ['id' => 'x', 'type' => 'photo'])]))->assertStatus(422);
    $this->postJson($u, stepBody(['media' => [['id' => 'x', 'type' => 'doc']]]))->assertStatus(422);
    $this->postJson($u, stepBody(['media' => array_fill(0, 40, ['id' => 'x', 'type' => 'gif'])]))->assertCreated();
});

it('updates title, text and price without touching media when omitted', function () {
    $step = stepRow($this->script, 'Old');

    $this->actingAs($this->manager)
        ->putJson("{$this->url}/steps/{$step->id}", ['title' => 'New', 'text' => 'hey', 'price' => 45])
        ->assertOk()
        ->assertJsonPath('step.title', 'New')
        ->assertJsonPath('step.text', 'hey')
        ->assertJsonPath('step.price', 45)
        ->assertJsonPath('step.media.0.id', 'v1');
});

it('validates the merged step on update (clearing media under a price is refused)', function () {
    $step = stepRow($this->script, 'Priced');

    // No text and no media left: refused.
    $this->actingAs($this->manager)
        ->putJson("{$this->url}/steps/{$step->id}", ['media' => []])
        ->assertStatus(422);

    $step->update(['text' => 'has words']);
    $this->putJson("{$this->url}/steps/{$step->id}", ['media' => []])
        ->assertStatus(422)
        ->assertJsonPath('error', 'A price needs media.');
    $this->putJson("{$this->url}/steps/{$step->id}", ['media' => [], 'price' => 0])
        ->assertOk()->assertJsonPath('step.kind', 'text');
});

it('moves a step to another script of the same creator, appending it', function () {
    $other = scriptRow('Camila', 'Other', 1);
    stepRow($other, 'Existing', 3);
    $step = stepRow($this->script, 'Mover');

    $this->actingAs($this->manager)
        ->putJson("{$this->url}/steps/{$step->id}", ['scriptId' => $other->id])
        ->assertOk()
        ->assertJsonPath('step.scriptId', $other->id)
        ->assertJsonPath('step.sortOrder', 4);
});

it('refuses another creator\'s script, step and target script', function () {
    $ninaScript = scriptRow('Nina', 'Nina script');
    $ninaStep = stepRow($ninaScript, 'Nina step');
    $mine = stepRow($this->script, 'Mine');
    $this->actingAs($this->manager);

    $this->putJson("{$this->url}/{$ninaScript->id}", ['name' => 'X'])->assertNotFound();
    $this->deleteJson("{$this->url}/{$ninaScript->id}")->assertNotFound();
    $this->postJson("{$this->url}/{$ninaScript->id}/steps", stepBody())->assertNotFound();
    $this->putJson("{$this->url}/steps/{$ninaStep->id}", ['title' => 'X'])->assertNotFound();
    $this->deleteJson("{$this->url}/steps/{$ninaStep->id}")->assertNotFound();
    $this->putJson("{$this->url}/steps/{$mine->id}", ['scriptId' => $ninaScript->id])->assertStatus(422);
    expect($mine->fresh()->script_id)->toBe($this->script->id);

    // Marks are pinned too.
    $this->postJson("{$this->base}/chats/101/scripts/steps/{$ninaStep->id}/mark")->assertNotFound();
});

it('deletes a step but keeps its ledger rows', function () {
    $step = stepRow($this->script, 'Gone');
    $this->actingAs($this->manager);
    ledger($step, '101');

    $this->deleteJson("{$this->url}/steps/{$step->id}")->assertOk()->assertJsonPath('ok', true);

    expect(ScriptStep::withoutGlobalScopes()->count())->toBe(0)
        ->and(ScriptStepSend::withoutGlobalScopes()->sole()->script_step_id)->toBeNull();
});

it('reorders steps by ids, ignoring other scripts', function () {
    $a = stepRow($this->script, 'A', 0);
    $b = stepRow($this->script, 'B', 1);
    $foreign = stepRow(scriptRow('Camila', 'Else', 1), 'F', 7);

    $this->actingAs($this->manager)
        ->putJson("{$this->url}/{$this->script->id}/steps/order", ['ids' => [$b->id, $a->id, $foreign->id]])
        ->assertOk();

    expect($a->fresh()->sort_order)->toBe(1)->and($b->fresh()->sort_order)->toBe(0)->and($foreign->fresh()->sort_order)->toBe(7);
});

it('replaces media on update, keeping an already-cached thumb without re-fetching it', function () {
    Storage::fake('local');
    Http::fake();
    Storage::disk('local')->put("ppv-thumbs/{$this->model->id}/v2", 'JPEGBYTES');
    $step = stepRow($this->script, 'Edit me', 0, 20, [['id' => 'v2', 'type' => 'video', 'thumb' => 'local']]);

    $this->actingAs($this->manager)
        ->putJson("{$this->url}/steps/{$step->id}", ['media' => [
            // Re-sent exactly as the client received it from present(): our own thumb route.
            ['id' => 'v2', 'type' => 'video', 'thumb' => "/onlyfans/{$this->model->id}/scripts/thumb/v2"],
            // A tab from before the rename may still send the old route: also already-local.
            ['id' => 'v2', 'type' => 'video', 'thumb' => "/onlyfans/{$this->model->id}/ppv-sets/thumb/v2"],
            // A newly picked item whose thumb is onlyfans-hosted.
            ['id' => 'v9', 'type' => 'photo', 'thumb' => 'https://cdn2.onlyfans.com/files/t9.jpg'],
            // A 'local' claim with no file behind it must not survive.
            ['id' => 'v7', 'type' => 'photo', 'thumb' => 'local'],
        ]])
        ->assertOk()
        ->assertJsonCount(4, 'step.media')
        ->assertJsonPath('step.media.0.thumb', "/onlyfans/{$this->model->id}/scripts/thumb/v2")
        ->assertJsonPath('step.media.1.thumb', "/onlyfans/{$this->model->id}/scripts/thumb/v2")
        ->assertJsonPath('step.media.2.thumb', 'https://cdn2.onlyfans.com/files/t9.jpg')
        ->assertJsonPath('step.media.3.thumb', null);

    Http::assertNothingSent();
    expect($step->fresh()->media[0]['thumb'])->toBe('local');
});

// ---- manual marks ------------------------------------------------------------------------------

it('lets a chatter mark and unmark a step, never removing a real send', function () {
    $step = stepRow($this->script, 'Intro');
    $chatter = scriptAssigned('Camila');
    $mark = "{$this->base}/chats/101/scripts/steps/{$step->id}/mark";
    $this->actingAs($chatter);
    ledger($step, '101', ['of_message_id' => 'real']);

    $this->postJson($mark)->assertCreated();
    $this->postJson($mark)->assertOk(); // idempotent: no duplicate

    $manual = ScriptStepSend::withoutGlobalScopes()->where('source', 'manual')->get();
    expect($manual)->toHaveCount(1)
        ->and($manual[0]->step_title)->toBe('Intro')
        ->and($manual[0]->of_fan_id)->toBe('101')
        ->and($manual[0]->user_id)->toBe($chatter->id)
        ->and($manual[0]->sent_at)->not->toBeNull();

    $this->getJson("{$this->base}/chats/101/scripts/status")
        ->assertJsonCount(2, "status.{$step->id}");

    $this->deleteJson($mark)->assertOk()->assertJsonPath('ok', true);

    $left = ScriptStepSend::withoutGlobalScopes()->get();
    expect($left)->toHaveCount(1)->and($left[0]->source)->toBe('send');

    // A different fan's mark is untouched.
    $this->postJson("{$this->base}/chats/102/scripts/steps/{$step->id}/mark")->assertCreated();
    $this->deleteJson($mark)->assertOk();
    expect(ScriptStepSend::withoutGlobalScopes()->where('source', 'manual')->where('of_fan_id', '102')->count())->toBe(1);
});

it('gates writes to managers but allows chatters to mark', function () {
    $step = stepRow($this->script, 'Intro');
    $chatter = scriptAssigned('Camila');
    $this->actingAs($chatter);

    $this->putJson("{$this->url}/steps/{$step->id}", ['title' => 'X'])->assertForbidden();
    $this->deleteJson("{$this->url}/steps/{$step->id}")->assertForbidden();
    $this->putJson("{$this->url}/order", ['ids' => [1]])->assertForbidden();
    $this->putJson("{$this->url}/{$this->script->id}", ['name' => 'X'])->assertForbidden();
    $this->deleteJson("{$this->url}/{$this->script->id}")->assertForbidden();
    $this->postJson("{$this->base}/chats/101/scripts/steps/{$step->id}/mark")->assertCreated();

    // Not assigned: no marking either.
    $this->actingAs(scriptAssigned('Nina'))
        ->postJson("{$this->base}/chats/101/scripts/steps/{$step->id}/mark")->assertForbidden();
});
