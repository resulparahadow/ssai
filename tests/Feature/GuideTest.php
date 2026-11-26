<?php

use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Inertia\Testing\AssertableInertia as Assert;

uses(RefreshDatabase::class);

it('renders the chatter guide from docs/chatter-guide.md with a contents list', function () {
    $this->actingAs(User::factory()->create(['role' => 'chatter']))
        ->get('/guide')
        ->assertOk()
        ->assertInertia(fn (Assert $page) => $page
            ->component('Guide')
            ->where('html', fn (string $html) => str_contains($html, '<h1>SSAI Chatter Guide')
                && str_contains($html, '<table>')
                && str_contains($html, 'id="7b-the-intent-bar-take-control-of-the-next-message"'))
            ->where('toc', fn ($toc) => collect($toc)->contains(fn ($h) => $h['level'] === 2 && str_starts_with($h['text'], '1. What SSAI reads'))
                && collect($toc)->pluck('id')->duplicates()->isEmpty()));
});

it('is open to every role and closed to guests', function () {
    foreach (['admin', 'manager', 'chatter'] as $role) {
        $this->actingAs(User::factory()->create(['role' => $role]))->get('/guide')->assertOk();
    }
    auth()->logout();
    $this->get('/guide')->assertRedirect('/login');
});
