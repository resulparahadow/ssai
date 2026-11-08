// RED→GREEN check for resources/js/lib/ppvComposer.ts (no TS unit runner in this repo).
// Run: node --experimental-strip-types tests/client/ppv-composer-check.mjs
import assert from 'node:assert/strict';
const mod = await import('../../resources/js/lib/ppvComposer.ts');
const { parsePpvPriceInput, suggestionStillApplies, composerDirty } = mod;

// #1 — an empty/junk edit reverts to the previous price; 0 must be typed on purpose.
assert.equal(parsePpvPriceInput('', 20), 20, 'empty → previous');
assert.equal(parsePpvPriceInput('   ', 20), 20, 'blank → previous');
assert.equal(parsePpvPriceInput('abc', 20), 20, 'junk → previous');
assert.equal(parsePpvPriceInput('0', 20), 0, 'explicit 0 → free');
assert.equal(parsePpvPriceInput(0, 20), 0, 'numeric 0 (v-model cast) → free');
assert.equal(parsePpvPriceInput('$25', 20), 25, 'strips $');
assert.equal(parsePpvPriceInput(25.5, 20), 25.5, 'numeric passthrough');
assert.equal(
    parsePpvPriceInput('2', 20),
    2,
    'out-of-rule values pass through (validation disables Send)',
);

// #3 — a draft belongs to the mode/set it was generated for.
assert.equal(
    suggestionStillApplies(null, null),
    true,
    'reply generated, no set loaded now',
);
assert.equal(
    suggestionStillApplies(null, 7),
    false,
    'reply generated, set loaded meanwhile → drop',
);
assert.equal(
    suggestionStillApplies(7, 7),
    true,
    'caption for set 7, still set 7',
);
assert.equal(
    suggestionStillApplies(7, 9),
    false,
    'caption for set 7, set 9 loaded now → drop',
);
assert.equal(
    suggestionStillApplies(7, null),
    false,
    'caption for set 7, set removed → drop',
);

// #3 — loading a set while a generate is in flight counts as dirty.
const base = {
    draft: '',
    suggestion: null,
    gif: null,
    attachment: null,
    ppv: null,
    generating: false,
};
assert.equal(composerDirty(base), false, 'empty composer is clean');
assert.equal(
    composerDirty({ ...base, generating: true }),
    true,
    'in-flight generate is dirty',
);
assert.equal(composerDirty({ ...base, draft: ' hi ' }), true, 'text is dirty');
assert.equal(
    composerDirty({ ...base, suggestion: 'x' }),
    true,
    'suggestion is dirty',
);
assert.equal(
    composerDirty({ ...base, ppv: { setId: 1 } }),
    true,
    'a loaded set is dirty',
);

console.log(
    '✓ ppv-composer-check: price edits, suggestion ownership, dirty check',
);
