'use strict';
/* Proves the engine consumes the money-aware inputs LiveThreadMapper produces:
 * a ppv bubble + session tips flow through generate() and drive telemetry (tipPrimary). */
const assert = require('assert');
const { generateDraft } = require('./runGenerate');

const fakeStrategy = {
    tone: 'warm', phase: 'sell', promise_status: 'not_started',
    strategy: 'close', next_move: 'pitch', next_move_after_wall: 'continue_climb',
    message_length: 'short', caption_required: false, agent_override_active: false,
    trust_level: 3, archetype: 'Explorer', temperature: 'warm', message_purpose: 'close',
    skeleton_step: 'Sell',
};
const callApi = async (_s, _u, _m, _f, t) => (t && String(t).startsWith('strategy')) ? JSON.stringify(fakeStrategy) : 'open it for me babe 😏';
const callMistral = async () => 'ábrelo para mí 😏';

function baseInput(overrides) {
    return Object.assign({
        model: { name: 'Camila', prompt: 'You are Camila.', content_library: '', feedback_rules: '' },
        session: {
            id: 'money-1', creator_model: 'Camila', customer_name: 'Jake', customer_username: 'jake_w',
            subscription_status: 'subscribed', total_spend: '$0', tips_spend: '$0', crm_notes: '', vn_used: [],
            inputMode: 'chat', _tipModeToggle: 'AUTO',
            messages: [{ sender: 'customer', text: 'hey', ts_iso: new Date().toISOString() }],
        },
        creatorStatus: [], api: 'claude', sender: 'customer', context: '',
    }, overrides);
}

(async () => {
    // A: session with an opened ppv bubble + a tip → tipPrimary true, draft generated.
    const withMoney = baseInput({});
    withMoney.session = Object.assign({}, withMoney.session, {
        tips_spend: '$10', total_spend: '$20',
        messages: [
            { sender: 'ppv', text: 'unlock', opened: true, price: 20, ts_iso: new Date(Date.now() - 300000).toISOString() },
            { sender: 'customer', text: 'nice', ts_iso: new Date().toISOString() },
        ],
    });
    const a = await generateDraft(withMoney, { callApi, callMistral });
    assert.ok(a.draft && a.draft.length > 0, 'A: engine produced a draft from a ppv-bubble thread');
    assert.strictEqual(a.telemetry.tipPrimary, true, 'A: session tips drive tipPrimary=true');

    // B: no tips, no provider language → tipPrimary false (guards against always-true).
    const noMoney = baseInput({});
    const b = await generateDraft(noMoney, { callApi, callMistral });
    assert.strictEqual(b.telemetry.tipPrimary, false, 'B: no session spend → tipPrimary=false');

    console.log('✓ money_check: engine consumes session ppv/tip inputs (tipPrimary reacts, ppv thread runs)');
})().catch((e) => { console.error('MONEY_CHECK FAILED:', e.message); process.exit(1); });
