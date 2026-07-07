<?php

namespace App\Models;

// use Illuminate\Contracts\Auth\MustVerifyEmail;
use App\Enums\UserRole;
use Database\Factories\UserFactory;
use Illuminate\Database\Eloquent\Attributes\Fillable;
use Illuminate\Database\Eloquent\Attributes\Hidden;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Illuminate\Support\Carbon;
use Laravel\Fortify\Contracts\PasskeyUser;
use Laravel\Fortify\PasskeyAuthenticatable;
use Laravel\Fortify\TwoFactorAuthenticatable;

/**
 * @property int $id
 * @property string $name
 * @property string $email
 * @property UserRole $role
 * @property bool $must_change_password
 * @property Carbon|null $email_verified_at
 * @property string $password
 * @property string|null $two_factor_secret
 * @property string|null $two_factor_recovery_codes
 * @property Carbon|null $two_factor_confirmed_at
 * @property string|null $remember_token
 * @property Carbon|null $created_at
 * @property Carbon|null $updated_at
 */
#[Fillable(['name', 'email', 'password', 'role', 'must_change_password'])]
#[Hidden(['password', 'two_factor_secret', 'two_factor_recovery_codes', 'remember_token'])]
class User extends Authenticatable implements PasskeyUser
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable, PasskeyAuthenticatable, TwoFactorAuthenticatable;

    /**
     * Get the attributes that should be cast.
     *
     * @return array<string, string>
     */
    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'two_factor_confirmed_at' => 'datetime',
            'role' => UserRole::class,
            'must_change_password' => 'boolean',
        ];
    }

    // ---- Role helpers (delegate to the enum) -------------------------------

    public function isAdmin(): bool
    {
        return $this->role === UserRole::Admin;
    }

    public function isManager(): bool
    {
        return $this->role === UserRole::Manager;
    }

    public function isChatter(): bool
    {
        return $this->role === UserRole::Chatter;
    }

    public function canSeeAllCreators(): bool
    {
        return $this->role->canSeeAllCreators();
    }

    // ---- Relationships -----------------------------------------------------

    /** @return HasMany<ModelAssignment, $this> */
    public function modelAssignments(): HasMany
    {
        return $this->hasMany(ModelAssignment::class);
    }

    /** @return HasMany<AichSession, $this> */
    public function sessions(): HasMany
    {
        return $this->hasMany(AichSession::class);
    }

    /**
     * Creator-model names this user may work. Admins/managers are not limited
     * here (the global CreatorAccessScope leaves their queries unscoped).
     *
     * @return list<string>
     */
    public function assignedCreatorModels(): array
    {
        return $this->modelAssignments()->pluck('creator_model')->all();
    }
}
