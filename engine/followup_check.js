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
async function calls(messages, api = 'claude', { sender = 'customer', context = '' } = {}) {
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
        creatorStatus: [], api, sender, context,
    }, { callApi, callMistral });
    return seen;
}

const NOTE = '=== FOLLOW-UP — JAKE HAS NOT REPLIED YET ===';
const noteFor = async (msgs) => (await calls(msgs)).find((c) => c.tag === 'generator').user;

(async () => {
    // --- the bug: the thread ends with Camila's own message ------------------------------------
    const endsWithHer = await calls([fan('hey whats up', 30), her('just woke up babe, you?', 28)]);
    const strat = endsWithHer.filter((c) => c.tag.startsWith('strategy'));
    const gen = endsWithHer.filter((c) => c.tag.startsWith('generator'));
    assert.ok(strat.length && gen.length, 'a strategy call and a generator call ran');
    for (const c of [...strat, ...gen]) {
        assert.ok(c.user.includes(NOTE), `${c.tag}: carries the follow-up note`);
        assert.ok(c.user.includes("Camila's OWN words"), `${c.tag}: says the last line is Camila's own`);
    }

    // Reported 2026-09-26: two unanswered messages ending in her own question, and the AI
    // answered it ("Rough morning or a good one? 😏" → "just out here enjoying my Saturday 😜
    // hope yours is a good one"). The note must QUOTE both sides and forbid self-answering;
    // "continue her own thought" advice is what invited it.
    const yendry = (await calls([
        fan('I don’t have a wife', 161), her('Well what are we gonna do about that? 😏', 161),
        fan('Well', 158), her('Do you want to see my lingerie side? 😉', 154), her('Rough morning or a good one? 😏', 5),
    ])).find((c) => c.tag === 'generator').user;
    const note = yendry.slice(yendry.indexOf(NOTE));
    assert.ok(note.includes(`Jake's last message: "Well" (2 hrs ago)`), 'quotes his last message');
    assert.ok(note.includes('1. "Do you want to see my lingerie side? 😉" (2 hrs ago)'), 'quotes her earlier unanswered message');
    assert.ok(note.includes(`2. "Rough morning or a good one? 😏" (5 min ago) ← Camila's last message`), 'quotes + marks her last message');
    assert.ok(note.includes('never answers her own question'), 'forbids answering her own question');
    assert.ok(note.includes('fresh angle'), 'asks for a new message, not a continuation');
    assert.ok(!/continue[s]? .*own thought|add-on/i.test(note), 'no continue-her-thought advice (it invited self-answers)');
    // Legacy's leak filter discards any draft opening "actually"/"wait"/"hmm" — common in follow-ups.
    assert.ok(note.includes('Do not start the message with "actually", "wait" or "hmm"'), 'generator is warned off the openers legacy discards');
    const stratNote = (await calls([fan('hey', 30), her('hey you', 20)])).find((c) => c.tag === 'strategy_sonnet').user;
    assert.ok(!stratNote.includes('Do not start the message'), 'strategy (JSON) gets no opener line');
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
    const ctx = followUpContext([fan('hey', 30), her('miss me?', 20)], Date.now());
    const wrapped = withFollowUp({ callApi: async () => '', callMistral: async (_p, _s, c) => { convo = c; return ''; } },
        ctx, { creator: 'Camila', fan: 'Jake' });
    await wrapped.callMistral('persona', {}, "CUSTOMER: hey\nCAMILA: miss me?\n\nNow write Camila's next message:", 'Camila', 200);
    assert.ok(convo.includes(NOTE) && convo.trimEnd().endsWith("Now write Camila's follow-up message:"), 'callMistral gets the note on its conversation');
    // Calls that don't write the reply are left alone.
    let untouched = null;
    const w2 = withFollowUp({ callApi: async (_s, u) => { untouched = u; return ''; }, callMistral: async () => '' },
        ctx, { creator: 'Camila', fan: 'Jake' });
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

    // PPV caption mode is a different task (write the caption for what she is sending NOW).
    for (const c of await calls([fan('hey', 30), her('hey you', 20)], 'claude', { sender: 'ppv' })) {
        assert.ok(!c.user.includes('FOLLOW-UP'), `${c.tag}: caption mode → no note`);
    }
    // The note is read last, so it must hand precedence back to the chatter's override box.
    const withOverride = (await calls([fan('hey', 30), her('hey you', 20)], 'claude', { context: 'finish her bath story' }))
        .filter((c) => /^(strategy|generator)/.test(c.tag));
    // With a directive, the note carries the FACTS only: a rule like "do not continue them" would
    // contradict e.g. "finish her bath story", and the writer then argues it out in its output.
    for (const c of withOverride) {
        assert.ok(c.user.includes(NOTE) && c.user.includes("Camila's OWN words"), `${c.tag}: override set → still told who said what`);
        assert.ok(c.user.includes('never answers her own question'), `${c.tag}: override set → still no self-answering`);
        assert.ok(c.user.includes('set by the AGENT OVERRIDE above'), `${c.tag}: override set → the directive picks the move`);
        assert.ok(!/do NOT answer, react to, or continue|fresh angle|Do not chase/i.test(c.user.slice(c.user.indexOf(NOTE))), `${c.tag}: override set → no move rules to contradict it`);
    }
    assert.ok(!(await noteFor([fan('hey', 30), her('hey you', 20)])).includes('set by the AGENT OVERRIDE'), 'no override → normal follow-up rules');

    // --- the context the note is built from ----------------------------------------------------
    // The clock is read AFTER the fixtures are built (args evaluate first), so awaits in between can't skew minutes.
    const ctxAt = (msgs) => followUpContext(msgs, Date.now());
    assert.strictEqual(ctxAt([fan('hi', 5)]), null, 'fan last → null');
    assert.strictEqual(ctxAt([]), null, 'empty thread → null');
    const pick = (c) => c && { count: c.count, minutesSince: c.minutesSince, fanSpoke: c.fanSpoke };
    const three = ctxAt([fan('hi', 90), her('a', 60), ppv(false, 45), her('b', 40)]);
    assert.deepStrictEqual(pick(three), { count: 3, minutesSince: 40, fanSpoke: true },
        'counts every unanswered creator message, incl. an unopened PPV; timed from the newest');
    assert.deepStrictEqual(three.run.map((m) => [m.text, m.ppv, m.minutesAgo]), [['a', false, 60], ['surprise', true, 45], ['b', false, 40]],
        'keeps her unanswered messages, oldest first, for quoting');
    assert.deepStrictEqual(three.fanLast, { text: 'hi', purchase: false, price: null, minutesAgo: 90 }, 'keeps his last move');
    const bought = ctxAt([fan('hi', 90), ppv(true, 60), her('liked it?', 30)]);
    assert.deepStrictEqual(pick(bought), { count: 1, minutesSince: 30, fanSpoke: true },
        'a bought PPV counts as his move, so only what came after it is unanswered');
    assert.ok((await noteFor([fan('hi', 90), ppv(true, 60), her('liked it?', 30)])).includes("Jake's last move: he bought Camila's $20 PPV"),
        'a purchase is described as his move, not quoted as his message');
    const never = ctxAt([her('welcome!', 600)]);
    assert.deepStrictEqual(pick(never), { count: 1, minutesSince: 600, fanSpoke: false },
        'fan never wrote → still a follow-up, with nothing of his to re-answer');
    assert.strictEqual(never.fanLast, null);
    assert.ok((await noteFor([her('welcome!', 600)])).includes('No message from Jake in the conversation above.'), 'no fan message in the loaded thread → says only that (it may be older than the page)');

    // Timing changes the advice; a run of unanswered messages adds the don't-chase rule.
    assert.ok((await noteFor([fan('hey', 10), her('omw to the gym', 2)])).includes('may not have even seen it'), '<15 min → keep it light');
    assert.ok((await noteFor([fan('hey', 120), her('omw to the gym', 60)])).includes('Jake has been quiet for 2 hrs.'), '<6h → silence measured from HIS last message');
    assert.ok((await noteFor([fan('hey', 2000), her('omw to the gym', 1500)])).includes('SILENT TREATMENT'), '6h+ → one check-in');
    const chase = await noteFor([fan('hey', 300), her('a', 240), her('b', 120)]);
    assert.ok(chase.includes('2 messages in a row'), '2+ unanswered → don\'t-chase warning');
    assert.ok(!(await noteFor([fan('hey', 300), her('a', 240)])).includes('in a row'), 'a single message → no chase warning');

    console.log('✓ followup_check: creator-spoke-last threads carry the follow-up note on every reply call; fan-last threads unchanged');
})().catch((e) => { console.error('FOLLOWUP_CHECK FAILED:', e.message); process.exit(1); });
