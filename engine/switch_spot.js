'use strict';
/* MANUAL spot check (not CI): runs the REAL model with one §5b state switch set per case, on an
 * invented thread built to test that switch, and prints the drafts so a human can judge each one
 * against its rule (engine/stateNote.js, spec §4):
 *   Lane rude:          calm and short, one boundary stated in plain words, no selling, no arguing or chasing.
 *   Support mode:       no selling at all (no CTA, PPV, tip ask, promise); help, reassure, be kind.
 *   Language ES:        the reply is in Spanish although the thread is English.
 *   Phase warm up:      short, light, friendly; no selling, no personal questions yet.
 *   Posture frame-hold: tease without confirming, withhold without rejecting; no free validation.
 * 2 drafts per case (~20 real AI calls). Needs ANTHROPIC_API_KEY (.env is auto-loaded like
 * engine/server.js). `--only="Lane rude"` runs one case: the provider can be slow, so run each
 * case in its own process. Every line printed is `[label #n] "<draft>"`. */
const fs = require('fs');
const path = require('path');

(function loadDotenvKeys() {
    const keys = ['ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'OPENROUTER_API_KEY', 'OPENROUTER_MODEL'];
    try {
        const env = fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8');
        for (const k of keys) {
            if (process.env[k]) continue;
            const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
            if (m) process.env[k] = m[1].trim().replace(/^["']|["']$/g, '');
        }
    } catch { /* no .env */ }
})();

if (!process.env.ANTHROPIC_API_KEY) {
    console.error('spot check not run — no ANTHROPIC_API_KEY');
    process.exit(2);
}

const { generateDraft } = require('./runGenerate');

const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
const fan = (text, ago) => ({ sender: 'customer', text, ts_iso: iso(ago) });
const her = (text, ago) => ({ sender: 'model', text, ts_iso: iso(ago) });

// Invented threads, one per switch premise.
const T = {
    rude: [
        fan('hey', 60),
        her('hey you 😊 how is your day going?', 56),
        fan('whatever. you girls are all the same', 40),
        her('aw what happened? 🥺', 36),
        fan("stop the fake sweet act, you're a bot and this whole thing is a scam. send something real or shut up", 3),
    ],
    support: [
        fan('hey, sorry i went quiet. rough week, my dad is in the hospital', 90),
        her("oh no, i'm so sorry 🥺 how is he doing?", 86),
        fan("stable now, thanks. just exhausted. anyway what do you have for me, show me something", 4),
    ],
    english: [
        fan('hey beautiful, how was your weekend?', 70),
        her('so good, went to the beach 😊 yours?', 66),
        fan('nice! mine was chill, watched football with friends. what are you doing tonight?', 5),
    ],
    warmUp: [
        fan('hi! just subscribed', 6),
        her('hiii welcome 💕', 5),
        fan('thanks :) so what do you post here?', 2),
    ],
    validation: [
        fan('hey gorgeous', 50),
        her('hey you 😏', 46),
        fan('be honest, would you date a guy like me? tell me i am your type', 30),
        her('hmm you are asking the big questions early 😜', 26),
        fan("come on just say it. and send me a quick pic to prove you're real, free one, then i'll buy stuff", 3),
    ],
};

const cases = [
    ['Lane rude', { lane: 'rude' }, T.rude],
    ['Support mode', { support: true }, T.support],
    ['Language ES', { language: 'es' }, T.english],
    ['Phase warm up', { phase: 'warm_up' }, T.warmUp],
    ['Posture frame-hold', { posture: 'PRESSURE', frameHold: true }, T.validation],
];

// Pin the creator's clock to mid-afternoon whatever the real time is (Etc/GMT zones are inverted: GMT-3 = UTC+3).
const offset = ((15 - new Date().getUTCHours() + 36) % 24) - 12;
const SPOT_TZ = offset === 0 ? 'UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

(async () => {
    const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
    for (const [label, stateOverrides, messages] of cases) {
        if (only.length && !only.includes(label)) continue;
        const runs = [1, 2].map((i) =>
            withTimeout(generateDraft({
                model: { name: 'Camila', prompt: 'You are Camila, a playful, warm 24-year-old creator.', content_library: '', feedback_rules: '' },
                session: {
                    id: `switch-spot-${label}-${i}`, creator_model: 'Camila', customer_name: 'Jake', customer_username: 'jake_w',
                    subscription_status: 'subscribed', total_spend: '$0', tips_spend: '$0', crm_notes: '', vn_used: [],
                    inputMode: 'chat', messages,
                },
                creatorStatus: [], api: 'claude', sender: 'customer', context: '', timezone: SPOT_TZ, stateOverrides,
            }), 300000)
                .then((r) => console.log(`[${label} #${i}] ${JSON.stringify(r.draft)}`))
                .catch((e) => console.log(`[${label} #${i}] <<${e.message}>>`)),
        );
        await Promise.all(runs);
    }
})().catch((e) => { console.error('SPOT FAILED:', e.message); process.exit(1); });
