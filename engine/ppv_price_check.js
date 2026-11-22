'use strict';
/* Proves the PPV price suggestion comes back with a caption. With a set loaded the controller sends
 * `sender:'ppv'`, and legacy's own `fetchPpvSuggestion` (tag 'price_ppv') fires after the caption.
 * runGenerate.js must (a) let that call reach the model in caption mode only, (b) tell it what is
 * in the set (`ppvMedia` counts, never the set's name or price), (c) wait for it and return
 * `ppvSuggestion`, and (d) never let a hung price call fail the caption. A normal reply makes no
 * price call and returns `ppvSuggestion: null`. */
const assert = require('assert');
const { generateDraft } = require('./runGenerate');

const fakeStrategy = {
    tone: 'warm', phase: 'rapport', promise_status: 'not_started', next_move_after_wall: 'continue_climb',
    message_length: 'short', caption_required: false, agent_override_active: false, trust_level: 1,
    archetype: 'Explorer', temperature: 'cold', message_purpose: 'x', skeleton_step: 'Chit Chat',
};
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const thread = [
    { sender: 'customer', text: 'show me something', ts_iso: ago(30) },
    { sender: 'model', text: 'you sure you can handle it? 😏', ts_iso: ago(5) },
];

/** One generation; `price` is the fake model's answer to price_ppv (string or a Promise). */
async function run({ sender = 'ppv', price = '{"price":14,"reason":"cold lurker, first PPV"}', ppvMedia, session = {}, opts = {} } = {}) {
    const seen = [];
    const flat = (x) => (Array.isArray(x) ? x.map((b) => b.text || '').join('\n') : String(x));
    const callApi = async (sys, user, _m, _f, tag) => {
        seen.push({ tag: String(tag), user: flat(user) });
        if (String(tag) === 'price_ppv') return price;
        return String(tag).startsWith('strategy') ? JSON.stringify(fakeStrategy) : 'i got a little carried away 🙈';
    };
    const out = await generateDraft({
        model: { name: 'Camila', prompt: 'You are Camila.', content_library: '', feedback_rules: '' },
        session: {
            id: 'price', creator_model: 'Camila', customer_name: 'Jake', customer_username: 'jake_w',
            subscription_status: 'subscribed', total_spend: '$0', tips_spend: '$0', crm_notes: '', vn_used: [],
            inputMode: 'chat', messages: thread, ...session,
        },
        creatorStatus: [], api: 'claude', sender, context: '', ppvMedia,
    }, { callApi, callMistral: async () => 'hola', ...opts });
    return { out, prices: seen.filter((c) => c.tag === 'price_ppv') };
}

const BLOCK = 'THE PPV BEING SENT (the content this price is for): ';

(async () => {
    // ok
    let r = await run({ ppvMedia: { photo: 3, video: 1 } });
    assert.strictEqual(r.prices.length, 1, 'ok: exactly one price_ppv call');
    assert.ok(r.prices[0].user.includes(BLOCK + '3 photos, 1 video'), 'ok: the set contents reach the price prompt');
    assert.deepStrictEqual(r.out.ppvSuggestion, { price: 14, reason: 'cold lurker, first PPV' }, 'ok: suggestion returned');

    // singular
    r = await run({ ppvMedia: { photo: 1 } });
    assert.ok(r.prices[0].user.includes(BLOCK + '1 photo') && !r.prices[0].user.includes(BLOCK + '1 photos'), 'singular: 1 photo');
    assert.ok(!r.prices[0].user.split(BLOCK)[1].includes('video'), 'singular: no video');

    // no media
    r = await run({});
    assert.ok(!r.prices[0].user.includes('THE PPV BEING SENT'), 'no media: no contents block');

    // sexting (legacy's ×1.25, untouched)
    r = await run({ price: '{"price":20,"reason":"warm"}', session: { _sextingModeToggle: 'FORCE_ON' } });
    assert.strictEqual(r.out.ppvSuggestion.price, 25, 'sexting: ×1.25');
    assert.ok(r.out.ppvSuggestion.reason.includes('sexting × 1.25'), 'sexting: reason notes the multiplier');

    // garbage
    r = await run({ price: 'not json' });
    assert.strictEqual(typeof r.out.ppvSuggestion.error, 'string', 'garbage: error string');
    assert.ok(!('price' in r.out.ppvSuggestion), 'garbage: no price');

    // hung price call
    r = await run({ price: new Promise(() => {}), opts: { priceTimeoutMs: 50 } });
    assert.ok(r.out.draft, 'hung: the caption still returns');
    assert.ok(/timed out/.test(r.out.ppvSuggestion.error || ''), 'hung: timed-out error');

    // reply
    r = await run({ sender: 'customer' });
    assert.strictEqual(r.prices.length, 0, 'reply: no price_ppv call reaches the model');
    assert.strictEqual(r.out.ppvSuggestion, null, 'reply: ppvSuggestion is null');

    console.log('✓ ppv_price_check: caption mode returns legacy\'s price suggestion (set contents in the prompt, hung call tolerated); replies make no price call');
})().catch((e) => { console.error('PPV_PRICE_CHECK FAILED:', e.message); process.exit(1); });
