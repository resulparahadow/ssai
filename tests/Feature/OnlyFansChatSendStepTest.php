<?php

use App\Models\AichModel;
use App\Models\Script;
use App\Models\ScriptStep;
use App\Models\ScriptStepSend;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;

uses(RefreshDatabase::class);

beforeEach(function () {
    config([
        'services.onlyfans.key' => 'test-key',
        'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api',
    ]);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
    $this->url = "/onlyfans/{$this->model->id}/chats/101/messages";
    $this->admin = User::factory()->admin()->create();
    $script = Script::create(['creator_model' => 'Camila', 'name' => 'Main']);
    $this->set = ScriptStep::create([
        'script_id' => $script->id, 'creator_model' => 'Camila', 'title' => 'Red set', 'price' => 20,
        'media' => [['id' => 'v1', 'type' => 'photo', 'thumb' => null], ['id' => 'v2', 'type' => 'video', 'thumb' => null]],
    ]);
});

function fakeSendOk(): void
{
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => [
        'id' => 560, 'text' => 'open me', 'price' => 20, 'isFree' => false, 'isOpened' => false, 'fromUser' => ['id' => 999],
    ]])]);
}

it('sends price and vault ids as a PPV', function () {
    fakeSendOk();

    $this->actingAs($this->admin)
        ->postJson($this->url, ['text' => 'open me', 'mediaFiles' => ['v1', 'v2'], 'price' => 20])
        ->assertOk()
        ->assertJsonPath('message.price', 20)
        ->assertJsonPath('message.isFree', false);

    Http::assertSent(fn ($r) => $r->method() === 'POST'
        && str_contains($r->url(), '/acct_cam/chats/101/messages')
        && $r['mediaFiles'] === ['v1', 'v2']
        && (float) $r['price'] === 20.0);
});

it('accepts up to 40 media ids', function () {
    fakeSendOk();
    $ids = array_map(fn ($i) => "v{$i}", range(1, 40));

    $this->actingAs($this->admin)->postJson($this->url, ['mediaFiles' => $ids, 'price' => 20])->assertOk();
    $this->actingAs($this->admin)->postJson($this->url, ['mediaFiles' => [...$ids, 'v41'], 'price' => 20])->assertStatus(422);
});

it('omits price from the vendor body when 0', function () {
    fakeSendOk();

    $this->actingAs($this->admin)->postJson($this->url, ['mediaFiles' => ['v1'], 'price' => 0])->assertOk();

    Http::assertSent(fn ($r) => ! array_key_exists('price', $r->data()) && $r['mediaFiles'] === ['v1']);
});

it('rejects an out-of-rule price before calling the vendor', function (float $price) {
    Http::fake();

    $this->actingAs($this->admin)
        ->postJson($this->url, ['mediaFiles' => ['v1'], 'price' => $price])
        ->assertStatus(422);

    Http::assertNothingSent();
})->with([2.99, 200.01, 19.999]);

it('rejects a price without media', function () {
    Http::fake();

    $this->actingAs($this->admin)
        ->postJson($this->url, ['text' => 'pay me', 'price' => 20])
        ->assertStatus(422)
        ->assertJsonPath('error', 'A price needs media attached.');

    $this->actingAs($this->admin)
        ->postJson($this->url, ['giphyId' => 'g1', 'price' => 20])
        ->assertStatus(422);

    Http::assertNothingSent();
});

it('writes a ledger row with the vendor message id on success', function () {
    fakeSendOk();

    $this->actingAs($this->admin)
        ->postJson($this->url, ['text' => 'open me', 'mediaFiles' => ['v1', 'v2'], 'price' => 20, 'scriptStepId' => $this->set->id])
        ->assertOk();

    $row = ScriptStepSend::withoutGlobalScopes()->sole();
    expect($row->script_step_id)->toBe($this->set->id)
        ->and($row->creator_model)->toBe('Camila')
        ->and($row->of_fan_id)->toBe('101')
        ->and($row->of_message_id)->toBe('560')
        ->and($row->step_title)->toBe('Red set')
        ->and($row->source)->toBe('send')
        ->and((float) $row->price)->toBe(20.0)
        ->and($row->user_id)->toBe($this->admin->id)
        ->and($row->sent_at)->not->toBeNull();
});

it('writes no ledger row without a scriptStepId', function () {
    fakeSendOk();

    $this->actingAs($this->admin)->postJson($this->url, ['mediaFiles' => ['v1'], 'price' => 20])->assertOk();

    expect(ScriptStepSend::withoutGlobalScopes()->count())->toBe(0);
});

it('rejects a scriptStepId of another creator before calling the vendor', function () {
    Http::fake();
    $nina = AichModel::create(['name' => 'Nina', 'prompt' => 'x', 'of_account_id' => 'acct_nina']);
    $ninaScript = Script::create(['creator_model' => 'Nina', 'name' => 'N script']);
    $other = ScriptStep::create(['script_id' => $ninaScript->id, 'creator_model' => 'Nina', 'title' => 'N', 'price' => 20, 'media' => [['id' => 'n1', 'type' => 'photo', 'thumb' => null]]]);

    $this->actingAs($this->admin)
        ->postJson($this->url, ['mediaFiles' => ['n1'], 'price' => 20, 'scriptStepId' => $other->id])
        ->assertStatus(422)
        ->assertJsonPath('error', 'Script step not found for this creator.');

    Http::assertNothingSent();
});

it('does not write a ledger row when the vendor fails, and forwards its message', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['error' => 'MEDIA_NOT_FOUND', 'message' => 'Media not found'], 422)]);

    $this->actingAs($this->admin)
        ->postJson($this->url, ['mediaFiles' => ['gone'], 'price' => 20, 'scriptStepId' => $this->set->id])
        ->assertStatus(422)
        // forward() passes the vendor body through verbatim; the client shows `message`.
        ->assertJsonPath('message', 'Media not found')
        ->assertJsonPath('error', 'MEDIA_NOT_FOUND');

    expect(ScriptStepSend::withoutGlobalScopes()->count())->toBe(0);
});

it('still sends when the ledger insert throws', function () {
    fakeSendOk();
    Schema::drop('script_step_sends');

    $this->actingAs($this->admin)
        ->postJson($this->url, ['mediaFiles' => ['v1'], 'price' => 20, 'scriptStepId' => $this->set->id])
        ->assertOk()
        ->assertJsonPath('message.from', 'creator');
});

it('records a text step send with no media or price', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => [
        'id' => 561, 'text' => 'hey you', 'price' => 0, 'isFree' => true, 'isOpened' => false, 'fromUser' => ['id' => 999],
    ]])]);
    $textStep = ScriptStep::create([
        'script_id' => $this->set->script_id, 'creator_model' => 'Camila', 'title' => 'Opener',
        'text' => 'hey you', 'price' => 0, 'media' => [],
    ]);

    $this->actingAs($this->admin)
        ->postJson($this->url, ['text' => 'hey you', 'scriptStepId' => $textStep->id])
        ->assertOk();

    Http::assertSent(fn ($r) => $r->method() === 'POST' && ! array_key_exists('mediaFiles', $r->data()) && ! array_key_exists('price', $r->data()));

    $row = ScriptStepSend::withoutGlobalScopes()->sole();
    expect($row->script_step_id)->toBe($textStep->id)
        ->and($row->step_title)->toBe('Opener')
        ->and($row->of_message_id)->toBe('561')
        ->and((float) $row->price)->toBe(0.0)
        ->and($row->source)->toBe('send');
});

it('refuses a step that still needs media, before any vendor call', function () {
    Http::fake();
    $this->set->update(['needs_media' => true, 'media' => []]);

    $this->actingAs($this->admin)
        ->postJson($this->url, ['text' => 'hi', 'scriptStepId' => $this->set->id])
        ->assertStatus(422)
        ->assertJsonPath('error', 'This step needs media before it can be sent.');

    Http::assertNothingSent();
});
