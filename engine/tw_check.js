'use strict';
/* Proves the engine consumes `_profile.is_timewaster`: a flagged fan lands on the
 * 'flagged_tw' posture tier (tight thresholds), an unflagged one does not. Guards the
 * PHP side (FanProfileService::toEngineProfile) against the flag silently doing nothing. */
const assert = require('assert');
const { generateDraft } = require('./runGenerate');

const fakeStrategy = {
    tone: 'warm', phase: 'build', promise_status: 'not_started',
    strategy: 'qualify', next_move: 'qualify', next_move_after_wall: 'continue_climb',
    message_length: 'short', caption_required: false, agent_override_active: false,
    trust_level: 1, archetype: 'Explorer', temperature: 'cold', message_purpose: 'qualify',
    skeleton_step: 'Build',
};
const callApi = async (_s, _u, _m, _f, t) => (t && String(t).startsWith('strategy')) ? JSON.stringify(fakeStrategy) : 'hey you 😊';
const callMistral = async () => 'hola 😊';

/** A brand-new fan (no spend, trust 1, no prior sessions) so `flagged_tw` is the ONLY
 *  thing that can move the tier off 'new' — otherwise the assertion proves nothing. */
function input(isTimewaster) {
    return {
        model: { name: 'Camila', prompt: 'You are Camila.', content_library: '', feedback_rules: '' },
        session: {
            id: 'tw-' + isTimewaster, creator_model: 'Camila', customer_name: 'Jake', customer_username: 'jake_w',
            subscription_status: 'subscribed', total_spend: '$0', tips_spend: '$0', crm_notes: '', vn_used: [],
            inputMode: 'chat',
            _profile: {
                trust_level: 1, archetype: 'Unknown', temperature: 'cold',
                total_spend: 0, tips_spend: 0, key_details: '', is_timewaster: isTimewaster,
            },
            messages: [{ sender: 'customer', text: 'hey', ts_iso: new Date().toISOString() }],
        },
        creatorStatus: [], api: 'claude', sender: 'customer', context: '',
    };
}

(async () => {
    const flagged = await generateDraft(input(true), { callApi, callMistral });
    assert.strictEqual(flagged.telemetry.customerTier, 'flagged_tw', 'flagged fan → flagged_tw tier');

    const clean = await generateDraft(input(false), { callApi, callMistral });
    assert.notStrictEqual(clean.telemetry.customerTier, 'flagged_tw', 'unflagged fan → not flagged_tw');
    assert.strictEqual(clean.telemetry.customerTier, 'new', 'unflagged new fan → new tier');

    console.log('✓ tw_check: engine reacts to _profile.is_timewaster (tier flips to flagged_tw)');
})().catch((e) => { console.error('TW_CHECK FAILED:', e.message); process.exit(1); });
