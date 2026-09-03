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
├── Dockerfile · compose.prod.yaml    ← prod stack: 3 image targets (app/web/engine) + 8 services
├── compose.caddy.yaml                ← TLS overlay: Caddy auto-HTTPS edge in front of nginx `web`
├── docker/                           ← entrypoint.sh, nginx/, php*/, caddy/Caddyfile (+ README runbook)
├── deploy.sh                         ← on-server update helper (git pull → build app → up -d)
├── legacy/                           ← the ENTIRE old vanilla-JS app, archived read-only
│                                       (legacy/package.json restores CommonJS for tests/harness.js)
├── docs/DEPLOY-ubuntu.md             ← fresh-Ubuntu-24.04 deploy runbook
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
- **Concurrent generations are isolated per request.** The legacy JS keeps all state in
  shared globals (`sessions`/`activeId`/`callApi`), so a single shared VM context would let
  overlapping generations clobber each other mid-await (one chat's run stealing another's
  session/transport). `loadEngine.js` compiles the legacy bundle **once** into a reusable
  `vm.Script`, and `createEngine()` runs it into a **fresh VM context per generate** (~1.5ms
  setup, no disk re-read) — `runGenerate.js` uses it, so N chats generate in parallel safely.
  `loadEngine()` is now a cached **read-only** singleton (health/doctrine/parity/warmup only —
  never generation). NB: end-to-end parallelism also needs a concurrent PHP frontend — Docker
  (php-fpm) and prod deliver it; `composer run dev` (`php artisan serve`) is single-threaded so
  it still serializes at the PHP layer regardless of the engine.
- Parity guards: `node engine/parity.js`, `node engine/smoke.js`, `node engine/concurrency_check.js`, `node legacy/tests/harness.js` (283/0).
- Input guards (each proves the engine REACTS to one PHP-supplied input, not just receives it):
  `node engine/money_check.js` (session ppv/tip → `tipPrimary`), `node engine/state_check.js`
  (carry-forward telemetry), `node engine/tw_check.js` (`_profile.is_timewaster` → `flagged_tw` tier).
- The `AnthropicService`/`MistralService` PHP stubs still THROW — a future PHP port
  (intended foundation: the first-party **Laravel AI SDK**) can replace the sidecar.

## Deferred to later specs (do NOT assume these exist)

- **Engine extras** — post-message analysis (`runAnalysis` / engine `/analyze`), PPV
  price suggestion, and the optional PHP port of the pipeline.
- **CRM views** — DONE: app shell + Overview dashboard (Phase 2), **Conversations**
  + **Creator Models** (Phase 4), **AI Usage** (`/analytics/ai-usage`), **Media Vault**
  (`/media-vault`). The remaining design views (Chatting Performance, Smart Links, Channels,
  Creative, Content, Whales/Churn) are each their own spec — inert sidebar placeholders today.
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
  - **Conversations** (`/conversations`) — a **live OnlyFans proxy; no message text is persisted**
    (Phase 6 replaced the old DB-backed version). The only server-side persistence is metadata-only
    carve-outs: AI Intel (`AichChatIntel`, strategy-only), the usage ledger (`aich_usage_events`), and
    **fan memory** (`customer_profiles` — trust/archetype/memory/toggles, see the Fan-tab card below). The sidebar "Conversations" item is a
    **dropdown of creator models** (shared `creators` prop from `HandleInertiaRequests`);
    picking one opens `/conversations?creator=<name>`. The Vue page fetches everything LIVE
    client-side (`resources/js/lib/onlyfans.ts`) via `OnlyFansChatController` (`/onlyfans/{model}/…`):
    list chats, list/get/search messages, chat media gallery, send (text + optional **GIF**),
    delete, like/unlike, fan details, GIF picker (Giphy trending/search), and AI `generate`
    (a transient engine session built from the live thread — no DB row). Access is scoped in the
    controller (chatter → assigned creators).
    **Chat actions** (thread header: `[mute] [pinned] [note] [gallery] [⋯ fan settings]`) —
    mute/unmute, a pinned-messages modal (`SsPinnedModal`, also pin/unpin per bubble), the
    OnlyFans fan note (`SsNoteModal`), and `SsFanSettingsMenu` (open OF profile, rename, mark
    read/unread + manager/admin-only hide/unfollow/restrict/block, gated by `can:manage-team` on
    a nested route sub-group). Spec-verified path asymmetries — mute is `POST …/mute` but unmute
    is **`DELETE …/unmute`**; pin is `POST …/pin` but unpin is **`DELETE …/unpin`** (do not
    "normalise" these). Pinned messages reuse `listMessages(filter=pinned)`, routed as
    `chats/{chat}/pinned` — a **sibling** of `messages`, so it can't collide with
    `messages/{message}`. `isMutedNotifications`/`countPinnedMessages`/**`fan.isRestricted`**
    (+ `isBlocked`) all ride along on the chat list (verified live), so mute/pin/restricted state
    costs no per-chat call. A restricted fan is flagged by a `ShieldMinus` in the `SsConvoList`
    row + a "Restricted" pill in the `SsChatThread` header, both off `chat.restricted`; the
    fan-settings menu reads and patches **that row** (not the cached fan detail, whose
    `isRestricted` goes stale the moment we toggle) via `changed` → `chat-changed` → `patchChat`.
    **Fan custom name → `displayName`, NOT `name` (verified live 2026-07-15).** `PUT
    {acct}/fans/{fan}/custom-name` leaves `name` as the fan's real OnlyFans name and returns the
    custom name in **`displayName`** (`''` when unset). Every fan-bearing payload (`listChats`,
    `getUserDetails`, `listAllFans`, …) carries it. `OnlyFansService::displayNameOf()` is the one
    label resolver — custom name if non-empty, else `name`/`username`/`id` — used by
    `normalizeChat` + the chat controller's `user()`/`rename`, so a rename shows immediately AND
    survives a list refresh. Reading `name` back after a rename returns the *old* label and looks
    like a silent no-op.
    **The fan note is OnlyFans-owned**, `customer_profiles.crm_notes` is only its local mirror so
    `generate` can feed it to the AI without a billed call per generation: reads let OnlyFans win
    and mirror down; writes hit OnlyFans first and mirror **only after a 2xx**; a note predating
    the mirror (local set, OF empty) returns `synced: false` rather than being dropped. `crm_notes`
    is deliberately absent from `PATCH /profile` — one write path only.
    **GIF sending:** `SsComposer` has a **GIF** button opening `SsGifPicker` (a popover over the
    Giphy proxy — `GET /onlyfans/{model}/giphy/{trending,search?q&limit&offset}` →
    `OnlyFansService::listGiphyTrending`/`searchGiphy` → `normalizeGif`). Picking a GIF attaches it
    above the typing bar (per-chat `ComposerState.gif`); Send posts `{ text?, giphyId }` to the same
    send endpoint (`sendGif` adds the `giphyId` body param; text stays optional). The optimistic
    bubble previews the Giphy CDN url directly — `mediaSrc()` proxies only onlyfans.com hosts, and
    a Giphy url isn't one (it isn't IP-locked, unlike OF CDN);
    the confirmed OF message then renders the GIF through the normal media path. Still text/GIF only —
    PPV/tip + file-media sends remain deferred.
    **Message media renders inline:** `normalizeMessage` now keeps a compact `media[]`
    (`normalizeMedia`: type/canView/thumb/preview/full/`source`/duration/dims) instead of only
    `mediaCount`; `SsMessageMedia` shows a thumbnail grid in the bubble (photo, video = poster + ▶ +
    duration, locked/PPV = 🔒 + price) and `SsMediaLightbox` is the full-screen viewer (prev/next +
    arrow/Esc) that plays a video from its `source`. **Video playback is DRM-gated (vendor-confirmed
    2026-07-13):** `bestVideoSource` resolves a playable MP4 from `videoSources` (highest res) or
    `files.full.url`, so **non-DRM videos play inline**. But creators with OnlyFans "DRM Protection"
    ON (`GET {acct}/settings/drm` → `enabled`) serve videos as encrypted FairPlay(HLS)/Widevine(DASH)
    ONLY — `files.full.url` + `videoSources` are null, leaving just `files.drm.manifest`+`signature`
    (CloudFront, IP-locked). `source` is then null. **DRM videos ARE playable since 2026-08-21** — the vendor
    shipped a decrypt endpoint, `GET {acct}/media/download/drm/{media_id}`, which resolves the
    Widevine license server-side, decrypts, and 302s to `dl.fansapi.com` streaming a plain MP4.
    (This reverses the earlier "impossible" finding — the old workarounds are still dead ends and
    need no re-investigation: `media/scrape file_type=full` → 400, Get-Vault-Media returns the same
    locked object, and the signed `.m3u8` fetches but is `#EXT-X-KEY:METHOD=SAMPLE-AES,
    KEYFORMAT="com.apple.streamingkeydelivery"` FairPlay, undecryptable client-side.) It is
    **slow (8-15s to first byte) and billed per byte**, so it is cached:
    `normalizeMedia` exposes **`drm`** (true when `files.drm` exists — the one way to tell our own
    DRM video, which is fetchable, from locked PPV media, which is not); opening such a video in
    `SsMediaLightbox` starts the download immediately behind a spinner (no call-to-action button —
    the fetch is the click), hitting `GET /onlyfans/{model}/media/drm/{media}` (`OnlyFansChatController::drmMediaFile` →
    `OnlyFansService::downloadDrmMedia`, own `services.onlyfans.drm_timeout`, streamed to a sink —
    never buffered in memory). The MP4 caches at `storage/app/private/of-drm/{acct}/{id}.mp4`
    (a `.part` file renamed only on success) and is served with `response()->file()`, so the
    browser can **seek** and a re-watch costs nothing; a `Cache::lock` stops two chatters paying
    for the same video twice, and `php artisan of:prune-drm-cache --days=7` (scheduled weekly)
    keeps the cache bounded. **Sizing/timeouts (learned the hard way 2026-08-30):** real vault
    videos reach **250MB+** (not the 10MB of the first sample), so on a slow link a download runs
    for many minutes. `services.onlyfans.drm_timeout` defaults to **1800s** and nginx's
    `fastcgi_read_timeout` is **1800s** — BOTH must stay high; whichever is lower cuts the request
    first, and the earlier 300s pair produced "The DRM download timed out". The `Cache::lock` TTL
    is derived from `drm_timeout` (+60s) for the same reason: a lock that expires mid-download lets
    a second click start a duplicate, and duplicates are billed twice. **The endpoint does NOT
    support Range/resume** (tested live: sending `Range` returns 302 then drops the connection),
    so a timeout discards the `.part` file and the retry re-bills from zero — which is why the
    timeouts are generous rather than tight. The button surfaces the upstream 402 ("insufficient credits") / 422
    ("not DRM-protected") verbatim, via a 1-byte `Range` probe — a bare `<video>` reports every
    failure as an opaque `error` event. Guards: `tests/Feature/OnlyFansDrmMediaTest.php`.
    **The endpoint resolves Media Vault ids ONLY — verified live 2026-08-24:** a chat-message
    media id returns OnlyFans' own 404 `"Media Not Found"`, so the lightbox maps 404 to "This
    video can only be played from the Media Vault" plus an **Open Media Vault** link (no retry —
    retrying can never succeed; the vault opens on the same creator via the app-wide creator
    context, so the link needs no query param). There is no way to map a chat media id to its
    vault twin: hash-matching the CDN filename (`{size}_{hash}.jpg`) fails, 0/3 against 79
    indexed vault items. **Measured live (local, 4.8 Mbit/s link):**
    TTFB 7.6s, then ~430 KB/s → 31.7s total for a 9s/9.9MB clip. The payload is a **fragmented
    MP4 (`ftyp|moov|moof+mdat…`), moov first**, so it is progressively playable in principle —
    but the transfer ran ~2.6x slower than the video's own 8.8 Mbit/s bitrate, so streaming it
    would stall; download-then-play is correct. That 430 KB/s was ~71% of the machine's total
    bandwidth (Cloudflare 50MB control: 605 KB/s), i.e. **the local link, not the vendor, is the
    bottleneck** — expect far faster on a server, where the fixed 7.6s decrypt dominates. The creator can still turn DRM off entirely
    (`PATCH {acct}/settings/drm`, FUTURE uploads only). **CDN urls are
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
    **Persisted fan memory (carve-out — metadata only, NO message text):** the Fan tab's
    "Memory & controls" card restores the legacy `customer_profiles` contribution to AI generation
    (`FanProfileService` over the revived `customer_profiles`, keyed by `(creator_model, of_fan_id)`
    where **of_fan_id = the chat id**). On `generate`, `OnlyFansChatController` loads-or-creates the
    fan's profile, refreshes lifetime spend/tips/subscription from OnlyFans (`getUser` →
    `OnlyFansService::extractFanSpend`, non-blocking), feeds the legacy `_profile` + spend + per-fan
    toggles into `EngineClient::generateFromLive` (so the brain sees a returning customer, not a $0
    lurker), then **folds the returned analysis back** into the record (`trust_level`/`archetype`/
    `temperature`/`key_details`). Merge is **per-field lock**: a human edit pins that field in
    `locked_fields` so auto-analysis won't clobber it; the card's lock button un-pins ("let AI manage").
    Human-owned (no lock): `crm_notes`, `is_timewaster`, `sexting_mode`, `tip_mode` (AUTO/FORCE_ON/
    FORCE_OFF). `is_timewaster` rides on `_profile` **cast to a real bool** — legacy
    `computeCustomerTier` short-circuits to the `flagged_tw` posture tier on a strict `=== true`,
    so a truthy `1`/`"1"` would silently do nothing (guard: `node engine/tw_check.js`).
    OF-owned (always overwritten): spend + `subscription_status`. Endpoints
    `GET|PATCH onlyfans/{model}/chats/{chat}/profile` (`account()`-scoped, JSON-422 via `validateJson`);
    client `ofApi.getProfile`/`saveProfile`. Spec: `docs/superpowers/specs/2026-07-03-fan-customer-profile-design.md`.
    The generate payload's `customer` **must carry `name` + `username`**, not just `id`: the legacy
    prompt prints `Customer: {name} (@{username})` and then states "You already know his name
    ({name})... use his name when it fits", so an omitted name makes the engine fall back to the
    literal string `'Fan'` and the AI addresses the fan as "Fan". `customer` is deliberately
    rule-less in `generate()`'s `validate()` — adding `customer.*` rules would strip the keys not
    listed (the same trap as `messages.*.time`).
    Per-message PPV/`opened`/`price` mapping (`LiveThreadMapper` → `sender:'ppv'` bubbles +
    gap-windowed session spend) and multi-turn forcing-move continuation (`ChatStateService` →
    `_promiseStatus`/`_storyFrameworkStep`) are both DONE. Still deferred: `prior_session_count`
    (legacy's third "returning customer" signal — no column, so a $0/trust-1 returnee reads as new).
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
    type-filtered feed + per-type counts + mark-all-read), **Users** (`SsModelUsers` — a 3-way
    subswitch: **Lookup** (a fan by id/username → profile + Block/Restrict/Subscribe toggles, each
    POST to act / DELETE to undo; or comma-separate up to 10 ids for a **mass lookup**
    (`users/list`) → pick a result to manage) + **Blocked Users** / **Restricted Users**
    (`SsModelModeratedUsers`, one component driven by `bucket` — both lists return the same user
    object, so all three reuse `normalizeUserDetail`; per-row block/unblock + restrict/unrestrict
    reusing the existing toggles). Route order matters: `users/blocked`/`users/restricted` are
    registered **above** `users/{user}` or that param route captures them. Lists are lazy-mounted
    then kept alive (`v-show`), so switching tabs doesn't re-bill. Paging is `limit` (**max 50**) +
    `offset`, driven by **`data.hasMore`** — `data.nextOffset` keeps advancing past the end and
    `_pagination.next_page` is returned even on the last page. **Verified live 2026-07-15:** the
    restricted list is `GET {acct}/users/restricted`; the `/users/restrict` shown in the docs
    example's `next_page` **500s**. **There is NO "blocked at"/"restricted at" timestamp anywhere
    in the API** — `lastSeen` is the only date on a moderated user, so these lists can't be sorted
    by when the action happened; don't go looking for it again. A user is commonly blocked AND
    restricted at once, so both badges render independently),
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
  - **Media Vault** (`/media-vault`) — a **standalone sidebar view, live OnlyFans proxy, nothing
    persisted**, modelled on Conversations. The sidebar "Media Vault" item is a **dropdown of creator
    models** (the same shared `creators` prop + `dynamic:'creators'` nav pattern; `SsSidebar` now
    builds each dynamic child's href from the node's `basePath`, so Conversations `/conversations`
    and this `/media-vault` share one code path). `MediaVaultController@index` is a thin shell
    (`selectedCreator` only); `MediaVault.vue` resolves the model id from `creators` and is a
    **two-panel layout**: `SsVaultRail` (left — "All media" pinned on top, then the vault lists
    with per-type counts, plus search/create/rename/delete) drives `SsVaultGrid` (right — that
    list's media, type pills, vault search, upload, select/bulk actions, lightbox). Built on the **chatter-facing `/onlyfans/{model}/…`** surface
    (`OnlyFansChatController` + `ofApi`, per-creator access scope), reusing the existing
    `vault`/`mediaFile`(proxy)/`uploadStatus` plumbing. New endpoints there: **vault media**
    `POST media/vault` (upload — file **or** `file_url`, async → poll the existing
    `media/uploads/{upload}/status`; NB posts to `media/vault`, distinct from `media/upload`'s CDN
    single-use path), `GET media/vault/{media}` (one item), `DELETE media/vault/delete-media`
    (`{mediaIds}`); **vault lists** `GET|POST media/vault/lists`, `GET|PUT media/vault/lists/{list}`
    (show/rename), `POST|DELETE media/vault/lists/{list}/media` (add/remove). **Body-key asymmetry
    (verified per docs, do NOT normalise):** add sends **`media_ids`**, remove sends **`mediaIds`** —
    `OnlyFansService::addMediaToVaultList`/`removeMediaFromVaultList` translate from the CRM's uniform
    `mediaIds`. **Route order:** `media/vault/lists*` + `media/vault/delete-media` are registered
    ABOVE the `GET media/vault/{media}` wildcard. `OnlyFansService::normalizeVaultList` shapes list
    payloads. **Read a list's contents with `GET media/vault?list={id}` — NEVER from
    `showVaultList`.** That list-detail endpoint's `medias` is a **3-item thumbnail preview**:
    compact `{type, url}` objects (300x300, no `id`, no `files`), capped at 3 regardless of the
    list's real size, and the endpoint takes no pagination params (verified live + against the
    OpenAPI spec, 2026-08-30). Driving the UI from it gave "only 3 media per list" and a
    "Locked video" lightbox, because there is no id/source to play. The `list` query param on the
    vault-media endpoint returns the **full** objects instead (ids, `files`, `videoSources`,
    `files.drm`, `createdAt`), paginated by `hasMore` — verified live: `?list=29195314` returned
    exactly the 6 items its counts declared. `listVaultMedia` forwards
    **`type`/`list`/`query`/`limit`/`offset`** (the API also documents `field`/`sort`, unused).
    **`listVaultLists` caps `limit` at 30** — an UNDOCUMENTED upstream maximum (the spec shows only
    a default of 24); above it the API 422s `VALIDATION_ERROR "The limit field must not be greater
    than 30."`, so the service clamps rather than forwards. NB the media and lists endpoints have
    different caps: vault media allows 10-100, vault lists only 30.
    **Hard-deletes**
    (`delete-media`, delete list) sit in the route group's `can:manage-team` subgroup — manager/admin
    only (delete buttons hidden client-side for chatters via `can(role,'manageTeam')`); everyone
    assigned can browse/upload/create/rename/add/remove. Components: `pages/MediaVault.vue` +
    `components/crm/vault/{SsVaultRail,SsVaultGrid}.vue` (grid clones `SsVaultModal` + the
    Conversations upload state machine; media renders via `SsMediaLightbox`). **Vault thumbnails are
    `cdn.fansapi.com` presigned S3 urls — browser-loadable, NOT IP-locked like `cdn*.onlyfans.com`**,
    so they must NOT go through the media proxy (whose SSRF guard only allows onlyfans.com).
    **Proxy-vs-direct is decided PER URL by `mediaSrc(modelId, url)` (`lib/onlyfans.ts`) — never per
    media item.** A single OnlyFans media object mixes hosts across its own files (`thumb` on
    `cdn2.onlyfans.com`, `preview` on `cdn.fansapi.com`), so the old per-item `OfMedia.direct` flag
    (true only when NO url was onlyfans) sent fansapi urls through the proxy and 400'd them; it is
    gone, and every renderer calls `mediaSrc` instead. Defence in depth: `mediaFile` now **302s** a
    `*.fansapi.com` url back to the browser rather than 400ing, so a missed call site degrades to a
    slower load instead of a broken image (`OnlyFansService::isVendorCdnUrl`).
    **Video playback:** the vault LIST payload omits a video's playable source (`videoSources`/
    `files.full.url` absent), so `SsVaultGrid` fetches the single-media detail
    (`GET media/vault/{id}` → `vaultMediaItem`) on lightbox-open for a video with no `source` and
    merge it in — non-DRM videos then play. A **genuinely DRM-protected** video (creator's DRM
    Protection ON) still resolves to no source, but the detail payload carries `files.drm`, so the
    shared lightbox auto-loads it here — the vault is in fact the ONLY home of the DRM download
    endpoint (see the DRM notes on the Conversations entry).
    Deferred: CDN single-use upload UI, send/attach-to-chat, per-item list-membership editing beyond
    add/remove. **NB three doc/live points to confirm against a real key:** the `delete-media` path,
    the `media_ids`/`mediaIds` add/remove keys, and that async `POST media/vault` returns a
    `prefixed_id` the status poller resolves.
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

## Deployment (production — Docker + Caddy, DONE)

Single-host **Docker** stack, HTTPS-terminated by **Caddy**. One multi-stage
`Dockerfile` builds three targets — `app` (PHP-FPM; also runs queue/reverb/
scheduler), `web` (nginx serving `public/` + proxying PHP→`app:9000` and the
`/app` websocket→`reverb:8080`), `engine` (Node sidecar). `compose.prod.yaml`
wires 8 services (web/app/queue/reverb/scheduler/engine/mysql/redis); the `app`
entrypoint waits for MySQL, runs `migrate --force` + `storage:link` + `optimize`
on boot. **`compose.caddy.yaml` is the TLS overlay** (apply BOTH files together):
it adds a `caddy` service (auto Let's Encrypt) publishing 80/443 that
`reverse_proxy`s everything to `web:80`, and drops `web`'s host port via
`ports: !reset []` so only Caddy is internet-facing. nginx already splits `/app`
→ reverb internally, so Caddy needs no websocket config (it upgrades transparently).
`bootstrap/app.php` sets **`trustProxies(at: '*')`** so Laravel detects HTTPS behind
the edge (correct URLs, secure cookies, Reverb auth) — safe because app/web are
reachable only over the internal Docker network.

- **Env:** lives in **`.env.docker`** (git-ignored; template `.env.docker.example`
  with **blank** placeholders — never commit real secrets). `SITE_ADDRESS` +
  `APP_URL` = the public domain. Build-time `VITE_REVERB_*` point at the domain
  over 443/https; server-side `REVERB_HOST=reverb`/`8080`/`http` stays internal —
  **don't collapse them**. **Changing any `VITE_*` (or build-time var) requires
  rebuilding `app` + `web`.**
- **Run:** `docker compose -f compose.prod.yaml -f compose.caddy.yaml --env-file .env.docker up -d`
  (or `export COMPOSE_FILE=compose.prod.yaml:compose.caddy.yaml COMPOSE_ENV_FILES=.env.docker`).
  Seed the first admin with `ProductionSeeder` (`ADMIN_PASSWORD`). `deploy.sh` is the
  on-server update helper (git pull → build `app` → `up -d`).
- **Docs:** fresh-server runbook `docs/DEPLOY-ubuntu.md`; per-service detail
  `docker/README.md`; design/plan under `docs/superpowers/{specs,plans}/
  2026-07-07-ubuntu-2404-docker-deploy-*.md`. **First live deploy done 2026-07-07.**
- **Note:** the repo currently has ~194 **pre-existing** phpstan errors in unrelated
  files (`ModelOnlyFansController`, `AnalyticsController`, …), so `composer run ci:check`
  fails on `types:check` even though `php artisan test` is green — separate cleanup.

## Workflow

- **Run**: `composer run dev` (serves app + vite + queue) or `php artisan serve` + `npm run dev`.
- **Run (Docker)**: `docker compose up -d --build` — full stack in containers with live
  reload (`compose.yaml`, `name: ssai-dev`), isolated from prod. See `README.md` → "Local
  dev with Docker". Requires `cp .env.docker.dev.example .env.docker.dev` first.
- **Engine**: `node engine/server.js` (port 8787) — it auto-loads `ANTHROPIC_API_KEY`/`OPENROUTER_API_KEY`
  (+ `*_MODEL`) from `.env` if unset, so no manual export is needed; exercise it at `/dev/generate`.
  Without keys the pipeline runs but returns an empty draft. On `EADDRINUSE` it means an engine is
  already running — `lsof -ti tcp:8787 | xargs kill` (or set `ENGINE_PORT`). Conversations' Generate
  surfaces a **503** when the engine is unreachable and a **504** when it times out — these are
  distinct on purpose. Laravel raises the same `ConnectionException` for both, so a blown
  `ENGINE_TIMEOUT` used to be reported as "engine is not reachable — start it with
  `node engine/server.js`", which is wrong twice over in Docker (the engine is healthy, and
  there is no such command to run). **`ENGINE_TIMEOUT` is 180s, not 60s**: /generate is TWO
  sequential LLM calls and the strategy pass alone measures 34-36s on a production-shaped
  thread (40 msgs + real persona/library ≈ 42-45s total, vs 25s on a toy 3-msg thread), while
  `callModel.js` retries transient 429/529 up to 3x — one retry of that pass adds ~35s, so 60s
  could not survive a single one. It must stay under php.ini's `max_execution_time` (300s).
  `ENGINE_CONNECT_TIMEOUT` (5s) is separate so a genuinely dead engine still fails fast instead
  of hanging for the whole budget. NB a timed-out generation is **billed but never recorded** —
  the early return skips `AiUsageRecorder`, so AI Usage under-reports those.
- **OnlyFans**: set `ONLYFANS_API_KEY` in `.env` + map `aich_models.of_account_id` (acct_…) per
  creator; then `/conversations` → pick the creator (sidebar) → chats/messages load **live**,
  Generate (engine) → Send posts live; like/unlike/delete/search/media all hit OnlyFans directly.
- **DB**: `php artisan migrate` (MySQL `ssai_crm`). Tests use in-memory SQLite.
- **Test**: `php artisan test` (Pest) · engine: `node engine/parity.js` + `node legacy/tests/harness.js`.
- **Build**: `npm run build`.
- **Deploy** (prod): single-host Docker + Caddy TLS — see the Deployment section above and
  `docs/DEPLOY-ubuntu.md`. Build/run:
  `docker compose -f compose.prod.yaml -f compose.caddy.yaml --env-file .env.docker up -d`.
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
