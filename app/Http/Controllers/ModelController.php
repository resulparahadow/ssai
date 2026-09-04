<?php

namespace App\Http\Controllers;

use App\Enums\UserRole;
use App\Models\AichModel;
use App\Models\ModelAssignment;
use App\Models\User;
use App\Services\OnlyFans\OnlyFansService;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;
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

    /**
     * Add a creator model straight from an OnlyFans account connected to the agency's
     * OnlyFansAPI key — the Creator Models page lists those accounts, and one click
     * brings an account into the system with its `of_account_id` already wired up.
     * The remaining fields (persona, library, tier, assignments) are set afterwards on
     * the show page, which is where this redirects.
     *
     * The id arrives from the browser, so it is checked against the LIVE account list
     * rather than trusted: that also gives us the authoritative label to name the model,
     * instead of letting the client choose one.
     */
    public function storeFromAccount(Request $request, OnlyFansService $of): RedirectResponse
    {
        $wanted = $request->validate(['of_account_id' => 'required|string|max:120'])['of_account_id'];

        if (! $of->enabled()) {
            abort(503, 'OnlyFans API key is not configured.');
        }

        $account = $this->connectedAccount($of, $wanted);

        if (! $account) {
            throw ValidationException::withMessages([
                'of_account_id' => 'That OnlyFans account is not connected to this OnlyFansAPI key.',
            ]);
        }

        if ($existing = AichModel::query()->where('of_account_id', $wanted)->first()) {
            throw ValidationException::withMessages([
                'of_account_id' => "That account is already set up as \"{$existing->name}\".",
            ]);
        }

        $model = AichModel::create([
            'name' => $this->availableName($account),
            'of_account_id' => $wanted,
        ]);

        return redirect()->route('models.show', $model)
            ->with('success', "{$model->name} added — set the persona and assignments below");
    }

    /**
     * The connected account with this id, normalised; null when it isn't connected.
     *
     * @return array<string, mixed>|null
     */
    private function connectedAccount(OnlyFansService $of, string $id): ?array
    {
        $res = $of->listAccounts();

        if (! $res->successful()) {
            throw ValidationException::withMessages([
                'of_account_id' => 'Could not reach OnlyFansAPI to confirm that account. Try again in a moment.',
            ]);
        }

        // Bare array upstream; unwrap a `data` wrapper defensively (see ModelOnlyFansController).
        $body = $res->json();
        $rows = array_is_list($body ?? []) ? $body : ($body['data'] ?? []);

        foreach (is_array($rows) ? $rows : [] as $row) {
            if (is_array($row) && ($account = $of->normalizeAccount($row))['id'] === $id) {
                return $account;
            }
        }

        return null;
    }

    /**
     * A free `aich_models.name` for this account. The name is the creator KEY that
     * assignments and sessions join on, so it has to be unique — fall back to the
     * account's @username, then a counter, rather than failing the create.
     *
     * @param  array<string, mixed>  $account
     */
    private function availableName(array $account): string
    {
        $label = trim((string) ($account['name'] ?? '')) ?: (string) ($account['id'] ?? 'Creator');
        $username = trim((string) ($account['username'] ?? ''));

        $candidates = [$label];

        if ($username !== '') {
            $candidates[] = "{$label} (@{$username})";
        }

        foreach ($candidates as $candidate) {
            if (! AichModel::query()->where('name', $candidate)->exists()) {
                return $candidate;
            }
        }

        $n = 2;

        while (AichModel::query()->where('name', "{$label} {$n}")->exists()) {
            $n++;
        }

        return "{$label} {$n}";
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
