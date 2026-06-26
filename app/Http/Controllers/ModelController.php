<?php

namespace App\Http\Controllers;

use App\Enums\UserRole;
use App\Models\AichModel;
use App\Models\ModelAssignment;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Creator model settings (legacy "Creator Models"): persona prompt, content
 * library, learned rules, OnlyFans account, tier, and chatter assignments.
 * Manager/admin only — gated by the `manage-team` ability on the routes.
 */
class ModelController extends Controller
{
    public function index(): Response
    {
        $assignments = ModelAssignment::query()->get()->groupBy('creator_model');

        return Inertia::render('Models', [
            'models' => AichModel::query()->orderBy('name')->get()->map(fn (AichModel $m) => [
                'id' => $m->id,
                'name' => $m->name,
                'tier' => $m->tier,
                'prompt' => $m->prompt,
                'content_library' => $m->content_library,
                'feedback_rules' => $m->feedback_rules,
                'of_account_id' => $m->of_account_id,
                'assigned' => $assignments->get($m->name, collect())->pluck('user_id')->values(),
            ]),
            'chatters' => User::query()
                ->whereIn('role', [UserRole::Chatter, UserRole::Manager])
                ->orderBy('name')->get(['id', 'name', 'role'])
                ->map(fn (User $u) => ['id' => $u->id, 'name' => $u->name, 'role' => $u->role->value]),
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $data = $this->validateModel($request, null);
        AichModel::create($data);

        return back()->with('success', "{$data['name']} created");
    }

    public function update(Request $request, AichModel $model): RedirectResponse
    {
        $model->update($this->validateModel($request, $model->id));

        return back()->with('success', "{$model->name} saved");
    }

    public function destroy(AichModel $model): RedirectResponse
    {
        $name = $model->name;
        ModelAssignment::query()->where('creator_model', $name)->delete();
        $model->delete();

        return back()->with('success', "{$name} deleted");
    }

    public function assignments(Request $request, AichModel $model): RedirectResponse
    {
        $data = $request->validate([
            'user_ids' => 'array',
            'user_ids.*' => 'integer|exists:users,id',
        ]);

        ModelAssignment::query()->where('creator_model', $model->name)->delete();
        foreach (array_unique($data['user_ids'] ?? []) as $userId) {
            ModelAssignment::create(['user_id' => $userId, 'creator_model' => $model->name]);
        }

        return back()->with('success', "{$model->name} assignments updated");
    }

    /** @return array<string, mixed> */
    private function validateModel(Request $request, ?int $ignoreId): array
    {
        return $request->validate([
            'name' => 'required|string|max:120|unique:aich_models,name'.($ignoreId ? ",{$ignoreId}" : ''),
            'tier' => 'nullable|string|max:120',
            'prompt' => 'nullable|string',
            'content_library' => 'nullable|string',
            'feedback_rules' => 'nullable|string',
            'of_account_id' => 'nullable|string|max:120',
        ]);
    }
}
