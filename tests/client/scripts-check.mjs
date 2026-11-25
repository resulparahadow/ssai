// RED→GREEN check for resources/js/lib/scriptLabels.ts + scriptProgress.ts.
// Run: node --experimental-strip-types tests/client/scripts-check.mjs
import assert from 'node:assert/strict';
const { fillLabels, findScriptNote } =
    await import('../../resources/js/lib/scriptLabels.ts');
const { scriptProgress } =
    await import('../../resources/js/lib/scriptProgress.ts');
const { stepSendExtras, captionStepId } =
    await import('../../resources/js/lib/ppvComposer.ts');

const jake = { fanName: 'Jake', customName: '' };

// fillLabels
assert.equal(fillLabels('hey {Fan Name}!', jake, null), 'hey Jake!');
assert.equal(fillLabels('HEY {FAN NAME}', jake, null), 'HEY JAKE');
assert.equal(fillLabels('hey {fan name}', jake, null), 'hey jake');
assert.equal(
    fillLabels(
        'hey {Fan Name}, hi',
        { fanName: 'u12345678', customName: '' },
        'babe',
    ),
    'hey babe, hi',
    'uNNN counts as empty → fallback',
);
assert.equal(
    fillLabels('hey {Fan Name}, hi', { fanName: '', customName: '' }, null),
    'hey, hi',
    'no fallback → token removed, space before comma gone',
);
assert.equal(
    fillLabels('hi {Fan Name} there', { fanName: '', customName: '' }, null),
    'hi there',
    'runs of spaces collapse',
);
assert.equal(
    fillLabels('{Custom Name}', { fanName: 'Jake', customName: 'Big J' }, null),
    'Big J',
);
assert.equal(
    fillLabels('{CUSTOM NAME}', { fanName: 'Jake', customName: 'Big J' }, null),
    'BIG J',
);
assert.equal(
    fillLabels('{custom name}', { fanName: 'Jake', customName: 'Big J' }, null),
    'big j',
);
assert.equal(fillLabels('no tokens', jake, null), 'no tokens');

// findScriptNote
assert.deepEqual(findScriptNote('[rizz him up] ok'), { start: 0, end: 13 });
assert.equal(findScriptNote('no brackets'), null);
assert.equal(findScriptNote('a [ b'), null);
assert.equal(findScriptNote('[]'), null);
assert.equal(findScriptNote('[ ]'), null, 'whitespace-only is empty');
assert.equal(findScriptNote('[a\nb]'), null, 'must be on one line');
assert.deepEqual(findScriptNote('x\n[note]'), { start: 2, end: 8 });

// scriptProgress
const script = {
    id: 1,
    name: 's',
    sortOrder: 0,
    steps: [1, 2, 3].map((id) => ({
        id,
        scriptId: 1,
        title: 't' + id,
        text: null,
        fallbackName: null,
        price: 0,
        media: [],
        kind: 'text',
        sortOrder: id,
    })),
};
const sent = { sentAt: 'x', messageId: null, price: null, source: 'manual' };
const p = scriptProgress(script, { 2: [sent] });
assert.equal(p.sent, 1);
assert.equal(p.total, 3);
assert.equal(p.nextStepId, 1);
assert.deepEqual([...p.sentIds], [2]);
const all = scriptProgress(script, { 1: [sent], 2: [sent], 3: [sent] });
assert.equal(all.sent, 3);
assert.equal(all.nextStepId, null);
assert.equal(scriptProgress(script, {}).nextStepId, 1);

// stepSendExtras — what a send adds for the loaded step
const textStep = {
    stepId: 5,
    title: 'MS 1.1',
    price: 0,
    media: [],
    priceSuggestion: null,
    notReadyPlan: null,
};
const ppvStep = {
    ...textStep,
    stepId: 6,
    price: 12,
    media: [
        { id: 'a', type: 'photo', thumb: null },
        { id: 'b', type: 'video', thumb: null },
    ],
};
const freeStep = { ...ppvStep, stepId: 7, price: 0 };
assert.deepEqual(stepSendExtras(null), {}, 'no step → nothing extra');
assert.deepEqual(
    stepSendExtras(textStep),
    { scriptStepId: 5 },
    'text step → logged only, no media or price',
);
assert.deepEqual(stepSendExtras(ppvStep), {
    scriptStepId: 6,
    price: 12,
    mediaFiles: ['a', 'b'],
});
assert.deepEqual(
    stepSendExtras(freeStep),
    { scriptStepId: 7, price: 0, mediaFiles: ['a', 'b'] },
    'free media step still sends its media + price 0',
);

// captionStepId — only a media step puts Generate in caption mode
assert.equal(captionStepId(null), null);
assert.equal(captionStepId(textStep), null, 'a text step is a normal reply');
assert.equal(captionStepId(ppvStep), 6);
assert.equal(captionStepId(freeStep), 7);

console.log('scripts-check: all passed');
