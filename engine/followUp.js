'use strict';
/**
 * Tells the AI when the creator already spoke last.
 *
 * Legacy was only ever used to answer a fan message the chatter had just typed in, so its
 * prompts take the newest line to be the fan's ("your analysis must reflect what the LAST
 * customer message actually said", "Customer's last message read: responding to his last
 * message"). A live OnlyFans thread often ends with the creator's own message — the fan simply
 * hasn't answered yet — and the AI then replied to itself, or answered the fan a second time.
 *
 * Legacy stays untouched: runGenerate wraps the model transports so every strategy and
 * generator call (their retries and the Mistral route too) ends with a FOLLOW-UP note. A thread
 * ending with the fan gets no wrapper at all, so it reaches the AI byte-identical to before.
 */

const QUICK_MIN = 15;
const NUDGE_MIN = 6 * 60;

/** A move by the fan: his message, or a PPV of hers that he bought (legacy's post-purchase path owns that). */
const isFanMove = (m) => m.sender === 'customer' || (m.sender === 'ppv' && m.opened === true);

/**
 * The creator's unanswered run at the end of the thread, or null when the fan moved last.
 *
 * @param {Array<{sender: string, opened?: boolean, ts_iso?: string}>} messages oldest → newest
 * @returns {{count: number, minutesSince: number, fanSpoke: boolean} | null}
 */
function followUpContext(messages, now = Date.now()) {
    const msgs = Array.isArray(messages) ? messages : [];
    let i = msgs.length - 1;
    while (i >= 0 && !isFanMove(msgs[i])) i--;
    const count = msgs.length - 1 - i;
    if (count === 0) return null;

    const at = Date.parse(msgs[msgs.length - 1].ts_iso || '');
    const minutesSince = Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 60000)) : 0;

    return { count, minutesSince, fanSpoke: msgs.slice(0, i + 1).some((m) => m.sender === 'customer') };
}

function agoPhrase(min) {
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    if (min < 48 * 60) return `${Math.floor(min / 60)} hrs ago`;
    return `${Math.floor(min / (24 * 60))} days ago`;
}

/**
 * @param {{count: number, minutesSince: number, fanSpoke: boolean}} ctx
 * @param {{creator: string, fan: string}} names
 * @param {'strategy'|'generator'} kind  strategy returns JSON, so it is never asked for a message
 */
function followUpNote(ctx, { creator, fan }, kind) {
    const { count, minutesSince, fanSpoke } = ctx;
    const theirs = count === 1 ? `line of the conversation is ${creator}'s OWN message` : `${count} lines of the conversation are ${creator}'s OWN messages`;
    const it = count === 1 ? 'it' : 'them';

    let timing;
    if (minutesSince < QUICK_MIN) {
        timing = `${creator} sent ${it} moments ago — ${fan} may not have even read ${it} yet. This is not a nudge: write a short add-on that continues ${creator}'s own thought (a second bubble, an afterthought). Never a "you there?" check.`;
    } else if (minutesSince < NUDGE_MIN) {
        timing = `${fan} has gone quiet for a while. Give ${fan} a light, low-pressure reason to reply — no guilt, no "you there?", no chasing.`;
    } else {
        timing = `${fan} went silent. Per SILENT TREATMENT & POWER: ONE thoughtful, high-value check-in after time — not chasing, not needy.`;
    }

    const lines = [
        `=== FOLLOW-UP — ${fan.toUpperCase()} HAS NOT REPLIED YET ===`,
        `The last ${theirs} (sent ${agoPhrase(minutesSince)}). ${fan} has not answered ${it} yet.`,
        `- ${count === 1 ? 'That message is' : 'Those messages are'} ${creator}'s, not ${fan}'s. Do NOT reply to ${it}, answer ${count === 1 ? 'its' : 'their'} questions, or react to ${it} as if ${fan} sent ${it}.`,
        fanSpoke
            ? `- ${fan}'s last message has ALREADY been answered. Do NOT answer it again, and do NOT repeat or rephrase what ${creator} already said. Any REPLY GAP CONTEXT above measures ${fan}'s last message — it does not mean ${fan} just replied.`
            : `- ${fan} has not written anything yet. Do NOT repeat or rephrase what ${creator} already said.`,
        `- ${timing}`,
    ];
    if (count >= 2) {
        lines.push(`- ${creator} has already sent ${count} messages in a row with no reply. Do not chase — one thoughtful message beats five needy ones.`);
    }
    lines.push(kind === 'strategy'
        ? `Plan THIS follow-up. In last_message_read, say that ${fan} has not replied to ${creator}'s last message yet.`
        : `Now write ${creator}'s follow-up message:`);

    return '\n\n' + lines.join('\n');
}

/** Appends `note` to a prompt that is a string or an array of content blocks. */
function append(prompt, note) {
    if (Array.isArray(prompt)) return [...prompt, { type: 'text', text: note }];
    return String(prompt) + note;
}

/**
 * Wraps the transports so the reply-writing calls end with the follow-up note. Other calls
 * pass through untouched.
 */
function withFollowUp({ callApi, callMistral }, ctx, names) {
    const strategyNote = followUpNote(ctx, names, 'strategy');
    const generatorNote = followUpNote(ctx, names, 'generator');

    return {
        callApi: (system, user, maxTokens, forceModel, callType) => {
            const tag = String(callType || '');
            const note = tag.startsWith('strategy') ? strategyNote : tag.startsWith('generator') ? generatorNote : '';
            return callApi(system, note ? append(user, note) : user, maxTokens, forceModel, callType);
        },
        callMistral: (persona, strategy, conversation, ...rest) => callMistral(persona, strategy, append(conversation, generatorNote), ...rest),
    };
}

module.exports = { followUpContext, followUpNote, withFollowUp };
