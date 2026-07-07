<?php

use App\Models\AichModel;
use App\Models\ModelAssignment;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

// ---- access ----------------------------------------------------------------

it('forbids chatters from the team section', function () {
    $this->actingAs(User::factory()->chatter()->create())
        ->get('/team')
        ->assertForbidden();
});

it('lets managers and admins view every user', function () {
    User::factory()->admin()->create();
    User::factory()->manager()->create();
    User::factory()->chatter()->count(2)->create();

    // 4 created above + the acting manager = 5
    $this->actingAs(User::factory()->manager()->create())
        ->get('/team')
        ->assertOk()
        ->assertInertia(fn ($p) => $p->component('Team')->has('users', 5));
});

// ---- create rules ----------------------------------------------------------

it('lets a manager create a chatter but not a manager or admin', function () {
    $this->actingAs(User::factory()->manager()->create());

    $this->post('/team', [
        'name' => 'Mia',
        'email' => 'mia@test.com',
        'password' => 'secret-password',
        'password_confirmation' => 'secret-password',
        'role' => 'chatter',
    ])->assertRedirect();

    expect(User::where('email', 'mia@test.com')->first()->role->value)->toBe('chatter');

    foreach (['manager', 'admin'] as $role) {
        $this->post('/team', [
            'name' => 'Nope',
            'email' => "nope-{$role}@test.com",
            'password' => 'secret-password',
            'password_confirmation' => 'secret-password',
            'role' => $role,
        ])->assertSessionHasErrors('role');

        expect(User::where('email', "nope-{$role}@test.com")->exists())->toBeFalse();
    }
});

it('lets an admin create any role', function () {
    $this->actingAs(User::factory()->admin()->create());

    foreach (['admin', 'manager', 'chatter'] as $role) {
        $this->post('/team', [
            'name' => "User {$role}",
            'email' => "{$role}@test.com",
            'password' => 'secret-password',
            'password_confirmation' => 'secret-password',
            'role' => $role,
        ])->assertRedirect();

        expect(User::where('email', "{$role}@test.com")->first()->role->value)->toBe($role);
    }
});

it('flags admin-created users to change their password and verifies them', function () {
    $this->actingAs(User::factory()->admin()->create());

    $this->post('/team', [
        'name' => 'Temp',
        'email' => 'temp@test.com',
        'password' => 'secret-password',
        'password_confirmation' => 'secret-password',
        'role' => 'chatter',
        'must_change_password' => true,
    ])->assertRedirect();

    $created = User::where('email', 'temp@test.com')->firstOrFail();
    expect($created->must_change_password)->toBeTrue()
        ->and($created->email_verified_at)->not->toBeNull();
});

// ---- edit / delete rules ---------------------------------------------------

it('lets a manager edit and delete chatters only', function () {
    $manager = User::factory()->manager()->create();
    $chatter = User::factory()->chatter()->create();
    $otherManager = User::factory()->manager()->create();
    $admin = User::factory()->admin()->create();
    $this->actingAs($manager);

    // chatter: allowed
    $this->put("/team/{$chatter->id}", [
        'name' => 'Renamed',
        'email' => $chatter->email,
        'role' => 'chatter',
    ])->assertRedirect();
    expect($chatter->fresh()->name)->toBe('Renamed');

    // manager / admin targets: forbidden
    $this->put("/team/{$otherManager->id}", [
        'name' => 'x', 'email' => $otherManager->email, 'role' => 'chatter',
    ])->assertForbidden();
    $this->delete("/team/{$admin->id}")->assertForbidden();

    // chatter delete: allowed
    $this->delete("/team/{$chatter->id}")->assertRedirect();
    expect(User::find($chatter->id))->toBeNull();
});

it('prevents deleting yourself', function () {
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->delete("/team/{$admin->id}")
        ->assertForbidden();

    expect(User::find($admin->id))->not->toBeNull();
});

it('prevents an admin from changing their own role', function () {
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->put("/team/{$admin->id}", [
            'name' => $admin->name,
            'email' => $admin->email,
            'role' => 'chatter',
        ])->assertForbidden();

    expect($admin->fresh()->role->value)->toBe('admin');
});

// ---- creator assignments ---------------------------------------------------

it('syncs creator assignments on create and update', function () {
    AichModel::create(['name' => 'Camila']);
    AichModel::create(['name' => 'Nova']);
    $this->actingAs(User::factory()->admin()->create());

    $this->post('/team', [
        'name' => 'Ava',
        'email' => 'ava@test.com',
        'password' => 'secret-password',
        'password_confirmation' => 'secret-password',
        'role' => 'chatter',
        'assigned' => ['Camila'],
    ])->assertRedirect();

    $ava = User::where('email', 'ava@test.com')->firstOrFail();
    expect(ModelAssignment::where('user_id', $ava->id)->pluck('creator_model')->all())->toBe(['Camila']);

    $this->put("/team/{$ava->id}", [
        'name' => 'Ava',
        'email' => 'ava@test.com',
        'role' => 'chatter',
        'assigned' => ['Nova'],
    ])->assertRedirect();

    expect(ModelAssignment::where('user_id', $ava->id)->pluck('creator_model')->all())->toBe(['Nova']);
});

// ---- forced password change ------------------------------------------------

it('forces flagged users to change their password then lets them through', function () {
    $user = User::factory()->chatter()->create(['must_change_password' => true]);
    $this->actingAs($user);

    $this->get('/dashboard')->assertRedirect('/password/change');
    $this->get('/password/change')->assertOk();

    $this->put('/password/change', [
        'password' => 'brand-new-password',
        'password_confirmation' => 'brand-new-password',
    ])->assertRedirect();

    expect($user->fresh()->must_change_password)->toBeFalse();

    $this->get('/dashboard')->assertOk();
});
