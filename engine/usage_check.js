'use strict';
/* Usage-ledger check: stub fetch, drive the real makeRealCallApi/makeRealCallMistral
 * transports, and assert each records a ledger entry with the legacy cost math.
 * No network, no real keys. Run: node engine/usage_check.js */
process.env.ANTHROPIC_API_KEY = 'test';
process.env.OPENROUTER_API_KEY = 'test';
process.env.ANTHROPIC_MODEL = 'claude-sonnet-4-6';
process.env.OPENROUTER_MODEL = 'mistralai/mistral-nemo';

const { makeRealCallApi, makeRealCallMistral } = require('./callModel');

function assert(cond, msg) { if (!cond) { console.error('✗ FAIL:', msg); process.exit(1); } }
function near(a, b) { return Math.abs(a - b) < 1e-9; }

(async () => {
    // --- Anthropic ---
    globalThis.fetch = async () => ({
        status: 200,
        json: async () => ({
            usage: { input_tokens: 1000, cache_read_input_tokens: 5000, cache_creation_input_tokens: 0, output_tokens: 200 },
            content: [{ text: 'hi babe' }],
        }),
    });
    const ledger = [];
    const callApi = makeRealCallApi(ledger);
    const sys = [{ type: 'text', text: 'x'.repeat(8000), cache_control: { type: 'ephemeral' } }];
    const text = await callApi(sys, 'user msg', 200, 'sonnet', 'strategy_sonnet');
    assert(text === 'hi babe', 'callApi returns the text');
    assert(ledger.length === 1, 'one ledger entry recorded');
    const e = ledger[0];
    // legacy Sonnet math: (1000*3 + 5000*0.3)/1e6 + (200*15)/1e6 = 0.0045 + 0.003
    assert(near(e.cost, 0.0075), `anthropic cost == 0.0075 (got ${e.cost})`);
    assert(e.cached === true && e.cacheRead === 5000, 'cached flag + cacheRead captured');
    assert(e.callType === 'strategy_sonnet' && e.modelUsed === 'claude-sonnet-4-6', 'callType + model captured');
    assert(e.sysBlocks[0].hasCacheControl === true && e.sysBlocks[0].estTokens === 2000, 'sysBlocks sized (8000 chars / 4)');

    // --- Mistral (OpenRouter exact cost) ---
    globalThis.fetch = async () => ({
        status: 200,
        json: async () => ({
            usage: { prompt_tokens: 1200, completion_tokens: 60, cost: 0.00021 },
            choices: [{ message: { content: 'hola guapo' } }],
        }),
    });
    const mistralLedger = [];
    const callMistral = makeRealCallMistral(mistralLedger);
    const mtext = await callMistral('persona', { phase: 'rapport' }, 'convo', 'Camila', 200, 'lib', '');
    assert(mtext === 'hola guapo', 'callMistral returns the text');
    assert(mistralLedger.length === 1, 'mistral ledger entry recorded');
    const m = mistralLedger[0];
    assert(m.callType === 'generator_mistral' && near(m.cost, 0.00021), 'mistral uses OpenRouter exact cost');
    assert(m.input === 1200 && m.output === 60 && m.cached === false, 'mistral tokens captured, not cached');

    console.log('✓ usage ledger: anthropic + mistral entries + cost math correct');
})().catch((e) => { console.error('USAGE CHECK FAILED:', e.message); process.exit(1); });
