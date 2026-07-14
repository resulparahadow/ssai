'use strict';
/**
 * Host driver: runs the REAL legacy generate() / runAnalysis() with injected
 * I/O. The host (Laravel) passes a legacy-shaped `session` + `model` (mapped from
 * MySQL on its side) and the engine returns the draft + strategy + telemetry +
 * captured DB writes — without any DOM or Supabase.
 */
const { createEngine, makeSbCapture } = require('./loadEngine');
const { makeRealCallApi, makeRealCallMistral } = require('./callModel');

/**
 * @param {object} input
 *   session: legacy session object (creator_model, customer_*, messages[], _profile, inputMode, _sextingModeToggle, ...)
 *   model: legacy persona ({ name, prompt, content_library, feedback_rules })
 *   creatorStatus: array of creator_status rows
 *   api: 'claude' | 'auto' | 'mistral'   (default 'claude')
 *   sender: 'customer' | 'ppv' | ...      (currentSender; 'ppv' = PPV caption mode)
 *   context: agent override box text
 *   pasteInput: raw text (only used when session.inputMode === 'paste')
 *   doctrine: optional doctrine override (defaults to the legacy DEFAULT_TRAINING constant)
 * @param {object} [opts] { callApi, callMistral } injected for tests
 */
async function generateDraft(input, opts = {}) {
    const { eng, document } = createEngine();
    if (!input || !input.session || !input.model) throw new Error('generateDraft: input.session and input.model are required');

    const sid = String(input.session.id || 'engine-session');
    const session = { ...input.session };
    session.creator_model = session.creator_model || input.model.name;
    session.messages = session.messages || [];
    if (!('inputMode' in session)) session.inputMode = 'chat';

    const writes = [];
    const sb = makeSbCapture(writes);

    eng.set('models', [input.model]);
    eng.set('sessions', { [sid]: session });
    eng.set('activeId', sid);
    eng.set('api', input.api || 'claude');
    eng.set('currentSender', input.sender || 'customer');
    eng.set('respCount', 0);
    eng.set('sb', sb);
    if (input.doctrine) eng.set('globalTraining', input.doctrine);

    // Serve creator status from the payload instead of Supabase.
    eng.set('fetchActiveCreatorStatus', async () => input.creatorStatus || []);

    // Per-request usage ledger (one entry per LLM call, incl. retries) — mirrors the legacy
    // _ssaiCostLog. Only the real transports record; injected test fakes don't.
    const usage = [];

    // Model transport (real by default; tests inject fakes).
    eng.set('callApi', opts.callApi || makeRealCallApi(usage));
    eng.set('callMistral', opts.callMistral || makeRealCallMistral(usage));

    // DOM-fed inputs.
    document.getElementById('ctxIn').value = input.context || '';
    if (session.inputMode === 'paste') document.getElementById('pasteInput').value = input.pasteInput || '';

    await eng.generate();

    const s = eng.get('sessions')[sid];
    if (!s) throw new Error('engine: session was dropped during generate()');

    let strategy = s._lastStrategy || null;
    if (!strategy && s._lastStrategyRaw) {
        try { strategy = JSON.parse(String(s._lastStrategyRaw).replace(/```json|```/g, '').trim()); } catch (_) { /* leave null */ }
    }

    return {
        draft: s.draft || '',
        strategy,
        telemetry: {
            posture: s._posture ?? null,
            customerTier: s._customerTier ?? null,
            freeMsgCount: s._freeMsgCount ?? null,
            unpaidCtaCount: s._unpaidCtaCount ?? null,
            sextingActive: !!s._sextingActive,
            tipPrimary: !!s._tipPrimary,
            promiseStatus: s._promiseStatus ?? null,
            storyFrameworkStep: s._storyFrameworkStep ?? null,
            draftBy: s._draftBy ?? null,
            draftRoute: s._draftRoute ?? null,
            draftIsPpv: !!s._draftIsPpv,
            ppvOverrodeBrain: s._ppvOverrodeBrain ?? null,
            tosWarning: s._tosWarning ?? null,
            registerHits: s._registerHitsFirstPass ?? null,
            reasoningLeakStripped: s._reasoningLeakStripped ?? null,
        },
        usage,
        writes,
    };
}

module.exports = { generateDraft };
