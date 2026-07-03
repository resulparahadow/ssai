<?php

namespace App\Http\Controllers;

use App\Models\AichChatIntel;
use App\Models\AichModel;
use App\Services\AI\AiUsageRecorder;
use App\Services\Engine\EngineClient;
use App\Services\OnlyFans\OnlyFansService;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Str;
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
        protected AiUsageRecorder $usage,
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
        // Media bytes are raw binary — cache them in the file store, NOT the default
        // store. The app's default cache is the MySQL `database` store, whose `value`
        // column is utf8mb4 text and rejects non-UTF-8 bytes (SQLSTATE 1366). The file
        // store serialises to disk (byte-safe) and keeps large blobs out of the DB.
        $store = Cache::store('file');
        $cached = $store->get($key);

        if (! $cached) {
            $res = $this->of->downloadMedia($acct, $url);
            if (! $res->successful()) {
                return $this->forward($res);
            }

            $cached = [
                'ct' => $res->header('Content-Type') ?: 'application/octet-stream',
                'body' => $res->body(),
            ];
            $store->put($key, $cached, now()->addHours(6));
        }

        return response($cached['body'])
            ->header('Content-Type', $cached['ct'])
            ->header('Cache-Control', 'private, max-age=86400');
    }

    public function send(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $acct = $this->account($request, $model);
        $data = $request->validate([
            'text' => 'nullable|string',
            'giphyId' => 'nullable|string',
            'price' => 'nullable|numeric',
        ]);

        $text = trim((string) ($data['text'] ?? ''));
        $giphyId = $data['giphyId'] ?? null;

        if ($text === '' && ! $giphyId) {
            return response()->json(['error' => 'Message requires text or a GIF.'], 422);
        }

        if ($this->of->ppvBlocked($data['price'] ?? 0)) {
            return response()->json(['error' => 'PPV/paid send is disabled (text only).'], 422);
        }

        $res = $giphyId
            ? $this->of->sendGif($acct, $chat, $giphyId, $text)
            : $this->of->sendText($acct, $chat, $text);

        return $res->successful()
            ? response()->json(['message' => $this->of->normalizeMessage($res->json('data') ?? [], $chat)])
            : $this->forward($res);
    }

    public function giphyTrending(Request $request, AichModel $model): JsonResponse
    {
        $res = $this->of->listGiphyTrending($this->account($request, $model));

        return $res->successful()
            ? response()->json(['gifs' => collect($this->gifList($res->json()))->map(fn ($g) => $this->of->normalizeGif($g))->values()])
            : $this->forward($res);
    }

    public function giphySearch(Request $request, AichModel $model): JsonResponse
    {
        $q = trim((string) $request->query('q', ''));
        if ($q === '') {
            return response()->json(['error' => 'A search query is required.'], 422);
        }

        $res = $this->of->searchGiphy($this->account($request, $model), [
            'q' => $q,
            'limit' => $request->query('limit'),
            'offset' => $request->query('offset'),
        ]);

        return $res->successful()
            ? response()->json(['gifs' => collect($this->gifList($res->json()))->map(fn ($g) => $this->of->normalizeGif($g))->values()])
            : $this->forward($res);
    }

    /**
     * The OFAPI Giphy proxy wraps the list as `data.data[]` (the Giphy payload nested under
     * the OFAPI envelope's `data`). Fall back to a flat `data[]` for resilience.
     *
     * @param  array<string, mixed>|null  $json
     * @return list<array<string, mixed>>
     */
    private function gifList(?array $json): array
    {
        $nested = data_get($json, 'data.data');
        if (is_array($nested) && array_is_list($nested)) {
            return $nested;
        }

        $flat = data_get($json, 'data');

        return is_array($flat) && array_is_list($flat) ? $flat : [];
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

    /** AI profile summary for a fan (poll after generate). */
    public function fanSummary(Request $request, AichModel $model, string $fan): JsonResponse
    {
        $res = $this->of->getFanSummary($this->account($request, $model), $fan);

        return $res->successful() ? response()->json($res->json()) : $this->forward($res);
    }

    /** Queue (re)generation of a fan's AI profile summary — 200 credits, async. */
    public function generateFanSummary(Request $request, AichModel $model, string $fan): JsonResponse
    {
        $regenerate = $request->boolean('regenerate');
        $res = $this->of->generateFanSummary($this->account($request, $model), $fan, $regenerate);

        return $res->successful() ? response()->json($res->json()) : $this->forward($res);
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

        $this->usage->record($out['usage'] ?? [], [
            'generation_id' => (string) Str::ulid(),
            'user_id' => $request->user()?->id,
            'creator_model' => $model->name,
            'chat_id' => $chat,
            'source' => 'live',
        ]);

        // Persist the AI Intel (strategy only — no message text) so the right-rail
        // panel survives a reload and is shared across chatters. Latest wins per chat.
        $generatedAt = null;
        if (! empty($out['strategy'])) {
            $row = AichChatIntel::updateOrCreate(
                ['creator_model' => $model->name, 'chat_id' => $chat],
                ['strategy' => $out['strategy'], 'generated_by' => $request->user()?->id],
            );
            $generatedAt = $row->updated_at?->toIso8601String();
        }

        return response()->json([
            'draft' => $out['draft'] ?? '',
            'strategy' => $out['strategy'] ?? null,
            'telemetry' => $out['telemetry'] ?? null,
            'generatedAt' => $generatedAt,
        ]);
    }

    /** The saved AI Intel for a chat (strategy + when it was generated), or nulls. */
    public function intel(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $this->account($request, $model); // authorise (chatter → assigned only)

        $row = AichChatIntel::where('creator_model', $model->name)
            ->where('chat_id', $chat)
            ->first();

        return response()->json([
            'strategy' => $row?->strategy,
            'generatedAt' => $row?->updated_at?->toIso8601String(),
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
