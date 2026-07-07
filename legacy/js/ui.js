function toast(msg,type='i'){
  const c=document.getElementById('toasts');
  const t=document.createElement('div');
  t.className=`toast ${type}`;
  // Truncate very long messages so toasts don't blanket the UI
  const text=String(msg||'');
  t.textContent=text.length>180?text.slice(0,180)+'…':text;
  t.title=text; // full message on hover
  c.appendChild(t);setTimeout(()=>t.remove(),3500);
}

// v0.3.0.34: in-page confirm modal (replaces window.confirm).
// Native confirm() popups are invisible to the Claude-in-Chrome browser-automation
// tools (they're rendered outside the page DOM). This in-page version lives in
// the page itself so automation can find the buttons by data-attr and click them.
// Returns a Promise<boolean>.
// confirmInPage(message)                       — basic yes/no confirmation
// confirmInPage(message, requiredText)          — requires user to type the exact phrase before OK enables
//   Used for high-stakes operations (doctrine reset, doctrine save bypass) so
//   casual misclicks cannot wipe critical state. v0.4.1.4.
function confirmInPage(message, requiredText){
  const TYPED=typeof requiredText==='string'&&requiredText.length>0;
  return new Promise(resolve=>{
    // Strip any existing instance
    document.querySelectorAll('.cip-overlay').forEach(n=>n.remove());
    const overlay=document.createElement('div');
    overlay.className='cip-overlay';
    overlay.setAttribute('data-cip','overlay');
    overlay.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:99999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(2px)';
    const typedHtml=TYPED?`
        <input data-cip="typed" type="text" placeholder="Type ${esc(requiredText)} to confirm" autocomplete="off" spellcheck="false" style="width:100%;padding:8px 12px;background:var(--bg,#0f0f0f);color:var(--text,#fff);border:1px solid var(--border,#444);border-radius:6px;font-size:13px;font-family:var(--mono,monospace);margin-bottom:14px;box-sizing:border-box" />`:'';
    overlay.innerHTML=`
      <div class="cip-box" style="background:var(--bg2,#1a1a1a);color:var(--text,#fff);border:1px solid var(--border,#333);border-radius:8px;padding:24px;min-width:400px;max-width:560px;box-shadow:0 10px 40px rgba(0,0,0,0.5)">
        <div class="cip-msg" style="font-size:14px;line-height:1.5;margin-bottom:20px;white-space:pre-wrap;word-wrap:break-word">${esc(message)}</div>
        ${typedHtml}
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button data-cip="cancel" class="btn" style="padding:8px 18px;background:transparent;color:var(--text,#fff);border:1px solid var(--border,#444);border-radius:6px;cursor:pointer;font-size:13px">Cancel</button>
          <button data-cip="ok" class="btn primary" ${TYPED?'disabled':''} style="padding:8px 18px;background:var(--blue,#3b82f6);color:#fff;border:0;border-radius:6px;cursor:${TYPED?'not-allowed':'pointer'};font-size:13px;font-weight:500;${TYPED?'opacity:0.4;':''}">${TYPED?'Confirm':'OK'}</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close=v=>{overlay.remove();document.removeEventListener('keydown',onk);resolve(v);};
    const okBtn=overlay.querySelector('[data-cip="ok"]');
    const typedInput=TYPED?overlay.querySelector('[data-cip="typed"]'):null;
    let okEnabled=!TYPED;
    if(TYPED){
      typedInput.addEventListener('input',()=>{
        const match=typedInput.value===requiredText;
        okEnabled=match;
        okBtn.disabled=!match;
        okBtn.style.cursor=match?'pointer':'not-allowed';
        okBtn.style.opacity=match?'1':'0.4';
      });
      // Focus the input, not the button
      setTimeout(()=>typedInput.focus(),50);
    } else {
      okBtn.focus();
    }
    okBtn.onclick=()=>{if(okEnabled) close(true);};
    overlay.querySelector('[data-cip="cancel"]').onclick=()=>close(false);
    overlay.onclick=e=>{if(e.target===overlay) close(false);};
    function onk(e){
      if(e.key==='Enter'&&okEnabled){close(true);}
      if(e.key==='Escape'){close(false);}
    }
    document.addEventListener('keydown',onk);
  });
}

function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

// Format a single message for AI prompt consumption.
// PPV bubbles become explicit tagged lines so the AI knows what was sent/purchased.
// opts.modelName required. opts.withTs toggles [HH:MM] prefix. opts.customerLabel defaults 'CUSTOMER'.
// ── REPLY-GAP HELPERS ─────────────────────────────────────────
// Forward-only: only messages added after ts_iso shipped have real timestamps.
// Historical messages without ts_iso get no gap prefix (graceful fallback).
function gapPhrase(prevIso,curIso){
  if(!prevIso||!curIso) return null;
  const ms=new Date(curIso).getTime()-new Date(prevIso).getTime();
  if(!isFinite(ms)||ms<0) return null;
  const sec=Math.floor(ms/1000);
  if(sec<120) return 'just now';
  const min=Math.floor(sec/60);
  if(min<60) return min+' min later';
  const hr=Math.floor(min/60);
  if(hr<24) return hr+(hr===1?' hr later':' hrs later');
  const day=Math.floor(hr/24);
  if(day<14) return day+(day===1?' day later':' days later');
  const wk=Math.floor(day/7);
  if(wk<8) return wk+(wk===1?' wk later':' wks later');
  const mo=Math.floor(day/30);
  return mo+(mo===1?' mo later':' mos later');
}
// Compute the reply-gap context for the LAST customer→creator turn.
// Used to inject a strategy block telling the AI: instant continuation /
// minutes-warm / hours-cooling / days-cold / weeks-reopen.
function lastReplyGapContext(msgs){
  if(!msgs||msgs.length<2) return null;
  // Find the last customer message and the message immediately before it
  // from the model side (that's the gap that matters: how long did he take
  // to come back to her last reach-out, OR how long has it been since his
  // last message if we're about to reply to him).
  let lastCustIdx=-1;
  for(let i=msgs.length-1;i>=0;i--){
    if(msgs[i].sender==='customer'){lastCustIdx=i;break;}
  }
  if(lastCustIdx<0) return null;
  const lastCust=msgs[lastCustIdx];
  if(!lastCust.ts_iso) return null;
  // Gap from his last message to NOW (i.e. how stale is his message we're
  // about to reply to). This is the more useful number for posture.
  const ms=Date.now()-new Date(lastCust.ts_iso).getTime();
  if(!isFinite(ms)||ms<0) return null;
  const min=Math.floor(ms/60000);
  let bucket,scenario,guidance;
  if(min<5){bucket='just now';scenario='instant_continuation';
    guidance='He just replied. This is live back-and-forth. Match the tempo — don\'t pad, don\'t reset, don\'t reintroduce energy. Continue the thread directly.';}
  else if(min<60){bucket=min+' min ago';scenario='warm_window';
    guidance='He replied within the hour. Still warm. Pick up where it left off, no reopener needed.';}
  else if(min<6*60){bucket=Math.floor(min/60)+' hrs ago';scenario='same_session_cooling';
    guidance='Same-day but cooling. Gentle re-engagement allowed — don\'t pretend it\'s instant, but don\'t over-reset either.';}
  else if(min<36*60){bucket=Math.floor(min/60)+' hrs ago';scenario='overnight_or_next_day';
    guidance='Likely overnight or next-day. Soft reopen. Reference yesterday/last night naturally if relevant. Don\'t restart from cold — pick up the thread.';}
  else if(min<7*24*60){bucket=Math.floor(min/(60*24))+' days ago';scenario='cold_reopen';
    guidance='Days-cold. He may have moved on mentally. Reopen with curiosity or a callback to something specific from before — not a generic "hey." Acknowledge the gap only if it\'s natural; never apologize for distance.';}
  else {bucket=Math.floor(min/(60*24))+' days ago';scenario='reengagement';
    guidance='Long gap. This is a re-engagement, not a continuation. Lead with something fresh — don\'t reference prior pitches. Treat this as a soft restart of the relationship arc, but do not lose the existing trust banked.';}
  return {bucket,scenario,guidance,minutesAgo:min};
}
function fmtMsgForAI(m,opts){
  const modelName=opts.modelName;
  const customerLabel=opts.customerLabel||'CUSTOMER';
  const ts=(opts.withTs&&m.ts)?'['+m.ts+'] ':'';
  if(m.sender==='ppv'){
    const price=(typeof m.price==='number')?'$'+m.price:'$?';
    const caption=(m.text||'').trim();
    const capPart=caption?' caption: "'+caption.replace(/"/g,'\\"')+'"':'';
    if(m.opened===true){
      return ts+'[PPV PURCHASED '+price+capPart+']';
    }
    return ts+'[PPV SENT '+price+' — unopened'+capPart+']';
  }
  const label=m.sender==='customer'?customerLabel:modelName.toUpperCase();
  // v0.4.1.4: message-type tags (feedback items #1, #3, #4)
  // Outgoing model tags: VN/Mass/FreeMedia — context for the brain about how previous
  // messages were delivered. Incoming customer tags: tip — buying signal even without PPV.
  let tagsSuffix='';
  if(m.tags){
    const tagBits=[];
    if(m.tags.vn) tagBits.push('VN');
    if(m.tags.mass) tagBits.push('MASS-MSG');
    // v0.4.4.0 Finding #6: surface the media DESCRIPTION so the brain reacts to what was
    // actually sent, not just that media exists. e.g. [FREE-MEDIA: topless mirror selfie].
    if(m.tags.freeMedia) tagBits.push('FREE-MEDIA'+(m.tags.mediaDescription?': '+m.tags.mediaDescription:''));
    if(m.tags.customerMedia) tagBits.push('CAME-WITH-MEDIA'+(m.tags.mediaDescription?': '+m.tags.mediaDescription:''));
    if(m.tags.tip){
      tagBits.push(typeof m.tags.tipAmount==='number'?('TIPPED $'+m.tags.tipAmount):'TIPPED');
    }
    if(tagBits.length>0) tagsSuffix=' ['+tagBits.join(' · ')+']';
  }
  return ts+label+tagsSuffix+': '+m.text;
}

// Array-level formatter: computes inline gap prefix between consecutive
// messages when ts_iso is present. Forward-only — historical messages
// without ts_iso just render without gap prefix.
function fmtMsgsForAI(msgs,opts){
  if(!msgs||!msgs.length) return '';
  const out=[];
  for(let i=0;i<msgs.length;i++){
    const m=msgs[i];
    const prev=i>0?msgs[i-1]:null;
    const gap=prev?gapPhrase(prev.ts_iso,m.ts_iso):null;
    if(gap&&i>0) out.push('  ··· '+gap+' ···');
    out.push(fmtMsgForAI(m,opts));
  }
  return out.join('\n');
}

// Global error net: surfaces script-level errors in the DB status indicator
// so a syntax error never silently leaves the app stuck on amber again.
window.addEventListener('error',function(ev){
  try{
    const dot=document.getElementById('dbDot');
    const lbl=document.getElementById('dbLabel');
    if(dot){dot.style.cssText='background:var(--red);box-shadow:0 0 5px var(--red)';}
    if(lbl){lbl.textContent='script error — '+(ev.message||'unknown')+(ev.lineno?' (line '+ev.lineno+')':'');}
  }catch(_){}
});
window.addEventListener('unhandledrejection',function(ev){
  try{
    const lbl=document.getElementById('dbLabel');
    if(lbl&&lbl.textContent==='connecting'){
      const dot=document.getElementById('dbDot');
      if(dot){dot.style.cssText='background:var(--red);box-shadow:0 0 5px var(--red)';}
      lbl.textContent='unhandled rejection — '+(ev.reason?.message||ev.reason||'unknown');
    }
  }catch(_){}
});
