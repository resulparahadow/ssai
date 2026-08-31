<?php

namespace App\Support;

use App\Models\AichModel;
use App\Models\User;
use Illuminate\Http\Request;

/**
 * Resolves the app-wide "creator context" — which creator (or "all creators") a request
 * operates within — from the untrusted `ss_creator` cookie, validated against the user's
 * scoped creators. Mirrors the client rules in resources/js/composables/useCreatorContext.ts
 * so SSR pages and the sidebar selector agree on first paint.
 *
 * The cookie is NEVER an authorization path: aggregate services still filter by user_id /
 * CreatorAccessScope; this context only narrows an already-authorized result set. A stale or
 * tampered value falls back to the role default (managers/admins → all; chatters → first
 * assigned creator).
 */
class CreatorContext
{
    /** The cookie carrying the browser's creator-context selection. */
    public const COOKIE = 'ss_creator';

    /**
     * Resolve from a request (reads + normalizes the `ss_creator` cookie).
     *
     * @param  list<array{id:int, name:string}>|null  $scopedCreators
     * @return array{selectedId: int|null, mode: 'all'|'creator', canSeeAll: bool}
     */
    public function resolveRequest(Request $request, ?array $scopedCreators = null): array
    {
        return $this->resolve($request->user(), $this->cookieFrom($request), $scopedCreators);
    }

    /** The creator name to filter by for a request, or null for "all creators". */
    public function selectedNameForRequest(Request $request, ?array $scopedCreators = null): ?string
    {
        return $this->selectedName($request->user(), $this->cookieFrom($request), $scopedCreators);
    }

    /**
     * @param  list<array{id:int, name:string}>|null  $scopedCreators  Pre-fetched scoped
     *                                                                 creators (e.g. HandleInertiaRequests::creatorsFor) to avoid a second query.
     * @return array{selectedId: int|null, mode: 'all'|'creator', canSeeAll: bool}
     */
    public function resolve(?User $user, ?string $cookie, ?array $scopedCreators = null): array
    {
        if (! $user) {
            return ['selectedId' => null, 'mode' => 'all', 'canSeeAll' => false];
        }

        $canSeeAll = $user->canSeeAllCreators();
        $creators = $scopedCreators ?? $this->scopedCreators($user);
        $ids = array_map(static fn (array $c): int => (int) $c['id'], $creators);

        $wantId = $this->parseId($cookie);

        // A specific creator the caller may access.
        if ($wantId !== null && in_array($wantId, $ids, true)) {
            return ['selectedId' => $wantId, 'mode' => 'creator', 'canSeeAll' => $canSeeAll];
        }

        // "All creators" — managers/admins only.
        if ($cookie === 'all' && $canSeeAll) {
            return ['selectedId' => null, 'mode' => 'all', 'canSeeAll' => true];
        }

        // Default: managers/admins aggregate; chatters pin to their first assigned creator.
        if ($canSeeAll) {
            return ['selectedId' => null, 'mode' => 'all', 'canSeeAll' => true];
        }

        return [
            'selectedId' => $ids[0] ?? null,
            'mode' => 'creator',
            'canSeeAll' => false,
        ];
    }

    /**
     * The creator NAME to filter aggregate queries by, or null for "all creators" (no filter).
     * `creator_model` columns store the name, so services key on this.
     *
     * @param  list<array{id:int, name:string}>|null  $scopedCreators
     */
    public function selectedName(?User $user, ?string $cookie, ?array $scopedCreators = null): ?string
    {
        if (! $user) {
            return null;
        }

        $creators = $scopedCreators ?? $this->scopedCreators($user);
        $ctx = $this->resolve($user, $cookie, $creators);

        if ($ctx['selectedId'] === null) {
            return null;
        }

        foreach ($creators as $c) {
            if ((int) $c['id'] === $ctx['selectedId']) {
                return (string) $c['name'];
            }
        }

        return null;
    }

    /**
     * Creators the user may access (id + name), scoped exactly like
     * HandleInertiaRequests::creatorsFor (ordered by name, so the "first" default matches).
     *
     * @return list<array{id:int, name:string}>
     */
    private function scopedCreators(User $user): array
    {
        $q = AichModel::query()->orderBy('name');

        if (! $user->canSeeAllCreators()) {
            $q->whereIn('name', $user->assignedCreatorModels());
        }

        return $q->get(['id', 'name'])
            ->map(static fn (AichModel $m): array => [
                'id' => (int) $m->id,
                'name' => (string) $m->name,
            ])
            ->all();
    }

    private function cookieFrom(Request $request): ?string
    {
        $cookie = $request->cookie(self::COOKIE);

        return is_string($cookie) ? $cookie : null;
    }

    private function parseId(?string $cookie): ?int
    {
        if ($cookie === null || $cookie === '' || $cookie === 'all') {
            return null;
        }

        return ctype_digit($cookie) ? (int) $cookie : null;
    }
}
