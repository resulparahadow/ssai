'use strict';
/* Proves `sender: 'ppv'` reaches legacy's PPV CAPTION MODE. The Conversations PPV rail loads a
 * saved set and the chatter clicks "Generate caption": the controller forwards `sender:'ppv'`
 * and the generator must (a) carry legacy's "PPV CAPTION MODE — OVERRIDES EVERYTHING ELSE"
 * directive, (b) NOT carry the FOLLOW-UP note even when the creator spoke last (a caption is
 * not a reply — runGenerate.js skips the wrapper), and (c) leave a normal `customer` run
 * byte-identical in the other direction (caption directive absent, follow-up note present). */
const assert = require('assert');
const { generateDraft } = require('./runGenerate');

const fakeStrategy = {
    tone: 'warm', phase: 'rapport', promise_status: 'not_started', next_move_after_wall: 'continue_climb',
    message_length: 'short', caption_required: false, agent_override_active: false, trust_level: 1,
    archetype: 'Explorer', temperature: 'cold', message_purpose: 'x', skeleton_step: 'Chit Chat',
};
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const fan = (text, min) => ({ sender: 'customer', text, ts_iso: ago(min) });
const her = (text, min) => ({ sender: 'model', text, ts_iso: ago(min) });

/** Runs one generation; returns every LLM call as { tag, system, user }. */
async function calls(messages, sender) {
    const seen = [];
    const flat = (x) => (Array.isArray(x) ? x.map((b) => b.text || '').join('\n') : String(x));
    const callApi = async (sys, user, _m, _f, tag) => {
        seen.push({ tag: String(tag), system: flat(sys), user: flat(user) });
        return String(tag).startsWith('strategy') ? JSON.stringify(fakeStrategy) : 'i got a little carried away 🙈';
    };
    const callMistral = async () => 'hola';
    await generateDraft({
        model: { name: 'Camila', prompt: 'You are Camila.', content_library: '', feedback_rules: '' },
        session: {
            id: 'cap', creator_model: 'Camila', customer_name: 'Jake', customer_username: 'jake_w',
            subscription_status: 'subscribed', total_spend: '$0', tips_spend: '$0', crm_notes: '', vn_used: [],
            inputMode: 'chat', messages,
        },
        creatorStatus: [], api: 'claude', sender, context: '',
    }, { callApi, callMistral });
    return seen;
}

const CAPTION = 'PPV CAPTION MODE';
const NOTE = 'FOLLOW-UP';
// The creator spoke last, so a normal reply would get the follow-up note.
const thread = [fan('show me something', 30), her('you sure you can handle it? 😏', 5)];

(async () => {
    const ppv = await calls(thread, 'ppv');
    const gen = ppv.filter((c) => c.tag.startsWith('generator'));
    assert.ok(gen.length, 'ppv: a generator call ran');
    for (const c of gen) {
        assert.ok((c.system + c.user).includes(CAPTION), `${c.tag}: carries the PPV caption directive`);
    }
    for (const c of ppv) {
        assert.ok(!(c.system + c.user).includes(NOTE), `${c.tag}: no follow-up note in caption mode`);
    }
    // Legacy fires fetchPpvSuggestion (tag 'price_ppv') after a PPV-mode generate; the engine
    // never returns `_ppvSuggestion`, so that call would be billed and thrown away.
    await new Promise((r) => setTimeout(r, 50)); // it is fire-and-forget in legacy
    assert.ok(!ppv.some((c) => c.tag === 'price_ppv'), 'no price_ppv call reaches the model in caption mode');

    const reply = await calls(thread, 'customer');
    const rgen = reply.filter((c) => c.tag.startsWith('generator'));
    assert.ok(rgen.length, 'customer: a generator call ran');
    for (const c of rgen) {
        assert.ok(!(c.system + c.user).includes(CAPTION), `${c.tag}: no caption directive on a reply`);
        assert.ok(c.user.includes(NOTE), `${c.tag}: reply to a creator-last thread carries the follow-up note`);
    }

    console.log('✓ ppv_caption_check: sender=ppv → PPV CAPTION MODE on the generator, no follow-up note; sender=customer unchanged');
})().catch((e) => { console.error('PPV_CAPTION_CHECK FAILED:', e.message); process.exit(1); });
