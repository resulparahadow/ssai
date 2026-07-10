<?php

use App\Models\Doctrine;
use App\Models\User;
use App\Services\Doctrine\DoctrineService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

/** 6000+ words with all 10 required markers. */
function bigDoctrine(): string
{
    $markers = [
        'UNDERLYING FRAMEWORK', 'IDENTIFYING CUSTOMERS', 'CHAT SKELETON', 'PROMISE RITUAL',
        'POSTURE SYSTEM', 'OBJECTION HANDLING', 'GOODBYE FRAMEWORK', 'AFTERCARE', 'TOS', 'HARD RULES',
    ];

    return implode("\n", $markers)."\n".str_repeat('lorem ', 6000);
}

function fakeEngineDoctrine(): void
{
    Http::fake(['*/doctrine' => Http::response([
        'ok' => true, 'version' => 'v0.4.5.1', 'sha256' => str_repeat('a', 64), 'len' => 42, 'prompt' => 'CANONICAL DEFAULT',
    ])]);
}

it('forbids non-admins from the global training page', function () {
    fakeEngineDoctrine();

    $this->actingAs(User::factory()->manager()->create())->get('/settings/global-training')->assertForbidden();
    $this->actingAs(User::factory()->chatter()->create())->get('/settings/global-training')->assertForbidden();
});

it('shows the engine default to an admin when no override is saved', function () {
    fakeEngineDoctrine();

    $this->actingAs(User::factory()->admin()->create())
        ->get('/settings/global-training')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('settings/GlobalTraining')
            ->where('isDefault', true)
            ->where('content', 'CANONICAL DEFAULT')
            ->where('version', 'v0.4.5.1'));
});

it('saves a valid doctrine as a new active override', function () {
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->put('/settings/global-training', ['content' => bigDoctrine()])
        ->assertRedirect();

    $active = Doctrine::query()->where('is_active', true)->first();
    expect($active)->not->toBeNull()
        ->and($active->version)->toBe('custom')
        ->and($active->sha256)->toBe(hash('sha256', $active->prompt)); // sha is of the stored (trimmed) body
});

it('rejects a broken doctrine without force', function () {
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->put('/settings/global-training', ['content' => 'too short, missing markers'])
        ->assertSessionHasErrors('content');

    expect(Doctrine::query()->count())->toBe(0);
});

it('saves a broken doctrine when force is set', function () {
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->put('/settings/global-training', ['content' => 'deliberately broken', 'force' => true])
        ->assertRedirect();

    expect(Doctrine::query()->where('is_active', true)->count())->toBe(1);
});

it('resets to default by deactivating the active override', function () {
    fakeEngineDoctrine();
    $admin = User::factory()->admin()->create();
    app(DoctrineService::class)->saveCustom(bigDoctrine());

    $this->actingAs($admin)->post('/settings/global-training/reset')->assertRedirect();

    expect(Doctrine::query()->where('is_active', true)->count())->toBe(0);
});
