'use strict';
/* Proves an INTENT BUTTON directive (PHP puts it in `context`) rides legacy's AGENT OVERRIDE channel
 * unchanged: it lands in BOTH the strategy and generator prompts, a creator-last thread gets the
 * follow-up note's facts-only override variant, and no context means no override block at all. */
const assert = require('assert');
const { generateDraft } = require('./runGenerate');

const fakeStrategy = {
    tone: 'warm', phase: 'rapport', promise_status: 'not_started', next_move_after_wall: 'continue_climb',
    message_length: 'short', caption_required: false, agent_override_active: false, trust_level: 1,
    archetype: 'Explorer', temperature: 'cold', message_purpose: 'x', skeleton_step: 'Chit Chat',
};
const DIRECTIVE = 'INTENT BUTTON — Re-pitch: He has not opened the PPV already sent in this chat ($21, locked, 2 messages ago). Write ONE message that gets him to open THAT PPV.';
const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();

async function prompts(context, messages) {
    const out = { strategy: '', generator: '' };
    const flat = (x) => (Array.isArray(x) ? x.map((b) => b.text || '').join('\n') : String(x));
    const callApi = async (sys, user, _m, _f, tag) => {
        const t = String(tag);
        if (t.startsWith('strategy')) out.strategy = flat(sys) + '\n' + flat(user);
        if (t.startsWith('generator')) out.generator = flat(sys) + '\n' + flat(user);
        return t.startsWith('strategy') ? JSON.stringify(fakeStrategy) : 'hey you';
    };
    await generateDraft({
        model: { name: 'Camila', prompt: 'You are Camila.', content_library: '', feedback_rules: '' },
        session: {
            id: 'int', creator_model: 'Camila', customer_name: 'Jake', customer_username: 'jake_w',
            subscription_status: 'subscribed', total_spend: '$0', tips_spend: '$0', crm_notes: '', vn_used: [],
            inputMode: 'chat', messages,
        },
        creatorStatus: [], api: 'claude', sender: 'customer', context,
    }, { callApi, callMistral: async () => 'hola' });
    return out;
}

const fanLast = [
    { sender: 'model', text: 'hey', ts_iso: iso(30) },
    { sender: 'customer', text: 'hi there', ts_iso: iso(5) },
];
const creatorLast = [
    { sender: 'customer', text: 'hi there', ts_iso: iso(60) },
    { sender: 'model', text: 'how was your day?', ts_iso: iso(5) },
];

(async () => {
    const a = await prompts(DIRECTIVE, fanLast);
    const sAt = a.strategy.indexOf('AGENT OVERRIDE — AUTHORITATIVE FOR THIS TURN');
    assert.ok(sAt >= 0, 'strategy prompt has the override block');
    assert.ok(a.strategy.indexOf(DIRECTIVE, sAt) > sAt, 'directive inside the strategy override block');
    const gAt = a.generator.indexOf('AGENT OVERRIDE — AUTHORITATIVE');
    assert.ok(gAt >= 0, 'generator prompt has the override block');
    assert.ok(a.generator.indexOf(DIRECTIVE, gAt) > gAt, 'directive inside the generator override block');

    // Creator spoke last + directive → facts-only note, not the full rules.
    const b = await prompts(DIRECTIVE, creatorLast);
    for (const p of [b.strategy, b.generator]) {
        assert.ok(p.includes('FOLLOW-UP'), 'follow-up note present');
        assert.ok(p.includes('What this message does is set by the AGENT OVERRIDE above'), 'override variant used');
        assert.ok(!p.includes('Do NOT answer, react to, or continue them'), 'full rules NOT used');
    }
    // Control: same thread without a directive gets the full rules.
    const c = await prompts('', creatorLast);
    assert.ok(c.generator.includes('Do NOT answer, react to, or continue them'), 'control: full rules without override');

    // No context → no override block.
    const d = await prompts('', fanLast);
    assert.ok(!d.strategy.includes('AGENT OVERRIDE — AUTHORITATIVE') && !d.generator.includes('AGENT OVERRIDE — AUTHORITATIVE'), 'empty context → no override block');

    console.log('✓ intent_check: intent directive reaches both override blocks; follow-up uses its override variant; empty context adds no block');
})().catch((e) => { console.error('INTENT_CHECK FAILED:', e.message); process.exit(1); });
