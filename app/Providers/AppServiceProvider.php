<?php

namespace App\Providers;

use App\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\Date;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        //
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        $this->configureDefaults();
        $this->configureGates();
    }

    /**
     * Role gates — the server-backed half of the design's role-gated widgets.
     * The Vue shell hides UI per role; these gates enforce it on the server so
     * hiding alone is never the access control.
     */
    protected function configureGates(): void
    {
        Gate::define('view-all-creators', fn (User $user): bool => $user->role->canSeeAllCreators());
        Gate::define('manage-team', fn (User $user): bool => $user->role->canManageTeam());
        Gate::define('view-agency-profit', fn (User $user): bool => $user->role->canViewAgencyProfit());
        Gate::define('edit-global-training', fn (User $user): bool => $user->role->isAdmin());
    }

    /**
     * Configure default behaviors for production-ready applications.
     */
    protected function configureDefaults(): void
    {
        Date::use(CarbonImmutable::class);

        DB::prohibitDestructiveCommands(
            app()->isProduction(),
        );

        Password::defaults(fn (): ?Password => app()->isProduction()
            ? Password::min(12)
                ->mixedCase()
                ->letters()
                ->numbers()
                ->symbols()
                ->uncompromised()
            : null,
        );
    }
}
