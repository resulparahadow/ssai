'use strict';
/* Proves the engine's clock follows the CREATOR's timezone (`input.timezone`), not the
 * host's. Legacy read `new Date()` in the chatter's browser, so the "current time" lines
 * in the prompts were local; the engine container runs on UTC, which put a US creator's
 * lunchtime in the "EARLY EVENING block". Each generation gets its own VM context, so the
 * zone is applied per request — two concurrent generations in different zones must not
 * see each other's clock. Also guards that PHP's per-message `ts` prints as "[9:02 AM]". */
const assert = require('assert');
const { generateDraft } = require('./runGenerate');

const fakeStrategy = {
    tone: 'warm', phase: 'rapport', promise_status: 'not_started', next_move_after_wall: 'continue_climb',
    message_length: 'short', caption_required: false, agent_override_active: false, trust_level: 1,
    archetype: 'Explorer', temperature: 'cold', message_purpose: 'x', skeleton_step: 'Chit Chat',
};

/** Runs one generation and returns every prompt the pipeline built, joined. */
async function prompts(timezone) {
    const seen = [];
    const flat = (x) => (Array.isArray(x) ? x.map((b) => b.text || '').join('\n') : String(x));
    const callApi = async (sys, user, _m, _f, tag) => {
        seen.push(flat(sys) + '\n' + flat(user));
        return String(tag).startsWith('strategy') ? JSON.stringify(fakeStrategy) : 'hey you';
    };
    await generateDraft({
        model: { name: 'Camila', prompt: 'You are Camila.', content_library: '', feedback_rules: '' },
        session: {
            id: 'tz-' + timezone, creator_model: 'Camila', customer_name: 'Jake', customer_username: 'jake_w',
            subscription_status: 'subscribed', total_spend: '$0', tips_spend: '$0', crm_notes: '', vn_used: [],
            inputMode: 'chat',
            messages: [{ sender: 'customer', text: 'good morning', ts: '9:02 AM', ts_iso: new Date().toISOString() }],
        },
        creatorStatus: [], api: 'claude', sender: 'customer', context: '', timezone,
    }, { callApi, callMistral: async () => 'hola' });
    return seen.join('\n');
}

/** What legacy's two time lines should say for `timezone` (undefined = host zone). */
function expected(timezone) {
    const now = new Date();
    const o = (x) => ({ ...x, timeZone: timezone });
    return {
        // "=== CURRENT TIME CONTEXT ===" line (legacy app.js ~5803)
        block: now.toLocaleDateString('en-US', o({ weekday: 'long' })) + ', '
            + now.toLocaleDateString('en-US', o({ month: 'long', day: 'numeric', year: 'numeric' })),
        // "Current local time:" line (legacy app.js ~6325)
        local: 'Current local time: ' + now.toLocaleDateString('en-US', o({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })),
        hour: Number(new Intl.DateTimeFormat('en-US', o({ hour: 'numeric', hourCycle: 'h23' })).format(now)),
    };
}

function timeBlock(all) {
    const m = all.match(/=== CURRENT TIME CONTEXT[^\n]*\n([^\n]*)/);
    assert.ok(m, 'time-context block present');
    return m[1];
}

(async () => {
    // UTC+14 and UTC-11 are 25h apart, so they are ALWAYS on different calendar days —
    // a clock leaking between the two runs cannot pass by coincidence.
    const east = 'Pacific/Kiritimati';
    const west = 'Pacific/Pago_Pago';
    const [a, b] = await Promise.all([prompts(east), prompts(west)]);

    for (const [tz, all] of [[east, a], [west, b]]) {
        const exp = expected(tz);
        const block = timeBlock(all);
        assert.ok(block.startsWith(exp.block), `${tz}: time block "${block}" should start with "${exp.block}"`);
        const hh = Number(block.split(' · ')[1].slice(0, 2));
        assert.ok(hh === exp.hour || hh === (exp.hour + 23) % 24, `${tz}: block hour ${hh} should be the zone's hour ${exp.hour}`);
        assert.ok(all.includes(exp.local), `${tz}: strategy prompt should say "${exp.local}"`);
    }
    assert.notStrictEqual(timeBlock(a).split(' · ')[0], timeBlock(b).split(' · ')[0], 'the two zones see different dates');

    // No timezone → the host clock, exactly as before (parity for callers that don't send one).
    assert.ok(timeBlock(await prompts(undefined)).startsWith(expected(undefined).block), 'no timezone → host clock');

    // PHP's per-message stamp reaches the transcript in legacy's "[9:02 AM] CUSTOMER:" form.
    assert.ok(a.includes('[9:02 AM] CUSTOMER: good morning'), 'per-message ts prints in the transcript');

    console.log('✓ tz_check: engine clock follows input.timezone per request (isolated), message stamps print');
})().catch((e) => { console.error('TZ_CHECK FAILED:', e.message); process.exit(1); });
