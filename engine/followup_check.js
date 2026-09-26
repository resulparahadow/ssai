'use strict';
/* Proves the engine knows when the creator already spoke last. Legacy was only ever used to
 * answer a fan message the chatter had just typed in, so its prompts assume the newest line is
 * the fan's ("your analysis must reflect what the LAST customer message actually said"). Live
 * threads often end with the creator's own message — the fan hasn't answered yet — and the AI
 * then replied to itself. When the thread ends with the creator's message, every strategy and
 * generator call (retries + the Mistral route included) must carry the FOLLOW-UP note; a thread
 * ending with the fan (or with a PPV he just bought) must reach the AI byte-identical to before. */
const assert = require('assert');
const { generateDraft } = require('./runGenerate');
const { followUpContext, withFollowUp } = require('./followUp');

const fakeStrategy = {
    tone: 'warm', phase: 'rapport', promise_status: 'not_started', next_move_after_wall: 'continue_climb',
    message_length: 'short', caption_required: false, agent_override_active: false, trust_level: 1,
    archetype: 'Explorer', temperature: 'cold', message_purpose: 'x', skeleton_step: 'Chit Chat',
};
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const fan = (text, min) => ({ sender: 'customer', text, ts_iso: ago(min) });
const her = (text, min) => ({ sender: 'model', text, ts_iso: ago(min) });
const ppv = (opened, min) => ({ sender: 'ppv', text: 'surprise', price: 20, opened, ts_iso: ago(min) });

/** Runs one generation; returns every LLM call as { tag, user } (Mistral's conversation as `user`). */
async function calls(messages, api = 'claude') {
    const seen = [];
    const flat = (x) => (Array.isArray(x) ? x.map((b) => b.text || '').join('\n') : String(x));
    const callApi = async (_sys, user, _m, _f, tag) => {
        seen.push({ tag: String(tag), user: flat(user) });
        return String(tag).startsWith('strategy') ? JSON.stringify(fakeStrategy) : 'hey you';
    };
    const callMistral = async (_persona, _strategy, conversation) => {
        seen.push({ tag: 'mistral', user: String(conversation) });
        return 'hola';
    };
    await generateDraft({
        model: { name: 'Camila', prompt: 'You are Camila.', content_library: '', feedback_rules: '' },
        session: {
            id: 'fu', creator_model: 'Camila', customer_name: 'Jake', customer_username: 'jake_w',
            subscription_status: 'subscribed', total_spend: '$0', tips_spend: '$0', crm_notes: '', vn_used: [],
            inputMode: 'chat', messages,
        },
        creatorStatus: [], api, sender: 'customer', context: '',
    }, { callApi, callMistral });
    return seen;
}

const NOTE = '=== FOLLOW-UP — JAKE HAS NOT REPLIED YET ===';

(async () => {
    // --- the bug: the thread ends with Camila's own message ------------------------------------
    const endsWithHer = await calls([fan('hey whats up', 30), her('just woke up babe, you?', 28)]);
    const strat = endsWithHer.filter((c) => c.tag.startsWith('strategy'));
    const gen = endsWithHer.filter((c) => c.tag.startsWith('generator'));
    assert.ok(strat.length && gen.length, 'a strategy call and a generator call ran');
    for (const c of [...strat, ...gen]) {
        assert.ok(c.user.includes(NOTE), `${c.tag}: carries the follow-up note`);
        assert.ok(c.user.includes("Camila's OWN message"), `${c.tag}: says the last line is Camila's own`);
    }
    // The note is the LAST thing each call reads — after "Generate Camila's next message:".
    assert.ok(gen[0].user.trimEnd().endsWith("Now write Camila's follow-up message:"), 'generator ends on the follow-up ask');
    assert.ok(strat[0].user.includes('last_message_read'), 'strategy is told what last_message_read should say');
    assert.ok(!strat[0].user.trimEnd().endsWith("follow-up message:"), 'strategy is not asked for a message (it must return JSON)');

    // api 'mistral': the engine has no OpenRouter key in legacy's localStorage, so legacy falls
    // back to Claude ('generator_fallback') — that is the call that must carry the note.
    const viaMistral = await calls([fan('hey', 30), her('miss me?', 20)], 'mistral');
    const fb = viaMistral.find((c) => c.tag === 'generator_fallback');
    assert.ok(fb && fb.user.includes(NOTE), 'generator_fallback carries the follow-up note');
    // The Mistral transport itself is wrapped too, should that route ever be reachable.
    let convo = null;
    const wrapped = withFollowUp({ callApi: async () => '', callMistral: async (_p, _s, c) => { convo = c; return ''; } },
        { count: 1, minutesSince: 20, fanSpoke: true }, { creator: 'Camila', fan: 'Jake' });
    await wrapped.callMistral('persona', {}, "CUSTOMER: hey\nCAMILA: miss me?\n\nNow write Camila's next message:", 'Camila', 200);
    assert.ok(convo.includes(NOTE) && convo.trimEnd().endsWith("Now write Camila's follow-up message:"), 'callMistral gets the note on its conversation');
    // Calls that don't write the reply are left alone.
    let untouched = null;
    const w2 = withFollowUp({ callApi: async (_s, u) => { untouched = u; return ''; }, callMistral: async () => '' },
        { count: 1, minutesSince: 20, fanSpoke: true }, { creator: 'Camila', fan: 'Jake' });
    await w2.callApi('sys', 'price this', 120, null, 'price_ppv');
    assert.strictEqual(untouched, 'price this', 'non-reply calls pass through unchanged');

    // --- parity: the fan spoke last → nothing added --------------------------------------------
    for (const c of await calls([her('hey you', 30), fan('at work, bored', 5)])) {
        assert.ok(!c.user.includes('FOLLOW-UP'), `${c.tag}: fan spoke last → no note`);
    }
    // He just BOUGHT her PPV: his purchase is the latest move (legacy's post-purchase path owns it).
    for (const c of await calls([fan('send it', 30), ppv(true, 20)])) {
        assert.ok(!c.user.includes('FOLLOW-UP'), `${c.tag}: opened PPV last → no note`);
    }

    // --- the context the note is built from ----------------------------------------------------
    const now = Date.now();
    assert.strictEqual(followUpContext([fan('hi', 5)], now), null, 'fan last → null');
    assert.strictEqual(followUpContext([], now), null, 'empty thread → null');
    assert.deepStrictEqual(
        followUpContext([fan('hi', 90), her('a', 60), ppv(false, 45), her('b', 40)], now),
        { count: 3, minutesSince: 40, fanSpoke: true },
        'counts every unanswered creator message, incl. an unopened PPV; timed from the newest',
    );
    assert.deepStrictEqual(
        followUpContext([fan('hi', 90), ppv(true, 60), her('liked it?', 30)], now),
        { count: 1, minutesSince: 30, fanSpoke: true },
        'a bought PPV counts as his move, so only what came after it is unanswered',
    );
    assert.deepStrictEqual(followUpContext([her('welcome!', 600)], now), { count: 1, minutesSince: 600, fanSpoke: false },
        'fan never wrote → still a follow-up, with nothing of his to re-answer');

    // Timing changes the advice; a run of unanswered messages adds the don't-chase rule.
    const noteFor = async (msgs) => (await calls(msgs)).find((c) => c.tag === 'generator').user;
    assert.ok((await noteFor([fan('hey', 10), her('omw to the gym', 2)])).includes('add-on'), '<15 min → add-on');
    assert.ok((await noteFor([fan('hey', 120), her('omw to the gym', 60)])).includes('low-pressure'), '<6h → light nudge');
    assert.ok((await noteFor([fan('hey', 2000), her('omw to the gym', 1500)])).includes('SILENT TREATMENT'), '6h+ → one check-in');
    const chase = await noteFor([fan('hey', 300), her('a', 240), her('b', 120)]);
    assert.ok(chase.includes('2 messages in a row'), '2+ unanswered → don\'t-chase warning');
    assert.ok(!(await noteFor([fan('hey', 300), her('a', 240)])).includes('in a row'), 'a single message → no chase warning');

    console.log('✓ followup_check: creator-spoke-last threads carry the follow-up note on every reply call; fan-last threads unchanged');
})().catch((e) => { console.error('FOLLOWUP_CHECK FAILED:', e.message); process.exit(1); });
