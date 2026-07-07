# Overview dashboard → AI operations (real data only)

Date: 2026-07-07
Status: Approved (design)

## Problem

The Overview dashboard (`/dashboard`) is architecturally real but **data-starved**.
`DashboardService` aggregates three tables:

- `aich_sessions` (`total_spend` + `tips_spend`) — source of every revenue figure
- `aich_messages` (`was_sent`) — source of chatter message counts
- `customer_profiles` (`subscription_status`) — source of the sub counts

`aich_sessions` and `aich_messages` have **no live writer** — Conversations became a
live OnlyFans proxy that persists no sessions/messages (only the `dev/generate`
harness writes `aich_messages`). So in production (seeded with `ProductionSeeder`
only) those tables are empty and the dashboard reads **all zeros**; the only way it
shows numbers is the demo `DashboardSeeder`, which is fabricated data. The one
partly-live metric ("New subs paid/free" from `customer_profiles`) is semantically
wrong — it counts *profile creation on generate*, not subscriptions.

We do not want to show inaccurate or fake data.

## Goal

Re-point the Overview dashboard at the **one live, accurate source we already
persist** — `aich_usage_events` (the AI generation usage ledger, metadata only,
written on every live generate by `AiUsageRecorder`). The dashboard becomes an
**AI operations overview**. The revenue/subscriber code is **commented out in
place** (not deleted) so it can be revived when a real revenue source exists.

Non-goals: building a real revenue data source (separate future spec); changing
the dedicated AI Usage page (`/analytics/ai-usage`); any OnlyFans live calls.

## Data source

`aich_usage_events` — one row per LLM call, grouped by `generation_id`. Relevant
columns: `generation_id`, `user_id`, `creator_model`, `source`, `call_type`,
`cost`, `cache_read_tokens`, `created_at`. Already aggregated by
`App\Services\Dashboard\AiUsageService` for the AI Usage page; the dashboard
reuses the same math (cost, generations = distinct `generation_id`, cache-hit =
`cache_read_tokens > 0` over total calls, avg `$/msg` = cost ÷ generations).

The table has **no `CreatorAccessScope`** (the AI Usage page relies on being
manage-team gated). The dashboard is visible to all roles, so scoping is applied
in `DashboardService` (see Role scoping).

## Backend — `App\Services\Dashboard\DashboardService`

`build(User $user, string $period)` keeps its period handling (`Today`/`7d`/`30d`,
`dailyBuckets`/`bucketKey`/`seriesValues`/`seriesCount` helpers, `money()`,
`hourLabel()` are reused). The three model reads (`AichSession`, `CustomerProfile`,
`AichMessage`) and the six derived sections are **commented out** with a short note
(`// Revenue/subscriber metrics — no live data source yet; see
2026-07-07-dashboard-ai-operations-design.md`). The following are removed from the
returned payload (kept as commented code): the money portion of `kpis`, `targets`,
`attribution`, the `$`-valued `revenueSeries`, the revenue columns of `creators`,
and the revenue column of `chatters`.

New payload from `aich_usage_events` (scoped — see below):

```
[
  'period', 'periodOptions', 'role',
  'canViewAllCreators' => $user->canSeeAllCreators(),
  'aiKpis' => [
    { key:'cost',        label:'AI cost',      value:'$…', color:'accent', spark:[…] },
    { key:'generations', label:'Generations',  value:'…',  color:'msg',    spark:[…] },
    { key:'perMsg',      label:'Avg $/msg',    value:'$…', color:'tip',    spark:[…] },
    { key:'cache',       label:'Cache hit',    value:'…%'|'—', color:cacheColor, spark:[…] },
  ],
  'aiSeries' => [ { label:'Mon', value: <cost for bucket> }, … ],  // trend card
  'creators' => [ { name, initials, generations, calls, cost, costRaw, perMsg, cachePct }, … ]  // sorted by costRaw desc
  'chatters' => [ { name, initials, role, generations, cost, costRaw, cachePct }, … ]           // sorted by costRaw desc
]
```

- `aiKpis` sparklines: cost/generations bucketed via `seriesValues`/`seriesCount`
  over `dailyBuckets`. The cache card follows the legacy label/color rule
  (`—` under 3 calls; green ≥70%, red <40%, else neutral).
- `aiSeries`: `cost` per bucket (reuses `seriesValues`).
- `creators`: group events by `creator_model` → generations (distinct
  `generation_id` within the group), call count, summed cost, avg $/msg, cache%.
- `chatters`: group by `user_id`, resolve names via `User::whereIn`, same metrics.

A new private helper loads the scoped event collection once and passes it to the
section builders (mirrors the current `$sessions`/`$profiles`/`$messages` pattern),
so buckets/series stay computed in PHP for DB portability.

## Role scoping

- Admin / Manager (`canSeeAllCreators()` true): all events in the period.
- Chatter: `where('user_id', $user->id)` — only their own generation activity.
  The creator/chatter breakdowns naturally reduce to their own rows; no
  agency-wide cost is leaked.

## Frontend — `resources/js/pages/Dashboard.vue`

- Comment out the **Pace vs target** and **Revenue attribution** blocks (kept as
  HTML comments with the same note). Remaining cards reflow to fill the grid.
- KPI row: bind to `dashboard.aiKpis` (labels: AI cost / Generations / Avg $/msg /
  Cache hit). Sparklines unchanged (`SsSparkline`).
- "Results across the period": relabel to **AI cost across the period**, bind to
  `dashboard.aiSeries` (same `SsBarChart`/line component).
- "Detailed comparison" table: relabel to **Creator models · AI activity**;
  columns → Creator, Generations, Calls, Cost, $/msg, Cache%.
- "Chatter leaderboard" table: relabel to **Chatter AI activity**; columns →
  Chatter, Role, Generations, Cost, Cache%.
- Period filter, role-preview, and layout are unchanged. Same `ss-*` tokens.

The TypeScript prop types (`resources/js/actions/.../DashboardController.ts` is
generated by Wayfinder; the page-level types are inline in `Dashboard.vue`) are
updated to the new payload shape.

## Testing / verification

- Pest feature test (`tests/Feature/`): seed `aich_usage_events` across two
  creators + two users, assert (a) period filtering, (b) admin sees all / chatter
  sees only own, (c) per-creator and per-chatter grouping totals, (d) cache label
  rule (`—` under 3 calls).
- `php artisan test` (full suite green — the commented reads must not break
  existing dashboard tests; update any that asserted revenue keys).
- `npm run lint:check` + `npm run types:check` clean.

## Out of scope (future specs)

- A real revenue/subscriber data source (OnlyFans earnings aggregation or a
  persisted metadata-only revenue ledger like `aich_usage_events`). When it lands,
  the commented sections are the revival point.
- Any change to `/analytics/ai-usage` (the per-call diagnostic table stays there).
