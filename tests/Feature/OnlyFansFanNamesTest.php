<?php

use App\Models\AichModel;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

/**
 * Script text can say {Fan Name} (the real OnlyFans name) or {Custom Name} (the team's
 * rename, which OnlyFans returns in `displayName`), so both ride along beside the merged `name`.
 */
beforeEach(function () {
    config(['services.onlyfans.key' => 'test-key', 'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api']);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
    $this->admin = User::factory()->admin()->create();
});

it('exposes the real name and the custom name separately', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [
            ['withUser' => ['id' => 1, 'name' => 'Jake', 'displayName' => 'Big Spender', 'username' => 'jake'], 'lastMessage' => ['text' => 'hi']],
            ['withUser' => ['id' => 2, 'name' => 'Mia', 'displayName' => '', 'username' => 'mia'], 'lastMessage' => ['text' => 'hi']],
        ],
    ])]);

    $rows = test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/chats")
        ->assertOk()->json('chats');

    expect($rows[0])->toMatchArray(['name' => 'Big Spender', 'fanName' => 'Jake', 'customName' => 'Big Spender'])
        ->and($rows[1])->toMatchArray(['name' => 'Mia', 'fanName' => 'Mia', 'customName' => '']);
});

it('exposes both names on the fan detail', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => ['id' => 1, 'name' => 'Jake', 'displayName' => 'Big Spender', 'username' => 'jake'],
    ])]);

    test()->actingAs($this->admin)
        ->getJson("/onlyfans/{$this->model->id}/users/1")
        ->assertOk()
        ->assertJsonPath('fan.name', 'Big Spender')
        ->assertJsonPath('fan.fanName', 'Jake')
        ->assertJsonPath('fan.customName', 'Big Spender');
});
