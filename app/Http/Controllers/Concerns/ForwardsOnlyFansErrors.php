<?php

namespace App\Http\Controllers\Concerns;

use Illuminate\Http\Client\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;

/**
 * Shared failure handling for the OnlyFans proxy controllers.
 *
 * OnlyFansAPI answers every *application* error in JSON (verified live: 422 validation,
 * 404 ONLYFANS_COM_ERROR, even 500 {"message":"Server Error"}), so a failure body that
 * ISN'T JSON means the response never reached it — what lands here is its Cloudflare edge
 * (502/520/524 HTML pages) or a reset/truncated response. Those must be logged rather than
 * flattened into one opaque string, or an intermittent failure leaves no evidence at all.
 */
trait ForwardsOnlyFansErrors
{
    /** Hand an upstream failure back to the client, preserving whatever it actually said. */
    protected function forward(Response $res): JsonResponse
    {
        $body = $res->json();

        if (is_array($body) && $body !== []) {
            // A JSON 5xx is still an upstream FAILURE, just a well-formed one. It used to pass
            // through unrecorded, which left no trace when a chat-list page walk (up to 200
            // sequential calls) died partway and took the whole list with it. 4xx stays unlogged
            // — those are routine and caller-driven (validation, not-found, auth state).
            if ($res->status() >= 500) {
                Log::warning('onlyfans.proxy.upstream_error', [
                    'status' => $res->status(),
                    'url' => (string) ($res->effectiveUri() ?? ''),
                    'error' => $body['error'] ?? null,
                    'message' => Str::limit((string) ($body['message'] ?? ''), 200),
                ]);
            }

            return response()->json($body, $this->upstreamStatus($res));
        }

        Log::warning('onlyfans.proxy.non_json_error', [
            'status' => $res->status(),
            'url' => (string) ($res->effectiveUri() ?? ''),
            'content_type' => $res->header('Content-Type'),
            'body' => Str::limit(trim((string) $res->body()), 500),
        ]);

        return response()->json([
            'error' => "OnlyFans request failed (HTTP {$res->status()}) — an upstream error, not your request. Retry in a moment.",
        ], $this->upstreamStatus($res));
    }

    /** Bare ok/error proxy (delete, mark-read, …). */
    protected function proxyAction(Response $res): JsonResponse
    {
        return $res->successful()
            ? response()->json(['ok' => true])
            : $this->forward($res);
    }

    /**
     * A failed response's status, clamped to something meaningful to return. Forwarding a
     * 3xx would make the browser chase a redirect carrying a JSON error body; Cloudflare's
     * non-standard codes (520/524) pass through as-is.
     */
    protected function upstreamStatus(Response $res): int
    {
        $status = $res->status();

        return $status >= 400 && $status <= 599 ? $status : 502;
    }
}
