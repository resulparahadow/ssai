<?php

use App\Http\Controllers\ConversationController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\GenerationController;
use App\Http\Controllers\ModelController;
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
        Route::post('models', [ModelController::class, 'store'])->name('models.store');
        Route::put('models/{model}', [ModelController::class, 'update'])->name('models.update');
        Route::delete('models/{model}', [ModelController::class, 'destroy'])->name('models.destroy');
        Route::put('models/{model}/assignments', [ModelController::class, 'assignments'])->name('models.assignments');
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
