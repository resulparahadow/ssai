<?php

namespace Database\Seeders;

use App\Enums\UserRole;
use App\Models\AichModel;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Facades\Hash;

/**
 * The minimal, real data a fresh production install needs — no demo roster.
 *
 *   1. A first admin user (credentials from ADMIN_* env, never hard-coded).
 *   2. A single "Test" creator model (connect an OnlyFans account later, or
 *      set TEST_MODEL_OF_ACCOUNT_ID to wire it now).
 *
 * Idempotent: safe to re-run. Run it with:
 *   php artisan db:seed --class=ProductionSeeder --force
 *
 * (The `doctrines` table is intentionally NOT seeded here — the Node engine
 * carries its own DEFAULT_TRAINING copy and nothing in the running app reads
 * that table yet. Seed it locally with DoctrineSeeder if/when needed.)
 */
class ProductionSeeder extends Seeder
{
    public function run(): void
    {
        $this->seedAdmin();
        $this->seedTestModel();
    }

    private function seedAdmin(): void
    {
        $password = config('seeding.admin.password');

        if (blank($password)) {
            $this->command?->warn('Skipped admin user — set ADMIN_PASSWORD to seed the first admin.');

            return;
        }

        $email = config('seeding.admin.email');

        User::updateOrCreate(['email' => $email], [
            'name' => config('seeding.admin.name'),
            'role' => UserRole::Admin,
            'password' => Hash::make($password),
            'email_verified_at' => now(),
        ]);

        $this->command?->info("Seeded admin user: {$email}");
    }

    private function seedTestModel(): void
    {
        $name = config('seeding.test_model.name');

        AichModel::updateOrCreate(['name' => $name], [
            'tier' => 'standard',
            'of_account_id' => config('seeding.test_model.of_account_id') ?: null,
        ]);

        $this->command?->info("Seeded creator model: {$name}");
    }
}
