<?php

namespace App\Http\Controllers;

use App\Models\AichChatIntel;
use App\Models\AichModel;
use App\Services\AI\AiUsageRecorder;
use App\Services\Engine\EngineClient;
use App\Services\OnlyFans\FanProfileService;
use App\Services\OnlyFans\OnlyFansService;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Validator;
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
        protected FanProfileService $profiles,
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
        $res = $this->of->listMessages($acct, $chat, $request->only(['limit', 'last_id', 'first_id', 'order', 'id']));
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

    /**
     * Upload one file to the OnlyFans CDN and hand back its single-use media id.
     *
     * The size rule is enforced HERE as JSON so an oversized file fails with a parseable
     * 422 rather than nginx's 413 HTML page. 100MB = OnlyFans' own direct-upload cap;
     * nginx (110m) and PHP (100M/110M) are configured to match.
     */
    public function uploadMedia(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($request, $model);

        $this->validateJson($request, [
            'file' => 'required|file|max:102400|mimetypes:image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav',
        ]);

        $file = $request->file('file');
        $res = $this->of->uploadMedia($acct, $file->getRealPath(), $file->getClientOriginalName());

        if (! $res->successful()) {
            return $this->forward($res);
        }

        return response()->json([
            'id' => $res->json('prefixed_id'),
            'status' => $res->json('status') ?? 'pending',
        ]);
    }

    /** Poll an async upload until it is `completed` or `failed`. */
    public function uploadStatus(Request $request, AichModel $model, string $upload): JsonResponse
    {
        $res = $this->of->getUploadStatus($this->account($request, $model), $upload);

        return $res->successful()
            ? response()->json([
                'status' => $res->json('status') ?? 'processing',
                'error' => $res->json('error'),
            ])
            : $this->forward($res);
    }

    /** List the creator's vault media for the composer's picker. */
    public function vault(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($request, $model);
        $res = $this->of->listVaultMedia($acct, [
            'type' => $request->query('type'),
            'limit' => $request->query('limit', 48),
            'offset' => $request->query('offset', 0),
        ]);

        if (! $res->successful()) {
            return $this->forward($res);
        }

        $list = $res->json('data.list') ?? $res->json('data') ?? [];

        return response()->json([
            // Vault items share the message-media shape — reuse the one normalizer.
            'items' => $this->of->normalizeMedia(['media' => $list]),
            // hasMore is the ONLY honest end-of-list signal (nextOffset/next_page lie).
            'hasMore' => (bool) ($res->json('data.hasMore') ?? false),
        ]);
    }

    /** Fetch one vault media item (full object + its list membership). */
    public function vaultMedia(Request $request, AichModel $model, string $media): JsonResponse
    {
        $res = $this->of->getVaultMedia($this->account($request, $model), $media);
        if (! $res->successful()) {
            return $this->forward($res);
        }

        return response()->json([
            'item' => $this->of->normalizeMedia(['media' => [$res->json('data') ?? []]])[0] ?? null,
        ]);
    }

    /**
     * Upload a file OR a remote HTTPS url into the vault (async). Returns the poll id +
     * status in the SAME shape as uploadMedia(), so the existing uploadStatus poller works
     * unchanged. The size rule is enforced here as JSON so an oversized file fails with a
     * parseable 422 rather than nginx's 413 HTML page.
     */
    public function uploadToVault(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($request, $model);

        $this->validateJson($request, [
            'file' => 'required_without:file_url|file|max:102400|mimetypes:image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav',
            'file_url' => 'required_without:file|url',
        ]);

        $file = $request->file('file');
        $res = $file
            ? $this->of->uploadMediaToVault($acct, $file->getRealPath(), $file->getClientOriginalName(), null)
            : $this->of->uploadMediaToVault($acct, null, null, (string) $request->input('file_url'));

        if (! $res->successful()) {
            return $this->forward($res);
        }

        return response()->json([
            'id' => $res->json('prefixed_id'),
            'status' => $res->json('status') ?? 'pending',
        ]);
    }

    /** Delete one or more media from the vault permanently. Manager+ (route-gated). */
    public function deleteVaultMedia(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($request, $model);
        $data = $this->validateJson($request, [
            'mediaIds' => 'required|array|min:1',
            'mediaIds.*' => 'required|string',
        ]);

        return $this->proxyAction($this->of->deleteVaultMedia($acct, $data['mediaIds']));
    }

    // ---- Vault lists ------------------------------------------------------

    public function vaultLists(Request $request, AichModel $model): JsonResponse
    {
        $res = $this->of->listVaultLists($this->account($request, $model), $request->only(['query', 'limit', 'offset']));
        if (! $res->successful()) {
            return $this->forward($res);
        }

        return response()->json([
            'lists' => collect($res->json('data.list') ?? [])->map(fn ($l) => $this->of->normalizeVaultList($l))->values(),
            'hasMore' => (bool) ($res->json('data.hasMore') ?? false),
        ]);
    }

    public function createVaultList(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($request, $model);
        $data = $this->validateJson($request, ['name' => 'required|string|max:255']);
        $res = $this->of->createVaultList($acct, $data['name']);

        return $res->successful()
            ? response()->json(['list' => $this->of->normalizeVaultList($res->json('data') ?? [])])
            : $this->forward($res);
    }

    public function showVaultList(Request $request, AichModel $model, string $list): JsonResponse
    {
        $res = $this->of->showVaultList($this->account($request, $model), $list);

        return $res->successful()
            ? response()->json(['list' => $this->of->normalizeVaultList($res->json('data') ?? [])])
            : $this->forward($res);
    }

    public function renameVaultList(Request $request, AichModel $model, string $list): JsonResponse
    {
        $acct = $this->account($request, $model);
        $data = $this->validateJson($request, ['name' => 'required|string|max:255']);
        $res = $this->of->renameVaultList($acct, $list, $data['name']);

        return $res->successful()
            ? response()->json(['list' => $this->of->normalizeVaultList($res->json('data') ?? [])])
            : $this->forward($res);
    }

    /** Manager+ (route-gated). Deletes the list folder, not the media within it. */
    public function deleteVaultList(Request $request, AichModel $model, string $list): JsonResponse
    {
        return $this->proxyAction($this->of->deleteVaultList($this->account($request, $model), $list));
    }

    public function addToVaultList(Request $request, AichModel $model, string $list): JsonResponse
    {
        $acct = $this->account($request, $model);
        // The CRM speaks one key (`mediaIds`); the service translates to the OF API's
        // asymmetric `media_ids` (add) / `mediaIds` (remove) body keys.
        $data = $this->validateJson($request, [
            'mediaIds' => 'required|array|min:1',
            'mediaIds.*' => 'required|string',
        ]);

        return $this->proxyAction($this->of->addMediaToVaultList($acct, $list, $data['mediaIds']));
    }

    public function removeFromVaultList(Request $request, AichModel $model, string $list): JsonResponse
    {
        $acct = $this->account($request, $model);
        $data = $this->validateJson($request, [
            'mediaIds' => 'required|array|min:1',
            'mediaIds.*' => 'required|string',
        ]);

        return $this->proxyAction($this->of->removeMediaFromVaultList($acct, $list, $data['mediaIds']));
    }

    public function send(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $acct = $this->account($request, $model);
        $data = $request->validate([
            'text' => 'nullable|string',
            'giphyId' => 'nullable|string',
            'mediaFiles' => 'nullable|array|max:1',
            'mediaFiles.*' => 'string',
            'price' => 'nullable|numeric',
        ]);

        $text = trim((string) ($data['text'] ?? ''));
        $giphyId = $data['giphyId'] ?? null;
        $mediaFiles = $data['mediaFiles'] ?? [];

        if ($text === '' && ! $giphyId && $mediaFiles === []) {
            return response()->json(['error' => 'Message requires text, a GIF, or media.'], 422);
        }

        if ($this->of->ppvBlocked($data['price'] ?? 0)) {
            return response()->json(['error' => 'PPV/paid send is disabled (text only).'], 422);
        }

        $res = match (true) {
            $mediaFiles !== [] => $this->of->sendMedia($acct, $chat, $mediaFiles, $text),
            (bool) $giphyId => $this->of->sendGif($acct, $chat, $giphyId, $text),
            default => $this->of->sendText($acct, $chat, $text),
        };

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

    // ---- Chat actions -----------------------------------------------------

    public function mute(Request $request, AichModel $model, string $chat): JsonResponse
    {
        return $this->proxyAction($this->of->muteChat($this->account($request, $model), $chat));
    }

    public function unmute(Request $request, AichModel $model, string $chat): JsonResponse
    {
        return $this->proxyAction($this->of->unmuteChat($this->account($request, $model), $chat));
    }

    /** Manager+ (route-gated): OnlyFans only unhides a chat when the fan is messaged again. */
    public function hide(Request $request, AichModel $model, string $chat): JsonResponse
    {
        return $this->proxyAction($this->of->hideChat($this->account($request, $model), $chat));
    }

    public function markRead(Request $request, AichModel $model, string $chat): JsonResponse
    {
        return $this->proxyAction($this->of->markChatRead($this->account($request, $model), $chat));
    }

    public function markUnread(Request $request, AichModel $model, string $chat): JsonResponse
    {
        return $this->proxyAction($this->of->markChatUnread($this->account($request, $model), $chat));
    }

    /** Pinned messages — OnlyFans exposes pins as a `filter` on the messages list, not its own path. */
    public function pinned(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $acct = $this->account($request, $model);
        $res = $this->of->listMessages($acct, $chat, ['filter' => 'pinned', 'limit' => 100]);
        if (! $res->successful()) {
            return $this->forward($res);
        }

        return response()->json([
            'messages' => collect($res->json('data') ?? [])
                ->map(fn ($m) => $this->of->normalizeMessage($m, $chat))
                ->sortBy('time')
                ->values(),
        ]);
    }

    public function pin(Request $request, AichModel $model, string $chat, string $message): JsonResponse
    {
        return $this->proxyAction($this->of->pinMessage($this->account($request, $model), $chat, $message));
    }

    public function unpin(Request $request, AichModel $model, string $chat, string $message): JsonResponse
    {
        return $this->proxyAction($this->of->unpinMessage($this->account($request, $model), $chat, $message));
    }

    /** Set/clear the fan's OnlyFans custom name (chat id = fan id). */
    public function rename(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $acct = $this->account($request, $model);
        $data = $this->validateJson($request, ['custom_name' => 'present|nullable|string|max:255']);

        $res = $this->of->setFanCustomName($acct, $chat, $data['custom_name']);

        // The custom name comes back as `displayName`; `name` stays the fan's real OnlyFans
        // name. Clearing empties `displayName`, so falling back to `name` yields the right
        // label for both set and clear.
        return $res->successful()
            ? response()->json([
                'ok' => true,
                'name' => $this->of->displayNameOf((array) data_get($res->json(), 'data', [])),
            ])
            : $this->forward($res);
    }

    // ---- Fan note (OnlyFans-native; crm_notes is its local mirror) ---------

    /**
     * OnlyFans owns the note; `customer_profiles.crm_notes` mirrors it so `generate`
     * can feed it to the AI without an extra billed call per generation.
     *
     * A note written before this mirror existed (local set, OnlyFans empty) is returned
     * with `synced: false` rather than being dropped — saving pushes it up to OnlyFans.
     */
    public function notes(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $acct = $this->account($request, $model);
        $res = $this->of->getFanNotes($acct, $chat);
        if (! $res->successful()) {
            return $this->forward($res);
        }

        $remote = trim((string) (data_get($res->json(), 'data.notes') ?? ''));
        $local = trim((string) ($this->profiles->find($model, $chat)?->crm_notes ?? ''));

        if ($remote === '' && $local !== '') {
            return response()->json(['notes' => $local, 'synced' => false]);
        }

        $this->profiles->mirrorNote($model, $chat, $remote);

        return response()->json(['notes' => $remote, 'synced' => true]);
    }

    public function saveNotes(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $acct = $this->account($request, $model);
        $data = $this->validateJson($request, ['notes' => 'present|nullable|string|max:5000']);
        $notes = (string) ($data['notes'] ?? '');

        $res = $this->of->setFanNotes($acct, $chat, $notes);
        if (! $res->successful()) {
            return $this->forward($res);
        }
        // Mirror only after a 2xx, so a failed write never desyncs the local copy.
        $this->profiles->mirrorNote($model, $chat, $notes);

        return response()->json(['ok' => true, 'notes' => $notes, 'synced' => true]);
    }

    public function clearNotes(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $acct = $this->account($request, $model);
        $res = $this->of->clearFanNotes($acct, $chat);
        if (! $res->successful()) {
            return $this->forward($res);
        }
        $this->profiles->mirrorNote($model, $chat, null);

        return response()->json(['ok' => true, 'notes' => '', 'synced' => true]);
    }

    // ---- Moderation (manager+; routes gated by can:manage-team) ------------

    public function block(Request $request, AichModel $model, string $user): JsonResponse
    {
        return $this->proxyAction($this->of->blockUser($this->account($request, $model), $user));
    }

    public function unblock(Request $request, AichModel $model, string $user): JsonResponse
    {
        return $this->proxyAction($this->of->unblockUser($this->account($request, $model), $user));
    }

    public function restrict(Request $request, AichModel $model, string $user): JsonResponse
    {
        return $this->proxyAction($this->of->restrictUser($this->account($request, $model), $user));
    }

    public function unrestrict(Request $request, AichModel $model, string $user): JsonResponse
    {
        return $this->proxyAction($this->of->unrestrictUser($this->account($request, $model), $user));
    }

    /** "Unfollow" on OnlyFans = drop the creator's own subscription to the fan. */
    public function unfollow(Request $request, AichModel $model, string $user): JsonResponse
    {
        return $this->proxyAction($this->of->unsubscribeFromUser($this->account($request, $model), $user));
    }

    public function user(Request $request, AichModel $model, string $user): JsonResponse
    {
        $acct = $this->account($request, $model);
        $res = $this->of->getUser($acct, $user);
        if (! $res->successful()) {
            return $this->forward($res);
        }
        $d = $res->json('data') ?? [];
        // Lifetime spend/tips and subscription state both come from the same getUser
        // payload (no extra API call, no extra credits).
        $spend = $this->of->extractFanSpend($d);
        $sub = $this->of->extractFanSubscription($d);

        return response()->json(['fan' => [
            'id' => $user,
            // Same custom-name-aware label as the chat list, so a rename shows in both.
            'name' => $this->of->displayNameOf($d),
            'username' => $d['username'] ?? null,
            'avatar' => $d['avatar'] ?? null,
            'about' => $this->of->htmlToText($d['about'] ?? ''),
            'location' => $d['location'] ?? null,
            // subscribedOnData = the fan's subscription TO this creator. (subscribedByData
            // is the creator's sub to the fan — the wrong direction, ~always empty.)
            'subscribePrice' => data_get($d, 'subscribedOnData.subscribePrice') ?? data_get($d, 'subscribedOnData.regularPrice'),
            'lastSeen' => $d['lastSeen'] ?? null,
            'canEarn' => $d['canEarn'] ?? null,
            // Moderation state rides along on the same getUser payload (no extra call), so the
            // fan-settings menu can offer Block/Unblock rather than guessing.
            'isBlocked' => (bool) ($d['isBlocked'] ?? false),
            'isRestricted' => (bool) ($d['isRestricted'] ?? false),
            'subscribedBy' => (bool) ($d['subscribedBy'] ?? false),
            'totalSpent' => $spend['total'],
            'tips' => $spend['tips'],
            'subscribed' => $sub['subscribed'],
            'durationLabel' => $sub['durationLabel'],
            'subscribedAt' => $sub['subscribedAt'],
            'expiredAt' => $sub['expiredAt'],
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

    /** AI draft from the LIVE thread. Only derived fan memory is persisted, never message text. */
    public function generate(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $account = $this->account($request, $model);
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

        // Load-or-create the persisted fan memory (refreshes spend from OnlyFans) and
        // feed it to the engine so the brain sees a returning customer, not a $0 lurker.
        $customer = $data['customer'] ?? ['id' => $chat];
        $profile = $this->profiles->loadForGenerate($model, $account, $chat, $customer);

        try {
            $out = $this->engine->generateFromLive($model, $messages, $customer, [
                'context' => $data['context'] ?? '',
                'api' => $data['api'] ?? 'claude',
                // OnlyFans spend is LIFETIME — it belongs on _profile (drives trust cap / tier /
                // depth gate / sexting+tip detection). SESSION spend (this conversation) stays $0:
                // it's only derivable from per-message PPV/tip data, which isn't mapped yet. Feeding
                // lifetime as session spend would wrongly trip the ACTIVE-BUYER / session-spender
                // anti-exit guards for anyone who has ever spent.
                'profile' => $this->profiles->toEngineProfile($profile),
                'subscription_status' => $profile->subscription_status ?? 'subscribed',
                'crm_notes' => (string) ($profile->crm_notes ?? ''),
                'sexting' => $profile->sexting_mode ?? 'AUTO',
                'tipMode' => $profile->tip_mode ?? 'AUTO',
            ]);
        } catch (ConnectionException $e) {
            return response()->json(['error' => 'AI engine is not reachable — start it with `node engine/server.js` (port 8787).'], 503);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'AI engine error: '.$e->getMessage()], 502);
        }

        // Folded-analysis write-back: auto-fill unlocked memory fields (skips human-pinned ones).
        if (! empty($out['strategy'])) {
            $this->profiles->applyAnalysis($profile, $out['strategy']);
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

    /** The persisted fan memory + toggles + read-only OF spend for a chat (of_fan_id = chat). */
    public function profile(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $this->authorizeCreator($request, $model);

        return response()->json([
            'profile' => $this->profiles->toPanel($this->profiles->find($model, $chat)),
        ]);
    }

    /** Manual edit: edited AI fields get pinned, toggles/notes set, `unlock[]` re-opens fields. */
    public function updateProfile(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $data = $this->validateJson($request, [
            'archetype' => 'sometimes|nullable|string|max:120',
            'trust_level' => 'sometimes|integer|min:0|max:5',
            'temperature' => 'sometimes|nullable|string|max:20',
            'key_details' => 'sometimes|nullable|string|max:5000',
            // `crm_notes` is deliberately absent: the note is owned by OnlyFans and written
            // only through the notes endpoints, which mirror it back into that column.
            'is_timewaster' => 'sometimes|boolean',
            'sexting_mode' => 'sometimes|in:AUTO,FORCE_ON,FORCE_OFF',
            'tip_mode' => 'sometimes|in:AUTO,FORCE_ON,FORCE_OFF',
            'unlock' => 'sometimes|array',
            'unlock.*' => 'string',
        ]);

        $profile = $this->profiles->applyManualEdit($this->profiles->findOrNew($model, $chat), $data);

        return response()->json(['profile' => $this->profiles->toPanel($profile)]);
    }

    // ---- helpers ----------------------------------------------------------

    /** Row-level access check shared by the OnlyFans + memory endpoints (chatter → assigned only). */
    private function authorizeCreator(Request $request, AichModel $model): void
    {
        $user = $request->user();
        if (! $user->canSeeAllCreators() && ! in_array($model->name, $user->assignedCreatorModels(), true)) {
            abort(403, 'You are not assigned to this creator.');
        }
    }

    private function account(Request $request, AichModel $model): string
    {
        $this->authorizeCreator($request, $model);
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

    /**
     * Validate and force a JSON 422 on failure. These routes aren't under `api/*`,
     * so a ValidationException would otherwise 302-redirect (bootstrap/app.php
     * shouldRenderJsonWhen) — an HttpResponseException guarantees JSON for the fetch client.
     *
     * @param  array<string, mixed>  $rules
     * @return array<string, mixed>
     */
    private function validateJson(Request $request, array $rules): array
    {
        $validator = Validator::make($request->all(), $rules);
        if ($validator->fails()) {
            throw new HttpResponseException(
                response()->json(['error' => $validator->errors()->first(), 'errors' => $validator->errors()->toArray()], 422)
            );
        }

        return $validator->validated();
    }
}
