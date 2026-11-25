// RED→GREEN check for resources/js/lib/scriptLabels.ts + scriptProgress.ts.
// Run: node --experimental-strip-types tests/client/scripts-check.mjs
import assert from 'node:assert/strict';
const { fillLabels, findScriptNote } =
    await import('../../resources/js/lib/scriptLabels.ts');
const { scriptProgress, nextStepIndex, nextPpvTarget } =
    await import('../../resources/js/lib/scriptProgress.ts');
const { stepSendExtras, captionStepId } =
    await import('../../resources/js/lib/ppvComposer.ts');
const { sentPpvs } = await import('../../resources/js/lib/sentPpvs.ts');

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

// sentPpvs — the rail's PPV tab: priced creator messages with media, newest first
const media = (type, thumb = null) => ({
    id: 'm' + Math.random(),
    type,
    canView: true,
    thumb,
    preview: null,
    full: null,
    source: null,
    createdAt: null,
    duration: null,
    width: null,
    height: null,
    likes: null,
    tips: null,
});
const msg = (over) => ({
    id: '1',
    from: 'creator',
    text: '',
    time: null,
    price: 0,
    isFree: true,
    isOpened: false,
    isLiked: false,
    isPinned: false,
    isTip: false,
    fromQueue: false,
    mediaCount: 0,
    media: [],
    ...over,
});
const thread = [
    msg({ id: 'f1', from: 'fan', price: 10, media: [media('photo')] }),
    msg({ id: 'free', price: 0, media: [media('photo')] }),
    msg({ id: 'textonly', price: 12, media: [] }),
    msg({
        id: 'old',
        price: 12,
        text: 'older one',
        time: '2026-11-01T10:00:00Z',
        media: [
            media('photo', 'https://x/t1.jpg'),
            media('video'),
            media('gif'),
        ],
        isOpened: true,
    }),
    msg({
        id: 'new',
        price: 25,
        time: '2026-11-02T10:00:00Z',
        fromQueue: true,
        media: [media('video')],
    }),
];
const ppvs = sentPpvs(thread);
assert.deepEqual(
    ppvs.map((p) => p.id),
    ['new', 'old'],
    'fan, free and media-less messages are ignored; newest first',
);
assert.equal(ppvs[0].mass, true, 'fromQueue → mass');
assert.equal(ppvs[0].opened, false);
assert.equal(ppvs[0].videos, 1);
assert.equal(ppvs[0].photos, 0);
assert.equal(ppvs[1].opened, true, 'isOpened → opened');
assert.equal(ppvs[1].mass, false);
assert.equal(ppvs[1].photos, 2, 'photos + GIFs');
assert.equal(ppvs[1].videos, 1);
assert.equal(ppvs[1].price, 12);
assert.equal(ppvs[1].text, 'older one');
assert.equal(ppvs[1].createdAt, '2026-11-01T10:00:00Z');
assert.equal(
    ppvs[1].thumb?.thumb,
    'https://x/t1.jpg',
    'first media is the thumb',
);
// Tags: the rail follows the same effective tag as the bubble chip.
{
    // The shared fixtures carry isFree:true; real priced PPVs do not.
    const real = thread.map((m) => ({ ...m, isFree: m.price === 0 }));
    const t = sentPpvs(real, { new: 'chat_ppv', old: 'mppv' });
    assert.equal(t[0].mass, false, 'override chat_ppv beats fromQueue');
    assert.equal(t[1].mass, true, 'override mppv on a non-queue message');
    const f = sentPpvs(real, { new: 'free_preview' });
    assert.equal(f.length, 2, 'free_preview stays in the list');
    assert.equal(f[0].freePreview, true);
    assert.equal(f[0].mass, false);
    assert.equal(ppvs[0].freePreview, false);
}
assert.deepEqual(sentPpvs([]), []);
// No timestamps (optimistic/edge): thread order decides, newest = last in the thread.
assert.deepEqual(
    sentPpvs([
        msg({ id: 'a', price: 5, media: [media('photo')] }),
        msg({ id: 'b', price: 5, media: [media('photo')] }),
    ]).map((p) => p.id),
    ['b', 'a'],
);
// Optimistic bubbles (in flight / failed) are not sent PPVs yet.
assert.deepEqual(
    sentPpvs([
        msg({
            id: 'pending-1',
            price: 5,
            media: [media('photo')],
            pending: true,
        }),
        msg({
            id: 'pending-2',
            price: 5,
            media: [media('photo')],
            failed: true,
        }),
    ]),
    [],
    'pending/failed sends are excluded',
);

// nextStepIndex: the cursor target for a panel opened straight into a script.
{
    const sc = { id: 1, steps: [{ id: 10 }, { id: 11 }, { id: 12 }] };
    assert.equal(nextStepIndex(sc, {}), 0, 'nothing sent → first step');
    assert.equal(nextStepIndex(sc, { 10: [{}], 11: [{}] }), 2, 'first unsent');
    assert.equal(nextStepIndex(sc, { 10: [{}], 12: [{}] }), 1, 'gap → the gap');
    assert.equal(
        nextStepIndex(sc, { 10: [{}], 11: [{}], 12: [{}] }),
        null,
        'all sent',
    );
    assert.equal(nextStepIndex({ id: 2, steps: [] }, {}), null, 'no steps');
}

// nextPpvTarget: where the PPV chip opens the panel.
{
    const ppv = (id, extra = {}) => ({
        id,
        kind: 'ppv',
        needsMedia: false,
        ...extra,
    });
    const A = { id: 1, steps: [{ id: 10, kind: 'text' }, ppv(11)] };
    const B = { id: 2, steps: [ppv(20), ppv(21)] };
    const C = { id: 3, steps: [ppv(30, { needsMedia: true })] };
    assert.deepEqual(
        nextPpvTarget([A, B], {}, 2),
        { scriptId: 2, stepIndex: 0 },
        'remembered folder wins',
    );
    assert.deepEqual(
        nextPpvTarget([A, B], {}, null),
        { scriptId: 1, stepIndex: 1 },
        'first folder with an unsent PPV',
    );
    assert.deepEqual(
        nextPpvTarget([A, B], {}, 99),
        { scriptId: 1, stepIndex: 1 },
        'stale remembered id falls back',
    );
    assert.deepEqual(
        nextPpvTarget([C, A], {}, 3),
        { scriptId: 1, stepIndex: 1 },
        'remembered folder with only needs-media falls back',
    );
    assert.deepEqual(
        nextPpvTarget([B], { 20: [{}] }, null),
        { scriptId: 2, stepIndex: 1 },
        'sent step skipped',
    );
    assert.deepEqual(
        nextPpvTarget([A, B], { 11: [{}] }, 1),
        { scriptId: 2, stepIndex: 0 },
        'remembered folder fully sent falls to next',
    );
    assert.equal(
        nextPpvTarget([B], { 20: [{}], 21: [{}] }, null),
        null,
        'all sent → null',
    );
    assert.equal(nextPpvTarget([C], {}, null), null, 'needs-media only → null');
    assert.equal(nextPpvTarget([], {}, null), null, 'no folders → null');
}

console.log('scripts-check: all passed');
