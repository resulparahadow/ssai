<?php

use App\Models\User;
use App\Services\Integrations\ChatProvider;
use App\Services\OnlyFans\OnlyFansService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

beforeEach(function () {
    Cache::flush();
    config([
        'services.chat_provider' => 'onlyfansapi',
        'services.onlyfans.key' => 'of-key',
        'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api',
        'services.oopcrm.key' => 'oop-key',
        'services.oopcrm.base_url' => 'https://app.oopcrm.com/api/v1/ofapi',
    ]);
});

it('defaults to OnlyFansAPI', function () {
    Http::fake(['*' => Http::response(['data' => []])]);

    app(OnlyFansService::class)->listChats('acct_1');

    Http::assertSent(fn ($r) => str_starts_with($r->url(), 'https://app.onlyfansapi.com/api/acct_1/chats')
        && $r->hasHeader('Authorization', 'Bearer of-key'));
});

it('routes every call through OopCRM once switched, and back again', function () {
    Http::fake(['*' => Http::response(['data' => []])]);
    $providers = app(ChatProvider::class);

    $providers->set(ChatProvider::OOPCRM);
    app(OnlyFansService::class)->listChats('acct_1');
    Http::assertSent(fn ($r) => str_starts_with($r->url(), 'https://app.oopcrm.com/api/v1/ofapi/acct_1/chats')
        && $r->hasHeader('Authorization', 'Bearer oop-key'));

    $providers->set(ChatProvider::ONLYFANSAPI);
    expect($providers->active())->toBe('onlyfansapi');
});

it('lets only admins open and change the setting', function () {
    $this->actingAs(User::factory()->manager()->create())->get('/settings/integrations')->assertForbidden();
    $this->put('/settings/integrations', ['provider' => 'oopcrm'])->assertForbidden();

    $admin = User::factory()->admin()->create();
    $this->actingAs($admin)->get('/settings/integrations')->assertOk()
        ->assertInertia(fn ($page) => $page->component('settings/Integrations')
            ->where('active', 'onlyfansapi')
            ->has('providers', 2));

    $this->put('/settings/integrations', ['provider' => 'oopcrm'])->assertRedirect('/settings/integrations');
    expect(app(ChatProvider::class)->active())->toBe('oopcrm');
});

it('refuses a provider with no key or an unknown one', function () {
    config(['services.oopcrm.key' => '']);
    $this->actingAs(User::factory()->admin()->create());

    $this->put('/settings/integrations', ['provider' => 'oopcrm'])->assertSessionHasErrors('provider');
    $this->put('/settings/integrations', ['provider' => 'nope'])->assertSessionHasErrors('provider');
    expect(app(ChatProvider::class)->active())->toBe('onlyfansapi');
});

it('tests a connection without switching', function () {
    Http::fake(['https://app.oopcrm.com/*' => Http::response([['id' => 'acct_a'], ['id' => 'acct_b']])]);
    $this->actingAs(User::factory()->admin()->create());

    $this->post('/settings/integrations/test', ['provider' => 'oopcrm'])->assertRedirect();

    Http::assertSent(fn ($r) => $r->url() === 'https://app.oopcrm.com/api/v1/ofapi/accounts');
    expect(app(ChatProvider::class)->active())->toBe('onlyfansapi');
});
