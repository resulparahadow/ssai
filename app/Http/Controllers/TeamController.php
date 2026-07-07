<?php

namespace App\Http\Controllers;

use App\Concerns\PasswordValidationRules;
use App\Concerns\ProfileValidationRules;
use App\Enums\UserRole;
use App\Models\AichModel;
use App\Models\ModelAssignment;
use App\Models\User;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;
use Illuminate\Validation\Rules\Password;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Team & roles: admins/managers manage users. Gated by `manage-team` on the routes
 * (both roles may view). Admins create/edit/delete any role; managers may only touch
 * chatters and may only create chatters (target-level rules live in UserPolicy +
 * the assignable-role allowlist below). Chatters can be assigned creator models here,
 * writing the same `model_assignments` table the Creator Models page uses.
 */
class TeamController extends Controller
{
    use PasswordValidationRules, ProfileValidationRules;

    public function index(Request $request): Response
    {
        $assignments = ModelAssignment::query()->get()->groupBy('user_id');
        $meId = $request->user()->id;

        return Inertia::render('Team', [
            'users' => User::query()->orderBy('name')->get()->map(fn (User $u) => [
                'id' => $u->id,
                'name' => $u->name,
                'email' => $u->email,
                'role' => $u->role->value,
                'must_change_password' => $u->must_change_password,
                'assigned' => $assignments->get($u->id, collect())->pluck('creator_model')->values()->all(),
                'is_self' => $u->id === $meId,
            ]),
            'assignableCreators' => AichModel::query()->orderBy('name')->pluck('name')->all(),
            'assignableRoles' => $this->assignableRoles($request->user()),
        ]);
    }

    public function store(Request $request): RedirectResponse
    {
        $data = $request->validate([
            ...$this->profileRules(),
            'password' => $this->passwordRules(),
            'role' => ['required', Rule::in($this->assignableRoles($request->user()))],
            'must_change_password' => ['sometimes', 'boolean'],
            'assigned' => ['array'],
            'assigned.*' => ['string', 'exists:aich_models,name'],
        ]);

        $user = User::create([
            'name' => $data['name'],
            'email' => $data['email'],
            'password' => $data['password'],
            'role' => $data['role'],
            'must_change_password' => $request->boolean('must_change_password'),
        ]);
        // email_verified_at is guarded — set it directly so admin-created accounts can
        // reach the `verified`-gated settings pages without an email round-trip.
        $user->email_verified_at = now();
        $user->save();

        $this->syncAssignments($user, $data['assigned'] ?? []);

        return back()->with('success', "{$user->name} added");
    }

    public function update(Request $request, User $user): RedirectResponse
    {
        Gate::authorize('update', $user);
        $actor = $request->user();

        $data = $request->validate([
            ...$this->profileRules($user->id),
            'role' => ['required', Rule::in($this->assignableRoles($actor))],
            'password' => ['nullable', 'string', 'confirmed', Password::default()],
            'must_change_password' => ['sometimes', 'boolean'],
            'assigned' => ['array'],
            'assigned.*' => ['string', 'exists:aich_models,name'],
        ]);

        abort_if(
            $actor->id === $user->id && $data['role'] !== $user->role->value,
            403,
            'You cannot change your own role.',
        );

        $update = [
            'name' => $data['name'],
            'email' => $data['email'],
            'role' => $data['role'],
        ];

        if ($request->filled('password')) {
            $update['password'] = $data['password'];
        }

        if ($request->has('must_change_password')) {
            $update['must_change_password'] = $request->boolean('must_change_password');
        }

        $user->update($update);
        $this->syncAssignments($user, $data['assigned'] ?? []);

        return back()->with('success', "{$user->name} saved");
    }

    public function destroy(Request $request, User $user): RedirectResponse
    {
        Gate::authorize('delete', $user);

        abort_if(
            $user->isAdmin() && User::query()->where('role', UserRole::Admin)->count() === 1,
            403,
            'Cannot delete the last admin.',
        );

        $name = $user->name;
        $user->delete();

        return back()->with('success', "{$name} removed");
    }

    /** Roles the actor is permitted to assign: admins any, everyone else chatter only. */
    private function assignableRoles(User $actor): array
    {
        return $actor->isAdmin()
            ? array_map(fn (UserRole $r) => $r->value, UserRole::cases())
            : [UserRole::Chatter->value];
    }

    /**
     * Replace a user's creator-model assignments (delete-all-then-recreate, mirroring
     * ModelController::assignments but keyed by user).
     *
     * @param  list<string>  $creatorNames
     */
    private function syncAssignments(User $user, array $creatorNames): void
    {
        ModelAssignment::query()->where('user_id', $user->id)->delete();

        foreach (array_unique($creatorNames) as $name) {
            ModelAssignment::create(['user_id' => $user->id, 'creator_model' => $name]);
        }
    }
}
