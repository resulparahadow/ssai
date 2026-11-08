<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\AuthorizesCreator;
use App\Models\AichModel;
use App\Models\PpvSet;
use App\Models\PpvSetSend;
use App\Rules\PpvPrice;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Creator-wide PPV sets (see docs/superpowers/specs/2026-11-08-ppv-sets-design.md).
 *
 * Reads are open to anyone assigned to the creator; writes sit in the route file's
 * `can:manage-team` group — managers own the library, chatters pick and send. Every lookup
 * is pinned to `{model}`'s creator_model, so a set id from another creator is a 404 here
 * even for an admin (the global scope alone would let an unrestricted role through).
 */
class PpvSetController extends Controller
{
    use AuthorizesCreator;

    public const MAX_MEDIA = 40;

    public function index(Request $request, AichModel $model): JsonResponse
    {
        $this->authorizeCreator($request, $model);

        $sets = PpvSet::withoutGlobalScopes()
            ->where('creator_model', $model->name)
            ->orderBy('sort_order')->orderBy('id')
            ->get();

        return response()->json(['sets' => $sets->map(fn (PpvSet $s) => $this->present($s, $model))->values()]);
    }

    /** SSAI's own send ledger for one fan, grouped by set, newest first (the rail's Sent/Bought pill). */
    public function status(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $this->authorizeCreator($request, $model);

        $rows = PpvSetSend::withoutGlobalScopes()
            ->where('creator_model', $model->name)
            ->where('of_fan_id', $chat)
            ->orderByDesc('sent_at')->orderByDesc('id')
            ->get(['ppv_set_id', 'of_message_id', 'price', 'sent_at']);

        $status = [];
        foreach ($rows as $r) {
            $status[(string) $r->ppv_set_id][] = [
                'sentAt' => $r->sent_at?->toIso8601String(),
                'messageId' => $r->of_message_id,
                'price' => (float) $r->price,
            ];
        }

        return response()->json(['status' => (object) $status]);
    }

    public function store(Request $request, AichModel $model): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $data = $this->validateJson($request, $this->rules(partial: false));

        $set = PpvSet::create([
            'creator_model' => $model->name,
            'name' => trim($data['name']),
            'caption' => $this->caption($data['caption'] ?? null),
            'price' => $data['price'],
            'media' => $this->cleanMedia($data['media'], $model),
            // Append after the creator's current last set (0 for the first one).
            'sort_order' => ($last = PpvSet::withoutGlobalScopes()->where('creator_model', $model->name)->max('sort_order')) === null ? 0 : (int) $last + 1,
            'created_by' => $request->user()?->id,
        ]);

        return response()->json(['set' => $this->present($set, $model)], 201);
    }

    public function update(Request $request, AichModel $model, int $set): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $row = $this->find($model, $set);
        $data = $this->validateJson($request, $this->rules(partial: true));

        $patch = [];
        if (array_key_exists('name', $data)) {
            $patch['name'] = trim($data['name']);
        }
        if (array_key_exists('caption', $data)) {
            $patch['caption'] = $this->caption($data['caption']);
        }
        if (array_key_exists('price', $data)) {
            $patch['price'] = $data['price'];
        }
        if (array_key_exists('media', $data)) {
            $patch['media'] = $this->cleanMedia($data['media'], $model);
        }
        $row->update($patch);

        return response()->json(['set' => $this->present($row->refresh(), $model)]);
    }

    public function destroy(Request $request, AichModel $model, int $set): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $this->find($model, $set)->delete(); // ppv_set_sends cascade at the DB level

        return response()->json(['ok' => true]);
    }

    /**
     * A thumb cached at save time (see cleanMedia), served from our disk. Private to the
     * creator's assigned users; a day of browser caching since the file never changes.
     */
    public function thumb(Request $request, AichModel $model, string $media): BinaryFileResponse
    {
        $this->authorizeCreator($request, $model);

        // The id becomes a path segment on our disk — digits/letters/underscore only.
        if (! preg_match('/^[A-Za-z0-9_]{1,64}$/', $media)) {
            abort(400, 'Invalid media id.');
        }

        $disk = Storage::disk('local');
        $path = self::thumbPath($model, $media);
        if (! $disk->exists($path)) {
            abort(404);
        }

        // BinaryFileResponse defaults to `public`; a creator's content thumb is not.
        return response()->file($disk->path($path))->setPrivate()->setMaxAge(86400);
    }

    /** `ids` in the wanted order → sort_order 0..n-1. Ids of other creators are ignored. */
    public function reorder(Request $request, AichModel $model): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $data = $this->validateJson($request, ['ids' => 'required|array', 'ids.*' => 'integer']);

        foreach (array_values($data['ids']) as $i => $id) {
            PpvSet::withoutGlobalScopes()
                ->where('creator_model', $model->name)
                ->whereKey($id)
                ->update(['sort_order' => $i]);
        }

        return response()->json(['ok' => true]);
    }

    // ---- helpers ----------------------------------------------------------

    /** @return array<string, mixed> */
    public function present(PpvSet $s, AichModel $model): array
    {
        return [
            'id' => $s->id,
            'name' => $s->name,
            'caption' => $s->caption,
            'price' => (float) $s->price,
            'media' => array_values(array_map(fn (array $m) => [
                'id' => (string) $m['id'],
                'type' => (string) $m['type'],
                // 'local' = cached on our disk → the per-model thumb route (a same-origin path,
                // which mediaSrc() hands to <img> untouched). Else an onlyfans CDN url, or null.
                'thumb' => ($m['thumb'] ?? null) === 'local'
                    ? "/onlyfans/{$model->id}/ppv-sets/thumb/{$m['id']}"
                    : ($m['thumb'] ?? null),
            ], $s->media ?? [])),
            'sortOrder' => (int) $s->sort_order,
            'createdAt' => $s->created_at?->toIso8601String(),
        ];
    }

    /** @return array<string, mixed> */
    private function rules(bool $partial): array
    {
        $req = $partial ? 'sometimes|required' : 'required';
        $max = self::MAX_MEDIA;

        return [
            'name' => "{$req}|string|max:120",
            'caption' => 'nullable|string|max:2000',
            'price' => [...explode('|', $req), 'numeric', new PpvPrice],
            'media' => "{$req}|array|min:1|max:{$max}",
            'media.*.id' => 'required|string|max:64',
            'media.*.type' => 'required|in:photo,video,gif,audio',
            'media.*.thumb' => 'nullable|string|max:2048', // https url, or our own thumb path (durableThumb decides)
        ];
    }

    private function find(AichModel $model, int $id): PpvSet
    {
        return PpvSet::withoutGlobalScopes()->where('creator_model', $model->name)->findOrFail($id);
    }

    private function caption(?string $caption): ?string
    {
        $caption = trim((string) $caption);

        return $caption === '' ? null : $caption;
    }

    /**
     * Keep only what we store, and make the thumb durable. Vault thumbs come in two hosts:
     * an onlyfans.com CDN url loads through the media proxy (which re-signs) for as long as
     * the media exists, so it is kept as-is; a presigned cdn.fansapi.com url expires in 15
     * minutes — and the vendor serves THAT for any media it has already re-hosted (verified
     * live 2026-11-08: the same ids came back onlyfans-hosted on first look, fansapi-hosted an
     * hour later) — so it is downloaded ONCE now (no credit: it's a direct S3 fetch of a 300px
     * jpeg) and stored as the marker 'local', which present() turns into our thumb route.
     * Any other host is dropped without a fetch.
     *
     * @param  list<array<string, mixed>>  $media
     * @return list<array{id: string, type: string, thumb: string|null}>
     */
    private function cleanMedia(array $media, AichModel $model): array
    {
        return array_values(array_map(fn (array $m) => [
            'id' => (string) $m['id'],
            'type' => (string) $m['type'],
            'thumb' => $this->durableThumb($model, (string) $m['id'], $m['thumb'] ?? null),
        ], $media));
    }

    private function durableThumb(AichModel $model, string $mediaId, ?string $url): ?string
    {
        if (! $url) {
            return null;
        }

        // Editing a set re-sends its media as the client received it — a cached thumb arrives
        // as our own thumb route (or the raw marker). Keep it as 'local' only while the file
        // is really there, and never fetch anything for it.
        if ($url === 'local' || $url === "/onlyfans/{$model->id}/ppv-sets/thumb/{$mediaId}") {
            return preg_match('/^[A-Za-z0-9_]{1,64}$/', $mediaId)
                && Storage::disk('local')->exists(self::thumbPath($model, $mediaId)) ? 'local' : null;
        }

        if (! str_starts_with($url, 'https://')) {
            return null;
        }
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));

        if ($host === 'onlyfans.com' || str_ends_with($host, '.onlyfans.com')) {
            return $url;
        }

        if (! preg_match('/(^|\.)fansapi\.com$/', $host) || ! preg_match('/^[A-Za-z0-9_]{1,64}$/', $mediaId)) {
            return null;
        }

        try {
            $res = Http::timeout(10)->get($url);
            if (! $res->successful() || $res->body() === '') {
                return null;
            }
            Storage::disk('local')->put(self::thumbPath($model, $mediaId), $res->body());

            return 'local';
        } catch (\Throwable $e) {
            Log::warning('ppv.thumb_cache_failed', ['media' => $mediaId, 'error' => $e->getMessage()]);

            return null;
        }
    }

    private static function thumbPath(AichModel $model, string $mediaId): string
    {
        return "ppv-thumbs/{$model->id}/{$mediaId}";
    }
}
