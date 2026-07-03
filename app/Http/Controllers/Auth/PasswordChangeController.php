<?php

namespace App\Http\Controllers\Auth;

use App\Concerns\PasswordValidationRules;
use App\Http\Controllers\Controller;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Inertia\Inertia;
use Inertia\Response;

/**
 * Forced first-login password change. Admin-created users are given a temporary password
 * with must_change_password = true; RequirePasswordChange sends them here until they set
 * a new one.
 */
class PasswordChangeController extends Controller
{
    use PasswordValidationRules;

    public function edit(): Response
    {
        return Inertia::render('PasswordChange');
    }

    public function update(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'password' => $this->passwordRules(),
        ]);

        $request->user()->update([
            'password' => $data['password'],
            'must_change_password' => false,
        ]);

        return redirect()->intended('/dashboard');
    }
}
