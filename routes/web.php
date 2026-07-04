<?php

use App\Http\Controllers\AiUsageController;
use App\Http\Controllers\AnalyticsController;
use App\Http\Controllers\Auth\PasswordChangeController;
use App\Http\Controllers\ConversationController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\GenerationController;
use App\Http\Controllers\ModelController;
use App\Http\Controllers\ModelOnlyFansController;
use App\Http\Controllers\OnlyFansChatController;
use App\Http\Controllers\TeamController;
use App\Http\Controllers\Webhooks\OnlyFansWebhookController;
use App\Models\AichSession;
use Illuminate\Support\Facades\Route;
use Inertia\Inertia;

Route::inertia('/', 'Welcome')->name('home');

Route::middleware(['auth', 'verified'])->group(function () {
    Route::get('dashboard', DashboardController::class)->name('dashboard');

    // AI usage / cost telemetry — manager/admin only (mirrors the legacy manager-only cost cards).
    Route::get('analytics/ai-usage', AiUsageController::class)->middleware('can:manage-team')->name('analytics.ai-usage');

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
        Route::get('fans/{fan}/summary', [OnlyFansChatController::class, 'fanSummary'])->name('fan-summary');
        Route::post('fans/{fan}/summary', [OnlyFansChatController::class, 'generateFanSummary'])->name('fan-summary.generate');
        Route::post('chats/{chat}/generate', [OnlyFansChatController::class, 'generate'])->name('generate');
        Route::get('chats/{chat}/intel', [OnlyFansChatController::class, 'intel'])->name('intel');
        Route::get('chats/{chat}/profile', [OnlyFansChatController::class, 'profile'])->name('profile');
        Route::patch('chats/{chat}/profile', [OnlyFansChatController::class, 'updateProfile'])->name('profile.update');
        Route::get('giphy/trending', [OnlyFansChatController::class, 'giphyTrending'])->name('giphy.trending');
        Route::get('giphy/search', [OnlyFansChatController::class, 'giphySearch'])->name('giphy.search');
    });

    // Creator Models — manager/admin only.
    Route::middleware('can:manage-team')->group(function () {
        // Agency-wide OnlyFans Analytics dashboard (live proxy; nothing persisted).
        Route::get('analytics/overview', [AnalyticsController::class, 'page'])->name('analytics.overview');
        Route::prefix('analytics/of')->name('analytics.of.')->group(function () {
            Route::post('earnings', [AnalyticsController::class, 'earnings'])->name('earnings');
            Route::post('historical', [AnalyticsController::class, 'historical'])->name('historical');
            Route::post('comparison', [AnalyticsController::class, 'comparison'])->name('comparison');
            Route::post('transactions/summary', [AnalyticsController::class, 'transactionSummary'])->name('transactions.summary');
            Route::post('transactions/by-type', [AnalyticsController::class, 'transactionsByType'])->name('transactions.by-type');
            Route::post('forecast', [AnalyticsController::class, 'forecast'])->name('forecast');
            Route::post('profitability', [AnalyticsController::class, 'profitability'])->name('profitability');
            Route::get('profitability/{model}/history', [AnalyticsController::class, 'profitabilityHistory'])->name('profitability.history');
        });

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
            Route::get('fans/{fan}/summary', [ModelOnlyFansController::class, 'fanSummary'])->name('fan-summary');
            Route::post('fans/{fan}/summary', [ModelOnlyFansController::class, 'generateFanSummary'])->name('fan-summary.generate');
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

            Route::get('promotions', [ModelOnlyFansController::class, 'promotions'])->name('promotions');
            Route::post('promotions', [ModelOnlyFansController::class, 'createPromotion'])->name('promotions.create');
            Route::post('promotions/{promotion}/stop', [ModelOnlyFansController::class, 'stopPromotion'])->name('promotions.stop');
            Route::delete('promotions/{promotion}', [ModelOnlyFansController::class, 'deletePromotion'])->name('promotions.delete');

            Route::get('bundles', [ModelOnlyFansController::class, 'bundles'])->name('bundles');
            Route::post('bundles', [ModelOnlyFansController::class, 'createBundle'])->name('bundles.create');
            Route::delete('bundles/{bundle}', [ModelOnlyFansController::class, 'deleteBundle'])->name('bundles.delete');
        });

        // Team & roles — user management (admins/managers; per-target rules in UserPolicy).
        Route::get('team', [TeamController::class, 'index'])->name('team.index');
        Route::post('team', [TeamController::class, 'store'])->name('team.store');
        Route::put('team/{user}', [TeamController::class, 'update'])->name('team.update');
        Route::delete('team/{user}', [TeamController::class, 'destroy'])->name('team.destroy');
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

// Forced password change (must_change_password). Auth-only and intentionally outside
// the RequirePasswordChange redirect so a flagged user can always reach the form.
Route::middleware('auth')->group(function () {
    Route::get('password/change', [PasswordChangeController::class, 'edit'])->name('password.change');
    Route::put('password/change', [PasswordChangeController::class, 'update'])->name('password.change.update');
});

// Server-to-server webhook (no session/CSRF — excluded in bootstrap/app.php).
Route::post('webhooks/onlyfans', [OnlyFansWebhookController::class, 'handle'])
    ->name('webhooks.onlyfans');

require __DIR__.'/settings.php';
