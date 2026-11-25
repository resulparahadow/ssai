// RED→GREEN check for resources/js/lib/ppvComposer.ts (no TS unit runner in this repo).
// Run: node --experimental-strip-types tests/client/ppv-composer-check.mjs
import assert from 'node:assert/strict';
const mod = await import('../../resources/js/lib/ppvComposer.ts');
const {
    parsePpvPriceInput,
    suggestionStillApplies,
    generationStillApplies,
    generationOutcome,
    composerDirty,
    ppvMediaCounts,
    humanPlan,
    priceSuggestionView,
    sendClearsComposer,
    stepAfterAccept,
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

// #3b — any step LOADED while a generate runs drops the result, even when both ends read
// as a normal reply (Text steps): the replace confirm promised to replace the pending draft.
const at = (captionFor, loads, intent = null) => ({
    captionFor,
    loads,
    intent,
});
assert.equal(
    generationStillApplies(at(null, 0), at(null, 1)),
    false,
    'reply in flight → Text step loaded → dropped',
);
assert.equal(
    generationStillApplies(at(null, 3), at(null, 4)),
    false,
    'Text step A → Text step B mid-generate → dropped',
);
assert.equal(
    generationStillApplies(at(null, 4), at(null, 4)),
    true,
    'reply generated after loading a Text step → kept',
);
assert.equal(
    generationStillApplies(at(7, 2), at(7, 2)),
    true,
    'caption for step 7, nothing loaded since → kept',
);
assert.equal(
    generationStillApplies(at(7, 2), at(null, 2)),
    false,
    'caption for step 7, step removed → dropped (caption rule unchanged)',
);
assert.equal(
    generationStillApplies(at(null, 2), at(9, 3)),
    false,
    'reply in flight, media step loaded → dropped',
);
assert.equal(
    generationStillApplies(at(7, 2), at(7, 3)),
    false,
    'step 7 reloaded mid-generate → dropped (the load reset the payload)',
);

assert.equal(
    generationStillApplies(
        at(null, 2, null),
        at(null, 2, { key: 'repitch', option: null }),
    ),
    false,
    'only the intent changed -> dropped',
);

// #3c — a per-generate token: a newer run supersedes the older (silent drop), a step load
// or caption change says "script changed", the chatter's own dismiss/send drops silently.
// No default param: an explicit `undefined` (composer released) must stay undefined.
const run = (seq, captionFor, loads, ...intent) => ({
    seq,
    captionFor,
    loads,
    intent: intent.length > 0 ? intent[0] : null,
});
assert.equal(
    generationOutcome(run(1, null, 0), run(1, null, 0)),
    'apply',
    'nothing changed → apply',
);
assert.equal(
    generationOutcome(run(1, null, 0), run(2, 9, 1)),
    'superseded',
    'plain G1 superseded by caption G2 (armed PPV load) → silent',
);
assert.equal(
    generationOutcome(run(2, 9, 1), run(2, 9, 1)),
    'apply',
    'caption G2 still applies after G1 landed (the old null===null finally bug)',
);
assert.equal(
    generationOutcome(run(1, null, 0), run(1, null, 1, undefined)),
    'script-changed',
    'step loaded mid-generate (no new run) → script changed',
);
assert.equal(
    generationOutcome(run(1, 7, 2), run(1, null, 2)),
    'script-changed',
    'loaded media step removed mid-caption → script changed',
);
assert.equal(
    generationOutcome(run(1, null, 2, 'repitch'), run(1, null, 2, undefined)),
    'invalidated',
    'dismissed / sent mid-generate → silent',
);
assert.equal(
    generationOutcome(run(1, 7, 2, null), run(1, null, 2, undefined)),
    'invalidated',
    'chatter sent the loaded media step while its caption ran → silent',
);
assert.equal(
    generationOutcome(run(1, null, 2, null), run(1, 9, 2, null)),
    'script-changed',
    'reply in flight, media step now loaded without a load count change → script changed',
);
assert.equal(
    generationOutcome(run(3, 7, 2), run(4, null, 3)),
    'superseded',
    'superseded wins over every other cause',
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

// #7 — a send clears the composer only when no step was loaded while it was in flight:
// a step loaded during "Sending…" owns the text/chip now, and wiping its text would leave a
// chip that logs the next, unrelated message as that step.
assert.equal(sendClearsComposer(3, 3), true, 'nothing loaded mid-send → clear');
assert.equal(
    sendClearsComposer(3, 4),
    false,
    'step loaded mid-send → keep its text, suggestion and chip',
);

// #8 — accepting a suggestion: a NORMAL reply accepted with a Text step loaded drops the step
// (the fan never got the step's text); a caption on a media step IS the step, so it stays.
const textStep = { stepId: 5, media: [] };
const mediaStep = { stepId: 6, media: [{ id: 'v1', type: 'photo' }] };
assert.equal(
    stepAfterAccept(textStep, null),
    null,
    'Text step + normal reply accepted → step dropped',
);
assert.equal(
    stepAfterAccept(mediaStep, 6),
    mediaStep,
    'media step + its caption accepted → step kept',
);
assert.equal(stepAfterAccept(null, null), null, 'no step → nothing');

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
    '✓ ppv-composer-check: price edits, suggestion ownership, generate token outcome, dirty check, media counts, plan wording, price suggestion view, send clear guard, accept drops Text step',
);
