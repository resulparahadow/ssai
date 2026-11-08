<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\AuthorizesCreator;
use App\Models\AichModel;
use App\Models\PpvSet;
use App\Models\PpvSetSend;
use App\Rules\PpvPrice;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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

        return response()->json(['sets' => $sets->map(fn (PpvSet $s) => $this->present($s))->values()]);
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
            'media' => $this->cleanMedia($data['media']),
            // Append after the creator's current last set (0 for the first one).
            'sort_order' => ($last = PpvSet::withoutGlobalScopes()->where('creator_model', $model->name)->max('sort_order')) === null ? 0 : (int) $last + 1,
            'created_by' => $request->user()?->id,
        ]);

        return response()->json(['set' => $this->present($set)], 201);
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
            $patch['media'] = $this->cleanMedia($data['media']);
        }
        $row->update($patch);

        return response()->json(['set' => $this->present($row->refresh())]);
    }

    public function destroy(Request $request, AichModel $model, int $set): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $this->find($model, $set)->delete(); // ppv_set_sends cascade at the DB level

        return response()->json(['ok' => true]);
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
    public function present(PpvSet $s): array
    {
        return [
            'id' => $s->id,
            'name' => $s->name,
            'caption' => $s->caption,
            'price' => (float) $s->price,
            'media' => array_values(array_map(fn (array $m) => [
                'id' => (string) $m['id'],
                'type' => (string) $m['type'],
                'thumb' => $m['thumb'] ?? null,
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
            'media.*.thumb' => 'nullable|string|url|max:2048',
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
     * Keep only what we store, and drop any thumb that is not onlyfans-hosted: a presigned
     * cdn.fansapi.com url expires in 15 minutes, while an onlyfans.com one loads through the
     * media proxy (which re-signs) for as long as the media exists.
     *
     * @param  list<array<string, mixed>>  $media
     * @return list<array{id: string, type: string, thumb: string|null}>
     */
    private function cleanMedia(array $media): array
    {
        return array_values(array_map(fn (array $m) => [
            'id' => (string) $m['id'],
            'type' => (string) $m['type'],
            'thumb' => self::safeThumb($m['thumb'] ?? null),
        ], $media));
    }

    public static function safeThumb(?string $url): ?string
    {
        if (! $url) {
            return null;
        }
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));

        return $host === 'onlyfans.com' || str_ends_with($host, '.onlyfans.com') ? $url : null;
    }
}
