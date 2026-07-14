'use strict';
/* Concurrency guard: two generateDraft() calls running at the same time (two
 * different chats) must NOT leak state into each other. Each call gets its own
 * injected transport; the draft that chat A gets back must have come from A's
 * transport, and B's from B's. Before the per-request context isolation fix the
 * two runs shared one VM context, so the second call clobbered the first's
 * globals (callApi / activeId / sessions) mid-flight and A came back with B's
 * draft. This script reproduces that and fails if isolation ever regresses. */
const { generateDraft } = require('./runGenerate');

const fakeStrategy = {
    last_message_read: 'warm, engaged', customer_intent: 'chat', customer_language: 'english',
    tone: 'playful', phase: 'rapport', ritual_step: 'engage', promise_status: 'not_started',
    unlocked_tier: 'standard', strategy: 'build rapport', next_move: 'ask a question',
    next_move_after_wall: 'continue_climb', message_length: 'short', caption_required: false,
    price_rule: 'n/a', content_safety_check: 'n/a', agent_override_active: false,
    trust_level: 2, archetype: 'Explorer', temperature: 'warm', message_purpose: 'rapport',
    skeleton_step: 'Chit Chat',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Each concurrent run gets its OWN transport. The strategy call is deliberately
// slow so the two runs overlap: run A issues its strategy call and suspends,
// run B then starts and (under the old shared-context bug) overwrites the global
// callApi, so when A wakes to make its DRAFT call it would reach B's transport.
function makeFakeApi(marker) {
    return async (_system, _user, _maxTokens, _forceModel, callType) => {
        if (callType && String(callType).startsWith('strategy')) {
            await sleep(40);
            return JSON.stringify(fakeStrategy);
        }
        return 'DRAFT_FROM_' + marker;
    };
}
const fakeMistral = async () => 'draft';

function makeInput(name, id) {
    return {
        model: {
            name,
            prompt: `You are ${name}, a warm playful creator. Lowercase casual texting.`,
            content_library: 'Tier 1 ($15-25): solo teasing photos.',
            feedback_rules: '',
        },
        session: {
            id,
            creator_model: name,
            customer_name: 'Fan-' + name,
            customer_username: 'fan_' + name,
            subscription_status: 'subscribed',
            time_on_page: '10m', total_spend: '$0', tips_spend: '$0', crm_notes: '', vn_used: [],
            inputMode: 'chat',
            _profile: { trust_level: 2, archetype: 'Explorer', temperature: 'warm', total_spend: 0, tips_spend: 0, key_details: '' },
            messages: [
                { sender: 'customer', text: 'hey how are you', ts_iso: new Date(Date.now() - 600000).toISOString() },
                { sender: 'model', text: 'heyy im good 🙈 you?', ts_iso: new Date(Date.now() - 540000).toISOString() },
                { sender: 'customer', text: 'good, glad to talk to you', ts_iso: new Date(Date.now() - 60000).toISOString() },
            ],
        },
        creatorStatus: [{ category: 'mood', status_text: 'lazy sunday', created_at: new Date().toISOString() }],
        api: 'claude', sender: 'customer', context: '',
    };
}

(async () => {
    const [outA, outB] = await Promise.all([
        generateDraft(makeInput('Aria', 'concurrent-A'), { callApi: makeFakeApi('A'), callMistral: fakeMistral }),
        generateDraft(makeInput('Bella', 'concurrent-B'), { callApi: makeFakeApi('B'), callMistral: fakeMistral }),
    ]);

    let failed = false;
    if (outA.draft !== 'DRAFT_FROM_A') {
        console.error(`✗ FAIL: chat A got "${outA.draft}" (expected DRAFT_FROM_A) — engine state leaked across concurrent generations`);
        failed = true;
    }
    if (outB.draft !== 'DRAFT_FROM_B') {
        console.error(`✗ FAIL: chat B got "${outB.draft}" (expected DRAFT_FROM_B) — engine state leaked across concurrent generations`);
        failed = true;
    }
    if (failed) process.exit(1);
    console.log('✓ concurrent generations stayed isolated (A→A, B→B)');
})().catch((e) => { console.error('CONCURRENCY CHECK FAILED:', e.message); console.error((e.stack || '').split('\n').slice(0, 8).join('\n')); process.exit(1); });
