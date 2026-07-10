<?php

use App\Models\Doctrine;
use App\Services\Doctrine\DoctrineService;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

/** The 10 section markers a valid doctrine must contain (legacy checkDoctrineIntegrity). */
function validDoctrineText(): string
{
    $markers = [
        'UNDERLYING FRAMEWORK', 'IDENTIFYING CUSTOMERS', 'CHAT SKELETON', 'PROMISE RITUAL',
        'POSTURE SYSTEM', 'OBJECTION HANDLING', 'GOODBYE FRAMEWORK', 'AFTERCARE', 'TOS', 'HARD RULES',
    ];

    return implode("\n", $markers)."\n".str_repeat('lorem ', 6000);
}

it('passes integrity for text with enough words and all markers', function () {
    $result = app(DoctrineService::class)->checkIntegrity(validDoctrineText());

    expect($result['ok'])->toBeTrue()
        ->and($result['missing'])->toBe([])
        ->and($result['words'])->toBeGreaterThanOrEqual(6000);
});

it('fails integrity when the doctrine is too short', function () {
    $result = app(DoctrineService::class)->checkIntegrity('UNDERLYING FRAMEWORK too short');

    expect($result['ok'])->toBeFalse()
        ->and($result['reason'])->toContain('too short');
});

it('reports every missing section marker', function () {
    // 6000+ words but no markers at all.
    $result = app(DoctrineService::class)->checkIntegrity(str_repeat('lorem ', 6000));

    expect($result['ok'])->toBeFalse()
        ->and($result['missing'])->toContain('HARD RULES')
        ->and($result['missing'])->toContain('POSTURE SYSTEM')
        ->and($result['missing'])->toHaveCount(10);
});

it('saveCustom activates a new doctrine row and deactivates the prior active one', function () {
    $svc = app(DoctrineService::class);
    $first = $svc->saveCustom(validDoctrineText());

    $second = $svc->saveCustom(validDoctrineText()."\nextra");

    expect($svc->active()->id)->toBe($second->id)
        ->and($first->fresh()->is_active)->toBeFalse()
        ->and($second->sha256)->toBe(hash('sha256', validDoctrineText()."\nextra"))
        ->and($second->tier)->toBe('system');
});

it('resetToDefault deactivates all custom rows', function () {
    $svc = app(DoctrineService::class);
    $svc->saveCustom(validDoctrineText());

    $svc->resetToDefault();

    expect($svc->active())->toBeNull()
        ->and(Doctrine::query()->where('is_active', true)->count())->toBe(0);
});
