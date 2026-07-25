'use strict';
/* Verifies the engine surfaces the carry-forward telemetry fields Package A persists:
 * lastAnalysis (folded analysis), nextPlannedMove/at-msg, promiseStatus, storyFrameworkStep. */
const assert = require('assert');
const { generateDraft } = require('./runGenerate');

const fakeStrategy = {
    tone: 'warm', phase: 'rapport', promise_status: 'not_started',
    strategy: 'build rapport', next_move: 'ask a warm question', next_move_after_wall: 'continue_climb',
    message_length: 'short', caption_required: false, agent_override_active: false,
    trust_level: 2, archetype: 'Explorer', temperature: 'warm', message_purpose: 'deepen rapport',
    skeleton_step: 'Chit Chat',
    next_planned_move: 'run_promise_ritual',
};
const callApi = async (_s, _u, _m, _f, t) => (t && String(t).startsWith('strategy')) ? JSON.stringify(fakeStrategy) : 'hey you 🙈';
const callMistral = async () => 'hola 🙈';

(async () => {
    const out = await generateDraft({
        model: { name: 'Camila', prompt: 'You are Camila.', content_library: '', feedback_rules: '' },
        session: {
            id: 'state-1', creator_model: 'Camila', customer_name: 'Jake', customer_username: 'jake_w',
            subscription_status: 'subscribed', total_spend: '$0', tips_spend: '$0', crm_notes: '', vn_used: [],
            inputMode: 'chat',
            _promiseStatus: 'in_progress', _storyFrameworkStep: 2,
            messages: [{ sender: 'customer', text: 'hey', ts_iso: new Date().toISOString() }],
        },
        creatorStatus: [], api: 'claude', sender: 'customer', context: '',
    }, { callApi, callMistral });

    const t = out.telemetry;
    assert.ok(t && typeof t === 'object', 'telemetry present');
    assert.ok('lastAnalysis' in t, 'telemetry.lastAnalysis key present');
    assert.strictEqual(t.lastAnalysis && t.lastAnalysis.archetype, 'Explorer', 'folded analysis carries archetype');
    assert.strictEqual(t.nextPlannedMove, 'run_promise_ritual', 'nextPlannedMove reflects this turn\'s planned move');
    assert.ok('nextPlannedMoveAtMsg' in t, 'telemetry.nextPlannedMoveAtMsg key present');
    // Proves promiseStatus/storyFrameworkStep are wired to real session values via the
    // _pendingPassCAdvance-first fallback chain (mirrors nextPlannedMove above). Fully
    // exercising a gated promise/story *advance* (i.e. _pendingPassCAdvance actually
    // populated) is a live-test item — the doctrine gates make it impractical to force
    // deterministically in this synthetic harness; the sourcing correctness itself is
    // code-verified against the browser accept handler (legacy/js/app.js:2814-2820).
    assert.strictEqual(t.promiseStatus, 'in_progress', 'promiseStatus surfaces the session value');
    assert.strictEqual(t.storyFrameworkStep, 2, 'storyFrameworkStep surfaces the session value');
    console.log('✓ state_check: carry-forward telemetry fields present');
})().catch((e) => { console.error('STATE_CHECK FAILED:', e.message); process.exit(1); });
