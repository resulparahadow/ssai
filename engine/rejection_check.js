'use strict';
/* Proves the engine consumes the rejected drafts PHP sends (DraftRejectionService →
 * session._sessionFeedback) and prints them the way legacy's "Feedback → Submit & Reject"
 * did. Guards the key names: legacy reads `f.rejectedMsg.slice(0,100)` + `f.feedback`, so a
 * renamed key would throw mid-generate or print "undefined" to the AI. */
const assert = require('assert');
const { generateDraft } = require('./runGenerate');

const fakeStrategy = {
    tone: 'warm', phase: 'rapport', promise_status: 'not_started', next_move_after_wall: 'continue_climb',
    message_length: 'short', caption_required: false, agent_override_active: false, trust_level: 1,
    archetype: 'Explorer', temperature: 'cold', message_purpose: 'x', skeleton_step: 'Chit Chat',
};

async function generatorPrompt(sessionFeedback) {
    let prompt = '';
    const flat = (x) => (Array.isArray(x) ? x.map((b) => b.text || '').join('\n') : String(x));
    const callApi = async (sys, user, _m, _f, tag) => {
        if (String(tag).startsWith('generator')) prompt = flat(user);
        return String(tag).startsWith('strategy') ? JSON.stringify(fakeStrategy) : 'hey you';
    };
    await generateDraft({
        model: { name: 'Camila', prompt: 'You are Camila.', content_library: '', feedback_rules: '' },
        session: {
            id: 'rej', creator_model: 'Camila', customer_name: 'Jake', customer_username: 'jake_w',
            subscription_status: 'subscribed', total_spend: '$0', tips_spend: '$0', crm_notes: '', vn_used: [],
            inputMode: 'chat', _sessionFeedback: sessionFeedback,
            messages: [{ sender: 'customer', text: 'hey', ts_iso: new Date().toISOString() }],
        },
        creatorStatus: [], api: 'claude', sender: 'customer', context: '',
    }, { callApi, callMistral: async () => 'hola' });
    return prompt;
}

(async () => {
    const long = 'want to see something really special that I made just for you tonight? it is the hottest thing I have ever filmed';
    const p = await generatorPrompt([
        { feedback: "don't sell, ask about his dog", rejectedMsg: long },
        { feedback: 'too needy', rejectedMsg: 'miss you so much' },
    ]);

    assert.ok(p.includes('REJECTED RESPONSES IN THIS SESSION'), 'rejection block present');
    assert.ok(p.includes(`Rejection 1: "${long.slice(0, 100)}" — Agent feedback: don't sell, ask about his dog`), 'first rejection, draft cut to 100 chars');
    assert.ok(p.includes('Rejection 2: "miss you so much" — Agent feedback: too needy'), 'second rejection in order');

    // No rejections (the default PHP sends) → no block, exactly as before.
    assert.ok(!(await generatorPrompt([])).includes('REJECTED RESPONSES'), 'empty list → no block');

    console.log('✓ rejection_check: _sessionFeedback {feedback, rejectedMsg} reaches the generator prompt');
})().catch((e) => { console.error('REJECTION_CHECK FAILED:', e.message); process.exit(1); });
