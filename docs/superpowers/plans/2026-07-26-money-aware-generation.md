# Money-Aware Generation (Package B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Feed real per-message PPV/tip/opened data into the live generate path so the engine's money-aware logic (wall enforcement, PPV stats, posture, active-buyer guards, tier, tip/sexting gates) runs on truth instead of zeros.

**Architecture:** The frontend forwards payment fields it already holds; a new pure `LiveThreadMapper` turns the client thread into engine-shaped messages (`sender:'ppv'` bubbles with `opened`+`price`) plus gap-windowed session `total_spend`/`tips_spend`; the controller passes those to `EngineClient::generateFromLive`, which already accepts them. No engine, `EngineClient`, or DB change.

**Tech Stack:** Laravel 13 / PHP 8.3 · Pest · Node engine sidecar (VM-hosted legacy JS) · Vue 3 + TypeScript.

**Spec:** docs/superpowers/specs/2026-07-26-money-aware-generation-design.md

## Global Constraints

- Do NOT change `legacy/js/*`, the engine sidecar's generation logic, or `EngineClient` (it already reads `opts['total_spend']`/`opts['tips_spend']` and passes `messages` through). No new DB table / persistence.
- Session window is **gap-based**: "this session" = messages from newest back to the first gap > `gapHours` (default **12**, configurable via `config('services.engine.session_gap_hours')`). Session spend + `ppv`-bubble marking apply ONLY inside that window. Lifetime spend still rides on `_profile` (unchanged).
- Session `total_spend` counts **opened** PPV prices only; an unopened PPV is still a `ppv` bubble (for wall/miss logic) but adds no spend.
- Engine PPV bubble shape (read by legacy `computeWallState`): `{sender:'ppv', text, opened:bool, price:number, ts_iso}`. Tips are NOT `ppv` bubbles — they stay `customer` bubbles and add to `tips_spend`.
- Mapper is a **pure** function — no OnlyFans/engine/DB calls.
- PHP: `php artisan test`. Frontend gates: `npm run types:check`, `npx eslint <files>`, `npm run build` (pre-existing reka-ui `#__PURE__` build warnings are unrelated). Engine: `node engine/<check>.js`, `node legacy/tests/harness.js` (expect `PASS 283 / FAIL 0`).
- Known-red pre-existing tests (real LLM/engine calls, nondeterministic): do not chase them; introduce no NEW failures.

---

### Task 1: `LiveThreadMapper` (pure mapping service)

**Files:**
- Create: `app/Services/OnlyFans/LiveThreadMapper.php`
- Test: `tests/Feature/LiveThreadMapperTest.php`

**Interfaces:**
- Produces: `App\Services\OnlyFans\LiveThreadMapper::map(array $messages, int $gapHours = 12): array` returning `['messages' => list<array>, 'total_spend' => float, 'tips_spend' => float]`. Each mapped message is `{sender:'customer'|'model'|'ppv', text, ts_iso}`; `ppv` bubbles also carry `opened:bool, price:float`.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/LiveThreadMapperTest.php`:

```php
<?php

use App\Services\OnlyFans\LiveThreadMapper;

function mapThread(array $messages, int $gapHours = 12): array
{
    return app(LiveThreadMapper::class)->map($messages, $gapHours);
}

it('maps an opened creator PPV in the window to a ppv bubble and session spend', function () {
    $now = now();
    $out = mapThread([
        ['from' => 'fan', 'text' => 'hey', 'time' => $now->copy()->subMinutes(10)->toIso8601String()],
        ['from' => 'creator', 'text' => 'unlock me', 'time' => $now->copy()->subMinutes(5)->toIso8601String(),
            'price' => 20, 'isFree' => false, 'isOpened' => true, 'isTip' => false],
    ]);

    $ppv = collect($out['messages'])->firstWhere('sender', 'ppv');
    expect($ppv)->not->toBeNull();
    expect($ppv['opened'])->toBeTrue();
    expect($ppv['price'])->toBe(20.0);
    expect($out['total_spend'])->toBe(20.0);
    expect($out['tips_spend'])->toBe(0.0);
});

it('marks an unopened PPV as a ppv bubble but excludes it from session spend', function () {
    $now = now();
    $out = mapThread([
        ['from' => 'creator', 'text' => 'locked', 'time' => $now->copy()->subMinutes(1)->toIso8601String(),
            'price' => 30, 'isFree' => false, 'isOpened' => false, 'isTip' => false],
    ]);

    $ppv = collect($out['messages'])->firstWhere('sender', 'ppv');
    expect($ppv)->not->toBeNull();
    expect($ppv['opened'])->toBeFalse();
    expect($out['total_spend'])->toBe(0.0);
});

it('sums a tip into tips_spend and keeps it a customer bubble (not ppv)', function () {
    $now = now();
    $out = mapThread([
        ['from' => 'fan', 'text' => 'here you go', 'time' => $now->copy()->subMinutes(2)->toIso8601String(),
            'price' => 15, 'isTip' => true, 'isFree' => false, 'isOpened' => true],
    ]);

    expect($out['tips_spend'])->toBe(15.0);
    expect($out['total_spend'])->toBe(0.0);
    expect($out['messages'][0]['sender'])->toBe('customer');
});

it('prefers a dedicated tipAmount over price for a tip', function () {
    $now = now();
    $out = mapThread([
        ['from' => 'fan', 'text' => 'tip', 'time' => $now->copy()->subMinutes(2)->toIso8601String(),
            'price' => 0, 'tipAmount' => 12, 'isTip' => true, 'isFree' => false],
    ]);

    expect($out['tips_spend'])->toBe(12.0);
});

it('excludes a payment before the last long gap from the session (not a ppv bubble, no spend)', function () {
    $now = now();
    $out = mapThread([
        ['from' => 'creator', 'text' => 'old ppv', 'time' => $now->copy()->subDays(2)->toIso8601String(),
            'price' => 50, 'isFree' => false, 'isOpened' => true, 'isTip' => false],
        // >12h gap, then the current session
        ['from' => 'fan', 'text' => 'im back', 'time' => $now->copy()->subMinutes(3)->toIso8601String()],
    ], 12);

    expect($out['total_spend'])->toBe(0.0);
    expect(collect($out['messages'])->pluck('sender')->all())->not->toContain('ppv');
});

it('maps fan/creator direction to customer/model', function () {
    $now = now();
    $out = mapThread([
        ['from' => 'fan', 'text' => 'hi', 'time' => $now->copy()->subMinutes(2)->toIso8601String()],
        ['from' => 'creator', 'text' => 'hey babe', 'time' => $now->copy()->subMinutes(1)->toIso8601String()],
    ]);

    expect($out['messages'][0]['sender'])->toBe('customer');
    expect($out['messages'][1]['sender'])->toBe('model');
});

it('returns empty messages and zero spend for an empty thread', function () {
    $out = mapThread([]);
    expect($out['messages'])->toBe([]);
    expect($out['total_spend'])->toBe(0.0);
    expect($out['tips_spend'])->toBe(0.0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `php artisan test tests/Feature/LiveThreadMapperTest.php`
Expected: FAIL — `Class "App\Services\OnlyFans\LiveThreadMapper" not found`.

- [ ] **Step 3: Write the service**

Create `app/Services/OnlyFans/LiveThreadMapper.php`:

```php
<?php

namespace App\Services\OnlyFans;

/**
 * Turns the live OnlyFans thread the client forwards (from/text/time + payment
 * fields) into the legacy engine's money-aware inputs: `sender:'ppv'` bubbles for
 * creator-sent paid PPVs and gap-windowed SESSION total_spend/tips_spend. Pure —
 * no OnlyFans/engine/DB calls. See docs/superpowers/specs/2026-07-26-money-aware-generation-design.md.
 */
class LiveThreadMapper
{
    /**
     * @param  list<array<string, mixed>>  $messages  client thread items
     * @return array{messages: list<array<string, mixed>>, total_spend: float, tips_spend: float}
     */
    public function map(array $messages, int $gapHours = 12): array
    {
        $items = array_map(function (array $m): array {
            $ts = isset($m['time']) && $m['time'] !== null ? strtotime((string) $m['time']) : false;

            return [
                'from' => ($m['from'] ?? 'fan') === 'creator' ? 'creator' : 'fan',
                'text' => (string) ($m['text'] ?? ''),
                'ts' => $ts === false ? null : $ts,
                'price' => (float) ($m['price'] ?? 0),
                'isFree' => (bool) ($m['isFree'] ?? true),
                'isOpened' => (bool) ($m['isOpened'] ?? false),
                'isTip' => (bool) ($m['isTip'] ?? false),
                'tipAmount' => isset($m['tipAmount']) ? (float) $m['tipAmount'] : null,
            ];
        }, array_values($messages));

        // Oldest → newest so the session-window scan and the engine transcript are chronological.
        usort($items, fn ($a, $b) => ($a['ts'] ?? 0) <=> ($b['ts'] ?? 0));

        $sessionStart = $this->sessionStartIndex($items, $gapHours);

        $out = [];
        $totalSpend = 0.0;
        $tipsSpend = 0.0;

        foreach ($items as $i => $m) {
            $inWindow = $i >= $sessionStart;
            $bubble = [
                'sender' => $m['from'] === 'fan' ? 'customer' : 'model',
                'text' => $m['text'],
                'ts_iso' => $m['ts'] !== null ? date('c', $m['ts']) : now()->toIso8601String(),
            ];

            if ($inWindow && $m['from'] === 'creator' && ! $m['isFree'] && $m['price'] > 0 && ! $m['isTip']) {
                $bubble['sender'] = 'ppv';
                $bubble['opened'] = $m['isOpened'];
                $bubble['price'] = $m['price'];
                if ($m['isOpened']) {
                    $totalSpend += $m['price'];
                }
            } elseif ($inWindow && $m['isTip']) {
                $tipsSpend += $m['tipAmount'] ?? $m['price'];
            }

            $out[] = $bubble;
        }

        return ['messages' => $out, 'total_spend' => $totalSpend, 'tips_spend' => $tipsSpend];
    }

    /**
     * Index of the first message of the current session: scan newest→oldest and stop at the
     * first message whose gap to the previous message exceeds the threshold. No gap (or no
     * timestamps) → the whole thread is one session (index 0).
     *
     * @param  list<array{ts: int|null}>  $items  sorted oldest→newest
     */
    private function sessionStartIndex(array $items, int $gapHours): int
    {
        $gapSeconds = $gapHours * 3600;

        for ($i = count($items) - 1; $i > 0; $i--) {
            $cur = $items[$i]['ts'];
            $prev = $items[$i - 1]['ts'];
            if ($cur !== null && $prev !== null && ($cur - $prev) > $gapSeconds) {
                return $i;
            }
        }

        return 0;
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `php artisan test tests/Feature/LiveThreadMapperTest.php`
Expected: PASS (7 passed).

- [ ] **Step 5: Commit**

```bash
git add app/Services/OnlyFans/LiveThreadMapper.php tests/Feature/LiveThreadMapperTest.php
git commit -m "feat(money): LiveThreadMapper — thread to engine ppv bubbles + session spend"
```

---

### Task 2: Controller wiring + config + generate tests

**Files:**
- Modify: `config/services.php` (`engine` array, ~lines 61-64)
- Modify: `app/Http/Controllers/OnlyFansChatController.php` (constructor; `generate` validation + message map + opts)
- Test: `tests/Feature/MoneyAwareGenerateTest.php`

**Interfaces:**
- Consumes: `LiveThreadMapper::map` (Task 1).
- Produces: `generate` now feeds engine `session.total_spend`/`session.tips_spend` (from the mapper) and `ppv` bubbles; reads gap hours from `config('services.engine.session_gap_hours')`.

- [ ] **Step 1: Write the failing tests**

Create `tests/Feature/MoneyAwareGenerateTest.php`:

```php
<?php

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

it('feeds session PPV spend, tips, and a ppv bubble into the engine', function () {
    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101, 'isSubscribed' => true]]),
        '127.0.0.1:8787/*' => Http::response(['draft' => 'hi', 'strategy' => ['phase' => 'sell'], 'telemetry' => null, 'usage' => []]),
    ]);
    $now = now();

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/chats/101/generate", [
            'messages' => [
                ['from' => 'fan', 'text' => 'hey', 'time' => $now->copy()->subMinutes(6)->toIso8601String()],
                ['from' => 'creator', 'text' => 'unlock', 'time' => $now->copy()->subMinutes(4)->toIso8601String(),
                    'price' => 25, 'isFree' => false, 'isOpened' => true, 'isTip' => false],
                ['from' => 'fan', 'text' => 'tip', 'time' => $now->copy()->subMinutes(2)->toIso8601String(),
                    'price' => 10, 'isTip' => true, 'isFree' => false, 'isOpened' => true],
            ],
            'customer' => ['id' => '101'],
        ])
        ->assertOk();

    Http::assertSent(function ($r) {
        if (! str_contains($r->url(), '8787')) {
            return false;
        }
        $total = (string) data_get($r->data(), 'session.total_spend');
        $tips = (string) data_get($r->data(), 'session.tips_spend');
        $hasPpv = collect(data_get($r->data(), 'session.messages', []))
            ->contains(fn ($m) => ($m['sender'] ?? null) === 'ppv');

        return str_contains($total, '25') && str_contains($tips, '10') && $hasPpv;
    });
});

it('does not count a pre-gap payment as session spend', function () {
    Http::fake([
        'app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 101, 'isSubscribed' => true]]),
        '127.0.0.1:8787/*' => Http::response(['draft' => 'hi', 'strategy' => ['phase' => 'rapport'], 'telemetry' => null, 'usage' => []]),
    ]);
    $now = now();

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/chats/101/generate", [
            'messages' => [
                ['from' => 'creator', 'text' => 'old ppv', 'time' => $now->copy()->subDays(2)->toIso8601String(),
                    'price' => 50, 'isFree' => false, 'isOpened' => true, 'isTip' => false],
                ['from' => 'fan', 'text' => 'im back', 'time' => $now->copy()->subMinutes(3)->toIso8601String()],
            ],
            'customer' => ['id' => '101'],
        ])
        ->assertOk();

    Http::assertSent(function ($r) {
        if (! str_contains($r->url(), '8787')) {
            return false;
        }
        // "$0" session spend, and the pre-gap payment is not a ppv bubble.
        $total = (string) data_get($r->data(), 'session.total_spend');
        $hasPpv = collect(data_get($r->data(), 'session.messages', []))
            ->contains(fn ($m) => ($m['sender'] ?? null) === 'ppv');

        return $total === '$0' && $hasPpv === false;
    });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `php artisan test tests/Feature/MoneyAwareGenerateTest.php`
Expected: FAIL — the engine payload has `session.total_spend` `$0` and no `ppv` bubble (mapper not wired yet).

- [ ] **Step 3: Add the config key**

In `config/services.php`, change the `engine` array (currently lines ~61-64) to add `session_gap_hours`:

```php
    'engine' => [
        'url' => env('ENGINE_URL', 'http://127.0.0.1:8787'),
        'timeout' => (int) env('ENGINE_TIMEOUT', 60),
        'session_gap_hours' => (int) env('ENGINE_SESSION_GAP_HOURS', 12),
    ],
```

- [ ] **Step 4: Inject the mapper into the controller**

In `app/Http/Controllers/OnlyFansChatController.php`, add the import near the other `use` statements:

```php
use App\Services\OnlyFans\LiveThreadMapper;
```

Then add the dependency to the constructor (after `ChatStateService $states`):

```php
    public function __construct(
        protected OnlyFansService $of,
        protected EngineClient $engine,
        protected AiUsageRecorder $usage,
        protected FanProfileService $profiles,
        protected ChatStateService $states,
        protected LiveThreadMapper $mapper,
    ) {}
```

- [ ] **Step 5: Add validation + replace the inline message map**

In the `generate` method's `$request->validate([...])`, add these four rules (after the `'messages.*.text' => 'nullable|string',` line):

```php
            'messages.*.price' => 'nullable|numeric',
            'messages.*.isFree' => 'nullable|boolean',
            'messages.*.isOpened' => 'nullable|boolean',
            'messages.*.isTip' => 'nullable|boolean',
```

Then replace the existing inline map:

```php
        $messages = collect($data['messages'] ?? [])->map(fn ($m) => [
            'sender' => ($m['from'] ?? 'fan') === 'fan' ? 'customer' : 'model',
            'text' => $m['text'] ?? '',
            'ts_iso' => $m['time'] ?? now()->toIso8601String(),
        ])->values()->all();
```

with the mapper call:

```php
        $mapped = $this->mapper->map($data['messages'] ?? [], (int) config('services.engine.session_gap_hours', 12));
        $messages = $mapped['messages'];
```

- [ ] **Step 6: Feed session spend into the engine opts**

In the `$this->engine->generateFromLive($model, $messages, $customer, [ ... ])` opts array, replace the stale `// OnlyFans spend is LIFETIME …` comment block and add the two session-spend keys. The opts array's `'profile' => ...` line stays; add directly above it:

```php
                // SESSION spend (this conversation), derived by LiveThreadMapper from the thread's
                // opened PPVs + tips within the gap-based window. Lifetime spend still rides on
                // _profile (below). Together these drive wall state + active-buyer/tier/tip logic.
                'total_spend' => $mapped['total_spend'],
                'tips_spend' => $mapped['tips_spend'],
```

(Delete the now-inaccurate multi-line comment that says session spend "stays $0"; leave the `'profile' => $this->profiles->toEngineProfile($profile),` line and everything else unchanged.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `php artisan test tests/Feature/MoneyAwareGenerateTest.php`
Expected: PASS (2 passed).

- [ ] **Step 8: Run the related suites to confirm no regression**

Run: `php artisan test tests/Feature/OnlyFansChatTest.php tests/Feature/LiveThreadMapperTest.php tests/Feature/MoneyAwareGenerateTest.php tests/Feature/ChatStateEndpointTest.php`
Expected: all pass (any pre-existing known-red engine/LLM failures in `OnlyFansChatTest` are not caused by this change — confirm they fail identically on the base commit if unsure).

- [ ] **Step 9: Commit**

```bash
git add config/services.php app/Http/Controllers/OnlyFansChatController.php tests/Feature/MoneyAwareGenerateTest.php
git commit -m "feat(money): wire LiveThreadMapper into generate — session spend + ppv bubbles"
```

---

### Task 3: Frontend forwards the payment fields

**Files:**
- Modify: `resources/js/pages/Conversations.vue` (`generate()` message map, ~lines 135-143)
- Verify: `npm run types:check`, `npx eslint <file>`, `npm run build`

**Interfaces:**
- Consumes: the controller validation from Task 2 (accepts `messages.*.price|isFree|isOpened|isTip`). `OfMessage` already carries `price`, `isFree`, `isOpened`, `isTip`.

- [ ] **Step 1: Forward the payment fields in the generate payload**

In `resources/js/pages/Conversations.vue`, in `generate()`, replace the `messages:` mapping inside the `ofApi.generate(...)` call:

```ts
            messages: thread.map((mm) => ({
                from: mm.from,
                text: mm.text,
                time: mm.time,
            })),
```

with:

```ts
            messages: thread.map((mm) => ({
                from: mm.from,
                text: mm.text,
                time: mm.time,
                price: mm.price,
                isFree: mm.isFree,
                isOpened: mm.isOpened,
                isTip: mm.isTip,
            })),
```

- [ ] **Step 2: Type-check**

Run: `npm run types:check`
Expected: no errors (exits 0). (`OfMessage` already declares these fields, so no type changes are needed.)

- [ ] **Step 3: Lint**

Run: `npx eslint resources/js/pages/Conversations.vue`
Expected: no output (clean).

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: `✓ built` (the pre-existing `#__PURE__` warnings from `node_modules/reka-ui` are unrelated).

- [ ] **Step 5: Commit**

```bash
git add resources/js/pages/Conversations.vue
git commit -m "feat(money): forward per-message PPV/tip fields to generate"
```

---

### Task 4: Engine parity smoke (money inputs are consumed)

**Files:**
- Create: `engine/money_check.js`

**Interfaces:**
- Consumes: `engine/runGenerate.js` `generateDraft(...)` (unchanged). Asserts the engine reacts to the money inputs `LiveThreadMapper` produces, using the already-exposed `telemetry.tipPrimary` (legacy `detectTipPrimary` returns true when `s.tips_spend > 0` in AUTO mode) and that a `ppv`-bubble thread runs end-to-end.

- [ ] **Step 1: Write the failing check**

Create `engine/money_check.js`:

```js
'use strict';
/* Proves the engine consumes the money-aware inputs LiveThreadMapper produces:
 * a ppv bubble + session tips flow through generate() and drive telemetry (tipPrimary). */
const assert = require('assert');
const { generateDraft } = require('./runGenerate');

const fakeStrategy = {
    tone: 'warm', phase: 'sell', promise_status: 'not_started',
    strategy: 'close', next_move: 'pitch', next_move_after_wall: 'continue_climb',
    message_length: 'short', caption_required: false, agent_override_active: false,
    trust_level: 3, archetype: 'Explorer', temperature: 'warm', message_purpose: 'close',
    skeleton_step: 'Sell',
};
const callApi = async (_s, _u, _m, _f, t) => (t && String(t).startsWith('strategy')) ? JSON.stringify(fakeStrategy) : 'open it for me babe 😏';
const callMistral = async () => 'ábrelo para mí 😏';

function baseInput(overrides) {
    return Object.assign({
        model: { name: 'Camila', prompt: 'You are Camila.', content_library: '', feedback_rules: '' },
        session: {
            id: 'money-1', creator_model: 'Camila', customer_name: 'Jake', customer_username: 'jake_w',
            subscription_status: 'subscribed', total_spend: '$0', tips_spend: '$0', crm_notes: '', vn_used: [],
            inputMode: 'chat', _tipModeToggle: 'AUTO',
            messages: [{ sender: 'customer', text: 'hey', ts_iso: new Date().toISOString() }],
        },
        creatorStatus: [], api: 'claude', sender: 'customer', context: '',
    }, overrides);
}

(async () => {
    // A: session with an opened ppv bubble + a tip → tipPrimary true, draft generated.
    const withMoney = baseInput({});
    withMoney.session = Object.assign({}, withMoney.session, {
        tips_spend: '$10', total_spend: '$20',
        messages: [
            { sender: 'ppv', text: 'unlock', opened: true, price: 20, ts_iso: new Date(Date.now() - 300000).toISOString() },
            { sender: 'customer', text: 'nice', ts_iso: new Date().toISOString() },
        ],
    });
    const a = await generateDraft(withMoney, { callApi, callMistral });
    assert.ok(a.draft && a.draft.length > 0, 'A: engine produced a draft from a ppv-bubble thread');
    assert.strictEqual(a.telemetry.tipPrimary, true, 'A: session tips drive tipPrimary=true');

    // B: no tips, no provider language → tipPrimary false (guards against always-true).
    const noMoney = baseInput({});
    const b = await generateDraft(noMoney, { callApi, callMistral });
    assert.strictEqual(b.telemetry.tipPrimary, false, 'B: no session spend → tipPrimary=false');

    console.log('✓ money_check: engine consumes session ppv/tip inputs (tipPrimary reacts, ppv thread runs)');
})().catch((e) => { console.error('MONEY_CHECK FAILED:', e.message); process.exit(1); });
```

- [ ] **Step 2: Run it to verify the harness wiring (should PASS immediately — no engine change needed)**

Run: `node engine/money_check.js`
Expected: `✓ money_check: engine consumes session ppv/tip inputs (tipPrimary reacts, ppv thread runs)`.

(If instead it errors, STOP and report — do NOT edit `legacy/js/*`. This check asserts existing legacy behavior; a failure means the assumption about `detectTipPrimary`/`tipPrimary` needs revisiting, which the controller reviewer should know before merge.)

- [ ] **Step 3: Confirm the legacy guard suite still passes**

Run: `node legacy/tests/harness.js`
Expected: `PASS 283 / FAIL 0` (unchanged — this task adds no engine code).

- [ ] **Step 4: Commit**

```bash
git add engine/money_check.js
git commit -m "test(engine): money_check — engine reacts to session ppv/tip inputs"
```

---

## Verification (whole feature)

- [ ] `php artisan test` — full Pest suite green (modulo documented pre-existing known-red engine/LLM tests).
- [ ] `node engine/money_check.js && node engine/smoke.js && node legacy/tests/harness.js` — engine green (283/0).
- [ ] `npm run types:check && npm run build` — frontend green.
- [ ] **Live verify (once the dev stack is up)** — confirm the two API facts from the spec against a real thread with PPV/tip history and adjust only the mapper's field reads if needed:
  1. tip amount lives in `price` vs `tipAmount` (mapper reads `tipAmount ?? price`);
  2. a creator-sent PPV's `isOpened:true` means purchased.
  `docker exec ssai-dev-app-1 php artisan tinker` → fetch a real chat's raw messages and inspect a paid + a tip message.
- [ ] Manual (engine + live key): open a chat where the fan recently opened a PPV / tipped, Generate, and confirm the AI Intel/strategy reflects an active buyer (not a $0 lurker) — e.g. tip-led framing or a non-timewaster posture.

## Notes / parity

After this plan: conversation memory (Package A) **and** money-aware selling (Package B) match legacy. Optional, non-parity follow-ups: realtime spend webhooks (`messages.ppv.unlocked`, `tips.received`), and per-message PPV/tip *sending* (still v1-blocked).
