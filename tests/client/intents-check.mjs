import assert from 'node:assert/strict';
import {
    chatCounters,
    effectiveTag,
    intentLabel,
    intentLock,
    ppvChipLock,
    isHiddenMass,
    tagChipLabel,
} from '../../resources/js/lib/chatCounters.ts';
import {
    sameIntent,
    intentRefLabel,
    isServerIntent,
    intentCatalogue,
    AD_HOC_STEP_ID,
    INTENT_KEYS,
} from '../../resources/js/lib/intents.ts';
import {
    generationStillApplies,
    stepSendExtras,
    captionStepId,
} from '../../resources/js/lib/ppvComposer.ts';

const RP = { key: 'repitch', option: null };

const NOW = Date.parse('2026-11-26T12:00:00Z');
let n = 0;
const msg = (o = {}) => ({
    id: `m${++n}`,
    from: 'fan',
    text: 'x',
    time: new Date(NOW - (1000 - n) * 60000).toISOString(),
    price: 0,
    isFree: true,
    isOpened: false,
    isLiked: false,
    isPinned: false,
    isTip: false,
    fromQueue: false,
    mediaCount: 0,
    media: [],
    ...o,
});
const ppv = (o = {}) =>
    msg({ from: 'creator', price: 20, isFree: false, ...o });
const plain = (k) => Array.from({ length: k }, () => msg());
const opts = { hasMore: false, sessionGapHours: 12 };
// Fixtures are built out of order, so re-stamp times by array position (old messages keep theirs).
const C = (ms, tags = {}, o = opts) =>
    chatCounters(
        ms.map((m, i) => ({
            ...m,
            time:
                m.time !== null && Date.parse(m.time) < NOW - 86400000
                    ? m.time
                    : new Date(NOW - (500 - i) * 60000).toISOString(),
        })),
        tags,
        o,
    );

// total / returning
let c = C(plain(11));
assert.equal(c.total, 11);
assert.equal(c.returning, false);
assert.equal(intentLock('ppv', c).enabled, false);
assert.equal(intentLock('ppv', c).reason, '11 of 12 messages');
const old = msg({ time: new Date(NOW - 2 * 86400000).toISOString() });
c = C([old, ...plain(10)]);
assert.equal(c.returning, true);
assert.equal(c.total, 11);
assert.equal(intentLock('ppv', c).enabled, true);
c = C([old, ...plain(8)]);
assert.equal(intentLock('ppv', c).reason, '9 of 10 messages');
c = C(plain(5), {}, { ...opts, hasMore: true });
assert.ok(c.total >= 100);
assert.equal(c.returning, true);
assert.equal(intentLock('ppv', c).enabled, true);

// unsorted input (raw, no re-stamp): newest-first order still yields correct counters
c = chatCounters([...plain(12)].reverse(), {}, opts);
assert.equal(c.total, 12);
assert.equal(intentLock('ppv', c).enabled, true);

// since last PPV
let p = ppv();
c = C([...plain(10), p, ...plain(5)], { [p.id]: 'chat_ppv' });
assert.equal(c.sinceLastPpv, 5);
assert.equal(intentLock('ppv', c).reason, '5 of 6 since the last PPV');
c = C([...plain(10), p, ...plain(6)]);
assert.equal(intentLock('ppv', c).enabled, true);

// hidden mass
const mass = ppv({ fromQueue: true });
assert.equal(effectiveTag(mass, {}), 'mppv');
assert.equal(isHiddenMass(mass, {}), true);
c = C([mass, ...plain(3)]);
assert.equal(c.total, 3);
assert.equal(c.sinceLastPpv, null);
assert.equal(c.unpaidPpv, null);
assert.equal(c.unboughtMass, 1);
assert.equal(intentLock('reoffer_mppv', c).enabled, true);
assert.equal(intentLock('reoffer_mppv', c).lit, false);
assert.equal(
    intentLock('reoffer_mppv', C(plain(3))).reason,
    'No unbought mass PPV',
);

// same tagged chat_ppv
c = C([mass, ...plain(5)], { [mass.id]: 'chat_ppv' });
assert.equal(c.total, 6);
assert.equal(c.unboughtMass, 0);
assert.deepEqual(c.unpaidPpv, { price: 20, since: 5, messageId: mass.id });
let l = intentLock('repitch', c);
assert.equal(l.enabled, true);
assert.equal(l.lit, true);
c = C([mass, ...plain(4)], { [mass.id]: 'chat_ppv' });
l = intentLock('repitch', c);
assert.equal(l.enabled, false);
assert.equal(l.reason, '4 of 5 messages since the unpaid PPV');
assert.equal(intentLock('repitch', C(plain(3))).reason, 'No unpaid PPV');

// opened newer than unopened
const u = ppv();
const o = ppv({ isOpened: true });
c = C([u, ...plain(2), o, ...plain(2)]);
assert.equal(c.unpaidPpv, null);
assert.equal(c.sinceLastPpv, 2);

// opened mass: PPV but never unpaid
const om = ppv({ fromQueue: true, isOpened: true });
c = C([om, ...plain(3)]);
assert.equal(c.sinceLastPpv, 3);
assert.equal(c.unpaidPpv, null);
assert.equal(c.total, 4);

// free_preview
const fp = ppv();
c = C([fp, ...plain(3)], { [fp.id]: 'free_preview' });
assert.equal(c.sinceLastPpv, null);
assert.equal(c.unpaidPpv, null);
assert.equal(effectiveTag(msg(), {}), null);
assert.equal(effectiveTag(ppv({ isTip: true }), {}), null);
assert.equal(effectiveTag(ppv({ isFree: true }), {}), null);
assert.equal(effectiveTag(ppv(), { x: 'bogus' }), 'chat_ppv');

// pending/failed, tips
c = C([
    msg(),
    msg({ pending: true }),
    msg({ failed: true }),
    msg({ isTip: true, price: 5, isFree: false }),
]);
assert.equal(c.total, 2);

// stale-draft
const s = { captionFor: null, loads: 0, intent: null };
assert.equal(generationStillApplies(s, { ...s, intent: RP }), false);
assert.equal(generationStillApplies(s, { ...s }), true);

// labels
assert.equal(intentLabel('repitch'), 'Re-pitch');
assert.equal(intentLabel('reoffer_mppv'), 'Re-offer MPPV');
assert.equal(intentLabel('ppv'), 'PPV');

// an invalidated request (requestedIntent undefined) never applies, even for the same intent
assert.equal(
    generationStillApplies({ ...s, intent: RP }, { ...s, intent: undefined }),
    false,
);
assert.equal(
    generationStillApplies({ ...s, intent: RP }, { ...s, intent: RP }),
    true,
);
assert.equal(generationStillApplies(s, { ...s, intent: undefined }), false);

// PPV chip: a loaded media step = caption it (no gate); nothing loaded = the 12/10/6 lock.
{
    const low = { total: 8, returning: false, sinceLastPpv: null };
    assert.equal(
        ppvChipLock(low, true).enabled,
        true,
        'loaded step ignores the lock',
    );
    assert.equal(ppvChipLock(low, false).enabled, false);
    assert.equal(ppvChipLock(low, false).reason, '8 of 12 messages');
    assert.equal(ppvChipLock({ ...low, total: 12 }, false).enabled, true);
}

// ---- tag chip label ----
assert.equal(tagChipLabel('mppv', true), 'Mass · auto');
assert.equal(tagChipLabel('mppv', false), 'Mass');
assert.equal(tagChipLabel('chat_ppv', true), 'Chat PPV · auto');
assert.equal(tagChipLabel('chat_ppv', false), 'Chat PPV');
assert.equal(tagChipLabel('free_preview', false), 'Free preview');

// ---- intent refs (slice 2) ----
assert.deepEqual(
    intentCatalogue().map((i) => i.key),
    [...INTENT_KEYS],
    'INTENT_KEYS must match the catalogue keys exactly (members + order)',
);
{
    const a = { key: 'objection', option: 'expensive' };
    assert.equal(
        sameIntent(a, { key: 'objection', option: 'expensive' }),
        true,
    );
    assert.equal(sameIntent(a, { key: 'objection', option: 'no_time' }), false);
    assert.equal(sameIntent(a, { key: 'repitch', option: null }), false);
    assert.equal(sameIntent(null, null), true);
    assert.equal(sameIntent(undefined, undefined), true);
    assert.equal(sameIntent(undefined, null), false);
    assert.equal(sameIntent(null, undefined), false);
    assert.equal(sameIntent(a, null), false);

    assert.equal(
        intentRefLabel(a),
        'Objection \u2013 Too expensive / discount',
    );
    assert.equal(intentRefLabel({ key: 'repitch', option: null }), 'Re-pitch');
    assert.equal(
        intentRefLabel({ key: 'cta', option: 'cta1' }),
        'CTA \u2013 CTA 1',
    );

    assert.equal(isServerIntent('repitch'), true);
    assert.equal(isServerIntent('ppv'), false);
    assert.equal(isServerIntent('free_picture'), false);

    // option change alone drops a draft
    const base = { captionFor: null, loads: 0 };
    assert.equal(
        generationStillApplies(
            { ...base, intent: a },
            { ...base, intent: { key: 'objection', option: 'no_time' } },
        ),
        false,
    );
    assert.equal(
        generationStillApplies(
            { ...base, intent: a },
            { ...base, intent: { ...a } },
        ),
        true,
    );

    // ad-hoc media step
    assert.equal(AD_HOC_STEP_ID, 0);
    const adHoc = {
        stepId: AD_HOC_STEP_ID,
        title: 'Media',
        price: 0,
        media: [
            { id: 'v1', type: 'photo', thumb: null },
            { id: 'v2', type: 'photo', thumb: null },
        ],
        priceSuggestion: null,
        notReadyPlan: null,
    };
    assert.deepEqual(stepSendExtras(adHoc), { mediaFiles: ['v1', 'v2'] });
    assert.equal(captionStepId(adHoc), 0);

    for (const i of intentCatalogue()) {
        if (i.server && i.options.length > 0) {
            assert.ok(i.options.length >= 2, `${i.key} has >=2 options`);
        }
    }
}

console.log('intents-check: OK');
