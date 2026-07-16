# Composer Media Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a chatter attach and send one media item — a device file (photo/video/audio) or an OnlyFans vault item — and give the thread the inline audio player it has never had.

**Architecture:** The OnlyFans key is server-side, so uploads go browser → Laravel → OnlyFans. Every upload uses `async=true`: OnlyFans returns a single-use `ofapi_media_…` id as soon as it has the bytes, and the client polls a status endpoint until `completed`, so a transcode never occupies a PHP-FPM worker. Vault items need no upload — their ids are reusable and go straight into `mediaFiles[]`.

**Tech Stack:** Laravel 13 / PHP 8.3 · Pest · Vue 3 + TypeScript + Tailwind (`ss-*` tokens) · Docker (nginx + php-fpm).

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-16-composer-media-layer-design.md`. Read it first.
- **`uploadMedia()` MUST NOT use `client()`.** `client()` carries `->retry(3, …)`; retrying a multipart upload re-sends bytes OnlyFans may already have accepted → **duplicate BILLED media**. It gets its own no-retry request builder. This is the single most important constraint in the plan.
- **PPV stays blocked.** `ppvBlocked()` is untouched; media sends at price 0 only. Never add `price`, `previews[]`, or `lockedText`.
- **One attachment per message.** `mediaFiles[]` carries exactly one id. Attachment and GIF are mutually exclusive — setting one clears the other.
- **Paging drives off `data.hasMore`** — never `data.nextOffset` (advances past the end) and never `_pagination.next_page` (emitted even on the last page). Vault `limit` max is 100.
- **Vault items reuse `normalizeMedia`** — do NOT write a second normalizer.
- Nothing new is persisted. Conversations stores no message text.
- `ss-*` design tokens, not shadcn tokens. No new npm dependency.
- Tests run in Docker: `docker exec ssai-dev-app-1 php artisan test …`. Frontend checks on the host: `npm run types:check`, `npm run lint:check`.
- **9 tests are KNOWN-RED and PRE-EXISTING** (proven failing before this work): `AiUsageTest`(2), `FanProfileTest`(4), `OnlyFansChatTest`(3). They make real LLM calls. Never chase them.
- `composer run ci:check` fails on `types:check` from ~194 pre-existing phpstan errors in unrelated files. Expected; not yours.
- **Staging discipline:** stage only the paths a task names. Never `git add -A` or `git add .`.
- Every commit message ends with: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

---

### Task 1: Raise the upload ceiling to 100MB (infra + config)

Today nginx rejects anything over 25m with a 413 **before PHP runs**. This task raises the whole stack's ceiling and adds the upload timeout config the service will read.

**Files:**
- Modify: `docker/nginx/default.conf` (lines 19, ~67), `docker/php/php.ini` (lines 5, 8-9), `docker/dev/php-dev.ini` (lines 10-11), `config/services.php` (the `onlyfans` block)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `config('services.onlyfans.upload_timeout')` (int, default 300) — read by Task 2's `uploadMedia()`.

- [ ] **Step 1: Raise the nginx body limit and PHP timeout**

In `docker/nginx/default.conf`, change line 19:

```nginx
    client_max_body_size 110m;
```

and the `fastcgi_read_timeout` in the `location ~ \.php$` block:

```nginx
        fastcgi_read_timeout 300s;
```

- [ ] **Step 2: Raise the production PHP limits**

In `docker/php/php.ini`, change lines 5 and 8-9:

```ini
max_execution_time = 300
```

```ini
; Uploads / request body — headroom for media proxying and chat media uploads.
; post_max_size sits ABOVE upload_max_filesize: the multipart body carries the
; file PLUS fields. OnlyFans' own direct-upload cap is 100M (Cloudflare).
upload_max_filesize = 100M
post_max_size = 110M
```

- [ ] **Step 3: Raise the dev PHP limits to match**

In `docker/dev/php-dev.ini`, change lines 10-11:

```ini
upload_max_filesize = 100M
post_max_size = 110M
```

- [ ] **Step 4: Add the upload timeout config**

In `config/services.php`, in the `onlyfans` block, add `upload_timeout` after `timeout`:

```php
        'timeout' => (int) env('ONLYFANS_TIMEOUT', 30),
        // Uploads forward up to 100MB to OnlyFans; the 30s default is far too short.
        // Only `uploadMedia()` uses this — every other call keeps `timeout`.
        'upload_timeout' => (int) env('ONLYFANS_UPLOAD_TIMEOUT', 300),
```

- [ ] **Step 5: Rebuild dev and verify the limits are live**

`docker/nginx/default.conf` is bind-mounted (restart is enough), but `php-dev.ini` is `COPY`'d in the Dockerfile, so the app image must be rebuilt.

Run:
```bash
docker compose -f compose.yaml --env-file .env.docker.dev up -d --build app web
docker exec ssai-dev-app-1 php -i | grep -E "^(upload_max_filesize|post_max_size|max_execution_time)"
```
Expected:
```
upload_max_filesize => 100M => 100M
post_max_size => 110M => 110M
max_execution_time => 300 => 300
```

If `docker compose` cannot reach the registry in this environment, report it — do NOT skip the verification silently.

- [ ] **Step 6: Verify nginx accepts the new config**

Run: `docker exec ssai-dev-web-1 nginx -t`
Expected: `syntax is ok` / `test is successful`

- [ ] **Step 7: Commit**

```bash
git add docker/nginx/default.conf docker/php/php.ini docker/dev/php-dev.ini config/services.php
git commit -m "chore(infra): raise upload ceiling to 100MB for chat media

nginx rejected >25m with a 413 before PHP ever ran. Raise
client_max_body_size to 110m and PHP's upload/post limits to 100M/110M
(post sits above upload: multipart carries the file plus fields), matching
OnlyFans' own 100M direct-upload cap.

fastcgi_read_timeout and max_execution_time go to 300s: receiving 100MB
from the browser and forwarding it to OnlyFans can exceed 120s. Adds
services.onlyfans.upload_timeout (default 300) for the upload call only.

Requires an image rebuild — none of this applies to a running container.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `uploadMedia` (NO RETRY) + `getUploadStatus`

The heart of the spec. `client()` retries 3×; on a multipart upload that risks a second, **billed** copy of the file on OnlyFans. `uploadMedia` therefore builds its own request.

**Files:**
- Modify: `app/Services/OnlyFans/OnlyFansService.php` (add methods near the other media methods)
- Test: `tests/Unit/OnlyFansMediaTest.php` (create)

**Interfaces:**
- Consumes: `config('services.onlyfans.upload_timeout')` (Task 1).
- Produces:
  - `OnlyFansService::uploadMedia(string $account, string $path, string $filename): Response` — POSTs multipart `file` + `async=true` to `{account}/media/upload`. Returns the raw Response (202 `{status, prefixed_id, polling_url}`).
  - `OnlyFansService::getUploadStatus(string $account, string $uploadId): Response` — GET `{account}/media/uploads/{uploadId}/status`.

- [ ] **Step 1: Write the failing tests**

Create `tests/Unit/OnlyFansMediaTest.php`:

```php
<?php

use App\Services\OnlyFans\OnlyFansService;
use Illuminate\Support\Facades\Http;

/**
 * These need Http::fake (the facade), so they boot Laravel — unlike the pure
 * mappers in OnlyFansTextTest, which are app-free.
 */
function mediaService(): OnlyFansService
{
    return new OnlyFansService('test-key', 'https://app.onlyfansapi.com/api');
}

it('uploads multipart with async=true and returns the prefixed id', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'status' => 'pending',
        'prefixed_id' => 'ofapi_media_abc123',
        'polling_url' => 'https://app.onlyfansapi.com/api/acct_cam/media/uploads/ofapi_media_abc123/status',
    ], 202)]);

    $path = tempnam(sys_get_temp_dir(), 'up');
    file_put_contents($path, 'PNGDATA');

    $res = mediaService()->uploadMedia('acct_cam', $path, 'shot.png');

    expect($res->status())->toBe(202)
        ->and($res->json('prefixed_id'))->toBe('ofapi_media_abc123');

    Http::assertSent(function ($r) {
        return $r->method() === 'POST'
            && str_contains($r->url(), '/acct_cam/media/upload')
            && $r->isMultipart()
            && collect($r->data())->contains(fn ($p) => $p['name'] === 'async' && $p['contents'] === 'true')
            && collect($r->data())->contains(fn ($p) => $p['name'] === 'file');
    });

    unlink($path);
});

// THE most important test in this spec. client() retries 3x; a retried multipart
// upload re-sends bytes OnlyFans may already have accepted -> a second BILLED copy.
it('NEVER retries a failed upload (duplicate media guard)', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['error' => 'boom'], 500)]);

    $path = tempnam(sys_get_temp_dir(), 'up');
    file_put_contents($path, 'PNGDATA');

    $res = mediaService()->uploadMedia('acct_cam', $path, 'shot.png');

    expect($res->status())->toBe(500);
    Http::assertSentCount(1); // exactly ONE — never 3

    unlink($path);
});

it('reads a completed upload status', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'status' => 'completed',
        'prefixed_id' => 'ofapi_media_abc123',
    ])]);

    $res = mediaService()->getUploadStatus('acct_cam', 'ofapi_media_abc123');

    expect($res->json('status'))->toBe('completed');
    Http::assertSent(fn ($r) => $r->method() === 'GET'
        && str_contains($r->url(), '/acct_cam/media/uploads/ofapi_media_abc123/status'));
});

it('reads a failed upload status with its error', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'status' => 'failed',
        'prefixed_id' => 'ofapi_media_abc123',
        'error' => 'Failed to download file from the provided URL.',
    ])]);

    $res = mediaService()->getUploadStatus('acct_cam', 'ofapi_media_abc123');

    expect($res->json('status'))->toBe('failed')
        ->and($res->json('error'))->toBe('Failed to download file from the provided URL.');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker exec ssai-dev-app-1 php artisan test tests/Unit/OnlyFansMediaTest.php`
Expected: FAIL — `Call to undefined method App\Services\OnlyFans\OnlyFansService::uploadMedia()`.

- [ ] **Step 3: Implement both methods**

In `app/Services/OnlyFans/OnlyFansService.php`, add after `searchGiphy()`:

```php
    // ---- Media upload / vault ---------------------------------------------

    /**
     * Upload a file to the OnlyFans CDN and return its single-use `ofapi_media_` id.
     *
     * Always async: OnlyFans replies 202 as soon as it holds the bytes and transcodes in
     * the background, so a slow video never occupies a PHP-FPM worker. Poll
     * getUploadStatus() until `completed` before sending the id in `mediaFiles`.
     *
     * NB: this deliberately does NOT use client(). client() carries ->retry(3), and
     * retrying a multipart upload re-sends a file OnlyFans may already have accepted —
     * producing a second, BILLED copy. A consumed upload stream cannot be replayed
     * safely either. Own builder: no retry, upload_timeout instead of the 30s default.
     */
    public function uploadMedia(string $account, string $path, string $filename): Response
    {
        if (! $this->enabled()) {
            throw new RuntimeException('ONLYFANS_API_KEY is not configured.');
        }

        return Http::baseUrl($this->baseUrl)
            ->withToken($this->apiKey)
            ->acceptJson()
            ->timeout((int) config('services.onlyfans.upload_timeout', 300))
            // fopen (not file_get_contents): Guzzle streams the body, so a 100MB upload
            // does not cost a 100MB allocation per concurrent send.
            ->attach('file', fopen($path, 'r'), $filename)
            ->post("{$account}/media/upload", ['async' => 'true']);
    }

    /** Poll an async upload: status is pending | processing | completed | failed. */
    public function getUploadStatus(string $account, string $uploadId): Response
    {
        return $this->client()->get("{$account}/media/uploads/{$uploadId}/status");
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker exec ssai-dev-app-1 php artisan test tests/Unit/OnlyFansMediaTest.php`
Expected: PASS — 4 passed. If "NEVER retries" fails with a sent-count of 3, the method is using `client()` — fix that, do not relax the test.

- [ ] **Step 5: Commit**

```bash
git add app/Services/OnlyFans/OnlyFansService.php tests/Unit/OnlyFansMediaTest.php
git commit -m "feat(onlyfans): async media upload + status polling

uploadMedia() POSTs multipart with async=true and returns the single-use
ofapi_media_ id; getUploadStatus() polls until completed|failed.

uploadMedia deliberately does NOT use client(): client() retries 3x, and a
retried multipart upload re-sends bytes OnlyFans may already have accepted,
creating a second BILLED copy of the file. Own builder — no retry, and
upload_timeout (300s) instead of the 30s default. Pinned by a test that
asserts a failed upload sends EXACTLY ONE request.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: `listVaultMedia` + `sendMedia`

**Files:**
- Modify: `app/Services/OnlyFans/OnlyFansService.php`
- Test: `tests/Unit/OnlyFansMediaTest.php` (append)

**Interfaces:**
- Consumes: `normalizeMedia(array $raw): array` (existing — maps `['media' => [...]]` to the design shape); `textToOfHtml(string $plain): string` (existing, from part 1).
- Produces:
  - `OnlyFansService::listVaultMedia(string $account, array $params = []): Response` — GET `{account}/media/vault` passing only `type`/`limit`/`offset`.
  - `OnlyFansService::sendMedia(string $account, string $chatId, array $mediaFiles, string $text = ''): Response`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/Unit/OnlyFansMediaTest.php`:

```php
it('lists vault media with type/limit/offset only', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => ['list' => [], 'hasMore' => false],
    ])]);

    mediaService()->listVaultMedia('acct_cam', ['type' => 'audio', 'limit' => 50, 'offset' => 20, 'bogus' => 'x']);

    Http::assertSent(function ($r) {
        return $r->method() === 'GET'
            && str_contains($r->url(), '/acct_cam/media/vault')
            && str_contains($r->url(), 'type=audio')
            && str_contains($r->url(), 'limit=50')
            && str_contains($r->url(), 'offset=20')
            && ! str_contains($r->url(), 'bogus');
    });
});

// The vault item shape matches message media, so the existing normalizer is reused
// rather than duplicated. This pins that.
it('normalizes a vault item through the existing normalizeMedia', function () {
    $item = [
        'id' => 123,
        'type' => 'audio',
        'canView' => true,
        'duration' => 3,
        'files' => ['full' => ['url' => 'https://cdn2.onlyfans.com/a.mp3'], 'thumb' => null, 'preview' => null],
    ];

    $out = mediaService()->normalizeMedia(['media' => [$item]]);

    expect($out)->toHaveCount(1)
        ->and($out[0]['id'])->toBe('123')
        ->and($out[0]['type'])->toBe('audio')
        ->and($out[0]['full'])->toBe('https://cdn2.onlyfans.com/a.mp3')
        ->and($out[0]['thumb'])->toBeNull()
        ->and($out[0]['duration'])->toBe(3);
});

it('sends media with serialized text', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 9, 'fromUser' => ['id' => 1]]])]);

    mediaService()->sendMedia('acct_cam', '101', ['ofapi_media_abc'], 'look **here**');

    Http::assertSent(fn ($r) => $r->method() === 'POST'
        && str_contains($r->url(), '/acct_cam/chats/101/messages')
        && $r['mediaFiles'] === ['ofapi_media_abc']
        && $r['text'] === 'look <strong>here</strong>');
});

it('omits text entirely when sending media with no caption', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 9, 'fromUser' => ['id' => 1]]])]);

    mediaService()->sendMedia('acct_cam', '101', ['ofapi_media_abc'], '   ');

    Http::assertSent(fn ($r) => $r['mediaFiles'] === ['ofapi_media_abc']
        && ! array_key_exists('text', $r->data()));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker exec ssai-dev-app-1 php artisan test tests/Unit/OnlyFansMediaTest.php`
Expected: FAIL — `Call to undefined method ...::listVaultMedia()`.

- [ ] **Step 3: Implement both methods**

In `app/Services/OnlyFans/OnlyFansService.php`, add directly after `getUploadStatus()`:

```php
    /**
     * List the creator's vault media. Vault items carry the SAME shape as message
     * media, so callers normalize them with the existing normalizeMedia() — there is
     * deliberately no second normalizer. `limit` is capped at 100 by the API; drive
     * paging off `data.hasMore` (nextOffset advances past the end and lies).
     */
    public function listVaultMedia(string $account, array $params = []): Response
    {
        return $this->client()->get("{$account}/media/vault", collect($params)
            ->only(['type', 'limit', 'offset'])
            ->filter(fn ($v) => $v !== null && $v !== '')
            ->all());
    }

    /**
     * Send a message carrying media (upload ids and/or vault ids), with optional text.
     * Price is never sent — PPV stays blocked in v1.
     */
    public function sendMedia(string $account, string $chatId, array $mediaFiles, string $text = ''): Response
    {
        $body = ['mediaFiles' => array_values($mediaFiles)];
        $text = trim($text);
        if ($text !== '') {
            $body['text'] = $this->textToOfHtml($text);
        }

        return $this->client()->post("{$account}/chats/{$chatId}/messages", $body);
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `docker exec ssai-dev-app-1 php artisan test tests/Unit/OnlyFansMediaTest.php`
Expected: PASS — 9 passed.

- [ ] **Step 5: Commit**

```bash
git add app/Services/OnlyFans/OnlyFansService.php tests/Unit/OnlyFansMediaTest.php
git commit -m "feat(onlyfans): vault listing + media send

listVaultMedia() lists the creator's vault (type/limit/offset; limit maxes
at 100). Vault items share the message-media shape, so callers reuse the
existing normalizeMedia() — no second normalizer.

sendMedia() posts mediaFiles[] with optional text, serialized through the
same textToOfHtml() as every other send. No price — PPV stays blocked.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Controller + routes — upload, status, vault, and `mediaFiles` on send

**Files:**
- Modify: `app/Http/Controllers/OnlyFansChatController.php`, `routes/web.php`
- Test: `tests/Feature/OnlyFansChatTest.php` (append)

**Interfaces:**
- Consumes: `uploadMedia`, `getUploadStatus`, `listVaultMedia`, `sendMedia` (Tasks 2-3); the existing private helpers `account(Request, AichModel): string`, `forward(Response): JsonResponse`, `validateJson(Request, array): array`, and `normalizeMedia(array): array`.
- Produces these JSON endpoints (consumed by Task 5's client):
  - `POST onlyfans/{model}/media/upload` → `{id: string, status: string}`
  - `GET onlyfans/{model}/media/uploads/{upload}/status` → `{status: string, error: string|null}`
  - `GET onlyfans/{model}/media/vault?type&limit&offset` → `{items: OfMedia[], hasMore: bool}`
  - `POST onlyfans/{model}/chats/{chat}/messages` additionally accepts `mediaFiles: string[]`

- [ ] **Step 1: Write the failing tests**

Append to `tests/Feature/OnlyFansChatTest.php`:

```php
it('uploads a file and returns the media id', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'status' => 'pending', 'prefixed_id' => 'ofapi_media_abc123',
    ], 202)]);

    $this->actingAs(User::factory()->admin()->create())
        ->post("/onlyfans/{$this->model->id}/media/upload", [
            'file' => \Illuminate\Http\UploadedFile::fake()->image('shot.jpg'),
        ])
        ->assertOk()
        ->assertJsonPath('id', 'ofapi_media_abc123')
        ->assertJsonPath('status', 'pending');
});

// A 101MB file must fail as JSON 422 from OUR validation, never as nginx's
// 413 HTML page (which the fetch client cannot parse).
it('rejects an oversized upload as json', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/media/upload", [
            'file' => \Illuminate\Http\UploadedFile::fake()->create('huge.mp4', 102401, 'video/mp4'),
        ])
        ->assertStatus(422);
});

it('rejects a non-media upload', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/media/upload", [
            'file' => \Illuminate\Http\UploadedFile::fake()->create('x.exe', 10, 'application/x-msdownload'),
        ])
        ->assertStatus(422);
});

it('proxies upload status', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['status' => 'completed'])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/media/uploads/ofapi_media_abc123/status")
        ->assertOk()
        ->assertJsonPath('status', 'completed');
});

it('lists vault media normalised with hasMore', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response([
        'data' => [
            'list' => [[
                'id' => 7, 'type' => 'audio', 'canView' => true, 'duration' => 3,
                'files' => ['full' => ['url' => 'https://cdn2.onlyfans.com/a.mp3']],
            ]],
            'hasMore' => true,
        ],
    ])]);

    $this->actingAs(User::factory()->admin()->create())
        ->getJson("/onlyfans/{$this->model->id}/media/vault?type=audio")
        ->assertOk()
        ->assertJsonPath('items.0.id', '7')
        ->assertJsonPath('items.0.type', 'audio')
        ->assertJsonPath('hasMore', true);
});

it('sends a message with mediaFiles', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 560, 'fromUser' => ['id' => 999]]])]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/chats/101/messages", [
            'text' => '', 'mediaFiles' => ['ofapi_media_abc123'],
        ])
        ->assertOk()
        ->assertJsonPath('message.from', 'creator');

    Http::assertSent(fn ($r) => $r->method() === 'POST'
        && str_contains($r->url(), '/acct_cam/chats/101/messages')
        && $r['mediaFiles'] === ['ofapi_media_abc123']);
});

it('still blocks PPV when media is attached', function () {
    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/chats/101/messages", [
            'mediaFiles' => ['ofapi_media_abc123'], 'price' => 20,
        ])
        ->assertStatus(422);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker exec ssai-dev-app-1 php artisan test tests/Feature/OnlyFansChatTest.php --filter "upload|vault|mediaFiles|oversized|non-media"`
Expected: FAIL — 404s (routes do not exist yet).

- [ ] **Step 3: Add the three controller actions**

In `app/Http/Controllers/OnlyFansChatController.php`, add after `mediaFile()`:

```php
    /**
     * Upload one file to the OnlyFans CDN and hand back its single-use media id.
     *
     * The size rule is enforced HERE as JSON so an oversized file fails with a parseable
     * 422 rather than nginx's 413 HTML page. 100MB = OnlyFans' own direct-upload cap;
     * nginx (110m) and PHP (100M/110M) are configured to match.
     */
    public function uploadMedia(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($request, $model);

        $this->validateJson($request, [
            'file' => 'required|file|max:102400|mimetypes:image/jpeg,image/png,image/gif,image/webp,video/mp4,video/quicktime,video/webm,audio/mpeg,audio/mp4,audio/aac,audio/ogg,audio/wav',
        ]);

        $file = $request->file('file');
        $res = $this->of->uploadMedia($acct, $file->getRealPath(), $file->getClientOriginalName());

        if (! $res->successful()) {
            return $this->forward($res);
        }

        return response()->json([
            'id' => $res->json('prefixed_id'),
            'status' => $res->json('status') ?? 'pending',
        ]);
    }

    /** Poll an async upload until it is `completed` or `failed`. */
    public function uploadStatus(Request $request, AichModel $model, string $upload): JsonResponse
    {
        $res = $this->of->getUploadStatus($this->account($request, $model), $upload);

        return $res->successful()
            ? response()->json([
                'status' => $res->json('status') ?? 'processing',
                'error' => $res->json('error'),
            ])
            : $this->forward($res);
    }

    /** List the creator's vault media for the composer's picker. */
    public function vault(Request $request, AichModel $model): JsonResponse
    {
        $acct = $this->account($request, $model);
        $res = $this->of->listVaultMedia($acct, [
            'type' => $request->query('type'),
            'limit' => $request->query('limit', 48),
            'offset' => $request->query('offset', 0),
        ]);

        if (! $res->successful()) {
            return $this->forward($res);
        }

        $list = $res->json('data.list') ?? $res->json('data') ?? [];

        return response()->json([
            // Vault items share the message-media shape — reuse the one normalizer.
            'items' => $this->of->normalizeMedia(['media' => $list]),
            // hasMore is the ONLY honest end-of-list signal (nextOffset/next_page lie).
            'hasMore' => (bool) ($res->json('data.hasMore') ?? false),
        ]);
    }
```

- [ ] **Step 4: Teach `send()` about `mediaFiles`**

In `app/Http/Controllers/OnlyFansChatController.php`, replace the body of `send()` with:

```php
    public function send(Request $request, AichModel $model, string $chat): JsonResponse
    {
        $acct = $this->account($request, $model);
        $data = $request->validate([
            'text' => 'nullable|string',
            'giphyId' => 'nullable|string',
            'mediaFiles' => 'nullable|array|max:1',
            'mediaFiles.*' => 'string',
            'price' => 'nullable|numeric',
        ]);

        $text = trim((string) ($data['text'] ?? ''));
        $giphyId = $data['giphyId'] ?? null;
        $mediaFiles = $data['mediaFiles'] ?? [];

        if ($text === '' && ! $giphyId && $mediaFiles === []) {
            return response()->json(['error' => 'Message requires text, a GIF, or media.'], 422);
        }

        if ($this->of->ppvBlocked($data['price'] ?? 0)) {
            return response()->json(['error' => 'PPV/paid send is disabled (text only).'], 422);
        }

        $res = match (true) {
            $mediaFiles !== [] => $this->of->sendMedia($acct, $chat, $mediaFiles, $text),
            (bool) $giphyId => $this->of->sendGif($acct, $chat, $giphyId, $text),
            default => $this->of->sendText($acct, $chat, $text),
        };

        return $res->successful()
            ? response()->json(['message' => $this->of->normalizeMessage($res->json('data') ?? [], $chat)])
            : $this->forward($res);
    }
```

- [ ] **Step 5: Register the routes**

In `routes/web.php`, inside the `Route::prefix('onlyfans/{model}')` group, add directly after the existing `Route::get('media', …)` line:

```php
        Route::post('media/upload', [OnlyFansChatController::class, 'uploadMedia'])->name('media.upload');
        Route::get('media/uploads/{upload}/status', [OnlyFansChatController::class, 'uploadStatus'])->name('media.upload.status');
        Route::get('media/vault', [OnlyFansChatController::class, 'vault'])->name('media.vault');
```

These are static segments under `media/`, and the existing `Route::get('media')` matches the bare path only, so there is no collision.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `docker exec ssai-dev-app-1 php artisan test tests/Feature/OnlyFansChatTest.php`
Expected: PASS except the 3 KNOWN-RED engine tests ("persists AI Intel (strategy)", "does not persist intel when the engine returns no strategy", "generates an AI draft from the live thread via the engine"). Those are pre-existing — leave them.

- [ ] **Step 7: Commit**

```bash
git add app/Http/Controllers/OnlyFansChatController.php routes/web.php tests/Feature/OnlyFansChatTest.php
git commit -m "feat(conversations): media upload/status/vault endpoints + mediaFiles send

POST media/upload (JSON 422 on oversize/wrong-mime so the client never has
to parse nginx's 413 HTML), GET media/uploads/{id}/status, and GET
media/vault (normalised via the existing normalizeMedia; hasMore is the only
honest end-of-list signal). send() now dispatches media -> gif -> text.

PPV stays blocked even with media attached.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Client — XHR upload with progress, status polling, vault listing

**Files:**
- Modify: `resources/js/lib/onlyfans.ts`, `resources/js/types/crm.ts`

**Interfaces:**
- Consumes: the endpoints from Task 4.
- Produces (used by Tasks 6-9):
  - `type ComposerAttachment` in `types/crm.ts`
  - `ofApi.uploadMedia(m: number, file: File, onProgress: (pct: number) => void): Promise<{ id: string; status: string }>`
  - `ofApi.uploadStatus(m: number, id: string): Promise<{ status: string; error: string | null }>`
  - `ofApi.vault(m: number, params: Record<string, string>): Promise<{ items: OfMedia[]; hasMore: boolean }>`
  - `ofApi.send(m, chat, text, giphyId?, mediaFiles?)` — extended

- [ ] **Step 1: Add the `ComposerAttachment` type**

In `resources/js/types/crm.ts`, add after the `OfGif` interface:

```ts
/** One media item attached to the next send: an upload in flight, or a vault pick. */
export interface ComposerAttachment {
    id: string | null; // ofapi_media_… (upload) or the vault id; null until upload returns
    source: 'upload' | 'vault';
    status: 'uploading' | 'processing' | 'ready' | 'failed';
    progress: number; // 0-100, upload only
    error: string | null;
    name: string | null;
    kind: 'photo' | 'video' | 'audio' | 'gif';
    previewUrl: string | null; // blob: for uploads, proxied CDN url for vault picks
}
```

- [ ] **Step 2: Add the three client calls**

In `resources/js/lib/onlyfans.ts`, add these to the `ofApi` object (after `mediaUrl`):

```ts
    /**
     * Upload one file and return its media id.
     *
     * Deliberately XMLHttpRequest, not the fetch `req()` helper used everywhere else in
     * this file: fetch cannot report UPLOAD progress, and a 100MB file behind a bare
     * spinner is unusable. This is the only exception — everything else stays on fetch.
     */
    uploadMedia: (m: number, file: File, onProgress: (pct: number) => void) =>
        new Promise<{ id: string; status: string }>((resolve, reject) => {
            const form = new FormData();
            form.append('file', file);

            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${base(m)}/media/upload`);
            xhr.withCredentials = true;
            xhr.setRequestHeader('Accept', 'application/json');
            xhr.setRequestHeader('X-XSRF-TOKEN', cookie('XSRF-TOKEN'));

            xhr.upload.onprogress = (e) => {
                if (e.lengthComputable) {
                    onProgress(Math.round((e.loaded / e.total) * 100));
                }
            };

            xhr.onload = () => {
                let body: Record<string, string> = {};
                try {
                    body = JSON.parse(xhr.responseText);
                } catch {
                    // A 413 from nginx is an HTML page, not JSON — say something useful.
                    reject(new Error(`Upload failed (${xhr.status})`));

                    return;
                }

                if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(body as unknown as { id: string; status: string });
                } else {
                    reject(new Error(body.error || body.message || `Upload failed (${xhr.status})`));
                }
            };

            xhr.onerror = () => reject(new Error('Upload failed — network error.'));
            xhr.onabort = () => reject(new Error('Upload cancelled.'));

            xhr.send(form);
        }),
    uploadStatus: (m: number, id: string) =>
        req<{ status: string; error: string | null }>(
            'GET',
            `${base(m)}/media/uploads/${encodeURIComponent(id)}/status`,
        ),
    vault: (m: number, params: Record<string, string> = {}) =>
        req<{ items: OfMedia[]; hasMore: boolean }>(
            'GET',
            `${base(m)}/media/vault?${new URLSearchParams(params)}`,
        ),
```

Add `ComposerAttachment` and `OfMedia` to the `import type { … } from '@/types/crm'` list at the top of the file if not already present (`OfMedia` is needed by `vault`'s return type).

- [ ] **Step 3: Extend `send` to carry `mediaFiles`**

In `resources/js/lib/onlyfans.ts`, replace the existing `send` entry:

```ts
    send: (
        m: number,
        chat: string,
        text: string,
        giphyId?: string,
        mediaFiles?: string[],
    ) =>
        postJson<{ message: unknown }>(`${base(m)}/chats/${chat}/messages`, {
            text,
            giphyId,
            mediaFiles,
        }),
```

- [ ] **Step 4: Verify types and lint**

Run: `npm run types:check && npm run lint:check`
Expected: PASS both. If `cookie()` is not in scope in `onlyfans.ts`, import or reuse the same helper `req()` uses — do not inline a second cookie parser.

- [ ] **Step 5: Commit**

```bash
git add resources/js/lib/onlyfans.ts resources/js/types/crm.ts
git commit -m "feat(conversations): media upload/status/vault client calls

uploadMedia() uses XMLHttpRequest rather than this file's fetch helper
because fetch cannot report upload progress and a 100MB file behind a bare
spinner is unusable — the one deliberate exception, isolated to that
function. It also degrades a non-JSON body (nginx's 413 HTML) into a real
error instead of a parse crash.

Adds uploadStatus polling, vault listing, and mediaFiles on send.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `SsVaultModal`

**Files:**
- Create: `resources/js/components/crm/conversations/SsVaultModal.vue`

**Interfaces:**
- Consumes: `ofApi.vault(m, params)`, `ofApi.mediaUrl(m, cdnUrl)`, `OfMedia`.
- Produces: `SsVaultModal` — props `{ modelId: number }`; emits `select: [item: OfMedia]` and `close: []`. Consumed by Task 7.

- [ ] **Step 1: Create the component**

Create `resources/js/components/crm/conversations/SsVaultModal.vue`:

```vue
<script setup lang="ts">
import { LoaderCircle, X } from '@lucide/vue';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { ofApi } from '@/lib/onlyfans';
import type { OfMedia } from '@/types/crm';

const props = defineProps<{ modelId: number }>();
const emit = defineEmits<{ select: [item: OfMedia]; close: [] }>();

const FILTERS = [
    { label: 'All', value: '' },
    { label: 'Photo', value: 'photo' },
    { label: 'Video', value: 'video' },
    { label: 'GIF', value: 'gif' },
    { label: 'Audio', value: 'audio' },
] as const;

const PAGE = 48; // API caps `limit` at 100

const items = ref<OfMedia[]>([]);
const filter = ref('');
const loading = ref(false);
const hasMore = ref(false);
const error = ref<string | null>(null);

let token = 0;

async function load(reset: boolean) {
    loading.value = true;
    error.value = null;
    const mine = ++token;
    const offset = reset ? 0 : items.value.length;

    try {
        const params: Record<string, string> = {
            limit: String(PAGE),
            offset: String(offset),
        };
        if (filter.value) {
            params.type = filter.value;
        }

        const r = await ofApi.vault(props.modelId, params);

        if (mine !== token) {
            return;
        }

        items.value = reset ? r.items : [...items.value, ...r.items];
        // hasMore is the only honest end-of-list signal from this API.
        hasMore.value = r.hasMore;
    } catch (e) {
        if (mine === token) {
            error.value = e instanceof Error ? e.message : 'Failed to load the vault.';
        }
    } finally {
        if (mine === token) {
            loading.value = false;
        }
    }
}

function pick(f: string) {
    filter.value = f;
    load(true);
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        emit('close');
    }
}

onMounted(() => {
    load(true);
    window.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
    <div
        class="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4"
        @click.self="emit('close')"
    >
        <div
            class="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-ss-border bg-ss-surface shadow-2xl"
        >
            <div class="flex items-center gap-2 border-b border-ss-border p-3">
                <p class="text-[14px] font-semibold text-ss-text">Vault</p>
                <div class="ml-2 flex flex-wrap gap-1">
                    <button
                        v-for="f in FILTERS"
                        :key="f.value"
                        type="button"
                        class="rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors"
                        :class="
                            filter === f.value
                                ? 'border-ss-accent bg-ss-accent-soft text-ss-accent-text'
                                : 'border-ss-border text-ss-text-2 hover:bg-ss-surface-2'
                        "
                        @click="pick(f.value)"
                    >
                        {{ f.label }}
                    </button>
                </div>
                <span class="flex-1" />
                <button
                    type="button"
                    class="grid h-7 w-7 place-items-center rounded text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text-2"
                    title="Close"
                    @click="emit('close')"
                >
                    <X :size="15" />
                </button>
            </div>

            <div class="flex-1 overflow-y-auto p-3">
                <p v-if="error" class="py-6 text-center text-[12px] text-ss-neg">
                    {{ error }}
                </p>

                <p
                    v-else-if="!loading && items.length === 0"
                    class="py-10 text-center text-[12px] text-ss-text-3"
                >
                    Nothing in the vault for this filter.
                </p>

                <div v-else class="grid grid-cols-4 gap-2 sm:grid-cols-6">
                    <button
                        v-for="(m, i) in items"
                        :key="`${m.id}-${i}`"
                        type="button"
                        class="group relative aspect-square overflow-hidden rounded-lg border border-ss-border bg-ss-surface-2 hover:border-ss-accent"
                        :title="m.type"
                        @click="emit('select', m)"
                    >
                        <!-- Audio has no thumb (files.thumb is null), so show a label tile. -->
                        <img
                            v-if="m.thumb || m.preview"
                            :src="ofApi.mediaUrl(props.modelId, (m.thumb ?? m.preview) as string)"
                            :alt="m.type"
                            class="h-full w-full object-cover"
                            loading="lazy"
                        />
                        <span
                            v-else
                            class="grid h-full w-full place-items-center text-[10px] font-semibold text-ss-text-3 uppercase"
                            >{{ m.type }}</span
                        >
                        <span
                            v-if="m.duration"
                            class="absolute right-1 bottom-1 rounded bg-black/70 px-1 text-[9px] text-white"
                            >{{ m.duration }}s</span
                        >
                    </button>
                </div>

                <div class="mt-3 grid place-items-center">
                    <LoaderCircle
                        v-if="loading"
                        :size="16"
                        class="animate-spin text-ss-accent-text"
                    />
                    <button
                        v-else-if="hasMore"
                        type="button"
                        class="rounded-lg border border-ss-border px-3 py-1.5 text-[12px] font-semibold text-ss-text-2 hover:bg-ss-surface-2"
                        @click="load(false)"
                    >
                        Load more
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
```

- [ ] **Step 2: Verify types and lint**

Run: `npm run types:check && npm run lint:check`
Expected: PASS both.

- [ ] **Step 3: Commit**

```bash
git add resources/js/components/crm/conversations/SsVaultModal.vue
git commit -m "feat(conversations): add SsVaultModal

A full modal (the vault can hold thousands of items): type-filter chips,
thumbnail grid, load-more driven by data.hasMore — the only honest
end-of-list signal this API gives. Audio items have no thumb, so they render
a labelled tile instead of a broken image.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `SsComposer` — paperclip, vault button, drag-and-drop, attachment preview

**Files:**
- Modify: `resources/js/components/crm/conversations/SsComposer.vue`

**Interfaces:**
- Consumes: `ComposerAttachment` (Task 5), `SsVaultModal` (Task 6), `ofApi.mediaUrl`.
- Produces: `SsComposer` gains props `attachment: ComposerAttachment | null` and emits `update:attachment: [value: ComposerAttachment | null]`, `pick-file: [file: File]`, `pick-vault: [item: OfMedia]`. Consumed by Task 9.

- [ ] **Step 1: Add props, emits, and the drag-drop handlers**

In `resources/js/components/crm/conversations/SsComposer.vue`, extend the imports, props, and emits:

```ts
import { Bold, Check, Italic, Paperclip, RefreshCw, Send, Smile, Sparkles, X } from '@lucide/vue';
import { computed, nextTick, ref } from 'vue';
import { ofApi } from '@/lib/onlyfans';
import type { ComposerAttachment, OfGif, OfMedia } from '@/types/crm';
import SsEmojiPicker from './SsEmojiPicker.vue';
import SsGifPicker from './SsGifPicker.vue';
import SsVaultModal from './SsVaultModal.vue';
```

Add to `defineProps`: `attachment: ComposerAttachment | null;`

Add to `defineEmits`:

```ts
    'update:attachment': [value: ComposerAttachment | null];
    'pick-file': [file: File];
    'pick-vault': [item: OfMedia];
```

Add these refs and handlers alongside the existing ones:

```ts
const showVault = ref(false);
const dragging = ref(false);
const fileInput = ref<HTMLInputElement | null>(null);

const attachBusy = computed(
    () =>
        props.attachment?.status === 'uploading' ||
        props.attachment?.status === 'processing',
);

function onFileChange(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) {
        emit('pick-file', f);
    }
    // Reset so picking the SAME file twice still fires change.
    (e.target as HTMLInputElement).value = '';
}

function onDrop(e: DragEvent) {
    dragging.value = false;
    if (!props.canSend) {
        return;
    }
    const f = e.dataTransfer?.files?.[0];
    if (f) {
        emit('pick-file', f);
    }
}

function pickVault(item: OfMedia) {
    showVault.value = false;
    emit('pick-vault', item);
}
```

- [ ] **Step 2: Extend `sendable` to respect the attachment**

Replace the existing `sendable` computed:

```ts
const sendable = computed(
    () =>
        props.canSend &&
        !props.sending &&
        // An attachment that is still uploading/processing is not sendable yet.
        !attachBusy.value &&
        props.attachment?.status !== 'failed' &&
        (props.draft.trim().length > 0 ||
            props.attachedGif !== null ||
            props.attachment?.status === 'ready'),
);
```

- [ ] **Step 3: Add the attachment preview above the typing bar**

In the template, immediately after the existing `<!-- Attached GIF preview -->` block, add:

```vue
        <!-- Attached media preview -->
        <div
            v-if="props.attachment"
            class="flex items-center gap-2.5 rounded-xl border border-ss-border bg-ss-surface-2 p-2"
        >
            <img
                v-if="props.attachment.previewUrl && props.attachment.kind !== 'audio'"
                :src="props.attachment.previewUrl"
                alt=""
                class="h-12 w-12 shrink-0 rounded-lg object-cover"
            />
            <span
                v-else
                class="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-ss-surface text-[9px] font-semibold text-ss-text-3 uppercase"
                >{{ props.attachment.kind }}</span
            >

            <div class="min-w-0 flex-1">
                <p class="truncate text-[12px] font-medium text-ss-text">
                    {{ props.attachment.name ?? props.attachment.kind }}
                </p>

                <p
                    v-if="props.attachment.status === 'failed'"
                    class="text-[11px] text-ss-neg"
                >
                    {{ props.attachment.error ?? 'Upload failed.' }}
                </p>
                <p
                    v-else-if="props.attachment.status === 'processing'"
                    class="text-[11px] text-ss-text-3"
                >
                    Processing on OnlyFans…
                </p>
                <p
                    v-else-if="props.attachment.status === 'ready'"
                    class="text-[11px] text-ss-text-3"
                >
                    Ready to send
                </p>
                <div
                    v-else
                    class="mt-1 h-1.5 overflow-hidden rounded-full bg-ss-surface"
                >
                    <div
                        class="h-full rounded-full bg-ss-accent transition-[width]"
                        :style="{ width: `${props.attachment.progress}%` }"
                    />
                </div>
            </div>

            <button
                type="button"
                class="grid h-7 w-7 shrink-0 place-items-center rounded text-ss-text-3 hover:bg-ss-surface hover:text-ss-text-2"
                title="Remove attachment"
                @click="emit('update:attachment', null)"
            >
                <X :size="14" />
            </button>
        </div>
```

- [ ] **Step 4: Add the paperclip + vault buttons and the drop zone**

Wrap the existing typing-bar `<div class="flex items-end gap-2">` with drag handlers and a drop overlay by replacing its opening tag with:

```vue
        <div
            class="relative flex items-end gap-2"
            @dragover.prevent="dragging = true"
            @dragleave.prevent="dragging = false"
            @drop.prevent="onDrop"
        >
            <div
                v-if="dragging"
                class="pointer-events-none absolute inset-0 z-20 grid place-items-center rounded-lg border-2 border-dashed border-ss-accent bg-ss-accent-soft/90 text-[12px] font-semibold text-ss-accent-text"
            >
                Drop to attach
            </div>
```

Then add these two buttons immediately before the emoji picker's `<div class="relative shrink-0">`:

```vue
            <input
                ref="fileInput"
                type="file"
                accept="image/*,video/*,audio/*"
                class="hidden"
                @change="onFileChange"
            />
            <button
                type="button"
                :disabled="!props.canSend || attachBusy"
                class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-ss-border text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-40"
                title="Attach a photo, video, or audio file"
                @click="fileInput?.click()"
            >
                <Paperclip :size="16" />
            </button>
            <button
                type="button"
                :disabled="!props.canSend || attachBusy"
                class="grid h-9 shrink-0 place-items-center rounded-lg border border-ss-border px-2 text-[11px] font-bold text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-40"
                title="Attach from the OnlyFans vault"
                @click="showVault = true"
            >
                VAULT
            </button>
```

Finally, add the modal at the very end of the component's root `<div>` (after the typing-bar block closes):

```vue
        <SsVaultModal
            v-if="showVault"
            :model-id="props.modelId"
            @select="pickVault"
            @close="showVault = false"
        />
```

- [ ] **Step 5: Verify types and lint**

Run: `npm run types:check && npm run lint:check`
Expected: PASS both. If Prettier flags the file, run `npx prettier --write resources/js/components/crm/conversations/SsComposer.vue` and re-check — do not reformat other files.

- [ ] **Step 6: Commit**

```bash
git add resources/js/components/crm/conversations/SsComposer.vue
git commit -m "feat(conversations): attach media in the composer

Paperclip (device file), VAULT button (modal), and drag-and-drop onto the
typing bar, with an attachment preview showing upload progress, the
processing wait, or the failure reason. Send stays disabled until the
attachment reports ready.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Audio player in the thread

`OfMedia.type` has included `'audio'` since part 1, but `SsMessageMedia` renders photo/video only — inbound audio currently draws a broken image tile.

**Files:**
- Modify: `resources/js/components/crm/conversations/SsMessageMedia.vue`

**Interfaces:**
- Consumes: `OfMedia` (`type`, `full`, `source`, `duration`, `direct`), `ofApi.mediaUrl`.
- Produces: nothing downstream.

- [ ] **Step 1: Add the audio branch**

In `resources/js/components/crm/conversations/SsMessageMedia.vue`, inside the media loop, add an audio branch **before** the existing photo/video rendering (locate the `<template v-if="usable(m)">` block and add this as the first branch inside it):

```vue
                <!--
                  Audio: OnlyFans gives no thumb/preview for it (files.thumb is null), so a
                  player is the only sensible rendering. The src goes through the media proxy
                  because OF CDN urls are IP-locked to the server and 403 in the browser.
                -->
                <div
                    v-if="m.type === 'audio'"
                    class="flex items-center gap-2 rounded-lg border border-ss-border bg-ss-surface-2 p-2"
                >
                    <audio
                        controls
                        preload="none"
                        class="h-8 max-w-full"
                        :src="
                            m.direct
                                ? ((m.source ?? m.full) as string)
                                : ofApi.mediaUrl(props.modelId, (m.source ?? m.full) as string)
                        "
                    />
                    <span
                        v-if="m.duration"
                        class="shrink-0 text-[10px] text-ss-text-3"
                        >{{ m.duration }}s</span
                    >
                </div>
```

Guard the existing photo/video branch so it does not also render for audio: change its opening condition from `<template v-if="usable(m)">` to keep working, and ensure the photo/video markup sits under a `v-else` of the audio branch. If the existing structure makes that awkward, wrap the existing photo/video markup in `<template v-else>` — do not duplicate it.

- [ ] **Step 2: Verify types and lint**

Run: `npm run types:check && npm run lint:check`
Expected: PASS both.

- [ ] **Step 3: Verify against a real audio item**

Run:
```bash
docker exec ssai-dev-app-1 php artisan tinker --execute="
\$of = app(\App\Services\OnlyFans\OnlyFansService::class);
\$r = \$of->listVaultMedia('acct_663caec76fae4445a78b48efd7fc6043', ['type' => 'audio', 'limit' => 5]);
echo 'status: '.\$r->status().PHP_EOL;
print_r(\$of->normalizeMedia(['media' => \$r->json('data.list') ?? []]));
"
```
Expected: a 200 and either audio items (confirming `full` is populated and `thumb` is null, exactly what the branch assumes) or an empty list if this creator has no vault audio. Report which you saw. A non-200 means the vault endpoint is unreachable — report it, do not guess.

- [ ] **Step 4: Commit**

```bash
git add resources/js/components/crm/conversations/SsMessageMedia.vue
git commit -m "feat(conversations): inline audio player in the thread

OfMedia.type has included 'audio' since the text layer, but nothing rendered
it — inbound audio drew a broken image tile. Audio has no thumb/preview from
OnlyFans, so it renders an <audio controls> element, sourced through the
media proxy because OF CDN urls are IP-locked and 403 in the browser.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Wire the attachment into the page + optimistic bubble

**Files:**
- Modify: `resources/js/pages/Conversations.vue`, `resources/js/lib/conversationCache.ts`

**Interfaces:**
- Consumes: `ComposerAttachment` (Task 5), `ofApi.uploadMedia`/`uploadStatus`/`send` (Task 5), `SsComposer`'s `pick-file`/`pick-vault`/`update:attachment` (Task 7).
- Produces: nothing downstream.

- [ ] **Step 1: Add `attachment` to the per-chat composer state**

In `resources/js/lib/conversationCache.ts`, add to the `ComposerState` interface (after `gif`):

```ts
    attachment: ComposerAttachment | null; // media attached to the next send (excl. with gif)
```

and to the initialiser object in `chatComposer()` (after `gif: null,`):

```ts
            attachment: null,
```

Add `ComposerAttachment` to the `import type { … } from '@/types/crm'` list in that file.

- [ ] **Step 2: Add the upload + poll flow to the page**

In `resources/js/pages/Conversations.vue`, add these functions near the existing send/gif logic:

```ts
const POLL_MS = 1500;
const POLL_MAX = 60; // ~90s, then give up rather than poll forever

function attachmentKind(mime: string): ComposerAttachment['kind'] {
    if (mime.startsWith('video/')) {
        return 'video';
    }
    if (mime.startsWith('audio/')) {
        return 'audio';
    }
    if (mime === 'image/gif') {
        return 'gif';
    }

    return 'photo';
}

async function onPickFile(file: File) {
    const chat = selected.value;
    if (!chat) {
        return;
    }

    const cur = chatComposer(chat.id);

    // 100MB = OnlyFans' cap, mirrored by nginx/PHP. Reject here so the user isn't
    // made to wait out a long transfer only to hit an unparseable nginx 413.
    if (file.size > 100 * 1024 * 1024) {
        cur.attachment = {
            id: null, source: 'upload', status: 'failed', progress: 0,
            error: 'File is larger than 100MB.', name: file.name,
            kind: attachmentKind(file.type), previewUrl: null,
        };

        return;
    }

    revokeAttachment(cur.attachment);
    cur.gif = null; // media and GIF are mutually exclusive

    const att: ComposerAttachment = {
        id: null,
        source: 'upload',
        status: 'uploading',
        progress: 0,
        error: null,
        name: file.name,
        kind: attachmentKind(file.type),
        previewUrl: file.type.startsWith('image/') ? URL.createObjectURL(file) : null,
    };
    cur.attachment = att;

    try {
        const r = await ofApi.uploadMedia(model.id, file, (pct) => {
            if (cur.attachment === att) {
                att.progress = pct;
            }
        });

        if (cur.attachment !== att) {
            return; // removed or replaced mid-flight
        }

        att.id = r.id;
        att.status = 'processing';
        await pollUpload(cur, att);
    } catch (e) {
        if (cur.attachment === att) {
            att.status = 'failed';
            att.error = e instanceof Error ? e.message : 'Upload failed.';
        }
    }
}

async function pollUpload(cur: ComposerState, att: ComposerAttachment) {
    for (let i = 0; i < POLL_MAX; i++) {
        await new Promise((r) => setTimeout(r, POLL_MS));

        if (cur.attachment !== att || !att.id) {
            return;
        }

        try {
            const s = await ofApi.uploadStatus(model.id, att.id);

            if (cur.attachment !== att) {
                return;
            }

            if (s.status === 'completed') {
                att.status = 'ready';

                return;
            }

            if (s.status === 'failed') {
                att.status = 'failed';
                att.error = s.error ?? 'OnlyFans could not process this file.';

                return;
            }
        } catch (e) {
            att.status = 'failed';
            att.error = e instanceof Error ? e.message : 'Upload status check failed.';

            return;
        }
    }

    att.status = 'failed';
    att.error = 'Timed out waiting for OnlyFans to process this file.';
}

function onPickVault(item: OfMedia) {
    const chat = selected.value;
    if (!chat || !item.id) {
        return;
    }

    const cur = chatComposer(chat.id);
    revokeAttachment(cur.attachment);
    cur.gif = null;

    cur.attachment = {
        id: item.id,
        source: 'vault',
        status: 'ready', // vault ids need no upload and are reusable
        progress: 100,
        error: null,
        name: null,
        kind: (item.type as ComposerAttachment['kind']) ?? 'photo',
        previewUrl: item.thumb || item.preview
            ? ofApi.mediaUrl(model.id, (item.thumb ?? item.preview) as string)
            : null,
    };
}

/** blob: previews are object URLs — free them or they leak for the session. */
function revokeAttachment(att: ComposerAttachment | null) {
    if (att?.source === 'upload' && att.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(att.previewUrl);
    }
}

function setAttachment(value: ComposerAttachment | null) {
    const chat = selected.value;
    if (!chat) {
        return;
    }

    const cur = chatComposer(chat.id);
    revokeAttachment(cur.attachment);
    cur.attachment = value;
}
```

Add `ComposerAttachment` and `OfMedia` to the page's `import type { … } from '@/types/crm'`, and `ComposerState` to its import from `@/lib/conversationCache`.

- [ ] **Step 3: Send the attachment and preview it optimistically**

In `Conversations.vue`'s `send()`, before the request: capture the attachment, include it in the optimistic bubble's media, and pass its id.

Where the optimistic message is built (the object with `pending: true`), replace the `mediaCount`/`media` lines with:

```ts
        mediaCount: gifMedia.length + (att ? 1 : 0),
        media: att
            ? [
                  ...gifMedia,
                  {
                      id: att.id,
                      type: att.kind,
                      canView: true,
                      thumb: att.previewUrl,
                      preview: att.previewUrl,
                      full: att.previewUrl,
                      source: att.previewUrl,
                      duration: null,
                      width: null,
                      height: null,
                      // blob:/proxied previews are already browser-loadable — skip the
                      // OF media proxy, exactly as Giphy previews do.
                      direct: true,
                  },
              ]
            : gifMedia,
```

Immediately above that object, add:

```ts
    const att = cur.attachment?.status === 'ready' ? cur.attachment : null;
```

Change the send call to pass the media id:

```ts
        const r = await ofApi.send(
            model.id,
            chatId,
            text,
            cur.gif?.id ?? undefined,
            att?.id ? [att.id] : undefined,
        );
```

And where the send succeeds and clears `cur.gif`, also clear the attachment:

```ts
        revokeAttachment(cur.attachment);
        cur.attachment = null;
```

- [ ] **Step 4: Bind the new props/events on `<SsComposer`**

In `Conversations.vue`, add to the `<SsComposer` usage:

```vue
                        :attachment="cur.attachment"
                        @update:attachment="setAttachment"
                        @pick-file="onPickFile"
                        @pick-vault="onPickVault"
```

- [ ] **Step 5: Verify types and lint**

Run: `npm run types:check && npm run lint:check`
Expected: PASS both.

- [ ] **Step 6: Verify the whole flow in the running app**

The dev stack is up. Open `/conversations?creator=test`, pick a sendable chat (NOT `535406053` or `567427648` — both are muted and unsendable), and confirm:

1. The paperclip attaches an image; a progress bar runs, then "Ready to send".
2. Dragging a file onto the typing bar attaches it the same way.
3. The VAULT button opens the modal; filters work; picking an item attaches it as "Ready to send" with no upload.
4. Sending with an attachment shows an optimistic bubble with the local preview, then the confirmed OnlyFans message.
5. A >100MB file fails immediately with "File is larger than 100MB." and never uploads.

Report exactly what you saw. If a step fails, report it rather than working around it.

- [ ] **Step 7: Commit**

```bash
git add resources/js/pages/Conversations.vue resources/js/lib/conversationCache.ts
git commit -m "feat(conversations): wire media attachments into send

Per-chat attachment state, upload with progress, status polling (1.5s, capped
at ~90s so a stuck upload fails instead of polling forever), and vault picks
(ready immediately — vault ids need no upload and are reusable).

The optimistic bubble previews the local file via a blob: URL reusing the
existing OfMedia.direct flag that already bypasses the OF proxy for Giphy.
Object URLs are revoked on replace/remove/send so they don't leak.

Attachment and GIF are mutually exclusive; oversized files are rejected in
the browser before any transfer.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Plan self-review

**Spec coverage:** infra limits + `upload_timeout` → Task 1. `uploadMedia` no-retry + `getUploadStatus` → Task 2. `listVaultMedia` + `sendMedia` + `normalizeMedia` reuse → Task 3. Controller/routes + JSON-422 oversize + PPV-still-blocked → Task 4. XHR upload/progress + `ComposerAttachment` + client calls → Task 5. `SsVaultModal` (`hasMore` paging, audio tiles) → Task 6. Paperclip/vault/drag-drop/preview → Task 7. Audio player → Task 8. Attachment state, polling cap, optimistic `blob:` bubble via `direct`, object-URL revocation, GIF exclusivity → Task 9. Every "Files" entry in the spec is covered.

**Type consistency:** `ComposerAttachment` is defined once (Task 5) and consumed unchanged in Tasks 7 and 9 — `kind` is `'photo' | 'video' | 'audio' | 'gif'` everywhere; `status` is `'uploading' | 'processing' | 'ready' | 'failed'` everywhere. `ofApi.uploadMedia(m, file, onProgress)`, `ofApi.uploadStatus(m, id)`, `ofApi.vault(m, params)` keep identical signatures between Task 5 and their call sites in Tasks 6/9. `sendMedia($account, $chatId, array $mediaFiles, string $text = '')` matches its controller call in Task 4.

**Known deviation from the spec, called out:** the spec's file list mentions `tests/Unit/OnlyFansTextTest.php` "(or a new unit file)"; this plan uses a new `tests/Unit/OnlyFansMediaTest.php` because these tests need `Http::fake` (booting Laravel), whereas `OnlyFansTextTest` is deliberately app-free — mixing them would break that property.
