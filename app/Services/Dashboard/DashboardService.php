<?php

namespace App\Services\Dashboard;

use App\Models\AichUsageEvent;
use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;

/**
 * Aggregates the Overview dashboard from the real models. All reads go through
 * the Eloquent models, so CreatorAccessScope automatically scopes a chatter to
 * their assigned creators while admins/managers see everything — the dashboard
 * is correct per role without any branching here.
 *
 * Honesty note (Phase 1): every figure below is derived from columns that exist
 * today (session spend, tips, subscription_status, sent messages). Metrics that
 * need analytics we have not built yet (CAC/ROAS, smart-link deltas, sub
 * revenue, response times) are intentionally absent — they arrive with their
 * own specs.
 */
class DashboardService
{
    /** @var array<string, int> */
    private const PERIOD_DAYS = ['Today' => 1, '7d' => 7, '30d' => 30];

    /** @return array<string, mixed> */
    public function build(User $user, string $period = 'Today'): array
    {
        $period = array_key_exists($period, self::PERIOD_DAYS) ? $period : 'Today';
        $days = self::PERIOD_DAYS[$period];
        $start = $period === 'Today' ? Carbon::today() : Carbon::today()->subDays($days - 1);

        // Revenue/subscriber metrics are OFF: their source tables (aich_sessions,
        // aich_messages, customer_profiles) have no live writer, so they read as
        // zeros/fake. The dormant kpis()/targets()/attribution()/revenueSeries()/
        // creators()/chatters() methods below are kept for revival once a real
        // revenue source exists. See docs/superpowers/specs/2026-07-07-dashboard-ai-operations-design.md.

        // AI generation telemetry is the one live, accurate source. Chatters see
        // only their own generations; managers/admins see all.
        $events = AichUsageEvent::query()
            ->where('created_at', '>=', $start)
            ->when(! $user->canSeeAllCreators(), fn ($q) => $q->where('user_id', $user->id))
            ->get(['generation_id', 'user_id', 'creator_model', 'cost', 'cache_read_tokens', 'created_at']);

        return [
            'period' => $period,
            'periodOptions' => array_keys(self::PERIOD_DAYS),
            'role' => $user->role->value,
            'canViewAllCreators' => $user->canSeeAllCreators(),
            'aiKpis' => $this->aiKpis($events, $start, $days, $period),
            'aiSeries' => $this->aiSeries($events, $start, $days, $period),
            'creators' => $this->creatorActivity($events),
            'chatters' => $this->chatterActivity($events),
        ];
    }

    /**
     * @param  Collection<int, object>  $events
     * @return list<array<string, mixed>>
     */
    private function aiKpis(Collection $events, Carbon $start, int $days, string $period): array
    {
        $cost = (float) $events->sum('cost');
        $generations = $events->pluck('generation_id')->unique()->count();
        $calls = $events->count();
        $cachedCalls = $events->where('cache_read_tokens', '>', 0)->count();
        $perMsg = $generations > 0 ? $cost / $generations : 0.0;
        $hitPct = $calls > 0 ? (int) round($cachedCalls / $calls * 100) : 0;

        // Legacy rule: "—" under 3 calls; green ≥70%, red <40%, else neutral.
        $cacheLabel = $calls < 3 ? '—' : $hitPct.'%';
        $cacheColor = $calls < 3 ? 'text-3' : ($hitPct >= 70 ? 'pos' : ($hitPct >= 40 ? 'text-3' : 'neg'));

        $buckets = $this->dailyBuckets($start, $days, $period);
        $costSpark = $this->seriesValues($events, $buckets, $period, fn ($e) => (float) $e->cost);

        return [
            ['key' => 'cost', 'label' => 'AI cost', 'value' => $this->money($cost), 'color' => 'accent', 'spark' => $costSpark],
            ['key' => 'generations', 'label' => 'Generations', 'value' => number_format($generations), 'color' => 'msg',
                'spark' => $this->seriesDistinct($events, $buckets, $period, 'generation_id')],
            ['key' => 'perMsg', 'label' => 'Avg $/msg', 'value' => $this->money($perMsg), 'color' => 'tip', 'spark' => $costSpark],
            ['key' => 'cache', 'label' => 'Cache hit', 'value' => $cacheLabel, 'color' => $cacheColor,
                'spark' => $this->seriesCount($events->where('cache_read_tokens', '>', 0), $buckets, $period)],
        ];
    }

    /**
     * @param  Collection<int, object>  $events
     * @return list<array<string, mixed>>
     */
    private function aiSeries(Collection $events, Carbon $start, int $days, string $period): array
    {
        $buckets = $this->dailyBuckets($start, $days, $period);
        $values = $this->seriesValues($events, $buckets, $period, fn ($e) => (float) $e->cost);

        return collect($buckets)->values()->map(fn ($bucket, $i) => [
            'label' => $bucket['label'],
            'value' => $values[$i] ?? 0,
        ])->all();
    }

    /**
     * @param  Collection<int, object>  $events
     * @return list<array<string, mixed>>
     */
    private function creatorActivity(Collection $events): array
    {
        return $events->groupBy('creator_model')->map(function (Collection $rows, $name) {
            $name = (string) ($name === '' ? '—' : $name);
            $cost = (float) $rows->sum('cost');
            $generations = $rows->pluck('generation_id')->unique()->count();
            $calls = $rows->count();
            $cached = $rows->where('cache_read_tokens', '>', 0)->count();

            return [
                'name' => $name,
                'initials' => mb_strtoupper(mb_substr($name, 0, 2)),
                'generations' => $generations,
                'calls' => $calls,
                'cost' => $this->money($cost),
                'costRaw' => round($cost, 4),
                'perMsg' => $generations > 0 ? $this->money($cost / $generations) : '—',
                'cachePct' => $calls > 0 ? round($cached / $calls * 100).'%' : '—',
            ];
        })->sortByDesc('costRaw')->values()->all();
    }

    /**
     * @param  Collection<int, object>  $events
     * @return list<array<string, mixed>>
     */
    private function chatterActivity(Collection $events): array
    {
        $userIds = $events->pluck('user_id')->filter()->unique();
        $users = User::query()->whereIn('id', $userIds)->get(['id', 'name', 'role'])->keyBy('id');

        return $events->whereNotNull('user_id')->groupBy('user_id')->map(function (Collection $rows, $uid) use ($users) {
            $u = $users->get($uid);
            $name = $u?->name ?? 'Unknown';
            $cost = (float) $rows->sum('cost');
            $generations = $rows->pluck('generation_id')->unique()->count();
            $calls = $rows->count();
            $cached = $rows->where('cache_read_tokens', '>', 0)->count();

            return [
                'name' => $name,
                'initials' => collect(explode(' ', $name))->map(fn ($w) => mb_substr($w, 0, 1))->take(2)->implode(''),
                'role' => $u ? ucfirst($u->role->value) : '—',
                'generations' => $generations,
                'cost' => $this->money($cost),
                'costRaw' => round($cost, 4),
                'cachePct' => $calls > 0 ? round($cached / $calls * 100).'%' : '—',
            ];
        })->sortByDesc('costRaw')->values()->all();
    }

    /**
     * Count distinct values of $field per bucket (e.g. distinct generation_id).
     *
     * @param  Collection<int, object>  $rows
     * @param  list<array{key:string,label:string}>  $buckets
     * @return list<int>
     */
    private function seriesDistinct(Collection $rows, array $buckets, string $period, string $field): array
    {
        $byBucket = [];
        foreach ($rows as $r) {
            $k = $this->bucketKey(Carbon::parse($r->created_at), $period);
            $byBucket[$k][$r->{$field}] = true;
        }

        return collect($buckets)->map(fn ($b) => count($byBucket[$b['key']] ?? []))->all();
    }

    // ---- DORMANT: revenue/subscriber metrics (no live data source yet) -------
    // Kept intact for revival when a real revenue source exists. Not called by
    // build(). See docs/superpowers/specs/2026-07-07-dashboard-ai-operations-design.md.

    private function effective(object $row): float
    {
        return (float) $row->total_spend + (float) $row->tips_spend;
    }

    /**
     * @param  Collection<int, object>  $sessions
     * @param  Collection<int, object>  $profiles
     * @return list<array<string, mixed>>
     */
    private function kpis(Collection $sessions, Collection $profiles, Carbon $start, int $days, string $period): array
    {
        $turnover = $sessions->sum(fn ($s) => $this->effective($s));
        $paidSubs = $profiles->where('subscription_status', 'paid')->count();
        $freeSubs = $profiles->where('subscription_status', 'free')->count();
        $paidSessions = $sessions->filter(fn ($s) => $this->effective($s) > 0)->count();

        $buckets = $this->dailyBuckets($start, $days, $period);

        return [
            [
                'key' => 'turnover', 'label' => 'Total turnover',
                'value' => $this->money($turnover), 'color' => 'accent',
                'spark' => $this->seriesValues($sessions, $buckets, $period, fn ($s) => $this->effective($s)),
            ],
            [
                'key' => 'paid', 'label' => 'New subs · paid',
                'value' => number_format($paidSubs), 'color' => 'msg',
                'spark' => $this->seriesCount($profiles->where('subscription_status', 'paid'), $buckets, $period),
            ],
            [
                'key' => 'free', 'label' => 'New subs · free',
                'value' => number_format($freeSubs), 'color' => 'tip',
                'spark' => $this->seriesCount($profiles->where('subscription_status', 'free'), $buckets, $period),
            ],
            [
                'key' => 'purchases', 'label' => 'Paying conversations',
                'value' => number_format($paidSessions), 'color' => 'text-3',
                'spark' => $this->seriesCount($sessions->filter(fn ($s) => $this->effective($s) > 0), $buckets, $period),
            ],
        ];
    }

    /**
     * @param  Collection<int, object>  $sessions
     * @return list<array<string, mixed>>
     */
    private function targets(Collection $sessions): array
    {
        $turnover = $sessions->sum(fn ($s) => $this->effective($s));
        $goal = (float) config('dashboard.revenue_goal', 10000);
        $pct = $goal > 0 ? min(100, round($turnover / $goal * 100)) : 0;

        return [[
            'label' => 'Revenue', 'current' => $this->money($turnover),
            'goal' => $this->money($goal), 'pct' => $pct, 'color' => 'accent',
        ]];
    }

    /**
     * @param  Collection<int, object>  $sessions
     * @return list<array<string, mixed>>
     */
    private function attribution(Collection $sessions): array
    {
        $messages = (float) $sessions->sum(fn ($s) => (float) $s->total_spend);
        $tips = (float) $sessions->sum(fn ($s) => (float) $s->tips_spend);
        $total = max(1.0, $messages + $tips);

        return [
            ['label' => 'Messages', 'value' => $this->money($messages), 'pct' => round($messages / $total * 100), 'color' => 'msg'],
            ['label' => 'Tips', 'value' => $this->money($tips), 'pct' => round($tips / $total * 100), 'color' => 'tip'],
        ];
    }

    /**
     * @param  Collection<int, object>  $sessions
     * @return list<array<string, mixed>>
     */
    private function revenueSeries(Collection $sessions, Carbon $start, int $days, string $period): array
    {
        $buckets = $this->dailyBuckets($start, $days, $period);
        $values = $this->seriesValues($sessions, $buckets, $period, fn ($s) => $this->effective($s));

        return collect($buckets)->values()->map(fn ($bucket, $i) => [
            'label' => $bucket['label'],
            'value' => $values[$i] ?? 0,
        ])->all();
    }

    /**
     * @param  Collection<int, object>  $sessions
     * @param  Collection<int, object>  $profiles
     * @return list<array<string, mixed>>
     */
    private function creators(Collection $sessions, Collection $profiles): array
    {
        $byCreator = $sessions->groupBy('creator_model');
        $profilesByCreator = $profiles->groupBy('creator_model');

        return $byCreator->map(function (Collection $rows, string $name) use ($profilesByCreator) {
            $revenue = $rows->sum(fn ($s) => $this->effective($s));
            $sales = (float) $rows->sum(fn ($s) => (float) $s->total_spend);
            $payers = $rows->filter(fn ($s) => $this->effective($s) > 0)->count();
            $profiles = $profilesByCreator->get($name, collect());

            return [
                'name' => $name,
                'initials' => mb_strtoupper(mb_substr($name, 0, 2)),
                'revenue' => $this->money($revenue),
                'revenueRaw' => round($revenue, 2),
                'newPaid' => $profiles->where('subscription_status', 'paid')->count(),
                'newFree' => $profiles->where('subscription_status', 'free')->count(),
                'salesRevenue' => $this->money($sales),
                'chatRatio' => $revenue > 0 ? round($sales / $revenue * 100).'%' : '—',
                'avgSpend' => $payers > 0 ? $this->money($revenue / $payers) : '—',
            ];
        })->sortByDesc('revenueRaw')->values()->all();
    }

    /**
     * @param  Collection<int, object>  $sessions
     * @param  Collection<int, object>  $messages
     * @return list<array<string, mixed>>
     */
    private function chatters(Collection $sessions, Collection $messages): array
    {
        $userIds = $sessions->pluck('user_id')->merge($messages->pluck('user_id'))->filter()->unique();
        $users = User::query()->whereIn('id', $userIds)->get(['id', 'name', 'role'])->keyBy('id');

        $sessionsByUser = $sessions->groupBy('user_id');
        $messagesByUser = $messages->groupBy('user_id');

        return $users->map(function (User $u) use ($sessionsByUser, $messagesByUser) {
            $rows = $sessionsByUser->get($u->id, collect());
            $revenue = $rows->sum(fn ($s) => $this->effective($s));

            return [
                'name' => $u->name,
                'initials' => collect(explode(' ', $u->name))->map(fn ($w) => mb_substr($w, 0, 1))->take(2)->implode(''),
                'role' => ucfirst($u->role->value),
                'revenue' => $this->money($revenue),
                'revenueRaw' => round($revenue, 2),
                'sentMessages' => $messagesByUser->get($u->id, collect())->count(),
                'conversations' => $rows->count(),
            ];
        })->sortByDesc('revenueRaw')->values()->all();
    }

    // ---- series helpers (bucket in PHP for cross-DB portability) ------------

    /**
     * Build the day/hour buckets for the period. For "Today" we bucket by 4-hour
     * blocks; otherwise by day. Returns [['key'=>'2026-06-24','label'=>'Mon'], ...].
     *
     * @return list<array{key:string,label:string}>
     */
    private function dailyBuckets(Carbon $start, int $days, string $period): array
    {
        if ($period === 'Today') {
            return collect(range(0, 5))->map(function (int $i) {
                $h = $i * 4;

                return ['key' => 'h'.$h, 'label' => $this->hourLabel($h)];
            })->all();
        }

        return collect(range(0, $days - 1))->map(function (int $i) use ($start, $days) {
            $d = $start->copy()->addDays($i);

            return ['key' => $d->toDateString(), 'label' => $days <= 7 ? $d->format('D') : $d->format('j')];
        })->all();
    }

    private function bucketKey(Carbon $ts, string $period): string
    {
        return $period === 'Today' ? 'h'.((int) floor($ts->hour / 4) * 4) : $ts->toDateString();
    }

    /**
     * @param  Collection<int, object>  $rows
     * @param  list<array{key:string,label:string}>  $buckets
     * @return list<float>
     */
    private function seriesValues(Collection $rows, array $buckets, string $period, callable $valueOf): array
    {
        $sums = [];
        foreach ($rows as $r) {
            $k = $this->bucketKey(Carbon::parse($r->created_at), $period);
            $sums[$k] = ($sums[$k] ?? 0) + $valueOf($r);
        }

        return collect($buckets)->map(fn ($b) => round($sums[$b['key']] ?? 0, 2))->all();
    }

    /**
     * @param  Collection<int, object>  $rows
     * @param  list<array{key:string,label:string}>  $buckets
     * @return list<int>
     */
    private function seriesCount(Collection $rows, array $buckets, string $period): array
    {
        return array_map('intval', $this->seriesValues($rows, $buckets, $period, fn () => 1));
    }

    private function hourLabel(int $h): string
    {
        if ($h === 0) {
            return '12a';
        }

        return $h < 12 ? $h.'a' : ($h === 12 ? '12p' : ($h - 12).'p');
    }

    private function money(float $n): string
    {
        return '$'.number_format($n, $n < 100 && $n != (int) $n ? 2 : 0);
    }
}
