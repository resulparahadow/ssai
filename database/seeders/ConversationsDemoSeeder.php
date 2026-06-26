<?php

namespace Database\Seeders;

use App\Models\AichModel;
use App\Models\AichSession;
use App\Models\CustomerProfile;
use App\Models\ModelAssignment;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;

/**
 * Demo roster for the Conversations + Models views (mirrors the new design):
 * two creators with full personas, five conversations with messages + fan-intel,
 * and chatter assignments so role-scoping is demoable. Dev fixture only.
 */
class ConversationsDemoSeeder extends Seeder
{
    public function run(): void
    {
        $personas = [
            'Camila' => [
                'tier' => 'Top 0.03% · ~300 new subs/day',
                'prompt' => 'You are Camila, a warm, playful 24-year-old Colombian creator. Lowercase casual texting, flirty, never robotic. Confident and affectionate; tease lightly and make him feel special without sounding like a store. English, and natural accent-correct Spanish when he does. Keep replies short unless he writes long.',
                'content_library' => "Tier 1 ($15-25): solo teasing photo sets.\nTier 2 ($30-50): solo videos.\nTier 3 ($60+): custom clips.",
            ],
            'Yendry' => [
                'tier' => 'Lightly clouded · ~20 subs/day',
                'prompt' => 'You are Yendry, a caring, down-to-earth creator who leads with warmth and attention. Lowercase casual texting. You make fans feel looked-after; flirtation is secondary to connection. Keep it human and unhurried.',
                'content_library' => "Tier 1 ($15-20): photo sets.\nTier 2 ($25-45): videos.\nBundles ($35): full set.",
            ],
        ];

        $byCreatorChatter = [
            'Camila' => User::where('email', 'priya@smartstars.test')->first(),
            'Yendry' => User::where('email', 'diego@smartstars.test')->first(),
        ];

        foreach ($personas as $name => $p) {
            AichModel::updateOrCreate(['name' => $name], $p);
            $chatter = $byCreatorChatter[$name];
            if ($chatter) {
                ModelAssignment::updateOrCreate(['user_id' => $chatter->id, 'creator_model' => $name]);
            }
        }

        $convos = [
            ['Camila', 'jake_w', 'Jake', 2, 'Relationship', 'warm', 42.40, 50.00,
                "Home Friday night; refers to girlfriend as 'cat'.\nTipped $50 after a voice note. Responds to playful teasing.",
                [['customer', 'nothing special, gonna be home with my cat'], ['model', "a cat person 🐱 what's their name?"], ['customer', 'haha i call my gf "cat" 😏'], ['model', "haha okay you got me — what's your friday looking like then?"], ['customer', 'pretty open honestly']]],
            ['Camila', 'm_reyes', 'Marcus', 1, 'New fan', 'cold', 0, 0,
                'Followed from a free promo. No data yet.',
                [['customer', 'hey just followed you'], ['customer', 'big fan']]],
            ['Camila', 'dev_88', 'Devin', 4, 'Loyalist', 'hot', 278.00, 140.00,
                "Bought the $120 bundle without negotiation.\nAsks for custom content. High willingness to pay.",
                [['model', 'hey trouble, missed you yesterday 🥰'], ['customer', 'been thinking about you. you free later tonight?']]],
            ['Yendry', 'theo_k', 'Theo', 3, 'Relationship', 'warm', 96.00, 0,
                'Construction job owner, long hours. Likes feeling looked-after.',
                [['customer', "hey, work's been brutal this week honestly"], ['model', "aw no, talk to me — what's been going on?"]]],
            ['Yendry', 'ray_303', 'Ray', 2, 'Buyer', 'warm', 12.00, 0,
                'Bought a $12 tip. Asks about pricing directly.',
                [['customer', 'how much for the bundle?']]],
        ];

        foreach ($convos as [$creator, $username, $display, $trust, $archetype, $temp, $spend, $tips, $notes, $msgs]) {
            $chatter = $byCreatorChatter[$creator];

            CustomerProfile::withoutGlobalScopes()->updateOrCreate(
                ['creator_model' => $creator, 'customer_username' => $username],
                [
                    'customer_name' => $display,
                    'subscription_status' => $spend > 0 ? 'subscribed' : 'free',
                    'trust_level' => $trust,
                    'archetype' => $archetype,
                    'temperature' => $temp,
                    'total_spend' => $spend,
                    'tips_spend' => $tips,
                    'crm_notes' => $notes,
                ],
            );

            $base = Carbon::now()->subMinutes(count($msgs) * 3);
            $messages = [];
            foreach ($msgs as $i => [$sender, $text]) {
                $messages[] = ['sender' => $sender, 'text' => $text, 'ts_iso' => $base->copy()->addMinutes($i * 3)->toIso8601String()];
            }

            AichSession::withoutGlobalScopes()->updateOrCreate(
                ['creator_model' => $creator, 'of_chat_id' => 'demo-'.$username],
                [
                    'user_id' => $chatter?->id,
                    'customer_name' => $display,
                    'customer_username' => $username,
                    'status' => 'active',
                    'total_spend' => $spend,
                    'tips_spend' => $tips,
                    'crm_notes' => $notes,
                    'last_active_at' => Carbon::now()->subMinutes(2),
                    'messages' => $messages,
                ],
            );
        }

        $this->command?->info('Seeded conversations demo: Camila + Yendry, 5 conversations with intel + assignments.');
    }
}
