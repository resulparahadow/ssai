<?php

namespace App\Http\Controllers\Webhooks;

use App\Events\OnlyFansMessageReceived;
use App\Http\Controllers\Controller;
use App\Models\AichModel;
use App\Services\Integrations\ChatProvider;
use App\Services\OnlyFans\OnlyFansService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
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
    public function handle(Request $request, OnlyFansService $of, ChatProvider $providers): JsonResponse
    {
        if (! $this->authentic($request, $providers)) {
            return response()->json(['error' => 'unauthorized'], 401);
        }

        // Deliveries can repeat (OopCRM: "Use X-OFAPI-Idempotency-Key to deduplicate retries").
        // A repeat is acknowledged but not re-broadcast, so a retried message isn't shown twice.
        $deliveryId = (string) $request->header('X-OFAPI-Idempotency-Key');

        if ($deliveryId !== '' && ! Cache::add('of-webhook:'.sha1($deliveryId), true, now()->addDay())) {
            return response()->json(['ok' => true, 'duplicate' => true]);
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

    /**
     * Both providers may deliver here, so either one's secret is accepted (the admin can flip
     * Settings → Integrations at any time and in-flight deliveries must still land).
     *
     * - A `Signature` header (OopCRM OFAPI format, 2026-11-26) must be an HMAC-SHA256 of the raw
     *   body under one of the configured secrets: hex, `sha256=` prefix optional.
     * - Without it, the old OnlyFansAPI check applies: a plain `X-Webhook-Secret` equal to
     *   ONLYFANS_WEBHOOK_SECRET, or no check at all when that is blank (OnlyFansAPI's webhook is
     *   unsigned today; its real HMAC scheme is still unverified). So an unsigned request is
     *   only refused once ONLYFANS_WEBHOOK_SECRET is set.
     */
    private function authentic(Request $request, ChatProvider $providers): bool
    {
        $signature = trim((string) $request->header('Signature'));
        $secrets = $providers->webhookSecrets();

        if ($signature !== '') {
            if ($secrets === []) {
                return true;
            }

            $signature = strtolower(preg_replace('/^sha256=/i', '', $signature) ?? '');

            foreach ($secrets as $secret) {
                if (hash_equals(hash_hmac('sha256', $request->getContent(), $secret), $signature)) {
                    return true;
                }
            }

            return false;
        }

        $legacy = $providers->connection(ChatProvider::ONLYFANSAPI)['webhook_secret'];

        return $legacy === '' || hash_equals($legacy, (string) $request->header('X-Webhook-Secret'));
    }
}
