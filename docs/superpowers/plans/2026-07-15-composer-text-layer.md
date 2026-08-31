# Composer Text Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `SsComposer` a real chat box — emoji, `**bold**`/`__italic__`, working line breaks, and a send guard — while fixing the three live bugs the spec's validation exposed.

**Architecture:** Four pure string→string functions on `OnlyFansService` carry all the logic (`htmlToText` fixed, `htmlToPreview`/`safeHtml`/`textToOfHtml` new), so they unit-test app-free with no HTTP. Inbound OnlyFans HTML is sanitized **server-side** into a new `html` field beside the existing plain `text`; the outbound draft stays a plain string (the AI generate/accept flow depends on that) and is serialized to OnlyFans' HTML on send.

**Tech Stack:** Laravel 13 / PHP 8.3 · Pest · Vue 3 + TypeScript + Tailwind (`ss-*` tokens) · new dep `symfony/html-sanitizer`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-07-15-composer-text-layer-design.md`. Read it first — its "Live validation" section is the evidence base for every decision here.
- **Send raw `\n`.** OnlyFans converts newlines to `<br />` itself (verified live 2026-07-15). Never emit `<br />` from the client or the serializer.
- **Double markers only.** `**bold**` → `<strong>`, `__italic__` → `<em>`. A single `*` is **never** italic — roleplay asterisks (`*giggles*`) are pervasive in this domain and the engine emits them.
- **`ENT_NOQUOTES`** on the send serializer — escape only `<`, `>`, `&`. Apostrophes stay literal.
- **Never `v-html` unsanitized text.** Sanitizing happens server-side in `safeHtml()`, never in the browser.
- **No media/audio/vault/PPV.** That is part 2. `ppvBlocked()` and `price` are untouched.
- **Nothing new is persisted.** Conversations remains a live proxy with no message text stored.
- Existing conventions: `ss-*` design tokens + `font-ss` (not shadcn tokens), `$fillable` over `$guarded`, `npm run lint:check` and `types:check` must pass.
- **`composer run ci:check` fails on `types:check`** from ~194 pre-existing phpstan errors in unrelated files. That is expected — verify with `php artisan test` and do not try to fix them here.

---

### Task 1: Fix `htmlToText`, add `htmlToPreview`

The read-side bug. `<p>a</p><p>b</p>` currently becomes `"ab"` because `strip_tags` drops `<br>`/`</p>` without substitution and then `/\s+/` → `' '` destroys what newlines remain. This flows into the thread, the chat-list preview, **and the transcript fed to the AI engine**.

**Files:**
- Modify: `app/Services/OnlyFans/OnlyFansService.php:1215-1224` (`htmlToText`), `:653` + `:679` (preview callers)
- Test: `tests/Unit/OnlyFansTextTest.php` (create)

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `OnlyFansService::htmlToText(?string $html): string` — now newline-preserving. `OnlyFansService::htmlToPreview(?string $html): string` — single-line.

- [ ] **Step 1: Write the failing tests**

Create `tests/Unit/OnlyFansTextTest.php`:

```php
<?php

use App\Services\OnlyFans\OnlyFansService;

/**
 * Unit tests for the pure text mappers. Passing both ctor args keeps these app-free
 * (the ctor only reads config() when an arg is null), so they run without booting Laravel.
 */
function textService(): OnlyFansService
{
    return new OnlyFansService('test-key', 'https://app.onlyfansapi.com/api');
}

it('keeps paragraph boundaries as a blank line', function () {
    // Before the fix this returned "line oneline two" — words jammed together.
    expect(textService()->htmlToText('<p>line one</p><p>line two</p>'))
        ->toBe("line one\n\nline two");
});

it('keeps a <br> as a line break', function () {
    expect(textService()->htmlToText('a<br />b'))->toBe("a\nb");
});

it('treats "<br /> + real newline" as ONE break', function () {
    // Exactly what OnlyFans stores when we send "a\nb" (verified live 2026-07-15).
    expect(textService()->htmlToText("a<br />\nb"))->toBe("a\nb");
});

it('caps runs of blank lines at one', function () {
    expect(textService()->htmlToText('a<br /><br /><br /><br />b'))->toBe("a\n\nb");
});

it('decodes html entities', function () {
    expect(textService()->htmlToText('<p>Tom &amp; Jerry &lt;3</p>'))->toBe('Tom & Jerry <3');
});

it('drops anchors but keeps their text', function () {
    expect(textService()->htmlToText('<p>hi</p><p><a href="https://x.com/a">https://x.com/a</a></p>'))
        ->toBe("hi\n\nhttps://x.com/a");
});

it('collapses horizontal whitespace without touching newlines', function () {
    expect(textService()->htmlToText('<p>a   b</p><p>c</p>'))->toBe("a b\n\nc");
});

it('returns an empty string for null and empty input', function () {
    expect(textService()->htmlToText(null))->toBe('');
    expect(textService()->htmlToText(''))->toBe('');
});

it('flattens a preview onto one line', function () {
    // The chat list row is single-line; newlines there would break the layout.
    expect(textService()->htmlToPreview('<p>line one</p><p>line two</p>'))
        ->toBe('line one line two');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker exec ssai-dev-app-1 php artisan test tests/Unit/OnlyFansTextTest.php`
Expected: FAIL — `htmlToPreview` does not exist (`Call to undefined method`), and the paragraph/`<br>` cases return jammed text.

- [ ] **Step 3: Replace `htmlToText` and add `htmlToPreview`**

In `app/Services/OnlyFans/OnlyFansService.php`, replace the existing `htmlToText` method:

```php
    /**
     * Flatten OnlyFans message HTML to plain text, PRESERVING line breaks.
     *
     * OnlyFans stores DM text as HTML (`<p>`, `<br />`, `<a>`, `<span>`), so block
     * boundaries must become newlines BEFORE strip_tags removes them — otherwise
     * `<p>a</p><p>b</p>` collapses to "ab". Only horizontal whitespace is collapsed;
     * `/\s+/` would destroy the newlines we just recovered.
     */
    public function htmlToText(?string $html): string
    {
        if ($html === null || $html === '') {
            return '';
        }

        // `\s*` after the tag absorbs OnlyFans' own "<br />\n" (one break, not two).
        $text = preg_replace('#<br\s*/?>\s*#i', "\n", $html);
        $text = preg_replace('#</p>\s*<p[^>]*>#i', "\n\n", (string) $text);
        $text = preg_replace('#</?p[^>]*>#i', '', (string) $text);

        $text = html_entity_decode(strip_tags((string) $text), ENT_QUOTES | ENT_HTML5, 'UTF-8');

        $text = preg_replace('/[ \t\x{00A0}]+/u', ' ', $text);  // horizontal only — NOT \s+
        $text = preg_replace('/ *\n */', "\n", (string) $text);
        $text = preg_replace('/\n{3,}/', "\n\n", (string) $text);

        return trim((string) $text);
    }

    /** Single-line flattening for the chat-list preview row, which cannot show breaks. */
    public function htmlToPreview(?string $html): string
    {
        return trim((string) preg_replace('/\s+/', ' ', $this->htmlToText($html)));
    }
```

- [ ] **Step 4: Point the preview callers at `htmlToPreview`**

At line ~653 in `normalizeChat`:

```php
            'preview' => $this->htmlToPreview((string) ($lastMessage['text'] ?? '')),
```

At line ~679 in `lastMessageKind`:

```php
        if ($lastMessage === [] || $this->htmlToPreview((string) ($lastMessage['text'] ?? '')) !== '') {
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `docker exec ssai-dev-app-1 php artisan test tests/Unit/OnlyFansTextTest.php`
Expected: PASS — 9 passed.

- [ ] **Step 6: Run the full suite for regressions**

Run: `docker exec ssai-dev-app-1 php artisan test`
Expected: PASS. `normalizeMessage.text` now carries newlines; nothing asserts jammed text.

- [ ] **Step 7: Commit**

```bash
git add app/Services/OnlyFans/OnlyFansService.php tests/Unit/OnlyFansTextTest.php
git commit -m "fix(onlyfans): preserve line breaks when flattening message html

htmlToText() ran strip_tags before <br>/</p> could become newlines, then
collapsed /\s+/ — so <p>a</p><p>b</p> reached the UI as \"ab\". This hit the
thread, the list preview, and the transcript fed to the engine.

Block boundaries now convert to newlines first and only horizontal
whitespace is collapsed. htmlToPreview() keeps the chat-list row single-line.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: `textToOfHtml` — escape + serialize on send

The send-side bug. `sendText()` posts user input unescaped into a field OnlyFans renders as HTML, so `I <3 you` ships a raw `<`. This task fixes that and adds the marker→tag conversion.

**Files:**
- Modify: `app/Services/OnlyFans/OnlyFansService.php:97-116` (`sendText`, `sendGif`)
- Test: `tests/Unit/OnlyFansTextTest.php` (append), `tests/Feature/OnlyFansChatTest.php` (append)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `OnlyFansService::textToOfHtml(string $plain): string` — plain draft → OnlyFans HTML.

- [ ] **Step 1: Write the failing unit tests**

Append to `tests/Unit/OnlyFansTextTest.php`:

```php
it('escapes html-special characters in user text', function () {
    // A chatter typing "I <3 you" was shipping a raw < into a field OF renders as HTML.
    expect(textService()->textToOfHtml('I <3 you'))->toBe('I &lt;3 you');
    expect(textService()->textToOfHtml('Tom & Jerry'))->toBe('Tom &amp; Jerry');
});

it('leaves apostrophes and quotes literal', function () {
    // ENT_NOQUOTES: this is text content, not an attribute value. "it&#039;s" would be noise.
    expect(textService()->textToOfHtml('it\'s a "test"'))->toBe('it\'s a "test"');
});

it('converts **double asterisks** to strong', function () {
    expect(textService()->textToOfHtml('this is **bold** ok'))
        ->toBe('this is <strong>bold</strong> ok');
});

it('converts __double underscores__ to em', function () {
    expect(textService()->textToOfHtml('this is __ital__ ok'))
        ->toBe('this is <em>ital</em> ok');
});

// REGRESSION GUARD. Roleplay asterisks are pervasive in this domain and the legacy
// engine emits them. A single-asterisk italic rule would mangle every one of these.
it('leaves single asterisks alone (roleplay text must survive)', function () {
    expect(textService()->textToOfHtml('*giggles* hey'))->toBe('*giggles* hey');
    expect(textService()->textToOfHtml('*bites lip*'))->toBe('*bites lip*');
});

it('leaves newlines raw for OnlyFans to convert', function () {
    // Verified live: OF turns "a\nb" into "a<br />\nb" itself. We must not send <br />.
    expect(textService()->textToOfHtml("a\nb"))->toBe("a\nb");
});

it('handles markers spanning a newline and mixed markers', function () {
    expect(textService()->textToOfHtml("**two\nlines**"))->toBe("<strong>two\nlines</strong>");
    expect(textService()->textToOfHtml('**a** and __b__'))->toBe('<strong>a</strong> and <em>b</em>');
});

it('escapes before converting markers, so typed tags cannot inject', function () {
    expect(textService()->textToOfHtml('**<script>alert(1)</script>**'))
        ->toBe('<strong>&lt;script&gt;alert(1)&lt;/script&gt;</strong>');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker exec ssai-dev-app-1 php artisan test tests/Unit/OnlyFansTextTest.php`
Expected: FAIL — `Call to undefined method App\Services\OnlyFans\OnlyFansService::textToOfHtml()`.

- [ ] **Step 3: Add `textToOfHtml`**

Add to `app/Services/OnlyFans/OnlyFansService.php` next to `htmlToText`:

```php
    /**
     * Serialize a chatter's plain-text draft into the HTML OnlyFans stores for DMs.
     *
     * Verified live 2026-07-15: OnlyFans stores message text VERBATIM (no sanitizing,
     * no <p> wrapper) and renders it as HTML, and it converts raw "\n" into "<br />"
     * itself — so newlines are left alone here.
     */
    public function textToOfHtml(string $plain): string
    {
        // Escape FIRST, so a typed "<script>" can never survive as markup.
        // ENT_NOQUOTES is deliberate: this is text content, not an attribute value,
        // so apostrophes ("it's", "don't" — everywhere in chat) stay literal.
        $html = htmlspecialchars($plain, ENT_NOQUOTES | ENT_HTML5, 'UTF-8');

        // Double markers ONLY. A single `*` is not italic: roleplay asterisks
        // (*giggles*, *bites lip*) are pervasive here and the engine emits them.
        $html = preg_replace('/\*\*(.+?)\*\*/su', '<strong>$1</strong>', $html);
        $html = preg_replace('/__(.+?)__/su', '<em>$1</em>', (string) $html);

        return (string) $html;
    }
```

- [ ] **Step 4: Run the unit tests to verify they pass**

Run: `docker exec ssai-dev-app-1 php artisan test tests/Unit/OnlyFansTextTest.php`
Expected: PASS — 17 passed.

- [ ] **Step 5: Wire the serializer into both send paths**

In `sendText` (line ~97), serialize the text:

```php
    /** Send a TEXT message. PPV/paid is blocked in v1; callers must not pass a price. */
    public function sendText(string $account, string $chatId, string $text): Response
    {
        $text = trim($text);
        if ($text === '') {
            throw new RuntimeException('OnlyFans send requires non-empty text.');
        }

        return $this->client()->post("{$account}/chats/{$chatId}/messages", [
            'text' => $this->textToOfHtml($text),
        ]);
    }
```

In `sendGif` (line ~108), the optional text needs the same treatment:

```php
    /** Send a Giphy GIF (by its giphy id) to a chat, with optional accompanying text. */
    public function sendGif(string $account, string $chatId, string $giphyId, string $text = ''): Response
    {
        $body = ['giphyId' => $giphyId];
        $text = trim($text);
        if ($text !== '') {
            $body['text'] = $this->textToOfHtml($text);
        }

        return $this->client()->post("{$account}/chats/{$chatId}/messages", $body);
    }
```

- [ ] **Step 6: Write the failing feature test**

Append to `tests/Feature/OnlyFansChatTest.php`:

```php
it('serializes draft markers and escapes html on send', function () {
    Http::fake(['app.onlyfansapi.com/*' => Http::response(['data' => ['id' => 557, 'text' => '', 'fromUser' => ['id' => 999]]])]);

    $this->actingAs(User::factory()->admin()->create())
        ->postJson("/onlyfans/{$this->model->id}/chats/101/messages", ['text' => "I <3 **you**\nreally"])
        ->assertOk();

    // Escaped <, markers converted, newline left raw for OnlyFans to turn into <br />.
    Http::assertSent(fn ($r) => $r->method() === 'POST'
        && str_contains($r->url(), '/acct_cam/chats/101/messages')
        && $r['text'] === "I &lt;3 <strong>you</strong>\nreally");
});
```

- [ ] **Step 7: Run the feature tests**

Run: `docker exec ssai-dev-app-1 php artisan test tests/Feature/OnlyFansChatTest.php`
Expected: PASS. The existing `'sends text to OnlyFans and blocks PPV'` test still passes — `textToOfHtml('hello')` is `'hello'`.

- [ ] **Step 8: Commit**

```bash
git add app/Services/OnlyFans/OnlyFansService.php tests/Unit/OnlyFansTextTest.php tests/Feature/OnlyFansChatTest.php
git commit -m "fix(onlyfans): escape user text and serialize markers on send

sendText/sendGif posted the raw draft into a field OnlyFans renders as
HTML, so \"I <3 you\" shipped a bare <. textToOfHtml() escapes <, >, & (only
those — ENT_NOQUOTES keeps apostrophes literal) then converts **bold** and
__italic__ to <strong>/<em>.

Single asterisks are deliberately NOT italic: roleplay text (*giggles*) is
pervasive here and the engine emits it. Pinned by a regression test.

Newlines stay raw — verified live that OnlyFans converts them to <br />.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Verify bold RENDERS (human visual check — gates Task 7)

The spec's one known-unverified claim. `<strong>` is **stored** byte-identically (verified), but a render-time allowlist could still drop it. **Nobody has seen a bold message in the OnlyFans UI.** This gates whether Task 7 builds the B/I toolbar at all.

**Files:** none — verification only.

**Interfaces:**
- Consumes: `textToOfHtml()` from Task 2.
- Produces: a go/no-go decision for the B/I toolbar in Task 7.

- [ ] **Step 1: Ask the user to nominate a chat and confirm the send**

This sends a real message to a real fan. **Do not pick a chat yourself** — during design, two chats that looked "safe" turned out to be `canSendMessage: false` (muted), and the resulting 400s were briefly misread as OnlyFans rejecting `<strong>`.

Ask the user: *"Task 3 needs one live send to verify bold renders. Which chat should receive it? (Design used `171114800` on `acct_663caec76fae4445a78b48efd7fc6043` — a dormant spam bot.) I'll send it, you look at it in the OnlyFans app, then I delete it."*

- [ ] **Step 2: Send the probe**

Write `/tmp/bold_check.php` (substitute the nominated `$chat`):

```php
<?php

$of = app(\App\Services\OnlyFans\OnlyFansService::class);
$acct = 'acct_663caec76fae4445a78b48efd7fc6043';
$chat = '171114800';

$res = $of->sendText($acct, $chat, 'testing please ignore **bold** and __ital__');
echo 'STATUS: '.$res->status()."\n";
echo 'SENT AS: '.json_encode($of->textToOfHtml('testing please ignore **bold** and __ital__'))."\n";
echo 'MESSAGE ID: '.json_encode($res->json('data.id'))."\n";
echo ">>> Now LOOK at this message in the OnlyFans app/web UI, then run Step 4 to delete it.\n";
```

Run:
```bash
docker cp /tmp/bold_check.php ssai-dev-app-1:/tmp/bold_check.php
docker exec ssai-dev-app-1 php artisan tinker /tmp/bold_check.php
```
Expected: `STATUS: 200` and a message id. A 400 with `"Cannot send message to this user"` means the chat is unsendable (check `canSendMessage`) — it says **nothing** about formatting. Pick another chat.

- [ ] **Step 3: Have the user look at it**

Ask the user to open the chat in the real OnlyFans app or web UI and report which they see:

- **"bold" in bold, "ital" in italics** → OnlyFans renders formatting. Task 7 builds the B/I toolbar as specced.
- **literal `<strong>bold</strong>`** → OnlyFans escapes on render. **Drop the B/I toolbar and the Ctrl+B/I shortcuts from Task 7**, drop `strong/b/em/i/u` from the Task 4 allowlist, and strip the marker conversion from `textToOfHtml` (keep the escaping — that fix stands on its own). Everything else in this plan is unaffected.

- [ ] **Step 4: Delete the probe message**

```bash
docker exec ssai-dev-app-1 php artisan tinker --execute="echo app(\App\Services\OnlyFans\OnlyFansService::class)->deleteMessage('acct_663caec76fae4445a78b48efd7fc6043', '171114800', '<MESSAGE_ID>')->status();"
```
Expected: `200`.

- [ ] **Step 5: Record the outcome in the spec**

Update the spec's §4 "Known-unverified: rendering" to state what was observed, with the date. Commit:

```bash
git add docs/superpowers/specs/2026-07-15-composer-text-layer-design.md
git commit -m "docs(spec): record live result for <strong> rendering

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: `safeHtml` + the `html` field on messages

Inbound OnlyFans HTML is **fan-controlled**, so it is sanitized server-side with an allowlist before the client ever renders it.

**Files:**
- Modify: `composer.json` (add dep), `app/Services/OnlyFans/OnlyFansService.php` (ctor + `normalizeMessage:732-745`)
- Test: `tests/Unit/OnlyFansTextTest.php` (append)

**Interfaces:**
- Consumes: nothing from Tasks 1–3.
- Produces: `OnlyFansService::safeHtml(?string $html): string`; `normalizeMessage()` gains an `html` key beside `text`.

- [ ] **Step 1: Install the sanitizer**

Run: `docker exec ssai-dev-app-1 composer require symfony/html-sanitizer`
Expected: installs (51 Symfony packages are already in the lock via Laravel).

- [ ] **Step 2: Write the failing tests**

Append to `tests/Unit/OnlyFansTextTest.php`:

```php
it('drops script tags AND their contents', function () {
    // "Blocked" would keep the text and leak alert(1) as visible text — must be DROPPED.
    expect(textService()->safeHtml('<p>hi</p><script>alert(1)</script>'))->toBe('<p>hi</p>');
});

it('drops elements outside the allowlist', function () {
    expect(textService()->safeHtml('<img src=x onerror="alert(1)">'))->toBe('');
    expect(textService()->safeHtml('<iframe src="https://evil.test"></iframe>'))->toBe('');
});

it('drops javascript: hrefs but keeps the link text', function () {
    expect(textService()->safeHtml('<a href="javascript:alert(1)">click</a>'))
        ->not->toContain('javascript:')
        ->and(textService()->safeHtml('<a href="javascript:alert(1)">click</a>'))->toContain('click');
});

it('keeps the allowlisted formatting tags', function () {
    expect(textService()->safeHtml('<p>a <strong>b</strong> <em>c</em><br />d</p>'))
        ->toBe('<p>a <strong>b</strong> <em>c</em><br />d</p>');
});

it('hardens allowed anchors', function () {
    $out = textService()->safeHtml('<a href="https://x.com/a">x</a>');
    expect($out)->toContain('href="https://x.com/a"')
        ->and($out)->toContain('rel="noopener noreferrer nofollow"')
        ->and($out)->toContain('target="_blank"');
});

it('returns an empty string for null and empty html', function () {
    expect(textService()->safeHtml(null))->toBe('');
    expect(textService()->safeHtml(''))->toBe('');
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `docker exec ssai-dev-app-1 php artisan test tests/Unit/OnlyFansTextTest.php`
Expected: FAIL — `Call to undefined method ...::safeHtml()`.

- [ ] **Step 4: Add the sanitizer**

Add the imports at the top of `app/Services/OnlyFans/OnlyFansService.php`:

```php
use Symfony\Component\HtmlSanitizer\HtmlSanitizer;
use Symfony\Component\HtmlSanitizer\HtmlSanitizerConfig;
```

Add the property next to the existing ctor properties:

```php
    protected ?HtmlSanitizer $sanitizer = null;
```

Add the methods next to `htmlToText`:

```php
    /**
     * Sanitize OnlyFans-supplied (i.e. FAN-CONTROLLED) message HTML for rendering.
     *
     * The browser renders this with v-html, so the allowlist is the only thing between
     * a fan's message and script execution. Built once and reused — the config walk is
     * not free. Kept container-free so the unit tests stay app-free.
     */
    public function safeHtml(?string $html): string
    {
        if ($html === null || $html === '') {
            return '';
        }

        $this->sanitizer ??= new HtmlSanitizer(
            (new HtmlSanitizerConfig)
                ->allowElement('p')
                ->allowElement('br')
                ->allowElement('strong')
                ->allowElement('b')
                ->allowElement('em')
                ->allowElement('i')
                ->allowElement('u')
                ->allowElement('span')
                ->allowElement('a', ['href'])
                ->allowLinkSchemes(['http', 'https'])
                ->forceAttribute('a', 'target', '_blank')
                ->forceAttribute('a', 'rel', 'noopener noreferrer nofollow')
                // Dropped, not blocked: blocking keeps the text content, which would
                // leak "alert(1)" into the bubble as visible text.
                ->dropElement('script')
                ->dropElement('style')
        );

        return trim($this->sanitizer->sanitize($html));
    }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `docker exec ssai-dev-app-1 php artisan test tests/Unit/OnlyFansTextTest.php`
Expected: PASS — 23 passed. If the anchor or `<br />` assertions differ in exact serialization (e.g. attribute order or `<br>` vs `<br />`), adjust the *expectation* to the sanitizer's real output — do not loosen the allowlist.

- [ ] **Step 6: Add `html` to `normalizeMessage`**

In `normalizeMessage` (line ~735), add the field directly after `text`:

```php
            'text' => $this->htmlToText((string) ($raw['text'] ?? '')),
            // Sanitized for rendering (v-html). `text` stays the plain field used by
            // search, previews, and the AI transcript.
            'html' => $this->safeHtml((string) ($raw['text'] ?? '')),
```

- [ ] **Step 7: Run the full suite**

Run: `docker exec ssai-dev-app-1 php artisan test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add composer.json composer.lock app/Services/OnlyFans/OnlyFansService.php tests/Unit/OnlyFansTextTest.php
git commit -m "feat(onlyfans): sanitize inbound message html for rendering

normalizeMessage now emits a sanitized \`html\` field beside the plain
\`text\`. Fan-controlled HTML is allowlisted server-side (symfony/html-
sanitizer) so the client never sanitizes and never sees raw markup:
p/br/strong/b/em/i/u/span/a[href], http(s) links only, anchors forced to
rel=noopener noreferrer nofollow, script+style dropped with contents.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Surface `canSendReason`

`canSend` is already normalized (line 657) and already on the `OfChat` type — it is simply never used. The reason string next to it is what makes the guard legible ("muted" beats a silent disable).

**Files:**
- Modify: `app/Services/OnlyFans/OnlyFansService.php:657` (`normalizeChat`), `resources/js/types/crm.ts:85`, `resources/js/pages/Conversations.vue:742`
- Test: `tests/Unit/OnlyFansTextTest.php` (append)

**Interfaces:**
- Consumes: nothing.
- Produces: `OfChat.canSendReason: string | null` — consumed by `SsComposer` in Task 7.

- [ ] **Step 1: Write the failing test**

Append to `tests/Unit/OnlyFansTextTest.php`:

```php
it('surfaces why a chat cannot be messaged', function () {
    // Verified live: muted chats come back canSendMessage:false + canNotSendReason:"muted",
    // and sending to one returns 400 "Cannot send message to this user".
    $chat = textService()->normalizeChat([
        'fan' => ['id' => 101, 'name' => 'Jake'],
        'canSendMessage' => false,
        'canNotSendReason' => 'muted',
    ]);

    expect($chat['canSend'])->toBeFalse()
        ->and($chat['canSendReason'])->toBe('muted');
});

it('defaults a sendable chat to canSend with no reason', function () {
    $chat = textService()->normalizeChat(['fan' => ['id' => 101, 'name' => 'Jake']]);

    expect($chat['canSend'])->toBeTrue()
        ->and($chat['canSendReason'])->toBeNull();
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `docker exec ssai-dev-app-1 php artisan test tests/Unit/OnlyFansTextTest.php`
Expected: FAIL — `Undefined array key "canSendReason"`.

- [ ] **Step 3: Add the field**

In `normalizeChat` (line ~657), directly under `canSend`:

```php
            'canSend' => (bool) ($chat['canSendMessage'] ?? true),
            // Why not, when canSend is false (e.g. "muted") — the composer shows this.
            'canSendReason' => $chat['canNotSendReason'] ?? null,
```

- [ ] **Step 4: Add the type**

In `resources/js/types/crm.ts`, in `OfChat` directly under `canSend: boolean;`:

```ts
    canSend: boolean;
    canSendReason: string | null; // why not, when canSend is false (e.g. "muted")
```

- [ ] **Step 5: Fix the fallback chat object**

In `resources/js/pages/Conversations.vue` at line ~742, next to `canSend: true,`:

```ts
        canSend: true,
        canSendReason: null,
```

- [ ] **Step 6: Verify tests and types pass**

Run: `docker exec ssai-dev-app-1 php artisan test tests/Unit/OnlyFansTextTest.php && npm run types:check`
Expected: PASS both.

- [ ] **Step 7: Commit**

```bash
git add app/Services/OnlyFans/OnlyFansService.php resources/js/types/crm.ts resources/js/pages/Conversations.vue tests/Unit/OnlyFansTextTest.php
git commit -m "feat(conversations): surface canSendReason on chats

canSend was normalized and typed but never used. Carry the reason string
alongside it so the composer can say why (e.g. \"muted\") instead of
disabling silently.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: `SsEmojiPicker`

A curated-set popover, modeled on the existing `SsGifPicker` (same trigger/positioning/outside-click/Escape pattern). No dep, no search — chat emoji use is dominated by a small set.

**Files:**
- Create: `resources/js/components/crm/conversations/SsEmojiPicker.vue`

**Interfaces:**
- Consumes: nothing.
- Produces: `SsEmojiPicker` — props: none. Emits: `select: [emoji: string]`, `close: []`. Consumed by `SsComposer` in Task 7.

- [ ] **Step 1: Create the component**

Create `resources/js/components/crm/conversations/SsEmojiPicker.vue`:

```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

const emit = defineEmits<{ select: [emoji: string]; close: [] }>();

const root = ref<HTMLElement | null>(null);

/**
 * A curated set, not the full Unicode table: chat emoji use is dominated by a
 * small tail and a hand-rolled list keeps this dep-free and on the ss-* tokens.
 */
const CATEGORIES: { name: string; emoji: string[] }[] = [
    {
        name: 'Smileys',
        emoji: [
            '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
            '😉', '😊', '😇', '😌', '😋', '😛', '😜', '🤪', '😝', '🤗',
            '🤭', '🤫', '🤔', '🤐', '😐', '😑', '😶', '😏', '😒', '🙄',
            '😬', '😮', '😯', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤠',
        ],
    },
    {
        name: 'Flirty',
        emoji: [
            '😍', '🥰', '😘', '😗', '😚', '😙', '🥲', '😻', '💋', '💌',
            '💘', '💝', '💖', '💗', '💓', '💞', '💕', '❤️', '🧡', '💛',
            '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💟', '🥵',
            '🫦', '👀', '😈', '👿', '🔥', '💦', '🍑', '🍆', '👅', '👄',
        ],
    },
    {
        name: 'Feelings',
        emoji: [
            '😔', '😟', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢',
            '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥶', '😱', '😨',
            '😰', '😥', '😓', '🤥', '🫠', '🫥', '😶‍🌫️', '😮‍💨', '🤧', '🤒',
            '🤕', '🤢', '🤮', '🥴', '😷', '🤨', '🧐', '🤓', '😎', '🥸',
        ],
    },
    {
        name: 'Hands',
        emoji: [
            '👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘',
            '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐', '🖖',
            '👋', '🤝', '🙏', '💪', '🦵', '🦶', '👏', '🙌', '👐', '🤲',
            '🫶', '🤛', '🤜', '✊', '👊', '🫵', '💅', '🤳', '💃', '🕺',
        ],
    },
    {
        name: 'Fun',
        emoji: [
            '🎉', '🎊', '🥳', '🎁', '🎈', '🍾', '🥂', '🍻', '🍷', '🍸',
            '🍹', '🍺', '☕', '🍕', '🍔', '🍟', '🌮', '🍿', '🍫', '🍭',
            '🍩', '🍪', '🎂', '🧁', '🍓', '🍒', '🍌', '🍦', '🎵', '🎶',
            '✨', '⭐', '🌟', '💫', '💥', '🌊', '🌈', '☀️', '🌙', '⚡',
        ],
    },
    {
        name: 'Things',
        emoji: [
            '📱', '💻', '⌚', '📷', '🎥', '🎬', '🎮', '🕹️', '🎧', '🎤',
            '💰', '💵', '💸', '💳', '🎁', '📦', '✉️', '📩', '🔒', '🔓',
            '🔑', '⏰', '⏳', '📅', '✅', '❌', '❓', '❗', '💤', '🚀',
            '🏆', '🥇', '🎯', '🎰', '🧸', '👑', '💎', '🌹', '🌺', '🦋',
        ],
    },
];

function onDocClick(e: MouseEvent) {
    if (root.value && !root.value.contains(e.target as Node)) {
        emit('close');
    }
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        emit('close');
    }
}

onMounted(() => {
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocClick);
    window.removeEventListener('keydown', onKey);
});
</script>

<template>
    <div
        ref="root"
        class="absolute right-0 bottom-full z-30 mb-2 max-h-72 w-80 overflow-y-auto rounded-xl border border-ss-border bg-ss-surface p-2 shadow-xl"
    >
        <div v-for="cat in CATEGORIES" :key="cat.name" class="mb-2 last:mb-0">
            <p
                class="px-1 pb-1 text-[10px] font-semibold tracking-wide text-ss-text-3 uppercase"
            >
                {{ cat.name }}
            </p>
            <div class="grid grid-cols-10 gap-0.5">
                <button
                    v-for="e in cat.emoji"
                    :key="e"
                    type="button"
                    class="grid h-7 w-7 place-items-center rounded text-[16px] hover:bg-ss-surface-2"
                    :title="e"
                    @click="emit('select', e)"
                >
                    {{ e }}
                </button>
            </div>
        </div>
    </div>
</template>
```

- [ ] **Step 2: Verify it compiles and lints**

Run: `npm run types:check && npm run lint:check`
Expected: PASS both.

- [ ] **Step 3: Commit**

```bash
git add resources/js/components/crm/conversations/SsEmojiPicker.vue
git commit -m "feat(conversations): add SsEmojiPicker

A curated ~240-emoji popover in six categories, modeled on SsGifPicker
(same trigger/outside-click/Escape pattern, ss-* tokens). Dep-free and
searchless by design — chat emoji use is a short tail.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: `SsComposer` — toolbar, shortcuts, Enter-to-send, emoji, canSend guard

**If Task 3 found that OnlyFans renders `<strong>` literally, drop the B/I buttons and the Ctrl+B/I handlers from this task** — everything else here stands.

**Files:**
- Modify: `resources/js/components/crm/conversations/SsComposer.vue`, `resources/js/pages/Conversations.vue:844-860`

**Interfaces:**
- Consumes: `SsEmojiPicker` (Task 6); `OfChat.canSendReason` (Task 5); `textToOfHtml`'s marker contract (Task 2) — the toolbar inserts `**`/`__`, the server converts them.
- Produces: `SsComposer` gains props `canSend: boolean`, `canSendReason: string | null`.

- [ ] **Step 1: Add the props, refs, and editing helpers**

In `resources/js/components/crm/conversations/SsComposer.vue`, replace the `<script setup>` block's imports/props/emits and add the helpers:

```ts
import { Bold, Check, Italic, RefreshCw, Send, Smile, Sparkles, X } from '@lucide/vue';
import { computed, nextTick, ref } from 'vue';
import type { OfGif } from '@/types/crm';
import SsEmojiPicker from './SsEmojiPicker.vue';
import SsGifPicker from './SsGifPicker.vue';

const props = defineProps<{
    creator: string;
    modelId: number;
    draft: string;
    suggestion: string | null;
    attachedGif: OfGif | null;
    generating: boolean;
    sending: boolean;
    error: string | null;
    canSend: boolean;
    canSendReason: string | null;
}>();

const emit = defineEmits<{
    'update:draft': [value: string];
    'update:attachedGif': [value: OfGif | null];
    generate: [];
    send: [];
    accept: [];
    'accept-send': [];
    dismiss: [];
}>();

const showPicker = ref(false);
const showEmoji = ref(false);
const textarea = ref<HTMLTextAreaElement | null>(null);

const sendable = computed(
    () =>
        props.canSend &&
        !props.sending &&
        (props.draft.trim().length > 0 || props.attachedGif !== null),
);

function onInput(e: Event) {
    emit('update:draft', (e.target as HTMLTextAreaElement).value);
}

function pickGif(gif: OfGif) {
    emit('update:attachedGif', gif);
    showPicker.value = false;
}

/** Replace the current selection (or insert at the caret), then restore focus + caret. */
function replaceSelection(build: (selected: string) => string, caretFor: (start: number, end: number, selected: string) => number) {
    const el = textarea.value;
    if (!el) {
        return;
    }

    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = props.draft.slice(start, end);

    emit('update:draft', props.draft.slice(0, start) + build(selected) + props.draft.slice(end));

    nextTick(() => {
        el.focus();
        const caret = caretFor(start, end, selected);
        el.setSelectionRange(caret, caret);
    });
}

/** Wrap the selection in a marker pair. The server converts ** → strong, __ → em. */
function surround(marker: string) {
    replaceSelection(
        (selected) => `${marker}${selected}${marker}`,
        // Selection wrapped: caret after it. Nothing selected: caret between the markers.
        (start, end, selected) => (selected ? end + marker.length * 2 : start + marker.length),
    );
}

function insertEmoji(emoji: string) {
    showEmoji.value = false;
    replaceSelection(
        () => emoji,
        (start) => start + emoji.length,
    );
}

function onKeydown(e: KeyboardEvent) {
    // isComposing guards IME/emoji input — Enter commits the composition, it must not send.
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        if (sendable.value) {
            emit('send');
        }
        return;
    }

    if (!(e.metaKey || e.ctrlKey)) {
        return;
    }

    if (e.key.toLowerCase() === 'b') {
        e.preventDefault();
        surround('**');
    } else if (e.key.toLowerCase() === 'i') {
        e.preventDefault();
        surround('__');
    }
}
```

- [ ] **Step 2: Replace the typing bar markup**

Replace the `<!-- Typing bar -->` block (through the closing `</div>` of the flex row) in the template:

```vue
        <!-- Can't-send notice (e.g. a muted fan): OnlyFans would 400 the send. -->
        <p v-if="!props.canSend" class="text-[11px] text-ss-text-3">
            Can't send to this chat{{
                props.canSendReason ? ` — ${props.canSendReason}` : ''
            }}
        </p>

        <!-- Typing bar -->
        <div class="flex items-end gap-2">
            <button
                type="button"
                :disabled="props.generating"
                class="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-ss-border text-ss-accent-text hover:bg-ss-surface-2 disabled:opacity-50"
                title="Generate an AI draft"
                @click="emit('generate')"
            >
                <Sparkles
                    :size="16"
                    :class="props.generating ? 'animate-pulse' : ''"
                />
            </button>

            <div class="flex flex-1 flex-col gap-1">
                <!-- Formatting toolbar: inserts markers the server converts on send. -->
                <div class="flex items-center gap-0.5">
                    <button
                        type="button"
                        :disabled="!props.canSend"
                        class="grid h-6 w-6 place-items-center rounded text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text-2 disabled:opacity-40"
                        title="Bold (Ctrl+B)"
                        @click="surround('**')"
                    >
                        <Bold :size="13" />
                    </button>
                    <button
                        type="button"
                        :disabled="!props.canSend"
                        class="grid h-6 w-6 place-items-center rounded text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text-2 disabled:opacity-40"
                        title="Italic (Ctrl+I)"
                        @click="surround('__')"
                    >
                        <Italic :size="13" />
                    </button>
                </div>

                <textarea
                    ref="textarea"
                    :value="props.draft"
                    :disabled="!props.canSend"
                    rows="1"
                    :placeholder="
                        props.canSend
                            ? 'Type a message… (Enter sends, Shift+Enter for a new line)'
                            : 'Sending is disabled for this chat'
                    "
                    class="max-h-32 min-h-9 w-full resize-none rounded-lg border border-ss-border bg-ss-surface px-3 py-2 text-[14px] text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none disabled:opacity-50"
                    @input="onInput"
                    @keydown="onKeydown"
                />
            </div>

            <!-- Emoji picker -->
            <div class="relative shrink-0">
                <button
                    type="button"
                    :disabled="!props.canSend"
                    class="grid h-9 w-9 place-items-center rounded-lg border transition-colors disabled:opacity-40"
                    :class="
                        showEmoji
                            ? 'border-ss-accent bg-ss-accent-soft text-ss-accent-text'
                            : 'border-ss-border text-ss-text-2 hover:bg-ss-surface-2'
                    "
                    title="Insert an emoji"
                    @click="showEmoji = !showEmoji"
                >
                    <Smile :size="16" />
                </button>
                <SsEmojiPicker
                    v-if="showEmoji"
                    @select="insertEmoji"
                    @close="showEmoji = false"
                />
            </div>

            <!-- GIF picker -->
            <div class="relative shrink-0">
                <button
                    type="button"
                    :disabled="!props.canSend"
                    class="grid h-9 w-11 place-items-center rounded-lg border text-[12px] font-bold transition-colors disabled:opacity-40"
                    :class="
                        showPicker
                            ? 'border-ss-accent bg-ss-accent-soft text-ss-accent-text'
                            : 'border-ss-border text-ss-text-2 hover:bg-ss-surface-2'
                    "
                    title="Send a GIF"
                    @click="showPicker = !showPicker"
                >
                    GIF
                </button>
                <SsGifPicker
                    v-if="showPicker"
                    :model-id="props.modelId"
                    @select="pickGif"
                    @close="showPicker = false"
                />
            </div>

            <button
                type="button"
                :disabled="!sendable"
                class="flex shrink-0 items-center gap-1.5 rounded-lg bg-ss-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                @click="emit('send')"
            >
                <Send :size="14" /> {{ props.sending ? 'Sending…' : 'Send' }}
            </button>
        </div>
```

- [ ] **Step 3: Gate "Accept & Send" on canSend too**

In the AI suggestion card, the Accept & Send button must respect the same guard. Change its `:disabled`:

```vue
                        :disabled="props.sending || !props.canSend"
```

- [ ] **Step 4: Pass the new props from the page**

In `resources/js/pages/Conversations.vue` at the `<SsComposer` usage (line ~844), add two props after `:error="cur.error"`:

```vue
                        :can-send="selected?.canSend ?? true"
                        :can-send-reason="selected?.canSendReason ?? null"
```

- [ ] **Step 5: Verify types and lint**

Run: `npm run types:check && npm run lint:check`
Expected: PASS both.

- [ ] **Step 6: Commit**

```bash
git add resources/js/components/crm/conversations/SsComposer.vue resources/js/pages/Conversations.vue
git commit -m "feat(conversations): advanced composer text controls

Emoji picker, **bold**/__italic__ toolbar + Ctrl+B/I, Enter-to-send with
Shift+Enter for a newline, and a canSend guard that disables the box with
the reason (e.g. \"muted\") instead of letting a chatter write a full
message into an opaque 400.

Enter-to-send is a behavior change: Enter previously inserted a newline
and only the button sent. isComposing guards IME/emoji input.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Render message HTML in the thread

**Files:**
- Modify: `resources/js/components/crm/conversations/SsChatThread.vue:583-594`, `resources/js/types/crm.ts` (`OfMessage`)

**Interfaces:**
- Consumes: `normalizeMessage.html` (Task 4).
- Produces: nothing downstream.

- [ ] **Step 1: Add the type**

In `resources/js/types/crm.ts`, in `OfMessage` directly under the `text` field:

```ts
    html?: string | null; // sanitized server-side for v-html; absent on optimistic bubbles
```

- [ ] **Step 2: Render it**

In `resources/js/components/crm/conversations/SsChatThread.vue`, replace the `<span v-if="m.text">{{ m.text }}</span>` line (~583) and keep the two fallbacks that follow it:

```vue
                        <!--
                          v-html is safe here: `html` is allowlist-sanitized server-side
                          (OnlyFansService::safeHtml). Deliberately NOT whitespace-pre-wrap —
                          OF's html carries "<br />\n", so pre-wrap would double every break.
                        -->
                        <div
                            v-if="m.html"
                            class="[&>p]:mb-2 [&>p:last-child]:mb-0 [&_a]:underline"
                            v-html="m.html"
                        />
                        <!-- Optimistic bubbles have no html yet: plain text, breaks via pre-wrap. -->
                        <span
                            v-else-if="m.text"
                            class="whitespace-pre-wrap"
                            >{{ m.text }}</span
                        >
```

- [ ] **Step 3: Verify types and lint**

Run: `npm run types:check && npm run lint:check`
Expected: PASS. ESLint may flag `vue/no-v-html` — if it does, add an inline disable comment above the `<div>` referencing the server-side sanitizer; do **not** disable the rule globally.

- [ ] **Step 4: Verify the whole flow in the running app**

The dev stack is already up (`ssai-dev-*`). Open `/conversations?creator=test` and confirm:

1. A multi-paragraph inbound message renders as **separate lines**, not `"line oneline two"`.
2. The chat-list preview for that same message stays on **one line**.
3. Typing `**bold** and __ital__` + Enter sends and the bubble renders formatted (skip the formatting half if Task 3 said OnlyFans renders literally).
4. Shift+Enter inserts a newline instead of sending.
5. The emoji picker inserts at the caret, not at the end.
6. A muted chat (`535406053` / `567427648` on the `test` creator) shows the disabled box + "Can't send to this chat — muted".

- [ ] **Step 5: Run the full suite**

Run: `docker exec ssai-dev-app-1 php artisan test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add resources/js/components/crm/conversations/SsChatThread.vue resources/js/types/crm.ts
git commit -m "feat(conversations): render message html in the thread

Bubbles render the server-sanitized \`html\` field, so paragraphs, line
breaks, and links from OnlyFans finally display instead of collapsing into
run-on text. No pre-wrap on that path — OF's html carries \"<br />\n\" and
pre-wrap would double every break. Optimistic bubbles keep the plain-text
path with pre-wrap until the server confirms.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Plan self-review

**Spec coverage:** `htmlToText` fix → Task 1. `htmlToPreview` → Task 1. `textToOfHtml` + escaping + double-marker rule → Task 2. Rendering risk mitigation → Task 3. `safeHtml` + dep + `normalizeMessage.html` → Task 4. `canSendReason` → Task 5. `SsEmojiPicker` → Task 6. Toolbar/shortcuts/Enter-to-send/emoji/canSend guard → Task 7. `v-html` bubble + `OfMessage.html` + optimistic fallback → Task 8. Every "Files" entry in the spec is covered.

**Type consistency:** `htmlToText`/`htmlToPreview`/`safeHtml`/`textToOfHtml` keep identical signatures across Tasks 1–4 and their call sites. `canSendReason` is `string | null` in PHP (Task 5), TS (Task 5), and the `SsComposer` prop (Task 7). `OfMessage.html` is `string | null | undefined` (Task 8) which matches Task 4 emitting a plain string and the optimistic bubble omitting it.

**Deviations from the spec, called out:** the spec says "~300–500 emoji"; Task 6 curates ~240, which covers the categories the spec named without padding the list for its own sake.
