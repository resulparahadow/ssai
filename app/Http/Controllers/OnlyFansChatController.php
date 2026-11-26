<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\AuthorizesCreator;
use App\Http\Controllers\Concerns\ForwardsOnlyFansErrors;
use App\Models\AichChatIntel;
use App\Models\AichDraftRejection;
use App\Models\AichMessageTag;
use App\Models\AichModel;
use App\Models\CustomerProfile;
use App\Models\ScriptStep;
use App\Models\ScriptStepSend;
use App\Rules\PpvPrice;
use App\Services\AI\AiUsageRecorder;
use App\Services\Engine\EngineClient;
use App\Services\OnlyFans\ChatStateService;
use App\Services\OnlyFans\DraftRejectionService;
use App\Services\OnlyFans\FanMemoryLog;
use App\Services\OnlyFans\FanProfileService;
use App\Services\OnlyFans\LiveThreadMapper;
use App\Services\OnlyFans\OnlyFansService;
use App\Services\OnlyFans\PpvReadiness;
use App\Support\AgentIntents;
use App\Support\IntentUnavailable;
use App\Support\PpvPriceSuggestion;
use App\Support\StateSwitches;
use Illuminate\Contracts\Cache\LockTimeoutException;
use Illuminate\Http\Client\ConnectionException;
use Illuminate\Http\Client\Response;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Symfony\Component\HttpFoundation\Response as HttpResponse;

/**
 * Live OnlyFans proxy for Conversations — nothing is persisted. Every endpoint
 * resolves the creator's account, authorises access (manager/admin any; chatter
 * only assigned creators), calls OnlyFans, and returns the normalised result or
 * forwards the upstream error status/body. Send is text-only (PPV blocked).
 */
class OnlyFansChatController extends Controller
{
    use AuthorizesCreator;
    use ForwardsOnlyFansErrors;

    public function __construct(
        protected OnlyFansService $of,
        protected EngineClient $engine,
        protected AiUsageRecorder $usage,
        protected FanProfileService $profiles,
        protected ChatStateService $states,
        protected LiveThreadMapper $mapper,
        protected DraftRejectionService $rejections,
        protected PpvReadiness $readiness,
    ) {}

    public function chats(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($request, $model);
        $res = $this->of->listChats($acct, $request->only(['limit', 'offset', 'order', 'filter', 'query']));
        if (! $res->successful()) {
            return $this->forward($res);
        }
        $j = $res->json();
        $next = $this->of->nextCursor($j['_pagination'] ?? null);

        // The list pages on scroll, so page 2 must answer the same question as page 1. The
        // spec's own example next_page carries only offset + limit, so don't rely on upstream
        // echoing the view back: re-apply the valid view params this page was asked with.
        if ($next !== null) {
            $next = [...$this->of->chatView($request->query()), ...$next];
        }

        return response()->json([
            'chats' => collect($j['data'] ?? [])->map(fn ($c) => $this->of->normalizeChat($c))->values(),
            'next' => $next,
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

        // `data.list` holds MESSAGES, not media: each entry is a message wrapper whose media
        // sit one level down in `media[]` (spec: paths./api/{account}/chats/{chat_id}/media).
        // Returning those raw made the gallery render a grid of empty tiles — every media
        // field it looked for was on the nested object. normalizeMedia() already maps a
        // message to its renditions, so the gallery gets the same shape as message bubbles.
        $list = data_get($j, 'data.list', []);
        $items = [];

        foreach (is_array($list) ? $list : [] as $message) {
            if (is_array($message)) {
                array_push($items, ...$this->of->normalizeMedia($message));
            }
        }

        return response()->json([
            'items' => $items,
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
            // A single OnlyFans media item mixes hosts across its own files (thumb on
            // cdn2.onlyfans.com, preview on cdn.fansapi.com), so a caller can legitimately
            // land here with a vendor-CDN url. Those load in the browser as they are — hand
            // it back rather than failing, so a missed check degrades to a slower load
            // instead of a broken image.
            if ($this->of->isVendorCdnUrl($url)) {
                return redirect()->away($url);
            }

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
            try {
                $res = $this->of->downloadMedia($acct, $url);
            } catch (ConnectionException $e) {
                // downloadMedia gets services.onlyfans.timeout and no retry. Uncaught this
                // became an opaque 500, and because this endpoint is used as an <img>/<video>
                // src that reads to the user as a tile that silently never loads.
                Log::warning('onlyfans.media.download_timeout', [
                    'account' => $acct,
                    'path' => parse_url($url, PHP_URL_PATH),
                    'reason' => $e->getMessage(),
                ]);

                return response()->json([
                    'error' => 'Timed out fetching this media from OnlyFans — retry in a moment.',
                ], 504);
            }

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
     * Serve a DRM-protected video as a playable, decrypted mp4.
     *
     * The upstream DRM endpoint is slow (8-15s of license exchange + decrypt before the first
     * byte) and billed per byte delivered, so the result is cached on disk and served with
     * `response()->file()` — which answers Range requests, so the browser can seek, and costs
     * nothing on repeat views. A lock stops two chatters opening the same video from paying
     * for it twice; the loser waits and finds the file already there.
     */
    public function drmMediaFile(Request $request, AichModel $model, string $media): HttpResponse
    {
        $acct = $this->account($request, $model);

        // Both halves become a path on our disk — keep them to characters that cannot escape it.
        if (! ctype_digit($media)) {
            abort(400, 'Invalid media id.');
        }
        $dir = 'of-drm/'.preg_replace('/[^A-Za-z0-9_-]/', '', $acct);
        $path = "{$dir}/{$media}.mp4";

        $disk = Storage::disk('local');

        if (! $disk->exists($path)) {
            if ($error = $this->cacheDrmVideo($acct, $media, $dir, $path)) {
                return $error;
            }
        }

        return response()->file($disk->path($path), [
            'Content-Type' => 'video/mp4',
            'Cache-Control' => 'private, max-age=86400',
        ]);
    }

    /**
     * Fetch one decrypted DRM video onto disk. Returns an error response to forward, or null
     * once the file is cached.
     *
     * Held under a lock so two people opening the same video don't both pay for it: the second
     * waits, then finds the file already downloaded. The mp4 lands at a `.part` path first and
     * is renamed only on success, so a failed or half-finished download can never be served as
     * a video.
     */
    private function cacheDrmVideo(string $acct, string $media, string $dir, string $path): ?HttpResponse
    {
        $disk = Storage::disk('local');
        // The lock has to outlive the download it guards: if it expires mid-flight a second
        // viewer starts a duplicate — and duplicates are billed per byte, twice.
        $timeout = (int) config('services.onlyfans.drm_timeout', 1800);
        $lock = Cache::lock("ofdrm:{$acct}:{$media}", $timeout + 60);

        try {
            $lock->block(120);
        } catch (LockTimeoutException) {
            return response()->json(['error' => 'This video is still being prepared. Try again in a moment.'], 409);
        }

        try {
            // Whoever held the lock may have just finished the download we were waiting on.
            if ($disk->exists($path)) {
                return null;
            }

            $disk->makeDirectory($dir);
            $temp = $disk->path("{$dir}/{$media}.part");

            try {
                $res = $this->of->downloadDrmMedia($acct, $media, $temp);
            } catch (ConnectionException) {
                @unlink($temp);

                return response()->json([
                    'error' => 'The video took too long to download. Large videos can take several minutes — try again.',
                ], 504);
            }

            if (! $res->successful()) {
                // The sink holds the upstream error JSON (402 out of credits, 422 not
                // DRM-protected, …) — never a video. Drop it and forward the status.
                @unlink($temp);

                return $this->forward($res);
            }

            rename($temp, $disk->path($path));

            return null;
        } finally {
            $lock->release();
        }
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
            'list' => $request->query('list'),
            'query' => $request->query('query'),
            // Sort: `field` (recent|most-liked|highest-tips) + `sort` (desc|asc). The service
            // drops an off-enum value, so an unknown one falls back to the API defaults.
            'field' => $request->query('field'),
            'sort' => $request->query('sort'),
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
        $data = $this->validateJson($request, [
            'text' => 'nullable|string',
            'giphyId' => 'nullable|string',
            // Up to a whole script step (ScriptController::MAX_MEDIA) of vault/upload ids.
            'mediaFiles' => 'nullable|array|max:'.ScriptController::MAX_MEDIA,
            'mediaFiles.*' => 'string',
            // 0 (free) or $3–$200 — validated here so a bad price never costs a billed vendor 422.
            'price' => ['nullable', 'numeric', new PpvPrice],
            // The script step this send came from, for the send ledger (Sent/Bought pill).
            'scriptStepId' => 'nullable|integer',
        ]);

        $text = trim((string) ($data['text'] ?? ''));
        $giphyId = $data['giphyId'] ?? null;
        $mediaFiles = $data['mediaFiles'] ?? [];
        $price = (float) ($data['price'] ?? 0);

        if ($text === '' && ! $giphyId && $mediaFiles === []) {
            return response()->json(['error' => 'Message requires text, a GIF, or media.'], 422);
        }

        // A PPV is media behind a paywall: a priced text or GIF is a vendor 422 we pre-empt.
        if ($price > 0 && $mediaFiles === []) {
            return response()->json(['error' => 'A price needs media attached.'], 422);
        }

        // §5b: the fan's manual switches (read-only lookup — never creates a row). Support mode
        // blocks a paid send server-side, so a bypassed client still can't sell; free media and
        // plain text still go.
        $fanProfile = $this->profiles->find($model, $chat);
        $overrides = $fanProfile?->state_overrides ?? [];
        if ($price > 0 && ! empty($overrides['support'])) {
            return response()->json(['error' => StateSwitches::SUPPORT_ERROR], 422);
        }

        // Resolve the step BEFORE the vendor call: a step id from another creator must fail
        // cheaply, not after a billed send that then has nowhere to be recorded.
        $step = null;
        if (! empty($data['scriptStepId'])) {
            $step = ScriptStep::withoutGlobalScopes()->where('creator_model', $model->name)->find((int) $data['scriptStepId']);
            if (! $step) {
                return response()->json(['error' => 'Script not found for this creator.'], 422);
            }
            // Imported from CreatorHero without its media: nothing real to send yet.
            if ($step->needs_media) {
                return response()->json(['error' => 'This script needs media before it can be sent.'], 422);
            }
        }

        $res = match (true) {
            $mediaFiles !== [] => $this->of->sendMedia($acct, $chat, $mediaFiles, $text, $price),
            (bool) $giphyId => $this->of->sendGif($acct, $chat, $giphyId, $text),
            default => $this->of->sendText($acct, $chat, $text),
        };

        if (! $res->successful()) {
            return $this->forward($res);
        }

        $sent = $res->json('data') ?? [];

        // Send ledger (ids/price/time only — no text). A ledger failure must never fail a
        // send that already reached the fan.
        if ($step) {
            try {
                ScriptStepSend::create([
                    'script_step_id' => $step->id,
                    'step_title' => mb_substr($step->title, 0, 120),
                    'creator_model' => $model->name,
                    'of_fan_id' => $chat,
                    'of_message_id' => isset($sent['id']) ? (string) $sent['id'] : null,
                    'price' => $price,
                    'source' => 'send',
                    'user_id' => $request->user()?->id,
                    'sent_at' => now(),
                ]);
            } catch (\Throwable $e) {
                Log::warning('script.ledger_failed', ['step' => $step->id, 'chat' => $chat, 'error' => $e->getMessage()]);
            }
        }

        // RLS auto-advance marker: any send under a manual beat counts as that beat's message
        // (even a rewritten draft). The beat moves on at the next generate once the fan replies.
        // Like the ledger, a failure here must never fail a send that already reached the fan.
        if ($fanProfile && isset($overrides['rls_beat'])) {
            try {
                $fanProfile->rls_beat_sent_at = now();
                $fanProfile->save();
            } catch (\Throwable $e) {
                Log::warning('state.rls_stamp_failed', ['chat' => $chat, 'error' => $e->getMessage()]);
            }
        }

        return response()->json(['message' => $this->of->normalizeMessage($sent, $chat)]);
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
        $acct = $this->account($request, $model);
        $res = $this->of->restrictUser($acct, $user);
        $this->debugLog('restrict', [
            'account' => $acct, 'user' => $user,
            'status' => $res->status(), 'body' => $res->json(),
        ]);

        return $this->proxyAction($res);
    }

    public function unrestrict(Request $request, AichModel $model, string $user): JsonResponse
    {
        $acct = $this->account($request, $model);
        $res = $this->of->unrestrictUser($acct, $user);
        $this->debugLog('unrestrict', [
            'account' => $acct, 'user' => $user,
            'status' => $res->status(), 'body' => $res->json(),
        ]);

        return $this->proxyAction($res);
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
        $this->debugLog('getUser', [
            'account' => $acct, 'user' => $user,
            'id_in_payload' => $d['id'] ?? null,
            'isRestricted' => $d['isRestricted'] ?? null,
            'isBlocked' => $d['isBlocked'] ?? null,
        ]);
        // Lifetime spend/tips and subscription state both come from the same getUser
        // payload (no extra API call, no extra credits).
        $spend = $this->of->extractFanSpend($d);
        $sub = $this->of->extractFanSubscription($d);

        return response()->json(['fan' => [
            'id' => $user,
            // Same custom-name-aware label as the chat list, so a rename shows in both.
            'name' => $this->of->displayNameOf($d),
            'fanName' => trim((string) ($d['name'] ?? '')),
            'customName' => trim((string) ($d['displayName'] ?? '')),
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
        $data = $this->validateJson($request, [
            'messages' => 'array',
            'messages.*.from' => 'nullable|string',
            // Load-bearing: the mapper matches stored MPPV tags by message id; unlisted keys are stripped.
            'messages.*.id' => 'nullable|string|max:64',
            'messages.*.text' => 'nullable|string',
            // Load-bearing: without a rule, Laravel's validate() strips `time` from $data['messages'],
            // collapsing LiveThreadMapper's gap-based session detection to a single session. Do not remove.
            'messages.*.time' => 'nullable|string',
            'messages.*.price' => 'nullable|numeric',
            'messages.*.isFree' => 'nullable|boolean',
            'messages.*.isOpened' => 'nullable|boolean',
            'messages.*.isTip' => 'nullable|boolean',
            // Load-bearing like `time` above: unlisted keys are stripped, and without
            // `fromQueue` every mass blast would read as a chatter-sent PPV again.
            'messages.*.fromQueue' => 'nullable|boolean',
            // Load-bearing too: the fan's media count becomes legacy's CAME-WITH-MEDIA tag.
            'messages.*.mediaCount' => 'nullable|integer|min:0',
            // Deliberately rule-less nested keys: `customer` carries id/name/username, and
            // adding `customer.*` rules would strip anything not listed — the same trap
            // documented on `messages.*.time` above. The fan's name reaches the prompt.
            'customer' => 'array',
            'context' => 'nullable|string',
            // One-turn intent button (Re-pitch / Re-offer MPPV): the server builds the directive.
            'intent' => ['nullable', Rule::in(AgentIntents::serverKeys())],
            'intentOption' => 'nullable|string|max:32',
            'api' => 'nullable|in:claude,auto,mistral',
            // 'ppv' = legacy's PPV caption mode (the chatter is about to send paid content;
            // the engine writes ONE curiosity caption, no reply). See the skip rules below.
            'sender' => 'nullable|in:customer,ppv',
            // What is in the loaded PPV set (counts by type), so the price suggestion prices the
            // actual content. Caption mode only; never the set's name or preset price.
            'ppvMedia' => 'nullable|array',
            'ppvMedia.photo' => 'nullable|integer|min:0|max:40',
            'ppvMedia.video' => 'nullable|integer|min:0|max:40',
            'ppvMedia.gif' => 'nullable|integer|min:0|max:40',
            'ppvMedia.audio' => 'nullable|integer|min:0|max:40',
        ]);
        $sender = $data['sender'] ?? 'customer';
        $captionMode = $sender === 'ppv';

        // §5b support mode refuses selling intents before anything else runs (no OnlyFans call,
        // no profile row, no engine call). A read-only lookup: the overrides are server-side.
        if (StateSwitches::blocksIntent($this->profiles->find($model, $chat)?->state_overrides ?? [], $data['intent'] ?? null)) {
            return response()->json(['error' => StateSwitches::SUPPORT_ERROR], 422);
        }

        $mapped = $this->mapper->map(
            $data['messages'] ?? [],
            (int) config('services.engine.session_gap_hours', 12),
            $model->timezoneOrDefault(),
            AichMessageTag::forChat($model->name, $chat),
        );
        $messages = $mapped['messages'];

        $intent = $data['intent'] ?? null;
        $context = $data['context'] ?? '';
        $intentOption = null;
        $aftercare = null;
        $noteDropped = false;
        if ($intent !== null) {
            if ($captionMode) {
                return response()->json(['error' => "An intent can't be combined with a PPV caption."], 422);
            }
            $allowed = AgentIntents::options($intent);
            if ($allowed !== []) {
                $intentOption = $data['intentOption'] ?? null;
                if (! in_array($intentOption, $allowed, true)) {
                    return response()->json(['error' => 'Pick an option for this intent.'], 422);
                }
            }
            if ($intent === 'aftersale') {
                // Any context makes legacy skip the aftercare template, so the typed note is dropped.
                $noteDropped = trim($context) !== '';
                $context = '';
                $aftercare = ['mode' => true, 'context' => AgentIntents::aftercareContext($intentOption)];
            } else {
                try {
                    $context = AgentIntents::compose(
                        AgentIntents::directive($intent, $intentOption, $mapped['thread'], $mapped['droppedMass']),
                        $context,
                    );
                } catch (IntentUnavailable $e) {
                    return response()->json(['error' => $e->getMessage()], 422);
                }
            }
        }

        // Load-or-create the persisted fan memory (refreshes spend from OnlyFans) and
        // feed it to the engine so the brain sees a returning customer, not a $0 lurker.
        $customer = $data['customer'] ?? ['id' => $chat];
        $profile = $this->profiles->loadForGenerate($model, $account, $chat, $customer);
        $state = $this->states->find($model, $chat);

        // §5b/§5c: the thread's fan-reply / opened-PPV times drive the RLS auto-advance and the
        // counter resets; the manual switches reach the engine only when at least one is set.
        $marks = $this->threadMarks($data['messages'] ?? []);
        $overrides = $this->advanceRlsBeat($profile, $marks['fanAt']);
        $counters = $this->states->refreshCounters($state, $marks['times'], $marks['openedAt']);
        // What still applies this turn: a stale Language and, with the timewaster flag on,
        // Posture / Fan type are dropped (the flag wins; see StateSwitches::effective).
        $applied = StateSwitches::effective($overrides, (bool) $model->is_bilingual, (bool) $profile->is_timewaster);

        $startedAt = microtime(true);

        try {
            $out = $this->engine->generateFromLive($model, $messages, $customer, [
                'context' => $context,
                'aftercare' => $aftercare,
                'api' => $data['api'] ?? 'claude',
                'sender' => $sender,
                'ppvMedia' => $captionMode ? ($data['ppvMedia'] ?? null) : null,
                // SESSION spend (this conversation), derived by LiveThreadMapper from the thread's
                // opened PPVs + tips within the gap-based window. Lifetime spend still rides on
                // _profile (below). Together these drive wall state + active-buyer/tier/tip logic.
                'total_spend' => $mapped['total_spend'],
                'tips_spend' => $mapped['tips_spend'],
                'profile' => $this->profiles->toEngineProfile($profile),
                'state' => $this->states->toEngineState($state),
                'subscription_status' => $profile->subscription_status ?? 'subscribed',
                'crm_notes' => (string) ($profile->crm_notes ?? ''),
                'sexting' => $profile->sexting_mode ?? 'AUTO',
                'tipMode' => $profile->tip_mode ?? 'AUTO',
                // Drafts the chatter rejected earlier in THIS conversation, with their reasons —
                // legacy's "REJECTED RESPONSES IN THIS SESSION" block. Loaded here, not sent by the
                // client, so every chatter on the fan gets the same list.
                'rejections' => $this->rejections->toEngineFeedback(
                    $this->rejections->active($model, $chat, array_column($data['messages'] ?? [], 'time')),
                ),
                // Legacy-shaped manual switches; [] (all Auto) → EngineClient omits the key.
                'stateOverrides' => StateSwitches::toEngine($applied),
            ]);
        } catch (ConnectionException $e) {
            // ConnectionException covers BOTH "nothing is listening" and "it answered too
            // slowly", which need opposite advice: on a timeout the engine is healthy and
            // still working (the LLM calls were billed), so telling anyone to restart it is
            // wrong. cURL words a blown total timeout "Operation timed out"; the elapsed
            // check is the backstop in case that wording ever changes.
            $ceiling = (int) config('services.engine.timeout', 180);
            $timedOut = str_contains($e->getMessage(), 'Operation timed out')
                || (microtime(true) - $startedAt) >= $ceiling * 0.9;

            if ($timedOut) {
                return response()->json(['error' => "The AI engine took longer than {$ceiling}s and the request was dropped. It may still be finishing upstream — try again in a moment."], 504);
            }

            $url = (string) config('services.engine.url');
            // The `node engine/server.js` hint is only actionable on a loopback URL; in
            // Docker the engine is a container and there is no such command to run.
            $hint = str_contains($url, '127.0.0.1') || str_contains($url, 'localhost')
                ? ' Start it with `node engine/server.js`.'
                : '';

            return response()->json(['error' => "AI engine is not reachable at {$url}.".$hint], 503);
        } catch (\Throwable $e) {
            return response()->json(['error' => 'AI engine error: '.$e->getMessage()], 502);
        }

        // Folded-analysis write-back: auto-fill unlocked memory fields (skips human-pinned ones).
        // The message times decide whether this is still the conversation the memory log's
        // current entry belongs to; the zone dates a new entry on the creator's clock.
        // A caption generate is a different task from a reply: legacy forces its strategy to
        // `phase: send_content`, which would clobber the fan's real read (AI Intel is shared
        // across chatters) and the memory fields. Only the usage ledger is kept for it.
        if (! $captionMode && ! empty($out['strategy'])) {
            $this->profiles->applyAnalysis(
                $profile,
                $out['strategy'],
                array_column($data['messages'] ?? [], 'time'),
                $model->timezoneOrDefault(),
            );
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
        $telemetry = $out['telemetry'] ?? null;
        if (! $captionMode && ! empty($out['strategy'])) {
            $row = AichChatIntel::updateOrCreate(
                ['creator_model' => $model->name, 'chat_id' => $chat],
                [
                    'strategy' => $out['strategy'],
                    'generated_by' => $request->user()?->id,
                    'telemetry' => $this->autoReadTelemetry($model, $chat, $telemetry, $applied),
                ],
            );
            $generatedAt = $row->updated_at?->toIso8601String();
        }

        // Server stamps the commit-on-accept path reads for the §5c counters (count once per fan
        // message). The client relays telemetry back verbatim on Accept, so they ride along
        // without a new request field. Added only to a real telemetry object: a stamps-only
        // object would make commit() reset progress fields it otherwise leaves alone.
        if (is_array($telemetry)) {
            $telemetry += [
                'fanMessageAt' => $marks['fanAt'] !== null ? gmdate('c', $marks['fanAt']) : null,
                'openedPpvAt' => $marks['openedAt'] !== null ? gmdate('c', $marks['openedAt']) : null,
                'intent' => $intent,
                'lane' => $overrides['lane'] ?? null,
                'fanSexual' => $marks['fanSexual'],
                // The promise was forced by the switch for THIS draft (telemetry repinned), so a
                // later Accept must not store it as SSAI's progress even if the switch is back
                // to Auto by then (commit() also skips while a current override is set).
                'promisePinned' => isset($applied['promise']),
            ];
        }

        return response()->json([
            'draft' => $out['draft'] ?? '',
            'strategy' => $out['strategy'] ?? null,
            'telemetry' => $telemetry,
            'counters' => $counters,
            'rlsBeat' => isset($overrides['rls_beat']) ? (int) $overrides['rls_beat'] : null,
            'generatedAt' => $generatedAt,
            'intent' => $intent,
            'intentOption' => $intentOption,
            'noteDropped' => $noteDropped,
            // Caption mode only: legacy's price suggestion, clamped to a sendable price.
            ...($captionMode ? [
                'ppvSuggestion' => PpvPriceSuggestion::normalize($out['ppvSuggestion'] ?? null),
                // SSAI's saved plan, when it was a non-selling move that still applies (else null).
                'ppvNotReady' => $this->readiness->plan(
                    $state,
                    $data['messages'] ?? [],
                    now()->getTimestamp(),
                    (int) config('services.engine.session_gap_hours', 12) * 3600,
                ),
            ] : []),
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
            'profile' => $this->panel($model, $chat, $this->profiles->find($model, $chat)),
        ]);
    }

    /** The FanPanel payload with the §5b state card keys (auto read, counters, creator flags). */
    private function panel(AichModel $model, string $chat, ?CustomerProfile $profile): array
    {
        return $this->profiles->toPanel(
            $profile,
            $model,
            AichChatIntel::withoutGlobalScopes()->where('creator_model', $model->name)->where('chat_id', $chat)->first(),
            $this->states->find($model, $chat),
        );
    }

    /**
     * SSAI's own read for the state card's Auto rows (labels only, no text). A value the engine
     * returned only because a switch forced it (posture, promise) is not SSAI's read, so the
     * previously stored one is kept — otherwise setting a switch back to Auto would show
     * "Auto · <the forced value>" until the next generate.
     *
     * @param  array<string, mixed>|null  $telemetry
     * @param  array<string, mixed>  $overrides
     * @return array<string, mixed>|null
     */
    private function autoReadTelemetry(AichModel $model, string $chat, ?array $telemetry, array $overrides): ?array
    {
        if (! is_array($telemetry)) {
            return null;
        }
        $read = array_intersect_key($telemetry, array_flip(['posture', 'customerTier', 'promiseStatus']));
        $pinned = array_filter([
            'posture' => isset($overrides['posture']),
            'customerTier' => isset($overrides['fan_type']),
            'promiseStatus' => isset($overrides['promise']),
        ]);
        if ($pinned !== []) {
            $previous = AichChatIntel::withoutGlobalScopes()
                ->where('creator_model', $model->name)->where('chat_id', $chat)
                ->value('telemetry');
            $previous = is_string($previous) ? json_decode($previous, true) : $previous;
            foreach (array_keys($pinned) as $key) {
                $read[$key] = is_array($previous) ? ($previous[$key] ?? null) : null;
            }
        }

        return $read;
    }

    /**
     * The thread's times the §5b/§5c server logic reads: every message (ascending), the newest
     * fan message, the newest opened PPV (any priced creator message he bought, chat or mass),
     * and whether the newest fan message reads sexual (the sex-only Lane's counter signal).
     *
     * @param  list<array<string, mixed>>  $messages
     * @return array{times: list<int>, fanAt: ?int, openedAt: ?int, fanSexual: bool}
     */
    private function threadMarks(array $messages): array
    {
        $times = [];
        $fanAt = null;
        $openedAt = null;
        $fanText = '';
        foreach ($messages as $m) {
            $t = isset($m['time']) && $m['time'] !== null ? strtotime((string) $m['time']) : false;
            if ($t === false) {
                continue;
            }
            $times[] = $t;
            $creator = ($m['from'] ?? 'fan') === 'creator';
            if (! $creator && ($fanAt === null || $t >= $fanAt)) {
                $fanAt = $t;
                $fanText = (string) ($m['text'] ?? '');
            }
            if ($creator && (float) ($m['price'] ?? 0) > 0 && ! empty($m['isOpened']) && empty($m['isTip'])) {
                $openedAt = max($openedAt ?? $t, $t);
            }
        }
        sort($times);

        return ['times' => $times, 'fanAt' => $fanAt, 'openedAt' => $openedAt, 'fanSexual' => self::readsSexual($fanText)];
    }

    /**
     * A plain keyword read (EN + ES) of whether a fan message is sexual. Counter signal only.
     * Only words that are sexual on their own: everyday ones that are sexual only in context
     * ("wet", "suck", "ass", "caliente", "coger", "chupar", "pito", "coño") would count
     * "soaking wet from the rain" or "this traffic sucks" as a sex-only pull.
     */
    private static function readsSexual(string $text): bool
    {
        return (bool) preg_match(
            '/\b(nudes?|naked|horny|dick|cock|pussy|tits|boobs|sex|sexy|fuck(ing)?|cum|desnud[ao]s?|verga|chocha|tetas|sexo|follar|cachond[ao])\b/iu',
            $text,
        );
    }

    /**
     * RLS auto-advance (spec §4): a message was sent under manual beat N and the fan replied
     * after it → beat N+1 (cap 12). The marker is cleared, so the same reply can't advance it
     * twice. Returns the (possibly advanced) overrides.
     *
     * @return array<string, mixed>
     */
    private function advanceRlsBeat(CustomerProfile $profile, ?int $fanAt): array
    {
        $overrides = $profile->state_overrides ?? [];
        $sentAt = $profile->rls_beat_sent_at?->getTimestamp();
        if (! isset($overrides['rls_beat']) || $sentAt === null || $fanAt === null || $fanAt <= $sentAt) {
            return $overrides;
        }

        $overrides['rls_beat'] = min(StateSwitches::RLS_BEAT_MAX, (int) $overrides['rls_beat'] + 1);
        $profile->state_overrides = $overrides;
        $profile->rls_beat_sent_at = null;
        $profile->save();

        return $overrides;
    }

    /** Manual edit: edited AI fields get pinned, toggles/notes set, `unlock[]` re-opens fields. */
    public function updateProfile(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $data = $this->validateJson($request, [
            'archetype' => 'sometimes|nullable|string|max:120',
            'trust_level' => 'sometimes|integer|min:0|max:5',
            'temperature' => 'sometimes|nullable|string|max:20',
            // The dated memory log grows one entry per conversation, so the whole log must stay editable.
            'key_details' => 'sometimes|nullable|string|max:'.FanMemoryLog::MAX_CHARS,
            // `crm_notes` is deliberately absent: the note is owned by OnlyFans and written
            // only through the notes endpoints, which mirror it back into that column.
            'is_timewaster' => 'sometimes|boolean',
            'sexting_mode' => 'sometimes|in:AUTO,FORCE_ON,FORCE_OFF',
            'tip_mode' => 'sometimes|in:AUTO,FORCE_ON,FORCE_OFF',
            'unlock' => 'sometimes|array',
            'unlock.*' => 'string',
            // §5b state switches, merged per key (null = back to Auto). Language only for a
            // bilingual creator. Trust is not here: it stays `trust_level` + its lock.
            ...StateSwitches::rules((bool) $model->is_bilingual),
        ]);

        $profile = $this->profiles->applyManualEdit($this->profiles->findOrNew($model, $chat), $data);

        return response()->json(['profile' => $this->panel($model, $chat, $profile)]);
    }

    /**
     * Commit the carried strategy state from a generation the chatter adopted
     * (Accept / Accept & Send). This becomes the "previous" the next generate builds on.
     * Metadata only — the strategy + telemetry objects the generate response returned.
     */
    public function commitState(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $data = $this->validateJson($request, [
            'strategy' => 'required|array',
            'telemetry' => 'nullable|array',
        ]);

        // Manual switches pin their fields: commit() never stores them as SSAI progress.
        $overrides = $this->profiles->find($model, $chat)?->state_overrides ?? [];

        $this->states->commit($model, $chat, $data['strategy'], $data['telemetry'] ?? [], $request->user()?->id, $overrides);

        return response()->json(['ok' => true]);
    }

    // ---- rejected drafts (legacy "Feedback → Submit & Reject") -----------

    /** This chat's recent rejections, oldest first (the client works out which are still active). */
    public function rejections(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $this->authorizeCreator($request, $model);

        return response()->json([
            'rejections' => $this->rejections->recent($model, $chat)
                ->map(fn (AichDraftRejection $r) => $this->rejections->present($r))
                ->all(),
        ]);
    }

    /** Reject a draft with a reason; later generations in this conversation learn from it. */
    public function reject(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $data = $this->validateJson($request, [
            'draft' => 'required|string|max:4000',
            'feedback' => 'required|string|max:1000',
        ]);

        $row = AichDraftRejection::create([
            'creator_model' => $model->name,
            'chat_id' => $chat,
            'user_id' => $request->user()?->id,
            'draft' => $data['draft'],
            'feedback' => trim($data['feedback']),
        ]);

        return response()->json(['rejection' => $this->rejections->present($row->load('chatter:id,name'))], 201);
    }

    /** Stop a rejection steering the AI (e.g. it no longer applies). Scoped to this chat. */
    public function removeRejection(Request $request, AichModel $model, string $chat, int $rejection): JsonResponse
    {
        $this->authorizeCreator($request, $model);

        AichDraftRejection::withoutGlobalScopes()
            ->where('creator_model', $model->name)
            ->where('chat_id', $chat)
            ->findOrFail($rejection)
            ->delete();

        return response()->json(['ok' => true]);
    }

    // ---- helpers ----------------------------------------------------------

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

    /** TEMP debug sink — writes to a bind-mounted file readable from the host. */
    private function debugLog(string $tag, array $ctx): void
    {
        file_put_contents(
            storage_path('logs/restrict-debug.log'),
            '['.now()->toDateTimeString()."] {$tag} ".json_encode($ctx, JSON_UNESCAPED_SLASHES).PHP_EOL,
            FILE_APPEND
        );
    }
}
