<?php

namespace App\Services\Dashboard;

use App\Models\AichUsageEvent;
use App\Models\User;
use Illuminate\Support\Carbon;

/**
 * Builds the AI Usage view payload from aich_usage_events. Reproduces the legacy
 * js/api.js telemetry: the `$/msg · Cache` summary + the last-N cost-diagnostic rows.
 * Manager/admin only (the route is manage-team gated), so no per-creator scoping.
 */
class AiUsageService
{
    /** @var array<string, int> */
    private const PERIOD_DAYS = ['Today' => 1, '7d' => 7, '30d' => 30];

    private const RECENT_LIMIT = 25;

    /** @return array<string, mixed> */
    public function build(User $user, string $period = '7d'): array
    {
        $period = array_key_exists($period, self::PERIOD_DAYS) ? $period : '7d';
        $days = self::PERIOD_DAYS[$period];
        $start = $period === 'Today' ? Carbon::today() : Carbon::today()->subDays($days - 1);

        $base = AichUsageEvent::query()->where('created_at', '>=', $start);

        $totalCost = (float) (clone $base)->sum('cost');
        $totalCalls = (clone $base)->count();
        $generations = (clone $base)->distinct('generation_id')->count('generation_id');
        $cachedCalls = (clone $base)->where('cache_read_tokens', '>', 0)->count();

        $costPerMsg = $generations > 0 ? $totalCost / $generations : 0.0;
        $cacheHitRate = $totalCalls > 0 ? $cachedCalls / $totalCalls : 0.0;

        // Legacy color/label rule (js/api.js:183-184): "—" under 3 calls; green ≥70%, red <40%.
        $hitPct = (int) round($cacheHitRate * 100);
        $cacheLabel = $totalCalls < 3 ? '—' : $hitPct.'%';
        $cacheColor = $totalCalls < 3 ? 'neutral' : ($hitPct >= 70 ? 'pos' : ($hitPct >= 40 ? 'neutral' : 'neg'));

        $recent = (clone $base)
            ->latest('created_at')->latest('id')
            ->take(self::RECENT_LIMIT)
            ->get()
            ->map(fn (AichUsageEvent $e) => [
                'id' => $e->id,
                'ts' => optional($e->created_at)->toIso8601String(),
                'callType' => $e->call_type,
                'model' => $e->model,
                'source' => $e->source,
                'creatorModel' => $e->creator_model,
                'input' => $e->input_tokens,
                'cacheRead' => $e->cache_read_tokens,
                'cacheCreate' => $e->cache_create_tokens,
                'output' => $e->output_tokens,
                'cost' => (float) $e->cost,
                'cached' => $e->cached,
                'durationMs' => $e->duration_ms,
                'tokPerSec' => $e->tok_per_sec,
                'sysBlocks' => $e->sys_blocks ?? [],
            ])
            ->values();

        return [
            'period' => $period,
            'periodOptions' => array_keys(self::PERIOD_DAYS),
            'summary' => [
                'totalCost' => round($totalCost, 4),
                'totalCalls' => $totalCalls,
                'generations' => $generations,
                'costPerMsg' => round($costPerMsg, 4),
                'cacheHitRate' => round($cacheHitRate, 3),
                'cacheLabel' => $cacheLabel,
                'cacheColor' => $cacheColor,
            ],
            'recent' => $recent,
        ];
    }
}
