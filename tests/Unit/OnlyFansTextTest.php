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

it('treats an attributed <br> as a line break', function () {
    expect(textService()->htmlToText('a<br class="x">b'))->toBe("a\nb");
});
