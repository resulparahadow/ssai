<?php

namespace Database\Seeders;

use App\Enums\UserRole;
use App\Models\AichMessage;
use App\Models\AichModel;
use App\Models\AichSession;
use App\Models\CustomerProfile;
use App\Models\ModelAssignment;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Hash;

/**
 * Seeds a realistic demo dataset for the Overview dashboard: an owner, a
 * manager, four chatters, eight creators, and customers/sessions/messages
 * spread across the last 30 days (with a slice today) so Today / 7d / 30d all
 * render. Intended for a fresh `php artisan migrate:fresh --seed`.
 */
class DashboardSeeder extends Seeder
{
    /** @var list<array{string,float}> creator name + revenue weight */
    private array $creators = [
        ['Camila', 1.0], ['Yendry', 0.78], ['Aria', 0.5], ['Mia', 0.42],
        ['Sienna', 0.3], ['Nova', 0.24], ['Luna', 0.18], ['Elle', 0.12],
    ];

    public function run(): void
    {
        mt_srand(42); // deterministic demo data

        $owner = $this->user('Admin Owner', 'admin@smartstars.test', UserRole::Admin);
        $sofia = $this->user('Sofia Marin', 'manager@smartstars.test', UserRole::Manager);
        $chatters = [
            $sofia,
            $this->user('Priya Kapoor', 'priya@smartstars.test', UserRole::Chatter),
            $this->user('Diego Alvarez', 'diego@smartstars.test', UserRole::Chatter),
            $this->user('Marco Vidal', 'marco@smartstars.test', UserRole::Chatter),
            $this->user('Lena Toth', 'lena@smartstars.test', UserRole::Chatter),
        ];

        foreach ($this->creators as $i => [$name]) {
            AichModel::updateOrCreate(['name' => $name], ['tier' => 'standard']);

            // Assign each creator to two rotating chatters.
            foreach ([$chatters[$i % count($chatters)], $chatters[($i + 1) % count($chatters)]] as $c) {
                ModelAssignment::updateOrCreate(['user_id' => $c->id, 'creator_model' => $name]);
            }
        }

        foreach ($this->creators as $i => [$name, $weight]) {
            $assigned = [$chatters[$i % count($chatters)], $chatters[($i + 1) % count($chatters)]];
            $customerCount = (int) round(12 + $weight * 24);

            for ($n = 0; $n < $customerCount; $n++) {
                $when = $this->randomDate();
                $isPaid = mt_rand(0, 100) < 62;
                $username = strtolower($name).'_fan'.$n;
                $chatter = $assigned[mt_rand(0, 1)];

                $spend = $isPaid ? round((10 + mt_rand(0, 90)) * $weight + mt_rand(0, 25), 2) : 0.0;
                $tips = $isPaid && mt_rand(0, 100) < 40 ? round(mt_rand(5, 60) * $weight, 2) : 0.0;

                CustomerProfile::create([
                    'creator_model' => $name,
                    'customer_username' => $username,
                    'customer_name' => ucfirst($username),
                    'subscription_status' => $isPaid ? 'paid' : 'free',
                    'total_spend' => $spend,
                    'tips_spend' => $tips,
                    'trust_level' => mt_rand(0, 5),
                    'created_at' => $when,
                    'updated_at' => $when,
                ]);

                if ($spend > 0 || $tips > 0) {
                    $session = AichSession::create([
                        'user_id' => $chatter->id,
                        'creator_model' => $name,
                        'customer_username' => $username,
                        'customer_name' => ucfirst($username),
                        'status' => 'active',
                        'total_spend' => $spend,
                        'tips_spend' => $tips,
                        'last_active_at' => $when,
                        'created_at' => $when,
                        'updated_at' => $when,
                    ]);

                    foreach (range(1, mt_rand(2, 6)) as $m) {
                        AichMessage::create([
                            'session_id' => $session->id,
                            'user_id' => $chatter->id,
                            'creator_model' => $name,
                            'customer_username' => $username,
                            'sender' => 'creator',
                            'text' => 'demo message',
                            'was_sent' => true,
                            'created_at' => $when,
                            'updated_at' => $when,
                        ]);
                    }
                }
            }
        }

        $this->command?->info('Seeded demo dashboard data. Login: admin@smartstars.test / password (also manager@, priya@, diego@, marco@, lena@).');
    }

    private function user(string $name, string $email, UserRole $role): User
    {
        return User::updateOrCreate(['email' => $email], [
            'name' => $name,
            'role' => $role,
            'password' => Hash::make('password'),
            'email_verified_at' => now(),
        ]);
    }

    /** Bias dates toward recent days; ~25% land today so the Today period is populated. */
    private function randomDate(): Carbon
    {
        if (mt_rand(0, 100) < 25) {
            return Carbon::today()->addHours(mt_rand(0, 22))->addMinutes(mt_rand(0, 59));
        }

        return Carbon::today()->subDays(mt_rand(1, 29))->addHours(mt_rand(8, 22));
    }
}
