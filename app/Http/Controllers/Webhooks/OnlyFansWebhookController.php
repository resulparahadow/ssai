<?php

namespace App\Http\Controllers\Webhooks;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;

/**
 * Inbound OnlyFans webhook endpoint (port of the legacy onlyfans-webhook Edge
 * Function). Phase 1 = stub: it verifies the shared secret and acknowledges so
 * the integration can be pointed here, but the find-or-create-session + message
 * normalisation pipeline is a later spec.
 */
class OnlyFansWebhookController extends Controller
{
    public function handle(Request $request): JsonResponse
    {
        $secret = (string) config('services.onlyfans.webhook_secret');

        if ($secret !== '' && ! hash_equals($secret, (string) $request->header('X-Webhook-Secret'))) {
            return response()->json(['error' => 'unauthorized'], 401);
        }

        Log::info('onlyfans.webhook.received', [
            'type' => $request->input('type'),
            'account' => $request->input('account_id'),
        ]);

        // TODO (OnlyFans integration spec): route to session, normalise + dedup
        // the message, persist via the chatter-scoped models.

        return response()->json(['ok' => true]);
    }
}
