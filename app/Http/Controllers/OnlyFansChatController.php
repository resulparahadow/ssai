<?php

namespace App\Http\Controllers;

use App\Models\AichModel;
use App\Services\Engine\EngineClient;
use App\Services\OnlyFans\OnlyFansService;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Symfony\Component\HttpFoundation\Response as HttpResponse;

/**
 * Live OnlyFans proxy for Conversations — nothing is persisted. Every endpoint
 * resolves the creator's account, authorises access (manager/admin any; chatter
 * only assigned creators), calls OnlyFans, and returns the normalised result or
 * forwards the upstream error status/body. Send is text-only (PPV blocked).
 */
class OnlyFansChatController extends Controller
{
    public function __construct(
        protected OnlyFansService $of,
        protected EngineClient $engine,
    ) {}

    public function chats(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($request, $model);
        $res = $this->of->listChats($acct, $request->only(['limit', 'offset', 'order', 'filter', 'query']));
        if (! $res->successful()) {
            return $this->forward($res);
        }
        $j = $res->json();

        return response()->json([
            'chats' => collect($j['data'] ?? [])->map(fn ($c) => $this->of->normalizeChat($c))->values(),
            'next' => $this->of->nextCursor($j['_pagination'] ?? null),
        ]);
    }

    public function messages(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $acct = $this->account($request, $model);
        $res = $this->of->listMessages($acct, $chat, $request->only(['limit', 'last_id', 'first_id', 'order']));
        if (! $res->successful()) {
            return $this->forward($res);
        }
        $j = $res->json();

        return response()->json([
            'messages' => collect($j['data'] ?? [])->map(fn ($m) => $this->of->normalizeMessage($m, $chat))->sortBy('time')->values(),
            'next' => $this->of->nextCursor($j['_pagination'] ?? null),
        ]);
    }

    public function message(Request $request, AichModel $model, string $chat, string $message): JsonResponse
    {
        $acct = $this->account($request, $model);
        $res = $this->of->getMessage($acct, $chat, $message);

        return $res->successful()
            ? response()->json(['message' => $this->of->normalizeMessage($res->json('data') ?? [], $chat)])
            : $this->forward($res);
    }

    public function search(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $acct = $this->account($request, $model);
        $res = $this->of->searchMessages($acct, $chat, $request->only(['query', 'text', 'limit', 'last_id']));
        if (! $res->successful()) {
            return $this->forward($res);
        }

        return response()->json([
            'messages' => collect($res->json('data') ?? [])->map(fn ($m) => $this->of->normalizeMessage($m, $chat))->values(),
        ]);
    }

    public function media(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $acct = $this->account($request, $model);
        $res = $this->of->listChatMedia($acct, $chat, $request->only(['limit', 'last_id']));
        if (! $res->successful()) {
            return $this->forward($res);
        }
        $j = $res->json();

        return response()->json([
            'items' => data_get($j, 'data.list', []),
            'hasMore' => (bool) data_get($j, 'data.hasMore', false),
            'next' => data_get($j, 'data.nextLastId'),
        ]);
    }

    /**
     * Proxy a single OnlyFans CDN media file (image / video poster) through the
     * download endpoint, since the raw cdn*.onlyfans.com URLs are IP-locked and
     * 403 from the browser. Cached server-side by the stable file path so repeat
     * views (and SWR revalidation) don't re-download/re-bill.
     */
    public function mediaFile(Request $request, AichModel $model): HttpResponse
    {
        $acct = $this->account($request, $model);
        $url = (string) $request->query('url', '');

        if (! $this->of->isOnlyFansCdnUrl($url)) {
            abort(400, 'Unsupported media URL.');
        }

        $key = 'ofmedia:'.sha1((string) (parse_url($url, PHP_URL_PATH) ?: $url));
        $cached = Cache::get($key);

        if (! $cached) {
            $res = $this->of->downloadMedia($acct, $url);
            if (! $res->successful()) {
                return $this->forward($res);
            }

            $cached = [
                'ct' => $res->header('Content-Type') ?: 'application/octet-stream',
                'body' => $res->body(),
            ];
            Cache::put($key, $cached, now()->addHours(6));
        }

        return response($cached['body'])
            ->header('Content-Type', $cached['ct'])
            ->header('Cache-Control', 'private, max-age=86400');
    }

    public function send(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $acct = $this->account($request, $model);
        $data = $request->validate(['text' => 'required|string', 'price' => 'nullable|numeric']);

        if ($this->of->ppvBlocked($data['price'] ?? 0)) {
            return response()->json(['error' => 'PPV/paid send is disabled (text only).'], 422);
        }

        $res = $this->of->sendText($acct, $chat, $data['text']);

        return $res->successful()
            ? response()->json(['message' => $this->of->normalizeMessage($res->json('data') ?? [], $chat)])
            : $this->forward($res);
    }

    public function destroy(Request $request, AichModel $model, string $chat, string $message): JsonResponse
    {
        return $this->proxyAction($this->of->deleteMessage($this->account($request, $model), $chat, $message));
    }

    public function like(Request $request, AichModel $model, string $chat, string $message): JsonResponse
    {
        return $this->proxyAction($this->of->likeMessage($this->account($request, $model), $chat, $message));
    }

    public function unlike(Request $request, AichModel $model, string $chat, string $message): JsonResponse
    {
        return $this->proxyAction($this->of->unlikeMessage($this->account($request, $model), $chat, $message));
    }

    public function user(Request $request, AichModel $model, string $user): JsonResponse
    {
        $acct = $this->account($request, $model);
        $res = $this->of->getUser($acct, $user);
        if (! $res->successful()) {
            return $this->forward($res);
        }
        $d = $res->json('data') ?? [];

        return response()->json(['fan' => [
            'id' => $user,
            'name' => $d['name'] ?? null,
            'username' => $d['username'] ?? null,
            'avatar' => $d['avatar'] ?? null,
            'about' => $this->of->htmlToText($d['about'] ?? ''),
            'location' => $d['location'] ?? null,
            'subscribePrice' => data_get($d, 'subscribedByData.subscribePrice') ?? data_get($d, 'subscribePrice'),
            'lastSeen' => $d['lastSeen'] ?? null,
            'canEarn' => $d['canEarn'] ?? null,
        ]]);
    }

    /** AI draft from the LIVE thread (no persistence). */
    public function generate(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $this->account($request, $model); // authorise only
        $data = $request->validate([
            'messages' => 'array',
            'messages.*.from' => 'nullable|string',
            'messages.*.text' => 'nullable|string',
            'customer' => 'array',
            'context' => 'nullable|string',
            'api' => 'nullable|in:claude,auto,mistral',
        ]);

        $messages = collect($data['messages'] ?? [])->map(fn ($m) => [
            'sender' => ($m['from'] ?? 'fan') === 'fan' ? 'customer' : 'model',
            'text' => $m['text'] ?? '',
            'ts_iso' => $m['time'] ?? now()->toIso8601String(),
        ])->values()->all();

        try {
            $out = $this->engine->generateFromLive($model, $messages, $data['customer'] ?? ['id' => $chat], [
                'context' => $data['context'] ?? '',
                'api' => $data['api'] ?? 'claude',
            ]);
        } catch (ConnectionException $e) {
            return response()->json(['error' => 'AI engine is not reachable — start it with `node engine/server.js` (port 8787).'], 503);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'AI engine error: '.$e->getMessage()], 502);
        }

        return response()->json([
            'draft' => $out['draft'] ?? '',
            'strategy' => $out['strategy'] ?? null,
            'telemetry' => $out['telemetry'] ?? null,
        ]);
    }

    // ---- helpers ----------------------------------------------------------

    private function account(Request $request, AichModel $model): string
    {
        $user = $request->user();
        if (! $user->canSeeAllCreators() && ! in_array($model->name, $user->assignedCreatorModels(), true)) {
            abort(403, 'You are not assigned to this creator.');
        }
        if (! $this->of->enabled()) {
            abort(503, 'OnlyFans API key is not configured.');
        }
        if (! $model->of_account_id) {
            abort(422, "Creator {$model->name} has no OnlyFans account connected.");
        }

        return $model->of_account_id;
    }

    private function forward(Response $res): JsonResponse
    {
        return response()->json($res->json() ?: ['error' => 'OnlyFans request failed'], $res->status());
    }

    private function proxyAction(Response $res): JsonResponse
    {
        return response()->json(
            $res->successful() ? ['ok' => true] : ($res->json() ?: ['error' => 'OnlyFans request failed']),
            $res->successful() ? 200 : $res->status(),
        );
    }
}
