# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

SmartStars CRM — a Laravel + Inertia + Vue rewrite of the legacy browser app. The
goal is to scale the product (proper backend + frontend separation, real
server-side logic, role-based access) behind the `SSAI-new-design.html` design.

**This rewrite is being built in phases.** Phase 1 (done): foundation — repo
restructure, Laravel scaffold, MySQL schema mirror, auth/roles, AI provider
boundary, OnlyFans webhook stub. Phase 2 (done): the SmartStars design shell
(sidebar/topbar/theme/role-preview) + the Overview dashboard wired to real,
role-scoped data. Phase 3 (done): the legacy generation engine runs **exactly**
inside the project via a Node sidecar (`engine/`) — Laravel calls it over HTTP.
Later phases build the other CRM views and may port the engine to PHP. See
`docs/superpowers/specs/` for the specs.

## Stack

- **Laravel 13.x**, PHP 8.3+
- **Inertia 2 + Vue 3 + Vite** (TypeScript) — the `--vue` starter kit; auth via **Fortify**
- **MySQL 8** (`ssai_crm` database)
- **Pest** for tests · Tailwind for styling

## Repository shape

```
.
├── app/
│   ├── Enums/UserRole.php            ← admin | manager | chatter (+ capability helpers)
│   ├── Models/                       ← Eloquent mirror of the legacy schema
│   │   ├── Concerns/BelongsToChatter.php   ← auto-stamps user_id + applies access scope
│   │   └── Scopes/CreatorAccessScope.php   ← row-level access (replaces Supabase RLS)
│   ├── Services/
│   │   ├── AI/{AnthropicService,MistralService}.php   ← server-held keys (proxy ports, STUBS)
│   │   ├── OnlyFans/OnlyFansService.php               ← OF client (helpers real, sync STUB)
│   │   └── Doctrine/DoctrineService.php               ← active row + integrity hash
│   ├── Http/Controllers/Webhooks/OnlyFansWebhookController.php  ← messages.received → broadcast
│   ├── Events/OnlyFansMessageReceived.php  ← broadcasts inbound on private creator.{id}
│   ├── Broadcasting/CreatorChannel.php     ← authorizes that channel (creator access scope)
│   └── Providers/AppServiceProvider.php  ← role gates defined in configureGates()
├── database/migrations/              ← schema (mirror of legacy Supabase tables + doctrines)
├── resources/
│   ├── css/app.css                   ← Tailwind v4 + SmartStars design tokens (ss-* utilities)
│   └── js/
│       ├── layouts/SmartStarsLayout.vue   ← CRM design shell (routed in app.ts for Dashboard)
│       ├── components/crm/                ← SsSidebar, SsTopbar, Ss{Sparkline,Donut,BarChart}
│       ├── composables/useCrmShell.ts     ← sidebar-collapse + admin role-preview state
│       ├── crm/nav.ts                     ← nav tree + PERM matrix + ssColor()
│       └── pages/Dashboard.vue            ← Overview view (real data via DashboardController)
├── routes/web.php                    ← inertia routes + webhooks/onlyfans
├── tests/Feature/                    ← Pest (CreatorAccess, RoleGate, OnlyFansWebhook, +starter)
├── engine/                           ← Node sidecar that RUNS the real legacy generate()
│   ├── loadEngine.js                 ← loads legacy js into one vm context + bridges globals
│   ├── callModel.js                  ← headless callApi/callMistral (server keys)
│   ├── runGenerate.js                ← driver: payload → real generate() → draft/strategy/telemetry
│   └── server.js                     ← HTTP /generate, /health  (smoke.js, parity.js next to it)
├── app/Services/Engine/EngineClient.php  ← maps MySQL → legacy session shape, calls the engine
├── legacy/                           ← the ENTIRE old vanilla-JS app, archived read-only
│                                       (legacy/package.json restores CommonJS for tests/harness.js)
├── docs/superpowers/specs/           ← phase specs
└── SSAI-new-design.html              ← the design prototype (visual reference for Phase 2)
```

`legacy/` is the previous Supabase + vanilla-JS app (its own `legacy/CLAUDE.md`
and `legacy/DEV_SPEC.md` document it). It is reference only — not wired into the
new app. The behavioural IP (doctrine text, posture rules, generation pipeline)
still lives there and is ported later under coordination.

## Backend boundary

There is **no Supabase**. Laravel owns the database (MySQL), auth (Fortify +
sessions), and will own the AI calls. Provider API keys live in server config
(`config/services.php` → `anthropic`, `openrouter`, `onlyfans`) and **never**
reach the browser — an improvement over the legacy `ssai_*` proxy token.

## Schema

Migrations recreate the legacy tables faithfully (in-memory `_`-prefixed JS
telemetry fields are intentionally NOT persisted): `aich_models`,
`creator_status`, `customer_profiles`, `model_assignments`, `aich_sessions`,
`aich_messages`, `aich_events`, `aich_feedback_queue`, `aich_vn_used`. Postgres
`jsonb` → MySQL `json`. The legacy `chatters` RBAC folds into `users` (adds a
`role` enum + `must_change_password`). One intentional improvement: the doctrine
"brain" moves out of an `aich_models` row into its own versioned, hashed
`doctrines` table.

## Access control

- **Roles**: `admin | manager | chatter` (`App\Enums\UserRole`). Admin > Manager > Chatter.
- **Row-level**: `CreatorAccessScope` (a global scope on conversation models)
  restricts chatters to their assigned `creator_model`s; admins/managers are
  unrestricted; no authenticated user (console/seeders/tests) = no-op.
- **Ownership**: `BelongsToChatter` auto-stamps `user_id` on create (the legacy
  `installChatterIdAutoInject()`), applied to `AichSession`/`AichMessage`/`AichEvent`.
- **Feature gates**: `view-all-creators`, `manage-team` (manager+), `view-agency-profit`
  (admin only) — defined in `AppServiceProvider::configureGates()`. The Vue shell
  hides UI per role, but these gates are the actual enforcement.

## AI generation engine (Phase 3 — runs the exact legacy logic)

The legacy two-call pipeline runs **unmodified** in the `engine/` Node sidecar
(it loads the real `legacy/js/*.js`). Laravel never reimplements it: `EngineClient`
maps a MySQL `AichSession` (+ persona, profile, creator status) into the legacy
session shape and POSTs to `engine/server.js`; `GenerationController`
(`POST /conversations/{session}/generate`) persists the returned draft as a
draft-log `AichMessage`. The exact `DEFAULT_TRAINING` doctrine is seeded into the
`doctrines` table (sha `a1bcbcef…`, `DoctrineService::integrityOk()` passes) and the
engine uses its in-process copy. Provider keys live in the engine's env
(`ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`), never the browser.

- **Do NOT edit `legacy/js/*` to change behavior** — the engine's whole point is byte-identical parity. Enhancements go in `engine/` wrappers or the (future) PHP port.
- Parity guards: `node engine/parity.js`, `node engine/smoke.js`, `node legacy/tests/harness.js` (283/0).
- The `AnthropicService`/`MistralService` PHP stubs still THROW — a future PHP port
  (intended foundation: the first-party **Laravel AI SDK**) can replace the sidecar.

## Deferred to later specs (do NOT assume these exist)

- **Engine extras** — post-message analysis (`runAnalysis` / engine `/analyze`), PPV
  price suggestion, and the optional PHP port of the pipeline.
- **CRM views** — DONE: app shell + Overview dashboard (Phase 2), **Conversations**
  + **Creator Models** (Phase 4), **AI Usage** (`/analytics/ai-usage`). The remaining design
  views (Chatting Performance, Smart Links, Channels, Creative, Content, Whales/Churn) are each
  their own spec — inert sidebar placeholders today.
  - **AI Usage** (`/analytics/ai-usage`, manager/admin via `can:manage-team`) — restores the legacy
    `js/api.js` cost telemetry (`_ssaiCostLog` / `$/msg · Cache` card / cost-diagnostic modal). The
    engine now records a per-LLM-call usage ledger (`engine/callModel.js` → `makeRealCallApi`/`Mistral`
    take a ledger; `runGenerate` returns `usage[]`) with the exact legacy cost math (Sonnet $3/$15, Opus
    $5/$25, cacheRead 0.1×, cacheWrite 2×; Mistral uses OpenRouter's exact `usage.cost`). Both generate
    paths (`OnlyFansChatController::generate` live, `GenerationController` dev) persist it via
    `AiUsageRecorder` into **`aich_usage_events`** — **metadata only, NO message text** (token counts,
    cost, cache hit, duration, call_type, model, creator, chat id, grouped by `generation_id`). The page
    (`AiUsageService` → `AiUsageController` → `AiUsage.vue`) reproduces the legacy `$/msg` + cache-hit%
    summary (green ≥70 / red <40, "—" under 3 calls) and the last-25 cost-diagnostic table (cache
    HIT/MISS/NO CACHE, r·cR·cW token breakdown, sys-block sizes with the `<1024`-prefix ⚠ warning,
    Copy-JSON). Period filter Today/7d/30d. Guards: `node engine/usage_check.js`.
  - **Conversations** (`/conversations`) — a **live OnlyFans proxy; NOTHING is persisted**
    (Phase 6 replaced the old DB-backed version). The sidebar "Conversations" item is a
    **dropdown of creator models** (shared `creators` prop from `HandleInertiaRequests`);
    picking one opens `/conversations?creator=<name>`. The Vue page fetches everything LIVE
    client-side (`resources/js/lib/onlyfans.ts`) via `OnlyFansChatController` (`/onlyfans/{model}/…`):
    list chats, list/get/search messages, chat media gallery, send (text + optional **GIF**),
    delete, like/unlike, fan details, GIF picker (Giphy trending/search), and AI `generate`
    (a transient engine session built from the live thread — no DB row). Access is scoped in the
    controller (chatter → assigned creators).
    **GIF sending:** `SsComposer` has a **GIF** button opening `SsGifPicker` (a popover over the
    Giphy proxy — `GET /onlyfans/{model}/giphy/{trending,search?q&limit&offset}` →
    `OnlyFansService::listGiphyTrending`/`searchGiphy` → `normalizeGif`). Picking a GIF attaches it
    above the typing bar (per-chat `ComposerState.gif`); Send posts `{ text?, giphyId }` to the same
    send endpoint (`sendGif` adds the `giphyId` body param; text stays optional). The optimistic
    bubble previews the Giphy CDN url directly via a new `OfMedia.direct` flag that bypasses the
    OF media proxy in `SsMessageMedia`/`SsMediaLightbox` (Giphy urls aren't IP-locked, unlike OF CDN);
    the confirmed OF message then renders the GIF through the normal media path. Still text/GIF only —
    PPV/tip + file-media sends remain deferred.
    **Message media renders inline:** `normalizeMessage` now keeps a compact `media[]`
    (`normalizeMedia`: type/canView/thumb/preview/full/duration/dims) instead of only `mediaCount`;
    `SsMessageMedia` shows a thumbnail grid in the bubble (photo, video = poster + ▶ + duration,
    locked/PPV = 🔒 + price) and `SsMediaLightbox` is the full-screen viewer (prev/next + arrow/Esc).
    DRM video has no plain url, so videos show the poster only (no inline streaming). **CDN urls are
    IP-locked** (`cdn*.onlyfans.com` is bound to the proxy IP → 403/`ERR_BLOCKED_BY_ORB` in the
    browser), so every media src loads through `GET /onlyfans/{model}/media?url=<cdn>`
    (`OnlyFansChatController::mediaFile` → `OnlyFansService::downloadMedia`, the API's
    `media/download/{cdnUrl}` endpoint; SSRF-guarded to onlyfans.com hosts, cached server-side by
    file path so repeat views don't re-bill). Frontend builds the url via `ofApi.mediaUrl()`.
    The right rail is **tabbed (Fan / AI Intel)**: `SsAiIntel` renders the legacy AI-Intelligence
    dashboard (temperature gauge, Connection/Customer Type/Phase/Engagement, Framework Calibration,
    Message Purpose, Next Move, Warning) straight from the `generate` response's `strategy` object
    (the legacy "analysis" is folded into the strategy — no separate `/analyze` call); `SsComposer`
    emits the strategy up via `@result`, which auto-switches the rail to AI Intel. Reset per chat.
    Client UX: `Conversations.vue` keeps a per-chat **stale-while-revalidate** cache
    (`msgCache`/`fanCache` Maps) so revisiting a chat renders instantly then revalidates in the
    background (race-safe via `selected.id` check); caches clear on creator switch / Refresh.
    `SsChatThread` auto-scrolls to the newest message (bottom) on open/refresh. The bigger
    upgrade path if the data layer grows is `@tanstack/vue-query` (staleness windows, dedup,
    pagination). **Realtime inbound is wired** (see below): the page subscribes to the active
    creator's private Reverb channel and `onInbound` appends to the open thread + bumps unread/
    preview in the list (still nothing persisted).
  - **Creator Models** (`/models`, manager/admin via `can:manage-team`) — `ModelController`
    CRUD over `aich_models` (persona/library/rules/OF-id/tier) + chatter assignment sync. The
    **index** (`Models.vue`) is a card grid (avatar, tier, green "OnlyFans connected" dot when
    `of_account_id` is set, assigned-chatter count) → each card opens the **show page**
    (`ModelController@show` → `ModelShow.vue`): edit the model's own fields + assignments, plus —
    when an OF account is mapped — a tabbed panel of **live** OnlyFans account data (nothing
    persisted) served by `ModelOnlyFansController` under `models/{model}/of/*` (also manage-team
    gated, so no per-creator assignment scope, unlike the chatter-facing `OnlyFansChatController`).
    Seven tabs (`resources/js/components/crm/models/`, client via `lib/onlyfansModel.ts` → `ofModel`):
    **Fans** (`SsModelFans` — active list / top spenders + per-fan subscription history, read-only),
    **OnlyFans Settings** (`SsModelSettings` — editable profile name/bio/location/website/wishlist +
    subscription price, read-only account flags), **Welcome Message** (`SsModelWelcome` — text edit +
    active toggle, media preview reuses `SsMessageMedia`), **Notifications** (`SsModelNotifications` —
    type-filtered feed + per-type counts + mark-all-read), **Users** (`SsModelUsers` — lookup a fan by
    id/username → profile + Block/Restrict/Subscribe toggles, each POST to act / DELETE to undo; or
    comma-separate up to 10 ids for a **mass lookup** (`users/list`) → pick a result to manage),
    **Links** (`SsModelLinks` — a 4-way subswitch: **Free trial** + **Tracking** (`list`/`create`/
    `delete`/per-link `stats`), **Smart links** (`SsModelSmartLinks` — list/create/delete + an
    expandable per-link detail with inner tabs: Stats, Conversions, Fans, Spenders, Clicks, Tags
    add/remove), **Link tags** (`SsModelLinkTags` — agency-wide tag list, optional type filter)),
    **Promotions** (`SsModelPromotions` — a 2-way subswitch over account-level `{acct}/promotions`
    + `{acct}/bundles`: **Promotions** (`list` paginated via `data.items`/`data.hasMore` + `create`
    [type new|expired|new_and_expired, discount, offerLimit, expirationDays, freeTrialDays required when
    discount=100, optional message] + per-promo `stop` + `delete`) and **Subscription bundles** (`list`
    flat `data[]` + `create` [discount 0–50 step 5, duration 3|6|12 months] + `delete`)).
    Smart links are an **agency-level** OF resource (`/smart-links`, no `{acct}` path segment): list is
    scoped to the creator via `account_ids=<of_account_id>`, create injects `account_id`; per-link ops
    (`/smart-links/{id}/…`) address the smart-link id directly (still `manage-team` gated).
    The show header runs a **live** connection check via `GET {acct}/me` (`isAuth` + real OF
    avatar/@username/subscriber count). `OnlyFansService` methods: `getMe`, `getUser`/`listUserDetails`, `listFans`/`listTopFans`/
    `getFanSubscriptionHistory`, `getSettings`/`updateProfile`/`updateSubscriptionPrice`, welcome
    get/update/toggle, `listNotifications`/`getNotificationCounts`/`markAllNotificationsRead`,
    `block`/`restrict`/`subscribe` (+ un* via DELETE), tracking/trial `list*`/`create*`/`delete*`/
    `get*Stats`, smart-link `listSmartLinks`/`createSmartLink`/`deleteSmartLink`/`getSmartLinkStats`/
    `listSmartLink{Fans,Spenders,Clicks,Conversions,Tags}`/`add|removeSmartLinkTags`, `listLinkTags`,
    `listPromotions`/`createPromotion`/`stopPromotion`/`deletePromotion`, `listBundles`/`createBundle`/
    `deleteBundle` (+ matching `normalizeSmartLink*`/`normalizePromotion`/`normalizeBundle`). **Note:** these `models/{model}/of/*` routes are not under
    `api/*`, so `bootstrap/app.php`'s `shouldRenderJsonWhen` would turn a `ValidationException` into a
    302 redirect — `ModelOnlyFansController::validateJson()` throws an `HttpResponseException` to force
    a real JSON 422 for the `fetch` client. Deferred (read-but-not-built): social buttons,
    DRM/blocked-country editing, fan notes/custom-name, fans-AI-summary, welcome media/price,
    **smart-link cohort-ARPS** (no 200 response shape is documented, so left unimplemented) +
    smart-link postbacks, shared/stored link variants, notification tabs-order.
- **OnlyFans live — DONE.** `OnlyFansService` (Bearer client, base `https://app.onlyfansapi.com/api`)
  is the proxy for chats/messages/media/send/delete/like/unlike/users/giphy; send is text + optional
  GIF (`giphyId`); PPV/paid still blocked (v1). Needs `ONLYFANS_API_KEY` + `aich_models.of_account_id`
  per creator. Confirmed
  paths: `GET {acct}/chats`, `GET {acct}/chats/{chat}/messages[/{id}|/search]`, `GET {acct}/chats/{chat}/media`,
  `POST {acct}/chats/{chat}/messages` (send; `{text}` or `{giphyId,text?}`), `DELETE …/messages/{id}`,
  `POST …/messages/{id}/like|unlike`, `GET {acct}/users/{id}`, `GET {acct}/giphy/trending`,
  `GET {acct}/giphy/search?q&limit&offset`. **Note:** `aich_sessions`/`aich_messages` are NO LONGER used by
  Conversations (kept only for the Dashboard + future analytics). STILL deferred: **PPV/tip +
  media sends**.
- **Realtime inbound — DONE (Laravel Reverb).** `POST /webhooks/onlyfans`
  (`OnlyFansWebhookController`, CSRF-exempt via `webhooks/*`, optional `ONLYFANS_WEBHOOK_SECRET`)
  handles `messages.received`: resolves the creator by `of_account_id`, normalises the message
  (`OnlyFansService::normalizeMessage`), and dispatches `OnlyFansMessageReceived`
  (`ShouldBroadcastNow`) on private `creator.{id}` (authorized by `App\Broadcasting\CreatorChannel`,
  same access scope as the chat controller). The browser uses `@laravel/echo-vue` (`configureEcho`
  in `app.ts`, reads `VITE_REVERB_*`). Channel subscriptions are centralized in
  `resources/js/lib/realtimeInbound.ts` (one private `creator.{id}` subscription per assigned
  creator, kept for the session; events fan out to registered handlers + an `activeChat` tracker)
  so the page UI updater and the app-wide notifier don't fight over `echo().leave`. `Conversations.vue`
  registers its thread/list updater; **`useInboundNotifications`** (started from `SmartStarsLayout`
  + `AppLayout`, so alerts fire on any authenticated page) shows a `vue-sonner` toast + plays a short
  synthesized "bing" (`lib/sound.ts`), gated by client-side prefs in `lib/notificationPrefs.ts`
  (localStorage: `showToast`/`playSound`/`volume`; the notifier stays quiet for the chat you're
  actively viewing in a focused tab). Prefs are editable in two places sharing that store: a quick
  bell menu in the Conversations list header (`SsNotifyMenu`) and `/settings/notifications`
  (`settings/Notifications.vue`). Nothing is persisted server-side — it only mirrors live to open
  browsers. Run Reverb with `php artisan reverb:start` (now part of `composer run dev`); real OF
  delivery needs a public URL (tunnel) + the webhook subscribed to `messages.received` (no secret
  yet). Deferred: `messages.sent`/outbound echo, signature verification, inbound media/PPV rendering,
  browser/system (Notification API) alerts.
- **Production data migration** from the old Supabase project.

## Workflow

- **Run**: `composer run dev` (serves app + vite + queue) or `php artisan serve` + `npm run dev`.
- **Engine**: `node engine/server.js` (port 8787) — it auto-loads `ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`
  (+ `*_MODEL`) from `.env` if unset, so no manual export is needed; exercise it at `/dev/generate`.
  Without keys the pipeline runs but returns an empty draft. On `EADDRINUSE` it means an engine is
  already running — `lsof -ti tcp:8787 | xargs kill` (or set `ENGINE_PORT`). Conversations' Generate
  surfaces a 503 if the engine is unreachable.
- **OnlyFans**: set `ONLYFANS_API_KEY` in `.env` + map `aich_models.of_account_id` (acct_…) per
  creator; then `/conversations` → pick the creator (sidebar) → chats/messages load **live**,
  Generate (engine) → Send posts live; like/unlike/delete/search/media all hit OnlyFans directly.
- **DB**: `php artisan migrate` (MySQL `ssai_crm`). Tests use in-memory SQLite.
- **Test**: `php artisan test` (Pest) · engine: `node engine/parity.js` + `node legacy/tests/harness.js`.
- **Build**: `npm run build`.
- **Lint/format**: Pint (PHP), ESLint + Prettier (JS/Vue).

## Conventions

- New conversation models that carry `creator_model` + `user_id` should
  `use BelongsToChatter`; if they carry `creator_model` only, add
  `CreatorAccessScope` directly (see `AichVnUsed`).
- Gate new manager/admin-only features in `configureGates()` rather than per-call-site.
- Keep provider keys in `config/services.php` + `.env`; never inline or ship to the client.
- New CRM views go under the design shell: add a `pages/*.vue`, route it to
  `SmartStarsLayout` in `app.ts`, add a `NAV` entry in `crm/nav.ts`, and style with
  the `ss-*` tokens / `font-ss` (not the starter's shadcn tokens, which stay for auth/settings).
- `npm run lint:check` / `types:check` must pass; `legacy/` is excluded from lint.
