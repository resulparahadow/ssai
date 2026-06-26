'use strict';
/**
 * Headless replacements for legacy js/api.js callApi / callMistral.
 * Same request shape as the legacy proxy path (model ids, cache_control system
 * blocks, anthropic-beta cache TTL, Mistral system-prompt template) but with
 * server-held keys from env and no DOM cost-logging. Returns the text; usage is
 * attached on the function's last-call ledger for the host to read if wanted.
 */

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6';
const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || 'mistralai/mistral-nemo';
const TRANSIENT = new Set([429, 502, 503, 504, 529]);

async function postJson(url, headers, body, tries = 3) {
    let lastErr;
    for (let attempt = 1; attempt <= tries; attempt++) {
        try {
            const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
            if (TRANSIENT.has(r.status) && attempt < tries) {
                await new Promise((res) => setTimeout(res, attempt === 1 ? 1200 : 3500));
                continue;
            }
            const d = await r.json();
            if (d.error) {
                const m = String(d.error.message || d.error || '').toLowerCase();
                if (attempt < tries && (m.includes('overload') || m.includes('rate limit') || m.includes('temporarily'))) {
                    await new Promise((res) => setTimeout(res, attempt === 1 ? 1200 : 3500));
                    continue;
                }
                throw new Error(d.error.message || String(d.error));
            }
            return d;
        } catch (e) {
            lastErr = e;
            if (attempt < tries && (e.name === 'TypeError' || /network|fetch/i.test(e.message || ''))) {
                await new Promise((res) => setTimeout(res, 1500));
                continue;
            }
            throw e;
        }
    }
    throw lastErr || new Error('request failed after retries');
}

/** callApi(system, user, maxTokens, forceModel, callType) -> text */
function makeRealCallApi() {
    const key = process.env.ANTHROPIC_API_KEY;
    return async function callApi(system, user, maxTokens, _forceModel, _callType) {
        if (!key) throw new Error('ANTHROPIC_API_KEY not set in the engine environment');
        const headers = {
            'Content-Type': 'application/json',
            'x-api-key': key,
            'anthropic-version': '2023-06-01',
            'anthropic-beta': 'extended-cache-ttl-2025-04-11',
        };
        const body = { model: ANTHROPIC_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] };
        const d = await postJson('https://api.anthropic.com/v1/messages', headers, body);
        return d.content?.[0]?.text || '';
    };
}

/** callMistral(creatorPersona, strategyJson, conversation, creatorName, maxTokens, contentLibrary, wallEnforcementBlock) -> text.
 *  The system prompt is copied verbatim from legacy js/api.js to preserve behavior. */
function makeRealCallMistral() {
    const key = process.env.OPENROUTER_API_KEY;
    return async function callMistral(creatorPersona, strategyJson, conversation, creatorName, maxTokens, contentLibrary, wallEnforcementBlock) {
        if (!key) throw new Error('OPENROUTER_API_KEY not set in the engine environment');
        const fb = (v, d = 'n/a') => (v === undefined || v === null || v === '') ? d : v;
        const bool = (v) => v === true || v === 'true';

        const systemPrompt = `You are ${creatorName}, an OnlyFans creator chatting with a fan right now.

PERSONA — you must stay in character as this person at all times:
${creatorPersona}
${contentLibrary ? `\n═══ CONTENT LIBRARY — HARD SOURCE OF TRUTH ═══\nThis is exactly what ${creatorName} sells. Never offer, imply, or reference content not listed here. If the customer asks for something not in this list, DO NOT say no — pivot with curiosity toward what exists.\n\n${contentLibrary}\n` : ''}

═══ CURRENT MESSAGE STRATEGY ═══
Claude has analyzed the full conversation and training framework. You must execute this exactly. Every rule below is non-negotiable.

CUSTOMER STATE:
- What his last message means in conversational flow: ${fb(strategyJson.last_message_read, 'responding to his last message')}
- What he wants right now: ${fb(strategyJson.customer_intent, 'continue conversation')}
- What language he is writing in: ${fb(strategyJson.customer_language, 'english')}
- Tone YOU must use: ${fb(strategyJson.tone, 'warm, flirty')}

CONVERSATION POSITION:
- Current phase: ${fb(strategyJson.phase, 'rapport')}
- Exact ritual step to execute: ${fb(strategyJson.ritual_step, 'engage naturally based on his last message')}
- Promise status for content cycle: ${fb(strategyJson.promise_status, 'not_started')}
- Content tier unlocked: ${fb(strategyJson.unlocked_tier, 'standard')}

WHAT THIS MESSAGE MUST ACHIEVE:
${fb(strategyJson.strategy, 'build rapport')}

SPECIFIC NEXT MOVE:
${fb(strategyJson.next_move, 'engage naturally')}

═══ MANDATORY RULES FOR THIS MESSAGE ═══
!! DEFLECTION CHECK: Read "${fb(strategyJson.last_message_read, 'responding to his last message')}". If this mentions deflection, tease, flip-back, redirect, "flipping the question back", or similar — you MUST NOT answer her original question. Flip the energy back with playful curiosity in ONE short line. No explanation, no mini-speech, no justification. Match his length exactly.
${bool(strategyJson.caption_required) ? `!! CAPTION REQUIRED: You are sending/about to send content. Caption guidance: ${fb(strategyJson.caption_guidance, 'curiosity only, never reveal what is inside, never describe body parts, create anticipation not specification')}` : ''}
${strategyJson.price_rule && strategyJson.price_rule !== 'n/a' ? `!! PRICE RULE: ${strategyJson.price_rule}` : ''}
${strategyJson.pricing_anchor && strategyJson.pricing_anchor !== 'n/a' ? `!! PRICING ANCHOR: ${strategyJson.pricing_anchor} — if price is unavoidable, use tier-minimum from library, never below` : ''}
${strategyJson.reason_to_buy && strategyJson.reason_to_buy !== 'n/a' ? `!! REASON TO BUY (required framing): ${strategyJson.reason_to_buy}` : ''}
${strategyJson.language_rule && strategyJson.language_rule !== 'n/a' ? `!! LANGUAGE RULE: ${strategyJson.language_rule}` : ''}
${strategyJson.content_safety_check && strategyJson.content_safety_check !== 'n/a' ? `!! CONTENT SAFETY: ${strategyJson.content_safety_check}` : ''}
${strategyJson.forbidden_in_this_message ? `!! DO NOT DO THESE THINGS IN THIS MESSAGE:\n${strategyJson.forbidden_in_this_message}` : ''}
${strategyJson.key_points ? `!! KEY POINTS TO WEAVE IN: ${strategyJson.key_points}` : ''}
${strategyJson.warnings ? `!! WARNING: ${strategyJson.warnings}` : ''}
${wallEnforcementBlock ? wallEnforcementBlock : ''}

═══ OUTPUT ═══
- Write ONE message only as ${creatorName}. Nothing else.
- No labels, no explanations, no quotes around the message.
- ${strategyJson.message_length === 'long' ? 'Write a longer message' : strategyJson.message_length === 'medium' ? 'Write a medium message' : 'Match the customer message length — short if his was short, one sentence reply if his was one sentence'}.
- Stay fully in character. Never mention being AI, a bot, or a chatter.
- Never sound like a store. No "here's the link," no listing prices, no transactional language.`;

        const headers = {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + key,
            'HTTP-Referer': 'https://smartstarsai.local',
            'X-Title': 'SmartStarsAI',
        };
        const body = {
            model: OPENROUTER_MODEL,
            max_tokens: maxTokens,
            messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: conversation }],
            temperature: 0.85,
            top_p: 0.9,
        };
        const d = await postJson('https://openrouter.ai/api/v1/chat/completions', headers, body);
        return d.choices?.[0]?.message?.content || '';
    };
}

module.exports = { makeRealCallApi, makeRealCallMistral };
