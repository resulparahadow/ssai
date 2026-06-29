<?php

namespace App\Http\Controllers;

use App\Enums\UserRole;
use App\Models\AichModel;
use App\Models\ModelAssignment;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
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
            'models' => AichModel::query()->orderBy('name')->get()->map(
                fn (AichModel $m) => $this->serializeModel($m, $assignments->get($m->name, collect())->pluck('user_id')->values()->all())
            ),
            'chatters' => $this->chatters(),
        ]);
    }

    public function show(AichModel $model): Response
    {
        $assigned = ModelAssignment::query()->where('creator_model', $model->name)->pluck('user_id')->values()->all();

        return Inertia::render('ModelShow', [
            'model' => $this->serializeModel($model, $assigned),
            'connected' => ! empty($model->of_account_id),
            'chatters' => $this->chatters(),
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

    /**
     * @param  list<int>  $assigned
     * @return array<string, mixed>
     */
    private function serializeModel(AichModel $model, array $assigned): array
    {
        return [
            'id' => $model->id,
            'name' => $model->name,
            'tier' => $model->tier,
            'prompt' => $model->prompt,
            'content_library' => $model->content_library,
            'feedback_rules' => $model->feedback_rules,
            'of_account_id' => $model->of_account_id,
            'assigned' => $assigned,
        ];
    }

    /** Chatters + managers, for the assignment editor. */
    private function chatters(): Collection
    {
        return User::query()
            ->whereIn('role', [UserRole::Chatter, UserRole::Manager])
            ->orderBy('name')->get(['id', 'name', 'role'])
            ->map(fn (User $u) => ['id' => $u->id, 'name' => $u->name, 'role' => $u->role->value]);
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
