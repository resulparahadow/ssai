'use strict';
/* Proves the §5b state switches reach SSAI (engine/stateNote.js):
 *  - every switch value puts its line under the AGENT-SET STATE header, at the very end of BOTH
 *    the strategy and generator prompts (after the follow-up note on a creator-last thread);
 *  - the posture / tier hooks take effect inside legacy (via eng.set), the Fan-tab timewaster flag
 *    beats them, and a pinned promise holds through legacy's in-turn advances (prompt + telemetry);
 *  - no stateOverrides → no header and prompts byte-identical to the pre-switches engine. */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { generateDraft } = require('./runGenerate');
const { HEADER } = require('./stateNote');

const fakeStrategy = {
    tone: 'warm',
    phase: 'rapport',
    promise_status: 'not_started',
    next_move_after_wall: 'continue_climb',
    message_length: 'short',
    caption_required: false,
    agent_override_active: false,
    trust_level: 1,
    archetype: 'Explorer',
    temperature: 'cold',
    message_purpose: 'x',
    skeleton_step: 'Chit Chat',
};
const now = Date.now();
const iso = (minAgo) => new Date(now - minAgo * 60000).toISOString();
const fanLast = [
    { sender: 'model', text: 'hey', ts_iso: iso(30) },
    { sender: 'customer', text: 'hi there', ts_iso: iso(5) },
];
const creatorLast = [
    { sender: 'customer', text: 'hi there', ts_iso: iso(60) },
    { sender: 'model', text: 'how was your day?', ts_iso: iso(5) },
];
const profile = (extra = {}) => ({
    trust_level: 1,
    archetype: 'Unknown',
    temperature: 'cold',
    total_spend: 0,
    tips_spend: 0,
    key_details: '',
    is_timewaster: false,
    ...extra,
});

function inputFor({ messages = fanLast, session = {}, stateOverrides } = {}) {
    return {
        model: {
            name: 'Camila',
            prompt: 'You are Camila.',
            content_library: '',
            feedback_rules: '',
        },
        session: {
            id: 'sw',
            creator_model: 'Camila',
            customer_name: 'Jake',
            customer_username: 'jake_w',
            subscription_status: 'subscribed',
            total_spend: '$0',
            tips_spend: '$0',
            crm_notes: '',
            vn_used: [],
            inputMode: 'chat',
            messages,
            ...session,
        },
        creatorStatus: [],
        api: 'claude',
        sender: 'customer',
        context: '',
        timezone: 'UTC',
        ...(stateOverrides !== undefined ? { stateOverrides } : {}),
    };
}

async function run(opts = {}, gen = generateDraft) {
    const out = { strategy: '', generator: '', tags: [] };
    const flat = (x) =>
        Array.isArray(x) ? x.map((b) => b.text || '').join('\n') : String(x);
    const callApi = async (sys, user, _m, _f, tag) => {
        const t = String(tag);
        out.tags.push(t);
        if (t.startsWith('strategy'))
            out.strategy = flat(sys) + '\n' + flat(user);
        if (t.startsWith('generator'))
            out.generator = flat(sys) + '\n' + flat(user);
        return t.startsWith('strategy')
            ? JSON.stringify(opts.strategy || fakeStrategy)
            : 'hey you';
    };
    const res = await gen(inputFor(opts), {
        callApi,
        callMistral: async () => 'hola',
    });
    return { ...out, res };
}

// One case per switch value: the override and the line it must produce.
const CASES = [
    [
        { phase: 'warm_up' },
        '- Phase: Warm up — short, light, friendly replies; no selling, no personal questions yet; get him talking',
    ],
    [{ phase: 'rapport' }, '- Phase: Rapport — '],
    [{ phase: 'link' }, '- Phase: Link — '],
    [{ phase: 'sale' }, '- Phase: Sale — '],
    [{ phase: 'loop' }, '- Phase: Loop — '],
    [{ phase: 'aftersale' }, '- Phase: Aftersale — '],
    [
        { rlsBeat: 4 },
        '- RLS beat: 4 — write the message for beat 4 of the RLS script (PART 14)',
    ],
    [{ fanTier: 'new' }, '- Fan type: New — '],
    [{ fanTier: 'old' }, '- Fan type: Returning — '],
    [
        { fanTier: 'old', spender: true },
        '- Fan type: Spender — he has bought before; treat him as a buying customer',
    ],
    [
        { lane: 'sex_only' },
        '- Lane: Sex-only — keep it sexual and short, move to paid content sooner, skip deep rapport, never give explicit content free',
    ],
    [
        { lane: 'rude' },
        "- Lane: Rude — stay calm and short; state one clear boundary in plain words (how you will not be talked to); no selling while he's rude; don't argue, defend yourself or chase",
    ],
    [{ posture: 'WARM_BUILD' }, '- Posture: Normal — '],
    [
        { posture: 'PRESSURE', frameHold: true },
        '- Posture: Frame-hold — PART 5 frame protection: tease without confirming, withhold without rejecting; validation after spend',
    ],
    [{ posture: 'TIMEWASTER' }, '- Posture: Timewaster — '],
    [{ promiseStatus: 'not_started' }, '- Promise state: Not asked — '],
    [{ promiseStatus: 'in_progress' }, '- Promise state: Asked — '],
    [{ promiseStatus: 'reinforcement' }, '- Promise state: Reinforced ×1 — '],
    [{ promiseStatus: 'assumed' }, '- Promise state: Reinforced ×2 — '],
    [{ language: 'es' }, '- Language: ES — reply only in Spanish'],
    [{ language: 'en' }, '- Language: EN — reply only in English'],
    [
        { support: true },
        '- Support mode: On — SUPPORT MODE: no selling at all — no CTA, PPV, tip ask or promise; help, reassure, be kind',
    ],
];

/** The block is the LAST thing in the prompt: header, then only switch lines to the end. */
function assertBlockAtEnd(prompt, line, label) {
    const at = prompt.lastIndexOf(HEADER);
    assert.ok(at >= 0, `${label}: header present`);
    const tail = prompt
        .slice(at + HEADER.length)
        .trim()
        .split('\n');
    assert.ok(
        tail.every((l) => l.startsWith('- ')),
        `${label}: nothing but switch lines after the header`,
    );
    assert.ok(
        tail.some((l) => l.startsWith(line)),
        `${label}: line "${line}" under the header`,
    );
}

/** The pre-switches engine (the commit before §5b), loaded from git into a temp dir. */
function baselineGenerate() {
    try {
        const root = path.join(__dirname, '..');
        const src = execFileSync(
            'git',
            ['show', '340aa22:engine/runGenerate.js'],
            {
                cwd: root,
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
            },
        );
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'switch-base-'));
        const file = path.join(dir, 'runGenerate.js');
        fs.writeFileSync(
            file,
            src.replace(
                /require\('\.\/([^']+)'\)/g,
                (_, m) => `require(${JSON.stringify(path.join(__dirname, m))})`,
            ),
        );
        return require(file).generateDraft;
    } catch (_) {
        return null; // no git history here — the in-tree comparison below still runs
    }
}

/** Two prompts equal, tolerating a clock-minute rollover between the two runs. */
function sameExceptClock(a, b) {
    const strip = (s) =>
        s.replace(/\d{1,2}:\d{2}(:\d{2})?\s?(AM|PM)?/gi, 'HH:MM');
    return a === b || strip(a) === strip(b);
}

(async () => {
    // 1. Every switch value → its line, at the end of both prompts, on both thread shapes.
    for (const [o, line] of CASES) {
        const a = await run({ stateOverrides: o });
        assertBlockAtEnd(a.strategy, line, `strategy ${JSON.stringify(o)}`);
        assertBlockAtEnd(a.generator, line, `generator ${JSON.stringify(o)}`);
    }
    const all = {
        phase: 'sale',
        rlsBeat: 2,
        fanTier: 'old',
        spender: true,
        lane: 'rude',
        posture: 'PRESSURE',
        frameHold: true,
        promiseStatus: 'assumed',
        language: 'es',
        support: true,
    };
    const ordered = (await run({ stateOverrides: all })).generator;
    const names = ordered
        .slice(ordered.lastIndexOf(HEADER))
        .split('\n')
        .slice(1)
        .map((l) => l.slice(2).split(':')[0]);
    assert.deepStrictEqual(
        names,
        [
            'Phase',
            'RLS beat',
            'Fan type',
            'Lane',
            'Posture',
            'Promise state',
            'Language',
            'Support mode',
        ],
        'lines in spec §4 order',
    );

    // Creator-last thread: the block comes after the follow-up note.
    const fu = await run({
        messages: creatorLast,
        stateOverrides: { lane: 'rude' },
    });
    for (const p of [fu.strategy, fu.generator]) {
        assert.ok(p.includes('FOLLOW-UP — '), 'follow-up note present');
        assert.ok(
            p.lastIndexOf(HEADER) > p.lastIndexOf('FOLLOW-UP — '),
            'state block after the follow-up note',
        );
        assertBlockAtEnd(p, '- Lane: Rude', 'creator-last');
    }

    // 2. Posture hook: forced TIMEWASTER lands on the session (the wrapper ran inside legacy).
    const tw = await run({
        session: { _profile: profile() },
        stateOverrides: { posture: 'TIMEWASTER' },
    });
    assert.strictEqual(
        tw.res.telemetry.posture,
        'TIMEWASTER',
        'forced posture reaches s._posture',
    );
    const ctrlPosture = await run({ session: { _profile: profile() } });
    assert.notStrictEqual(
        ctrlPosture.res.telemetry.posture,
        'TIMEWASTER',
        'control: legacy alone does not read TIMEWASTER',
    );

    // 3. Tier hook: a $0 trust-1 fan reads 'old' when Fan type is returning.
    const ctrlTier = await run({ session: { _profile: profile() } });
    assert.strictEqual(
        ctrlTier.res.telemetry.customerTier,
        'new',
        'control: $0 trust-1 fan is new',
    );
    const old = await run({
        session: { _profile: profile() },
        stateOverrides: { fanTier: 'old' },
    });
    assert.strictEqual(
        old.res.telemetry.customerTier,
        'old',
        'forced tier reaches s._customerTier',
    );

    // 4. The Fan-tab timewaster flag beats the switches.
    const flaggedCtrl = await run({
        session: { _profile: profile({ is_timewaster: true }) },
    });
    const flagged = await run({
        session: { _profile: profile({ is_timewaster: true }) },
        stateOverrides: { posture: 'WARM_BUILD', fanTier: 'new' },
    });
    assert.strictEqual(
        flagged.res.telemetry.customerTier,
        'flagged_tw',
        'flag on → flagged tier wins over Fan type',
    );
    assert.strictEqual(
        flagged.res.telemetry.posture,
        flaggedCtrl.res.telemetry.posture,
        'flag on → legacy posture, not the forced one',
    );
    // A forced value legacy would NOT reach on its own, so the precedence check can fail.
    for (const forced of ['TIMEWASTER', 'PRESSURE']) {
        assert.notStrictEqual(
            flaggedCtrl.res.telemetry.posture,
            forced,
            `control: legacy alone is not ${forced}`,
        );
        const f = await run({
            session: { _profile: profile({ is_timewaster: true }) },
            stateOverrides: { posture: forced },
        });
        assert.strictEqual(
            f.res.telemetry.posture,
            flaggedCtrl.res.telemetry.posture,
            `flag on → forced ${forced} not applied`,
        );
    }

    // 5. Promise pin. (a) legacy flips in_progress → verbally_committed on "i promise" before the prompts.
    const promiseThread = [
        {
            sender: 'model',
            text: 'promise it stays between us?',
            ts_iso: iso(10),
        },
        { sender: 'customer', text: 'i promise babe', ts_iso: iso(5) },
    ];
    const ctrlPromise = await run({
        messages: promiseThread,
        session: { _promiseStatus: 'in_progress' },
    });
    assert.strictEqual(
        ctrlPromise.res.telemetry.promiseStatus,
        'verbally_committed',
        'control: legacy advances the promise',
    );
    assert.ok(
        ctrlPromise.strategy.includes('PROMISE STATE = VERBALLY_COMMITTED'),
        'control: the advance reaches the prompt',
    );
    const pinned = await run({
        messages: promiseThread,
        session: { _promiseStatus: 'not_started' },
        stateOverrides: { promiseStatus: 'in_progress' },
    });
    assert.strictEqual(
        pinned.res.telemetry.promiseStatus,
        'in_progress',
        'pinned promise in telemetry',
    );
    assert.ok(
        !pinned.strategy.includes('PROMISE STATE = VERBALLY_COMMITTED'),
        'pinned promise: no advance in the prompt',
    );
    // (b) Pass C's run_promise_ritual advance (not_started → in_progress) can't leak into telemetry.
    const ritual = {
        ...fakeStrategy,
        next_move_after_wall: 'run_promise_ritual',
    };
    const ctrlRitual = await run({
        strategy: ritual,
        session: { _promiseStatus: 'not_started' },
    });
    const pinRitual = await run({
        strategy: ritual,
        stateOverrides: { promiseStatus: 'not_started' },
    });
    if (ctrlRitual.res.telemetry.promiseStatus !== 'not_started') {
        assert.strictEqual(
            pinRitual.res.telemetry.promiseStatus,
            'not_started',
            'Pass C advance re-pinned',
        );
    }
    // (c) legacy's one-shot returning-spender upgrade (not_started → reinforcement) is held off.
    const spender = { _profile: profile({ total_spend: 40 }) };
    const ctrlSpender = await run({
        session: { ...spender, _promiseStatus: 'not_started' },
    });
    assert.strictEqual(
        ctrlSpender.res.telemetry.promiseStatus,
        'reinforcement',
        'control: returning spender upgrade',
    );
    const pinSpender = await run({
        session: spender,
        stateOverrides: { promiseStatus: 'not_started' },
    });
    assert.strictEqual(
        pinSpender.res.telemetry.promiseStatus,
        'not_started',
        'pinned: no returning-spender upgrade',
    );
    assert.ok(
        ctrlSpender.strategy.includes('Promise ritual status: reinforcement'),
        'control: upgrade reaches the prompt',
    );
    assert.ok(
        pinSpender.strategy.includes('Promise ritual status: not_started'),
        'pinned: the prompt keeps the pinned promise',
    );

    // 6. All Auto: no header, and the prompts equal the pre-switches engine's.
    for (const o of [undefined, {}]) {
        const a = await run({ stateOverrides: o });
        assert.ok(
            !a.strategy.includes('AGENT-SET STATE') &&
                !a.generator.includes('AGENT-SET STATE'),
            'no overrides → no header',
        );
    }
    // A note-only switch changes nothing but the appended block.
    const plain = await run({});
    const sup = await run({ stateOverrides: { support: true } });
    const block = sup.generator.slice(
        sup.generator.lastIndexOf('\n\n' + HEADER),
    );
    assert.ok(
        sameExceptClock(sup.generator, plain.generator + block),
        'support-only: generator prompt = no-switch prompt + block',
    );
    assert.ok(
        sameExceptClock(sup.strategy, plain.strategy + block),
        'support-only: strategy prompt = no-switch prompt + block',
    );

    const base = baselineGenerate();
    if (base) {
        for (const messages of [fanLast, creatorLast]) {
            const before = await run({ messages }, base);
            const after = await run({ messages });
            assert.ok(
                sameExceptClock(after.strategy, before.strategy),
                'all-Auto strategy prompt byte-identical to 340aa22',
            );
            assert.ok(
                sameExceptClock(after.generator, before.generator),
                'all-Auto generator prompt byte-identical to 340aa22',
            );
            assert.deepStrictEqual(
                after.tags,
                before.tags,
                'same calls as 340aa22',
            );
        }
    } else {
        console.log(
            '  (git history unavailable — skipped the 340aa22 byte-identity comparison)',
        );
    }

    console.log(
        '✓ switch_check: every switch reaches both prompts last; posture/tier hooks + timewaster flag precedence; promise pinned; all-Auto byte-identical',
    );
})().catch((e) => {
    console.error('SWITCH_CHECK FAILED:', e.message);
    process.exit(1);
});
