'use strict';
/* MANUAL spot check (not CI): runs the REAL model on two invented threads with the Re-pitch and
 * Re-offer MPPV directives and prints the drafts so a human can judge them.
 *   Re-pitch:  nudges toward the PPV already sent, no price/number.
 *   Re-offer:  personal, "just for you", no price/number.
 * Costs ~12 real AI calls (2 threads x 3 runs x 2 calls). Needs ANTHROPIC_API_KEY (.env is auto-loaded
 * like engine/server.js). Directives come from intent_directives.json (a copy of AgentIntents' strings). */
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
const directives = require('./intent_directives.json');

const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
const fan = (text, ago) => ({ sender: 'customer', text, ts_iso: iso(ago) });
const her = (text, ago) => ({ sender: 'model', text, ts_iso: iso(ago) });

// A: unpaid $21 chat PPV, 5 messages ago.
const threadA = [
    fan('hey you, how was your day?', 80),
    her('pretty lazy, stayed in and cooked 😊 what about you?', 76),
    fan('work was long, finally home', 72),
    her('aww poor thing, i made something just for you tonight 🙈', 68),
    { sender: 'ppv', text: 'something for your eyes only 😈', price: 21, opened: false, ts_iso: iso(66) },
    fan('haha ok let me eat first', 60),
    her('go eat baby, i will be here', 55),
    fan('back, tv on, kinda tired', 30),
    her('tell me about the tiredest part of your day', 26),
    fan('honestly my commute', 12),
];
// B: a hidden, unbought mass PPV (not in the thread; the directive carries its text).
const threadB = [
    fan('hi, saw your post earlier', 90),
    her('hey! thank you for the sub 💕', 85),
    fan('of course, love the pics', 80),
    her('you are sweet, what do you do for fun?', 74),
    fan('mostly gaming and gym', 40),
    her('gym and gaming, ok i approve 😏', 35),
    fan('haha what about you', 10),
];

const runs = [
    ['A re-pitch', 'repitch', threadA],
    ['B re-offer', 'reoffer_mppv', threadB],
];

(async () => {
    for (const [label, key, messages] of runs) {
        for (let i = 1; i <= 3; i++) {
            const r = await generateDraft({
                model: { name: 'Camila', prompt: 'You are Camila, a playful, warm 24-year-old creator.', content_library: '', feedback_rules: '' },
                session: {
                    id: `spot-${key}-${i}`, creator_model: 'Camila', customer_name: 'Jake', customer_username: 'jake_w',
                    subscription_status: 'subscribed', total_spend: '$0', tips_spend: '$0', crm_notes: '', vn_used: [],
                    inputMode: 'chat', messages,
                },
                creatorStatus: [], api: 'claude', sender: 'customer', context: directives[key],
            });
            console.log(`[${label} #${i}] ${JSON.stringify(r.draft)}`);
        }
    }
})().catch((e) => { console.error('SPOT FAILED:', e.message); process.exit(1); });
