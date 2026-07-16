# Advanced composer, part 2: the media layer — design

**Date:** 2026-07-16
**Status:** approved (pending spec review)
**Area:** Conversations (live OnlyFans proxy) — `SsComposer` attachments + `SsMessageMedia`

## Goal

Let a chatter **attach and send media**: a file from their device (photo, video, **audio**)
or an item from the creator's **OnlyFans vault**. Plus an inline **audio player** in the
thread, which does not exist today.

This is part 2 of the advanced composer. Part 1 (shipped, `docs/superpowers/specs/
2026-07-15-composer-text-layer-design.md`) delivered emoji, `**bold**`/`__italic__`, real
line breaks, and the `canSend` guard. Part 1 deliberately deferred everything below.

## Non-goals

- **PPV / paid media.** `price` (3–200) + `previews[]` + `lockedText` stay unbuilt and
  `ppvBlocked()` stays exactly as-is. Media sends at price 0 only. This is money-touching
  and gets its own spec.
- **Multiple attachments per message.** One at a time, mirroring the existing single
  `ComposerState.gif`. `mediaFiles[]` carries exactly one id.
- **In-browser voice recording.** Audio is a *file attach*. Browsers record webm/opus
  (Chrome) or mp4 (Safari) and OnlyFans' transcoder acceptance of webm is undocumented —
  building on that would be guessing. Audio *files* upload through the same path as any
  other file.
- **Vault management** (upload-to-vault, delete, albums/lists). The vault is read-only here:
  browse and attach. `POST /media/vault`, `media/vault/delete-media`, and `media/vault/lists`
  are out of scope.
- **`file_url` ingestion**, chunked/resumable uploads, background-queued uploads.
- Persisting anything. Conversations remains a live proxy storing no message text.

## API surface (from the OpenAPI `paths:`, per the read-spec-first rule)

| Endpoint | Use |
|---|---|
| `POST {acct}/media/upload` | multipart `file` (or `file_url`); `async=true` → **202** `{status, prefixed_id, polling_url}`. Sync → 200. Returns a **single-use** `ofapi_media_…` id. **Does NOT add to the vault.** |
| `GET {acct}/media/uploads/{upload}/status` | `{status: pending\|processing\|completed\|failed, prefixed_id, media?, error?}` |
| `GET {acct}/media/vault` | `type` filter (`photo\|gif\|video\|audio`), `list`, `sort`, `limit` (10–100), `offset`. Items are **the same shape as message media**. |
| `POST {acct}/chats/{chat}/messages` | `mediaFiles[]` accepts upload ids **or** vault ids; `text` optional when media is present. |

**Vault items reuse `normalizeMedia`.** The vault item (`id`/`type`/`canView`/`hasError`/
`createdAt`/`files.{full,thumb,preview}`/`duration`) matches the message-media shape the
existing normalizer already maps. A second normalizer would be duplication.

**Upload ids are single-use; vault ids are reusable.** If a send fails *after* a successful
upload, the `ofapi_media_` id may already be spent — the composer surfaces the failure and
requires a re-upload rather than silently retrying a send that cannot succeed.

## Design

### 1. The upload path — browser → Laravel → OnlyFans

The OnlyFans key is server-side and must never reach the browser, so Laravel proxies the
transfer. `async=true` is used for **every** upload (uniform, no special-casing by size):
OnlyFans returns as soon as it has the bytes, and the transcode never occupies a PHP-FPM
worker.

```
browser --multipart--> POST /onlyfans/{model}/media/upload
                        ├─ validate: ≤100MB, mime in image/*|video/*|audio/*
                        └─ OnlyFansService::uploadMedia($acct, $file)   [async=true]
                                    --multipart--> {acct}/media/upload
                                    <-- 202 {prefixed_id, polling_url}
        <-- {id, status:'pending'} --
browser --poll 1.5s--> GET /onlyfans/{model}/media/uploads/{id}/status
                                    --> {acct}/media/uploads/{id}/status
        <-- {status, error?} --      (completed → Send enabled; failed → show error)
send:   POST …/messages { text?, mediaFiles: [id] }
```

#### `uploadMedia()` MUST NOT reuse `client()`

`OnlyFansService::client()` applies `->timeout(30)` and **`->retry(3, 1000, …)`** to every
request. Both are wrong for an upload:

- **`retry` risks duplicate billed media.** A retry after OnlyFans has already accepted the
  bytes uploads the file a second time. A consumed multipart stream also cannot be replayed.
- **30s is too short** for a 100MB forward.

`uploadMedia()` therefore builds its own request: **no retry**, timeout from a new
`services.onlyfans.upload_timeout` (default 300). Every other method keeps using `client()`
unchanged.

#### Polling

`getUploadStatus()` uses the normal `client()` (idempotent GET, retry is safe). The client
polls every 1.5s. Terminal states are `completed` and `failed`; `pending`/`processing`
continue. A poll cap (60 attempts ≈ 90s) prevents an infinite loop on a stuck upload, after
which the attachment shows a timeout error and can be removed.

### 2. Infrastructure — the cost of a 100MB ceiling

Today the stack rejects anything over 25MB *before PHP runs* (nginx 413). Raising the
ceiling touches four files:

| File | From | To |
|---|---|---|
| `docker/nginx/default.conf` | `client_max_body_size 25m` | `110m` |
| `docker/nginx/default.conf` | `fastcgi_read_timeout 120s` | `300s` |
| `docker/php/php.ini` | `upload_max_filesize 25M` / `post_max_size 30M` / `max_execution_time 120` | `100M` / `110M` / `300` |
| `docker/dev/php-dev.ini` | same | same |

`post_max_size` (110M) sits **above** `upload_max_filesize` (100M) because the multipart body
carries the file *plus* fields. `memory_limit` (512M) is untouched — PHP spools uploads to
`upload_tmp_dir` and Guzzle streams the forward, so neither holds the file in memory.

**Deployment note (load-bearing):** dev *mounts* `docker/nginx/default.conf`, so `docker
compose restart web` picks it up — but `php-dev.ini` is `COPY`'d in the Dockerfile, so **dev
needs an image rebuild**. Prod bakes both: **rebuild `app` + `web` and redeploy**. None of
this takes effect on a running prod container.

**Client-side size validation is required, not cosmetic.** A 101MB file must be rejected in
the browser before upload — otherwise the user waits out a long transfer only to receive an
opaque nginx 413 HTML page (which is not JSON and will not parse).

### 3. Composer — one attachment, four states

`ComposerState` gains `attachment: ComposerAttachment | null`, alongside the existing `gif`
(the two are mutually exclusive — attaching one clears the other; OnlyFans takes `giphyId`
or `mediaFiles`, and mixing them is not in the documented send contract).

```ts
type ComposerAttachment = {
    id: string | null;          // ofapi_media_… (upload) or the numeric vault id
    source: 'upload' | 'vault';
    status: 'uploading' | 'processing' | 'ready' | 'failed';
    progress: number;           // 0-100, upload only
    error: string | null;
    name: string | null;
    kind: 'photo' | 'video' | 'audio' | 'gif';
    previewUrl: string | null;  // blob: for uploads, proxied CDN url for vault
};
```

Entry points: a **paperclip** button (`<input type=file accept="image/*,video/*,audio/*">`),
a **vault** button (modal), and **drag-and-drop** onto the composer (dragover/dragleave/drop
+ a drop overlay). Send is disabled unless `status === 'ready'`.

#### Upload progress needs `XMLHttpRequest`, not `fetch`

`fetch` cannot report upload progress. For a 100MB file a bare spinner is unacceptable, so
the upload call is the one deliberate exception to `lib/onlyfans.ts`'s fetch client: a single
`uploadMedia()` function using `XMLHttpRequest` for `upload.onprogress`. Every other call
stays on `ofApi`'s fetch path. The exception is isolated to that one function.

### 4. Vault modal (`SsVaultModal`)

A full modal (the vault can hold thousands of items): type-filter chips (All/Photo/Gif/Video/
Audio), a thumbnail grid, and load-more.

**Paging is driven by `data.hasMore`** — never `data.nextOffset` (it advances past the end)
and never `_pagination.next_page` (emitted even on the last page). `limit` is capped at 100
by the API. Audio items have `files.thumb: null`, so they render as an icon + duration tile
rather than a broken image.

Selecting an item attaches it as `{source: 'vault', status: 'ready'}` — no upload, no polling.

### 5. Audio player (`SsMessageMedia`)

`SsMessageMedia` renders photo and video only; `OfMedia.type` already includes `'audio'` but
nothing handles it, so inbound audio currently renders as a broken image tile.

Add an `audio` branch: `<audio controls>` fed via the existing media proxy
(`ofApi.mediaUrl()`), because OnlyFans CDN urls are IP-locked to the proxy and 403 in the
browser. Source resolution is `full` (audio has no `videoSources`). Duration renders from
`m.duration` where present. The DRM rules for video are untouched.

### 6. Send + the optimistic bubble

`OnlyFansService::sendMedia($account, $chatId, array $mediaFiles, string $text = '')` joins
`sendText`/`sendGif`; the controller dispatches three ways (media → gif → text). Text is
serialized by the existing `textToOfHtml()` exactly as in part 1 — the media path changes
nothing about text handling. `ppvBlocked()` still rejects any non-zero `price`.

The optimistic bubble previews the local file through a `blob:` object URL using the
**existing `OfMedia.direct` flag** — added in part 1's era for Giphy CDN previews to bypass
the OF media proxy. A `blob:` url is browser-local and must likewise bypass the proxy, so the
mechanism is reused, not reinvented. Object URLs are revoked on send-confirm/remove/unmount.

## Testing

Pest (`Http::fake`), unit where the logic is pure:

- **`uploadMedia`**: posts multipart to `{acct}/media/upload`; body carries `async=true`;
  **asserts NO retry** on failure (a 500 results in exactly ONE request — this is the
  duplicate-media guard and is the most important test in this spec).
- **`getUploadStatus`**: maps `completed` / `failed` (+`error`) / `processing`.
- **`sendMedia`**: posts `mediaFiles`; text serialized via `textToOfHtml`; omits `text` when empty.
- **`listVaultMedia`**: passes `type`/`limit`/`offset`; items normalize through `normalizeMedia`.
- **Controller**: >100MB → 422 (not a 413); a non-media mime → 422; PPV price → 422 (unchanged);
  upload returns `{id, status}`; status route proxies.
- **Frontend**: `types:check` + `lint:check` (no Vue component harness exists in this repo).

## Risks

| Risk | Mitigation |
|---|---|
| **Duplicate billed media** if the upload path ever inherits `client()`'s `retry(3)` | `uploadMedia()` builds its own no-retry request; pinned by a test asserting exactly one request on failure. |
| 100MB through a PHP-FPM worker | `async=true` keeps transcode off the worker (transfer only); timeouts raised to 300s; client-side size validation stops oversized files before transfer. |
| Infra change touches **production** | nginx/php limits require rebuilding `app` + `web` and redeploying. Called out in the plan as an explicit step; nothing takes effect on a running container. |
| Single-use upload id spent by a failed send | Surfaced to the chatter as a failed attachment requiring re-upload; never silently retried. |
| Upload stuck in `processing` forever | Poll cap (60 × 1.5s ≈ 90s) → timeout error, attachment removable. |
| `blob:` preview leaks memory | Object URLs revoked on confirm/remove/unmount. |

## Files

- `app/Services/OnlyFans/OnlyFansService.php` — `uploadMedia` (own no-retry request builder),
  `getUploadStatus`, `listVaultMedia`, `sendMedia`.
- `app/Http/Controllers/OnlyFansChatController.php` — `uploadMedia`, `uploadStatus`,
  `vault` actions; `send` accepts `mediaFiles`.
- `routes/web.php` — `POST media/upload`, `GET media/uploads/{upload}/status`, `GET media/vault`.
- `config/services.php` — `onlyfans.upload_timeout`.
- `resources/js/lib/onlyfans.ts` — `uploadMedia` (XHR + progress), `uploadStatus`, `listVault`.
- `resources/js/components/crm/conversations/SsComposer.vue` — paperclip, vault button,
  drag-drop, attachment preview + progress.
- `resources/js/components/crm/conversations/SsVaultModal.vue` — **new**.
- `resources/js/components/crm/conversations/SsMessageMedia.vue` — `audio` branch.
- `resources/js/types/crm.ts` — `ComposerAttachment`.
- `resources/js/pages/Conversations.vue` — attachment state, optimistic media bubble.
- `docker/nginx/default.conf`, `docker/php/php.ini`, `docker/dev/php-dev.ini` — limits.
- `tests/Feature/OnlyFansChatTest.php`, `tests/Unit/OnlyFansTextTest.php` (or a new unit file).
