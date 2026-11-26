import assert from 'node:assert/strict';
import { autoHints, isRefusal } from '../../resources/js/lib/autoHints.ts';
import { chatCounters } from '../../resources/js/lib/chatCounters.ts';
import {
    DEFAULT_LADDER,
    SUPPORT_REASON,
    SWITCHES,
    applyLiveState,
    ladderOffer,
    lastRungBought,
    nextRung,
    normalizeProfile,
    rowValue,
    sellingIntent,
    stateChipLock,
    stateSummaryParts,
    stepBlockedBySupport,
    switchPatch,
} from '../../resources/js/lib/stateSwitches.ts';

// A profile as the server returns it, before this feature (no state keys at all).
const legacyProfile = {
    archetype: null,
    trust_level: 1,
    temperature: null,
    key_details: null,
    crm_notes: null,
    is_timewaster: false,
    sexting_mode: 'AUTO',
    tip_mode: 'AUTO',
    total_spend: 0,
    tips_spend: 0,
    subscription_status: null,
    locked_fields: [],
};

const P = (o = {}) => normalizeProfile({ ...legacyProfile, ...o });

// ---- normalizeProfile: an older server's payload gets safe defaults ----------
{
    const p = P();
    assert.deepEqual(p.state_overrides, {});
    assert.deepEqual(p.counters, {
        objection_redirects: 0,
        sex_only_pulls: 0,
    });
    assert.equal(p.is_bilingual, false);
    assert.deepEqual(p.price_ladder, DEFAULT_LADDER);
    assert.deepEqual(DEFAULT_LADDER, [12, 21, 35, 49, 69, 100]);
    assert.equal(p.auto_read.phase, null);
    assert.equal(p.auto_read.fan_type_from_trust, false);
    // an empty / junk ladder falls back to the default
    assert.deepEqual(P({ price_ladder: [] }).price_ladder, DEFAULT_LADDER);
    assert.deepEqual(P({ price_ladder: null }).price_ladder, DEFAULT_LADDER);
    // contract values pass through
    const q = P({
        state_overrides: { posture: 'frame_hold', support: true },
        counters: { objection_redirects: 3, sex_only_pulls: 2 },
        price_ladder: [10, 20],
        is_bilingual: true,
    });
    assert.deepEqual(q.state_overrides, {
        posture: 'frame_hold',
        support: true,
    });
    assert.equal(q.counters.objection_redirects, 3);
    assert.deepEqual(q.price_ladder, [10, 20]);
    assert.equal(q.is_bilingual, true);
}

// ---- SWITCHES: order and labels from the plan --------------------------------
assert.deepEqual(
    SWITCHES.map((s) => s.key),
    [
        'phase',
        'rls_beat',
        'fan_type',
        'lane',
        'posture',
        'trust',
        'promise',
        'language',
        'support',
    ],
);
const sw = (k) => SWITCHES.find((s) => s.key === k);
assert.deepEqual(
    sw('phase').values.map((v) => v.label),
    ['Warm up', 'Rapport', 'Link', 'Sale', 'Loop', 'Aftersale'],
);
assert.deepEqual(
    sw('phase').values.map((v) => v.value),
    ['warm_up', 'rapport', 'link', 'sale', 'loop', 'aftersale'],
);
assert.equal(sw('rls_beat').values.length, 12);
assert.equal(sw('rls_beat').values[0].value, 1);
assert.deepEqual(
    sw('fan_type').values.map((v) => v.label),
    ['New', 'Returning', 'Spender'],
);
assert.deepEqual(
    sw('lane').values.map((v) => v.label),
    ['Normal', 'Sex-only', 'Rude'],
);
assert.equal(sw('lane').auto, false); // no Auto: the first value is the default
assert.equal(sw('support').auto, false);
assert.equal(sw('phase').auto, true);
assert.deepEqual(
    sw('posture').values.map((v) => v.label),
    ['Normal', 'Frame-hold', 'Timewaster'],
);
assert.deepEqual(
    sw('trust').values.map((v) => v.label),
    ['L1', 'L2', 'L3', 'L4', 'L5'],
);
assert.deepEqual(
    sw('promise').values.map((v) => v.label),
    ['Not asked', 'Asked', 'Reinforced ×1', 'Reinforced ×2'],
);
assert.deepEqual(
    sw('language').values.map((v) => v.label),
    ['ES', 'EN'],
);
assert.deepEqual(
    sw('support').values.map((v) => v.label),
    ['Off', 'On'],
);

// ---- rowValue ------------------------------------------------------------------
// Auto with a read
{
    const p = P({ auto_read: { phase: 'rapport', posture: 'frame_hold' } });
    assert.deepEqual(rowValue('phase', p), {
        text: 'Auto · Rapport',
        manual: false,
        disabled: false,
        hidden: false,
    });
    assert.equal(rowValue('posture', p).text, 'Auto · Frame-hold');
}
// Auto without a read
assert.equal(rowValue('phase', P()).text, 'Auto');
assert.equal(rowValue('rls_beat', P()).text, 'Auto');
assert.equal(rowValue('promise', P()).text, 'Auto');
// manual
{
    const p = P({
        state_overrides: {
            phase: 'warm_up',
            rls_beat: 3,
            fan_type: 'spender',
            lane: 'rude',
            posture: 'frame_hold',
            promise: 'reinforced_1',
            support: true,
        },
        auto_read: { phase: 'sale' },
    });
    assert.deepEqual(rowValue('phase', p), {
        text: 'Warm up',
        manual: true,
        disabled: false,
        hidden: false,
    });
    assert.equal(rowValue('rls_beat', p).text, 'Beat 3');
    assert.equal(rowValue('rls_beat', p).manual, true);
    assert.equal(rowValue('fan_type', p).text, 'Spender');
    assert.equal(rowValue('lane', p).text, 'Rude');
    assert.equal(rowValue('lane', p).manual, true);
    assert.equal(rowValue('posture', p).text, 'Frame-hold');
    assert.equal(rowValue('promise', p).text, 'Reinforced ×1');
    assert.equal(rowValue('support', p).text, 'On');
    assert.equal(rowValue('support', p).manual, true);
}
// lane normal / support off are the defaults, not manual
assert.deepEqual(rowValue('lane', P()), {
    text: 'Normal',
    manual: false,
    disabled: false,
    hidden: false,
});
assert.equal(rowValue('support', P()).text, 'Off');
assert.equal(rowValue('support', P()).manual, false);
// fan type from trust
{
    const p = P({
        trust_level: 3,
        auto_read: { fan_type: 'returning', fan_type_from_trust: true },
    });
    assert.equal(
        rowValue('fan_type', p).text,
        'Auto · Returning (from trust L3)',
    );
    assert.equal(rowValue('fan_type', p).manual, false);
    assert.equal(
        rowValue(
            'fan_type',
            P({
                auto_read: { fan_type: 'spender', fan_type_from_trust: false },
            }),
        ).text,
        'Auto · Spender',
    );
}
// posture disabled by the saved timewaster flag — even with an override stored
{
    const r = rowValue(
        'posture',
        P({ is_timewaster: true, state_overrides: { posture: 'normal' } }),
    );
    assert.equal(r.text, 'Timewaster (flag on Fan tab)');
    assert.equal(r.disabled, true);
    assert.ok(r.reason && /Fan tab/.test(r.reason));
}
// language hidden unless bilingual
assert.equal(rowValue('language', P()).hidden, true);
{
    const p = P({ is_bilingual: true, auto_read: { language: 'es' } });
    assert.equal(rowValue('language', p).hidden, false);
    assert.equal(rowValue('language', p).text, 'Auto · ES');
    assert.equal(
        rowValue(
            'language',
            P({ is_bilingual: true, state_overrides: { language: 'en' } }),
        ).text,
        'EN',
    );
}
// trust: locked = manual, else the AI's level
assert.equal(rowValue('trust', P({ trust_level: 2 })).text, 'Auto · L2');
assert.equal(rowValue('trust', P({ trust_level: 2 })).manual, false);
// no trust set: legacy (and StateSwitches::autoRead) read it as L1, never "L0"
assert.equal(rowValue('trust', P({ trust_level: 0 })).text, 'Auto · L1');
{
    const r = rowValue(
        'trust',
        P({ trust_level: 4, locked_fields: ['trust_level'] }),
    );
    assert.equal(r.text, 'L4');
    assert.equal(r.manual, true);
}

// ---- switchPatch: one key per PATCH, Auto / Normal / Off = null --------------
assert.deepEqual(switchPatch('posture', 'frame_hold'), {
    state_overrides: { posture: 'frame_hold' },
});
assert.deepEqual(switchPatch('posture', null), {
    state_overrides: { posture: null },
});
assert.deepEqual(switchPatch('rls_beat', '4'), {
    state_overrides: { rls_beat: 4 },
});
assert.deepEqual(switchPatch('lane', null), {
    state_overrides: { lane: null },
});
assert.deepEqual(switchPatch('support', true), {
    state_overrides: { support: true },
});
assert.deepEqual(switchPatch('support', null), {
    state_overrides: { support: null },
});
assert.deepEqual(switchPatch('trust', '3'), { trust_level: 3 });
assert.deepEqual(switchPatch('trust', null), { unlock: ['trust_level'] });

// ---- nextRung ------------------------------------------------------------------
const L = [12, 21, 35, 49, 69, 100];
assert.equal(nextRung(L, null), 12);
assert.equal(nextRung(L, 21), 35);
assert.equal(nextRung(L, 100), null);
assert.equal(nextRung(L, 25), 35); // off the ladder
assert.equal(nextRung(L, 5), 12);
assert.equal(nextRung([35, 12, 21], 12), 21); // unsorted ladder
assert.equal(nextRung([], null), null);
assert.equal(nextRung([], 21), null);

// ---- lastRungBought ------------------------------------------------------------
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

assert.equal(lastRungBought([msg(), msg()], {}), null);
{
    const ms = [
        ppv({ price: 12, isOpened: true }),
        msg(),
        ppv({ price: 21, isOpened: true }),
        ppv({ price: 35, isOpened: false }), // unpaid: not bought
        msg(),
    ];
    assert.equal(lastRungBought(ms, {}), 21);
}
{
    // newer opened mass PPV, newer opened free preview, pending/failed: all ignored
    const fp = ppv({ price: 49, isOpened: true });
    const ms = [
        ppv({ price: 21, isOpened: true }),
        ppv({ price: 69, isOpened: true, fromQueue: true }),
        ppv({ price: 35, isOpened: false, fromQueue: true }), // hidden mass
        fp,
        ppv({ price: 100, isOpened: true, pending: true }),
        ppv({ price: 100, isOpened: true, failed: true }),
    ];
    assert.equal(lastRungBought(ms, { [fp.id]: 'free_preview' }), 21);
}
{
    // a stored chat_ppv tag on a queue message counts as a chat PPV
    const older = ppv({ price: 12, isOpened: true });
    const q = ppv({ price: 35, isOpened: true, fromQueue: true });
    assert.equal(lastRungBought([older, q], { [q.id]: 'chat_ppv' }), 35);
}
{
    // newest by time, not array position
    const a = ppv({
        price: 49,
        isOpened: true,
        time: new Date(NOW).toISOString(),
    });
    const b = ppv({
        price: 12,
        isOpened: true,
        time: new Date(NOW - 3600000).toISOString(),
    });
    assert.equal(lastRungBought([a, b], {}), 49);
}

// ---- sellingIntent ------------------------------------------------------------
for (const k of [
    'ppv',
    'repitch',
    'reoffer_mppv',
    'cta',
    'tip_ask',
    'promise',
    'free_picture',
]) {
    assert.equal(sellingIntent(k), true, k);
}

for (const k of [
    'objection',
    'chitchat',
    'sexting',
    'goodbye',
    'post_purchase',
    'post_tip',
    'breadcrumb',
    'hook',
    'follow_up',
    'aftersale',
]) {
    assert.equal(sellingIntent(k), false, k);
}

// ---- stateChipLock: support first, then the lit thresholds ---------------------
const open = { enabled: true, lit: false, reason: null };
const S0 = {
    support: false,
    objections: 0,
    sexOnly: 0,
    postPurchase: false,
    postTip: false,
    hook: false,
    aftersale: false,
};
assert.equal(SUPPORT_REASON, 'Support mode is on — no selling.');
{
    const r = stateChipLock('cta', open, { ...S0, support: true });
    assert.equal(r.enabled, false);
    assert.equal(r.reason, SUPPORT_REASON);
    assert.equal(r.lit, false);
}
{
    // support beats an already-disabled reason
    const r = stateChipLock(
        'ppv',
        { enabled: false, lit: false, reason: '3 of 12 messages' },
        { ...S0, support: true },
    );
    assert.equal(r.reason, SUPPORT_REASON);
}
// a non-selling chip is untouched by support
assert.deepEqual(stateChipLock('chitchat', open, { ...S0, support: true }), {
    enabled: true,
    lit: false,
    reason: null,
    hint: null,
});
// FreePicture lit at 3 objections
assert.equal(
    stateChipLock('free_picture', open, { ...S0, objections: 2 }).lit,
    false,
);
{
    const r = stateChipLock('free_picture', open, { ...S0, objections: 3 });
    assert.equal(r.lit, true);
    assert.equal(r.hint, "He's objected 3 times — a free teaser can help");
}
assert.equal(
    stateChipLock('free_picture', open, { ...S0, objections: 4 }).hint,
    "He's objected 4 times — a free teaser can help",
);
// …but not under support
assert.equal(
    stateChipLock('free_picture', open, {
        support: true,
        objections: 5,
        sexOnly: 0,
    }).lit,
    false,
);
// PPV lit at 2 sex-only pulls, only when unlocked
assert.equal(stateChipLock('ppv', open, { ...S0, sexOnly: 1 }).lit, false);
{
    const r = stateChipLock('ppv', open, { ...S0, sexOnly: 2 });
    assert.equal(r.lit, true);
    assert.equal(r.hint, 'He keeps pushing for sexual content — time to sell');
}
{
    const locked = { enabled: false, lit: false, reason: '3 of 12 messages' };
    const r = stateChipLock('ppv', locked, { ...S0, sexOnly: 3 });
    assert.equal(r.lit, false);
    assert.equal(r.enabled, false);
    assert.equal(r.reason, '3 of 12 messages');
}
// the base lit flag (Re-pitch) is kept
assert.equal(
    stateChipLock('repitch', { enabled: true, lit: true, reason: null }, S0)
        .lit,
    true,
);

// ---- stepBlockedBySupport ------------------------------------------------------
const media = [{ id: '1', type: 'photo', thumb: null }];
assert.equal(stepBlockedBySupport({ media, price: 21 }, true), SUPPORT_REASON);
assert.equal(stepBlockedBySupport({ media, price: 0 }, true), null); // free media goes
assert.equal(stepBlockedBySupport({ media: [], price: 0 }, true), null); // text
assert.equal(stepBlockedBySupport({ media, price: 21 }, false), null);

// ---- stateSummaryParts ---------------------------------------------------------
assert.deepEqual(
    stateSummaryParts({
        lastRung: 21,
        nextRung: 35,
        objections: 3,
        sexOnly: 2,
    }),
    ['last rung $21 → next $35', 'objections 3', 'sex-only 2'],
);
assert.deepEqual(
    stateSummaryParts({
        lastRung: null,
        nextRung: 12,
        objections: 0,
        sexOnly: 0,
    }),
    [],
);
assert.deepEqual(
    stateSummaryParts({
        lastRung: 100,
        nextRung: null,
        objections: 0,
        sexOnly: 1,
    }),
    ['last rung $100 · top of ladder', 'sex-only 1'],
);

// ---- ladderOffer: only a priced step whose price differs -----------------------
assert.equal(ladderOffer(35, 21), 35);
assert.equal(ladderOffer(35, 35), null);
assert.equal(ladderOffer(35, 0), null); // a free step
assert.equal(ladderOffer(null, 21), null);

// ---- applyLiveState: the generate response patches counters + the beat ---------
{
    const p = P({ state_overrides: { rls_beat: 3 } });
    applyLiveState(
        p,
        { counters: { objectionRedirects: 2, sexOnlyPulls: 1 }, rlsBeat: 4 },
        3,
    );
    assert.deepEqual(p.counters, { objection_redirects: 2, sex_only_pulls: 1 });
    assert.equal(p.state_overrides.rls_beat, 4);
    applyLiveState(p, {}, 4); // an older server: nothing changes
    assert.equal(p.state_overrides.rls_beat, 4);
    assert.equal(p.counters.objection_redirects, 2);
    applyLiveState(p, { rlsBeat: null }, 4); // null is not a reset
    assert.equal(p.state_overrides.rls_beat, 4);
    // the chatter set beat 7 while the generate ran: the response's 5 must not overwrite it
    p.state_overrides = { rls_beat: 7 };
    applyLiveState(
        p,
        { counters: { objectionRedirects: 0, sexOnlyPulls: 2 }, rlsBeat: 5 },
        4,
    );
    assert.equal(p.state_overrides.rls_beat, 7);
    assert.equal(p.counters.sex_only_pulls, 2); // counters still land
    // …nor re-add a beat the chatter set back to Auto meanwhile
    p.state_overrides = {};
    applyLiveState(p, { rlsBeat: 5 }, 4);
    assert.equal('rls_beat' in p.state_overrides, false);
    // an auto-advance from Auto-at-start is not a thing, but undefined===undefined applies
    const q = P();
    applyLiveState(q, { rlsBeat: 2 }, undefined);
    assert.equal(q.state_overrides.rls_beat, 2);
}

// ---- chatCounters: a fan_type override drives the returning (10-message) rule ---
{
    const short = Array.from({ length: 4 }, () => msg());
    const opts = { hasMore: false, sessionGapHours: 12 };
    assert.equal(chatCounters(short, {}, opts).returning, false);
    assert.equal(
        chatCounters(short, {}, { ...opts, fanType: 'returning' }).returning,
        true,
    );
    assert.equal(
        chatCounters(short, {}, { ...opts, fanType: 'spender' }).returning,
        true,
    );
    // a manual "new" wins over the heuristic too (the server forces tier new)
    assert.equal(
        chatCounters(
            short,
            {},
            { hasMore: true, sessionGapHours: 12, fanType: 'new' },
        ).returning,
        false,
    );
    assert.equal(
        chatCounters(short, {}, { ...opts, fanType: null }).returning,
        false,
    );
}

// ---- composerFanState ----------------------------------------------------------
{
    const { composerFanState } =
        await import('../../resources/js/lib/stateSwitches.ts');
    const none = composerFanState(null, [], {});
    assert.deepEqual(none, {
        support: false,
        objections: 0,
        sexOnly: 0,
        postPurchase: false,
        postTip: false,
        hook: false,
        aftersale: false,
        nextRung: 12,
        parts: [],
    });
    const bought = ppv({ price: 21, isOpened: true });
    const s = composerFanState(
        P({
            state_overrides: { support: true },
            counters: { objection_redirects: 3, sex_only_pulls: 2 },
        }),
        [bought],
        {},
    );
    assert.equal(s.support, true);
    assert.equal(s.nextRung, 35);
    assert.deepEqual(s.parts, [
        'last rung $21 → next $35',
        'objections 3',
        'sex-only 2',
    ]);
    // the creator's own ladder
    assert.equal(
        composerFanState(P({ price_ladder: [15, 30, 60] }), [bought], {})
            .nextRung,
        30,
    );
}

// ---- autoHints: Post-tip / Post-purchase light up by themselves --------------
{
    const me = (o = {}) => msg({ from: 'creator', ...o });
    const H = (ms, tags = {}) => autoHints(ms, tags);

    // Post-tip: a tip after her last message lights; her reply turns it off.
    assert.deepEqual(
        H([me(), msg({ isTip: true, price: 10, isFree: false })]),
        {
            postPurchase: false,
            postTip: true,
            hook: false,
            aftersale: false,
        },
    );
    assert.equal(H([msg({ isTip: true, price: 10 }), me()]).postTip, false);
    // He tipped, then typed — still lit (he tipped since she wrote).
    assert.equal(
        H([me(), msg({ isTip: true, price: 5 }), msg()]).postTip,
        true,
    );
    // No creator message at all: any tip lights.
    assert.equal(H([msg({ isTip: true, price: 5 })]).postTip, true);
    // A mass blast after the tip is not her answering him.
    assert.equal(
        H([me(), msg({ isTip: true, price: 5 }), ppv({ fromQueue: true })])
            .postTip,
        true,
    );
    // Optimistic / failed bubbles don't count as her answer.
    assert.equal(
        H([me(), msg({ isTip: true, price: 5 }), me({ pending: true })])
            .postTip,
        true,
    );
    assert.equal(
        H([me(), msg({ isTip: true, price: 5 }), me({ failed: true })]).postTip,
        true,
    );

    // Post-purchase: the newest PPV bought, nothing she wrote after it.
    assert.equal(H([me(), ppv({ isOpened: true })]).postPurchase, true);
    assert.equal(H([ppv({ isOpened: true }), msg()]).postPurchase, true);
    assert.equal(H([ppv({ isOpened: true }), me()]).postPurchase, false);
    assert.equal(H([ppv({ isOpened: false })]).postPurchase, false);
    // The NEWEST PPV decides: an older bought one doesn't light past a newer unbought one.
    assert.equal(
        H([ppv({ isOpened: true }), ppv({ isOpened: false })]).postPurchase,
        false,
    );
    // A bought mass PPV counts (he bought it) and a later mass blast isn't her writing.
    assert.equal(
        H([me(), ppv({ fromQueue: true, isOpened: true })]).postPurchase,
        true,
    );
    // A free preview is never a purchase signal.
    {
        const fp = ppv({ isOpened: true });
        assert.equal(
            H([me(), fp], { [fp.id]: 'free_preview' }).postPurchase,
            false,
        );
    }
    // Messages arriving out of order are read by time.
    {
        const bought = ppv({ isOpened: true });
        const reply = me({
            time: new Date(Date.parse(bought.time) + 60000).toISOString(),
        });
        assert.equal(H([reply, bought]).postPurchase, false);
    }
    assert.deepEqual(H([]), {
        postPurchase: false,
        postTip: false,
        hook: false,
        aftersale: false,
    });

    // Aftersale (After a no): he refused the PPV still waiting, she hasn't answered.
    for (const t of [
        'no',
        'Nope.',
        'nah',
        'no thanks',
        'No babe',
        'not now',
        'maybe later',
        "I'm good",
        'im good',
        'not interested',
        "can't afford it",
        'I\u2019m broke',
        'ahora no',
        'no gracias',
        'no puedo',
        'después',
        'otro día',
        '<p>not now</p>',
    ]) {
        assert.equal(isRefusal(t), true, `refusal: ${t}`);
    }

    for (const t of [
        '',
        'no way you are so hot',
        'too expensive',
        'can I get it for free?',
        'nothing',
        'know what',
        'notice me',
        'yes!',
        'how much?',
        'pass me the salt please',
    ]) {
        assert.equal(isRefusal(t), false, `not a refusal: ${t}`);
    }

    const unpaid = () => ppv({ isOpened: false });
    const A = (ms, tags = {}) => autoHints(ms, tags).aftersale;
    assert.equal(A([unpaid(), msg({ text: 'not now' })]), true);
    assert.equal(A([unpaid(), msg({ text: 'not now' }), me()]), false); // she answered
    assert.equal(
        A([unpaid(), msg({ text: 'not now' }), me({ fromQueue: true })]),
        true,
    );
    assert.equal(A([unpaid(), msg({ text: 'wow you look great' })]), false);
    // His NEWEST message decides: a no then a warm-up isn't "after a no" any more.
    assert.equal(
        A([unpaid(), msg({ text: 'no' }), msg({ text: 'ok show me' })]),
        false,
    );
    assert.equal(A([ppv({ isOpened: true }), msg({ text: 'no' })]), false); // he bought it
    assert.equal(A([msg({ text: 'no' })]), false); // no PPV at all
    assert.equal(A([msg({ text: 'no' }), unpaid()]), false); // the no came before the PPV
    // A hidden unbought mass PPV isn't a pitch to him.
    assert.equal(A([ppv({ fromQueue: true }), msg({ text: 'no' })]), false);
    // A free preview isn't the PPV either.
    {
        const fp = ppv({ isOpened: false });
        assert.equal(
            A([fp, msg({ text: 'no' })], { [fp.id]: 'free_preview' }),
            false,
        );
    }
    // A tip after his no doesn't hide the no.
    assert.equal(
        A([
            unpaid(),
            msg({ text: 'no thanks' }),
            msg({ isTip: true, price: 5, text: '' }),
        ]),
        true,
    );

    // Hook: a new subscriber she hasn't written to herself yet.
    const DAY = 86400000;
    const subAt = (msAgo) => ({
        subscribed: true,
        subscribedAt: new Date(NOW - msAgo).toISOString(),
    });
    const at = (msAgo) => new Date(NOW - msAgo).toISOString();
    const hook = (ms, sub) => autoHints(ms, {}, sub, NOW).hook;
    assert.equal(hook([], subAt(2 * DAY)), true);
    assert.equal(hook([msg({ time: at(DAY) })], subAt(2 * DAY)), true); // he wrote, she didn't
    assert.equal(hook([me({ time: at(DAY) })], subAt(2 * DAY)), false); // she wrote
    // OnlyFans' Welcome Message right after subscribing doesn't count as her writing.
    assert.equal(
        hook([me({ time: at(2 * DAY - 60000) })], subAt(2 * DAY)),
        true,
    );
    assert.equal(
        hook([me({ time: at(2 * DAY - 11 * 60000) })], subAt(2 * DAY)),
        false,
    );
    // A mass blast isn't her writing to him.
    assert.equal(
        hook([me({ time: at(DAY), fromQueue: true })], subAt(2 * DAY)),
        true,
    );
    // Old messages from before he subscribed (a returning subscriber) don't count.
    assert.equal(hook([me({ time: at(30 * DAY) })], subAt(2 * DAY)), true);
    // Too old a subscription, no date, lapsed, or no details → no hint.
    assert.equal(hook([], subAt(8 * DAY)), false);
    assert.equal(hook([], { subscribed: true, subscribedAt: null }), false);
    assert.equal(hook([], { subscribed: false, subscribedAt: at(DAY) }), false);
    assert.equal(hook([], null), false);
    assert.equal(hook([], { subscribed: null, subscribedAt: at(DAY) }), true);

    // The chips: lit with a reason, only while enabled; support mode doesn't block them.
    const open = { enabled: true, lit: false, reason: null };
    {
        const r = stateChipLock('post_tip', open, { ...S0, postTip: true });
        assert.equal(r.lit, true);
        assert.equal(r.hint, 'He just tipped — thank him');
    }
    {
        const r = stateChipLock('post_purchase', open, {
            ...S0,
            postPurchase: true,
        });
        assert.equal(r.lit, true);
        assert.equal(r.hint, 'He bought the PPV — follow up');
    }
    assert.equal(
        stateChipLock('post_tip', open, { ...S0, postTip: true, support: true })
            .lit,
        true,
    );
    assert.equal(
        stateChipLock(
            'post_tip',
            { enabled: false, lit: false, reason: 'Sending…' },
            { ...S0, postTip: true },
        ).lit,
        false,
    );
    assert.equal(stateChipLock('post_tip', open, S0).lit, false);
    {
        const r = stateChipLock('aftersale', open, { ...S0, aftersale: true });
        assert.equal(r.lit, true);
        assert.equal(
            r.hint,
            'He said no to the PPV — wrap up warmly (After a no)',
        );
    }
    {
        const r = stateChipLock('hook', open, { ...S0, hook: true });
        assert.equal(r.lit, true);
        assert.equal(r.hint, 'New subscriber — say hi');
    }
    assert.equal(
        stateChipLock('post_purchase', open, { ...S0, postTip: true }).lit,
        false,
    );
}

console.log('state-check: all assertions passed');
