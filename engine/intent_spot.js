'use strict';
/* MANUAL spot check (not CI): runs the REAL model on two invented threads with the Re-pitch and
 * Re-offer MPPV directives and prints the drafts so a human can judge them.
 *   Re-pitch:  nudges toward the PPV already sent, no price/number.
 *   Re-offer:  personal, "just for you", no price/number.
 * `--slice2` runs the slice-2 intents instead (~30 generations).
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

// --slice2: 2 drafts per slice-2 server intent on ONE invented rapport-stage thread (fan mid-conversation).
// Directives come from intent_directives.json "slice2" (pinned to PHP by tests/Unit/AgentIntentsTest.php).
// Aftersale has no directive: it runs legacy's aftercare template via session _aftercareMode/_aftercareContext.
const threadC = [
    fan('hey, just got home from the gym', 140),
    her('hey you 😊 how was the workout?', 136),
    fan('brutal, legs are dead lol', 130),
    her('haha poor legs, did you at least treat yourself after?', 126),
    fan('yeah got a burger, no regrets', 118),
    her('no regrets is the best kind 😏 what do you usually do on a friday night?', 112),
    fan('usually just gaming with friends, sometimes i go out', 60),
    her('gaming and going out, a man of many talents 😜', 55),
    fan('haha thanks. what about you, what are you up to tonight?', 8),
];
// Premise-matched threads (invented text): a directive states its own premise ("he just unlocked her PPV"),
// so the thread must make that true or the draft has nothing to act on. Each ends on a line that is NOT a
// "what are you up to?" chit-chat question where the premise allows.
const ppvOpened = (price, ago) => ({ sender: 'ppv', text: 'something just for you 😈', price, opened: true, ts_iso: iso(ago) });
const ppvLocked = (price, ago) => ({ sender: 'ppv', text: 'a little something for your eyes 😈', price, opened: false, ts_iso: iso(ago) });
const base = [
    fan('hey, just got home from the gym', 300),
    her('hey you 😊 how was the workout?', 296),
    fan('brutal, legs are dead lol', 290),
    her('haha poor legs, did you treat yourself after?', 286),
    fan('yeah got a burger, no regrets', 280),
    her('no regrets is the best kind 😏', 276),
];
const T = {
    postPurchase: [...base, her('i made something just for you tonight 🙈', 120), ppvOpened(21, 118), fan('ok just opened it... wow', 3)],
    postTip: [...base, her('you always make my night better 💕', 60), fan('just sent you a little tip, you deserve it 😘', 2)],
    expensive: [...base, her('i filmed something for you baby 🙈', 90), ppvLocked(35, 88), fan('$35 is kinda a lot for one video tbh', 5)],
    afterSexting: [...base, her('close your eyes and imagine my hands on you 😈', 70), fan('mmm i am so into this', 66), ppvOpened(49, 62), fan('holy shit that was incredible... i am done lol', 4)],
    afterNo: [...base, ppvOpened(21, 100), her('did you like it baby? i have a bigger one for you 😈', 96), ppvLocked(35, 94), fan("nah i'm good for tonight, thanks. gonna head to bed soon", 3)],
    followUp: [...base, her('i filmed something for you 🙈', 2000), ppvOpened(21, 1990), fan('wow thank you, you are amazing', 1985), her('sleep well baby, talk tomorrow 😘', 1800)],
    flirty: [...base, her('you always know what to say 😏', 50), fan("you're kind of dangerous, i cannot stop smiling at my phone", 4)],
    sextingWarm: [...base, ppvOpened(21, 120), her('did that make you think about me later? 😏', 100), fan("honestly yes, i can't stop thinking about you in that last pic, got me all worked up 🔥", 3)],
};
const slice2Runs = [
    ['objection expensive', 'objection:expensive', null, T.expensive],
    ['CTA 1', 'cta:cta1', null, T.flirty], ['CTA 2', 'cta:cta2'],
    ['Sexting', 'sexting', null, T.sextingWarm], ['Promise ask', 'promise:ask'],
    ['Post-purchase', 'post_purchase', { total_spend: '$21' }, T.postPurchase],
    ['Post-tip', 'post_tip', { tips_spend: '$20' }, T.postTip], ['Tip ask', 'tip_ask'], ['Breadcrumb', 'breadcrumb'], ['Hook', 'hook'],
    ['ChitChat', 'chitchat'], ['Follow-up', 'follow_up', { total_spend: '$21' }, T.followUp], ['Goodbye phase 3', 'goodbye:phase3'],
    ['Aftersale after_no', null, { total_spend: '$21', _aftercareMode: true, _aftercareContext: 'ladder_stop' }, T.afterNo],
    ['Aftersale after_sexting', null, { total_spend: '$49', _aftercareMode: true, _aftercareContext: 'aftersex' }, T.afterSexting],
];

// Pin the creator's clock to mid-afternoon whatever the real time is (Etc/GMT zones are inverted: GMT-3 = UTC+3).
const offset = ((15 - new Date().getUTCHours() + 36) % 24) - 12;
const SPOT_TZ = offset === 0 ? 'UTC' : `Etc/GMT${offset > 0 ? '-' : '+'}${Math.abs(offset)}`;

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);

async function runSlice2() {
    // --only="Tip ask,Hook" limits the run to those labels (a hung provider call can be re-run alone).
    const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
    for (const [label, key, extra, thread] of slice2Runs) {
        if (only.length && !only.includes(label)) continue;
        const context = key ? directives.slice2[key] : '';
        if (key && !context) throw new Error(`no directive for ${key}`);
        for (let i = 1; i <= 2; i++) {
            const r = await withTimeout(generateDraft({
                model: { name: 'Camila', prompt: 'You are Camila, a playful, warm 24-year-old creator.', content_library: '', feedback_rules: '' },
                session: {
                    id: `spot2-${label}-${i}`, creator_model: 'Camila', customer_name: 'Jake', customer_username: 'jake_w',
                    subscription_status: 'subscribed', total_spend: '$0', tips_spend: '$0', crm_notes: '', vn_used: [],
                    inputMode: 'chat', messages: thread || threadC, ...(extra || {}),
                },
                creatorStatus: [], api: 'claude', sender: 'customer', context, timezone: SPOT_TZ,
            }), 240000).catch((e) => ({ draft: `<<${e.message}>>` }));
            console.log(`[${label} #${i}] ${JSON.stringify(r.draft)}`);
        }
    }
}

(async () => {
    if (process.argv.includes('--slice2')) return runSlice2();
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
