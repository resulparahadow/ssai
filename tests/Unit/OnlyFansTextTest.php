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
