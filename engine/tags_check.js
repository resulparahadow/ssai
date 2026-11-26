'use strict';
/* Proves the engine prints legacy's "Came with tip / media" tags from a bubble's `tags`
 * (LiveThreadMapper fills them from OnlyFans): a fan tip line reads "[TIPPED $15]", a photo he
 * sent reads "[CAME-WITH-MEDIA]", on BOTH the strategy and generator prompts. A thread with no
 * tags prints neither, so plain threads are unchanged. */
const assert = require('assert');
const { generateDraft } = require('./runGenerate');

const fakeStrategy = {
    tone: 'warm',
    phase: 'build',
    promise_status: 'not_started',
    strategy: 'qualify',
    next_move: 'qualify',
    next_move_after_wall: 'continue_climb',
    message_length: 'short',
    caption_required: false,
    agent_override_active: false,
    trust_level: 1,
    archetype: 'Explorer',
    temperature: 'cold',
    message_purpose: 'qualify',
    skeleton_step: 'Build',
};

function run(messages) {
    const prompts = [];
    const callApi = async (sys, user, _m, _f, t) => {
        prompts.push({
            t: String(t || ''),
            text: String(sys) + '\n' + String(user),
        });
        return String(t || '').startsWith('strategy')
            ? JSON.stringify(fakeStrategy)
            : 'aww thank you 😊';
    };
    const input = {
        model: {
            name: 'Camila',
            prompt: 'You are Camila.',
            content_library: '',
            feedback_rules: '',
        },
        session: {
            id: 'tags',
            creator_model: 'Camila',
            customer_name: 'Jake',
            customer_username: 'jake_w',
            subscription_status: 'subscribed',
            total_spend: '$0',
            tips_spend: '$15',
            crm_notes: '',
            vn_used: [],
            inputMode: 'chat',
            messages,
        },
        creatorStatus: [],
        api: 'claude',
        sender: 'customer',
        context: '',
    };
    return generateDraft(input, {
        callApi,
        callMistral: async () => 'hola',
    }).then(() => prompts);
}

const now = Date.now();
const at = (min) => new Date(now - min * 60000).toISOString();

(async () => {
    const tagged = await run([
        { sender: 'model', text: 'hey you', ts_iso: at(10) },
        {
            sender: 'customer',
            text: 'look at this',
            ts_iso: at(6),
            tags: { customerMedia: true },
        },
        {
            sender: 'customer',
            text: '',
            ts_iso: at(5),
            tags: { tip: true, tipAmount: 15 },
        },
    ]);
    for (const kind of ['strategy', 'generator']) {
        const p = tagged
            .filter((x) => x.t.startsWith(kind))
            .map((x) => x.text)
            .join('\n');
        assert.ok(p.length > 0, `${kind} prompt was built`);
        assert.ok(
            p.includes('[TIPPED $15]'),
            `${kind} prompt carries [TIPPED $15]`,
        );
        assert.ok(
            p.includes('[CAME-WITH-MEDIA]'),
            `${kind} prompt carries [CAME-WITH-MEDIA]`,
        );
    }

    const plain = await run([
        { sender: 'model', text: 'hey you', ts_iso: at(10) },
        { sender: 'customer', text: 'hi', ts_iso: at(5) },
    ]);
    const all = plain.map((x) => x.text).join('\n');
    assert.ok(
        !all.includes('TIPPED') && !all.includes('CAME-WITH-MEDIA'),
        'no tags → no tag text',
    );

    console.log(
        '✓ tags_check: fan tip / fan media tags reach both prompts; untagged threads print none',
    );
})().catch((e) => {
    console.error('TAGS_CHECK FAILED:', e.message);
    process.exit(1);
});
