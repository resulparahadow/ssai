<?php

namespace App\Http\Controllers;

use App\Http\Controllers\Concerns\AuthorizesCreator;
use App\Models\AichModel;
use App\Models\Script;
use App\Models\ScriptStep;
use App\Models\ScriptStepSend;
use App\Rules\PpvPrice;
use App\Services\Scripts\CreatorHeroScriptImport;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\BinaryFileResponse;

/**
 * Creator scripts: named, ordered lists of steps (text, or text + vault media + price) that
 * grew out of the PPV sets (docs/superpowers/specs/2026-11-25-scripts-design.md).
 *
 * Reads and per-fan marks are open to anyone assigned to the creator; writes sit in the
 * route file's `can:manage-team` group. Every lookup is pinned to `{model}`'s creator_model,
 * so a script or step id from another creator is a 404 here even for an admin (the global
 * scope alone would let an unrestricted role through).
 */
class ScriptController extends Controller
{
    use AuthorizesCreator;

    public const MAX_MEDIA = 40;

    public function index(Request $request, AichModel $model): JsonResponse
    {
        $this->authorizeCreator($request, $model);

        $scripts = Script::withoutGlobalScopes()
            ->where('creator_model', $model->name)
            ->with(['steps' => fn ($q) => $q->withoutGlobalScopes()])
            ->orderBy('sort_order')->orderBy('id')
            ->get();

        return response()->json(['scripts' => $scripts->map(fn (Script $s) => $this->presentScript($s, $model))->values()]);
    }

    /** SSAI's own send ledger for one fan, grouped by step, newest first (the Sent/Bought pill). */
    public function status(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $this->authorizeCreator($request, $model);

        $rows = ScriptStepSend::withoutGlobalScopes()
            ->where('creator_model', $model->name)
            ->where('of_fan_id', $chat)
            ->whereNotNull('script_step_id')
            ->orderByDesc('sent_at')->orderByDesc('id')
            ->get(['script_step_id', 'of_message_id', 'price', 'source', 'sent_at']);

        $status = [];
        foreach ($rows as $r) {
            $status[(string) $r->script_step_id][] = [
                'sentAt' => $r->sent_at?->toIso8601String(),
                'messageId' => $r->of_message_id,
                'price' => $r->price === null ? null : (float) $r->price,
                'source' => $r->source,
            ];
        }

        return response()->json(['status' => (object) $status]);
    }

    // ---- scripts ----------------------------------------------------------

    public function store(Request $request, AichModel $model): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $data = $this->validateJson($request, ['name' => 'required|string|max:120']);

        $script = Script::create([
            'creator_model' => $model->name,
            'name' => trim($data['name']),
            'sort_order' => $this->nextOrder(Script::withoutGlobalScopes()->where('creator_model', $model->name)),
            'created_by' => $request->user()?->id,
        ]);

        return response()->json(['script' => $this->presentScript($script->load('steps'), $model)], 201);
    }

    public function update(Request $request, AichModel $model, int $script): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $row = $this->findScript($model, $script);
        $data = $this->validateJson($request, ['name' => 'required|string|max:120']);

        $row->update(['name' => trim($data['name'])]);

        return response()->json(['script' => $this->presentScript($row->refresh()->load(['steps' => fn ($q) => $q->withoutGlobalScopes()]), $model)]);
    }

    /** Steps cascade at the DB level; their send-ledger rows survive (script_step_id → null). */
    public function destroy(Request $request, AichModel $model, int $script): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $row = $this->findScript($model, $script);
        $steps = ScriptStep::withoutGlobalScopes()->where('script_id', $row->id)->count();
        $row->delete();

        return response()->json(['ok' => true, 'steps' => $steps]);
    }

    /** `ids` in the wanted order → sort_order 0..n-1. Ids of other creators are ignored. */
    public function reorder(Request $request, AichModel $model): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $data = $this->validateJson($request, ['ids' => 'required|array', 'ids.*' => 'integer']);

        foreach (array_values($data['ids']) as $i => $id) {
            Script::withoutGlobalScopes()
                ->where('creator_model', $model->name)
                ->whereKey($id)
                ->update(['sort_order' => $i]);
        }

        return response()->json(['ok' => true]);
    }

    // ---- steps ------------------------------------------------------------

    public function storeStep(Request $request, AichModel $model, int $script): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $parent = $this->findScript($model, $script);
        $data = $this->validateJson($request, $this->stepRules(partial: false));

        $text = $this->text($data['text'] ?? null);
        if ($error = $this->stepError($text, $data['media'], (float) $data['price'])) {
            return response()->json(['error' => $error], 422);
        }

        $step = ScriptStep::create([
            'script_id' => $parent->id,
            'creator_model' => $model->name,
            'title' => trim($data['title']),
            'text' => $text,
            'fallback_name' => $this->text($data['fallbackName'] ?? null),
            'price' => $data['price'],
            'media' => $this->cleanMedia($data['media'], $model),
            'sort_order' => $this->nextOrder(ScriptStep::withoutGlobalScopes()->where('script_id', $parent->id)),
            'created_by' => $request->user()?->id,
        ]);

        return response()->json(['step' => $this->presentStep($step, $model)], 201);
    }

    public function updateStep(Request $request, AichModel $model, int $step): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $row = $this->findStep($model, $step);
        $data = $this->validateJson($request, $this->stepRules(partial: true) + ['scriptId' => 'sometimes|integer']);

        $patch = [];
        if (array_key_exists('title', $data)) {
            $patch['title'] = trim($data['title']);
        }
        if (array_key_exists('text', $data)) {
            $patch['text'] = $this->text($data['text']);
        }
        if (array_key_exists('fallbackName', $data)) {
            $patch['fallback_name'] = $this->text($data['fallbackName']);
        }
        if (array_key_exists('price', $data)) {
            $patch['price'] = $data['price'];
        }
        if (array_key_exists('media', $data)) {
            $patch['media'] = $this->cleanMedia($data['media'], $model);
        }

        // The rules above only see the fields sent; text-or-media and price-needs-media are
        // properties of the step as it will be stored.
        $error = $this->stepError(
            array_key_exists('text', $patch) ? $patch['text'] : $row->text,
            $patch['media'] ?? ($row->media ?? []),
            (float) ($patch['price'] ?? $row->price),
            // An imported step may hold its price while it waits for media.
            allowPriceWithoutMedia: (bool) $row->needs_media,
        );
        if ($error) {
            return response()->json(['error' => $error], 422);
        }

        if (array_key_exists('scriptId', $data) && (int) $data['scriptId'] !== (int) $row->script_id) {
            $target = Script::withoutGlobalScopes()->where('creator_model', $model->name)->find((int) $data['scriptId']);
            if (! $target) {
                return response()->json(['error' => 'Target folder not found for this creator.'], 422);
            }
            $patch['script_id'] = $target->id;
            $patch['sort_order'] = $this->nextOrder(ScriptStep::withoutGlobalScopes()->where('script_id', $target->id));
        }

        if (! empty($patch['media'])) {
            $patch['needs_media'] = false;
        }

        $row->update($patch);

        return response()->json(['step' => $this->presentStep($row->refresh(), $model)]);
    }

    public function destroyStep(Request $request, AichModel $model, int $step): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $this->findStep($model, $step)->delete(); // send-ledger rows survive (script_step_id → null)

        return response()->json(['ok' => true]);
    }

    /** `ids` in the wanted order within one script → sort_order 0..n-1. Other scripts' steps are ignored. */
    public function reorderSteps(Request $request, AichModel $model, int $script): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $parent = $this->findScript($model, $script);
        $data = $this->validateJson($request, ['ids' => 'required|array', 'ids.*' => 'integer']);

        foreach (array_values($data['ids']) as $i => $id) {
            ScriptStep::withoutGlobalScopes()
                ->where('script_id', $parent->id)
                ->whereKey($id)
                ->update(['sort_order' => $i]);
        }

        return response()->json(['ok' => true]);
    }

    // ---- CreatorHero import -----------------------------------------------

    /**
     * Upload a CreatorHero scripts export. Without `commit` it only previews; with it, every
     * script whose trimmed name is new for this creator is written in one transaction. Never
     * merges into an existing script, and the file itself is read from the temp upload and
     * dropped — nothing is stored.
     */
    public function import(Request $request, AichModel $model): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $data = $this->validateJson($request, [
            'file' => 'required|file|max:1024|mimetypes:text/csv,text/plain,application/csv,application/vnd.ms-excel|extensions:csv,txt',
            'commit' => 'nullable|boolean',
        ]);

        try {
            $parsed = (new CreatorHeroScriptImport)->parse((string) file_get_contents($request->file('file')->getRealPath()));
        } catch (\InvalidArgumentException $e) {
            return response()->json(['error' => $e->getMessage()], 422);
        }

        $existing = Script::withoutGlobalScopes()->where('creator_model', $model->name)->pluck('name')
            ->map(fn ($n) => trim((string) $n))->all();

        $scripts = [];
        $toWrite = [];
        $totals = ['scripts' => 0, 'steps' => 0, 'needsMedia' => 0, 'skipped' => 0];
        foreach ($parsed['scripts'] as $script) {
            $skipped = in_array($script['name'], $existing, true);
            $needs = count(array_filter($script['steps'], fn ($st) => $st['needsMedia']));
            $scripts[] = ['name' => $script['name'], 'steps' => count($script['steps']), 'needsMedia' => $needs, 'skipped' => $skipped];
            $totals['scripts']++;
            $totals['steps'] += count($script['steps']);
            $totals['needsMedia'] += $needs;
            if ($skipped) {
                $totals['skipped']++;
            } else {
                $toWrite[] = $script;
            }
        }

        $result = ['scripts' => $scripts, 'warnings' => $parsed['warnings'], 'totals' => $totals];

        if ($request->boolean('commit')) {
            DB::transaction(function () use ($toWrite, $model, $request) {
                $order = $this->nextOrder(Script::withoutGlobalScopes()->where('creator_model', $model->name));
                foreach ($toWrite as $script) {
                    $row = Script::create([
                        'creator_model' => $model->name,
                        'name' => $script['name'],
                        'sort_order' => $order++,
                        'created_by' => $request->user()?->id,
                    ]);
                    foreach ($script['steps'] as $step) {
                        ScriptStep::create([
                            'script_id' => $row->id,
                            'creator_model' => $model->name,
                            'title' => $step['title'],
                            'text' => $step['text'],
                            'fallback_name' => $step['fallbackName'],
                            'price' => $step['price'],
                            'media' => [],
                            'needs_media' => $step['needsMedia'],
                            'sort_order' => $step['order'],
                            'created_by' => $request->user()?->id,
                        ]);
                    }
                }
            });
            $result['created'] = count($toWrite);
        }

        return response()->json($result);
    }

    // ---- manual marks -----------------------------------------------------

    /** A chatter says "I did this step by hand" (sent outside SSAI). One manual row per fan + step. */
    public function mark(Request $request, AichModel $model, string $chat, int $step): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $row = $this->findStep($model, $step);

        $exists = ScriptStepSend::withoutGlobalScopes()
            ->where('creator_model', $model->name)
            ->where('of_fan_id', $chat)
            ->where('script_step_id', $row->id)
            ->where('source', 'manual')
            ->exists();
        if ($exists) {
            return response()->json(['ok' => true]);
        }

        ScriptStepSend::create([
            'script_step_id' => $row->id,
            'step_title' => mb_substr($row->title, 0, 120),
            'creator_model' => $model->name,
            'of_fan_id' => $chat,
            'source' => 'manual',
            'sent_at' => now(),
        ]);

        return response()->json(['ok' => true], 201);
    }

    /** Removes manual marks only — a real send stays in the ledger. */
    public function unmark(Request $request, AichModel $model, string $chat, int $step): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $row = $this->findStep($model, $step);

        ScriptStepSend::withoutGlobalScopes()
            ->where('creator_model', $model->name)
            ->where('of_fan_id', $chat)
            ->where('script_step_id', $row->id)
            ->where('source', 'manual')
            ->delete();

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

    // ---- helpers ----------------------------------------------------------

    /** @return array<string, mixed> */
    public function presentScript(Script $s, AichModel $model): array
    {
        return [
            'id' => $s->id,
            'name' => $s->name,
            'sortOrder' => (int) $s->sort_order,
            'steps' => $s->steps->map(fn (ScriptStep $st) => $this->presentStep($st, $model))->values(),
        ];
    }

    /** @return array<string, mixed> */
    public function presentStep(ScriptStep $s, AichModel $model): array
    {
        return [
            'id' => $s->id,
            'scriptId' => $s->script_id,
            'title' => $s->title,
            'text' => $s->text,
            'fallbackName' => $s->fallback_name,
            'price' => (float) $s->price,
            'media' => array_values(array_map(fn (array $m) => [
                'id' => (string) $m['id'],
                'type' => (string) $m['type'],
                // 'local' = cached on our disk → the per-model thumb route (a same-origin path,
                // which mediaSrc() hands to <img> untouched). Else an onlyfans CDN url, or null.
                'thumb' => ($m['thumb'] ?? null) === 'local'
                    ? "/onlyfans/{$model->id}/scripts/thumb/{$m['id']}"
                    : ($m['thumb'] ?? null),
            ], $s->media ?? [])),
            'kind' => $s->kind,
            'needsMedia' => (bool) $s->needs_media,
            'sortOrder' => (int) $s->sort_order,
        ];
    }

    /** @return array<string, mixed> */
    private function stepRules(bool $partial): array
    {
        $req = $partial ? 'sometimes|required' : 'required';
        $list = $partial ? 'sometimes' : 'present';
        $max = self::MAX_MEDIA;

        return [
            'title' => "{$req}|string|max:120",
            'text' => 'nullable|string|max:2000',
            'fallbackName' => 'nullable|string|max:60',
            'price' => [...explode('|', $req), 'numeric', new PpvPrice],
            'media' => "{$list}|array|max:{$max}",
            'media.*.id' => 'required|string|max:64',
            'media.*.type' => 'required|in:photo,video,gif,audio',
            'media.*.thumb' => 'nullable|string|max:2048', // https url, or our own thumb path (durableThumb decides)
        ];
    }

    /** A step needs text or media, and a price needs media. Null when fine. */
    private function stepError(?string $text, array $media, float $price, bool $allowPriceWithoutMedia = false): ?string
    {
        // `$allowPriceWithoutMedia` is the step's needs_media flag: it is waiting for its media,
        // so it may also have no text yet.
        if ($text === null && $media === [] && ! $allowPriceWithoutMedia) {
            return 'A script needs text or media.';
        }
        if ($price > 0 && $media === [] && ! $allowPriceWithoutMedia) {
            return 'A price needs media.';
        }

        return null;
    }

    private function findScript(AichModel $model, int $id): Script
    {
        return Script::withoutGlobalScopes()->where('creator_model', $model->name)->findOrFail($id);
    }

    private function findStep(AichModel $model, int $id): ScriptStep
    {
        return ScriptStep::withoutGlobalScopes()->where('creator_model', $model->name)->findOrFail($id);
    }

    /** Append after the current last row (0 for the first one). */
    private function nextOrder(Builder $query): int
    {
        $last = $query->max('sort_order');

        return $last === null ? 0 : (int) $last + 1;
    }

    private function text(?string $value): ?string
    {
        $value = trim((string) $value);

        return $value === '' ? null : $value;
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

        // Editing a step re-sends its media as the client received it — a cached thumb arrives
        // as our own thumb route (or the raw marker). Keep it as 'local' only while the file
        // is really there, and never fetch anything for it.
        // The pre-rename `ppv-sets` route still counts: an old client tab may re-send it.
        if ($url === 'local'
            || $url === "/onlyfans/{$model->id}/scripts/thumb/{$mediaId}"
            || $url === "/onlyfans/{$model->id}/ppv-sets/thumb/{$mediaId}") {
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
            Log::warning('script.thumb_cache_failed', ['media' => $mediaId, 'error' => $e->getMessage()]);

            return null;
        }
    }

    private static function thumbPath(AichModel $model, string $mediaId): string
    {
        return "ppv-thumbs/{$model->id}/{$mediaId}";
    }
}
