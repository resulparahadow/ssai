<?php

use App\Http\Controllers\ConversationController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\GenerationController;
use App\Http\Controllers\ModelController;
use App\Http\Controllers\ModelOnlyFansController;
use App\Http\Controllers\OnlyFansChatController;
use App\Http\Controllers\Webhooks\OnlyFansWebhookController;
use App\Models\AichSession;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::inertia('/', 'Welcome')->name('home');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('dashboard', DashboardController::class)->name('dashboard');

    // Conversations — thin shell; all chat data is fetched LIVE from OnlyFans.
    Route::get('conversations', [ConversationController::class, 'index'])->name('conversations.index');

    // OnlyFans live proxy (no persistence). {model} = AichModel; access scoped in the controller.
    Route::prefix('onlyfans/{model}')->name('onlyfans.')->group(function () {
        Route::get('chats', [OnlyFansChatController::class, 'chats'])->name('chats');
        Route::get('chats/{chat}/messages', [OnlyFansChatController::class, 'messages'])->name('messages');
        Route::get('chats/{chat}/messages/search', [OnlyFansChatController::class, 'search'])->name('search');
        Route::get('chats/{chat}/messages/{message}', [OnlyFansChatController::class, 'message'])->name('message');
        Route::get('chats/{chat}/media', [OnlyFansChatController::class, 'media'])->name('media');
        Route::get('media', [OnlyFansChatController::class, 'mediaFile'])->name('media.file');
        Route::post('chats/{chat}/messages', [OnlyFansChatController::class, 'send'])->name('send');
        Route::delete('chats/{chat}/messages/{message}', [OnlyFansChatController::class, 'destroy'])->name('delete');
        Route::post('chats/{chat}/messages/{message}/like', [OnlyFansChatController::class, 'like'])->name('like');
        Route::post('chats/{chat}/messages/{message}/unlike', [OnlyFansChatController::class, 'unlike'])->name('unlike');
        Route::get('users/{user}', [OnlyFansChatController::class, 'user'])->name('user');
        Route::post('chats/{chat}/generate', [OnlyFansChatController::class, 'generate'])->name('generate');
    });

    // Creator Models — manager/admin only.
    Route::middleware('can:manage-team')->group(function () {
        Route::get('models', [ModelController::class, 'index'])->name('models.index');
        Route::get('models/{model}', [ModelController::class, 'show'])->name('models.show');
        Route::post('models', [ModelController::class, 'store'])->name('models.store');
        Route::put('models/{model}', [ModelController::class, 'update'])->name('models.update');
        Route::delete('models/{model}', [ModelController::class, 'destroy'])->name('models.destroy');
        Route::put('models/{model}/assignments', [ModelController::class, 'assignments'])->name('models.assignments');

        // Live OnlyFans account data for the model show page (no persistence).
        Route::prefix('models/{model}/of')->name('models.of.')->group(function () {
            Route::get('status', [ModelOnlyFansController::class, 'status'])->name('status');
            Route::get('fans', [ModelOnlyFansController::class, 'fans'])->name('fans');
            Route::get('fans/{fan}/history', [ModelOnlyFansController::class, 'fanHistory'])->name('fan-history');
            Route::get('settings', [ModelOnlyFansController::class, 'settings'])->name('settings');
            Route::post('settings/profile', [ModelOnlyFansController::class, 'updateProfile'])->name('settings.profile');
            Route::patch('settings/subscription-price', [ModelOnlyFansController::class, 'updateSubscriptionPrice'])->name('settings.subscription-price');
            Route::get('welcome-message', [ModelOnlyFansController::class, 'welcomeMessage'])->name('welcome');
            Route::post('welcome-message', [ModelOnlyFansController::class, 'updateWelcomeMessage'])->name('welcome.update');
            Route::patch('welcome-message', [ModelOnlyFansController::class, 'toggleWelcomeMessage'])->name('welcome.toggle');

            // Notifications
            Route::get('notifications', [ModelOnlyFansController::class, 'notifications'])->name('notifications');
            Route::get('notifications/counts', [ModelOnlyFansController::class, 'notificationCounts'])->name('notifications.counts');
            Route::post('notifications/mark-read', [ModelOnlyFansController::class, 'markNotificationsRead'])->name('notifications.mark-read');

            // Users — lookup + moderation
            Route::get('users/list', [ModelOnlyFansController::class, 'userList'])->name('users.list');
            Route::get('users/{user}', [ModelOnlyFansController::class, 'userDetail'])->name('users.show');
            Route::post('users/{user}/block', [ModelOnlyFansController::class, 'block'])->name('users.block');
            Route::delete('users/{user}/block', [ModelOnlyFansController::class, 'unblock'])->name('users.unblock');
            Route::post('users/{user}/restrict', [ModelOnlyFansController::class, 'restrict'])->name('users.restrict');
            Route::delete('users/{user}/restrict', [ModelOnlyFansController::class, 'unrestrict'])->name('users.unrestrict');
            Route::post('users/{user}/subscribe', [ModelOnlyFansController::class, 'subscribe'])->name('users.subscribe');
            Route::delete('users/{user}/subscribe', [ModelOnlyFansController::class, 'unsubscribe'])->name('users.unsubscribe');

            // Trial & Tracking links
            Route::get('tracking-links', [ModelOnlyFansController::class, 'trackingLinks'])->name('tracking-links');
            Route::post('tracking-links', [ModelOnlyFansController::class, 'createTrackingLink'])->name('tracking-links.create');
            Route::get('tracking-links/{link}/stats', [ModelOnlyFansController::class, 'trackingLinkStats'])->name('tracking-links.stats');
            Route::delete('tracking-links/{link}', [ModelOnlyFansController::class, 'deleteTrackingLink'])->name('tracking-links.delete');
            Route::get('trial-links', [ModelOnlyFansController::class, 'trialLinks'])->name('trial-links');
            Route::post('trial-links', [ModelOnlyFansController::class, 'createTrialLink'])->name('trial-links.create');
            Route::get('trial-links/{link}/stats', [ModelOnlyFansController::class, 'trialLinkStats'])->name('trial-links.stats');
            Route::delete('trial-links/{link}', [ModelOnlyFansController::class, 'deleteTrialLink'])->name('trial-links.delete');

            Route::get('smart-links', [ModelOnlyFansController::class, 'smartLinks'])->name('smart-links');
            Route::post('smart-links', [ModelOnlyFansController::class, 'createSmartLink'])->name('smart-links.create');
            Route::get('smart-links/{link}/stats', [ModelOnlyFansController::class, 'smartLinkStats'])->name('smart-links.stats');
            Route::get('smart-links/{link}/fans', [ModelOnlyFansController::class, 'smartLinkFans'])->name('smart-links.fans');
            Route::get('smart-links/{link}/spenders', [ModelOnlyFansController::class, 'smartLinkSpenders'])->name('smart-links.spenders');
            Route::get('smart-links/{link}/clicks', [ModelOnlyFansController::class, 'smartLinkClicks'])->name('smart-links.clicks');
            Route::get('smart-links/{link}/conversions', [ModelOnlyFansController::class, 'smartLinkConversions'])->name('smart-links.conversions');
            Route::get('smart-links/{link}/tags', [ModelOnlyFansController::class, 'smartLinkTags'])->name('smart-links.tags');
            Route::post('smart-links/{link}/tags', [ModelOnlyFansController::class, 'addSmartLinkTags'])->name('smart-links.tags.add');
            Route::delete('smart-links/{link}/tags', [ModelOnlyFansController::class, 'removeSmartLinkTags'])->name('smart-links.tags.remove');
            Route::delete('smart-links/{link}', [ModelOnlyFansController::class, 'deleteSmartLink'])->name('smart-links.delete');

            Route::get('link-tags', [ModelOnlyFansController::class, 'linkTags'])->name('link-tags');
        });
    });

    // Phase-3 dev surface: exercise the legacy engine in isolation (DB-session harness).
    Route::post('dev/generate/{session}', [GenerationController::class, 'generate'])->name('dev.generate.run');
    Route::get('dev/generate', function () {
        return Inertia::render('DevGenerate', [
            'sessions' => AichSession::query()
                ->whereNotNull('messages')
                ->latest('id')->take(50)
                ->get(['id', 'creator_model', 'customer_name', 'customer_username'])
                ->map(fn (AichSession $s) => [
                    'id' => $s->id,
                    'creator_model' => $s->creator_model,
                    'label' => $s->creator_model.' · '.$s->customer_name.' (@'.$s->customer_username.')',
                ]),
        ]);
    })->name('dev.generate');
});

// Server-to-server webhook (no session/CSRF — excluded in bootstrap/app.php).
Route::post('webhooks/onlyfans', [OnlyFansWebhookController::class, 'handle'])
    ->name('webhooks.onlyfans');

require __DIR__.'/settings.php';
