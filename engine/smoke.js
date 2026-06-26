'use strict';
/* Smoke test: run the REAL legacy generate() end-to-end with FAKE model calls
 * (no network). Proves the VM host + shims drive the unmodified pipeline. */
const { generateDraft } = require('./runGenerate');

const fakeStrategy = {
    last_message_read: 'he is responding warmly and asking about my day',
    customer_intent: 'continue conversation, light flirtation',
    customer_language: 'english',
    tone: 'warm, playful, flirty',
    phase: 'rapport',
    ritual_step: 'engage naturally, drop a light breadcrumb',
    promise_status: 'not_started',
    unlocked_tier: 'standard',
    strategy: 'build rapport and qualify investment before any pitch',
    next_move: 'ask a warm qualifying question back',
    next_move_after_wall: 'continue_climb',
    message_length: 'short',
    caption_required: false,
    price_rule: 'n/a',
    content_safety_check: 'n/a',
    agent_override_active: false,
    trust_level: 2,
    archetype: 'Explorer',
    temperature: 'warm',
    message_purpose: 'deepen rapport',
    skeleton_step: 'Chit Chat',
};

const fakeCallApi = async (_system, _user, _maxTokens, _forceModel, callType) => {
    if (callType && String(callType).startsWith('strategy')) return JSON.stringify(fakeStrategy);
    return 'hey you 🙈 i was literally just thinking about you... how was your day babe';
};
const fakeCallMistral = async () => 'hola guapo, te estaba pensando 🙈';

(async () => {
    const input = {
        model: {
            name: 'Camila',
            prompt: 'You are Camila, a warm playful 24yo Colombian creator. Lowercase casual texting. Flirty, never robotic.',
            content_library: 'Tier 1 ($15-25): solo teasing photos. Tier 2 ($30-50): solo videos. Tier 3 ($60+): customs.',
            feedback_rules: '',
        },
        session: {
            id: 'smoke-1',
            creator_model: 'Camila',
            customer_name: 'Jake',
            customer_username: 'jake_w',
            subscription_status: 'subscribed',
            time_on_page: '12m',
            total_spend: '$0',
            tips_spend: '$0',
            crm_notes: '',
            vn_used: [],
            inputMode: 'chat',
            _profile: { trust_level: 2, archetype: 'Explorer', temperature: 'warm', total_spend: 0, tips_spend: 0, key_details: '' },
            messages: [
                { sender: 'customer', text: 'hey camila how are you', ts_iso: new Date(Date.now() - 600000).toISOString() },
                { sender: 'model', text: 'heyy im good just woke up 🙈 how about you', ts_iso: new Date(Date.now() - 540000).toISOString() },
                { sender: 'customer', text: 'haha nice, my day was long but better now talking to you', ts_iso: new Date(Date.now() - 60000).toISOString() },
            ],
        },
        creatorStatus: [{ category: 'mood', status_text: 'lazy sunday at home', created_at: new Date().toISOString() }],
        api: 'claude',
        sender: 'customer',
        context: '',
    };

    const out = await generateDraft(input, { callApi: fakeCallApi, callMistral: fakeCallMistral });
    console.log('=== DRAFT ===\n' + out.draft);
    console.log('\n=== STRATEGY (phase) ===', out.strategy && out.strategy.phase);
    console.log('=== TELEMETRY ===', JSON.stringify(out.telemetry, null, 1));
    console.log('=== DB WRITES captured ===', out.writes.map((w) => w.table + '.' + w.op).join(', ') || '(none)');
    if (!out.draft) { console.error('\n✗ FAIL: empty draft'); process.exit(1); }
    console.log('\n✓ generate() ran end-to-end headless');
})().catch((e) => { console.error('SMOKE FAILED:', e.message); console.error(e.stack.split('\n').slice(0, 8).join('\n')); process.exit(1); });
