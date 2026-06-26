'use strict';
/* Parity check: the engine assembles the strategy/generator prompts from the
 * EXACT legacy doctrine + persona. We record the args the real generate() passes
 * to callApi and assert byte-level inclusion of the doctrine and persona. */
const assert = require('assert');
const { generateDraft } = require('./runGenerate');
const { loadEngine } = require('./loadEngine');

const fakeStrategy = {
    last_message_read: 'warm reply', customer_intent: 'chat', customer_language: 'english',
    tone: 'warm', phase: 'rapport', ritual_step: 'engage', promise_status: 'not_started',
    unlocked_tier: 'standard', strategy: 'rapport', next_move: 'ask back', next_move_after_wall: 'continue_climb',
    message_length: 'short', caption_required: false, trust_level: 2, archetype: 'Explorer', temperature: 'warm',
};

(async () => {
    const { eng } = loadEngine();
    const DOCTRINE = eng.get('DEFAULT_TRAINING');
    const PERSONA = 'You are Camila, a warm playful creator. lowercase casual texting.';

    const calls = [];
    const recordCallApi = async (system, user, maxTokens, _f, callType) => {
        calls.push({ callType, system, user });
        return callType && String(callType).startsWith('strategy') ? JSON.stringify(fakeStrategy) : 'hey you, how was your day';
    };

    await generateDraft({
        model: { name: 'Camila', prompt: PERSONA, content_library: 'Tier 1 ($15): teasing pics.', feedback_rules: '' },
        session: {
            id: 'parity-1', creator_model: 'Camila', customer_name: 'Jake', customer_username: 'jake_w',
            subscription_status: 'subscribed', total_spend: '$0', tips_spend: '$0', inputMode: 'chat',
            _profile: { trust_level: 2, archetype: 'Explorer', temperature: 'warm', total_spend: 0, tips_spend: 0, key_details: '' },
            messages: [
                { sender: 'customer', text: 'hey camila how are you', ts_iso: new Date(Date.now() - 600000).toISOString() },
                { sender: 'model', text: 'heyy im good 🙈', ts_iso: new Date(Date.now() - 540000).toISOString() },
                { sender: 'customer', text: 'my day was long but better talking to you', ts_iso: new Date(Date.now() - 60000).toISOString() },
            ],
        },
        creatorStatus: [], api: 'claude', sender: 'customer', context: '',
    }, { callApi: recordCallApi, callMistral: async () => 'x' });

    const strat = calls.find((c) => String(c.callType).startsWith('strategy'));
    const gen = calls.find((c) => String(c.callType).startsWith('generator'));
    assert(strat, 'strategy call was made');
    assert(gen, 'generator call was made');

    // Strategy system block 0 = Layer 1 global agency training = exact doctrine.
    const layer1 = strat.system[0].text;
    assert(layer1.includes('=== LAYER 1: GLOBAL AGENCY TRAINING ==='), 'strategy Layer 1 header present');
    assert(layer1.includes(DOCTRINE), 'strategy Layer 1 contains the EXACT DEFAULT_TRAINING doctrine');
    assert(strat.system[0].cache_control && strat.system[0].cache_control.ttl === '1h', 'doctrine block is cache_control 1h');
    // Layer 2 = persona.
    assert(strat.system[1].text.includes(PERSONA), 'strategy Layer 2 contains the persona prompt');
    // Strategy user prompt carries the live conversation.
    assert(strat.user.includes('my day was long but better talking to you'), 'strategy prompt includes the latest customer message');

    // Generator system carries persona + TOS compliance block.
    const genSys = gen.system.map((b) => b.text).join('\n');
    assert(genSys.includes(PERSONA), 'generator system contains the persona');
    assert(genSys.includes('ABSOLUTE TOS COMPLIANCE'), 'generator system contains the TOS block');

    console.log('✓ parity: strategy Layer 1 === exact doctrine (' + DOCTRINE.length + ' chars), persona + conversation + TOS all present');
    console.log('  calls:', calls.map((c) => c.callType).join(', '));
})().catch((e) => { console.error('PARITY FAILED:', e.message); process.exit(1); });
