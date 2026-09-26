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
 *
 * The note QUOTES her unanswered messages and his last one. An abstract "the last line is
 * hers" was not enough (2026-09-26): told to "continue her own thought", the AI answered her own
 * question — "Rough morning or a good one? 😏" → "just out here enjoying my Saturday 😜 hope
 * yours is a good one". So there is no continue-her-thought advice any more: her questions are
 * his to answer, and the draft is a new message from a fresh angle.
 */

const QUICK_MIN = 15;
const NUDGE_MIN = 6 * 60;
const QUOTE_MAX = 140;
const QUOTE_LAST = 3;

/** A move by the fan: his message, or a PPV of hers that he bought (legacy's post-purchase path owns that). */
const isFanMove = (m) => m.sender === 'customer' || (m.sender === 'ppv' && m.opened === true);

const minutesAgo = (m, now) => {
    const at = Date.parse((m && m.ts_iso) || '');
    return Number.isFinite(at) ? Math.max(0, Math.floor((now - at) / 60000)) : 0;
};

/**
 * The creator's unanswered run at the end of the thread, or null when the fan moved last.
 *
 * @param {Array<{sender: string, text?: string, opened?: boolean, price?: number, ts_iso?: string}>} messages oldest → newest
 * @returns {{
 *   count: number, minutesSince: number, fanSpoke: boolean,
 *   run: Array<{text: string, ppv: boolean, price: number|null, minutesAgo: number}>,
 *   fanLast: {text: string, purchase: boolean, price: number|null, minutesAgo: number} | null,
 * } | null}  `minutesSince` = since HER newest message; `run` = her unanswered messages, oldest first
 */
function followUpContext(messages, now = Date.now()) {
    const msgs = Array.isArray(messages) ? messages : [];
    let i = msgs.length - 1;
    while (i >= 0 && !isFanMove(msgs[i])) i--;
    const count = msgs.length - 1 - i;
    if (count === 0) return null;

    const price = (m) => (typeof m.price === 'number' ? m.price : null);
    const fan = i >= 0 ? msgs[i] : null;

    return {
        count,
        minutesSince: minutesAgo(msgs[msgs.length - 1], now),
        fanSpoke: msgs.slice(0, i + 1).some((m) => m.sender === 'customer'),
        run: msgs.slice(i + 1).map((m) => ({
            text: String(m.text || ''), ppv: m.sender === 'ppv', price: price(m), minutesAgo: minutesAgo(m, now),
        })),
        fanLast: fan && {
            text: String(fan.text || ''), purchase: fan.sender === 'ppv', price: price(fan), minutesAgo: minutesAgo(fan, now),
        },
    };
}

function agoPhrase(min) {
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    if (min < 48 * 60) return `${Math.floor(min / 60)} hrs ago`;
    return `${Math.floor(min / (24 * 60))} days ago`;
}

function quote(text) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t) return '[media, no text]';
    return `"${t.length > QUOTE_MAX ? t.slice(0, QUOTE_MAX) + '…' : t}"`;
}

/** One of her unanswered messages, as quoted in the note. */
function herLine(m) {
    if (!m.ppv) return quote(m.text);
    const price = m.price != null ? ` $${m.price}` : '';
    const cap = m.text.trim() ? ` caption ${quote(m.text)}` : '';
    return `[PPV${price} — unopened]${cap}`;
}

/**
 * @param {ReturnType<typeof followUpContext>} ctx
 * @param {{creator: string, fan: string}} names
 * @param {'strategy'|'generator'} kind  strategy returns JSON, so it is never asked for a message
 */
function followUpNote(ctx, { creator, fan, override = false }, kind) {
    const { count, minutesSince, run, fanLast } = ctx;
    const lines = [`=== FOLLOW-UP — ${fan.toUpperCase()} HAS NOT REPLIED YET ===`];

    if (!fanLast) {
        // Not "has never written": the thread is only the last page the chatter loaded (100
        // messages), and a dormant fan can be buried under that many mass messages.
        lines.push(`No message from ${fan} in the conversation above.`);
    } else if (fanLast.purchase) {
        lines.push(`${fan}'s last move: he bought ${creator}'s ${fanLast.price != null ? '$' + fanLast.price + ' ' : ''}PPV (${agoPhrase(fanLast.minutesAgo)}).`);
    } else {
        lines.push(`${fan}'s last message: ${quote(fanLast.text)} (${agoPhrase(fanLast.minutesAgo)}) — ${creator} already replied to it.`);
    }

    lines.push(`Since then ${creator} has sent ${count === 1 ? '1 message' : count + ' messages'} that ${fan} has NOT answered:`);
    const shown = run.slice(-QUOTE_LAST);
    if (run.length > shown.length) lines.push(`  (+${run.length - shown.length} earlier)`);
    shown.forEach((m, k) => {
        const last = k === shown.length - 1 ? ` ← ${creator}'s last message` : '';
        lines.push(`  ${k + 1}. ${herLine(m)} (${agoPhrase(m.minutesAgo)})${last}`);
    });

    lines.push(`Those are ${creator}'s OWN words, not ${fan}'s.`);
    const selfAnswer = `Any question in them is for ${fan} to answer — ${creator} never answers her own question, never tells him her own answer to it, and never echoes it back ("hope yours is…", "mine was…").`;
    // Legacy's reasoning-leak filter (REASONING_PATTERNS, app.js ~8045) discards any draft that
    // OPENS with "actually"/"wait"/"hmm" and shows "[generation failed register check…]". Replies
    // rarely open that way; a follow-up that builds on her own line ("maybe a bath 🛁" →
    // "actually running it now") often does — 2 of 3 live runs died on it (2026-09-26).
    const opener = `- Do not start the message with "actually", "wait" or "hmm" — a draft that opens that way is thrown away.`;

    // The chatter typed a directive: give the FACTS only and let the directive choose the move.
    // Rules like "do not continue them" would contradict e.g. "finish her bath story", and a
    // contradiction makes the writer argue it out in its output — legacy then discards the
    // whole draft as a reasoning leak ("[generation failed register check…]").
    if (override) {
        lines.push(`- ${selfAnswer}`, `- What this message does is set by the AGENT OVERRIDE above — follow it.`);
        lines.push(...(kind === 'strategy'
            ? [`In last_message_read, say that ${fan} has not replied to ${creator}'s last message yet.`]
            : [opener, `Now write ${creator}'s next message:`]));
        return '\n\n' + lines.join('\n');
    }

    lines.push(
        `- Do NOT answer, react to, or continue them. ${selfAnswer}`,
        `- Do NOT repeat, rephrase or re-ask them${fanLast && !fanLast.purchase ? `, and do NOT answer ${fan}'s message again` : ''}.`,
        `- Write ONE new message to ${fan} from a fresh angle that gives him an easy, low-pressure reason to reply. No guilt, no "you there?".`,
        `- A fresh angle is a DIFFERENT topic, not ${creator}'s own side of the one she just raised: if she asked about his day, morning or mood, describing her own day, morning or mood IS answering her own question.`,
    );

    if (minutesSince < QUICK_MIN) {
        lines.push(`- ${creator}'s last message went out ${agoPhrase(minutesSince)} — ${fan} may not have even seen it yet. Keep this light and short.`);
    } else if (minutesSince < NUDGE_MIN) {
        lines.push(`- ${fan} has been quiet for ${agoPhrase(fanLast ? fanLast.minutesAgo : minutesSince).replace(' ago', '')}.`);
    } else {
        lines.push(`- ${fan} went silent. Per SILENT TREATMENT & POWER: ONE thoughtful, high-value check-in — not chasing, not needy.`);
    }
    if (count >= 2) {
        lines.push(`- ${creator} has already sent ${count} messages in a row with no reply. Do not chase — one thoughtful message beats five needy ones.`);
    }

    lines.push(...(kind === 'strategy'
        ? [`Plan THIS follow-up. In last_message_read, say that ${fan} has not replied to ${creator}'s last message yet — anything she asked is still open for HIM to answer.`]
        : [opener, `Now write ${creator}'s follow-up message:`]));

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
