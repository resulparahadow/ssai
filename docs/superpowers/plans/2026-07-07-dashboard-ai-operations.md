# Dashboard AI Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-point the Overview dashboard (`/dashboard`) at the one live, accurate data source (`aich_usage_events`) so it shows real AI-operations metrics instead of zeros/fake revenue.

**Architecture:** `DashboardService::build()` stops reading the dead `aich_sessions`/`customer_profiles`/`aich_messages` tables and instead aggregates `aich_usage_events` (AI generation ledger). The old revenue section-builder methods stay in the class as dormant (uncalled) code for later revival. `Dashboard.vue` re-labels its cards, drops the pace-vs-target + revenue-attribution blocks, and swaps money columns for AI-activity columns. Role scoping: admin/manager see all events; a chatter sees only their own (`user_id = me`).

**Tech Stack:** Laravel 13 (PHP 8.3), Pest, Inertia 2 + Vue 3 + TypeScript, Tailwind v4 (`ss-*` tokens).

## Global Constraints

- Data source is `aich_usage_events` only — no OnlyFans live calls, no writes.
- Metadata only (the table holds no message text) — nothing to redact.
- Reuse the existing period model: `Today` / `7d` / `30d`, and the existing PHP-side bucket helpers (`dailyBuckets`, `bucketKey`, `seriesValues`, `seriesCount`, `hourLabel`, `money`).
- Role scoping in the service: admin/manager (`$user->canSeeAllCreators()` true) see all; chatter sees only `where('user_id', $user->id)`.
- Cache label/color rule (legacy): `—` under 3 calls; green (`pos`) ≥70%, red (`neg`) <40%, else neutral (`text-3`).
- Style with existing `ss-*` tokens and `SsSparkline` / `SsBarChart` components — no new components.
- Spec: `docs/superpowers/specs/2026-07-07-dashboard-ai-operations-design.md`.

---

### Task 1: DashboardService → AI-operations payload (backend + Pest)

**Files:**
- Modify: `app/Services/Dashboard/DashboardService.php`
- Test: `tests/Feature/DashboardServiceTest.php` (full rewrite)

**Interfaces:**
- Consumes: `App\Models\AichUsageEvent` (columns `generation_id`, `user_id`, `creator_model`, `cost`, `cache_read_tokens`, `created_at`); `App\Models\User::canSeeAllCreators(): bool`.
- Produces: `DashboardService::build(User $user, string $period): array` returning keys:
  `period` (string), `periodOptions` (list<string>), `role` (string), `canViewAllCreators` (bool),
  `aiKpis` (list of `{key,label,value,color,spark:number[]}`, exactly 4: `cost`, `generations`, `perMsg`, `cache`),
  `aiSeries` (list of `{label:string,value:float}`),
  `creators` (list of `{name,initials,generations:int,calls:int,cost:string,costRaw:float,perMsg:string,cachePct:string}`, sorted by `costRaw` desc),
  `chatters` (list of `{name,initials,role,generations:int,cost:string,costRaw:float,cachePct:string}`, sorted by `costRaw` desc).

- [ ] **Step 1: Rewrite the failing test**

Replace the entire contents of `tests/Feature/DashboardServiceTest.php` with:

```php
<?php

use App\Models\AichModel;
use App\Models\AichUsageEvent;
use App\Models\User;
use App\Services\Dashboard\DashboardService;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Inertia\Testing\AssertableInertia;

uses(RefreshDatabase::class);

/** Insert one aich_usage_events row (one LLM call) with sensible defaults. */
function usageCall(array $attrs = []): AichUsageEvent
{
    return AichUsageEvent::create(array_merge([
        'generation_id' => (string) Str::ulid(),
        'user_id' => null,
        'creator_model' => 'Alpha',
        'source' => 'live',
        'call_type' => 'generator',
        'model' => 'claude-sonnet-4-6',
        'input_tokens' => 100,
        'cache_read_tokens' => 0,
        'cache_create_tokens' => 0,
        'output_tokens' => 50,
        'cost' => 0.10,
        'cached' => false,
        'created_at' => now(),
    ], $attrs));
}

beforeEach(function () {
    AichModel::create(['name' => 'Alpha']);
    AichModel::create(['name' => 'Beta']);
    $this->worker = User::factory()->chatter()->create(['name' => 'Work Er']);

    // Generation g1: creator Alpha, made by the worker, 2 calls (one cache hit).
    $g1 = (string) Str::ulid();
    usageCall(['generation_id' => $g1, 'user_id' => $this->worker->id, 'creator_model' => 'Alpha', 'cost' => 0.10, 'cache_read_tokens' => 0]);
    usageCall(['generation_id' => $g1, 'user_id' => $this->worker->id, 'creator_model' => 'Alpha', 'cost' => 0.20, 'cache_read_tokens' => 500]);

    // Generation g2: creator Beta, no attributed user, 1 call, no cache.
    usageCall(['generation_id' => (string) Str::ulid(), 'user_id' => null, 'creator_model' => 'Beta', 'cost' => 0.30, 'cache_read_tokens' => 0]);
});

it('builds AI KPIs across all creators for an admin', function () {
    $admin = User::factory()->admin()->create();
    $d = app(DashboardService::class)->build($admin, '30d');

    $kpi = collect($d['aiKpis'])->keyBy('key');

    expect($d['aiKpis'])->toHaveCount(4)
        ->and($kpi['cost']['value'])->toBe('$0.60')            // 0.10 + 0.20 + 0.30
        ->and($kpi['generations']['value'])->toBe('2')          // g1, g2
        ->and($kpi['perMsg']['value'])->toBe('$0.30')           // 0.60 / 2
        ->and($kpi['cache']['value'])->toBe('33%')              // 1 cached of 3 calls
        ->and($kpi['cache']['color'])->toBe('neg')              // 33% < 40%
        ->and($d['canViewAllCreators'])->toBeTrue()
        ->and(collect($d['creators'])->pluck('name')->sort()->values()->all())->toBe(['Alpha', 'Beta']);
});

it('scopes a chatter to their own generations only', function () {
    $d = app(DashboardService::class)->build($this->worker, '30d');
    $kpi = collect($d['aiKpis'])->keyBy('key');

    expect($kpi['cost']['value'])->toBe('$0.30')                // only g1 (worker's) = 0.10 + 0.20
        ->and($kpi['generations']['value'])->toBe('1')
        ->and(collect($d['creators'])->pluck('name')->all())->toBe(['Alpha'])
        ->and($d['canViewAllCreators'])->toBeFalse();
});

it('builds a chatter AI-activity leaderboard', function () {
    $admin = User::factory()->admin()->create();
    $d = app(DashboardService::class)->build($admin, '30d');
    $row = collect($d['chatters'])->firstWhere('name', 'Work Er');

    expect($row)->not->toBeNull()
        ->and($row['generations'])->toBe(1)
        ->and($row['cost'])->toBe('$0.30')
        ->and($row['cachePct'])->toBe('50%');                   // 1 cached of the worker's 2 calls
});

it('renders the Inertia dashboard for an authenticated user', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->get('/dashboard')
        ->assertOk()
        ->assertInertia(fn (AssertableInertia $page) => $page
            ->component('Dashboard')
            ->has('dashboard.aiKpis', 4)
            ->has('dashboard.creators')
            ->where('dashboard.canViewAllCreators', true)
        );
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `php artisan test tests/Feature/DashboardServiceTest.php`
Expected: FAIL — `build()` still returns `kpis`/`attribution` (no `aiKpis` key), so `toHaveCount(4)` / `$kpi['cost']` error.

- [ ] **Step 3: Add the AichUsageEvent import**

In `app/Services/Dashboard/DashboardService.php`, add to the `use` block (keep the existing `AichMessage`, `AichSession`, `CustomerProfile` imports — the dormant methods still reference them):

```php
use App\Models\AichUsageEvent;
```

- [ ] **Step 4: Replace the `build()` method body**

Replace the whole `build()` method (currently lines 30-62) with:

```php
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
```

- [ ] **Step 5: Add the new AI section-builder methods**

Insert these four methods immediately after `build()` (before the dormant `effective()`/`kpis()` methods):

```php
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
```

- [ ] **Step 6: Mark the old revenue methods dormant**

Directly above the existing `effective()` method, add a banner comment so the dormant block is obvious:

```php
    // ---- DORMANT: revenue/subscriber metrics (no live data source yet) -------
    // Kept intact for revival when a real revenue source exists. Not called by
    // build(). See docs/superpowers/specs/2026-07-07-dashboard-ai-operations-design.md.
```

(Do NOT delete `effective()`, `kpis()`, `targets()`, `attribution()`, `revenueSeries()`, `creators()`, `chatters()` — they stay compilable so revival is a one-line change in `build()`.)

- [ ] **Step 7: Run the test to verify it passes**

Run: `php artisan test tests/Feature/DashboardServiceTest.php`
Expected: PASS (4 tests).

- [ ] **Step 8: Run the full backend suite + format**

Run: `php artisan test && ./vendor/bin/pint app/Services/Dashboard/DashboardService.php tests/Feature/DashboardServiceTest.php`
Expected: all tests green; Pint reports the two files formatted/clean.

- [ ] **Step 9: Commit**

```bash
git add app/Services/Dashboard/DashboardService.php tests/Feature/DashboardServiceTest.php
git commit -m "feat(dashboard): source Overview from aich_usage_events (AI ops), dormant revenue metrics"
```

---

### Task 2: Dashboard.vue + TypeScript types → AI-activity view (frontend)

**Files:**
- Modify: `resources/js/types/crm.ts:31-65`
- Modify: `resources/js/pages/Dashboard.vue`

**Interfaces:**
- Consumes: the `DashboardData` payload from Task 1 (`aiKpis`, `aiSeries`, `creators`, `chatters`).
- Produces: the rendered Overview page; no exports consumed by other files.

- [ ] **Step 1: Check for other consumers of the removed fields**

Run: `grep -rn "revenueSeries\|\.targets\|attribution\|canViewAgencyProfit\|dashboard.kpis" resources/js --include=*.ts --include=*.vue`
Expected: only matches inside `resources/js/pages/Dashboard.vue` (and none elsewhere). If anything else references them, stop and report — this plan assumes Dashboard.vue is the sole consumer.

- [ ] **Step 2: Update the TypeScript types**

In `resources/js/types/crm.ts`, replace the `CreatorRow` interface (lines 31-41) and `ChatterRow` interface (lines 43-51) with the AI-activity shapes, and update `DashboardData` (lines 53-65). `KpiCard` and `SeriesPoint` are reused as-is; `TargetRow`/`AttributionSlice` stay exported (dormant, for revival):

```ts
export interface CreatorRow {
    name: string;
    initials: string;
    generations: number;
    calls: number;
    cost: string;
    costRaw: number;
    perMsg: string;
    cachePct: string;
}

export interface ChatterRow {
    name: string;
    initials: string;
    role: string;
    generations: number;
    cost: string;
    costRaw: number;
    cachePct: string;
}

export interface DashboardData {
    period: string;
    periodOptions: string[];
    role: Role;
    canViewAllCreators: boolean;
    aiKpis: KpiCard[];
    aiSeries: SeriesPoint[];
    creators: CreatorRow[];
    chatters: ChatterRow[];
}
```

- [ ] **Step 3: Update the Dashboard.vue script block**

In `resources/js/pages/Dashboard.vue`, replace the script `<script setup lang="ts">` imports/computed (lines 1-36) with the version below — drops the now-unused `SsDonut` import, the `Target` lucide icon, and the `turnover` computed (the attribution donut is removed):

```ts
import { Head, router, usePage } from '@inertiajs/vue3';
import { Calendar } from '@lucide/vue';
import { computed } from 'vue';
import SsBarChart from '@/components/crm/SsBarChart.vue';
import SsSparkline from '@/components/crm/SsSparkline.vue';
import { ssColor } from '@/crm/nav';
import type { User } from '@/types/auth';
import type { DashboardData } from '@/types/crm';

const props = defineProps<{ dashboard: DashboardData }>();

const page = usePage();
const firstName = computed(
    () => (page.props.auth.user as User).name.split(' ')[0],
);

const greeting = computed(() => {
    const h = new Date().getHours();

    return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
});

function setPeriod(period: string): void {
    router.get(
        '/dashboard',
        { period },
        { preserveScroll: true, preserveState: true, only: ['dashboard'] },
    );
}
```

(Note: `props` is still referenced in the template via `dashboard`; the `computed` import is still used by `firstName`/`greeting`.)

- [ ] **Step 4: Point the KPI row at `aiKpis`**

In the template, change the KPI `v-for` (line 76) from `dashboard.kpis` to `dashboard.aiKpis`:

```vue
            <div
                v-for="k in dashboard.aiKpis"
                :key="k.key"
                class="rounded-xl border border-ss-border bg-ss-surface p-4"
            >
```

- [ ] **Step 5: Remove the Pace-vs-target + Revenue-attribution block**

Replace the entire block currently at lines 90-154 (the `<!-- Pace vs target + attribution -->` comment through its closing `</div>`) with a single placeholder comment:

```vue
        <!--
          Pace vs target + Revenue attribution removed: both derived from the
          revenue tables that have no live data source. Revive alongside the
          dormant DashboardService revenue metrics when real revenue lands.
          Spec: docs/superpowers/specs/2026-07-07-dashboard-ai-operations-design.md
        -->
```

- [ ] **Step 6: Relabel the trend chart and bind `aiSeries`**

Replace the "Revenue across the period" card (lines 156-166) with:

```vue
        <!-- AI cost across the period -->
        <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
            <h3 class="text-sm font-semibold text-ss-text">
                AI cost across the period
            </h3>
            <p class="mb-4 text-[12px] text-ss-text-3">
                Generation cost per
                {{ dashboard.period === 'Today' ? '4-hour block' : 'day' }}
            </p>
            <SsBarChart :points="dashboard.aiSeries" />
        </div>
```

- [ ] **Step 7: Rebuild the creator table as AI activity**

Replace the "Per-creator comparison" card (lines 168-256) with:

```vue
        <!-- Creator models · AI activity -->
        <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
            <h3 class="mb-1 text-sm font-semibold text-ss-text">
                Creator models · AI activity
            </h3>
            <p class="mb-3 text-[12px] text-ss-text-3">
                Per creator · {{ dashboard.period }}
            </p>
            <div class="overflow-x-auto">
                <table class="w-full text-[13px]">
                    <thead>
                        <tr
                            class="border-b border-ss-border text-left text-[11px] text-ss-text-3"
                        >
                            <th class="py-2 font-medium">Creator</th>
                            <th class="py-2 text-right font-medium">
                                Generations
                            </th>
                            <th class="py-2 text-right font-medium">Calls</th>
                            <th class="py-2 text-right font-medium">AI cost</th>
                            <th class="py-2 text-right font-medium">$/msg</th>
                            <th class="py-2 text-right font-medium">Cache</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="c in dashboard.creators"
                            :key="c.name"
                            class="border-b border-ss-border-2 last:border-0"
                        >
                            <td class="py-2.5">
                                <div class="flex items-center gap-2">
                                    <span
                                        class="grid h-7 w-7 place-items-center rounded-lg bg-ss-accent-soft text-[10px] font-semibold text-ss-accent-text"
                                        >{{ c.initials }}</span
                                    >
                                    <span class="font-medium text-ss-text">{{
                                        c.name
                                    }}</span>
                                </div>
                            </td>
                            <td class="py-2.5 text-right text-ss-text-2">
                                {{ c.generations }}
                            </td>
                            <td class="py-2.5 text-right text-ss-text-2">
                                {{ c.calls }}
                            </td>
                            <td
                                class="py-2.5 text-right font-ss-mono font-medium text-ss-text"
                            >
                                {{ c.cost }}
                            </td>
                            <td
                                class="py-2.5 text-right font-ss-mono text-ss-text-2"
                            >
                                {{ c.perMsg }}
                            </td>
                            <td class="py-2.5 text-right text-ss-text-2">
                                {{ c.cachePct }}
                            </td>
                        </tr>
                        <tr v-if="!dashboard.creators.length">
                            <td
                                colspan="6"
                                class="py-6 text-center text-ss-text-3"
                            >
                                No AI activity for this period.
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
```

- [ ] **Step 8: Rebuild the chatter table as AI activity**

Replace the "Chatter leaderboard" card (lines 258-324) with:

```vue
        <!-- Chatter AI activity -->
        <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
            <h3 class="mb-1 text-sm font-semibold text-ss-text">
                Chatter AI activity
            </h3>
            <p class="mb-3 text-[12px] text-ss-text-3">
                {{ dashboard.period }} · AI generations
            </p>
            <div class="overflow-x-auto">
                <table class="w-full text-[13px]">
                    <thead>
                        <tr
                            class="border-b border-ss-border text-left text-[11px] text-ss-text-3"
                        >
                            <th class="py-2 font-medium">Chatter</th>
                            <th class="py-2 font-medium">Role</th>
                            <th class="py-2 text-right font-medium">
                                Generations
                            </th>
                            <th class="py-2 text-right font-medium">AI cost</th>
                            <th class="py-2 text-right font-medium">Cache</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="r in dashboard.chatters"
                            :key="r.name"
                            class="border-b border-ss-border-2 last:border-0"
                        >
                            <td class="py-2.5">
                                <div class="flex items-center gap-2">
                                    <span
                                        class="grid h-7 w-7 place-items-center rounded-lg bg-ss-surface-2 text-[10px] font-semibold text-ss-text-2"
                                        >{{ r.initials }}</span
                                    >
                                    <span class="font-medium text-ss-text">{{
                                        r.name
                                    }}</span>
                                </div>
                            </td>
                            <td class="py-2.5 text-ss-text-2">{{ r.role }}</td>
                            <td class="py-2.5 text-right text-ss-text-2">
                                {{ r.generations }}
                            </td>
                            <td
                                class="py-2.5 text-right font-ss-mono font-medium text-ss-text"
                            >
                                {{ r.cost }}
                            </td>
                            <td class="py-2.5 text-right text-ss-text-2">
                                {{ r.cachePct }}
                            </td>
                        </tr>
                        <tr v-if="!dashboard.chatters.length">
                            <td
                                colspan="5"
                                class="py-6 text-center text-ss-text-3"
                            >
                                No AI activity for this period.
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
```

- [ ] **Step 9: Lint + type-check**

Run: `npm run lint:check && npm run types:check`
Expected: both clean (no unused-import errors for `SsDonut`/`Target`, no type errors on the new payload).

- [ ] **Step 10: Build the frontend**

Run: `npm run build`
Expected: build succeeds (Wayfinder generate + Vite bundle complete).

- [ ] **Step 11: Commit**

```bash
git add resources/js/types/crm.ts resources/js/pages/Dashboard.vue
git commit -m "feat(dashboard): render AI-activity Overview (KPIs, cost trend, creator/chatter tables)"
```

---

## Self-Review

**Spec coverage:**
- "Source from `aich_usage_events`" → Task 1 Step 4 (query) ✓
- 4 AI KPIs (cost/generations/$msg/cache) → Task 1 Step 5 `aiKpis()` ✓
- Cache label/color rule → Task 1 Step 5 + test assertion (`33%`/`neg`) ✓
- Role scoping (chatter own-only) → Task 1 Step 4 `when(! canSeeAllCreators)` + test 2 ✓
- Creator AI activity grouping → Task 1 Step 5 `creatorActivity()` ✓
- Chatter AI activity (real, `user_id`) → Task 1 Step 5 `chatterActivity()` + test 3 ✓
- Trend plots cost → Task 1 `aiSeries()` + Task 2 Step 6 ✓
- Comment out pace-vs-target + revenue-attribution → Task 2 Step 5 ✓
- Dormant revenue methods kept for revival → Task 1 Step 6 ✓
- AI Usage page untouched → not in file list ✓
- Pest test (period/scope/grouping/cache rule) → Task 1 Step 1 ✓

**Placeholder scan:** No TBD/TODO; all steps carry full code and exact commands. ✓

**Type consistency:** Service keys (`aiKpis`, `aiSeries`, `creators`, `chatters`) match the TS `DashboardData`; row fields (`generations`, `calls`, `cost`, `costRaw`, `perMsg`, `cachePct`, `role`) match between `creatorActivity()`/`chatterActivity()` (Task 1) and `CreatorRow`/`ChatterRow` + template bindings (Task 2). `KpiCard`/`SeriesPoint` reused unchanged. ✓

**Note on the cache assertion in test 3:** the worker's generation g1 has 2 calls, one with `cache_read_tokens = 500` → `cachePct = 50%`, which the test asserts.
