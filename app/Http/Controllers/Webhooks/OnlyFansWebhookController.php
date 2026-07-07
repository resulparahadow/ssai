<?php

namespace App\Http\Controllers\Webhooks;

use App\Events\OnlyFansMessageReceived;
use App\Http\Controllers\Controller;
use App\Models\AichModel;
use App\Services\OnlyFans\OnlyFansService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Inbound OnlyFans webhook endpoint. Currently handles `messages.received`: resolve
 * the creator from `account_id`, normalise the message, and broadcast it on the
 * creator's private channel so any open Conversations view updates in realtime.
 *
 * Nothing is persisted — Conversations is a live proxy; the webhook only mirrors the
 * inbound message to connected browsers.
 */
class OnlyFansWebhookController extends Controller
{
    public function handle(Request $request, OnlyFansService $of): JsonResponse
    {
        $secret = (string) config('services.onlyfans.webhook_secret');

        if ($secret !== '' && ! hash_equals($secret, (string) $request->header('X-Webhook-Secret'))) {
            return response()->json(['error' => 'unauthorized'], 401);
        }

        $event = (string) $request->input('event');
        $account = (string) $request->input('account_id');

        // Only inbound fan messages drive the live UI for now; ack everything else.
        if ($event !== 'messages.received') {
            return response()->json(['ok' => true]);
        }

        $model = AichModel::query()->where('of_account_id', $account)->first();

        if (! $model) {
            Log::info('onlyfans.webhook.unknown_account', ['account' => $account]);

            return response()->json(['ok' => true]);
        }

        $payload = (array) $request->input('payload', []);
        $chatId = (string) (data_get($payload, 'fromUser.id') ?? '');

        if ($chatId === '') {
            return response()->json(['ok' => true]);
        }

        $message = $of->normalizeMessage($payload, $chatId);
        $fan = [
            'id' => $chatId,
            'name' => data_get($payload, 'fromUser.name') ?? data_get($payload, 'fromUser.username'),
            'username' => data_get($payload, 'fromUser.username'),
            'avatar' => data_get($payload, 'fromUser.avatar'),
        ];

        OnlyFansMessageReceived::dispatch($model->id, $chatId, $message, $fan);

        return response()->json(['ok' => true]);
    }
}
