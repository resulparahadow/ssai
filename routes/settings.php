<?php

use App\Http\Controllers\Settings\GlobalTrainingController;
use App\Http\Controllers\Settings\IntegrationsController;
use App\Http\Controllers\Settings\ProfileController;
use App\Http\Controllers\Settings\SecurityController;
use Illuminate\Auth\Middleware\RequirePassword;
use Illuminate\Support\Facades\Route;

Route::middleware(['auth'])->group(function () {
    Route::redirect('settings', '/settings/profile');

    Route::get('settings/profile', [ProfileController::class, 'edit'])->name('profile.edit');
    Route::patch('settings/profile', [ProfileController::class, 'update'])->name('profile.update');
});

Route::middleware(['auth', 'verified'])->group(function () {
    Route::delete('settings/profile', [ProfileController::class, 'destroy'])->name('profile.destroy');

    Route::get('settings/security', [SecurityController::class, 'edit'])
        ->middleware(RequirePassword::class)
        ->name('security.edit');

    Route::put('settings/password', [SecurityController::class, 'update'])
        ->middleware('throttle:6,1')
        ->name('user-password.update');

    Route::inertia('settings/appearance', 'settings/Appearance')->name('appearance.edit');

    Route::inertia('settings/notifications', 'settings/Notifications')->name('notifications.edit');
});

// Global agency doctrine editor — admin only (the highest-stakes agency-wide setting).
Route::middleware(['auth', 'can:edit-global-training'])->group(function () {
    Route::get('settings/global-training', [GlobalTrainingController::class, 'edit'])->name('global-training.edit');
    Route::put('settings/global-training', [GlobalTrainingController::class, 'update'])->name('global-training.update');
    Route::post('settings/global-training/reset', [GlobalTrainingController::class, 'reset'])->name('global-training.reset');
});

// Chat provider switch (OnlyFansAPI ↔ OopCRM) — admin only; changes every OnlyFans call.
Route::middleware(['auth', 'can:manage-integrations'])->group(function () {
    Route::get('settings/integrations', [IntegrationsController::class, 'edit'])->name('integrations.edit');
    Route::put('settings/integrations', [IntegrationsController::class, 'update'])->name('integrations.update');
    Route::post('settings/integrations/test', [IntegrationsController::class, 'test'])
        ->middleware('throttle:10,1')
        ->name('integrations.test');
});

Route::get('.well-known/passkey-endpoints', function () {
    return response()->json([
        'enroll' => route('security.edit'),
        'manage' => route('security.edit'),
    ]);
})->name('well-known.passkeys');
