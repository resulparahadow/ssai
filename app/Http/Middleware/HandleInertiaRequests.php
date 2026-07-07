<?php

namespace App\Http\Middleware;

use App\Models\AichModel;
use App\Models\User;
use Illuminate\Http\Request;
use Inertia\Middleware;

class HandleInertiaRequests extends Middleware
{
    /**
     * The root template that's loaded on the first page visit.
     *
     * @see https://inertiajs.com/server-side-setup#root-template
     *
     * @var string
     */
    protected $rootView = 'app';

    /**
     * Determines the current asset version.
     *
     * @see https://inertiajs.com/asset-versioning
     */
    public function version(Request $request): ?string
    {
        return parent::version($request);
    }

    /**
     * Define the props that are shared by default.
     *
     * @see https://inertiajs.com/shared-data
     *
     * @return array<string, mixed>
     */
    public function share(Request $request): array
    {
        return [
            ...parent::share($request),
            'name' => config('app.name'),
            'auth' => [
                'user' => $request->user(),
            ],
            // Creator models the user may work, with conversation counts — drives the
            // Conversations dropdown in the sidebar (one entry per model).
            'creators' => $this->creatorsFor($request->user()),
            'sidebarOpen' => ! $request->hasCookie('sidebar_state') || $request->cookie('sidebar_state') === 'true',
        ];
    }

    /**
     * Creator models the user may work — drives the Conversations sidebar dropdown.
     * Carries the model id (for the live /onlyfans/{model}/… URLs) + whether an
     * OnlyFans account is connected. Chats are loaded live, so no count here.
     *
     * @return list<array{id:int, name:string, hasOf:bool}>
     */
    protected function creatorsFor(?User $user): array
    {
        if (! $user) {
            return [];
        }

        $models = AichModel::query()->orderBy('name');
        if (! $user->canSeeAllCreators()) {
            $models->whereIn('name', $user->assignedCreatorModels());
        }

        return $models->get(['id', 'name', 'of_account_id'])
            ->map(fn (AichModel $m) => [
                'id' => $m->id,
                'name' => $m->name,
                'hasOf' => ! empty($m->of_account_id),
            ])
            ->all();
    }
}
