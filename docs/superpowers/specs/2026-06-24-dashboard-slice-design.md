# SmartStars CRM — App Shell + Dashboard Slice (Phase 2)

**Date:** 2026-06-24
**Status:** Implemented
**Builds on:** [Foundation (Phase 1)](2026-06-24-laravel-vue-foundation-design.md)

## Goal

Rebuild the `SSAI-new-design.html` app shell as real Vue and wire ONE view —
the Overview dashboard — to real, role-scoped data as an end-to-end proof of the
stack.

## Design extraction

The design is a React-based `<x-dc>` prototype with inline styles and a
hard-coded data model. Extracted from it (not imported):

- **Theme tokens** — dark + light CSS variable sets (`--ss-*`), Hanken Grotesk +
  JetBrains Mono. Wired into Tailwind v4 `@theme` as `ss-*` utilities in
  `resources/css/app.css`; light on `:root`, dark on `.dark` (so the starter's
  `useAppearance` toggle drives it).
- **Permission matrix** — admin/manager = full; chatter = chat only. Mirrored in
  `resources/js/crm/nav.ts` (`PERM`) for nav visibility and enforced server-side
  by the Phase-1 gates.
- **Nav tree** — Overview, Conversations, Whales, Playbooks, Automations,
  Marketing(▾), Analytics(▾), Planned(▾), Team, Settings.
- **Dashboard datasets** — KPIs, pace-vs-target, revenue attribution, per-creator
  comparison, chatter leaderboard.

## Frontend

- `layouts/SmartStarsLayout.vue` — shell; resolves the effective role (admin "view
  as" preview) and the page title; routed via `app.ts` for the `Dashboard` page.
- `components/crm/SsSidebar.vue` — collapsible, role-gated nav tree (locked items
  show a lock; unbuilt views are inert placeholders).
- `components/crm/SsTopbar.vue` — sidebar toggle, search, signals dropdown, theme
  toggle, admin role-preview switcher.
- `components/crm/Ss{Sparkline,Donut,BarChart}.vue` — lightweight inline-SVG charts.
- `composables/useCrmShell.ts` — shared sidebar-collapse + role-preview state.
- `pages/Dashboard.vue` — KPI row, pace vs target, attribution donut, revenue
  series, per-creator table, chatter leaderboard.

## Backend

- `DashboardController` (invokable) → `Inertia::render('Dashboard', ['dashboard' => ...])`.
- `Services/Dashboard/DashboardService` — aggregates entirely through the Eloquent
  models, so `CreatorAccessScope` makes the dashboard correct per role with no
  branching (admin/manager = all; chatter = assigned creators only).
- `config/dashboard.php` — agency-wide revenue goal for the pace widget.
- `DashboardSeeder` — owner + manager + 4 chatters, 8 creators, customers /
  sessions / messages across 30 days (some today). Logins: `admin@smartstars.test`
  … `lena@smartstars.test`, all `password`.

## Honesty boundary

Every figure derives from real columns (session spend, tips, subscription_status,
sent messages). Deliberately **absent** until their own specs: subscription
revenue, CAC/ROAS, smart-link deltas, response times, AI cost/profit. The role
preview changes nav only — dashboard numbers always reflect the real role.

## Verification
- `php artisan test` — 52 passed / 184 assertions (incl. dashboard aggregation,
  chatter scoping, leaderboard, Inertia render).
- `npm run types:check`, `npm run build`, `npm run lint:check` — all clean.

## Deferred (unchanged from Phase 1)
AI engine port · the other 8 CRM views · OnlyFans live integration · production
data migration.
