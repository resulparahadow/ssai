<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Gate;

uses(RefreshDatabase::class);

it('gates agency profit to admins only', function () {
    expect(Gate::forUser(User::factory()->admin()->create())->allows('view-agency-profit'))->toBeTrue()
        ->and(Gate::forUser(User::factory()->manager()->create())->allows('view-agency-profit'))->toBeFalse()
        ->and(Gate::forUser(User::factory()->chatter()->create())->allows('view-agency-profit'))->toBeFalse();
});

it('gates all-creators and team management to managers and up', function () {
    foreach (['view-all-creators', 'manage-team'] as $ability) {
        expect(Gate::forUser(User::factory()->admin()->create())->allows($ability))->toBeTrue()
            ->and(Gate::forUser(User::factory()->manager()->create())->allows($ability))->toBeTrue()
            ->and(Gate::forUser(User::factory()->chatter()->create())->allows($ability))->toBeFalse();
    }
});

it('gates editing global training to admins only', function () {
    expect(Gate::forUser(User::factory()->admin()->create())->allows('edit-global-training'))->toBeTrue()
        ->and(Gate::forUser(User::factory()->manager()->create())->allows('edit-global-training'))->toBeFalse()
        ->and(Gate::forUser(User::factory()->chatter()->create())->allows('edit-global-training'))->toBeFalse();
});
