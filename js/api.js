async function callApi(system,user,maxTokens,forceModel,callType){
  // v0.4.2.2: Refuse to generate if brain is fully corrupted (both code and Supabase bad).
  if(window.__brainCorrupted){
    throw new Error('Brain integrity check failed in both code and Supabase — generations disabled. Restore DEFAULT_TRAINING from git or aich_models_backups, then reload.');
  }
  // v0.3.0.38: route through Edge Function proxy unless explicitly disabled.
  // Proxy mode: only the proxy token leaves the browser; real Anthropic key lives server-side.
  const proxy=useProxy();
  let endpoint, headers;
  if(proxy){
    const tk=getProxyToken();
    if(!tk) throw new Error('Proxy token missing — contact your manager');
    endpoint=PROXY_URL;
    headers={
      'Content-Type':'application/json',
      'x-ssai-token':tk,
    };
  } else {
    const ck=localStorage.getItem('ss_claude')||CK_DEFAULT;
    if(!ck) throw new Error('Claude API key not configured — contact your manager');
    endpoint='https://api.anthropic.com/v1/messages';
    headers={
      'Content-Type':'application/json',
      'x-api-key':ck,
      'anthropic-version':'2023-06-01',
      'anthropic-dangerous-direct-browser-access':'true',
      'anthropic-beta':'extended-cache-ttl-2025-04-11'
    };
  }
  // v0.3.0.27_2: Sonnet 4.6 only. Haiku removed — was producing false-positive
  // fork classifications that cascaded into wrong whale signals + archetype labels.
  const modelId='claude-sonnet-4-6';
  const body={model:modelId,max_tokens:maxTokens,system,messages:[{role:'user',content:user}]};
  // v0.3.0.24: pre-compute size of system blocks for diagnostic
  let sysBlocks=[];
  if(Array.isArray(system)){
    sysBlocks=system.map((b,i)=>({
      idx:i,
      hasCacheControl:!!b.cache_control,
      chars:(b.text||'').length,
      // estimate tokens at ~4 chars/token (rough but useful for spotting <1024 token blocks)
      estTokens:Math.round((b.text||'').length/4)
    }));
  } else if(typeof system==='string'){
    sysBlocks=[{idx:0,hasCacheControl:false,chars:system.length,estTokens:Math.round(system.length/4)}];
  }
  const userChars=typeof user==='string'?user.length:JSON.stringify(user).length;
  const r=await fetch(endpoint,{method:'POST',headers,body:JSON.stringify(body)});
  const d=await r.json();
  if(d.error) throw new Error(d.error.message);
  // Cache diagnostic — log hit/miss + token costs to a window-level array we can inspect
  if(d.usage){
    const u=d.usage;
    const cacheReadTokens=u.cache_read_input_tokens||0;
    const cacheCreateTokens=u.cache_creation_input_tokens||0;
    const regularInputTokens=u.input_tokens||0;
    const outputTokens=u.output_tokens||0;
    // v0.3.0.27_2: Sonnet 4.6 only — $3 in / $15 out per M
    // Cached read = 0.1x base input; 1h cache write = 2x base input
    const inRate=3;
    const outRate=15;
    const cacheReadRate=inRate*0.1; // $0.30 Sonnet
    const cacheWriteRate=inRate*2;  // $6.00 Sonnet (1h TTL)
    const inputCost=(regularInputTokens*inRate+cacheReadTokens*cacheReadRate+cacheCreateTokens*cacheWriteRate)/1000000;
    const outputCost=(outputTokens*outRate)/1000000;
    const totalCost=inputCost+outputCost;
    const entry={
      ts:new Date().toISOString(),
      callType:callType||'unknown',
      modelUsed:modelId,
      sysBlocks,
      userChars,
      input:regularInputTokens,
      cacheRead:cacheReadTokens,
      cacheCreate:cacheCreateTokens,
      output:outputTokens,
      cost:totalCost,
      cached:cacheReadTokens>0
    };
    if(!window._ssaiCostLog) window._ssaiCostLog=[];
    window._ssaiCostLog.push(entry);
    if(window._ssaiCostLog.length>200) window._ssaiCostLog.shift();
    // Also expose cumulative totals
    window._ssaiCostTotal=window._ssaiCostLog.reduce((a,e)=>a+e.cost,0);
    window._ssaiCacheHitRate=window._ssaiCostLog.filter(e=>e.cached).length/window._ssaiCostLog.length;
    // v0.3.0.22: surface in dashboard so we don't need DevTools
    // v0.3.0.23: show cost-per-response — the actual money-per-message metric.
    // Total cost since reload is unhelpful; what you want to know is "how much
    // does each message I generate cost me right now". Read respCount from the
    // dashboard counter (sResp) — it's the agent's count of generated msgs.
    try{
      const el=document.getElementById('sApiCost');
      if(el){
        const respEl=document.getElementById('sResp');
        const respCount=respEl?parseInt(respEl.textContent)||0:0;
        const total=window._ssaiCostTotal;
        const perMsg=respCount>0?(total/respCount):0;
        const hitPct=Math.round(window._ssaiCacheHitRate*100);
        const hitLabel=window._ssaiCostLog.length<3?'—':(hitPct+'%');
        const color=window._ssaiCostLog.length<3?'var(--text)':(hitPct>=70?'var(--green)':hitPct>=40?'var(--text)':'var(--red)');
        // Display: per-message cost (primary) · total · cache%
        const perMsgStr=respCount>0?'$'+perMsg.toFixed(3)+'/msg':'$'+total.toFixed(3);
        el.innerHTML=`${perMsgStr} · <span style="color:${color}">${hitLabel}</span>`;
        el.title=respCount>0
          ?`Per-message cost since page load: $${perMsg.toFixed(4)}\nTotal: $${total.toFixed(3)} across ${respCount} response${respCount===1?'':'s'} (${window._ssaiCostLog.length} API calls)\nCache hit: ${hitPct}% — green ≥70%, red <40%`
          :`Total since page load: $${total.toFixed(3)} (${window._ssaiCostLog.length} API calls — generate a response to see per-msg cost)`;
      }
    }catch(e){}
  }
  return d.content?.[0]?.text||'';
}

// ── v0.3.0.24: COST DIAGNOSTIC MODAL ───────────────────────────
// Click the "$/msg · Cache" card to see the last 10 API calls broken down by:
//   - call type (strategy / generator / intel / etc)
//   - tokens charged at each tier (regular, cache_read, cache_create)
//   - system block sizes (to spot blocks under 1024-token cache minimum)
//   - cost per call
// "Copy diagnostic" button copies a clean JSON dump for pasting into chat.
window.openCostDiagnostic=function(){
  const log=window._ssaiCostLog||[];
  const total=window._ssaiCostTotal||0;
  const hitPct=Math.round((window._ssaiCacheHitRate||0)*100);
  let body;
  if(!log.length){
    body='<div style="padding:20px;color:var(--text3)">No API calls logged yet. Generate a message first.</div>';
  } else {
    const recent=log.slice(-10).reverse();
    const rows=recent.map((e,i)=>{
      const totalIn=e.input+e.cacheRead+e.cacheCreate;
      const cacheMark=e.cacheRead>0?'<span style="color:var(--green)">HIT</span>':e.cacheCreate>0?'<span style="color:var(--amber)">MISS (wrote cache)</span>':'<span style="color:var(--red)">NO CACHE</span>';
      const sysBreakdown=(e.sysBlocks||[]).map((b,bi)=>`#${bi}:${b.estTokens}t${b.hasCacheControl?'✓':''}${b.estTokens<1024&&b.hasCacheControl?'<span style="color:var(--red)">⚠</span>':''}`).join(' · ');
      const modelTag='<span style="opacity:0.6">sonnet</span>';
      return `<tr style="border-top:1px solid var(--border)">
        <td style="padding:6px 8px;font-family:monospace;font-size:11px">${i===0?'<b style="color:var(--blue2)">latest</b>':'#'+(log.length-i)}</td>
        <td style="padding:6px 8px;font-size:11px">${e.callType||'?'}</td>
        <td style="padding:6px 8px;font-size:11px">${modelTag}</td>
        <td style="padding:6px 8px;font-size:11px">${cacheMark}</td>
        <td style="padding:6px 8px;font-family:monospace;font-size:11px">in:${totalIn} · out:${e.output}</td>
        <td style="padding:6px 8px;font-family:monospace;font-size:11px">r:${e.input} · cR:${e.cacheRead} · cW:${e.cacheCreate}</td>
        <td style="padding:6px 8px;font-family:monospace;font-size:11px">$${e.cost.toFixed(4)}</td>
        <td style="padding:6px 8px;font-size:10px;color:var(--text3)">${sysBreakdown||'(string sys)'}</td>
      </tr>`;
    }).join('');
    body=`
      <div style="padding:14px 18px">
        <div style="display:flex;gap:24px;margin-bottom:14px;font-size:13px">
          <div><b>Total:</b> $${total.toFixed(3)}</div>
          <div><b>Calls:</b> ${log.length}</div>
          <div><b>Cache hit:</b> <span style="color:${hitPct>=70?'var(--green)':hitPct>=40?'var(--amber)':'var(--red)'}">${hitPct}%</span></div>
        </div>
        <div style="font-size:10px;color:var(--text3);margin-bottom:8px">
          <b>Legend:</b> r = regular input · cR = cache_read · cW = cache_create · sys block ✓ = has cache_control · ⚠ = under 1024-token cache minimum (won't cache).
        </div>
        <div style="overflow:auto;max-height:50vh;border:1px solid var(--border);border-radius:4px">
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <thead style="background:var(--bg2);position:sticky;top:0">
              <tr>
                <th style="text-align:left;padding:6px 8px">#</th>
                <th style="text-align:left;padding:6px 8px">Type</th>
                <th style="text-align:left;padding:6px 8px">Model</th>
                <th style="text-align:left;padding:6px 8px">Cache</th>
                <th style="text-align:left;padding:6px 8px">Tokens</th>
                <th style="text-align:left;padding:6px 8px">Breakdown</th>
                <th style="text-align:left;padding:6px 8px">Cost</th>
                <th style="text-align:left;padding:6px 8px">Sys blocks</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        <div style="margin-top:12px;display:flex;gap:8px">
          <button class="btn" onclick="copyCostDiagnostic()">Copy diagnostic JSON</button>
          <button class="btn" onclick="document.getElementById('costDiagModal').remove()">Close</button>
        </div>
      </div>`;
  }
  // Remove existing modal if any
  const existing=document.getElementById('costDiagModal');
  if(existing) existing.remove();
  // Build modal
  const modal=document.createElement('div');
  modal.id='costDiagModal';
  modal.style.cssText='position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:flex-start;justify-content:center;padding-top:60px';
  modal.innerHTML=`<div style="background:var(--bg);border:1px solid var(--border);border-radius:8px;width:min(960px,94vw);max-height:80vh;overflow:hidden">
    <div style="padding:14px 18px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
      <div style="font-weight:600">API Cost Diagnostic — last ${Math.min(log.length,10)} calls</div>
      <div style="cursor:pointer;font-size:18px;color:var(--text3)" onclick="document.getElementById('costDiagModal').remove()">×</div>
    </div>
    ${body}
  </div>`;
  // Click outside to close
  modal.addEventListener('click',(e)=>{if(e.target===modal) modal.remove();});
  document.body.appendChild(modal);
};

window.copyCostDiagnostic=function(){
  const log=window._ssaiCostLog||[];
  const recent=log.slice(-10);
  const dump={
    version:'v0.3.0.24',
    totalCost:window._ssaiCostTotal||0,
    totalCalls:log.length,
    cacheHitRate:window._ssaiCacheHitRate||0,
    recentCalls:recent.map(e=>({
      callType:e.callType,
      modelUsed:e.modelUsed,
      cached:e.cached,
      tokens:{regular:e.input,cacheRead:e.cacheRead,cacheCreate:e.cacheCreate,output:e.output},
      cost:Number(e.cost.toFixed(5)),
      sysBlocks:e.sysBlocks,
      userChars:e.userChars
    }))
  };
  navigator.clipboard.writeText(JSON.stringify(dump,null,2)).then(()=>{
    if(window.toast) toast('Diagnostic copied to clipboard','s');
  }).catch(()=>{
    if(window.toast) toast('Copy failed — see console','e');
    console.log(JSON.stringify(dump,null,2));
  });
};

// ── MISTRAL GENERATION via OpenRouter ──────────────────────────
// Called only for message generation when api==='mistral'
// Model used: mistralai/mistral-nemo
// Receives Claude's strategy JSON + creator persona + conversation
async function callMistral(creatorPersona,strategyJson,conversation,creatorName,maxTokens,contentLibrary,wallEnforcementBlock){
  // v0.3.0.38: route through Edge Function proxy unless explicitly disabled.
  // Proxy mode: only the proxy token leaves the browser; real OpenRouter key lives server-side.
  const proxy=useProxy();
  let endpoint, headers;
  if(proxy){
    const tk=getProxyToken();
    if(!tk) throw new Error('Proxy token missing — contact your manager');
    endpoint=MISTRAL_PROXY_URL;
    headers={
      'Content-Type':'application/json',
      'x-ssai-token':tk,
    };
  } else {
    const ok=localStorage.getItem('ss_openrouter')||'';
    if(!ok) throw new Error('OpenRouter (Mistral) key not configured — contact your manager');
    endpoint='https://openrouter.ai/api/v1/chat/completions';
    headers={
      'Content-Type':'application/json',
      'Authorization':'Bearer '+ok,
      'HTTP-Referer':'https://smartstarsai.local',
      'X-Title':'SmartStarsAI'
    };
  }

  // Build a clean, explicit system prompt for Mistral
  // Claude's strategy JSON tells it exactly what to do — it just executes
  const fb=(v,d='n/a')=>(v===undefined||v===null||v==='')?d:v;
  const bool=v=>v===true||v==='true';

  const systemPrompt=`You are ${creatorName}, an OnlyFans creator chatting with a fan right now.

PERSONA — you must stay in character as this person at all times:
${creatorPersona}
${contentLibrary?`\n═══ CONTENT LIBRARY — HARD SOURCE OF TRUTH ═══\nThis is exactly what ${creatorName} sells. Never offer, imply, or reference content not listed here. If the customer asks for something not in this list, DO NOT say no — pivot with curiosity toward what exists.\n\n${contentLibrary}\n`:''}

═══ CURRENT MESSAGE STRATEGY ═══
Claude has analyzed the full conversation and training framework. You must execute this exactly. Every rule below is non-negotiable.

CUSTOMER STATE:
- What his last message means in conversational flow: ${fb(strategyJson.last_message_read,'responding to his last message')}
- What he wants right now: ${fb(strategyJson.customer_intent,'continue conversation')}
- What language he is writing in: ${fb(strategyJson.customer_language,'english')}
- Tone YOU must use: ${fb(strategyJson.tone,'warm, flirty')}

CONVERSATION POSITION:
- Current phase: ${fb(strategyJson.phase,'rapport')}
- Exact ritual step to execute: ${fb(strategyJson.ritual_step,'engage naturally based on his last message')}
- Promise status for content cycle: ${fb(strategyJson.promise_status,'not_started')}
- Content tier unlocked: ${fb(strategyJson.unlocked_tier,'standard')}

WHAT THIS MESSAGE MUST ACHIEVE:
${fb(strategyJson.strategy,'build rapport')}

SPECIFIC NEXT MOVE:
${fb(strategyJson.next_move,'engage naturally')}

═══ MANDATORY RULES FOR THIS MESSAGE ═══
!! DEFLECTION CHECK: Read "${fb(strategyJson.last_message_read,'responding to his last message')}". If this mentions deflection, tease, flip-back, redirect, "flipping the question back", or similar — you MUST NOT answer her original question. Flip the energy back with playful curiosity in ONE short line. No explanation, no mini-speech, no justification. Match his length exactly.
${bool(strategyJson.caption_required)?`!! CAPTION REQUIRED: You are sending/about to send content. Caption guidance: ${fb(strategyJson.caption_guidance,'curiosity only, never reveal what is inside, never describe body parts, create anticipation not specification')}`:''}
${strategyJson.price_rule&&strategyJson.price_rule!=='n/a'?`!! PRICE RULE: ${strategyJson.price_rule}`:''}
${strategyJson.pricing_anchor&&strategyJson.pricing_anchor!=='n/a'?`!! PRICING ANCHOR: ${strategyJson.pricing_anchor} — if price is unavoidable, use tier-minimum from library, never below`:''}
${strategyJson.reason_to_buy&&strategyJson.reason_to_buy!=='n/a'?`!! REASON TO BUY (required framing): ${strategyJson.reason_to_buy}`:''}
${strategyJson.language_rule&&strategyJson.language_rule!=='n/a'?`!! LANGUAGE RULE: ${strategyJson.language_rule}`:''}
${strategyJson.content_safety_check&&strategyJson.content_safety_check!=='n/a'?`!! CONTENT SAFETY: ${strategyJson.content_safety_check}`:''}
${strategyJson.forbidden_in_this_message?`!! DO NOT DO THESE THINGS IN THIS MESSAGE:\n${strategyJson.forbidden_in_this_message}`:''}
${strategyJson.key_points?`!! KEY POINTS TO WEAVE IN: ${strategyJson.key_points}`:''}
${strategyJson.warnings?`!! WARNING: ${strategyJson.warnings}`:''}
${wallEnforcementBlock?wallEnforcementBlock:''}

═══ OUTPUT ═══
- Write ONE message only as ${creatorName}. Nothing else.
- No labels, no explanations, no quotes around the message.
- ${strategyJson.message_length==='long'?'Write a longer message':strategyJson.message_length==='medium'?'Write a medium message':'Match the customer message length — short if his was short, one sentence reply if his was one sentence'}.
- Stay fully in character. Never mention being AI, a bot, or a chatter.
- Never sound like a store. No "here's the link," no listing prices, no transactional language.`;

  const r=await fetch(endpoint,{
    method:'POST',
    headers,
    body:JSON.stringify({
      model:'mistralai/mistral-nemo',
      max_tokens:maxTokens,
      messages:[
        {role:'system',content:systemPrompt},
        {role:'user',content:conversation}
      ],
      temperature:0.85,
      top_p:0.9
    })
  });
  const d=await r.json();
  if(d.error) throw new Error(d.error.message||JSON.stringify(d.error));
  return d.choices?.[0]?.message?.content||'';
}

