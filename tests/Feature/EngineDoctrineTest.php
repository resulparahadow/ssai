<?php

use App\Models\AichModel;
use App\Services\Doctrine\DoctrineService;
use App\Services\Engine\EngineClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

function liveModel(): AichModel
{
    $model = new AichModel;
    $model->name = 'Nova';
    $model->prompt = 'persona';

    return $model;
}

it('sends the active doctrine override to the engine generate call', function () {
    Http::fake(['*/generate' => Http::response(['draft' => 'ok'])]);
    app(DoctrineService::class)->saveCustom('MY CUSTOM DOCTRINE');

    app(EngineClient::class)->generateFromLive(liveModel(), [['sender' => 'customer', 'text' => 'hey']], ['id' => '1', 'name' => 'Fan']);

    Http::assertSent(fn ($req) => str_ends_with($req->url(), '/generate')
        && ($req->data()['doctrine'] ?? null) === 'MY CUSTOM DOCTRINE');
});

it('omits the doctrine key when no override is active', function () {
    Http::fake(['*/generate' => Http::response(['draft' => 'ok'])]);

    app(EngineClient::class)->generateFromLive(liveModel(), [['sender' => 'customer', 'text' => 'hey']], ['id' => '1']);

    Http::assertSent(fn ($req) => str_ends_with($req->url(), '/generate')
        && ! array_key_exists('doctrine', $req->data()));
});

it('fetches the canonical default doctrine from the engine', function () {
    Http::fake(['*/doctrine' => Http::response([
        'ok' => true, 'version' => 'v0.4.5.1', 'sha256' => 'deadbeef', 'len' => 5, 'prompt' => 'CANON',
    ])]);

    $doctrine = app(EngineClient::class)->defaultDoctrine();

    expect($doctrine['version'])->toBe('v0.4.5.1')
        ->and($doctrine['sha256'])->toBe('deadbeef')
        ->and($doctrine['prompt'])->toBe('CANON');
});
