# Advanced composer, part 1: the text layer — design

**Date:** 2026-07-15
**Status:** approved (pending spec review)
**Area:** Conversations (live OnlyFans proxy) — `SsComposer` + message text normalization

## Goal

Make the chat box a real chatting surface: **emoji**, **text formatting**, honest
**line breaks**, and a send guard that respects what OnlyFans will actually accept.

Along the way this fixes three live bugs that the live validation below exposed:

1. **Multi-line messages render as run-on text.** `htmlToText()` turns
   `<p>line one</p><p>line two</p>` into `"line oneline two"` — words jammed
   together. This hits the thread, the chat-list preview, **and the transcript fed
   to the AI engine**.
2. **User text is sent unescaped into an HTML field.** A chatter typing `I <3 you`
   ships a raw `<` into a field OnlyFans renders as HTML.
3. **`canSend` is normalized but never used.** `normalizeChat` already emits it
   (`OnlyFansService` line 657) and `OfChat` already types it, yet the composer
   lets a chatter write a full message to an unsendable chat and eat an opaque 400.

**Media/audio attachment is deliberately NOT in this spec** — it is part 2 (see
Non-goals). This part ships the text layer only.

## Non-goals

- **Media / audio / vault attachment** — part 2 (`media/upload`, `media/vault`,
  `mediaFiles[]`, an audio player for the thread). Independent of this spec.
- **PPV / paid sends.** `ppvBlocked()` stays as-is; `price` is untouched.
- **Rich-text WYSIWYG.** The draft stays a plain string (the AI generate/accept
  flow depends on that contract).
- **URL auto-linking on send.** Verified below: OnlyFans does *not* linkify what we
  send. Emitting anchors ourselves is possible but out of scope.
- **`replyToMessageId` / `lockedText` / `previews[]`** — documented, unbuilt.
- Persisting anything. Conversations still stores no message text.

## Live validation (2026-07-15, account `acct_663caec76fae4445a78b48efd7fc6043`)

Per the read-spec-first rule, every claim below is either from the OpenAPI yaml
`paths:` or from a live call. **Nothing here is inferred from a fake.**

### 1. Read-only history scan — what OnlyFans DM text actually contains

38 real messages across 8 chats. Distinct tags found:

| Tag | Count |
|---|---|
| `<p>` / `</p>` | 43 |
| `<a href="…">` / `</a>` | 9 |
| `<br />` | 5 |
| `<span>` / `</span>` | 3 |

**No `<strong>`, `<em>`, `<b>`, `<i>`, or `<u>` in any real message.** OnlyFans DM
text is HTML. Since fans plainly do not see literal `<p>` tags, **OnlyFans renders
stored text as HTML** — this is the load-bearing inference behind the whole design.

### 2. Send probes (one message each, read back raw, then deleted)

| Sent | Status | Stored by OnlyFans |
|---|---|---|
| `"testing please ignore\nsecond line"` | **200** | `"testing please ignore<br />\nsecond line"` |
| `"… <strong>bold</strong> <em>ital</em> https://example.com"` | **200** | byte-identical to what was sent |

Conclusions, each load-bearing:

- **Newlines: send raw `\n`.** OnlyFans converts them to `<br />` itself. The client
  must NOT emit `<br />`.
- **OnlyFans stores text verbatim.** No `<p>` wrapper added, no sanitizing. The `<p>`
  shapes in history come from OnlyFans' own web composer, not from normalization.
- **`<strong>`/`<em>` are accepted and persisted intact** — not rejected, not stripped.
- **Bare URLs are NOT auto-linked.** `https://example.com` stayed bare. The anchors in
  real history were linkified by OnlyFans' web composer client-side.

### 3. `canSendMessage` is real and accurate

The chat list carries `canSendMessage` + `canNotSendReason`. Two chats on this
account are `false` / `"muted"`, and sending to one returns
`400 {"error":{"code":0,"message":"Cannot send message to this user"}}`.

### 4. Known-unverified: rendering

Storage of `<strong>` is **verified**; **rendering is not**. OnlyFans could still drop
unknown tags behind a render-time allowlist. Given `<p>`/`<a>`/`<span>` demonstrably
render, `<strong>` almost certainly does — but it is an inference, and the
implementation plan MUST include a human visual check (§Risks) before bold/italic is
considered done.

> A cautionary note for the implementer: during design, two `400`s were briefly
> misread as "OnlyFans rejects `<strong>`". They were the *muted recipient*. Check
> `canSendMessage` before attributing any send failure to message content.

## Design

### Backend — `OnlyFansService`, four pure functions

All four are pure string→string and unit-testable without HTTP.

#### `htmlToText(?string $html): string` — fixed

Convert block boundaries to newlines **before** `strip_tags` removes them, then
collapse only *horizontal* whitespace (today's `/\s+/` → `' '` is what destroys the
line breaks):

1. `<br>` / `<br/>` / `<br />` → `"\n"`
2. `</p>\s*<p…>` → `"\n\n"`; remaining `<p>`/`</p>` → `""`
3. `strip_tags` + `html_entity_decode`
4. collapse `[ \t\x{00A0}]+` → `" "` (**not** `\s+`)
5. cap `\n{3,}` → `"\n\n"`; trim spaces around newlines; `trim()`

| Input | Before | After |
|---|---|---|
| `<p>a</p><p>b</p>` | `"ab"` | `"a\n\nb"` |
| `a<br /><br />b` | `"ab"` | `"a\n\nb"` |
| `a<br />\nb` | `"a b"` | `"a\nb"` |

Consumers: `normalizeMessage.text` (line 735), `buildTranscript` (line 1184 → the
engine). The engine gets strictly better input; no engine change.

#### `htmlToPreview(?string $html): string` — new

`htmlToText()` with newlines flattened to spaces. The chat-list preview must stay
one line. Callers: lines 653 and 679 only.

#### `safeHtml(?string $html): string` — new

Sanitize OnlyFans-supplied (i.e. **fan-controlled**) HTML for rendering.

- **Dep:** `symfony/html-sanitizer` (new; 51 Symfony packages already in the lock via
  Laravel). Hand-rolling a sanitizer for hostile input is not acceptable here.
- **Allowlist:** `p, br, strong, b, em, i, u, span, a[href]`. Everything else dropped.
- **Anchors:** `http`/`https` only; force `rel="noopener noreferrer nofollow"` +
  `target="_blank"`.
- Built **once** (singleton/constructor), not per call.

`normalizeMessage` gains `'html' => $this->safeHtml($raw['text'] ?? '')` **alongside**
the existing `'text'`. `text` stays the plain-text field for search, previews, and the
AI; `html` is for rendering only.

#### `textToOfHtml(string $plain): string` — new

The send serializer. Order matters:

1. `htmlspecialchars($plain, ENT_NOQUOTES | ENT_HTML5, 'UTF-8')` — escapes `<`, `>`,
   `&` and **nothing else**. `ENT_NOQUOTES` is deliberate: this produces text content,
   not attribute values, so apostrophes (ubiquitous in chat: `it's`, `don't`) stay
   literal instead of becoming `&#039;`.
2. `**bold**` → `<strong>…</strong>`
3. `__italic__` → `<em>…</em>`
4. **Newlines left raw** — OnlyFans converts them to `<br />` (verified §2).

**Double markers only — single `*` is NOT italic.** Roleplay asterisks (`*giggles*`,
`*bites lip*`) are pervasive in this domain and the legacy engine emits them; a
single-asterisk rule would silently mangle every one into `<em>`. A regression test
pins `*giggles*` as untouched.

Called by **both** `sendText()` and `sendGif()` (both carry `text`).

#### `normalizeChat` — one field

Add `'canSendReason' => $chat['canNotSendReason'] ?? null` next to the existing
`canSend` (line 657). `OfChat` gains `canSendReason: string | null`.

### Frontend

#### `SsChatThread` — render HTML

The bubble becomes `v-html="m.html"` with paragraph spacing
(`[&>p]:mb-2 [&>p:last-child]:mb-0`).

**No `whitespace-pre-wrap` on the html path.** OnlyFans' HTML already carries
`<br />` *and* a literal `\n` (`"a<br />\nb"`); pre-wrap would render both and double
every line break. Normal HTML flow collapses the stray `\n` correctly.

**Optimistic bubbles** are built client-side from the draft and have no `html` yet, so
they fall back to `{{ m.text }}` **with** `whitespace-pre-wrap` until the server
confirms. `OfMessage.html` is therefore `string | null`.

`m.text` remains the field used by the existing in-thread search (line 76).

#### `SsComposer` — the chat box

- **Formatting toolbar:** `B` / `I` buttons wrap the current textarea selection in
  `**` / `__` (or insert the marker pair at the cursor when nothing is selected).
- **Shortcuts:** Ctrl/Cmd+B, Ctrl/Cmd+I.
- **Enter sends; Shift+Enter inserts a newline.** This is a behavior change — Enter
  currently inserts a newline and only the button sends — and is the chat convention
  (Slack/WhatsApp/OnlyFans itself). The Send button stays.
- **No live formatting preview.** Markers stay visible in the draft (YAGNI).
- **`canSend` guard:** when `chat.canSend === false`, disable the textarea, the
  toolbar, and Send, and show `canSendReason` (e.g. "Can't send: muted") in place of
  the placeholder.

#### `SsEmojiPicker` — new

A popover modeled directly on the existing `SsGifPicker` (same trigger/positioning/
close-on-outside-click pattern), styled with `ss-*` tokens.

- A **curated set** of ~300–500 common + flirty emoji grouped into a handful of
  categories. No search, no skin tones, no dep.
- Inserts at the cursor position, preserves focus, and updates the draft through the
  existing `update:draft` emit.

### Data flow

```
FAN → OnlyFans HTML ──normalizeMessage──┬── text  (htmlToText)  → search · AI engine
                                        └── html  (safeHtml)    → v-html in the bubble

CHATTER → plain draft (**bold**, __ital__, \n, emoji)
        → textToOfHtml (escape → markers → tags; \n kept raw)
        → POST messages  → OnlyFans converts \n to <br />
```

## Testing

Pest, unit-level on the pure functions (no HTTP needed):

- **`htmlToText`**: the three table rows above; entity decode; `null`/`''`.
- **`htmlToPreview`**: multi-paragraph input yields a single line.
- **`textToOfHtml`**: `I <3 you` → `I &lt;3 you`; `**b**` → `<strong>b</strong>`;
  `__i__` → `<em>i</em>`; **`*giggles*` unchanged** (regression guard); `it's`
  keeps its apostrophe; combined markers + newlines.
- **`safeHtml`**: `<script>` dropped; `<img onerror=…>` dropped; `javascript:` href
  dropped; allowlisted tags survive; anchor gets `rel`.
- **`normalizeChat`**: `canSend` / `canSendReason` mapping.
- **Feature**: `send` posts the serialized HTML (`Http::fake` body assertion).

> On fakes: the memory rule warns that `Http::fake` cannot catch a wrong-field
> assumption, because the fake encodes the same guess as the code. That risk is
> retired here — every assertion above encodes a **live-verified** shape (§Live
> validation), not a guess.

## Risks

| Risk | Mitigation |
|---|---|
| **Bold/italic rendering unverified** (storage verified, rendering inferred) | Implementation plan includes a human visual check: send one `**bold**` message to a nominated chat, look at it in the real OnlyFans app, then delete. If OnlyFans renders it literally, drop the B/I toolbar — the rest of the spec is unaffected. |
| Escaping changes what every send posts | Blast radius reduced by `ENT_NOQUOTES` (only `<`, `>`, `&`). Bare `&` and `&amp;` both render as `&`; escaping `<` **fixes** the `I <3 you` bug rather than causing one. |
| `symfony/html-sanitizer` is a new dep | Well-maintained first-party Symfony component; the alternative (hand-rolled sanitizer for fan-controlled input) is worse. |
| Enter-to-send retrains existing chatters | Deliberate, chosen over a preference toggle. Shift+Enter is the standard escape hatch. |
| `v-html` on fan-controlled text | Sanitized **server-side** with an allowlist; the client never sanitizes. |

## Files

- `app/Services/OnlyFans/OnlyFansService.php` — `htmlToText` (fix), `htmlToPreview`,
  `safeHtml`, `textToOfHtml` (new); `normalizeMessage` (+`html`), `normalizeChat`
  (+`canSendReason`), `sendText`/`sendGif` (serialize).
- `resources/js/components/crm/conversations/SsComposer.vue` — toolbar, shortcuts,
  Enter-to-send, emoji trigger, canSend guard.
- `resources/js/components/crm/conversations/SsEmojiPicker.vue` — **new**.
- `resources/js/components/crm/conversations/SsChatThread.vue` — `v-html` bubble.
- `resources/js/types/crm.ts` — `OfMessage.html`, `OfChat.canSendReason`.
- `tests/Feature/OnlyFansChatTest.php` (+ a unit test file for the pure functions).
- `composer.json` — `symfony/html-sanitizer`.
