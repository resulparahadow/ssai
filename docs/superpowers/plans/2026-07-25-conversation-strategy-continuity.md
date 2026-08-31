# Conversation Strategy Continuity (Package A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the stateless live Conversations generate path a per-chat "save file" so the AI's prior strategy, analysis, planned next move, and promise/story progress carry forward into the next generation — matching legacy's turn-to-turn continuity.

**Architecture:** A new `aich_chat_state` table (metadata only, no message text) holds the carried state per `(creator_model, chat_id)`. The engine surfaces three already-computed fields in its telemetry. `EngineClient::generateFromLive` replays the saved state into the legacy session shape it builds. The controller loads state on generate and commits it via a new endpoint the composer calls on Accept / Accept & Send.

**Tech Stack:** Laravel 13 / PHP 8.3 · Pest · Node engine sidecar (VM-hosted legacy JS) · Vue 3 + TypeScript.

## Global Constraints

- No message text is ever persisted — metadata only (token/strategy/analysis fields), consistent with `aich_chat_intel` and `customer_profiles`.
- Do NOT edit `legacy/js/*` behavior. The engine change only surfaces existing computed values.
- No new billed AI calls.
- New `onlyfans/{model}/*` routes are NOT under `api/*`, so validation must use the controller's `validateJson()` helper to force a JSON 422 (a plain `validate()` would 302-redirect).
- Access is scoped in the controller via `authorizeCreator()` (chatter → assigned creators only).
- PHP: `php artisan test`. Frontend gates: `npm run types:check` and `npx eslint <files>` must pass. Engine: `node engine/<check>.js`.
- Models use explicit `$fillable` (never `$guarded`).

---

### Task 1: `aich_chat_state` table + `AichChatState` model

**Files:**
- Create: `database/migrations/2026_07_25_000000_create_aich_chat_state_table.php`
- Create: `app/Models/AichChatState.php`
- Test: `tests/Feature/ChatStateTest.php`

**Interfaces:**
- Produces: `App\Models\AichChatState` with `$fillable` = `creator_model, chat_id, last_strategy, last_analysis, next_planned_move, next_planned_move_at_msg, promise_status, story_framework_step, committed_by`; `last_strategy`/`last_analysis` cast to `array`; `CreatorAccessScope` applied in `booted()`.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/ChatStateTest.php`:

```php
<?php

use App\Models\AichChatState;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

it('stores and reads per-chat strategy state', function () {
    $state = AichChatState::create([
        'creator_model' => 'Camila',
        'chat_id' => '101',
        'last_strategy' => ['phase' => 'sell'],
        'last_analysis' => ['archetype' => 'Whale'],
        'next_planned_move' => 'run_promise_ritual',
        'next_planned_move_at_msg' => 5,
        'promise_status' => 'in_progress',
        'story_framework_step' => 2,
    ]);

    $fresh = $state->fresh();
    expect($fresh->last_strategy['phase'])->toBe('sell');
    expect($fresh->last_analysis['archetype'])->toBe('Whale');
    expect($fresh->next_planned_move)->toBe('run_promise_ritual');
    expect($fresh->story_framework_step)->toBe(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test tests/Feature/ChatStateTest.php`
Expected: FAIL — `Class "App\Models\AichChatState" not found` (or no such table).

- [ ] **Step 3: Write the migration**

Create `database/migrations/2026_07_25_000000_create_aich_chat_state_table.php`:

```php
<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Carried AI strategy state per live OnlyFans chat — the "save file" that lets the
 * next generation build on prior turns (last strategy/analysis, planned next move,
 * promise + story-framework progress). Metadata only, no message text. One row per
 * (creator_model, chat_id), upserted when a generated draft is accepted/sent.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('aich_chat_state', function (Blueprint $table) {
            $table->id();
            $table->string('creator_model');                                          // enables CreatorAccessScope
            $table->string('chat_id');                                                // opaque OF chat/fan id
            $table->json('last_strategy')->nullable();                                // strategy that shaped the last committed message
            $table->json('last_analysis')->nullable();                                // folded analysis (_lastAnalysis shape)
            $table->string('next_planned_move')->nullable();                          // anti-drift forward plan
            $table->integer('next_planned_move_at_msg')->nullable();
            $table->string('promise_status')->default('not_started');
            $table->integer('story_framework_step')->default(0);
            $table->foreignId('committed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['creator_model', 'chat_id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('aich_chat_state');
    }
};
```

- [ ] **Step 4: Write the model**

Create `app/Models/AichChatState.php`:

```php
<?php

namespace App\Models;

use App\Models\Scopes\CreatorAccessScope;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Carried AI strategy state for one live OnlyFans chat, keyed by (creator_model,
 * chat_id). Replayed into the engine so the next generation continues the prior
 * turn's plan. Stores strategy/analysis metadata only — no message text. Carries
 * creator_model but no user_id, so it takes the creator-access scope directly.
 */
class AichChatState extends Model
{
    protected $table = 'aich_chat_state';

    protected $fillable = [
        'creator_model',
        'chat_id',
        'last_strategy',
        'last_analysis',
        'next_planned_move',
        'next_planned_move_at_msg',
        'promise_status',
        'story_framework_step',
        'committed_by',
    ];

    protected $casts = [
        'last_strategy' => 'array',
        'last_analysis' => 'array',
        'story_framework_step' => 'integer',
        'next_planned_move_at_msg' => 'integer',
    ];

    protected static function booted(): void
    {
        static::addGlobalScope(new CreatorAccessScope);
    }

    /** @return BelongsTo<User, $this> */
    public function committedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'committed_by');
    }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `php artisan test tests/Feature/ChatStateTest.php`
Expected: PASS (1 passed).

- [ ] **Step 6: Commit**

```bash
git add database/migrations/2026_07_25_000000_create_aich_chat_state_table.php app/Models/AichChatState.php tests/Feature/ChatStateTest.php
git commit -m "feat(chat-state): add aich_chat_state table + model for strategy carry-forward"
```

---

### Task 2: Engine surfaces `lastAnalysis` / `nextPlannedMove` in telemetry

**Files:**
- Modify: `engine/runGenerate.js` (the `telemetry` object in the return, ~lines 73-89)
- Create: `engine/state_check.js`

**Interfaces:**
- Produces: `generateDraft(...)` return `telemetry` now also carries `lastAnalysis` (object|null), `nextPlannedMove` (string|null), `nextPlannedMoveAtMsg` (number|null). Existing `promiseStatus` / `storyFrameworkStep` unchanged.

- [ ] **Step 1: Write the failing check**

Create `engine/state_check.js`:

```js
'use strict';
/* Verifies the engine surfaces the carry-forward telemetry fields Package A persists:
 * lastAnalysis (folded analysis), nextPlannedMove/at-msg, promiseStatus, storyFrameworkStep. */
const assert = require('assert');
const { generateDraft } = require('./runGenerate');

const fakeStrategy = {
    tone: 'warm', phase: 'rapport', promise_status: 'not_started',
    strategy: 'build rapport', next_move: 'ask a warm question', next_move_after_wall: 'continue_climb',
    message_length: 'short', caption_required: false, agent_override_active: false,
    trust_level: 2, archetype: 'Explorer', temperature: 'warm', message_purpose: 'deepen rapport',
    skeleton_step: 'Chit Chat',
};
const callApi = async (_s, _u, _m, _f, t) => (t && String(t).startsWith('strategy')) ? JSON.stringify(fakeStrategy) : 'hey you 🙈';
const callMistral = async () => 'hola 🙈';

(async () => {
    const out = await generateDraft({
        model: { name: 'Camila', prompt: 'You are Camila.', content_library: '', feedback_rules: '' },
        session: {
            id: 'state-1', creator_model: 'Camila', customer_name: 'Jake', customer_username: 'jake_w',
            subscription_status: 'subscribed', total_spend: '$0', tips_spend: '$0', crm_notes: '', vn_used: [],
            inputMode: 'chat',
            _promiseStatus: 'in_progress', _storyFrameworkStep: 2,
            messages: [{ sender: 'customer', text: 'hey', ts_iso: new Date().toISOString() }],
        },
        creatorStatus: [], api: 'claude', sender: 'customer', context: '',
    }, { callApi, callMistral });

    const t = out.telemetry;
    assert.ok(t && typeof t === 'object', 'telemetry present');
    assert.ok('lastAnalysis' in t, 'telemetry.lastAnalysis key present');
    assert.strictEqual(t.lastAnalysis && t.lastAnalysis.archetype, 'Explorer', 'folded analysis carries archetype');
    assert.ok('nextPlannedMove' in t, 'telemetry.nextPlannedMove key present');
    assert.ok('nextPlannedMoveAtMsg' in t, 'telemetry.nextPlannedMoveAtMsg key present');
    console.log('✓ state_check: carry-forward telemetry fields present');
})().catch((e) => { console.error('STATE_CHECK FAILED:', e.message); process.exit(1); });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node engine/state_check.js`
Expected: FAIL — `AssertionError: telemetry.lastAnalysis key present` (fields not surfaced yet).

- [ ] **Step 3: Add the fields to the telemetry return**

In `engine/runGenerate.js`, inside the `telemetry: { ... }` object (alongside `promiseStatus` / `storyFrameworkStep`), add these three lines:

```js
            lastAnalysis: s._lastAnalysis ?? null,
            nextPlannedMove: s._nextPlannedMove ?? (s.ladder_state ? s.ladder_state.next_planned_move : null) ?? null,
            nextPlannedMoveAtMsg: s._nextPlannedMoveAtMsg ?? (s.ladder_state ? s.ladder_state.next_planned_at_msg : null) ?? null,
```

- [ ] **Step 4: Run it to verify it passes**

Run: `node engine/state_check.js`
Expected: `✓ state_check: carry-forward telemetry fields present`.

- [ ] **Step 5: Run existing engine guards to confirm no regression**

Run: `node engine/smoke.js && node legacy/tests/harness.js`
Expected: smoke prints `✓ generate() ran end-to-end headless`; harness prints `PASS n / FAIL 0`.

- [ ] **Step 6: Commit**

```bash
git add engine/runGenerate.js engine/state_check.js
git commit -m "feat(engine): surface lastAnalysis + nextPlannedMove in generate telemetry"
```

---

### Task 3: `EngineClient::generateFromLive` replays saved state

**Files:**
- Modify: `app/Services/Engine/EngineClient.php` (`generateFromLive`, the `session` array ~lines 55-73)
- Test: `tests/Feature/EngineReplayTest.php`

**Interfaces:**
- Consumes: `opts['state']` — the array from `ChatStateService::toEngineState` (Task 4): keys `last_strategy`, `last_analysis`, `next_planned_move`, `next_planned_move_at_msg`, `promise_status`, `story_framework_step`.
- Produces: the engine `session` payload now carries `_lastStrategy`, `_lastAnalysis`, `_nextPlannedMove`, `_nextPlannedMoveAtMsg`, and honors replayed `_promiseStatus` / `_storyFrameworkStep`.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/EngineReplayTest.php`:

```php
<?php

use App\Models\AichModel;
use App\Services\Engine\EngineClient;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

it('replays saved chat state into the engine session payload', function () {
    config(['services.engine.url' => 'http://127.0.0.1:8787']);
    Http::fake(['127.0.0.1:8787/*' => Http::response([
        'draft' => 'hi', 'strategy' => ['phase' => 'sell'], 'telemetry' => null, 'usage' => [],
    ])]);

    $model = AichModel::create(['name' => 'Camila', 'prompt' => 'x', 'of_account_id' => 'acct_cam']);

    app(EngineClient::class)->generateFromLive($model, [], ['id' => '101'], [
        'state' => [
            'last_strategy' => ['phase' => 'sell'],
            'last_analysis' => ['archetype' => 'Whale'],
            'next_planned_move' => 'run_promise_ritual',
            'next_planned_move_at_msg' => 5,
            'promise_status' => 'in_progress',
            'story_framework_step' => 2,
        ],
    ]);

    Http::assertSent(fn ($r) => data_get($r->data(), 'session._lastStrategy.phase') === 'sell'
        && data_get($r->data(), 'session._lastAnalysis.archetype') === 'Whale'
        && data_get($r->data(), 'session._nextPlannedMove') === 'run_promise_ritual'
        && data_get($r->data(), 'session._nextPlannedMoveAtMsg') === 5
        && data_get($r->data(), 'session._promiseStatus') === 'in_progress'
        && data_get($r->data(), 'session._storyFrameworkStep') === 2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test tests/Feature/EngineReplayTest.php`
Expected: FAIL — `_promiseStatus` is `not_started` and `_lastStrategy` is absent (assertion fails).

- [ ] **Step 3: Edit the session payload**

In `app/Services/Engine/EngineClient.php`, in `generateFromLive`, replace these two lines:

```php
                '_promiseStatus' => 'not_started',
                '_storyFrameworkStep' => 0,
```

with:

```php
                '_lastStrategy' => $opts['state']['last_strategy'] ?? null,
                '_lastAnalysis' => $opts['state']['last_analysis'] ?? null,
                '_nextPlannedMove' => $opts['state']['next_planned_move'] ?? null,
                '_nextPlannedMoveAtMsg' => $opts['state']['next_planned_move_at_msg'] ?? null,
                '_promiseStatus' => $opts['state']['promise_status'] ?? 'not_started',
                '_storyFrameworkStep' => (int) ($opts['state']['story_framework_step'] ?? 0),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php artisan test tests/Feature/EngineReplayTest.php`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add app/Services/Engine/EngineClient.php tests/Feature/EngineReplayTest.php
git commit -m "feat(engine-client): replay saved chat state into the live generate session"
```

---

### Task 4: `ChatStateService` (load + commit)

**Files:**
- Create: `app/Services/OnlyFans/ChatStateService.php`
- Test: `tests/Feature/ChatStateServiceTest.php`

**Interfaces:**
- Consumes: `App\Models\AichChatState` (Task 1).
- Produces:
  - `find(AichModel $model, string $chatId): ?AichChatState`
  - `toEngineState(?AichChatState $state): array` — the `opts['state']` array consumed by Task 3.
  - `commit(AichModel $model, string $chatId, array $strategy, array $telemetry, ?int $userId): AichChatState`

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/ChatStateServiceTest.php`:

```php
<?php

use App\Models\AichChatState;
use App\Models\AichModel;
use App\Services\OnlyFans\ChatStateService;
use Illuminate\Foundation\Testing\RefreshDatabase;

uses(RefreshDatabase::class);

beforeEach(function () {
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'x', 'of_account_id' => 'acct_cam']);
    $this->svc = app(ChatStateService::class);
});

it('returns cold-start defaults when no state row exists', function () {
    $s = $this->svc->toEngineState($this->svc->find($this->model, '101'));
    expect($s['promise_status'])->toBe('not_started');
    expect($s['story_framework_step'])->toBe(0);
    expect($s['last_strategy'])->toBeNull();
});

it('commits strategy + telemetry then loads them back', function () {
    $this->svc->commit($this->model, '101', ['phase' => 'sell'], [
        'lastAnalysis' => ['archetype' => 'Whale'],
        'nextPlannedMove' => 'run_promise_ritual',
        'nextPlannedMoveAtMsg' => 5,
        'promiseStatus' => 'in_progress',
        'storyFrameworkStep' => 2,
    ], 7);

    $s = $this->svc->toEngineState($this->svc->find($this->model, '101'));
    expect($s['last_strategy']['phase'])->toBe('sell');
    expect($s['last_analysis']['archetype'])->toBe('Whale');
    expect($s['next_planned_move'])->toBe('run_promise_ritual');
    expect($s['promise_status'])->toBe('in_progress');
    expect($s['story_framework_step'])->toBe(2);

    expect(AichChatState::where('chat_id', '101')->first()->committed_by)->toBe(7);
});

it('upserts in place on a second commit', function () {
    $this->svc->commit($this->model, '101', ['phase' => 'rapport'], [], null);
    $this->svc->commit($this->model, '101', ['phase' => 'sell'], [], null);

    expect(AichChatState::where('chat_id', '101')->count())->toBe(1);
    expect($this->svc->find($this->model, '101')->last_strategy['phase'])->toBe('sell');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test tests/Feature/ChatStateServiceTest.php`
Expected: FAIL — `Class "App\Services\OnlyFans\ChatStateService" not found`.

- [ ] **Step 3: Write the service**

Create `app/Services/OnlyFans/ChatStateService.php`:

```php
<?php

namespace App\Services\OnlyFans;

use App\Models\AichChatState;
use App\Models\AichModel;

/**
 * Owns the live-path carry-forward strategy state (aich_chat_state keyed by
 * (creator_model, of_fan_id = chat id)). Loaded into the engine on generate and
 * committed when a generated draft is accepted/sent. Metadata only — no message text.
 *
 * See docs/superpowers/specs/2026-07-25-conversation-strategy-continuity-design.md.
 */
class ChatStateService
{
    /** Read the stored state without creating a row (controller has already scoped access). */
    public function find(AichModel $model, string $chatId): ?AichChatState
    {
        return AichChatState::withoutGlobalScopes()
            ->where('creator_model', $model->name)
            ->where('chat_id', $chatId)
            ->first();
    }

    /**
     * The engine `opts['state']` shape. Null-safe: absent state → legacy cold-start
     * defaults, so a brand-new chat behaves exactly as before.
     *
     * @return array<string, mixed>
     */
    public function toEngineState(?AichChatState $state): array
    {
        return [
            'last_strategy' => $state?->last_strategy,
            'last_analysis' => $state?->last_analysis,
            'next_planned_move' => $state?->next_planned_move,
            'next_planned_move_at_msg' => $state?->next_planned_move_at_msg,
            'promise_status' => $state?->promise_status ?? 'not_started',
            'story_framework_step' => (int) ($state?->story_framework_step ?? 0),
        ];
    }

    /**
     * Persist the carried state from a generation the chatter adopted (Accept / Send).
     *
     * @param  array<string, mixed>  $strategy   the generate response's strategy object
     * @param  array<string, mixed>  $telemetry  the generate response's telemetry object
     */
    public function commit(AichModel $model, string $chatId, array $strategy, array $telemetry, ?int $userId): AichChatState
    {
        return AichChatState::withoutGlobalScopes()->updateOrCreate(
            ['creator_model' => $model->name, 'chat_id' => $chatId],
            [
                'last_strategy' => $strategy,
                'last_analysis' => $telemetry['lastAnalysis'] ?? null,
                'next_planned_move' => $telemetry['nextPlannedMove'] ?? null,
                'next_planned_move_at_msg' => $telemetry['nextPlannedMoveAtMsg'] ?? null,
                'promise_status' => $telemetry['promiseStatus'] ?? 'not_started',
                'story_framework_step' => (int) ($telemetry['storyFrameworkStep'] ?? 0),
                'committed_by' => $userId,
            ],
        );
    }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `php artisan test tests/Feature/ChatStateServiceTest.php`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add app/Services/OnlyFans/ChatStateService.php tests/Feature/ChatStateServiceTest.php
git commit -m "feat(chat-state): ChatStateService to load + commit carry-forward state"
```

---

### Task 5: Controller wiring — load state on generate + commit endpoint + route

**Files:**
- Modify: `app/Http/Controllers/OnlyFansChatController.php` (constructor; `generate`; add `commitState`)
- Modify: `routes/web.php` (add the `state` route next to `profile`, ~line 65)
- Test: `tests/Feature/ChatStateEndpointTest.php`

**Interfaces:**
- Consumes: `ChatStateService::find` / `toEngineState` / `commit` (Task 4).
- Produces: `POST onlyfans/{model}/chats/{chat}/state` (name `onlyfans.state`) accepting `{ strategy: array, telemetry?: array }`, returning `{ ok: true }`. `generate` now passes `'state' => ...` into `generateFromLive` opts.

- [ ] **Step 1: Write the failing test**

Create `tests/Feature/ChatStateEndpointTest.php`:

```php
<?php

use App\Models\AichChatState;
use App\Models\AichModel;
use App\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;

uses(RefreshDatabase::class);

beforeEach(function () {
    config([
        'services.onlyfans.key' => 'test-key',
        'services.onlyfans.base_url' => 'https://app.onlyfansapi.com/api',
        'services.engine.url' => 'http://127.0.0.1:8787',
    ]);
    $this->model = AichModel::create(['name' => 'Camila', 'prompt' => 'You are Camila.', 'of_account_id' => 'acct_cam']);
});

it('commits strategy memory via POST state', function () {
    $admin = User::factory()->admin()->create();

    $this->actingAs($admin)
        ->postJson("/onlyfans/{$this->model->id}/chats/101/state", [
            'strategy' => ['phase' => 'sell', 'archetype' => 'Whale'],
            'telemetry' => [
                'lastAnalysis' => ['archetype' => 'Whale'],
                'nextPlannedMove' => 'run_promise_ritual',
                'nextPlannedMoveAtMsg' => 5,
                'promiseStatus' => 'in_progress',
                'storyFrameworkStep' => 2,
            ],
        ])
        ->assertOk()
        ->assertJsonPath('ok', true);

    $row = AichChatState::where('creator_model', 'Camila')->where('chat_id', '101')->first();
    expect($row->last_strategy['phase'])->toBe('sell');
    expect($row->promise_status)->toBe('in_progress');
    expect($row->story_framework_step)->toBe(2);
    expect($row->committed_by)->toBe($admin->id);
});

it('rejects a commit with no strategy (JSON 422)', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/chats/101/state", ['telemetry' => []])
        ->assertStatus(422);
});

it('forbids committing state for an unassigned creator', function () {
    $chatter = User::factory()->create(['role' => 'chatter']); // no assignment

    $this->actingAs($chatter)
        ->postJson("/onlyfans/{$this->model->id}/chats/101/state", ['strategy' => ['phase' => 'sell']])
        ->assertForbidden();
});

it('replays saved chat state on generate', function () {
    AichChatState::create([
        'creator_model' => 'Camila', 'chat_id' => '101',
        'last_strategy' => ['phase' => 'sell'], 'promise_status' => 'in_progress', 'story_framework_step' => 2,
    ]);

    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101, 'isSubscribed' => true]]),
        '127.0.0.1:8787/*' => Http::response(['draft' => 'hi', 'strategy' => ['phase' => 'sell'], 'telemetry' => null, 'usage' => []]),
    ]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/chats/101/generate", [
            'messages' => [['from' => 'fan', 'text' => 'hi']],
            'customer' => ['id' => '101'],
        ])
        ->assertOk();

    Http::assertSent(fn ($r) => str_contains($r->url(), '8787')
        && data_get($r->data(), 'session._promiseStatus') === 'in_progress'
        && data_get($r->data(), 'session._lastStrategy.phase') === 'sell');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `php artisan test tests/Feature/ChatStateEndpointTest.php`
Expected: FAIL — the `state` route 404s / method missing.

- [ ] **Step 3: Inject the service into the controller**

In `app/Http/Controllers/OnlyFansChatController.php`, add the import near the other `use` statements:

```php
use App\Services\OnlyFans\ChatStateService;
```

Then add the dependency to the constructor:

```php
    public function __construct(
        protected OnlyFansService $of,
        protected EngineClient $engine,
        protected AiUsageRecorder $usage,
        protected FanProfileService $profiles,
        protected ChatStateService $states,
    ) {}
```

- [ ] **Step 4: Load state on generate**

In the `generate` method, immediately after the `$profile = $this->profiles->loadForGenerate(...)` line, add:

```php
        $state = $this->states->find($model, $chat);
```

Then in the `$this->engine->generateFromLive($model, $messages, $customer, [ ... ])` opts array, add one entry (place it after the `'profile' => ...` line):

```php
                'state' => $this->states->toEngineState($state),
```

- [ ] **Step 5: Add the commit endpoint**

In `app/Http/Controllers/OnlyFansChatController.php`, add this method directly after `updateProfile`:

```php
    /**
     * Commit the carried strategy state from a generation the chatter adopted
     * (Accept / Accept & Send). This becomes the "previous" the next generate builds on.
     * Metadata only — the strategy + telemetry objects the generate response returned.
     */
    public function commitState(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $this->authorizeCreator($request, $model);
        $data = $this->validateJson($request, [
            'strategy' => 'required|array',
            'telemetry' => 'nullable|array',
        ]);

        $this->states->commit($model, $chat, $data['strategy'], $data['telemetry'] ?? [], $request->user()?->id);

        return response()->json(['ok' => true]);
    }
```

- [ ] **Step 6: Register the route**

In `routes/web.php`, directly after the `chats/{chat}/profile` PATCH route (~line 65), add:

```php
        Route::post('chats/{chat}/state', [OnlyFansChatController::class, 'commitState'])->name('state');
```

- [ ] **Step 7: Run test to verify it passes**

Run: `php artisan test tests/Feature/ChatStateEndpointTest.php`
Expected: PASS (4 passed).

- [ ] **Step 8: Run the broader suite to confirm no regression**

Run: `php artisan test tests/Feature/OnlyFansChatTest.php tests/Feature/ChatStateTest.php tests/Feature/ChatStateServiceTest.php tests/Feature/EngineReplayTest.php tests/Feature/ChatStateEndpointTest.php`
Expected: all pass. (Note: 5 pre-existing `OnlyFansChatTest` message-text tests fail locally when `HtmlSanitizer` is missing from `vendor/` — run `composer install` first; that is not a regression from this work.)

- [ ] **Step 9: Commit**

```bash
git add app/Http/Controllers/OnlyFansChatController.php routes/web.php tests/Feature/ChatStateEndpointTest.php
git commit -m "feat(conversations): load chat state on generate + commit-state endpoint"
```

---

### Task 6: Frontend — capture telemetry + commit on Accept / Accept & Send

**Files:**
- Modify: `resources/js/lib/conversationCache.ts` (`ComposerState` interface + `chatComposer` initializer)
- Modify: `resources/js/lib/onlyfans.ts` (add `commitState` to `ofApi`)
- Modify: `resources/js/pages/Conversations.vue` (`generate` stores telemetry; `acceptSuggestion` + `acceptAndSend` commit)
- Verify: `npm run types:check`, `npx eslint <files>`, `npm run build`

**Interfaces:**
- Consumes: `POST onlyfans/{model}/chats/{chat}/state` (Task 5).
- Produces: `ofApi.commitState(m, chat, { strategy, telemetry })`; `ComposerState.telemetry`.

- [ ] **Step 1: Add `telemetry` to composer state**

In `resources/js/lib/conversationCache.ts`, add to the `ComposerState` interface (after `strategyGeneratedAt`):

```ts
    telemetry: Record<string, unknown> | null; // last generate's telemetry (carry-forward state committed on accept/send)
```

And in `chatComposer`'s initializer object (after `strategyGeneratedAt: null,`):

```ts
            telemetry: null,
```

- [ ] **Step 2: Add `commitState` to the API client**

In `resources/js/lib/onlyfans.ts`, add to the `ofApi` object (directly after the `intel:` method):

```ts
    /** Commit carried strategy state from an adopted generation (Accept / Accept & Send). */
    commitState: (
        m: number,
        chat: string,
        payload: {
            strategy: AiStrategy | null;
            telemetry: Record<string, unknown> | null;
        },
    ) => req<{ ok: boolean }>('POST', `${base(m)}/chats/${chat}/state`, payload),
```

- [ ] **Step 3: Store telemetry on generate**

In `resources/js/pages/Conversations.vue`, in the `generate()` function, directly after the line `st.strategyGeneratedAt = data.generatedAt ?? new Date().toISOString();`, add:

```ts
        st.telemetry = data.telemetry ?? null;
```

- [ ] **Step 4: Add a commit helper and call it on accept/send**

In `resources/js/pages/Conversations.vue`, add this helper directly above `function acceptSuggestion()`:

```ts
/** Persist the adopted generation's strategy so the next Generate builds on it.
 *  Fire-and-forget — a failed commit must never block the chatter. */
function commitStrategyMemory(chatId: string) {
    const m = model.value;
    const st = chatComposer(chatId);

    if (!m || !st.strategy) {
        return;
    }

    ofApi
        .commitState(m.id, chatId, { strategy: st.strategy, telemetry: st.telemetry })
        .catch(() => {});
}
```

Then in `acceptSuggestion`, replace its body's tail so it commits before clearing the suggestion:

```ts
function acceptSuggestion() {
    const st = cur.value;
    const chatId = selected.value?.id;

    if (!st || !st.suggestion || !chatId) {
        return;
    }

    commitStrategyMemory(chatId);
    st.draft = st.suggestion;
    st.suggestion = null;
}
```

And in `acceptAndSend`, add the commit before sending:

```ts
async function acceptAndSend() {
    const st = cur.value;
    const chatId = selected.value?.id;

    if (!st || !st.suggestion || !chatId) {
        return;
    }

    commitStrategyMemory(chatId);
    const text = st.suggestion;
    st.suggestion = null;
    await send(text);
}
```

- [ ] **Step 5: Type-check**

Run: `npm run types:check`
Expected: no errors (exits 0).

- [ ] **Step 6: Lint**

Run: `npx eslint resources/js/lib/conversationCache.ts resources/js/lib/onlyfans.ts resources/js/pages/Conversations.vue`
Expected: no output (clean).

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: `✓ built` (the pre-existing `#__PURE__` warnings from `node_modules/reka-ui` are unrelated).

- [ ] **Step 8: Commit**

```bash
git add resources/js/lib/conversationCache.ts resources/js/lib/onlyfans.ts resources/js/pages/Conversations.vue
git commit -m "feat(conversations): commit strategy memory on Accept / Accept & Send"
```

---

## Verification (whole feature)

- [ ] `php artisan test` — full Pest suite green (modulo the documented pre-existing HtmlSanitizer failures if `vendor/` is stale).
- [ ] `node engine/state_check.js && node engine/smoke.js && node legacy/tests/harness.js` — engine guards green.
- [ ] `npm run types:check && npm run build` — frontend green.
- [ ] Manual (with engine + a live OnlyFans key): open a chat, Generate → Accept & Send → Generate again; confirm the second generation's AI Intel reflects the prior turn (phase advances rather than resetting; promise/story continuity holds).

## Notes / parity

- After this plan: the "previous analysis — act on this" steering, anti-drift plan, and promise/story continuation match legacy. Archetype persistence already works via `customer_profiles`.
- Money-aware behavior (pacing counters, wall/ladder, paid-session gates) still differs until **Package B** maps per-message PPV/tip/opened/price into the engine.
