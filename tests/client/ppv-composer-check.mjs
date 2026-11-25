// RED→GREEN check for resources/js/lib/ppvComposer.ts (no TS unit runner in this repo).
// Run: node --experimental-strip-types tests/client/ppv-composer-check.mjs
import assert from 'node:assert/strict';
const mod = await import('../../resources/js/lib/ppvComposer.ts');
const {
    parsePpvPriceInput,
    suggestionStillApplies,
    composerDirty,
    ppvMediaCounts,
    humanPlan,
    priceSuggestionView,
} = mod;

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

// #3 — a draft belongs to the mode/step it was generated for (captionStepId values).
assert.equal(
    suggestionStillApplies(null, null),
    true,
    'reply generated, no media step loaded now',
);
assert.equal(
    suggestionStillApplies(null, 7),
    false,
    'reply generated, media step loaded meanwhile → drop',
);
assert.equal(
    suggestionStillApplies(7, 7),
    true,
    'caption for step 7, still step 7',
);
assert.equal(
    suggestionStillApplies(7, 9),
    false,
    'caption for step 7, step 9 loaded now → drop',
);
assert.equal(
    suggestionStillApplies(7, null),
    false,
    'caption for step 7, step removed → drop',
);

// #3 — loading a step while a generate is in flight counts as dirty.
const base = {
    draft: '',
    suggestion: null,
    gif: null,
    attachment: null,
    step: null,
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
    composerDirty({ ...base, step: { stepId: 1 } }),
    true,
    'a loaded step is dirty',
);

// #4 — step media for the price prompt: counts by type, non-zero keys only.
assert.deepEqual(
    ppvMediaCounts([{ type: 'photo' }, { type: 'photo' }, { type: 'video' }]),
    { photo: 2, video: 1 },
);
assert.deepEqual(ppvMediaCounts([]), {});

// #5 — the saved plan, in words for the "not ready" warning.
assert.equal(humanPlan('rapport_beat'), 'a rapport beat');
assert.equal(humanPlan('qualifying_question'), 'a qualifying question');
assert.equal(humanPlan('aftercare'), 'aftercare');
assert.equal(humanPlan('goodbye_script'), 'a goodbye');
assert.equal(humanPlan('manager_flag'), 'a manager flag');
assert.equal(humanPlan('some_new_move'), 'some new move');

// #6 — what the strip shows next to the price chip.
assert.equal(priceSuggestionView(null, true, 20).kind, 'pricing');
assert.equal(priceSuggestionView(null, false, 20).kind, 'none');
assert.deepEqual(priceSuggestionView({ error: 'x' }, false, 20), {
    kind: 'error',
    error: 'x',
});
assert.deepEqual(priceSuggestionView({ price: 12, reason: 'r' }, false, 20), {
    kind: 'offer',
    price: 12,
    reason: 'r',
});
assert.equal(
    priceSuggestionView({ price: 20, reason: 'r' }, false, 20).kind,
    'agree',
);
assert.equal(
    priceSuggestionView({ price: 12, reason: 'r' }, true, 20).kind,
    'pricing',
    'a regenerate in flight hides the old suggestion',
);

console.log(
    '✓ ppv-composer-check: price edits, suggestion ownership, dirty check, media counts, plan wording, price suggestion view',
);
