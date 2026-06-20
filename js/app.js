
// ── INIT ──────────────────────────────────────────────────────
async function init(){
  // Show no-key banner immediately if Claude API key isn't set in localStorage.
  // This catches the case where the agent opens the app fresh and would otherwise
  // see "connecting → green" and assume everything works, then hit a confusing
  // error on the first generation attempt.
  // v0.3.0.38: banner hides if proxy is on (no Anthropic key needed in browser)
  // OR if proxy is off but ss_claude is set (legacy direct mode).
  const banner=document.getElementById('noKeyBanner');
  if(banner) banner.style.display=(useProxy()||localStorage.getItem('ss_claude'))?'none':'block';
  document.getElementById('dashDate').textContent=new Date().toLocaleDateString('en-US',{weekday:'long',year:'numeric',month:'long',day:'numeric'});
  // v0.4.1.0: apply role-based UI gating before anything else renders. This
  // guarantees agents never see the API toggle or Settings button, even briefly.
  applyRoleGating();
  // Silent API mode hydration — sync DOM to the already-loaded `api` value from localStorage. No toast on boot.
  // v0.4.1.0: btnAuto/btnClaude/btnMistral are inside the manager-only #apiSwitcher container;
  // skip this hydration entirely for non-managers (the elements are visible-but-hidden, so
  // toggling .on classes still works, but there's no point — and it avoids future null breaks).
  const isManager=window.currentChatter?.role==='manager';
  if(isManager){
    document.getElementById('btnAuto').classList.toggle('on',api==='auto');
    document.getElementById('btnClaude').classList.toggle('on',api==='claude');
    document.getElementById('btnMistral').classList.toggle('on',api==='mistral');
  }
  const labels={auto:'Auto',claude:'Claude',mistral:'Mistral'};
  document.getElementById('sApi').textContent=labels[api]||api;
  // v0.4.1.0: initialize dashboard date range to "Today" so dashRangeLabel/perfHeader
  // show the right text on first paint.
  setDashRange('today');
  try{
    if(!sb) await getOrCreateSb();
    // Probe with timeout — if Supabase hangs (or window.supabase is missing
    // and the await is on a non-promise), fail fast to red instead of
    // staying amber forever.
    const probe=sb.from('aich_models').select('id').limit(1);
    const timeout=new Promise((_,rej)=>setTimeout(()=>rej(new Error('connection probe timed out after 8s')),8000));
    await Promise.race([probe,timeout]);
    setDb('green','connected');
    // Load models WITHOUT overwriting existing data
    await loadModels();
    await loadSessions();
    await syncTraining();
    loadDashMetrics();
    startDashAutoRefresh();
    // v0.4.1.0: pull pending feedback queue count for badge (manager-only — internally guarded)
    refreshFeedbackQueueBadge();
    toast('SmartStarsAI ready','s');
  }catch(e){
    setDb('red','offline — '+e.message);
    loadModelsLocal();
  }
}

function setDb(c,l){
  const cols={green:'var(--green)',red:'var(--red)',amber:'var(--amber)'};
  document.getElementById('dbDot').style.cssText=`background:${cols[c]};box-shadow:0 0 5px ${cols[c]}`;
  document.getElementById('dbLabel').textContent=l;
}

function goToDashboard(){
  // Hide active session container, show dashboard, deselect any active session.
  // Does NOT close/archive — session stays open in sidebar, just unfocused.
  if(activeId){
    activeId=null;
    renderSidebar();
  }
  document.getElementById('sessContainer').style.display='none';
  document.getElementById('dashView').style.display='block';
  loadDashMetrics();
  startDashAutoRefresh();
}

// ── DASHBOARD AUTO-REFRESH ──────────────────────────────────────
// Polls aich_events every 5s while dashboard is visible. Stops on session open.
let _dashRefreshInterval=null;
function startDashAutoRefresh(){
  if(_dashRefreshInterval) return; // already running
  _dashRefreshInterval=setInterval(()=>{
    const dashEl=document.getElementById('dashView');
    if(!dashEl||dashEl.style.display==='none'){
      stopDashAutoRefresh();
      return;
    }
    loadDashMetrics();
  },5000);
}
function stopDashAutoRefresh(){
  if(_dashRefreshInterval){
    clearInterval(_dashRefreshInterval);
    _dashRefreshInterval=null;
  }
}

// ── EDIT SPEND (manual override for data corrections) ─────────────
function openEditSpendModal(scope){
  // scope: 'session' = current session total_spend, 'lifetime' = customer profile lifetime
  const s=sessions[activeId];if(!s) return;
  const isLifetime=scope==='lifetime';
  const current=isLifetime
    ?(s._profile?.total_spend||0)
    :(parseFloat((s.total_spend||'0').toString().replace(/[$,]/g,''))||0);
  const label=isLifetime?'Lifetime spend (all-time across sessions)':'Session spend (after OF fee)';
  const subtitle=isLifetime
    ?'Lives on the customer profile. Use this when CreatorHero says they\'ve actually spent X but SSAI tracked Y.'
    :'Lives on the current session only. Use this when toggle clicks or test data inflated this session\'s spend.';
  const html=`<div class="ppv-modal-bg" id="editSpendBg" onclick="if(event.target===this)closeEditSpendModal()">
    <div class="ppv-modal" style="max-width:440px">
      <div class="ppv-modal-title">Edit ${isLifetime?'lifetime':'session'} spend</div>
      <div class="ppv-modal-sub">${esc(subtitle)}</div>
      <div class="ppv-modal-label">${label}</div>
      <div class="ppv-modal-price-row">
        <span class="ppv-modal-dollar">$</span>
        <input type="text" inputmode="decimal" class="ppv-modal-price-in" id="editSpendIn" value="${current}" autocomplete="off">
      </div>
      <div style="font-size:10px;color:var(--text3);margin-top:6px">Will be logged as a manual override event for audit. Posture and tier will recompute.</div>
      <div class="ppv-modal-acts">
        <button class="btn sm" onclick="closeEditSpendModal()">Cancel</button>
        <button class="btn sm primary" onclick="confirmEditSpend('${scope}')">Save</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
  const inp=document.getElementById('editSpendIn');
  if(inp){
    inp.focus();inp.select();
    inp.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();confirmEditSpend(scope);}
      else if(e.key==='Escape'){e.preventDefault();closeEditSpendModal();}
    });
  }
}

function closeEditSpendModal(){
  const bg=document.getElementById('editSpendBg');
  if(bg) bg.remove();
}

async function confirmEditSpend(scope){
  const s=sessions[activeId];if(!s) return;
  const inp=document.getElementById('editSpendIn');
  const newVal=parseFloat((inp?.value||'0').replace(/[$,]/g,''));
  if(isNaN(newVal)||newVal<0){toast('Enter a valid amount (≥0)','e');return;}
  const isLifetime=scope==='lifetime';
  const oldVal=isLifetime
    ?(s._profile?.total_spend||0)
    :(parseFloat((s.total_spend||'0').toString().replace(/[$,]/g,''))||0);
  if(isLifetime){
    if(!s.customer_username){toast('No customer profile key — cannot edit lifetime','e');return;}
    if(sb){
      await sb.from('customer_profiles').upsert({
        creator_model:s.creator_model,customer_username:s.customer_username,total_spend:newVal
      },{onConflict:'creator_model,customer_username'});
      await sb.from('aich_events').insert({
        session_id:activeId,creator_model:s.creator_model,customer_username:s.customer_username,
        event_type:'spend_override',payload:{scope:'lifetime',from:oldVal,to:newVal}
      });
    }
    if(s._profile) s._profile.total_spend=newVal;
    s._customerTier=computeCustomerTier(s,s._profile);
    recomputePosture(s);
    renderSession();
    toast(`Lifetime spend: $${oldVal} → $${newVal}`,'s');
  } else {
    s.total_spend=newVal;
    if(s._profile) s._profile.total_spend=newVal;
    s._customerTier=computeCustomerTier(s,s._profile);
    recomputePosture(s);
    if(sb){
      await sb.from('aich_sessions').update({total_spend:newVal,current_posture:s._posture||'WARM_BUILD'}).eq('id',activeId);
      if(s.customer_username){
        await sb.from('customer_profiles').upsert({
          creator_model:s.creator_model,customer_username:s.customer_username,total_spend:newVal
        },{onConflict:'creator_model,customer_username'});
      }
      await sb.from('aich_events').insert({
        session_id:activeId,creator_model:s.creator_model,customer_username:s.customer_username,
        event_type:'spend_override',payload:{scope:'session',from:oldVal,to:newVal}
      });
    }
    renderSession();
    toast(`Session spend: $${oldVal} → $${newVal}`,'s');
  }
  closeEditSpendModal();
}

// ── DIAGNOSTIC PANEL (replaces console) ─────────────────────────
let diagOpen=false;
function toggleDiag(){
  diagOpen=!diagOpen;
  const body=document.getElementById('diagBody');
  const caret=document.getElementById('diagCaret');
  if(body) body.style.display=diagOpen?'block':'none';
  if(caret) caret.textContent=diagOpen?'▼':'▶';
  if(diagOpen) renderDiag();
}

function renderDiag(){
  const s=sessions[activeId];if(!s) return;
  const c=document.getElementById('diagContent');
  if(!c) return;
  // Compute fresh ladder + wall state for accurate read
  let wallState={},ladderState={};
  try{wallState=computeWallState(s)||{};}catch(e){wallState={_err:e.message};}
  try{ladderState=computeLadderState(s,wallState)||{};}catch(e){ladderState={_err:e.message};}
  const last=s._lastStrategy||{};
  const driftColors={ok:'var(--green)',drift:'var(--amber)',severe_drift:'var(--red)',ppv_pending:'var(--text3)',post_land_warmup:'var(--green)',post_miss:'var(--amber)',drift_post_miss:'var(--red)',severe_drift_post_miss:'var(--red)'};
  const driftColor=driftColors[ladderState.driftSignal]||'var(--text2)';
  const fmt=v=>v==null?'<i style="color:var(--text3)">null</i>':typeof v==='string'?v:String(v);
  const html=`
<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px">
<b style="color:var(--text3)">DRIFT SIGNAL</b><span style="color:${driftColor};font-weight:600">${fmt(ladderState.driftSignal)}</span>
<b style="color:var(--text3)">FORK (V2)</b><span>${ladderState.fork?`<span style="color:var(--blue2);font-weight:600">${ladderState.fork.type.toUpperCase()}</span> <span style="color:var(--text3);font-size:10px">— ${ladderState.fork.evidence}</span>`:'<span style="color:var(--text3)">none</span>'}</span>
<b style="color:var(--text3)">WHALE (V2)</b><span>${ladderState.whaleSignal?`<span style="color:#7dd3fc;font-weight:600">${ladderState.whaleSignal.level.toUpperCase()}</span> <span style="color:var(--text3);font-size:10px">— ${ladderState.whaleSignal.doctrine}</span>`:'<span style="color:var(--text3)">none</span>'}</span>
<b style="color:var(--text3)">PAUSE-PITCHING (V2)</b><span>${ladderState.pausePitching?`<span style="color:var(--amber);font-weight:600">ON</span> <span style="color:var(--text3);font-size:10px">— ${ladderState.pauseReason}</span>`:'<span style="color:var(--text3)">off</span>'}</span>
<b style="color:var(--text3)">msgs since pitch</b><span>${fmt(ladderState.messagesSinceLastPitch)}</span>
<b style="color:var(--text3)">pitches this session</b><span>${fmt(ladderState.pitchCountSession)}</span>
<b style="color:var(--text3)">last tier / price</b><span>${fmt(ladderState.lastPitchTier)} ${ladderState.lastPpvPrice!=null?'· $'+ladderState.lastPpvPrice:''} ${ladderState.lastPpvOpened===true?'· OPENED':ladderState.lastPpvOpened===false?'· not opened':''}</span>
<b style="color:var(--text3)">recent first-PPV</b><span>${ladderState.recentFirstPpv?'<span style="color:var(--green)">YES — depth gate bypassed</span>':'no'}</span>
<b style="color:var(--text3)">posture / tier</b><span>${fmt(s._posture)} · ${fmt(s._customerTier)}</span>
<b style="color:var(--text3)">free / unpaidCTA</b><span>${fmt(s._freeMsgCount)} / ${fmt(s._unpaidCtaCount)}</span>
<b style="color:var(--text3)">investment (v0.4.1.2)</b><span>${(()=>{try{const inv=detectInvestmentSignals(s);const aiCount=s?.messages?.filter(m=>m.sender==='model').length||0;const lifetimeSpend=parseFloat((s?._profile?.total_spend||s?.total_spend||0).toString().replace(/[$,]/g,''))||0;const frameHold=inv.count===0&&aiCount>=3&&lifetimeSpend===0;const color=frameHold?'var(--amber)':inv.count>=2?'var(--green)':'var(--text2)';const tags=inv.signals.map(x=>x.type).join(', ')||'none';return `<span style="color:${color};font-weight:600">${inv.count}</span> <span style="color:var(--text3);font-size:10px">${tags}${frameHold?' · FRAME-HOLD':''}</span>`;}catch(e){return '<span style="color:var(--text3)">err</span>';}})()}</span>
</div>
<div style="margin-top:8px;border-top:1px dashed var(--border);padding-top:6px">
<div style="color:var(--text3);font-weight:600;font-size:9px;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px">PLAN CONTINUITY</div>
<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px">
<b style="color:var(--text3)">last turn planned</b><span>${fmt(ladderState.nextPlannedMove)}</span>
<b style="color:var(--text3)">planned at msg</b><span>${fmt(ladderState.nextPlannedMoveAtMsg)} (current: ${s.messages?.length||0})</span>
<b style="color:var(--text3)">this turn's plan</b><span style="color:var(--blue2)">${fmt(last.next_planned_move)}</span>
<b style="color:var(--text3)">plan reason</b><span style="color:var(--text2)">${fmt(last.next_planned_move_reason)}</span>
</div>
</div>
<div style="margin-top:8px;border-top:1px dashed var(--border);padding-top:6px">
<div style="color:var(--text3);font-weight:600;font-size:9px;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px">WALL STATE</div>
<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px">
<b style="color:var(--text3)">PPVs sent / missed</b><span>${fmt(wallState.ppvSentCount)} / ${fmt(wallState.ppvMissedCount)}</span>
<b style="color:var(--text3)">miss-locked</b><span style="color:${wallState.ppvMissedAfterChance?'var(--red)':'var(--text2)'}">${wallState.ppvMissedAfterChance?'YES — only exclusive_custom or goodbye':'no'}</span>
<b style="color:var(--text3)">session purchases</b><span>${fmt(wallState.sessionPurchaseCount)}</span>
<b style="color:var(--text3)">lifetime spend</b><span>$${fmt(wallState.lifetimeSpend)}</span>
<b style="color:var(--text3)">sell/hold hint</b><span>${fmt(wallState.sellHoldHint)}</span>
</div>
</div>
<div style="margin-top:8px;border-top:1px dashed var(--border);padding-top:6px">
<div style="color:var(--text3);font-weight:600;font-size:9px;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px">LAST STRATEGY (clamped)</div>
<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px">
<b style="color:var(--text3)">phase</b><span>${fmt(last.phase)}</span>
<b style="color:var(--text3)">posture</b><span>${fmt(last.creator_posture)}</span>
<b style="color:var(--text3)">target emo / sex</b><span>${fmt(last.creator_target_emotional_level)} / ${fmt(last.creator_target_sexual_level)}</span>
<b style="color:var(--text3)">depth gated</b><span>${last._depthGated?'<span style="color:var(--amber)">yes — capped to ≤4</span>':last._depthGateBypass?'<span style="color:var(--green)">bypassed: '+last._depthGateBypass+'</span>':'no'}</span>
<b style="color:var(--text3)">next move after wall</b><span>${fmt(last.next_move_after_wall)}</span>
<b style="color:var(--text3)">forcing move</b><span>${fmt(last.forcing_move)}</span>
</div>${(()=>{const log=window._ssaiCostLog||[];if(!log.length) return '';const last=log[log.length-1];const total=window._ssaiCostTotal||0;const hitRate=window._ssaiCacheHitRate||0;const recent10=log.slice(-10);const avg10=recent10.length?recent10.reduce((a,e)=>a+e.cost,0)/recent10.length:0;return `
<div style="margin-top:8px;border-top:1px dashed var(--border);padding-top:6px">
<div style="color:var(--text3);font-weight:600;font-size:9px;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px">API COST · CLAUDE</div>
<div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px">
<b style="color:var(--text3)">last call</b><span>$${last.cost.toFixed(4)} ${last.cached?'<span style="color:var(--green)">· CACHED</span>':'<span style="color:var(--amber)">· uncached</span>'}</span>
<b style="color:var(--text3)">avg last 10</b><span>$${avg10.toFixed(4)}</span>
<b style="color:var(--text3)">cache hit rate</b><span style="color:${hitRate>=0.7?'var(--green)':hitRate>=0.4?'var(--amber)':'var(--red)'}">${(hitRate*100).toFixed(0)}% (${log.filter(e=>e.cached).length}/${log.length})</span>
<b style="color:var(--text3)">session total</b><span>$${total.toFixed(3)} (${log.length} calls)</span>
<b style="color:var(--text3)">last tokens in/out</b><span>${last.input+last.cacheRead+last.cacheCreate} / ${last.output} ${last.cacheRead?`<span style="color:var(--green)">(${last.cacheRead} from cache)</span>`:''}</span>
</div>
</div>`;})()}
</div>`;
  c.innerHTML=html;
  // Update badge in header
  const badge=document.getElementById('diagDriftBadge');
  if(badge){
    badge.textContent=ladderState.driftSignal||'';
    badge.style.color=driftColor;
  }
}

// ── DASHBOARD METRICS ─────────────────────────────────────────
// Dashboard day boundaries are UTC. "Today" = since 00:00:00 UTC.
// All event timestamps are stored as UTC in Supabase, so this keeps
// query math and display in the same frame with zero conversion.
function utcMidnightISO(){
  const now=new Date();
  return new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate(),0,0,0)).toISOString();
}

// v0.4.1.0: full date-range engine. State is {key, startISO, endISO, label}.
// Custom ranges set key='custom'. endISO=null means "now" (open-ended).
window.dashRangeState = window.dashRangeState || { key:'today', startISO:utcMidnightISO(), endISO:null, label:'Today' };

function computeRangeBounds(key){
  // All bounds in UTC. Returns {startISO, endISO, label}. endISO null = now.
  const now=new Date();
  const Y=now.getUTCFullYear(), M=now.getUTCMonth(), D=now.getUTCDate();
  const utcDay=(y,m,d)=>new Date(Date.UTC(y,m,d,0,0,0));
  const utcDayEnd=(y,m,d)=>new Date(Date.UTC(y,m,d,23,59,59,999));
  // ISO week: Mon-Sun. getUTCDay returns 0=Sun..6=Sat. Convert to 0=Mon..6=Sun.
  const dowMon0=(now.getUTCDay()+6)%7;
  const monThisWeek=utcDay(Y,M,D-dowMon0);
  switch(key){
    case 'today':       return {startISO:utcDay(Y,M,D).toISOString(), endISO:null, label:'Today'};
    case 'yesterday':   return {startISO:utcDay(Y,M,D-1).toISOString(), endISO:utcDayEnd(Y,M,D-1).toISOString(), label:'Yesterday'};
    case 'this_week':   return {startISO:monThisWeek.toISOString(), endISO:null, label:'This Week'};
    case 'last_week': {
      const lastMon=new Date(monThisWeek.getTime()-7*86400000);
      const lastSun=new Date(monThisWeek.getTime()-1);
      return {startISO:lastMon.toISOString(), endISO:lastSun.toISOString(), label:'Last Week'};
    }
    case 'this_month':  return {startISO:utcDay(Y,M,1).toISOString(), endISO:null, label:'This Month'};
    case 'last_month': {
      const start=utcDay(Y,M-1,1);
      const end=new Date(Date.UTC(Y,M,1,0,0,0)-1);
      return {startISO:start.toISOString(), endISO:end.toISOString(), label:'Last Month'};
    }
    case 'this_year':   return {startISO:utcDay(Y,0,1).toISOString(), endISO:null, label:'This Year'};
    case 'last_year': {
      const start=utcDay(Y-1,0,1);
      const end=new Date(Date.UTC(Y,0,1,0,0,0)-1);
      return {startISO:start.toISOString(), endISO:end.toISOString(), label:'Last Year'};
    }
    case 'all_time':    return {startISO:'1970-01-01T00:00:00.000Z', endISO:null, label:'All Time'};
    default:            return {startISO:utcMidnightISO(), endISO:null, label:'Today'};
  }
}

function setDashRange(key){
  const b=computeRangeBounds(key);
  window.dashRangeState={key, ...b};
  const lbl=document.getElementById('dashRangeLabel');
  const hdr=document.getElementById('perfHeader');
  if(lbl) lbl.textContent=b.label;
  if(hdr) hdr.textContent='Performance — '+b.label;
  loadDashMetrics();
}

// Legacy helper retained for any caller that still passes a string key.
function dashRangeStart(rangeKey){
  const b=computeRangeBounds(rangeKey||'today');
  return b.startISO;
}

async function loadDashMetrics(){
  if(!sb) return;
  // v0.4.1.0: read from window.dashRangeState (set by date picker), chatter filter
  // (manager-only), and model filter. Defends against missing state by falling back to today.
  if(!window.dashRangeState) window.dashRangeState=computeRangeBounds('today');
  const since=window.dashRangeState.startISO;
  const until=window.dashRangeState.endISO; // null = now
  const modelFilter=document.getElementById('dashModel')?.value||'';
  const chatterFilter=document.getElementById('dashChatter')?.value||'';
  // Pull events in range
  let q=sb.from('aich_events').select('event_type,creator_model,session_id,customer_username,payload,created_at,chatter_id').gte('created_at',since).order('created_at',{ascending:false}).limit(5000);
  if(until) q=q.lte('created_at',until);
  if(modelFilter) q=q.eq('creator_model',modelFilter);
  // For chatters (non-managers), force their own chatter_id regardless of dropdown.
  // Defense-in-depth: even if a chatter ever sees the dropdown, their queries stay scoped.
  const cur=window.currentChatter;
  if(cur && cur.role!=='manager' && cur.id){
    q=q.eq('chatter_id',cur.id);
  } else if(chatterFilter){
    q=q.eq('chatter_id',chatterFilter);
  }
  const{data:events,error}=await q;
  if(error){console.warn('dash events fetch failed:',error.message);return;}
  const ev=events||[];

  // Compute metrics
  const msgsSent=ev.filter(e=>e.event_type==='message_sent');
  const ppvPitched=ev.filter(e=>e.event_type==='ppv_pitched');
  // Net landed = ppv_landed events MINUS reversals (toggled back to unopened by agent).
  // We compute net per session_id, not globally — a reversal only cancels a landing in
  // its own session. Then sum up across sessions.
  const landedRaw=ev.filter(e=>e.event_type==='ppv_landed');
  const reversals=ev.filter(e=>e.event_type==='ppv_unlocked_reversed');
  const reversalsBySession={};
  reversals.forEach(r=>{reversalsBySession[r.session_id]=(reversalsBySession[r.session_id]||0)+1;});
  const landedRawBySession={};
  landedRaw.forEach(l=>{
    const k=l.session_id;
    if(!landedRawBySession[k]) landedRawBySession[k]=[];
    landedRawBySession[k].push(l);
  });
  const ppvLanded=[];
  Object.keys(landedRawBySession).forEach(sid=>{
    const events=landedRawBySession[sid];
    const reverseCount=reversalsBySession[sid]||0;
    // Keep the OLDEST landed events; drop the most recent ones equal to reversal count
    const keepCount=Math.max(0,events.length-reverseCount);
    events.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
    ppvLanded.push(...events.slice(0,keepCount));
  });
  const ppvMissed=ev.filter(e=>e.event_type==='ppv_missed');
  const aftercareEv=ev.filter(e=>e.event_type==='aftercare_triggered');
  const aftercareOn=aftercareEv.filter(e=>e.payload?.toggled_to==='on');
  const twFlagged=ev.filter(e=>e.event_type==='tw_flagged');
  const twFlaggedManual=twFlagged.filter(e=>e.payload?.trigger==='manual');
  const twFlaggedAuto=twFlagged.filter(e=>e.payload?.trigger==='auto_on_archive');
  const twCleared=ev.filter(e=>e.event_type==='tw_cleared');
  const archived=ev.filter(e=>e.event_type==='session_archived');

  // Drift: separate "pre-pitch warmup" from "post-pitch drift" — two different signals.
  // pre-pitch = messages logged in a session before any ppv_pitched event fires there
  // post-pitch = messages logged AFTER first pitch in that session (real ladder drift)
  // Doctrine: pre-pitch ideal is <8 (TTFP target), post-pitch ideal is 3-4 between pitches.
  // EXCLUSIONS (added v0.3.0.26+): aftercare and miss-lockout messages are NOT drift.
  // Aftercare is the doctrine working — a good close to a good session, the Percival formula
  // protecting last landed from regret. Miss-lockout is the doctrine intentionally halting
  // standard pitching. Counting either as drift false-flags doctrine working correctly and
  // inflates the average against well-handled sessions.
  // Manual messages are not logged through message_sent (generatedBy is always claude/mistral),
  // so no manual filter needed here.
  const driftPreReadings=[];
  const driftPostReadings=[];
  let excludedAftercare=0, excludedMissLocked=0;
  msgsSent.forEach(e=>{
    const v=e.payload?.messages_since_last_pitch;
    const ppvCount=parseFloat(e.payload?.ppv_count_session);
    if(v==null) return;
    const n=typeof v==='number'?v:parseFloat(v);
    if(!Number.isFinite(n)) return;
    // Exclude doctrine-pausing states from drift average
    if(e.payload?.aftercare_active===true){excludedAftercare++;return;}
    if(e.payload?.ppv_miss_locked===true){excludedMissLocked++;return;}
    // ppvCount=0 means no pitch has happened yet in this session → pre-pitch
    if(Number.isFinite(ppvCount) && ppvCount>0){
      driftPostReadings.push(n);
    } else {
      driftPreReadings.push(n);
    }
  });
  const avgDriftPost=driftPostReadings.length?(driftPostReadings.reduce((a,b)=>a+b,0)/driftPostReadings.length):null;
  const avgDriftPre=driftPreReadings.length?(driftPreReadings.reduce((a,b)=>a+b,0)/driftPreReadings.length):null;
  const overDoctrinePost=driftPostReadings.filter(v=>v>=5).length;

  // Conversion: landed / pitched
  const convRate=ppvPitched.length?(ppvLanded.length/ppvPitched.length*100):null;
  const missRate=ppvPitched.length?(ppvMissed.length/ppvPitched.length*100):null;

  // Time-to-first-pitch: per session, find first ppv_pitched, count message_sent events before it in same session
  const sessionFirstPitch=new Map();
  ppvPitched.forEach(e=>{
    if(!sessionFirstPitch.has(e.session_id)) sessionFirstPitch.set(e.session_id,e.created_at);
    else if(new Date(e.created_at)<new Date(sessionFirstPitch.get(e.session_id))) sessionFirstPitch.set(e.session_id,e.created_at);
  });
  const ttfpReadings=[];
  sessionFirstPitch.forEach((firstPitchAt,sid)=>{
    const msgsBeforeFirst=msgsSent.filter(m=>m.session_id===sid && new Date(m.created_at)<new Date(firstPitchAt)).length;
    ttfpReadings.push(msgsBeforeFirst);
  });
  const avgTtfp=ttfpReadings.length?(ttfpReadings.reduce((a,b)=>a+b,0)/ttfpReadings.length):null;

  // Tier distribution of LANDED PPVs (using gross from payload)
  const tierBuckets={T1:0,T2:0,T3:0,T4:0,T5:0};
  let totalGross=0;
  ppvLanded.forEach(e=>{
    const g=parseFloat(e.payload?.gross||0)||0;
    totalGross+=g;
    if(g<10) tierBuckets.T1++;
    else if(g<18) tierBuckets.T2++;
    else if(g<35) tierBuckets.T3++;
    else if(g<60) tierBuckets.T4++;
    else tierBuckets.T5++;
  });

  // By-model breakdown — use the netted ppvLanded (after subtracting reversals) for landed count
  const byModel={};
  ev.forEach(e=>{
    if(!e.creator_model) return;
    if(!byModel[e.creator_model]) byModel[e.creator_model]={msgs:0,pitched:0,landed:0,missed:0};
    if(e.event_type==='message_sent') byModel[e.creator_model].msgs++;
    else if(e.event_type==='ppv_pitched') byModel[e.creator_model].pitched++;
    else if(e.event_type==='ppv_missed') byModel[e.creator_model].missed++;
  });
  // Landed counts come from the post-reversal-net array, not raw event filter
  ppvLanded.forEach(e=>{
    if(!e.creator_model||!byModel[e.creator_model]) return;
    byModel[e.creator_model].landed++;
  });

  // Render top stats
  const $=id=>document.getElementById(id);
  $('mMsgs').textContent=msgsSent.length.toLocaleString();
  $('mMsgsSub').textContent=`across ${new Set(msgsSent.map(e=>e.session_id)).size} sessions`;
  $('mPpv').innerHTML=`${ppvPitched.length} <span style="color:var(--text3);font-weight:400">/</span> <span style="color:var(--green)">${ppvLanded.length}</span>`;
  $('mPpvSub').textContent=totalGross>0?`$${totalGross.toFixed(0)} gross`:'';
  $('mConv').textContent=convRate!=null?`${convRate.toFixed(0)}%`:'—';
  $('mConv').className='stat-v '+(convRate==null?'':convRate>=60?'green':convRate>=35?'':'');
  $('mConvSub').textContent=convRate!=null?`${ppvLanded.length}/${ppvPitched.length} pitched landed`:'';
  $('mMiss').textContent=missRate!=null?`${missRate.toFixed(0)}%`:'—';
  $('mMissSub').textContent=missRate!=null?`${ppvMissed.length} sessions hit lockout`:'';
  $('mDrift').textContent=avgDriftPost!=null?avgDriftPost.toFixed(1):'—';
  const driftClass=avgDriftPost==null?'':avgDriftPost>=5?'red':avgDriftPost>=4?'amber':'green';
  $('mDrift').style.color=driftClass==='red'?'var(--red)':driftClass==='amber'?'var(--amber)':driftClass==='green'?'var(--green)':'';
  $('mDriftSub').textContent=avgDriftPost!=null?`${overDoctrinePost} of ${driftPostReadings.length} post-pitch msgs over 4-beat doctrine${(excludedAftercare||excludedMissLocked)?` · excluded: ${excludedAftercare} aftercare, ${excludedMissLocked} miss-locked`:''}`:(driftPreReadings.length?`no post-pitch msgs yet · ${driftPreReadings.length} pre-pitch logged`:'no data yet');
  $('mWarmup').textContent=avgDriftPre!=null?avgDriftPre.toFixed(1):'—';
  const warmupClass=avgDriftPre==null?'':avgDriftPre>=10?'red':avgDriftPre>=5?'amber':'green';
  $('mWarmup').style.color=warmupClass==='red'?'var(--red)':warmupClass==='amber'?'var(--amber)':warmupClass==='green'?'var(--green)':'';
  $('mWarmupSub').textContent=avgDriftPre!=null?`avg msgs in session before first pitch`:'';
  $('mTtfp').textContent=avgTtfp!=null?avgTtfp.toFixed(1):'—';
  $('mAfter').textContent=aftercareOn.length;
  $('mAfterSub').textContent=`${aftercareEv.length} total toggles`;
  $('mTw').textContent=twFlagged.length;
  $('mTwSub').textContent=`${twFlaggedManual.length} manual · ${twFlaggedAuto.length} auto · ${twCleared.length} cleared`;
  // Sessions archived
  if($('mArchived')){
    $('mArchived').textContent=archived.length;
    const flaggedArchived=archived.filter(e=>e.payload?.auto_flagged_tw===true).length;
    $('mArchivedSub').textContent=archived.length?`${flaggedArchived} auto-flagged TW on close`:'';
  }
  // PPVs missed count
  if($('mMissCount')){
    $('mMissCount').textContent=ppvMissed.length;
    $('mMissCountSub').textContent=ppvMissed.length?'sessions hit miss-lockout':'';
  }
  // Spend overrides (manual edits)
  const overrideEv=ev.filter(e=>e.event_type==='spend_override');
  if($('mOverride')){
    $('mOverride').textContent=overrideEv.length;
    const sessionOverrides=overrideEv.filter(e=>e.payload?.scope==='session').length;
    const lifetimeOverrides=overrideEv.filter(e=>e.payload?.scope==='lifetime').length;
    $('mOverrideSub').textContent=overrideEv.length?`${sessionOverrides} session · ${lifetimeOverrides} lifetime`:'';
  }

  // Tier distribution
  const tierTotal=Object.values(tierBuckets).reduce((a,b)=>a+b,0);
  const tierEl=$('tierDist');
  if(tierTotal===0){
    tierEl.innerHTML='<div style="color:var(--text3);font-style:italic">No landed PPVs in range</div>';
  } else {
    const tierLabels={T1:'T1 ($0-9)',T2:'T2 ($10-17)',T3:'T3 ($18-34)',T4:'T4 ($35-59)',T5:'T5 ($60+)'};
    tierEl.innerHTML=Object.keys(tierBuckets).map(k=>{
      const n=tierBuckets[k];
      const pct=tierTotal?Math.round(n/tierTotal*100):0;
      const barW=tierTotal?Math.round(n/tierTotal*100):0;
      return `<div style="display:flex;align-items:center;gap:8px"><div style="width:80px;color:var(--text3);font-size:11px">${tierLabels[k]}</div><div style="flex:1;height:8px;background:var(--bg);border-radius:4px;overflow:hidden"><div style="height:100%;width:${barW}%;background:var(--blue2)"></div></div><div style="width:60px;text-align:right;font-size:11px"><b>${n}</b> <span style="color:var(--text3)">(${pct}%)</span></div></div>`;
    }).join('');
  }

  // Model breakdown
  const mEl=$('modelBreak');
  const mKeys=Object.keys(byModel);
  if(mKeys.length===0){
    mEl.innerHTML='<div style="color:var(--text3);font-style:italic">No activity in range</div>';
  } else {
    mEl.innerHTML=mKeys.sort((a,b)=>byModel[b].msgs-byModel[a].msgs).map(k=>{
      const m=byModel[k];
      const conv=m.pitched?Math.round(m.landed/m.pitched*100):null;
      return `<div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid var(--border)"><div style="flex:1;font-weight:500">${k}</div><div style="color:var(--text3);font-size:11px">${m.msgs} msgs · ${m.pitched} pitched · <span style="color:var(--green)">${m.landed} landed</span>${m.missed?' · <span style="color:var(--red)">'+m.missed+' miss</span>':''}${conv!=null?' · '+conv+'%':''}</div></div>`;
    }).join('');
  }

  // Fork distribution (V2): count fork_detected events by type. Each event
  // already deduped at log time (only fires on fork-type CHANGE per session),
  // so this count = number of distinct fork transitions, not raw firings.
  const forkEv=ev.filter(e=>e.event_type==='fork_detected');
  const forkCounts={love_framing:0,sexual_urgency:0,deflection:0,silence_breaker:0,vending_machine_attempt:0};
  const forkSessions={love_framing:new Set(),sexual_urgency:new Set(),deflection:new Set(),silence_breaker:new Set(),vending_machine_attempt:new Set()};
  forkEv.forEach(e=>{
    const t=e.payload?.fork_type;
    if(t&&forkCounts[t]!=null){
      forkCounts[t]++;
      forkSessions[t].add(e.session_id);
    }
  });
  const forkEl=$('forkDist');
  const totalForks=Object.values(forkCounts).reduce((a,b)=>a+b,0);
  if(totalForks===0){
    forkEl.innerHTML='<div style="color:var(--text3);font-style:italic">No fork events in range</div>';
  } else {
    const forkLabels={
      love_framing:{name:'Love framing',emoji:'🌹',color:'#f472b6'},
      sexual_urgency:{name:'Sexual urgency',emoji:'🔥',color:'#fb923c'},
      deflection:{name:'Deflection',emoji:'↩️',color:'#a78bfa'},
      silence_breaker:{name:'Silence breaker',emoji:'🌙',color:'#7dd3fc'},
      vending_machine_attempt:{name:'Vending-machine',emoji:'🤖',color:'#94a3b8'}
    };
    forkEl.innerHTML=Object.keys(forkCounts).map(k=>{
      const cnt=forkCounts[k];
      const sess=forkSessions[k].size;
      const pct=Math.round(cnt/totalForks*100);
      const meta=forkLabels[k];
      const barW=Math.max(2,pct);
      return `<div style="display:flex;align-items:center;gap:8px;font-size:12px"><div style="width:130px;color:${cnt>0?'var(--text)':'var(--text3)'}">${meta.emoji} ${meta.name}</div><div style="flex:1;height:6px;background:var(--bg);border-radius:3px;overflow:hidden"><div style="width:${barW}%;height:100%;background:${meta.color};opacity:${cnt>0?1:0.2}"></div></div><div style="width:80px;text-align:right;color:var(--text3);font-size:11px">${cnt} ${cnt===1?'fire':'fires'} · ${sess}s</div></div>`;
    }).join('');
  }

  // Whale signals (V2): count whale_signal events by level
  const whaleEv=ev.filter(e=>e.event_type==='whale_signal');
  const whaleCounts={whale_candidate:0,whale_developing:0,active_whale:0};
  const whaleSessions={whale_candidate:new Set(),whale_developing:new Set(),active_whale:new Set()};
  whaleEv.forEach(e=>{
    const lv=e.payload?.level;
    if(lv&&whaleCounts[lv]!=null){
      whaleCounts[lv]++;
      whaleSessions[lv].add(e.session_id);
    }
  });
  const whaleEl=$('whaleSignals');
  const totalWhale=Object.values(whaleCounts).reduce((a,b)=>a+b,0);
  if(totalWhale===0){
    whaleEl.innerHTML='<div style="color:var(--text3);font-style:italic">No whale signals in range</div>';
  } else {
    const whaleLabels={
      whale_candidate:{name:'Candidate (no spend yet)',color:'#7dd3fc'},
      whale_developing:{name:'Developing ($1-29)',color:'#38bdf8'},
      active_whale:{name:'Active whale ($250+)',color:'#0ea5e9'}
    };
    whaleEl.innerHTML=Object.keys(whaleCounts).map(k=>{
      const cnt=whaleCounts[k];
      const sess=whaleSessions[k].size;
      const meta=whaleLabels[k];
      return `<div style="display:flex;align-items:center;gap:8px;font-size:12px"><div style="flex:1;color:${cnt>0?'var(--text)':'var(--text3)'}">🐋 ${meta.name}</div><div style="color:${cnt>0?meta.color:'var(--text3)'};font-weight:600">${cnt}</div><div style="width:80px;text-align:right;color:var(--text3);font-size:11px">${sess} ${sess===1?'session':'sessions'}</div></div>`;
    }).join('');
  }

  // v0.4.1.4: SPEND BY ARCHETYPE + TOP SPENDERS (feedback item #5)
  // Cross-reference ppv_landed events with customer_profiles to break down spend by archetype.
  // Frequency = count of PPVs landed by customers of that archetype; Total = sum of gross.
  const archEl=$('archetypeSpend');
  const topEl=$('topSpenders');
  if(ppvLanded.length===0){
    if(archEl) archEl.innerHTML='<div style="color:var(--text3);font-style:italic">No PPV landings in range</div>';
    if(topEl) topEl.innerHTML='<div style="color:var(--text3);font-style:italic">No PPV landings in range</div>';
  } else {
    try{
      // Build lookup of unique (creator_model, customer_username) pairs from landings
      const customerKeys=new Set();
      ppvLanded.forEach(l=>{
        if(l.creator_model && l.customer_username){
          customerKeys.add(l.creator_model+'||'+l.customer_username);
        }
      });
      // Fetch profiles in one query (use .in() with composite keys is awkward in supabase-js,
      // so we'll fetch per creator_model and merge)
      const profilesByKey={};
      const byCreator={};
      customerKeys.forEach(k=>{
        const[creator,uname]=k.split('||');
        if(!byCreator[creator]) byCreator[creator]=[];
        byCreator[creator].push(uname);
      });
      await Promise.all(Object.keys(byCreator).map(async creator=>{
        const{data:rows,error:perr}=await sb.from('customer_profiles')
          .select('creator_model,customer_username,archetype,total_spend')
          .eq('creator_model',creator)
          .in('customer_username',byCreator[creator]);
        if(!perr && rows){
          rows.forEach(r=>{
            profilesByKey[r.creator_model+'||'+r.customer_username]={archetype:r.archetype||'Unknown',lifetime:parseFloat(r.total_spend||0)||0};
          });
        }
      }));
      // Aggregate by archetype
      const archAgg={}; // {archetype: {count, gross, customers:Set}}
      const customerAgg={}; // {key: {creator, uname, archetype, rangeSpend, rangeCount}}
      ppvLanded.forEach(l=>{
        const key=l.creator_model+'||'+l.customer_username;
        const prof=profilesByKey[key]||{archetype:'Unknown',lifetime:0};
        const arch=prof.archetype||'Unknown';
        const gross=parseFloat(l.payload?.gross||0)||0;
        if(!archAgg[arch]) archAgg[arch]={count:0,gross:0,customers:new Set()};
        archAgg[arch].count++;
        archAgg[arch].gross+=gross;
        archAgg[arch].customers.add(key);
        if(!customerAgg[key]) customerAgg[key]={creator:l.creator_model,uname:l.customer_username,archetype:arch,rangeSpend:0,rangeCount:0};
        customerAgg[key].rangeSpend+=gross;
        customerAgg[key].rangeCount++;
      });
      // Render archetype widget — sorted by total spend desc
      if(archEl){
        const archSorted=Object.keys(archAgg).sort((a,b)=>archAgg[b].gross-archAgg[a].gross);
        const maxGross=Math.max(...archSorted.map(a=>archAgg[a].gross));
        archEl.innerHTML=archSorted.map(a=>{
          const d=archAgg[a];
          const barW=maxGross>0?Math.max(2,Math.round(d.gross/maxGross*100)):0;
          return `<div style="display:flex;align-items:center;gap:8px;font-size:12px">
            <div style="width:140px;color:var(--text)">${esc(a)}</div>
            <div style="flex:1;height:6px;background:var(--bg);border-radius:3px;overflow:hidden"><div style="width:${barW}%;height:100%;background:var(--green)"></div></div>
            <div style="width:130px;text-align:right;font-size:11px"><b>$${d.gross.toFixed(0)}</b> <span style="color:var(--text3)">· ${d.count} PPV · ${d.customers.size} cust</span></div>
          </div>`;
        }).join('');
      }
      // Render top spenders widget — top 8 by range spend desc
      if(topEl){
        const top=Object.values(customerAgg).sort((a,b)=>b.rangeSpend-a.rangeSpend).slice(0,8);
        topEl.innerHTML=top.map(c=>{
          return `<div style="display:flex;align-items:center;gap:8px;font-size:12px;padding:4px 0;border-bottom:1px solid var(--border)">
            <div style="flex:1;color:var(--text)"><b>${esc(c.uname)}</b> <span style="color:var(--text3);font-size:10px">${esc(c.creator)}</span></div>
            <div style="color:var(--text3);font-size:10px">${esc(c.archetype||'?')}</div>
            <div style="width:90px;text-align:right;color:var(--green);font-weight:600">$${c.rangeSpend.toFixed(0)}</div>
            <div style="width:50px;text-align:right;color:var(--text3);font-size:10px">${c.rangeCount} PPV</div>
          </div>`;
        }).join('');
      }
    }catch(e){
      console.warn('archetype/top-spenders render failed:',e.message);
      if(archEl) archEl.innerHTML='<div style="color:var(--red);font-size:11px">Error: '+esc(e.message||String(e))+'</div>';
      if(topEl) topEl.innerHTML='<div style="color:var(--red);font-size:11px">Error: '+esc(e.message||String(e))+'</div>';
    }
  }

  // Recent archived sessions table
  const recentEl=$('recentSess');
  if(archived.length===0){
    recentEl.innerHTML='<div style="padding:14px;color:var(--text3);font-style:italic">No archived sessions in range</div>';
  } else {
    const rows=archived.slice(0,15).map(e=>{
      const p=e.payload||{};
      const when=new Date(e.created_at);
      const whenStr=when.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+when.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      const spend=p.session_spend?`$${parseFloat(p.session_spend).toFixed(0)}`:'$0';
      const ppvSummary=p.ppvs_pitched?`${p.ppvs_landed||0}/${p.ppvs_pitched} PPV`:'no pitch';
      const tierBadge=p.final_tier==='flagged_tw'?'<span style="color:var(--red);font-size:10px">TW</span>':p.final_tier?`<span style="color:var(--text3);font-size:10px">${p.final_tier.toUpperCase()}</span>`:'';
      const postureBadge=p.final_posture==='TIMEWASTER'?'<span style="color:var(--red);font-size:10px;margin-left:4px">⚠</span>':'';
      const aftercareBadge=p.had_aftercare?'<span style="color:var(--blue2);font-size:10px;margin-left:4px">aftercare</span>':'';
      return `<div style="display:grid;grid-template-columns:120px 1fr 100px 110px 60px;gap:10px;padding:10px 14px;border-bottom:1px solid var(--border);align-items:center;font-size:11px">
        <div style="color:var(--text3)">${whenStr}</div>
        <div><b>${e.creator_model||'?'}</b> · ${e.customer_username||'?'} ${tierBadge}${postureBadge}${aftercareBadge}</div>
        <div style="color:var(--text3)">${p.ai_messages||0} ai msgs</div>
        <div>${ppvSummary}</div>
        <div style="text-align:right;color:var(--green);font-weight:600">${spend}</div>
      </div>`;
    }).join('');
    recentEl.innerHTML='<div style="display:grid;grid-template-columns:120px 1fr 100px 110px 60px;gap:10px;padding:8px 14px;font-size:9px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--text3);border-bottom:1px solid var(--border);background:var(--bg)"><div>Archived</div><div>Model · Customer</div><div>AI Msgs</div><div>PPV Result</div><div style="text-align:right">Spend</div></div>'+rows;
  }

  // Populate model dropdown if empty (respect chatter assignment scope)
  const dashModelEl=$('dashModel');
  if(dashModelEl && Array.isArray(models)){
    const cur=window.currentChatter;
    const visible=(cur&&cur.role!=='manager'&&Array.isArray(cur.assignments))
      ? models.filter(m=>cur.assignments.includes(m.name))
      : models.filter(m=>m.name!=='__global_training__');
    const want='<option value="">All models</option>'+visible.map(m=>`<option value="${m.name}">${m.name}</option>`).join('');
    if(dashModelEl.innerHTML !== want){
      const cur2=dashModelEl.value;
      dashModelEl.innerHTML=want;
      dashModelEl.value=cur2;
    }
  }

  // v0.4.1.0: populate chatter filter dropdown (manager-only — gated in CSS by applyRoleGating)
  const dashChEl=$('dashChatter');
  if(dashChEl && window.currentChatter && window.currentChatter.role==='manager' && dashChEl.options.length<=1){
    try{
      const{chatters}=await callChatterAdmin('list',{});
      if(Array.isArray(chatters)){
        const sorted=chatters.slice().sort((a,b)=>(a.full_name||a.email).localeCompare(b.full_name||b.email));
        const opts='<option value="">All agents</option>'+sorted.map(c=>{
          const lbl=esc(c.full_name||c.email.split('@')[0]);
          const tag=c.role==='manager'?' (mgr)':'';
          return `<option value="${c.id}">${lbl}${tag}</option>`;
        }).join('');
        const prev=dashChEl.value;
        dashChEl.innerHTML=opts;
        dashChEl.value=prev;
      }
    }catch(e){/* silent — chatters list may not be reachable yet */}
  }

  // v0.4.1.0: refresh leaderboard widget if visible (manager-only, internally guarded)
  loadChatterLeaderboard(ev);
}

// ═══════════════════════════════════════════════════════════════
// v0.4.1.0: CHATTER LEADERBOARD (manager-only)
// Aggregates aich_events + aich_messages by chatter_id over the active date range.
// Surfaces SSAI-specific metrics: accept/reject rate, drift, pitched/landed,
// TW flags. Click chatter name to drill into their sessions for that range.
// ═══════════════════════════════════════════════════════════════
window.leaderboardState = window.leaderboardState || {
  rows:[],            // computed rows for export + drilldown
  sortKey:'sessions', // current sort column
  sortDir:'desc'      // 'asc' | 'desc'
};

async function loadChatterLeaderboard(eventsArg){
  // v0.4.1.0: leaderboard is shown to BOTH roles. For chatters, rows are anonymized
  // except their own. Managers see full names. The dashboard ev array passed in is
  // CHATTER-SCOPED for non-managers, so we ignore it here and always re-pull
  // unscoped — leaderboard needs the full team aggregate to compute rankings.
  const cur=window.currentChatter;
  if(!cur) return;
  const isManager=cur.role==='manager';
  const wrap=document.getElementById('chatterLeaderboardWrap');
  const body=document.getElementById('chatterLeaderboard');
  if(!wrap || !body) return;
  if(!sb){body.innerHTML='<div style="padding:14px;color:var(--text3);font-style:italic">DB not connected.</div>';return;}

  try{
    if(!window.dashRangeState) window.dashRangeState=computeRangeBounds('today');
    const since=window.dashRangeState.startISO;
    const until=window.dashRangeState.endISO;

    // Always unscoped — managers want everyone, chatters need everyone for ranking math
    // (their position relative to peers). Privacy is enforced at render time via
    // anonymization, not at query time.
    let evQ=sb.from('aich_events').select('event_type,creator_model,session_id,payload,created_at,chatter_id').gte('created_at',since).order('created_at',{ascending:false}).limit(5000);
    if(until) evQ=evQ.lte('created_at',until);
    let mq=sb.from('aich_messages').select('chatter_id,was_sent,feedback_text,created_at').gte('created_at',since).limit(10000);
    if(until) mq=mq.lte('created_at',until);
    const[{data:evData,error:evErr},{data:msgRows,error:msgErr},chattersResp]=await Promise.all([
      evQ,
      mq,
      callChatterAdmin('list',{}).catch(()=>({chatters:[]}))
    ]);
    if(evErr){body.innerHTML='<div style="padding:14px;color:var(--red)">Error: '+esc(evErr.message)+'</div>';return;}
    if(msgErr) console.warn('leaderboard messages fetch:',msgErr.message);
    const ev=evData||[];
    const messages=msgRows||[];
    const chatters=chattersResp.chatters||[];

    // Index chatters by id for name lookup
    const chatterById={};
    chatters.forEach(c=>{chatterById[c.id]=c;});

    // Aggregate by chatter_id
    const agg={};
    function ensure(cid){
      if(!agg[cid]){
        const c=chatterById[cid]||{};
        agg[cid]={
          chatter_id:cid,
          name:c.full_name||c.email?.split('@')[0]||'(unknown)',
          email:c.email||'',
          role:c.role||'?',
          last_seen:c.last_seen_at||null,
          sessions:new Set(),
          drafts:0, accepted:0, rejected:0,
          pitched:0, landed:0, missed:0,
          tw_manual:0, tw_auto:0,
          drift_sum:0, drift_n:0
        };
      }
      return agg[cid];
    }

    // Drafts/accept/reject from aich_messages
    messages.forEach(m=>{
      if(!m.chatter_id) return;
      const a=ensure(m.chatter_id);
      a.drafts++;
      if(m.was_sent===true) a.accepted++;
      else if(m.was_sent===false && m.feedback_text) a.rejected++;
    });

    // Sessions, pitched, landed, missed, TW flags from events
    // Drift comes from a per-session computed metric, but for leaderboard we approximate
    // using post_pitch_drift payload on session_archived events (we already log this).
    const reversalsBySession={};
    ev.forEach(e=>{
      if(e.event_type==='ppv_unlocked_reversed' && e.session_id)
        reversalsBySession[e.session_id]=(reversalsBySession[e.session_id]||0)+1;
    });
    const landedRawBySession={};
    ev.forEach(e=>{
      if(e.event_type==='ppv_landed' && e.session_id){
        if(!landedRawBySession[e.session_id]) landedRawBySession[e.session_id]=[];
        landedRawBySession[e.session_id].push(e);
      }
    });

    ev.forEach(e=>{
      if(!e.chatter_id) return;
      const a=ensure(e.chatter_id);
      if(e.session_id) a.sessions.add(e.session_id);
      if(e.event_type==='ppv_pitched') a.pitched++;
      if(e.event_type==='ppv_missed') a.missed++;
      if(e.event_type==='tw_flagged'){
        if(e.payload?.trigger==='manual') a.tw_manual++;
        else if(e.payload?.trigger==='auto_on_archive') a.tw_auto++;
      }
      if(e.event_type==='session_archived'){
        const drift=e.payload?.post_pitch_drift;
        if(drift!=null && !isNaN(parseFloat(drift))){
          a.drift_sum+=parseFloat(drift);
          a.drift_n++;
        }
      }
    });

    // Net landed accounting for reversals (oldest landings kept)
    Object.keys(landedRawBySession).forEach(sid=>{
      const events=landedRawBySession[sid];
      const reverseCount=reversalsBySession[sid]||0;
      const keepCount=Math.max(0,events.length-reverseCount);
      events.sort((a,b)=>new Date(a.created_at)-new Date(b.created_at));
      events.slice(0,keepCount).forEach(le=>{
        if(le.chatter_id){
          const a=ensure(le.chatter_id);
          a.landed++;
        }
      });
    });

    // Build final rows with derived metrics
    const rows=Object.values(agg).map(a=>({
      chatter_id:a.chatter_id,
      name:a.name,
      email:a.email,
      role:a.role,
      last_seen:a.last_seen,
      sessions:a.sessions.size,
      drafts:a.drafts,
      accept_rate:a.drafts?a.accepted/a.drafts:0,
      reject_rate:a.drafts?a.rejected/a.drafts:0,
      pitched:a.pitched,
      landed:a.landed,
      conv:a.pitched?a.landed/a.pitched:null,
      missed:a.missed,
      avg_drift:a.drift_n?a.drift_sum/a.drift_n:null,
      tw_flags:a.tw_manual+a.tw_auto
    }));

    // Drop zero-activity rows that had no SSAI footprint at all in this range
    const filtered=rows.filter(r=>r.drafts>0||r.sessions>0);
    window.leaderboardState.rows=filtered;
    renderChatterLeaderboard();
  }catch(e){
    body.innerHTML='<div style="padding:14px;color:var(--red)">Error: '+esc(e.message||String(e))+'</div>';
  }
}

function renderChatterLeaderboard(){
  const body=document.getElementById('chatterLeaderboard');
  if(!body) return;
  const st=window.leaderboardState;
  const rows=st.rows.slice();
  if(!rows.length){
    body.innerHTML='<div style="padding:14px;color:var(--text3);font-style:italic">No chatter activity in range.</div>';
    return;
  }
  // Sort
  const k=st.sortKey, dir=st.sortDir==='asc'?1:-1;
  rows.sort((a,b)=>{
    let av=a[k], bv=b[k];
    if(av==null) av=-Infinity;
    if(bv==null) bv=-Infinity;
    if(typeof av==='string') return av.localeCompare(bv)*dir;
    return (av-bv)*dir;
  });

  const fmtPct=(v)=>v==null?'<span style="color:var(--text3)">—</span>':(v*100).toFixed(0)+'%';
  const fmtNum=(v)=>v==null?'<span style="color:var(--text3)">—</span>':(typeof v==='number'?v.toFixed(v%1?1:0):String(v));
  const fmtSeen=(v)=>{
    if(!v) return '<span style="color:var(--text3)">never</span>';
    const d=new Date(v);
    const ms=Date.now()-d.getTime();
    if(ms<60000) return 'just now';
    if(ms<3600000) return Math.floor(ms/60000)+'m ago';
    if(ms<86400000) return Math.floor(ms/3600000)+'h ago';
    if(ms<7*86400000) return Math.floor(ms/86400000)+'d ago';
    return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
  };
  // Color helpers — accept rate green if high, reject rate red if high, drift red if >5
  const acceptColor=(v)=>v==null?'var(--text3)':(v>=0.7?'var(--green)':(v>=0.45?'var(--text2)':'var(--amber)'));
  const rejectColor=(v)=>v==null?'var(--text3)':(v>=0.3?'var(--red)':(v>=0.15?'var(--amber)':'var(--text2)'));
  const driftColor=(v)=>v==null?'var(--text3)':(v>=7?'var(--red)':(v>=5?'var(--amber)':'var(--text2)'));

  // v0.4.1.0: Rank assignment based on current sort. After rows are sorted, position
  // index = rank. Stamp .rank on each row so it can be displayed.
  rows.forEach((r,i)=>{r._rank=i+1;});

  // v0.4.1.0: anonymization for non-managers. Chatters see their OWN row with their
  // real name; everyone else becomes "Chatter #2", "#3", etc. by rank position.
  const cur=window.currentChatter;
  const isManager=cur&&cur.role==='manager';
  const myId=cur?.id;

  // Column definitions: {key, label, tooltip, formatter, color?}
  const cols=[
    {key:'_rank',      label:'#',           tip:'Rank by current sort column', sortable:false, align:'center'},
    {key:'name',       label:'Chatter',     tip:isManager?'Click name to view their sessions in this range':'Your name shows; teammates anonymized', align:'left'},
    {key:'sessions',   label:'Sessions',    tip:'Distinct sessions touched in range'},
    {key:'drafts',     label:'Drafts',      tip:'Total SSAI generations (accepted + rejected + still pending)'},
    {key:'accept_rate',label:'Accept %',    tip:'Drafts the chatter sent verbatim. High = trusts SSAI. Low = rewriting heavily.', fmt:fmtPct, color:acceptColor},
    {key:'reject_rate',label:'Reject %',    tip:'Drafts rejected with feedback. High = doctrine drift in SSAI for this chatter.', fmt:fmtPct, color:rejectColor},
    {key:'pitched',    label:'Pitched',     tip:'PPVs pitched in range'},
    {key:'landed',     label:'Landed',      tip:'PPVs landed (purchases) in range', color:()=>'var(--green)'},
    {key:'conv',       label:'Conv %',      tip:'Landed / Pitched', fmt:fmtPct},
    {key:'avg_drift',  label:'Avg Drift',   tip:'Avg post-pitch drift across archived sessions. >5 = drift, >7 = severe.', fmt:fmtNum, color:driftColor},
    {key:'tw_flags',   label:'TW',          tip:'Timewaster flags raised (manual + auto on archive)'},
    {key:'last_seen',  label:'Last Seen',   tip:'Most recent app activity', fmt:fmtSeen, align:'right'}
  ];

  // Header
  const sortIcon=(k)=>st.sortKey===k?(st.sortDir==='asc'?' ▲':' ▼'):'';
  const headerCells=cols.map(c=>{
    const align=c.align==='right'?'text-align:right':(c.align==='left'?'text-align:left':'text-align:center');
    const sortable=c.sortable!==false;
    const cursor=sortable?'cursor:pointer':'cursor:default';
    const onclick=sortable?`onclick="leaderboardSort('${c.key}')"`:'';
    const color=sortable&&st.sortKey===c.key?'var(--blue2)':'var(--text3)';
    return `<div title="${esc(c.tip)}" ${onclick} style="${align};${cursor};user-select:none;padding:8px 10px;font-size:9px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:${color}">${c.label}${sortable?sortIcon(c.key):''}</div>`;
  }).join('');

  // Body rows
  const grid='grid-template-columns:40px 1.4fr 70px 70px 80px 80px 70px 70px 70px 80px 50px 90px';
  const bodyRows=rows.map(r=>{
    const isMine=myId && r.chatter_id===myId;
    // Decide display name based on viewer role
    const displayName = isManager
      ? r.name
      : (isMine ? r.name + ' (you)' : 'Chatter #'+r._rank);
    const displayRole = isManager ? r.role : (isMine ? r.role : '');
    const rowBg = isMine ? 'background:rgba(91,141,238,0.08);' : '';
    const cells=cols.map(c=>{
      const align=c.align==='right'?'text-align:right':(c.align==='left'?'text-align:left':'text-align:center');
      const raw=r[c.key];
      const display=c.fmt?c.fmt(raw):fmtNum(raw);
      const colorStyle=c.color?`color:${c.color(raw)}`:'';
      if(c.key==='_rank'){
        const rankColor = r._rank===1 ? 'var(--green)' : (r._rank<=3 ? 'var(--blue2)' : 'var(--text2)');
        const rankWeight = r._rank<=3 ? '700' : '500';
        return `<div style="${align};padding:9px 10px;color:${rankColor};font-weight:${rankWeight};font-size:12px">#${r._rank}</div>`;
      }
      if(c.key==='name'){
        // Manager: clickable name with role badge subline
        // Chatter, own row: own name shown, no click
        // Chatter, other row: anonymized "Chatter #N", no click, no role
        if(isManager){
          return `<div style="${align};padding:9px 10px;font-weight:500"><a onclick="openChatterDrilldown('${r.chatter_id}')" style="color:var(--blue2);cursor:pointer;text-decoration:none" onmouseover="this.style.textDecoration='underline'" onmouseout="this.style.textDecoration='none'">${esc(displayName)}</a>${displayRole?`<div style="font-size:9px;color:var(--text3);font-weight:400;text-transform:uppercase;letter-spacing:0.04em;margin-top:1px">${esc(displayRole)}</div>`:''}</div>`;
        }
        // Chatter view
        const nameColor = isMine ? 'var(--blue2)' : 'var(--text2)';
        const nameWeight = isMine ? '600' : '400';
        return `<div style="${align};padding:9px 10px"><span style="color:${nameColor};font-weight:${nameWeight}">${esc(displayName)}</span>${displayRole?`<div style="font-size:9px;color:var(--text3);font-weight:400;text-transform:uppercase;letter-spacing:0.04em;margin-top:1px">${esc(displayRole)}</div>`:''}</div>`;
      }
      return `<div style="${align};padding:9px 10px;${colorStyle};font-size:11px">${display}</div>`;
    }).join('');
    return `<div style="display:grid;${grid};gap:0;border-bottom:1px solid var(--border);align-items:center;${rowBg}">${cells}</div>`;
  }).join('');

  body.innerHTML=`
    <div style="display:grid;${grid};gap:0;background:var(--bg);border-bottom:1px solid var(--border)">${headerCells}</div>
    ${bodyRows}
  `;
}

function leaderboardSort(key){
  const st=window.leaderboardState;
  if(st.sortKey===key){
    st.sortDir=st.sortDir==='asc'?'desc':'asc';
  } else {
    st.sortKey=key;
    // Default to descending for numeric, ascending for string
    st.sortDir=(key==='name')?'asc':'desc';
  }
  renderChatterLeaderboard();
}

function exportLeaderboardCsv(){
  // v0.4.1.0: manager-only — chatters shouldn't export the full team table
  if(window.currentChatter && window.currentChatter.role !== 'manager'){
    toast('Export is manager-only','e');
    return;
  }
  const rows=window.leaderboardState.rows||[];
  if(!rows.length){toast('No data to export','i');return;}
  const range=window.dashRangeState?.label||'range';
  const cols=['name','email','role','sessions','drafts','accept_rate','reject_rate','pitched','landed','conv','missed','avg_drift','tw_flags','last_seen'];
  const head=cols.join(',');
  const csvRow=(r)=>cols.map(k=>{
    let v=r[k];
    if(v==null) return '';
    if(k==='accept_rate'||k==='reject_rate'||k==='conv') v=v==null?'':(v*100).toFixed(1)+'%';
    if(k==='last_seen' && v) v=new Date(v).toISOString();
    if(typeof v==='string' && (v.includes(',')||v.includes('"'))) v='"'+v.replace(/"/g,'""')+'"';
    return v;
  }).join(',');
  const csv=head+'\n'+rows.map(csvRow).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url;
  a.download=`ssai_leaderboard_${range.replace(/\s+/g,'_').toLowerCase()}_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  toast('Exported','s');
}

async function openChatterDrilldown(chatterId){
  // v0.4.1.0: manager-only — chatters can only see their own data
  if(window.currentChatter && window.currentChatter.role !== 'manager') return;
  const row=window.leaderboardState.rows.find(r=>r.chatter_id===chatterId);
  if(!row) return;
  const range=window.dashRangeState?.label||'range';
  // Build modal
  const overlay=document.createElement('div');
  overlay.className='overlay';
  overlay.style.cssText='display:flex;z-index:10001';
  overlay.onclick=(e)=>{if(e.target===overlay) overlay.remove();};
  const modal=document.createElement('div');
  modal.className='modal lg';
  modal.style.cssText='background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r2);padding:22px;width:780px;max-width:95vw;max-height:88vh;overflow-y:auto';
  modal.innerHTML=`
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
      <div class="m-title" style="margin-bottom:0">${esc(row.name)} <span style="color:var(--text3);font-size:11px;font-weight:400;text-transform:uppercase;letter-spacing:0.06em">${row.role}</span></div>
      <button class="btn sm" onclick="this.closest('.overlay').remove()">Close</button>
    </div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:14px">${esc(row.email)} · ${range}</div>
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:18px">
      <div class="stat"><div class="stat-l">Sessions</div><div class="stat-v">${row.sessions}</div></div>
      <div class="stat"><div class="stat-l">Drafts</div><div class="stat-v">${row.drafts}</div></div>
      <div class="stat"><div class="stat-l">Accept %</div><div class="stat-v">${row.accept_rate==null?'—':(row.accept_rate*100).toFixed(0)+'%'}</div></div>
      <div class="stat"><div class="stat-l">Reject %</div><div class="stat-v">${row.reject_rate==null?'—':(row.reject_rate*100).toFixed(0)+'%'}</div></div>
      <div class="stat"><div class="stat-l">Pitched</div><div class="stat-v">${row.pitched}</div></div>
      <div class="stat"><div class="stat-l">Landed</div><div class="stat-v" style="color:var(--green)">${row.landed}</div></div>
      <div class="stat"><div class="stat-l">Conv %</div><div class="stat-v">${row.conv==null?'—':(row.conv*100).toFixed(0)+'%'}</div></div>
      <div class="stat"><div class="stat-l">Avg Drift</div><div class="stat-v">${row.avg_drift==null?'—':row.avg_drift.toFixed(1)}</div></div>
    </div>
    <div style="font-size:10px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--text3);margin-bottom:8px">Sessions in range</div>
    <div id="ddSessions" style="background:var(--bg);border:1px solid var(--border);border-radius:var(--r);overflow:hidden;font-size:11px">
      <div style="padding:12px;color:var(--text3);font-style:italic">Loading...</div>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // Fetch sessions for this chatter in range
  try{
    const since=window.dashRangeState?.startISO || computeRangeBounds('today').startISO;
    const until=window.dashRangeState?.endISO;
    let q=sb.from('aich_sessions').select('id,creator_model,customer_name,total_spend,status,last_active_at').eq('chatter_id',chatterId).gte('last_active_at',since).order('last_active_at',{ascending:false}).limit(100);
    if(until) q=q.lte('last_active_at',until);
    const{data,error}=await q;
    const list=document.getElementById('ddSessions');
    if(!list) return;
    if(error){list.innerHTML='<div style="padding:12px;color:var(--red)">Error: '+esc(error.message)+'</div>';return;}
    if(!data||!data.length){
      list.innerHTML='<div style="padding:12px;color:var(--text3);font-style:italic">No sessions in range.</div>';
      return;
    }
    const head=`<div style="display:grid;grid-template-columns:120px 1fr 100px 80px 70px;gap:8px;padding:8px 12px;font-size:9px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--text3);background:var(--bg2);border-bottom:1px solid var(--border)"><div>Last active</div><div>Model · Customer</div><div>Status</div><div style="text-align:right">Spend</div><div></div></div>`;
    const rows=data.map(s=>{
      const when=new Date(s.last_active_at);
      const whenStr=when.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' '+when.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
      const spend='$'+parseFloat(s.total_spend||0).toFixed(0);
      return `<div style="display:grid;grid-template-columns:120px 1fr 100px 80px 70px;gap:8px;padding:9px 12px;border-bottom:1px solid var(--border);align-items:center;font-size:11px">
        <div style="color:var(--text3)">${whenStr}</div>
        <div><b>${esc(s.creator_model||'?')}</b> · ${esc(s.customer_name||'?')}</div>
        <div><span style="font-size:10px;padding:2px 6px;border-radius:3px;background:${s.status==='active'?'var(--green-bg)':'var(--bg3)'};color:${s.status==='active'?'var(--green)':'var(--text3)'}">${s.status}</span></div>
        <div style="text-align:right;color:var(--green);font-weight:600">${spend}</div>
        <div></div>
      </div>`;
    }).join('');
    list.innerHTML=head+rows;
  }catch(e){
    const list=document.getElementById('ddSessions');
    if(list) list.innerHTML='<div style="padding:12px;color:var(--red)">Error: '+esc(e.message||String(e))+'</div>';
  }
}

// v0.4.1.0: DATE RANGE PICKER — modal with quick presets + month grid + custom range
window.dateRangePicker = window.dateRangePicker || {
  viewYear:null, viewMonth:null, // currently visible month in grid
  selStart:null, selEnd:null,    // pending selection (Date objects, UTC midnight)
  presetKey:null                 // selected preset (or 'custom')
};

function openDateRangeModal(){
  const dp=window.dateRangePicker;
  // Initialize from current dashRangeState
  const st=window.dashRangeState||computeRangeBounds('today');
  dp.presetKey=st.key;
  const start=new Date(st.startISO);
  dp.selStart=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),start.getUTCDate()));
  if(st.endISO){
    const end=new Date(st.endISO);
    dp.selEnd=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth(),end.getUTCDate()));
  } else {
    dp.selEnd=null;
  }
  // View defaults to selection start
  dp.viewYear=dp.selStart.getUTCFullYear();
  dp.viewMonth=dp.selStart.getUTCMonth();
  document.getElementById('modalDateRange').style.display='flex';
  // Wire prev/next buttons (idempotent — overwrites onclick each open)
  document.getElementById('drPrevMonth').onclick=()=>{
    let y=dp.viewYear, m=dp.viewMonth-1;
    if(m<0){m=11;y--;}
    dp.viewYear=y; dp.viewMonth=m;
    renderDateRangePicker();
  };
  document.getElementById('drNextMonth').onclick=()=>{
    let y=dp.viewYear, m=dp.viewMonth+1;
    if(m>11){m=0;y++;}
    dp.viewYear=y; dp.viewMonth=m;
    renderDateRangePicker();
  };
  // Wire preset buttons
  document.querySelectorAll('.dr-preset').forEach(b=>{
    b.onclick=()=>{
      const k=b.getAttribute('data-range');
      const bounds=computeRangeBounds(k);
      dp.presetKey=k;
      dp.selStart=new Date(bounds.startISO);
      dp.selStart=new Date(Date.UTC(dp.selStart.getUTCFullYear(),dp.selStart.getUTCMonth(),dp.selStart.getUTCDate()));
      if(bounds.endISO){
        const e=new Date(bounds.endISO);
        dp.selEnd=new Date(Date.UTC(e.getUTCFullYear(),e.getUTCMonth(),e.getUTCDate()));
      } else {
        dp.selEnd=null; // open-ended (e.g. Today/This Week → through now)
      }
      dp.viewYear=dp.selStart.getUTCFullYear();
      dp.viewMonth=dp.selStart.getUTCMonth();
      renderDateRangePicker();
    };
  });
  renderDateRangePicker();
}

function closeDateRangeModal(){
  document.getElementById('modalDateRange').style.display='none';
}

function renderDateRangePicker(){
  const dp=window.dateRangePicker;
  if(dp.viewYear===null) return;
  // Highlight active preset
  document.querySelectorAll('.dr-preset').forEach(b=>{
    b.classList.toggle('on', b.getAttribute('data-range')===dp.presetKey);
  });
  // Month label
  const monthNames=['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('drMonthLabel').textContent=monthNames[dp.viewMonth]+' '+dp.viewYear;
  // Selection label
  const fmt=(d)=>{
    if(!d) return '';
    const m=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()];
    return m+' '+String(d.getUTCDate()).padStart(2,'0')+', '+d.getUTCFullYear();
  };
  const lbl=document.getElementById('drSelectionLabel');
  if(dp.selStart && dp.selEnd && dp.selStart.getTime()!==dp.selEnd.getTime()){
    lbl.textContent=fmt(dp.selStart)+' → '+fmt(dp.selEnd);
  } else if(dp.selStart && !dp.selEnd){
    lbl.textContent=fmt(dp.selStart)+' → now';
  } else if(dp.selStart){
    lbl.textContent=fmt(dp.selStart);
  } else {
    lbl.textContent='—';
  }
  // Build grid
  const grid=document.getElementById('drGrid');
  const dows=['Mo','Tu','We','Th','Fr','Sa','Su'];
  const todayUtc=(()=>{const n=new Date();return new Date(Date.UTC(n.getUTCFullYear(),n.getUTCMonth(),n.getUTCDate())).getTime();})();
  const firstOfMonth=new Date(Date.UTC(dp.viewYear,dp.viewMonth,1));
  // Mon-first offset
  const firstDow=(firstOfMonth.getUTCDay()+6)%7;
  // Total days in view = 6 weeks * 7 = 42, starting from prev-month-tail
  const startCell=new Date(firstOfMonth.getTime() - firstDow*86400000);
  let html=dows.map(d=>`<div class="dr-dow">${d}</div>`).join('');
  for(let i=0;i<42;i++){
    const cellDate=new Date(startCell.getTime()+i*86400000);
    const cellDay=cellDate.getUTCDate();
    const inMonth=cellDate.getUTCMonth()===dp.viewMonth;
    const cellMs=cellDate.getTime();
    const startMs=dp.selStart?dp.selStart.getTime():null;
    const endMs=dp.selEnd?dp.selEnd.getTime():null;
    const classes=['dr-day'];
    if(!inMonth) classes.push('dr-other');
    if(cellMs===todayUtc) classes.push('dr-today');
    if(startMs && endMs && startMs!==endMs){
      if(cellMs===startMs) classes.push('dr-range-start');
      else if(cellMs===endMs) classes.push('dr-range-end');
      else if(cellMs>startMs && cellMs<endMs) classes.push('dr-in-range');
    } else if(startMs && cellMs===startMs){
      classes.push('dr-sel');
    }
    html+=`<button class="${classes.join(' ')}" data-ms="${cellMs}">${cellDay}</button>`;
  }
  grid.innerHTML=html;
  // Wire day clicks
  grid.querySelectorAll('button[data-ms]').forEach(btn=>{
    btn.onclick=()=>{
      const ms=parseInt(btn.getAttribute('data-ms'),10);
      const d=new Date(ms);
      const dp=window.dateRangePicker;
      dp.presetKey='custom';
      // First click after preset, OR a click that's earlier than current start → set as start, clear end
      if(!dp.selStart || dp.selEnd || ms < dp.selStart.getTime()){
        dp.selStart=d;
        dp.selEnd=null;
      } else if(ms === dp.selStart.getTime()){
        // Click on same day → keep as single-day
        dp.selEnd=null;
      } else {
        // Second click after start → set as end
        dp.selEnd=d;
      }
      renderDateRangePicker();
    };
  });
}

function applyDateRange(){
  const dp=window.dateRangePicker;
  if(!dp.selStart){ closeDateRangeModal(); return; }
  let label, key;
  if(dp.presetKey && dp.presetKey!=='custom'){
    const b=computeRangeBounds(dp.presetKey);
    window.dashRangeState={key:dp.presetKey, ...b};
    label=b.label;
  } else {
    // Custom range
    const startISO=new Date(Date.UTC(dp.selStart.getUTCFullYear(),dp.selStart.getUTCMonth(),dp.selStart.getUTCDate(),0,0,0)).toISOString();
    let endISO=null;
    if(dp.selEnd){
      endISO=new Date(Date.UTC(dp.selEnd.getUTCFullYear(),dp.selEnd.getUTCMonth(),dp.selEnd.getUTCDate(),23,59,59,999)).toISOString();
    } else {
      // single day
      endISO=new Date(Date.UTC(dp.selStart.getUTCFullYear(),dp.selStart.getUTCMonth(),dp.selStart.getUTCDate(),23,59,59,999)).toISOString();
    }
    const fmt=(d)=>['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()]+' '+d.getUTCDate();
    label = dp.selEnd
      ? fmt(dp.selStart)+' – '+fmt(dp.selEnd)
      : fmt(dp.selStart);
    window.dashRangeState={key:'custom', startISO, endISO, label};
  }
  const lbl=document.getElementById('dashRangeLabel');
  const hdr=document.getElementById('perfHeader');
  if(lbl) lbl.textContent=window.dashRangeState.label;
  if(hdr) hdr.textContent='Performance — '+window.dashRangeState.label;
  closeDateRangeModal();
  loadDashMetrics();
}

// ── MODELS — NEVER OVERWRITE EXISTING ─────────────────────────
async function loadModels(){
  const{data,error}=await sb.from('aich_models').select('*').neq('name','__global_training__').order('name');
  if(!error&&data&&data.length>0){
    // Real data exists — use it, never overwrite
    models=data;
    // feedback_rules already included in select *
  } else {
    // Only seed if truly empty
    models=getDefaultModels();
    for(const m of models){
      await sb.from('aich_models').upsert({name:m.name,tier:m.tier,prompt:m.prompt},{onConflict:'name'});
    }
  }
  setModelsStat();
  updateModelDrop();
}

function loadModelsLocal(){
  models=getDefaultModels();
  setModelsStat();
  updateModelDrop();
}

function getDefaultModels(){
  return[
    {name:'Sandra',tier:'Top 0.03% · ~300 new subs/day',prompt:'Paste Sandra\'s full model prompt in Settings → Creator Models.'},
    {name:'Cielo',tier:'Lightly clouded · ~20 subs/day',prompt:'Paste Cielo\'s full model prompt in Settings → Creator Models.'},
    {name:'Jammy',tier:'Not clouded · ~5 subs/day',prompt:'Paste Jammy\'s full model prompt in Settings → Creator Models.'},
    {name:'Camila',tier:'Free sub · Marketing leads',prompt:'Paste Camila\'s full model prompt in Settings → Creator Models.'},
    {name:'Cindy',tier:'Free sub · Marketing leads',prompt:'Paste Cindy\'s full model prompt in Settings → Creator Models.'},
    {name:'Marisabel',tier:'Free sub · Marketing leads',prompt:'Paste Marisabel\'s full model prompt in Settings → Creator Models.'}
  ];
}


// v0.4.1.0: Models count card respects role visibility — managers see total,
// chatters see only their assigned count.
function visibleModelCount(){
  const c = window.currentChatter;
  if(!c || c.role === 'manager') return models.length;
  if(Array.isArray(c.assignments)) return models.filter(m=>c.assignments.includes(m.name)).length;
  return 0;
}
function setModelsStat(){
  const el=document.getElementById('sModels');
  if(el) el.textContent=visibleModelCount();
}

function updateModelDrop(){
  // v0.4.0: filter by chatter assignments. Managers see all models.
  const c = window.currentChatter;
  let visible = models;
  if(c && c.role !== 'manager' && Array.isArray(c.assignments)){
    visible = models.filter(m => c.assignments.includes(m.name));
  }
  document.getElementById('ns_model').innerHTML=visible.map(m=>`<option value="${m.name}">${m.name}</option>`).join('');
}

// ── TRAINING SYNC ──────────────────────────────────────────────

// v0.4.1.4: DOCTRINE INTEGRITY CHECK
// Verifies that a candidate brain string contains required structural markers and
// meets a minimum length. Prevents accidental wipes (textbox cleared, partial paste,
// truncated upload, malicious row edit) from silently destroying the brain.
//
// Returns: {ok: true} | {ok: false, reason: string, missing: [markers], words: number}
//
// Required markers are deliberately spread across the brain so a partial copy that
// includes only the first half cannot pass. Length floor is 6000 words — well below
// the v0.4.1.3 brain (~10,500 words) but well above any reasonable summary that
// would still be useful as doctrine.
function checkDoctrineIntegrity(text){
  if(!text||typeof text!=='string') return {ok:false,reason:'empty or non-string',missing:[],words:0};
  const words=text.trim().split(/\s+/).length;
  const MIN_WORDS=6000;
  const REQUIRED_MARKERS=[
    'UNDERLYING FRAMEWORK',
    'IDENTIFYING CUSTOMERS',
    'CHAT SKELETON',
    'PROMISE RITUAL',
    'POSTURE SYSTEM',
    'OBJECTION HANDLING',
    'GOODBYE FRAMEWORK',
    'AFTERCARE',
    'TOS',
    'HARD RULES'
  ];
  const missing=REQUIRED_MARKERS.filter(m=>!text.includes(m));
  if(words<MIN_WORDS) return {ok:false,reason:`too short — ${words} words (min ${MIN_WORDS})`,missing,words};
  if(missing.length>0) return {ok:false,reason:`missing ${missing.length} required section markers`,missing,words};
  return {ok:true,words};
}

async function syncTraining(){
  try{
    const{data}=await sb.from('aich_models').select('prompt').eq('name','__global_training__').single();
    const supabaseBrain=data?.prompt;

    // v0.4.2.2: Two-source-of-truth resolution.
    // Code constant is primary. Supabase row is secondary (RLS-locked + backed up).
    // Decision matrix:
    //   code OK  + supabase OK     → use Supabase (latest canonical, may be ahead of code)
    //   code OK  + supabase missing → use code (Supabase not yet seeded)
    //   code OK  + supabase drifted → use code (Supabase corrupted, code is truth)
    //   code BAD + supabase OK     → use Supabase (CODE CORRUPTED — recovery mode)
    //   code BAD + supabase missing → REFUSE TO RUN (no trustworthy brain anywhere)
    //   code BAD + supabase drifted → REFUSE TO RUN (both corrupted)

    const tamper=await verifyBrainTamper(supabaseBrain);

    if(!tamper.codeMatch){
      // CODE CONSTANT CORRUPTED — the local DEFAULT_TRAINING doesn't match its declared SHA256.
      console.error('[brain-tamper] CODE INTEGRITY BROKEN:',tamper.reason);
      console.error('[brain-tamper] expected SHA256:',DEFAULT_TRAINING_SHA256,'computed:',tamper.codeHash);
      // Try Supabase as recovery fallback. We can't trust the SHA256 constant if code is
      // tampered, so we fall back to STRUCTURAL integrity check (word count + sections).
      if(supabaseBrain){
        const structural=checkDoctrineIntegrity(supabaseBrain);
        if(structural.ok){
          console.warn('[brain-tamper] Code is corrupted but Supabase row passes structural check — using Supabase as canonical.');
          toast('⚠️ Code DEFAULT_TRAINING corrupted. App is running on Supabase canonical. Restore code from git ASAP.','e',15000);
          globalTraining=supabaseBrain;
          localStorage.setItem('ss_training',supabaseBrain);
          window.__brainRecoveryMode=true; // flag so manager UI can surface this
          return;
        } else {
          console.error('[brain-tamper] Code corrupted AND Supabase row fails structural check — no trustworthy brain.');
          toast('🚨 BRAIN CORRUPTED in BOTH code and Supabase. SSAI generations disabled. Restore from git or aich_models_backups table.','e',60000);
          window.__brainCorrupted=true;
          return;
        }
      } else {
        console.error('[brain-tamper] Code corrupted AND Supabase has no row — no trustworthy brain.');
        toast('🚨 BRAIN CORRUPTED — code is bad and Supabase is empty. SSAI generations disabled. Restore from git.','e',60000);
        window.__brainCorrupted=true;
        return;
      }
    }

    // CODE IS GOOD past this point.
    if(!supabaseBrain){
      // No Supabase row — code is canonical, nothing to compare against
      return;
    }

    // v0.4.1.4: structural integrity gate on Supabase row
    const check=checkDoctrineIntegrity(supabaseBrain);
    if(!check.ok){
      console.warn('[doctrine] Supabase global training failed structural check:',check.reason,'— falling back to code DEFAULT_TRAINING');
      toast('Supabase doctrine corrupted — using code fallback. Re-save from Models settings or check aich_models_backups.','e');
      globalTraining=DEFAULT_TRAINING;
      localStorage.setItem('ss_training',DEFAULT_TRAINING);
      return;
    }

    if(!tamper.supabaseMatch){
      console.warn('[brain-tamper] Supabase row drifted from canonical SHA256 — using code constant instead.');
      console.warn('[brain-tamper] canonical:',DEFAULT_TRAINING_SHA256,'supabase:',tamper.supabaseHash);
      toast('Supabase brain row failed tamper check — using code-canonical version.','e',6000);
      globalTraining=DEFAULT_TRAINING;
      localStorage.setItem('ss_training',DEFAULT_TRAINING);
      return;
    }

    // Both code and Supabase agree — use Supabase (canonical)
    globalTraining=supabaseBrain;
    localStorage.setItem('ss_training',globalTraining);
  }catch(e){
    console.warn('[syncTraining] error:',e);
  }
}

// v0.4.1.4: STARTUP DOCTRINE CHECK
// Runs once on app load. Verifies the active brain (whatever globalTraining
// got initialized to from localStorage or DEFAULT_TRAINING) passes integrity.
// If it fails, force-recover from DEFAULT_TRAINING and surface a banner.
function startupDoctrineCheck(){
  const check=checkDoctrineIntegrity(globalTraining);
  if(!check.ok){
    console.warn('[doctrine] Active brain failed integrity check on startup:',check.reason);
    console.warn('[doctrine] Missing markers:',check.missing);
    // Force-recover from code constant
    globalTraining=DEFAULT_TRAINING;
    localStorage.setItem('ss_training',DEFAULT_TRAINING);
    // Surface a persistent warning so the user knows something happened
    setTimeout(()=>{
      toast(`Doctrine recovered from code (was ${check.words} words, expected 10000+). Check Models settings.`,'e');
    },1500);
  }
}
try{startupDoctrineCheck();}catch(e){console.warn('startup doctrine check error:',e);}

// v0.4.2.0: SHA256 check on localStorage brain at startup.
// Closes the 1-2 second window between page load and syncTraining()'s
// Supabase fetch. Catches: stale localStorage from a previous app version
// where DEFAULT_TRAINING has since been bumped; tampered localStorage on a
// machine someone else had access to. If hash mismatches, force-load the
// code-canonical brain immediately. This also makes brain updates push to
// users automatically — they don't have to clear cache when DEFAULT_TRAINING
// changes; the hash mismatch on next page load triggers a refresh.
async function startupBrainHashCheck(){
  try{
    const cached=localStorage.getItem('ss_training');
    if(!cached) return; // nothing to check, will fetch from Supabase or use DEFAULT
    const cachedHash=await computeBrainSha256(cached);
    const codeHash=await computeBrainSha256(DEFAULT_TRAINING);
    if(codeHash!==DEFAULT_TRAINING_SHA256){
      console.error('[brain-tamper] CODE INTEGRITY BROKEN at startup — DEFAULT_TRAINING constant does not match declared SHA256.');
      console.error('[brain-tamper] expected:',DEFAULT_TRAINING_SHA256,'computed:',codeHash);
      // Don't force anything — this is a developer-visible alert.
      return;
    }
    if(cachedHash!==DEFAULT_TRAINING_SHA256){
      console.warn('[brain-tamper] localStorage brain does not match canonical SHA256 — refreshing from code.');
      console.warn('[brain-tamper] canonical:',DEFAULT_TRAINING_SHA256,'localStorage:',cachedHash);
      globalTraining=DEFAULT_TRAINING;
      localStorage.setItem('ss_training',DEFAULT_TRAINING);
      setTimeout(()=>{
        toast('Brain auto-refreshed from latest code version.','i',5000);
      },1200);
    }
  }catch(e){
    console.warn('startup brain hash check error:',e);
  }
}
startupBrainHashCheck();

async function saveTraining(){
  const text=document.getElementById('globalTraining').value.trim();
  if(!text){toast('Cannot be empty','e');return;}
  // v0.4.1.4: integrity gate on save — refuse to write a broken brain
  const check=checkDoctrineIntegrity(text);
  if(!check.ok){
    const proceed=await confirmInPage(
      `⚠️ DOCTRINE INTEGRITY WARNING\n\n`+
      `What you're about to save fails the integrity check:\n`+
      `  • Reason: ${check.reason}\n`+
      `  • Word count: ${check.words}\n`+
      (check.missing.length?`  • Missing required sections: ${check.missing.join(', ')}\n`:'')+
      `\nThis will REPLACE the doctrine. Saving an incomplete brain will degrade SSAI behavior across all sessions.\n\n`+
      `Type SAVE ANYWAY to override and save the broken version.\n`+
      `Cancel to keep the current doctrine.`,
      'SAVE ANYWAY'
    );
    if(!proceed){toast('Save cancelled — doctrine unchanged','i');return;}
  }
  globalTraining=text;
  localStorage.setItem('ss_training',text);
  // v0.4.2.0: Supabase __global_training__ writes are now RLS-locked.
  // Authenticated session cannot upsert this row — only postgres/service_role
  // (i.e. dashboard SQL Editor or Edge Functions) can. Detect blocked write
  // and surface a clear message instead of silently failing.
  if(sb){
    try{
      const{data,error}=await sb.from('aich_models')
        .upsert({name:'__global_training__',tier:'system',prompt:text},{onConflict:'name'})
        .select('name');
      if(error){
        console.warn('[brain-save] Supabase write rejected:',error.message);
        toast('Saved locally. Supabase write blocked by RLS — to update canonical, edit DEFAULT_TRAINING in code or push via SQL Editor.','i',7000);
      } else if(!data||data.length===0){
        toast('Saved locally. Supabase write blocked by RLS — local-only change. Update DEFAULT_TRAINING in code for canonical.','i',7000);
      } else {
        toast(`Global training saved to Supabase (${check.ok?check.words:text.trim().split(/\s+/).length} words)`,'s');
      }
    }catch(e){
      console.warn('[brain-save] Supabase write error:',e);
      toast('Saved locally. Supabase write failed: '+e.message,'e');
    }
  } else {
    toast(`Global training saved locally (${check.ok?check.words:text.trim().split(/\s+/).length} words)`,'s');
  }
}

async function resetTraining(){
  // v0.4.1.4: typed-confirmation guard
  // Casual misclick can no longer wipe doctrine — user must type the exact phrase.
  const confirmed=await confirmInPage(
    `⚠️ RESET DOCTRINE TO CODE DEFAULT\n\n`+
    `This will replace the current global training (in textarea, localStorage, AND Supabase) with the DEFAULT_TRAINING constant from the app code.\n\n`+
    `If a custom doctrine is currently saved, it will be overwritten. Code default is the canonical brain shipped with this app version (v${SSAI_VERSION}).\n\n`+
    `Type RESET DOCTRINE to confirm.`,
    'RESET DOCTRINE'
  );
  if(!confirmed){toast('Reset cancelled','i');return;}
  globalTraining=DEFAULT_TRAINING;
  document.getElementById('globalTraining').value=DEFAULT_TRAINING;
  localStorage.setItem('ss_training',DEFAULT_TRAINING);
  // v0.4.2.0: Supabase write is RLS-locked. Attempt and report cleanly.
  if(sb){
    try{
      const{data,error}=await sb.from('aich_models')
        .upsert({name:'__global_training__',tier:'system',prompt:DEFAULT_TRAINING},{onConflict:'name'})
        .select('name');
      if(error){
        console.warn('[brain-reset] Supabase write rejected:',error.message);
        toast('Reset locally. Supabase row not changed (RLS write-lock). To reset canonical row, run UPDATE via SQL Editor.','i',7000);
      } else if(!data||data.length===0){
        toast('Reset locally. Supabase row not changed (RLS write-lock).','i',7000);
      } else {
        toast(`Reset to code default (${DEFAULT_TRAINING.trim().split(/\s+/).length} words) — synced to Supabase`,'s');
      }
    }catch(e){
      toast('Reset locally but Supabase sync failed: '+e.message,'e');
    }
  } else {
    toast('Reset to code default — no Supabase connection, local only','i');
  }
}

// ── PDF UPLOAD ─────────────────────────────────────────────────
async function handlePdfFile(input){
  const file=input.files[0];
  if(!file) return;
  await extractPdf(file);
}

async function handlePdfDrop(e){
  e.preventDefault();
  document.getElementById('pdfDrop').classList.remove('over');
  const file=e.dataTransfer.files[0];
  if(!file||!file.name.endsWith('.pdf')){toast('PDF files only','e');return;}
  await extractPdf(file);
}

async function extractPdf(file){
  const status=document.getElementById('pdfStatus');
  status.textContent='Reading PDF...';
  status.className='pdf-status';
  try{
    // Use PDF.js from CDN to extract text
    const script=document.createElement('script');
    script.src='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    document.head.appendChild(script);
    await new Promise(r=>script.onload=r);
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    const arrayBuffer=await file.arrayBuffer();
    const pdf=await window.pdfjsLib.getDocument({data:arrayBuffer}).promise;
    let fullText=`TRAINING DOCUMENT: ${file.name}\n\n`;
    for(let i=1;i<=pdf.numPages;i++){
      const page=await pdf.getPage(i);
      const content=await page.getTextContent();
      const pageText=content.items.map(item=>item.str).join(' ');
      fullText+=pageText+'\n';
    }
    document.getElementById('globalTraining').value=fullText;
    status.textContent=`✓ Extracted ${pdf.numPages} pages from ${file.name}`;
    status.className='pdf-status ok';
    toast(`PDF loaded — ${pdf.numPages} pages extracted`,'s');
  }catch(e){
    status.textContent='Error reading PDF: '+e.message;
    status.className='pdf-status err';
    toast('PDF error: '+e.message,'e');
  }
}

// ── SESSIONS ───────────────────────────────────────────────────
// Backfill helper: any PPV bubble that's already opened gets `_everOpened=true`
// so subsequent toggle clicks don't pollute the dashboard with duplicate ppv_landed events.
// Applied at every session load point (active load, archived load, reopen).
function backfillEverOpened(msgs){
  if(!Array.isArray(msgs)) return msgs;
  msgs.forEach(m=>{
    if(m&&m.sender==='ppv'&&m.opened===true&&!m._everOpened){
      m._everOpened=true;
    }
  });
  return msgs;
}

async function loadSessions(){
  // v0.4.1.0: chatter scoping. Managers see all sessions; chatters see only their own.
  // Defense-in-depth alongside (eventual) Supabase RLS.
  const cur=window.currentChatter;
  let q=sb.from('aich_sessions').select('*').eq('status','active').order('last_active_at',{ascending:false});
  if(cur && cur.role!=='manager' && cur.id){
    q=q.eq('chatter_id',cur.id);
  }
  const{data}=await q;
  // Bulk-fetch all VNs used across the agency so we can hydrate each session below.
  // Keyed on creator_model + customer_username so VNs persist across sessions per customer.
  let vnMap={};
  try{
    const{data:vnRows}=await sb.from('aich_vn_used').select('creator_model,customer_username,voice_note_label');
    if(vnRows) vnRows.forEach(r=>{
      const k=(r.creator_model||'')+'|'+(r.customer_username||'');
      if(!vnMap[k]) vnMap[k]=[];
      if(r.voice_note_label && !vnMap[k].includes(r.voice_note_label)) vnMap[k].push(r.voice_note_label);
    });
  }catch(e){console.warn('VN load failed:',e.message);}
  if(data) data.forEach(s=>{
    const msgs=backfillEverOpened(s.messages_input?JSON.parse(s.messages_input):[]);
    const vnKey=(s.creator_model||'')+'|'+(s.customer_username||'');
    sessions[s.id]={
      ...s,
      messages:msgs,
      draft:null,vn_used:vnMap[vnKey]||[],inputMode:'chat',
      // Posture system hydration — replaces old _rapportCount
      _freeMsgCount:s.free_msg_count||0,
      _unpaidCtaCount:s.unpaid_cta_count||0,
      _posture:s.current_posture||'WARM_BUILD',
      _customerTier:'new', // recomputed after profile loads
      _pendingCtaCheck:null,
      _sessionLength:msgs.filter(m=>m.sender==='model').length,
      // Wall-handling doctrine state (Pass B)
      _aftercareMode:s.aftercare_mode===true, // manual toggle, agent-controlled, default off
      _aftercareContext:s.aftercare_context||null, // 'aftersex' | 'ladder_stop' | null
      // Session boundary — when aftercare completes or goodbye runs, this flips.
      // computeWallState ignores msgs with ts before this; strategy prompt gets fresh-session context after.
      _sessionClosedAt:s.session_closed_at||null,
      _sessionClosedAtMsgCount:typeof s.session_closed_at_msg_count==='number'?s.session_closed_at_msg_count:null,
      // Pass C forcing-move state
      _storyFrameworkStep:parseInt(s.story_framework_step)||0, // 0-9, beats delivered so far
      _promiseStatus:s.promise_status||'not_started', // not_started | in_progress | verbally_committed | complete | reinforcement | assumed
      // Pass D ladder state — anti-drift, persisted plan-ahead
      _nextPlannedMove:s.ladder_state?.next_planned_move||null,
      _nextPlannedMoveAtMsg:s.ladder_state?.next_planned_at_msg||null
    };
  });
  renderSidebar();
  document.getElementById('sSess').textContent=Object.keys(sessions).length;
}

function renderSidebar(){
  const el=document.getElementById('sbBody');
  const source=sidebarMode==='archived'?archivedSessions:sessions;
  const ids=Object.keys(source).filter(id=>sidebarMode==='archived'?true:!source[id]._readonly);
  document.getElementById('sSess').textContent=Object.keys(sessions).filter(id=>!sessions[id]._readonly).length; // stat = true active count
  const q=(document.getElementById('sbSearch')?.value||'').toLowerCase();
  if(sidebarMode==='archived'&&!archivedLoaded){
    el.innerHTML='<div class="sb-empty">Loading archived…</div>';return;
  }
  if(!ids.length){
    el.innerHTML=sidebarMode==='archived'
      ?'<div class="sb-empty">No archived sessions.</div>'
      :'<div class="sb-empty">No sessions yet.<br>Click + New Session</div>';
    return;
  }
  const groups={};
  ids.forEach(id=>{
    const s=source[id];
    if(q&&!s.customer_name.toLowerCase().includes(q)&&!s.creator_model.toLowerCase().includes(q)) return;
    if(!groups[s.creator_model]) groups[s.creator_model]=[];
    groups[s.creator_model].push(id);
  });
  const order=models.map(m=>m.name).filter(n=>groups[n]);
  Object.keys(groups).forEach(g=>{if(!order.includes(g)) order.push(g);});
  if(!order.length){el.innerHTML='<div class="sb-empty">No results</div>';return;}
  const isArch=sidebarMode==='archived';
  el.innerHTML=order.map(model=>{
    const gids=groups[model];
    return`<div class="model-group">
      <div class="mg-head" onclick="toggleGroup('${model}')">
        <span class="mg-name">${model}</span>
        ${(models.find(m=>m.name===model)?.of_account_id)?`<button class="btn sm" title="Load this creator's OnlyFans chats into this group" onclick="event.stopPropagation();onOfLoadGroup('${model}')" style="font-size:10px;padding:1px 7px;margin-left:6px">Load chats</button>`:''}
        <span class="mg-count">${gids.length}</span>
      </div>
      <div class="mg-sessions${collapsed[model]?' closed':''}">
        ${gids.map(id=>{
          const s=source[id];
          const b=s.is_flagged?'r':s.draft?'g':'a';
          const bl=s.is_flagged?'Flag':s.draft?'Ready':'Pending';
          const card=`<div class="sc${activeId===id?' on':''}${s.is_flagged?' flagged':''}" onclick="${isArch?`openArchivedSession('${id}')`:`openSession('${id}')`}">
            <div class="sc-top"><span class="sc-name">${s.customer_name}</span>${s.of_chat_id?'<span class="badge of" title="From OnlyFans" style="background:rgba(27,110,194,.2);color:#5aa9ee">OF</span>':''}<span class="badge ${b}">${bl}</span></div>
            <div class="sc-prev">${s.draft||s.crm_notes||'No response yet'}</div>
          </div>`;
          if(isArch){
            return`<div class="sc-row">${card}<button class="sc-reopen" onclick="event.stopPropagation();reopenSession('${id}')" title="Reopen as active">Reopen</button><button class="sc-delete" onclick="event.stopPropagation();deleteArchivedSession('${id}')" title="Delete permanently">×</button></div>`;
          }
          return card;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

async function setSidebarMode(mode){
  if(sidebarMode===mode) return;
  sidebarMode=mode;
  document.getElementById('sbTabActive').classList.toggle('on',mode==='active');
  document.getElementById('sbTabArchived').classList.toggle('on',mode==='archived');
  if(mode==='archived'&&!archivedLoaded){
    renderSidebar(); // shows "Loading archived…"
    await loadArchivedSessions();
  }
  renderSidebar();
}

async function loadArchivedSessions(){
  if(!sb){archivedLoaded=true;return;}
  try{
    // v0.4.1.0: chatter scoping. Managers see all; chatters see only their own.
    const cur=window.currentChatter;
    let q=sb.from('aich_sessions').select('*').eq('status','archived').order('last_active_at',{ascending:false}).limit(200);
    if(cur && cur.role!=='manager' && cur.id){
      q=q.eq('chatter_id',cur.id);
    }
    const{data}=await q;
    archivedSessions={};
    if(data) data.forEach(s=>{
      const msgs=backfillEverOpened(s.messages_input?JSON.parse(s.messages_input):[]);
      archivedSessions[s.id]={...s,messages:msgs,draft:null,vn_used:[],inputMode:'chat'};
    });
    archivedLoaded=true;
  }catch(e){
    console.warn('Archived load failed:',e.message);
    archivedLoaded=true;
    toast('Failed to load archived sessions','e');
  }
}

function openArchivedSession(id){
  const s=archivedSessions[id];if(!s) return;
  // Hydrate into sessions map with _readonly flag so renderSession/renderBubbles work unchanged.
  sessions[id]={...s,_readonly:true};
  activeId=id;currentSender='customer';
  renderSidebar();
  document.getElementById('dashView').style.display='none';
  const sc=document.getElementById('sessContainer');
  sc.style.display='flex';sc.style.flex='1';sc.style.overflow='hidden';
  renderSession();
}

async function reopenSession(id){
  if(!sb){toast('No database connection','e');return;}
  const s=archivedSessions[id]||sessions[id];
  if(!s){toast('Session not found','e');return;}
  if(!await confirmInPage(`Reopen ${s.customer_name}? It will move back to Active sessions.`)) return;
  try{
    await sb.from('aich_sessions').update({status:'active',last_active_at:new Date().toISOString()}).eq('id',id);
    // Rehydrate VNs from aich_vn_used for this creator_model + customer_username
    let vns=[];
    try{
      const{data:vnRows}=await sb.from('aich_vn_used').select('voice_note_label').eq('creator_model',s.creator_model).eq('customer_username',s.customer_username);
      if(vnRows) vns=[...new Set(vnRows.map(r=>r.voice_note_label).filter(Boolean))];
    }catch(e){console.warn('VN load on reopen failed:',e.message);}
    // Rehydrate as full active session (mirrors loadSessions shape)
    const msgs=backfillEverOpened(s.messages_input?(typeof s.messages_input==='string'?JSON.parse(s.messages_input):s.messages_input):(s.messages||[]));
    sessions[id]={
      ...s,
      _readonly:false,
      status:'active',
      messages:msgs,
      draft:null,vn_used:vns,inputMode:'chat',
      _freeMsgCount:s.free_msg_count||0,
      _unpaidCtaCount:s.unpaid_cta_count||0,
      _posture:s.current_posture||'WARM_BUILD',
      _customerTier:'new',
      _pendingCtaCheck:null,
      _sessionLength:msgs.filter(m=>m.sender==='model').length,
      _aftercareMode:s.aftercare_mode===true,
      _aftercareContext:s.aftercare_context||null,
      _sessionClosedAt:s.session_closed_at||null,
      _sessionClosedAtMsgCount:typeof s.session_closed_at_msg_count==='number'?s.session_closed_at_msg_count:null,
      _storyFrameworkStep:parseInt(s.story_framework_step)||0,
      _promiseStatus:s.promise_status||'not_started',
      _nextPlannedMove:s.ladder_state?.next_planned_move||null,
      _nextPlannedMoveAtMsg:s.ladder_state?.next_planned_at_msg||null
    };
    delete archivedSessions[id];
    sidebarMode='active';
    document.getElementById('sbTabActive').classList.add('on');
    document.getElementById('sbTabArchived').classList.remove('on');
    renderSidebar();
    openSession(id);
    toast('Session reopened','s');
  }catch(e){
    console.error(e);
    toast('Reopen failed: '+e.message,'e');
  }
}

function toggleGroup(m){collapsed[m]=!collapsed[m];renderSidebar();}

async function deleteArchivedSession(id){
  if(!sb){toast('No database connection','e');return;}
  const s=archivedSessions[id]||sessions[id];
  if(!s){toast('Session not found','e');return;}
  // First confirm — describe what gets deleted
  const msgCount=(s.messages||[]).length||(s.messages_input?(typeof s.messages_input==='string'?JSON.parse(s.messages_input).length:s.messages_input.length):0);
  if(!await confirmInPage(`Delete archived session for ${s.customer_name} (${s.creator_model})?\n\n${msgCount} messages will be permanently deleted from the database.\n\nThis cannot be undone.`)) return;
  // Second confirm — type-to-confirm style, but using a yes/no for friction without typing
  if(!await confirmInPage(`Are you sure? This is permanent.\n\nDelete ${s.customer_name}'s archived session now?`)) return;
  try{
    // Delete events first (FK-safe ordering even though no FK is enforced)
    await sb.from('aich_events').delete().eq('session_id',id);
    // Then the session row itself
    const{error}=await sb.from('aich_sessions').delete().eq('id',id);
    if(error) throw error;
    // Remove from in-memory archived list and re-render
    delete archivedSessions[id];
    renderSidebar();
    loadDashMetrics();
    toast(`Deleted: ${s.customer_name}`,'s');
  }catch(e){
    console.error(e);
    toast('Delete failed: '+e.message,'e');
  }
}

function openSession(id){
  activeId=id;currentSender='customer';
  stopDashAutoRefresh();
  renderSidebar();
  document.getElementById('dashView').style.display='none';
  const sc=document.getElementById('sessContainer');
  sc.style.display='flex';sc.style.flex='1';sc.style.overflow='hidden';
  renderSession();
}

// ── GET / CREATE CUSTOMER PROFILE ─────────────────────────────
async function getOrCreateProfile(session){
  if(!sb||!session.customer_username) return null;
  try{
    const{data:existing}=await sb.from('customer_profiles')
      .select('*')
      .eq('creator_model',session.creator_model)
      .eq('customer_username',session.customer_username)
      .single();
    if(existing) return existing;
    // Create new profile
    const{data:created}=await sb.from('customer_profiles').insert({
      creator_model:session.creator_model,
      customer_username:session.customer_username,
      customer_name:session.customer_name,
      total_spend:parseFloat((session.total_spend||'0').toString().replace(/[$,]/g,''))||0,
      tips_spend:parseFloat((session.tips_spend||'0').toString().replace(/[$,]/g,''))||0,
      time_on_page:session.time_on_page,
      subscription_status:session.subscription_status,
      crm_notes:session.crm_notes,
      trust_level:1,
      archetype:'Unknown',
      temperature:'cold',
      key_details:'New customer — no history yet',
      last_seen_at:new Date().toISOString()
    }).select().single();
    return created;
  }catch(e){return null;}
}

async function updateProfile(session,analysis){
  if(!sb||!session.customer_username) return;
  try{
    const spend=parseFloat((session.total_spend||'0').toString().replace(/[$,]/g,''))||0;
    // v0.4.4.0: persist tips_spend back to the profile so LIFETIME tips accumulate across
    // sessions (previously only total_spend was written, so a returning tipper's tip history
    // silently vanished and never scaled him). Mirrors the total_spend write pattern.
    const tips=parseFloat((session.tips_spend||'0').toString().replace(/[$,]/g,''))||0;
    await sb.from('customer_profiles').upsert({
      creator_model:session.creator_model,
      customer_username:session.customer_username,
      customer_name:session.customer_name,
      total_spend:spend,
      tips_spend:tips,
      subscription_status:session.subscription_status,
      trust_level:analysis.trust_level||1,
      archetype:analysis.archetype||'Unknown',
      temperature:analysis.temperature||'cold',
      key_details:analysis.key_details||'',
      last_seen_at:new Date().toISOString()
    },{onConflict:'creator_model,customer_username'});
  }catch(e){}
}

// ── RENDER SESSION ─────────────────────────────────────────────
function renderSession(){
  const s=sessions[activeId];if(!s) return;
  const sc=document.getElementById('sessContainer');
  const ro=!!s._readonly;
  // Load profile in background — read-only path: read existing, DO NOT create/upsert
  if(!ro){
    getOrCreateProfile(s).then(profile=>{
      sessions[activeId]._profile=profile;
      recomputePosture(sessions[activeId]);
      updateProfileDisplay(profile);
      updatePostureChip();
      if(profile&&profile.trust_level>1&&s.messages.length>0){
        renderCoachFromProfile(profile);
      }
    });
  } else if(sb&&s.customer_username){
    // Read-only profile fetch (no insert, no upsert)
    sb.from('customer_profiles').select('*')
      .eq('creator_model',s.creator_model)
      .eq('customer_username',s.customer_username)
      .single().then(({data:profile})=>{
        if(profile){sessions[activeId]._profile=profile;updateProfileDisplay(profile);}
      }).catch(()=>{});
  }

  const roBanner=ro?`<div class="ro-banner">
    <div class="ro-dot"></div>
    <div>Archived — read-only</div>
    <div class="ro-spacer"></div>
    <button class="btn sm success" onclick="reopenSession('${activeId}')">↻ Reopen</button>
    <button class="btn sm" onclick="closeSession()">✕ Close</button>
  </div>`:'';

  sc.innerHTML=`${roBanner}<div class="sw" style="flex:1">
    <!-- LEFT -->
    <div class="cl">
      <div class="cl-head">
        <div class="cl-av">${s.customer_name.slice(0,2).toUpperCase()}</div>
        <div style="flex:1;min-width:0">
          <div class="cl-name">${s.customer_name}</div>
          <div class="cl-sub">@${s.customer_username||'—'} · ${s.creator_model}</div>
        </div>
        <button class="btn sm danger" onclick="closeSession()" style="display:${ro?'none':'inline-block'}">✕</button>
      </div>
      <div class="pb">
        <div class="pl">Profile</div>
        <div class="chips" id="profileChips">
          <span class="chip blue">${s.subscription_status||'subscribed'}</span>
          ${s.time_on_page?`<span class="chip" title="Time on page">${s.time_on_page}</span>`:''}
          <span class="chip green" id="spendChip" title="${ro?'Total spend (after OF fee)':'Total spend (after OF fee) · click to edit'}" ${ro?'':'onclick="openEditSpendModal(\'session\')" style="cursor:pointer"'}>$${parseFloat((s.total_spend||'0').toString().replace(/[$,]/g,''))||0} spent</span>
          ${parseFloat((s.tips_spend||'0').toString().replace(/[$,]/g,''))||0>0?`<span class="chip green" title="Tips only">$${parseFloat((s.tips_spend||'0').toString().replace(/[$,]/g,''))||0} tips</span>`:''}
          ${ro?'':(()=>{
            const p=s._posture||'WARM_BUILD';
            const cls=p==='TIMEWASTER'?'red':p==='PRESSURE'?'amber':p==='PROBE'?'amber':'';
            const spend=parseFloat((s.total_spend||'0').toString().replace(/[$,]/g,''))||0;
            return `<span class="chip ${cls}" id="postureChip" title="Posture · click to reset counters" onclick="resetPosture()" style="cursor:pointer">${p} · Free:${s._freeMsgCount||0} · UnpaidCTA:${s._unpaidCtaCount||0} · Tier:${(s._customerTier||'new').toUpperCase()} · $${spend}</span>`;
          })()}
          ${ro?'':(()=>{
            const on=s._aftercareMode===true;
            const ctx=s._aftercareContext||'ladder_stop';
            const cls=on?'green':'';
            const label=on?`AFTERCARE · ${ctx==='aftersex'?'AFTERSEX':'LADDER-STOP'}`:'AFTERCARE OFF';
            return `<span class="chip ${cls}" id="aftercareChip" title="Aftercare mode — click to toggle. When ON, SSAI stops pitching and runs Percival formula. Right-click to switch context (aftersex / ladder-stop)." onclick="toggleAftercareMode()" oncontextmenu="event.preventDefault();switchAftercareContext();return false;" style="cursor:pointer">${label}</span>`;
          })()}
          ${ro?'':(()=>{
            // v0.4.1.4 SEXTING MODE CHIP (PART 23 doctrine, feedback items #7, #34)
            // 3-state toggle: AUTO → FORCE_ON → FORCE_OFF → AUTO (click to cycle).
            // Shows current toggle state AND the derived sexting_active flag so the
            // agent can see at a glance whether the brain thinks sexting is happening.
            const toggle=s._sextingModeToggle||'AUTO';
            const active=!!s._sextingActive;
            let label, cls;
            if(toggle==='FORCE_ON'){ label='SEXTING · FORCE ON'; cls='red'; }
            else if(toggle==='FORCE_OFF'){ label='SEXTING · FORCE OFF'; cls=''; }
            else { // AUTO
              label=active?'SEXTING · AUTO ACTIVE':'SEXTING · AUTO';
              cls=active?'red':'';
            }
            return `<span class="chip ${cls}" id="sextingChip" title="Sexting mode toggle — click to cycle AUTO → FORCE ON → FORCE OFF. AUTO uses 2-gate detection (paid PPV + fantasy-building language). When active: posture freezes (no TW), beat counter splits, PPV pricing × 1.4." onclick="toggleSextingMode()" style="cursor:pointer">${label}</span>`;
          })()}
          ${ro?'':(()=>{
            // v0.4.4.0 TIP-PRIMARY CHIP (Finding #10). 3-state AUTO → FORCE ON → FORCE OFF.
            // Tip-primary customers monetize better via tips than PPVs — lead with relationship-
            // register tip asks (never a number), keep PPVs secondary.
            const toggle=s._tipModeToggle||'AUTO';
            const active=!!s._tipPrimary;
            let label, cls;
            if(toggle==='FORCE_ON'){ label='TIP-LED · FORCE ON'; cls='green'; }
            else if(toggle==='FORCE_OFF'){ label='TIP-LED · FORCE OFF'; cls=''; }
            else { label=active?'TIP-LED · AUTO ACTIVE':'TIP-LED · AUTO'; cls=active?'green':''; }
            return `<span class="chip ${cls}" id="tipModeChip" title="Tip-primary mode — click to cycle AUTO → FORCE ON → FORCE OFF. AUTO derives from archetype (Relationship/Emotional) + behavior (has tipped, PPV-resistant-but-warm, provider language). When active: brain LEADS with relationship-register tip asks (never a number — 'spoil me', 'show me more love'), PPVs go secondary." onclick="toggleTipMode()" style="cursor:pointer">${label}</span>`;
          })()}
          ${ro?'':(()=>{
            // v0.4.4.5 WHALE BUILDER CHIP — only renders for creators whose persona
            // opts in via the WHALE BUILDER: ON marker. 3-state AUTO → FORCE ON → FORCE OFF.
            if(typeof whaleBuilderMarkerOn!=='function'||!whaleBuilderMarkerOn(s)) return '';
            const toggle=s._whaleModeToggle||'AUTO';
            const wb=s._whaleBuilder||{state:'off'};
            let label,cls;
            if(toggle==='FORCE_OFF'){ label='WHALE · FORCE OFF'; cls=''; }
            else if(toggle==='FORCE_ON'){ label='WHALE · FORCE ON'; cls='blue'; }
            else if(wb.state==='done'){ label=wb.signal==='qualified_whale'?'WHALE ✓ QUALIFIED':'WHALE · NOT WHALE'; cls=wb.signal==='qualified_whale'?'green':''; }
            else if(wb.state==='active'){ label='WHALE · ARC ACTIVE'; cls='blue'; }
            else { label='WHALE · AUTO'; cls=''; }
            return `<span class="chip ${cls}" id="whaleChip" title="Whale Builder qualification arc (new USA subs — picked English at the welcome). AUTO activates on: persona marker + new sub ($0 lifetime) + English pick. Click to cycle AUTO → FORCE ON → FORCE OFF. Outcome: tips after the scripted test → QUALIFIED; interrogates / no tip → NOT WHALE." onclick="toggleWhaleMode()" style="cursor:pointer">${label}</span>`;
          })()}
          ${ro?'':(()=>{
            const step=s._storyFrameworkStep||0;
            if(step<=0 || step>=9) return '';
            return `<span class="chip blue" id="storyChip" title="Story framework in progress (Pass C P1)">STORY · ${step}/9</span>`;
          })()}
          ${ro?'':(()=>{
            // v0.4.4.2: buildup-only models have no promise — show a BUILDUP chip instead.
            const mdl=(typeof models!=='undefined')?models.find(m=>m.name===s.creator_model):null;
            const buildupOnly=s._promiseMode==='buildup_only'||(mdl&&/PROMISE[\s_]*MODE\s*[:=\-]\s*BUILDUP[\s_]*ONLY/i.test(mdl.prompt||''));
            if(buildupOnly) return `<span class="chip blue" id="promiseChip" title="This creator uses buildup before content — no promise ritual">BUILDUP MODE</span>`;
            const ps=s._promiseStatus||'not_started';
            const cls=(ps==='complete'||ps==='assumed')?'green':'amber';
            return `<span class="chip ${cls}" id="promiseChip" title="Promise ritual status (Pass C P2)">PROMISE · ${ps.toUpperCase()}</span>`;
          })()}
          ${ro?'':(()=>{
            const closed=!!s._sessionClosedAt;
            const cls=closed?'amber':'';
            const boundary=typeof s._sessionClosedAtMsgCount==='number'?s._sessionClosedAtMsgCount:'null';
            const totalMsgs=(s.messages||[]).length;
            const label=closed?'SESSION · CLOSED':'SESSION · OPEN';
            const tip=closed
              ?`Session CLOSED. Boundary at msg ${boundary} of ${totalMsgs}. Wall state sees only msgs after boundary. Click to reopen.`
              :`Session OPEN. All ${totalMsgs} msgs count in wall state. Click to close.`;
            return `<span class="chip ${cls}" id="sessionChip" title="${tip}" onclick="toggleSessionClosed()" style="cursor:pointer">${label}</span>`;
          })()}
          ${ro?'':(()=>{
            // Debug chip — shows the exact wall state numbers so we can see what's happening
            try {
              const w=computeWallState(s);
              const boundary=typeof s._sessionClosedAtMsgCount==='number'?s._sessionClosedAtMsgCount:'-';
              const total=(s.messages||[]).length;
              return `<span class="chip" style="font-size:9px;opacity:0.7" title="Debug: boundary=${boundary}, total msgs=${total}, wall sees ${w.ppvSentCount} PPV(s), ${w.ppvMissedCount} miss(es), miss-locked=${w.ppvMissedAfterChance}">DBG b:${boundary}/${total} ppv:${w.ppvSentCount} miss:${w.ppvMissedAfterChance?'Y':'N'}</span>`;
            } catch(e) { return ''; }
          })()}
          ${ro?'':(()=>{
            // PPV-missed lockout chip — read-only, auto-computed from messages
            try{
              const w=computeWallState(s);
              if(w.ppvSentCount===0) return '';
              if(w.ppvMissedAfterChance){
                return `<span class="chip red" id="ppvMissChip" title="PPV sent but unopened after customer moved on — standard PPVs locked out this session. Only never-done-before exclusive + tip-what-you-can allowed.">PPV MISS · LOCKED</span>`;
              }
              if(w.sessionPurchaseCount>0){
                return `<span class="chip green" title="Purchases this session">PPV ${w.sessionPurchaseCount} ✓</span>`;
              }
              return '';
            }catch(e){return '';}
          })()}
        </div>
      </div>
      <div class="pb" id="profileHistory" style="display:none">
        <div class="pl">Customer History <span style="font-size:9px;color:var(--text3);font-weight:400;text-transform:none;letter-spacing:0">(from profile)</span></div>
        <div id="historyChips" class="chips"></div>
        <div id="keyDetails" class="crm-txt" style="margin-top:5px"></div>
      </div>
      ${s.crm_notes?`<div class="pb"><div class="pl">CRM Notes</div><div class="crm-txt">${esc(s.crm_notes)}</div></div>`:''}
      ${(()=>{
        // v0.4.1.4: PPV STATS panel — separate from CRM notes (feedback item #10).
        // Surfaces lifetime + session PPV stats so AI pricing suggestions have clean context
        // and managers can read the customer's spending pattern at a glance.
        const msgs=s.messages||[];
        const profile=s._profile||{};
        const ppvBubbles=msgs.filter(m=>m.sender==='ppv');
        const sessionPpv=ppvBubbles.length;
        const sessionLanded=ppvBubbles.filter(m=>m.opened===true);
        const sessionLandedCount=sessionLanded.length;
        const sessionPrices=ppvBubbles.map(m=>typeof m.price==='number'?m.price:null).filter(p=>p!=null);
        const sessionGross=sessionLanded.reduce((sum,m)=>sum+(typeof m.price==='number'?m.price:0),0);
        const sessionAvg=sessionPrices.length?(sessionPrices.reduce((a,b)=>a+b,0)/sessionPrices.length):null;
        const sessionMax=sessionPrices.length?Math.max(...sessionPrices):null;
        const lifetimeSpend=parseFloat((profile.total_spend||s.total_spend||0).toString().replace(/[$,]/g,''))||0;
        const ppvRate=sessionPpv>0?Math.round(sessionLandedCount/sessionPpv*100):null;
        if(sessionPpv===0 && lifetimeSpend===0) return ''; // hide panel when nothing to show
        return `<div class="pb">
          <div class="pl">PPV Stats <span style="font-size:9px;color:var(--text3);font-weight:400;text-transform:none;letter-spacing:0">session · lifetime</span></div>
          <div class="crm-txt" style="font-size:11px;line-height:1.8">
            ${sessionPpv>0?`<div>Session PPVs: <b style="color:var(--text)">${sessionLandedCount}/${sessionPpv}</b>${ppvRate!=null?` <span style="color:var(--text3)">(${ppvRate}% open)</span>`:''}</div>`:''}
            ${sessionAvg!=null?`<div>Session avg price: <b style="color:var(--text)">$${sessionAvg.toFixed(0)}</b>${sessionMax!=null&&sessionMax!==sessionAvg?` · max <b>$${sessionMax}</b>`:''}</div>`:''}
            ${sessionGross>0?`<div>Session net unlocked: <b style="color:var(--green)">$${sessionGross.toFixed(0)}</b></div>`:''}
            ${lifetimeSpend>0?`<div>Lifetime spend: <b style="color:var(--green)">$${lifetimeSpend.toFixed(0)}</b></div>`:''}
          </div>
        </div>`;
      })()}
      ${ro?'':`<div class="pb">
        <div class="pl">PPV Sold <span style="font-size:9px;color:var(--text3);font-weight:400;text-transform:none;letter-spacing:0">auto -20% OF fee</span></div>
        <div class="ppv-row">
          <input class="ppv-in" id="ppvAmt" placeholder="$amount" type="text" onkeydown="if(event.key==='Enter')recordPpv()">
          <button class="btn sm success" onclick="recordPpv()">Record</button>
        </div>
      </div>
      <div class="pb">
        <div class="pl">Agent Note</div>
        <textarea class="pf" id="agentNote" placeholder="Session context...">${s.agent_note||''}</textarea>
      </div>
      <div class="pb">
        <div class="pl">Voice Notes Used</div>
        <div class="vn-wrap" id="vnWrap">${renderVns()}</div>
        <div class="vn-row">
          <input class="vn-in" id="vnIn" placeholder="vn_label..." onkeydown="if(event.key==='Enter')addVn()">
          <button class="btn sm" onclick="addVn()">Add</button>
        </div>
      </div>`}
    </div>

    <!-- MIDDLE -->
    <div class="cm">
      <div class="cm-head">
        <div class="bav c">${s.customer_name.slice(0,2).toUpperCase()}</div>
        <div>
          <div style="font-size:12px;font-weight:600">${s.customer_name}</div>
          <div style="font-size:10px;color:var(--text3)">${s.creator_model}</div>
        </div>
        <div style="flex:1"></div>
        ${ro?'<span style="font-size:10px;color:var(--text3);font-style:italic">archived · read-only</span>':`
        <button class="btn sm" onclick="clearMsgs()" style="color:var(--text3)">Clear</button>
        <button class="btn sm" onclick="toggleFlag()" id="flagBtn" style="color:${s.is_flagged?'var(--red)':'var(--text3)'}">${s.is_flagged?'Unflag':'Flag'}</button>
        <button class="btn sm ${s._customerTier==='flagged_tw'?'success':'danger'}" onclick="toggleTimewasterFlag()" id="twToggleBtn" title="${s._customerTier==='flagged_tw'?'Customer is currently flagged TW · click to unmark':'Mark as timewaster · future sessions start on tight thresholds'}">${s._customerTier==='flagged_tw'?'✅ Unmark TW':'🚩 Mark TW'}</button>
        `}
      </div>
      ${ro?'':`<div class="mode-tabs">
        <div class="mode-tab on" id="tab_chat" onclick="setMode('chat')">Chat Builder</div>
        <div class="mode-tab" id="tab_paste" onclick="setMode('paste')">Quick Paste</div>
        <div class="mode-tab" onclick="openOcrPicker()" title="Drop a chat screenshot — Claude vision will parse it into messages (feedback item #2)">📷 Import Screenshot</div>
        <input type="file" id="ocrFileInput" accept="image/*" style="display:none" onchange="handleOcrFile(event)">
      </div>`}
      <div id="chatView" style="flex:1;display:flex;flex-direction:column;overflow:hidden;min-height:0">
        <div class="chat-msgs" id="chatMsgs">${renderBubbles()}</div>
        ${ro?'':`<div class="chat-in-area">
          <div class="sender-bar" style="display:flex;align-items:center;justify-content:space-between;padding:7px 11px 3px">
            <div style="display:flex">
              <button class="s-btn sc" id="sBtnC" onclick="setSender('customer')">Customer</button>
              <button class="s-btn" id="sBtnM" onclick="setSender('model')">${s.creator_model}</button>
              <button class="s-btn" id="sBtnP" onclick="setSender('ppv')" title="Tag message as PPV sent — AI treats as content delivered">🔒 PPV</button>
            </div>
            <div style="display:flex;align-items:center;gap:5px">
              <span style="font-size:10px;color:var(--text3)">Time</span>
              <input type="time" id="msgTime" style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);padding:2px 6px;color:var(--text2);font-size:10px;font-family:var(--font);width:82px;cursor:pointer">
            </div>
          </div>
          <!-- v0.4.1.4: message-type tags (feedback items #1, #3, #4). Brain reads tags
               and adjusts strategy: VN-as-aftercare hits different vs text, Mass = generic
               distribution (no personalization assumptions), FreeMedia = pre-pitch warmup
               not a real CTA, Tip on customer msg = buying signal even without PPV. -->
          <div class="msg-tags-bar" id="msgTagsBar" style="display:flex;align-items:center;gap:6px;padding:0 11px 5px;flex-wrap:wrap;font-size:10px">
            <span id="outTagsGroup" style="display:none;gap:6px">
              <button type="button" class="tag-chip" id="tagVN" onclick="toggleMsgTag('vn')" title="Mark this outgoing as a Voice Note" style="background:var(--bg3);border:1px solid var(--border);color:var(--text2);padding:2px 8px;border-radius:var(--r);font-size:10px;cursor:pointer">VN</button>
              <button type="button" class="tag-chip" id="tagMass" onclick="toggleMsgTag('mass')" title="Mark this outgoing as a Mass Message (sent to many)" style="background:var(--bg3);border:1px solid var(--border);color:var(--text2);padding:2px 8px;border-radius:var(--r);font-size:10px;cursor:pointer">Mass</button>
              <button type="button" class="tag-chip" id="tagFreeMedia" onclick="toggleMsgTag('freeMedia')" title="Mark this outgoing as Free Media (no price tag)" style="background:var(--bg3);border:1px solid var(--border);color:var(--text2);padding:2px 8px;border-radius:var(--r);font-size:10px;cursor:pointer">Free Media</button>
            </span>
            <span id="inTagsGroup" style="display:flex;gap:6px;align-items:center">
              <button type="button" class="tag-chip" id="tagTip" onclick="toggleMsgTag('tip')" title="Mark this customer message as accompanied by a tip" style="background:var(--bg3);border:1px solid var(--border);color:var(--text2);padding:2px 8px;border-radius:var(--r);font-size:10px;cursor:pointer">Came with tip</button>
              <input type="number" id="tipAmt" placeholder="$amt" style="display:none;width:60px;background:var(--bg3);border:1px solid var(--border);color:var(--text2);padding:2px 6px;border-radius:var(--r);font-size:10px;font-family:var(--font)" min="1" step="1">
              <button type="button" class="tag-chip" id="tagCustMedia" onclick="toggleMsgTag('customerMedia')" title="Mark this customer message as accompanied by free media (photo/video he sent her)" style="background:var(--bg3);border:1px solid var(--border);color:var(--text2);padding:2px 8px;border-radius:var(--r);font-size:10px;cursor:pointer">Came with media</button>
            </span>
            <!-- v0.4.4.0 Finding #6: describe the media so SSAI knows WHAT was sent, not just THAT
                 media exists. Shows when Free Media or Came-with-media is active. Surfaced to the
                 brain as [FREE-MEDIA: <desc>] / [HE SENT: <desc>]. -->
            <input type="text" id="mediaDesc" placeholder="describe the pic/video so SSAI knows what was sent…" style="display:none;flex:1;min-width:160px;background:var(--bg3);border:1px solid var(--border);color:var(--text2);padding:2px 8px;border-radius:var(--r);font-size:10px;font-family:var(--font)">
          </div>
          <div class="chat-in-row">
            <textarea class="chat-ti" id="chatTi" placeholder="Type message, Enter to add..." rows="1"
              onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();addMsg()}"
              oninput="this.style.height='auto';this.style.height=Math.min(this.scrollHeight,80)+'px'"></textarea>
            <button class="btn-add" onclick="addMsg()">Add</button>
          </div>
        </div>`}
      </div>
      ${ro?'':`<div id="pasteView" style="display:none;flex:1;flex-direction:column;overflow:hidden;min-height:0">
        <div class="paste-mode">
          <div style="font-size:11px;color:var(--text3);line-height:1.7">Paste the last messages directly. Format: one message per line. Label each line with Customer: or [Model name]: — or just paste raw, the AI will understand from context.</div>
          <textarea class="paste-area" id="pasteInput" placeholder="Customer: hey how are you&#10;Cindy: heyy finally home from the clinic 😌 how was your day?&#10;Customer: pretty good wbu&#10;..."></textarea>
        </div>
      </div>
      <div class="ctx-area">
        <div class="ctx-l">Context <span class="ctx-opt">optional · clears after each generation</span></div>
        <textarea class="ctx-in" id="ctxIn" placeholder="e.g. customer ghosted — need re-engagement / he just tipped $50 / about to send a PPV need the promise ritual / coming back after 2 weeks cold..."></textarea>
      </div>
      <div class="gen-area">
        <button class="btn-gen" id="genBtn" onclick="generate()">Generate Response</button>
      </div>`}
    </div>

    <!-- RIGHT — COACH -->
    <div class="cr" id="coachPanel">
      <div class="cr-head" style="cursor:pointer" onclick="toggleCoach()">
        <div style="width:6px;height:6px;border-radius:50%;background:var(--purple);box-shadow:0 0 4px var(--purple)"></div>
        <div class="cr-title">AI Intelligence</div>
        <div style="flex:1"></div>
        <span style="font-size:10px;color:var(--text3)" id="coachApi">via ${api}</span>
        <button id="coachToggleBtn" style="background:none;border:none;color:var(--text3);cursor:pointer;font-size:16px;padding:0 0 0 8px;line-height:1" title="Collapse panel">≡</button>
      </div>
      <div id="coachContent">
        <div class="coach-body" id="coachBody">
          <div class="psych-empty"><div style="font-size:22px;opacity:0.15">◈</div><div>${ro?'Archived session<br>read-only':'Generate a response<br>to activate AI Intelligence'}</div></div>
        </div>
        ${ro?'':`<div class="qa-wrap">
          <div class="qa-msgs" id="qaMsgs"></div>
          <div class="qa-in-row">
            <input class="qa-in" id="qaIn" placeholder="Ask the AI coach..." onkeydown="if(event.key==='Enter')askCoach()">
            <button class="btn sm primary" onclick="askCoach()">Ask</button>
          </div>
        </div>`}
        <!-- DIAGNOSTIC PANEL — replaces console for ladder state + last strategy inspection -->
        <div class="diag-wrap" style="margin-top:10px;border-top:1px solid var(--border);padding-top:8px">
          <div style="display:flex;align-items:center;gap:6px;cursor:pointer;font-size:9px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:var(--text3);user-select:none" onclick="toggleDiag()">
            <span id="diagCaret">▶</span><span>Diagnostics</span>
            <div style="flex:1"></div>
            <span style="color:var(--text3);font-weight:400;text-transform:none;letter-spacing:0;font-size:10px" id="diagDriftBadge"></span>
          </div>
          <div id="diagBody" style="display:none;margin-top:8px;font-size:10px;font-family:var(--mono);color:var(--text2)">
            <div id="diagContent" style="background:var(--bg);border:1px solid var(--border);border-radius:var(--r);padding:8px;max-height:280px;overflow-y:auto;line-height:1.5"></div>
          </div>
        </div>
      </div>
    </div>
  </div>`;

  scrollChat();if(!ro) setSender('customer');
  // v0.3.0.37.2: intel-panel UI race fix. renderSession() above just clobbered
  // the coachBody with the empty "Generate a response..." placeholder. If we
  // already have an intel result computed (s._lastAnalysis), restore it now so
  // the panel doesn't flash back to empty state on every session re-render
  // (clear, message-add, ppv-tag, etc.).
  if(s._lastAnalysis){
    const cb=document.getElementById('coachBody');
    if(cb) renderAnalysis(s._lastAnalysis,cb,false);
  }
}

function updateProfileDisplay(profile){
  if(!profile) return;
  const histEl=document.getElementById('profileHistory');
  const chipsEl=document.getElementById('historyChips');
  const detailsEl=document.getElementById('keyDetails');
  if(!histEl) return;
  if(profile.trust_level>1||profile.archetype!=='Unknown'||profile.key_details){
    histEl.style.display='block';
    const tempColor=profile.temperature==='hot'?'red':profile.temperature==='warm'?'green':profile.temperature==='warming'?'amber':'';
    const memoryEntries=profile.key_details?(profile.key_details.split('[').length-1):0;
    chipsEl.innerHTML=`
      <span class="chip purple" title="Trust Level">L${profile.trust_level||1} Trust</span>
      ${profile.archetype&&profile.archetype!=='Unknown'?`<span class="chip" title="Customer archetype">${profile.archetype}</span>`:''}
      ${profile.temperature?`<span class="chip ${tempColor}" title="Temperature">${profile.temperature}</span>`:''}
      <span class="chip green" title="Lifetime spend across all sessions · click to edit" onclick="openEditSpendModal('lifetime')" style="cursor:pointer">$${profile.total_spend||0} lifetime</span>
      ${memoryEntries>0?`<span class="chip blue" title="Memory entries">${memoryEntries} session${memoryEntries>1?'s':''} remembered</span>`:'<span class="chip" style="color:var(--text3)">no memory yet</span>'}
    `;
    if(profile.key_details){
      detailsEl.innerHTML=`<div style="font-size:10px;color:var(--text3);margin-bottom:4px;font-weight:600">MEMORY LOG</div>${esc(profile.key_details)}`;
    }
  }
}

function renderCoachFromProfile(profile){
  const coachBody=document.getElementById('coachBody');
  if(!coachBody) return;
  // Build a data object matching analysis format
  const d={
    trust_level:profile.trust_level||1,
    trust_reason:profile.key_details?'Based on saved profile data':'New customer',
    archetype:profile.archetype||'Unknown',
    archetype_reason:'From previous sessions',
    temperature:profile.temperature||'cold',
    temperature_reason:'From previous sessions',
    phase:'rapport',
    phase_reason:'Opening phase — check conversation for current state',
    message_purpose:'Profile loaded — generate a response to get live analysis',
    next_move:profile.key_details||'Start conversation and gather intel',
    warning:null,
    key_details:profile.key_details||''
  };
  renderAnalysis(d,coachBody,true);
}

// ── MODE TOGGLE ────────────────────────────────────────────────
function setMode(m){
  document.getElementById('chatView').style.display=m==='chat'?'flex':'none';
  document.getElementById('pasteView').style.display=m==='paste'?'flex':'none';
  document.getElementById('tab_chat').className='mode-tab'+(m==='chat'?' on':'');
  document.getElementById('tab_paste').className='mode-tab'+(m==='paste'?' on':'');
  if(sessions[activeId]) sessions[activeId].inputMode=m;
}

// ── BUBBLES ────────────────────────────────────────────────────
function renderBubbles(){
  const s=sessions[activeId];
  const msgs=s.messages||[];
  let html='';
  if(!msgs.length) html='<div class="chat-empty">Add messages below<br>or use Quick Paste</div>';
  else html=msgs.map((m,i)=>{
    const isPpv=m.sender==='ppv';
    const isModelSide=m.sender==='model'||isPpv;
    const ppvOpened=isPpv&&m.opened===true;
    const ppvIcon=ppvOpened?'🔓':'🔒';
    const ppvPriceHtml=(isPpv&&typeof m.price==='number')?`<span class="ppv-price${ppvOpened?' opened':''}">$${m.price}</span>`:'';
    const ppvTagText=ppvOpened?'PPV PURCHASED':'PPV SENT';
    const ppvUnopenedTag=(isPpv&&!ppvOpened)?'<span class="ppv-unopened">UNOPENED</span>':'';
    // v0.4.4.0 Finding #6: render message tag chips IN the bubble so the agent can see
    // tags actually attached (previously invisible — tagging felt like a no-op / mock data).
    // Media chips show the description when present so it's visible at a glance.
    let tagChipsHtml='';
    if(m.tags){
      const chips=[];
      const chip=(txt,bg,fg)=>`<span style="display:inline-block;background:${bg};color:${fg};border-radius:3px;padding:1px 5px;font-size:9px;font-weight:600;letter-spacing:0.03em;margin:2px 3px 0 0">${txt}</span>`;
      if(m.tags.vn) chips.push(chip('🎙 VN','rgba(96,165,250,0.15)','var(--blue2)'));
      if(m.tags.mass) chips.push(chip('📢 MASS','rgba(160,160,160,0.15)','var(--text2)'));
      if(m.tags.freeMedia) chips.push(chip('📎 FREE MEDIA'+(m.tags.mediaDescription?': '+esc(m.tags.mediaDescription):''),'rgba(52,211,153,0.13)','var(--green)'));
      if(m.tags.customerMedia) chips.push(chip('📷 HE SENT'+(m.tags.mediaDescription?': '+esc(m.tags.mediaDescription):''),'rgba(52,211,153,0.13)','var(--green)'));
      if(m.tags.tip) chips.push(chip('💸 TIP'+(typeof m.tags.tipAmount==='number'?' $'+m.tags.tipAmount:''),'rgba(52,211,153,0.18)','var(--green)'));
      if(chips.length) tagChipsHtml=`<div style="margin-top:2px;text-align:${isModelSide?'right':'left'}">${chips.join('')}</div>`;
    }
    // Mark messages that came from / were sent through OnlyFans (have an of_message_id).
    const ofMark=m.of_message_id?`<div style="margin-top:2px;text-align:${isModelSide?'right':'left'}"><span title="From OnlyFans" style="display:inline-block;background:rgba(27,110,194,.18);color:#5aa9ee;border-radius:3px;padding:0 5px;font-size:9px;font-weight:700;letter-spacing:.04em">OF</span></div>`:'';
    return `
    <div class="brow ${m.sender}">
      ${m.sender==='customer'?`<div class="bav c">${sessions[activeId].customer_name.slice(0,2).toUpperCase()}</div>`:''}
      <div style="display:flex;flex-direction:column;align-items:${isModelSide?'flex-end':'flex-start'}">
        <div class="bbl${isPpv&&ppvOpened?' opened':''}"${isPpv?` onclick="togglePpvOpened(${i})"`:''} title="${isPpv?(ppvOpened?'Click to re-lock':'Click to mark as unlocked/purchased'):''}">
          <button class="bbl-x" onclick="event.stopPropagation();delMsg(${i})" title="Delete message">✕</button>
          ${isPpv?`<div class="ppv-tag${ppvOpened?' opened':''}">${ppvIcon} ${ppvTagText}${ppvPriceHtml}${ppvUnopenedTag}</div>`:''}${esc(m.text)}
        </div>
        ${tagChipsHtml}
        ${ofMark}
        ${m.ts?`<div class="bbl-ts">${m.ts}${isPpv&&!ppvOpened?' · <span style="color:#e6b84d;font-style:italic">click bubble when he unlocks</span>':''}</div>`:''}
      </div>
      ${isPpv?`<div class="bav p">${ppvIcon}</div><button class="copy-btn" onclick="event.stopPropagation();copyMsgByIndex(${i})" title="Copy">Copy</button>`:''}
      ${m.sender==='model'?`<div class="bav m">${sessions[activeId].creator_model.slice(0,2).toUpperCase()}</div><button class="copy-btn" onclick="event.stopPropagation();copyMsgByIndex(${i})" title="Copy">Copy</button>`:''}
    </div>`;
  }).join('');

  if(s.draft){
    const byLabel=s._draftBy==='mistral'?'<span style="color:var(--purple);font-weight:600">MISTRAL</span>':'<span style="color:var(--blue2);font-weight:600">CLAUDE</span>';
    const isPpvDraft=!!s._draftIsPpv;
    const labelText=isPpvDraft?`🔒 PPV Caption Draft · ${byLabel}`:`Draft Response · ${byLabel}`;
    const acceptText=isPpvDraft?'Accept → Set Price':'Accept → Send';
    html+=`<div class="draft-wrap${isPpvDraft?' ppv-draft':''}">
      <div class="draft-label"${isPpvDraft?' style="color:#e6b84d"':''}>${labelText}${s._draftRoute?` <span style="color:var(--text3);font-weight:400;text-transform:none;letter-spacing:0">· ${esc(s._draftRoute)}</span>`:''}</div>
      ${s._tosWarning&&s._tosWarning.length?`<div style="background:var(--red-bg);border:1px solid rgba(240,96,96,0.3);border-radius:4px;padding:5px 8px;margin-bottom:6px;font-size:10px;color:var(--red);font-weight:600">ToS WARNING: ${s._tosWarning.join(', ')} — do not send, regenerate</div>`:''}
      ${s._registerHitsFirstPass&&s._registerHitsFirstPass.length?`<div style="background:rgba(230,184,77,0.08);border:1px solid rgba(230,184,77,0.25);border-radius:4px;padding:4px 8px;margin-bottom:6px;font-size:10px;color:#e6b84d" title="First draft used store-voice — regenerated in relationship register">Register filter: rewrote to remove store-voice (${s._registerHitsFirstPass.slice(0,3).join(', ')}${s._registerHitsFirstPass.length>3?'…':''})</div>`:''}
      ${s._reasoningLeakStripped?`<div style="background:rgba(240,96,96,0.08);border:1px solid rgba(240,96,96,0.3);border-radius:4px;padding:4px 8px;margin-bottom:6px;font-size:10px;color:var(--red)" title="Generator emitted internal reasoning between drafts — auto-stripped">Reasoning-leak filter: stripped ${s._reasoningLeakStripped} self-talk block(s) from draft — review carefully before sending</div>`:''}
      ${s._reasoningLeakBlock?`<div style="background:rgba(240,96,96,0.15);border:1px solid rgba(240,96,96,0.5);border-radius:4px;padding:5px 8px;margin-bottom:6px;font-size:10px;color:var(--red);font-weight:600">⚠ Generator returned only reasoning, no usable draft — REGENERATE</div>`:''}
      ${s._ppvOverrodeBrain?`<div style="background:rgba(230,184,77,0.08);border:1px solid rgba(230,184,77,0.25);border-radius:4px;padding:4px 8px;margin-bottom:6px;font-size:10px;color:#e6b84d" title="You clicked PPV so a caption was generated. The brain's read was a different beat first.">PPV forced by you — brain wanted <b>${esc(s._ppvOverrodeBrain)}</b> first (e.g. a promise reinforcement beat). Caption generated anyway. Send only if he's ready to unlock.</div>`:''}
      <div class="draft-bbl${isPpvDraft?' ppv-draft-bbl':''}" style="${s._tosWarning&&s._tosWarning.length?'border:1px solid rgba(240,96,96,0.4)':''}">${esc(s.draft)}</div>
      <div class="draft-acts">
        <button class="btn sm danger" onclick="rejectDraft()">Reject</button>
        <button class="btn sm" onclick="showFb()" style="color:var(--text3)">Feedback</button>
        <button class="btn sm success" id="draftCopyBtn" onclick="copyDraft()">Copy</button>
        <button class="btn sm primary"${isPpvDraft?' style="background:#e6b84d;border-color:#e6b84d;color:#1a1200"':''} onclick="acceptDraft()">${acceptText}</button>
      </div>
      <div class="fb-area" id="fbArea">
        <textarea class="fb-input" id="fbText" placeholder="Why wasn't this good? This helps improve future responses for this model..."></textarea>
        <div style="display:flex;justify-content:flex-end;margin-top:4px">
          <button class="btn sm danger" onclick="submitFb()">Submit & Reject</button>
        </div>
      </div>
    </div>`;
  }
  return html;
}

function scrollChat(){setTimeout(()=>{const el=document.getElementById('chatMsgs');if(el) el.scrollTop=el.scrollHeight;},50);}

// v0.4.1.4: pending tags for the NEXT message to be added (feedback items #1, #3, #4).
// Reset after each addMsg. Brain reads these via fmtMsgForAI.
window._pendingMsgTags = window._pendingMsgTags || {vn:false, mass:false, freeMedia:false, tip:false, customerMedia:false};

function toggleMsgTag(tag){
  if(!window._pendingMsgTags.hasOwnProperty(tag)) return;
  window._pendingMsgTags[tag]=!window._pendingMsgTags[tag];
  // Visual feedback on the chip
  const chipId={vn:'tagVN',mass:'tagMass',freeMedia:'tagFreeMedia',tip:'tagTip',customerMedia:'tagCustMedia'}[tag];
  const chip=document.getElementById(chipId);
  if(chip){
    const on=window._pendingMsgTags[tag];
    chip.style.background=on?'var(--accent)':'var(--bg3)';
    chip.style.color=on?'#0a0a0a':'var(--text2)';
    chip.style.borderColor=on?'var(--accent)':'var(--border)';
  }
  // Tip amount input shown only when "Came with tip" is on
  if(tag==='tip'){
    const inp=document.getElementById('tipAmt');
    if(inp){
      inp.style.display=window._pendingMsgTags.tip?'inline-block':'none';
      if(window._pendingMsgTags.tip) setTimeout(()=>inp.focus(),50);
      else inp.value='';
    }
  }
  // v0.4.4.0 Finding #6: media description input shown when either media tag is on.
  if(tag==='freeMedia'||tag==='customerMedia'){
    const desc=document.getElementById('mediaDesc');
    if(desc){
      const anyMedia=window._pendingMsgTags.freeMedia||window._pendingMsgTags.customerMedia;
      desc.style.display=anyMedia?'inline-block':'none';
      if(anyMedia) setTimeout(()=>desc.focus(),50);
      else desc.value='';
    }
  }
}

function resetPendingMsgTags(){
  window._pendingMsgTags={vn:false, mass:false, freeMedia:false, tip:false, customerMedia:false};
  ['tagVN','tagMass','tagFreeMedia','tagTip','tagCustMedia'].forEach(id=>{
    const c=document.getElementById(id);
    if(c){c.style.background='var(--bg3)';c.style.color='var(--text2)';c.style.borderColor='var(--border)';}
  });
  const tipInp=document.getElementById('tipAmt');
  if(tipInp){tipInp.style.display='none';tipInp.value='';}
  const descInp=document.getElementById('mediaDesc');
  if(descInp){descInp.style.display='none';descInp.value='';}
}

function setSender(s){
  currentSender=s;
  const c=document.getElementById('sBtnC');const m=document.getElementById('sBtnM');const p=document.getElementById('sBtnP');
  if(!c||!m) return;
  c.className=s==='customer'?'s-btn sc':'s-btn';
  m.className=s==='model'?'s-btn sm':'s-btn';
  if(p) p.className=s==='ppv'?'s-btn sp':'s-btn';
  // Placeholder hint
  const ti=document.getElementById('chatTi');
  if(ti) ti.placeholder=s==='ppv'?'PPV caption/message that was sent with the content...':'Type message, Enter to add...';
  // v0.4.1.4: show/hide message-type tag groups based on sender (feedback items #1, #3, #4)
  const outGrp=document.getElementById('outTagsGroup');
  const inGrp=document.getElementById('inTagsGroup');
  if(outGrp) outGrp.style.display=(s==='model')?'inline-flex':'none';
  if(inGrp) inGrp.style.display=(s==='customer')?'inline-flex':'none';
  // PPV price suggestion — fires ONLY when user clicks the PPV sender button.
  // Skip if already loading, already computed for this session, or session is read-only.
  if(s==='ppv'){
    const sess=sessions[activeId];
    if(!sess||sess._readonly) return;
    const sug=sess._ppvSuggestion;
    if(sug&&(sug.loading||typeof sug.price==='number')) return; // already have one
    const model=models.find(mo=>mo.name===sess.creator_model);
    if(!model) return;
    const msgs=sess.messages||[];
    if(!msgs.length) return; // nothing to price against
    fetchPpvSuggestion(activeId,msgs,model,sess._profile||null);
  }
}

function addMsg(){
  const inp=document.getElementById('chatTi');
  const text=inp.value.trim();if(!text) return;
  // v0.3.0.36: null-guard. addMsg can fire from in-flight async after session
  // close/recreate, where activeId points to a session that no longer exists.
  if(!activeId||!sessions[activeId]){console.warn('[addMsg] no active session, ignoring');return;}
  sessions[activeId].messages=sessions[activeId].messages||[];
  // Use manual time if set, else current time
  const timeInp=document.getElementById('msgTime');
  let ts='';
  if(timeInp&&timeInp.value){
    // Convert 24h to 12h display
    const[h,m]=timeInp.value.split(':').map(Number);
    const ampm=h>=12?'PM':'AM';
    const h12=h%12||12;
    ts=`${h12}:${String(m).padStart(2,'0')} ${ampm}`;
  } else {
    const now=new Date();
    ts=now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  }
  // PPV → open price modal before committing the message
  if(currentSender==='ppv'){
    openPpvPriceModal(text,ts);
    return;
  }
  // v0.4.1.4: attach message-type tags (feedback items #1, #3, #4). Only the tags relevant
  // to the current sender direction apply (out tags on model msgs, in tags on customer msgs).
  const tagsObj={};
  // v0.4.4.0 Finding #6: media description so the brain knows WHAT was sent.
  const mediaDescVal=(document.getElementById('mediaDesc')?.value||'').trim();
  if(currentSender==='model'){
    if(window._pendingMsgTags?.vn) tagsObj.vn=true;
    if(window._pendingMsgTags?.mass) tagsObj.mass=true;
    if(window._pendingMsgTags?.freeMedia){
      tagsObj.freeMedia=true;
      if(mediaDescVal) tagsObj.mediaDescription=mediaDescVal;
    }
  } else if(currentSender==='customer'){
    if(window._pendingMsgTags?.tip){
      tagsObj.tip=true;
      const tipAmt=parseFloat((document.getElementById('tipAmt')?.value||'').replace(/[$,]/g,''));
      if(tipAmt>0) tagsObj.tipAmount=tipAmt;
    }
    if(window._pendingMsgTags?.customerMedia){
      tagsObj.customerMedia=true;
      if(mediaDescVal) tagsObj.mediaDescription=mediaDescVal;
    }
  }
  const msgObj={sender:currentSender,text,ts,ts_iso:new Date().toISOString()};
  if(Object.keys(tagsObj).length>0) msgObj.tags=tagsObj;
  sessions[activeId].messages.push(msgObj);
  // Reset pending tags after the message is added
  if(typeof resetPendingMsgTags==='function') resetPendingMsgTags();
  // If customer message had a tip tag with amount, record the tip spend automatically
  if(currentSender==='customer' && tagsObj.tip && tagsObj.tipAmount>0){
    const s=sessions[activeId];
    const currentTips=parseFloat((s.tips_spend||'0').toString().replace(/[$,]/g,''))||0;
    s.tips_spend=currentTips+tagsObj.tipAmount;
    // Tip is a paid action — reset posture counters (mirrors recordPpv logic)
    s._freeMsgCount=0;
    s._unpaidCtaCount=0;
    s._pendingCtaCheck=null;
    recomputePosture(s);
    if(sb){
      sb.from('aich_events').insert({
        session_id:activeId,creator_model:s.creator_model,customer_username:s.customer_username,
        event_type:'tip_recorded',payload:{amount:tagsObj.tipAmount,new_total_tips:s.tips_spend}
      }).then(()=>{}).catch(e=>console.warn('tip event log failed:',e.message));
    }
    toast(`Tip recorded: $${tagsObj.tipAmount}`,'s');
  }
  // Unpaid CTA tracking — fires only when a customer reply lands.
  // ASSUMES manual message-add flow. If automated CRM ingest is added later, gate this counter behind a _sessionStarted flag that flips true only after initial historical messages load.
  if(currentSender==='customer'){
    const s=sessions[activeId];
    if(s._pendingCtaCheck){
      s._pendingCtaCheck.customerRepliesSince++;
      if(s._pendingCtaCheck.customerRepliesSince>=2){
        s._unpaidCtaCount=(s._unpaidCtaCount||0)+1;
        s._pendingCtaCheck=null;
        if(sb) sb.from('aich_sessions').update({unpaid_cta_count:s._unpaidCtaCount}).eq('id',activeId).then(()=>{});
      }
    }
    recomputePosture(s);
    updatePostureChip();
  }
  inp.value='';inp.style.height='auto';
  document.getElementById('chatMsgs').innerHTML=renderBubbles();
  // Profile chips (PPV MISS, posture, session state) depend on messages — re-render them.
  // Cheapest way is to re-run renderSession; it re-renders chat bubbles too but that's fine.
  renderSession();
  scrollChat();
  // Persist — critical fix: manual adds were never saved, causing data loss on refresh
  if(sb) sb.from('aich_sessions').update({
    messages_input:JSON.stringify(sessions[activeId].messages),
    last_active_at:new Date().toISOString()
  }).eq('id',activeId).then(()=>{});
  // Customer ↔ Model cycles normally
  setSender(currentSender==='customer'?'model':'customer');
}

async function delMsg(i){
  const msgs=sessions[activeId]?.messages;if(!msgs||!msgs[i]) return;
  const snippet=(msgs[i].text||'').slice(0,60).trim();
  const preview=snippet.length>=60?snippet+'…':snippet;
  if(!await confirmInPage(`Delete this message?\n\n"${preview}"`)) return;
  msgs.splice(i,1);
  document.getElementById('chatMsgs').innerHTML=renderBubbles();
  // Re-render profile chips — deleting a PPV msg changes wall state
  renderSession();
  // Persist — same bug as addMsg, deletion wasn't being saved
  if(sb) sb.from('aich_sessions').update({
    messages_input:JSON.stringify(msgs)
  }).eq('id',activeId).then(()=>{});
}

async function clearMsgs(){
  if(!await confirmInPage('Clear all messages?')) return;
  sessions[activeId].messages=[];sessions[activeId].draft=null;
  // Pass C: clearing messages wipes the conversation context — reset forcing-move state
  sessions[activeId]._storyFrameworkStep=0;
  sessions[activeId]._promiseStatus='not_started';
  if(sb) sb.from('aich_sessions').update({
    messages_input:'[]',
    story_framework_step:0,
    promise_status:'not_started'
  }).eq('id',activeId).then(()=>{});
  document.getElementById('chatMsgs').innerHTML=renderBubbles();
  renderSidebar();
}

// ── DRAFT ACTIONS ──────────────────────────────────────────────
function showFb(){
  const a=document.getElementById('fbArea');if(a) a.style.display='block';
}

async function submitFb(){
  const text=document.getElementById('fbText')?.value.trim();
  if(!text){toast('Add feedback first','e');return;}
  const s=sessions[activeId];
  const rejectedDraft=s.draft||'';

  // Store in session for immediate next-generation use
  s._sessionFeedback=s._sessionFeedback||[];
  s._sessionFeedback.push({feedback:text,rejectedMsg:rejectedDraft,ts:new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})});

  if(sb){
    try{
      await sb.from('aich_messages').insert({
        session_id:activeId,
        creator_model:s.creator_model,
        customer_username:s.customer_username,
        input_messages:JSON.stringify(s.messages),
        agent_note:'REJECTED: '+text,
        response_text:rejectedDraft,
        api_used:api,
        was_sent:false,
        feedback_text:text
      });
    }catch(e){}
  }

  s.draft=null;
  s._draftIsPpv=false;
  toast('Feedback saved — will adjust next response','i');
  document.getElementById('chatMsgs').innerHTML=renderBubbles();
  renderSidebar();

  // Check if we have enough rejections to synthesize model rules (Option B)
  await checkAndSynthesizeFeedback(s.creator_model);
}

function acceptDraft(){
  const s=sessions[activeId];if(!s.draft) return;
  // PPV draft → route through price modal instead of pushing as model message
  if(s._draftIsPpv){
    const caption=s.draft;
    const ts=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    // Clear draft state before opening modal (modal commits the message itself)
    s.draft=null;s._draftIsPpv=false;
    document.getElementById('chatMsgs').innerHTML=renderBubbles();
    openPpvPriceModal(caption,ts);
    return;
  }
  // v0.4.1.5: persist strategy phase on the message so per-rung pitch counter
  // and goodbye phase counter can read it (engineering loop guards depend on this).
  // Phase is the strategy.phase field from the last strategy call — null if missing.
  const persistedPhase=s._lastStrategy?.phase||null;
  // v0.4.1.5: also persist skeleton_step so the promise-refusal TW posture rule
  // can count how many Promise Ritual asks have been accepted since the last
  // PPV opened (see computePosture promise-refusal guard).
  const persistedSkeleton=s._lastStrategy?.skeleton_step||null;
  // v0.4.1.4: capture accepted text BEFORE clearing s.draft so we can log it to aich_messages.
  // Leaderboard accept_rate / drafts count both read aich_messages, so an accept must insert
  // a row with was_sent=true. Previously only rejects inserted, which produced 0% accept /
  // 100% reject on the leaderboard even when PPVs were landing (feedback item #21, #22).
  const acceptedDraft=s.draft;
  s.messages.push({sender:'model',text:s.draft,ts_iso:new Date().toISOString(),phase:persistedPhase,skeleton_step:persistedSkeleton});
  s.response=s.draft;s.draft=null;
  // v0.4.4.4 COST: intel extraction runs on ACCEPT (once per shipped message), not on every
  // generate. Old site in generate() fired on every regeneration too — re-paying ~$0.005-0.008
  // to re-extract intel from identical customer history. Customer facts don't change between
  // a rejected draft and its regen; they change when the conversation actually advances.
  {
    const intelSessionId=activeId;
    setTimeout(()=>{try{
      const sNow=sessions[intelSessionId];
      if(sNow&&typeof extractCustomerIntel==='function') extractCustomerIntel(intelSessionId,sNow.messages||[],sNow.creator_model);
    }catch(e){console.warn('intel on accept failed:',e.message);}},2500);
  }
  // Posture: increment free msg count (resets only on paid action).
  // v0.4.1.4: when sexting_active, free_chat_beats FREEZES (PART 23 BEAT COUNTING).
  // Sexting beats accumulate on a separate counter (sexting_beats_since_last_ppv) so
  // mid-scene replies don't drift the brain toward TW. Free counter resumes when
  // sexting exits.
  const lastPhase=s._lastStrategy?.phase||'';
  const ctaPhases=['link','sell','cta1','cta2','close'];
  const isCtaPhase=ctaPhases.includes(lastPhase);
  // v0.4.1.5: WHALE DILATION — when investment signals are healthy AND he's still
  // actively writing long-form replies, freeze the free-chat clock for this beat.
  // Mirrors PART 23 sexting freeze. Prevents posture decay during the high-engagement
  // window where pitching too soon wastes a building whale (feedback Rami 2026-05-12).
  // Only the rapport-side clock is frozen; once he drops to short replies OR enters
  // CTA phases, the counter resumes ticking naturally.
  let whaleDilation=false;
  let rlsProtection=false;
  if(!isCtaPhase){
    try{
      const customerMsgsAll=(s.messages||[]).filter(m=>m.sender==='customer'&&m.text);
      const last2Cust=customerMsgsAll.slice(-2);
      const longForm=last2Cust.length===2&&last2Cust.every(m=>(m.text||'').length>=40);
      const inv=detectInvestmentSignals(s);
      whaleDilation=inv.count>=3&&longForm;
      // v0.4.4.0 Finding #8: RLS / EARLY-RAPPORT PROTECTION. A new sub running the RLS arc
      // (work → age → free-pic link → promise → sale) answers in SHORT messages, so whale
      // dilation (which needs 40+ char long-form) never fires for him — and the free-msg clock
      // climbs him to PRESSURE mid-arc, truncating RLS and forcing a premature pitch. The user:
      // "running the RLS shouldn't be truncated by beat counts." Protect the arc: pre-first-PPV
      // + new sub + actively engaging (>=2 investment signals, he's playing along), bounded to
      // the first 12 AI messages (the RLS window). The investment-ZERO override (msg>=20, zero
      // investment) still catches real timewasters; this only shields an engaged new sub.
      const noPpvYet=!(s.messages||[]).some(m=>m.sender==='ppv');
      const newSub=(s._customerTier||'new')==='new';
      const aiMsgCount=(s.messages||[]).filter(m=>m.sender==='model').length;
      rlsProtection=noPpvYet && newSub && inv.count>=2 && aiMsgCount<=12;
    }catch(e){ whaleDilation=false; rlsProtection=false; }
  }
  // v0.4.4.5: WHALE BUILDER ARC FREEZE — while the qualification arc is running,
  // the free-chat clock is frozen (mirrors RLS protection: the arc must not be
  // truncated into a premature pitch by beat-counting). Resumes once the outcome lands.
  const wbArcActive=!!s._whaleBuilderActive&&!s._whaleBuilderOutcome;
  if(s._sextingActive){
    s._sextingBeatsSinceLastPpv=(s._sextingBeatsSinceLastPpv||0)+1;
    s._whaleDilationLastTurn=false;
  } else if(whaleDilation || rlsProtection || wbArcActive){
    // Free-chat clock frozen this beat — building engagement (whale) or RLS arc in progress.
    s._whaleDilationLastTurn=whaleDilation;
    s._rlsProtectionLastTurn=rlsProtection;
  } else {
    s._freeMsgCount=(s._freeMsgCount||0)+1;
    s._whaleDilationLastTurn=false;
    s._rlsProtectionLastTurn=false;
  }
  s._sessionLength=(s._sessionLength||0)+1;
  // If this was a CTA, start tracking whether it gets paid in next 2 customer replies
  if(isCtaPhase&&!s._pendingCtaCheck){
    s._pendingCtaCheck={customerRepliesSince:0};
  }
  recomputePosture(s);
  // v0.4.1.5: apply forcing-move advances captured by generate() but deferred until
  // accept. On reject these are discarded so beat/promise/goodbye state never moves
  // forward for drafts that didn't ship.
  const pendingAdv=s._pendingPassCAdvance;
  if(pendingAdv){
    const ssUpdate={};
    if(typeof pendingAdv.storyFrameworkStep==='number'){
      s._storyFrameworkStep=pendingAdv.storyFrameworkStep;
      ssUpdate.story_framework_step=pendingAdv.storyFrameworkStep;
    }
    if(pendingAdv.promiseStatus){
      s._promiseStatus=pendingAdv.promiseStatus;
      ssUpdate.promise_status=pendingAdv.promiseStatus;
    }
    if(pendingAdv.sessionClosedAt){
      s._sessionClosedAt=pendingAdv.sessionClosedAt;
      s._sessionClosedAtMsgCount=pendingAdv.sessionClosedAtMsgCount;
      ssUpdate.session_closed_at=pendingAdv.sessionClosedAt;
      ssUpdate.session_closed_at_msg_count=pendingAdv.sessionClosedAtMsgCount;
    }
    if(pendingAdv.nextPlannedMove){
      s._nextPlannedMove=pendingAdv.nextPlannedMove;
      s._nextPlannedMoveAtMsg=pendingAdv.nextPlannedMoveAtMsg;
    }
    if(pendingAdv.ladderState && typeof persistLadderState==='function'){
      try{persistLadderState(activeId,pendingAdv.ladderState,pendingAdv.ladderStatePlannedMove);}
      catch(e){console.warn('ladder persist on accept failed:',e.message);}
    }
    if(sb && Object.keys(ssUpdate).length){
      sb.from('aich_sessions').update(ssUpdate).eq('id',activeId).then(()=>{});
    }
    s._pendingPassCAdvance=null;
  }
  document.getElementById('chatMsgs').innerHTML=renderBubbles();
  scrollChat();renderSidebar();
  updatePostureChip();
  if(sb){
    sb.from('aich_sessions').update({
      messages_input:JSON.stringify(s.messages),
      last_active_at:new Date().toISOString(),
      free_msg_count:s._freeMsgCount,
      unpaid_cta_count:s._unpaidCtaCount||0,
      current_posture:s._posture||'WARM_BUILD'
    }).eq('id',activeId).then(()=>{});
    // v0.4.1.4: log accepted draft to aich_messages so leaderboard math is correct
    // v0.4.4.8: capture inserted row id so OF write-back targets the exact row
    sb.from('aich_messages').insert({
      session_id:activeId,
      creator_model:s.creator_model,
      customer_username:s.customer_username,
      input_messages:JSON.stringify(s.messages),
      sender:'model',
      agent_note:'ACCEPTED',
      response_text:acceptedDraft,
      api_used:api,
      was_sent:true
    }).select('id').single()
      .then(({data,error})=>{
        if(error) console.warn('accepted msg log failed:',error.message);
        maybeSendToOnlyFans(s, acceptedDraft, data&&!error?data.id:null);
      })
      .catch(e=>console.warn('accept insert failed:',e.message));
  } else {
    // No sb — rowId will be null; maybeSendToOnlyFans guards on rowId and will
    // toast the chatter to send manually rather than firing an untrackable send.
    maybeSendToOnlyFans(s, acceptedDraft, null);
  }
  toast('Accepted','s');
}

// Auto-send an accepted TEXT reply to OnlyFans. No-op unless the creator is
// connected and the session has of_chat_id. Final ToS gate runs here.
async function maybeSendToOnlyFans(s, acceptedText, rowId){
  try{
    const model=models.find(m=>m.name===s.creator_model);
    if(!ofShouldAutoSend(s,model||{})) return;
    if(!ofIsAuthorized(window.currentChatter,s.creator_model)) return;
    // Final safety gate on the exact approved bytes — one banned term = ban.
    if(!acceptedText||!acceptedText.trim()){return;}
    const banned=(typeof scanForBanned==='function')?scanForBanned(acceptedText):{hit:false};
    if(banned&&banned.hit){toast('Auto-send blocked: banned term in message — send manually after editing','e');return;}
    const res=await ofSend(model.of_account_id,s.of_chat_id,acceptedText);
    const ofId=res&&res.data&&res.data.id!=null?String(res.data.id):null;
    // Record the OF message id so the messages.sent echo + future syncs dedupe.
    // Prefer tagging the accepted row (rowId); if it's missing (insert/select hiccup),
    // insert a minimal dedup row instead — sending must not be blocked, and dedup must
    // still hold (unique of_message_id blocks any re-import).
    if(sb&&ofId){
      if(rowId){
        const{error}=await sb.from('aich_messages').update({of_message_id:ofId,send_state:'sent'}).eq('id',rowId);
        if(error) console.warn('[of] write-back update failed:',error.message);
      }else{
        const{error}=await sb.from('aich_messages').insert({
          session_id:s.id,creator_model:s.creator_model,customer_username:s.customer_username,
          sender:'model',text:acceptedText,of_message_id:ofId,
          created_at:new Date().toISOString(),send_state:'sent'
        });
        if(error) console.warn('[of] dedup-row insert failed:',error.message);
      }
    }
    toast('Sent to OnlyFans','s');
  }catch(e){
    if(sb&&rowId){
      await sb.from('aich_messages').update({send_state:'send_failed'}).eq('id',rowId);
    }
    toast('OnlyFans send failed — send manually. ('+e.message+')','e');
  }
}

function rejectDraft(){
  sessions[activeId].draft=null;
  sessions[activeId]._draftIsPpv=false;
  // v0.4.1.5: discard deferred forcing-move advances. Next generate() re-enters
  // the same state — rejected drafts must not push beat/promise/goodbye forward.
  sessions[activeId]._pendingPassCAdvance=null;
  document.getElementById('chatMsgs').innerHTML=renderBubbles();
  renderSidebar();
}

function resetPosture(){
  const s=sessions[activeId];if(!s) return;
  s._freeMsgCount=0;
  s._unpaidCtaCount=0;
  s._pendingCtaCheck=null;
  // Pass C: posture reset is a fresh-slate action — reset story framework step too.
  // Promise status is NOT reset here — it's tied to PPV shipments, not message counters.
  s._storyFrameworkStep=0;
  recomputePosture(s);
  if(sb) sb.from('aich_sessions').update({
    free_msg_count:0,
    unpaid_cta_count:0,
    current_posture:s._posture||'WARM_BUILD',
    story_framework_step:0
  }).eq('id',activeId).then(()=>{});
  renderSession();
  toast('Posture counters reset','i');
}

// ── SEXTING MODE (PART 23 doctrine — v0.4.1.4) ──────────────────
// 3-state toggle: AUTO (default — brain auto-detects via two-gate) | FORCE_ON | FORCE_OFF.
// Agent toggle overrides brain detection. PART 23 doctrine explains the semantics; the
// detector function below implements the two-gate auto path.
//
// State is in-memory only for now (no aich_sessions column added in this branch — dev
// can add `sexting_mode_toggle` text column later for cross-reload persistence). The
// detector recomputes on every recomputePosture call, so AUTO mode is always live.
function toggleSextingMode(){
  const s=sessions[activeId]; if(!s) return;
  const cur=s._sextingModeToggle||'AUTO';
  const next={'AUTO':'FORCE_ON','FORCE_ON':'FORCE_OFF','FORCE_OFF':'AUTO'}[cur];
  s._sextingModeToggle=next;
  recomputePosture(s);
  renderSession();
  toast(`Sexting mode: ${next.replace('_',' ')}`,'i');
  if(sb){
    sb.from('aich_events').insert({
      session_id:activeId,
      creator_model:s.creator_model,
      customer_username:s.customer_username,
      event_type:'sexting_mode_toggled',
      payload:{toggled_to:next,sexting_active:!!s._sextingActive,prior:cur}
    }).then(()=>{}).catch(e=>console.warn('event log failed:',e.message));
  }
}

// Two-gate detector for AUTO mode. Returns boolean.
// Gate 1: customer has paid ≥1 PPV (session or lifetime) — separates sexting from
//         vending-machine-attempt (zero-spend sexual demand).
// Gate 2: fantasy-building / explicit-scenario language in recent customer msgs —
//         separates sexting from horny rapport (hot compliments without scene-building).
function detectSextingActive(s){
  if(!s) return false;
  const toggle=s._sextingModeToggle||'AUTO';
  if(toggle==='FORCE_OFF') return false;
  if(toggle==='FORCE_ON') return true;
  // AUTO: two-gate check
  const sessionPaidPpv=(s.messages||[]).some(m=>m.sender==='ppv'&&m.opened===true);
  const lifetimeSpend=parseFloat((s._profile?.total_spend||s.total_spend||0).toString().replace(/[$,]/g,''))||0;
  const gate1=sessionPaidPpv || lifetimeSpend>0;
  if(!gate1) return false;
  // Gate 2: scan last 3 customer messages for fantasy-building patterns
  const customerMsgs=(s.messages||[]).filter(m=>m.sender==='customer'&&m.text);
  if(customerMsgs.length===0) return false;
  const recent=customerMsgs.slice(-3).map(m=>(m.text||'').toLowerCase()).join(' ');
  // Also: dick pic / nude image sent counts as gate 2 hit. The user's CRM workflow surfaces
  // this via a "[image sent]" pattern in the customer text; check for that too.
  if(/\[(image|nude|dick|photo|pic) sent\]/i.test(recent)) return true;
  // v0.4.3.2: bilingual patterns (English + Spanish). Initial v0.4.3.2 release was
  // English-only which silently no-op'd on Spanish customers (Ricardo case missed
  // despite clear fantasy-building "me encantaría venirme en tus pies").
  const fantasyPatterns=[
    // ── ENGLISH ──
    /\b(i('d| would)|imagine|if (you were|i were|we were))\b.{0,40}(do|did|fuck|cum|kiss|touch|lick|suck|grab|put|wrap|inside|feel)/i,
    /\bi('?d| would) (love|like|wanna|want to) (to )?(be|feel|taste|touch|see|have|fuck|kiss|lick|suck|cum)/i,
    /\b(your|my|her|his) (cock|pussy|tits|ass|dick|breasts|nipples|clit|mouth|lips|tongue|cum|hard|wet|balls)\b/i,
    /\bmake (you|me|us) (cum|come|hard|wet|finish|moan|scream)/i,
    /\b(want|need|gonna) (to )?(fuck|cum|come|taste|touch|kiss|lick|suck|feel)/i,
    /\bcan'?t (stop|wait) (thinking|to)/i,
    /\b(you would|you'd) (look|feel|taste) (so |amazing|good|hot)/i,
    // ── v0.4.4.5: DOMINANCE / POSITIONAL FANTASY (manager directive — was missed)
    // Scene-action phrasing that doesn't name a lexicon body part. Gate-1 (paid PPV)
    // contains the false-positive risk, so we can be generous with scene language here.
    /\b(on your|on my|get on your|down on your) knees\b/i,
    /\b(from behind|bend you over|bent over|face down|on all fours|pin you|hold you down|grab (your|my) (hair|throat|hips|ass|waist)|spread (your|my))\b/i,
    /\b(ride|riding|straddle|grind on|sit on)\b.{0,15}\b(me|you|my|your|face|cock|dick|lap)\b/i,
    /\bhave you (on your|begging|moaning|screaming|writhing)\b/i,
    // ── v0.4.4.5: DESCRIPTIVE PRESENT-PARTICIPLE FANTASY (was missed)
    // "i keep picturing / thinking about / imagining you [doing something]"
    /\b(picturing|imagining|fantasizing about|thinking about|dreaming about)\b.{0,30}\b(you|us|your|my|me)\b.{0,20}(ing|fuck|cum|naked|on top|inside|until)/i,
    /\bkeep (picturing|imagining|thinking about|seeing)\b.{0,25}(you|us|your)/i,
    // ── SPANISH ── (Ricardo case — "me encantaría venirme en tus pies")
    /\bme (encantar[ií]a|gustar[ií]a|encanta) .{0,30}(venir|correr|chupar|tocar|besar|coger|follar|meter|sentir|probar)/i,
    /\b(venirme|correrme|acabarme) (en|dentro|encima|sobre|contigo|en ti)/i,
    /\b(tus|sus|mis) (tetas|pecho|chichis|pezones|culo|nalgas|panocha|vagina|verga|pene|polla|pies|piernas|medias|labios|boca|lengua)\b/i,
    /\b(quiero|necesito|voy a|vas a) (cogerte|follarte|chuparte|tocarte|besarte|tenerte|sentirte|probarte|meterte)/i,
    /\bme (haces|hace) (mojar|venir|correr|excitar|caliente)/i,
    /\b(imag[ií]nate|imagina|si tu|si yo|si nosotros) .{0,30}(coger|follar|venir|chupar|tocar)/i,
    /\bno (puedo|aguanto) (parar|dejar) de (pensar|imaginar)/i
  ];
  return fantasyPatterns.some(rx=>rx.test(recent));
}

// ── CONTINUED-INTEREST DETECTOR (v0.4.4.1) ─────────────────────
// The most expensive mistake in the system is quitting on a customer who still wants to spend.
// The persuasion cap (3 pitches/rung → ladder closed), the free-count TIMEWASTER, and the
// goodbye routing are all MECHANICAL — they don't look at whether he's still into it. A guy
// who's horny, asking for more, or pulling for content is the OPPOSITE of a timewaster, but
// the give-up logic treats "didn't buy after 3 tries" the same whether he's bored or begging.
// This detector reads ONLY the last 2 customer messages (interest must be CURRENT to override
// give-up — a guy who was hot 10 msgs ago but went quiet shouldn't keep a dead session alive)
// and returns {active, reason}. When active, the enforcement blocks goodbye/give-up and the
// posture freeze blocks TIMEWASTER — she stays warm and keeps the door open.
function detectContinuedInterest(s){
  if(!s||!s.messages) return {active:false,reason:null};
  const customerMsgs=s.messages.filter(m=>m.sender==='customer'&&m.text);
  if(customerMsgs.length===0) return {active:false,reason:null};
  const recent=customerMsgs.slice(-2).map(m=>(m.text||'').toLowerCase()).join('  ');
  // 1. Explicit "wants more" — of her, of content, of the moment. Precise (not bare "more",
  //    which catches "tell me more about your day" = rapport, not buying interest).
  const wantsMore=/\b(more of (you|this|that|it)|another one|send (me )?(more|another|one)|show me (more|another|the rest)|can i (see|get|have) more|i (want|wanna|need) (to see |)(more|another|the rest|you)|keep going|don'?t stop|what else (you got|do you have)|dying to see|let me see (more|the rest))\b/i;
  // 2. Live sexual heat / urgency — no prior-spend requirement; this is current desire.
  const heatNow=/\b(so (hot|horny|hard|turned on|wet)|i'?m (so |really |)(hard|horny|throbbing|aching|dripping|worked up)|turned on right now|can'?t stop thinking|need (you|to (cum|see|touch))|wish i could (touch|taste|feel|see)|getting me (hard|hot|going)|you'?re killing me|driving me (crazy|wild|insane))\b/i;
  // 3. Eager content-pull questions
  const contentPull=/\b(what (are you|r u|you) wearing|what do you have (for me|today)|got anything (else|more|new)|do you have (more|something)|what'?s (next|under|behind that)|tease me|spoil me)\b/i;
  if(wantsMore.test(recent)) return {active:true,reason:'wants_more'};
  if(heatNow.test(recent)) return {active:true,reason:'sexual_heat_now'};
  if(contentPull.test(recent)) return {active:true,reason:'content_pull'};
  return {active:false,reason:null};
}

// ── TIP-PRIMARY MODE (Finding #10, v0.4.4.0) ───────────────────
// Some customers yield MORE through tips than PPVs — the provider/validation type. Training
// doc p32-33: many men have a hardwired drive to provide for a woman and "show they can take
// care of her", even digitally. For these customers, tips are not a fallback after a PPV
// soft-no (the old PART 9 behavior) — tips are the PRIMARY monetization path. Lead with
// relationship-register tip asks, never a number ("spoil me", "show me more love", "tip your
// girl to see how naughty she gets"), keep PPVs secondary. Tippers are top customers AS LONG
// AS it never feels transactional.
//
// 3-state toggle mirrors sexting: AUTO (auto-derive) | FORCE_ON | FORCE_OFF. Hybrid per the
// manager decision — auto-derive a default, the brain refines via tip_affinity in strategy,
// the agent can force it either way. In-memory state (recomputed every recomputePosture).
function toggleTipMode(){
  const s=sessions[activeId]; if(!s) return;
  const cur=s._tipModeToggle||'AUTO';
  const next={'AUTO':'FORCE_ON','FORCE_ON':'FORCE_OFF','FORCE_OFF':'AUTO'}[cur];
  s._tipModeToggle=next;
  recomputePosture(s);
  renderSession();
  toast(`Tip-primary mode: ${next.replace('_',' ')}`,'i');
  if(sb){
    sb.from('aich_events').insert({
      session_id:activeId,
      creator_model:s.creator_model,
      customer_username:s.customer_username,
      event_type:'tip_mode_toggled',
      payload:{toggled_to:next,tip_primary:!!s._tipPrimary,prior:cur}
    }).then(()=>{}).catch(e=>console.warn('event log failed:',e.message));
  }
}

// Auto-derive tip-primary (AUTO mode). Returns boolean. FORCE_ON/FORCE_OFF override.
// Signals (any sufficient): (1) he has TIPPED — session or lifetime — the single clearest
// tip-affinity tell; (2) provider/validation archetype + provider language or PPV-resistance;
// (3) strong provider language AND PPV-resistance together (PPV-averse, happy-to-spoil).
function detectTipPrimary(s){
  if(!s) return false;
  const toggle=s._tipModeToggle||'AUTO';
  if(toggle==='FORCE_OFF') return false;
  if(toggle==='FORCE_ON') return true;
  const profile=s._profile||{};
  const archetype=(profile.archetype||'').toLowerCase();
  const providerArchetype=/relationship|emotional/.test(archetype);
  // Strongest signal: he actually tips.
  const hasTipped=parseMoney(s.tips_spend)>0 || parseMoney(profile.tips_spend)>0;
  if(hasTipped) return true;
  const customerMsgs=(s.messages||[]).filter(m=>m.sender==='customer'&&m.text);
  if(customerMsgs.length===0) return false;
  const recent=customerMsgs.slice(-4).map(m=>(m.text||'').toLowerCase()).join(' ');
  const providerLang=/\b(spoil|treat you|take care of you|let me (help|give|get|spoil|treat|take care)|you deserve|happy to (help|spoil|support)|want to (support|spoil|provide)|here to provide|provide for|take care of my|my (girl|baby|princess|queen|angel))\b/i.test(recent);
  const ppvResistant=/\b(don'?t (like|do|wanna|enjoy) (pay|paying|buy|buying)|not (into|big on|paying for) (ppv|content|videos|paywalls)|rather (just )?(talk|tip|chat|spoil)|prefer to tip|why (do i )?pay)\b/i.test(recent);
  return (providerArchetype && (providerLang || ppvResistant)) || (providerLang && ppvResistant);
}

// ── WHALE BUILDER MODE (v0.4.4.5) ──────────────────────────────
// Per-creator scripted whale-QUALIFICATION arc for new USA subs, opted in via a
// "WHALE BUILDER: ON" marker in the persona prompt (same opt-in pattern as
// PROMISE MODE: BUILDUP_ONLY). The script itself lives in the persona (Cielo
// first): RLS rapport through the age-reveal beat, pivot to her real-life story,
// then a scripted small-tip test whose quoted amount is the ONE sanctioned
// exception to PART 9's never-quote-a-number rule (manager decision 2026-06-12).
// USA detection is conversational: the creator's automated welcome asks
// "spanish or english?" — picking English marks a new American (manager rule).
// State machine: off → active → done(qualified_whale | not_whale). Outcome is
// session-sticky; transitions are logged to aich_events as whale_builder.
// 3-state toggle mirrors sexting/tip-led: AUTO | FORCE_ON | FORCE_OFF (in-memory,
// resets on reload — same limitation as the sexting/tip toggles).
function whaleBuilderMarkerOn(s){
  if(!s) return false;
  try{
    const mdl=(typeof models!=='undefined'&&Array.isArray(models))?models.find(m=>m.name===s.creator_model):null;
    return !!(mdl&&/WHALE[\s_]*BUILDER\s*[:=\-]\s*(ON|ENABLED|TRUE|ACTIVE)/i.test(mdl.prompt||''));
  }catch(e){ return false; }
}
// Reads the customer's language pick from his first replies to the welcome message.
// Explicit pick ("english"/"ingles") wins; an explicit Spanish pick disqualifies; a
// reply in plain English with zero Spanish markers counts as an implicit English pick.
function detectEnglishPick(s){
  const cust=((s&&s.messages)||[]).filter(m=>m.sender==='customer'&&m.text).slice(0,3);
  if(cust.length===0) return {picked:false,signal:'no_reply_yet'};
  const joined=cust.map(m=>(m.text||'').toLowerCase()).join(' ');
  // A mention that only disparages/negates a language is not a pick of it —
  // "english please, my spanish is terrible" is an ENGLISH pick (live finding
  // 2026-06-12: the naive both-words rule misread this as a Spanish pick).
  const spanishNegated=/\b((my )?spanish (is )?(terrible|bad|awful|sucks|rusty|horrible)|no spanish|don'?t (speak|know|do) spanish|can'?t (speak|do) spanish)\b/i.test(joined);
  const englishNegated=/\b((my )?english (is )?(terrible|bad|awful|sucks|rusty|horrible)|no english|don'?t (speak|know|do) english|can'?t (speak|do) english|no hablo (mucho |bien |nada de )?ingl[eé]s|mi ingl[eé]s es (malo|terrible))\b/i.test(joined);
  const saysEnglish=/\b(english|ingles|inglés)\b/i.test(joined)&&!englishNegated;
  const saysSpanish=/\b(spanish|español|espanol|castellano)\b/i.test(joined)&&!spanishNegated;
  if(saysEnglish&&!saysSpanish) return {picked:true,signal:'explicit_english_pick'};
  if(saysSpanish&&!saysEnglish) return {picked:false,signal:'spanish_pick'};
  if(saysEnglish&&saysSpanish) return {picked:false,signal:'language_unclear'};
  // Neither mention survives as a pick — negating one language IS picking the other.
  if(spanishNegated&&!englishNegated) return {picked:true,signal:'explicit_english_pick'};
  if(englishNegated&&!spanishNegated) return {picked:false,signal:'spanish_pick'};
  const spanishMarkers=/[¿¡áéíóúñ]|\b(hola|como|estas|que tal|bien|gracias|guapa|hermosa|linda|mami|buenas|noches|dias|amor|porfa|por favor|foto|quiero|eres|muy)\b/i;
  const englishWords=(joined.match(/\b(the|you|your|hey|hi|hello|how|what|are|is|im|i'm|good|nice|love|babe|beautiful|gorgeous|thanks|yes|yeah|just|wanna|want|doing|from)\b/g)||[]).length;
  if(!spanishMarkers.test(joined)&&englishWords>=2) return {picked:true,signal:'implicit_english_reply'};
  return {picked:false,signal:'language_unclear'};
}
// Main detector + arc state machine. Mutates session bookkeeping fields
// (_whaleBuilderActive / _whaleBuilderAskAt / _whaleBuilderOutcome) so the arc
// survives recomputes within the session.
function detectWhaleBuilder(s){
  if(!s) return {state:'off',signal:null};
  const toggle=s._whaleModeToggle||'AUTO';
  if(toggle==='FORCE_OFF') return {state:'off',signal:'forced_off'};
  if(s._whaleBuilderOutcome) return {state:'done',signal:s._whaleBuilderOutcome};
  if(!whaleBuilderMarkerOn(s)) return {state:'off',signal:null};
  // ACTIVATION — gates run only while the arc has not started. Once active the
  // gates are skipped entirely, so the qualifying tip itself (which makes him a
  // spender) can never eject him from the arc before the outcome is recorded.
  // FORCE_ON skips the new-sub/English gates (agent judgment) but still requires
  // the persona marker — without the script in the persona there is nothing to run.
  if(!s._whaleBuilderActive){
    if(toggle==='FORCE_ON'){ s._whaleBuilderActive=true; s._whaleBuilderSignal='forced_on'; }
    else{
      const profile=s._profile||{};
      if(effectiveLifetimeSpend(profile,s)>0||effectiveSessionSpend(s)>0) return {state:'off',signal:'not_new_sub'};
      if((s._customerTier||'new')!=='new') return {state:'off',signal:'not_new_tier'};
      if((s.messages||[]).filter(m=>m.sender==='model').length>14) return {state:'off',signal:'window_passed'};
      const pick=detectEnglishPick(s);
      if(!pick.picked) return {state:'off',signal:pick.signal};
      s._whaleBuilderActive=true; s._whaleBuilderSignal=pick.signal;
    }
  }
  // ARC IN PROGRESS — detect the scripted tip test in our sent messages, then
  // resolve the outcome from his behavior after it.
  if(s._whaleBuilderAskAt==null){
    const idx=(s.messages||[]).findIndex(m=>m.sender==='model'&&m.text&&/\btips?\b/i.test(m.text)&&/\d{2}/.test(m.text));
    if(idx>=0) s._whaleBuilderAskAt=idx;
  }
  if(s._whaleBuilderAskAt!=null){
    const after=(s.messages||[]).slice(s._whaleBuilderAskAt+1);
    const tipped=after.some(m=>m.tags&&m.tags.tip)||parseMoney(s.tips_spend)>0;
    if(tipped){ s._whaleBuilderOutcome='qualified_whale'; return {state:'done',signal:'qualified_whale'}; }
    if(after.filter(m=>m.sender==='customer').length>=6){ s._whaleBuilderOutcome='not_whale'; return {state:'done',signal:'not_whale'}; }
    return {state:'active',signal:'ask_made'};
  }
  return {state:'active',signal:s._whaleBuilderSignal||'active'};
}
function toggleWhaleMode(){
  const s=sessions[activeId]; if(!s) return;
  const cur=s._whaleModeToggle||'AUTO';
  const next={'AUTO':'FORCE_ON','FORCE_ON':'FORCE_OFF','FORCE_OFF':'AUTO'}[cur];
  s._whaleModeToggle=next;
  recomputePosture(s);
  renderSession();
  toast(`Whale builder: ${next.replace('_',' ')}`,'i');
  if(sb){
    sb.from('aich_events').insert({
      session_id:activeId,
      creator_model:s.creator_model,
      customer_username:s.customer_username,
      event_type:'whale_builder',
      payload:{change:'mode_toggled',toggled_to:next,prior:cur,state:(s._whaleBuilder&&s._whaleBuilder.state)||'off'}
    }).then(()=>{}).catch(e=>console.warn('event log failed:',e.message));
  }
}

// ── AFTERCARE MODE (Pass B manual toggle) ──────────────────────
// Manual-only. Agent flips on when customer soft-nos after a spend, or after sexting climax.
// When on: SSAI stops all pitch moves, runs Percival formula (aftersex or ladder-stop variant).
function toggleAftercareMode(){
  const s=sessions[activeId];if(!s) return;
  const wasOn=s._aftercareMode;
  s._aftercareMode=!s._aftercareMode;
  if(s._aftercareMode && !s._aftercareContext){
    // Default context on first turn-on = ladder_stop (most common trigger)
    s._aftercareContext='ladder_stop';
  }
  let closedNow=false;
  if(!s._aftercareMode){
    s._aftercareContext=null; // clear context when turning off
    // Turning aftercare OFF after it was ON = session boundary.
    // If previously on and now off, mark session closed unless already closed.
    if(wasOn && !s._sessionClosedAt){
      s._sessionClosedAt=new Date().toISOString();
      s._sessionClosedAtMsgCount=(s.messages||[]).length;
      closedNow=true;
    }
  }
  const updates={
    aftercare_mode:s._aftercareMode,
    aftercare_context:s._aftercareContext
  };
  if(closedNow){
    updates.session_closed_at=s._sessionClosedAt;
    updates.session_closed_at_msg_count=s._sessionClosedAtMsgCount;
  }
  if(sb) sb.from('aich_sessions').update(updates).eq('id',activeId).then(()=>{});
  // Log aftercare_triggered event for dashboard
  if(sb){
    sb.from('aich_events').insert({
      session_id:activeId,
      creator_model:s.creator_model,
      customer_username:s.customer_username,
      event_type:'aftercare_triggered',
      payload:{
        toggled_to:s._aftercareMode?'on':'off',
        context:s._aftercareContext,
        session_closed:closedNow,
        posture:s._posture||null,
        tier:s._customerTier||null
      }
    }).then(()=>{}).catch(e=>console.warn('event log failed:',e.message));
  }
  renderSession();
  if(closedNow){
    toast('Aftercare OFF · Session closed — next message starts fresh','s');
  } else {
    toast(s._aftercareMode?`Aftercare ON · ${s._aftercareContext==='aftersex'?'aftersex':'ladder-stop'} variant`:'Aftercare OFF','i');
  }
}

// Manual session close/reopen — agent-controlled backup.
function toggleSessionClosed(){
  const s=sessions[activeId];if(!s) return;
  if(s._sessionClosedAt){
    // Reopen: clear the CLOSED flag but KEEP the day-boundary.
    // Rationale: "reopen" is a UX affordance to let the agent see full convo again,
    // not a time-travel to yesterday. Yesterday's PPV-miss stays expired — the
    // customer already moved on to a new day. Never re-arm a miss that already
    // crossed a sleep cycle.
    s._sessionClosedAt=null;
    // Note: _sessionClosedAtMsgCount intentionally preserved.
    if(sb) sb.from('aich_sessions').update({session_closed_at:null}).eq('id',activeId).then(()=>{});
    toast('Session reopened — day boundary preserved (yesterday stays yesterday)','i');
  } else {
    // Close: set boundary to now. All current messages become "prior session" for wall state.
    s._sessionClosedAt=new Date().toISOString();
    s._sessionClosedAtMsgCount=(s.messages||[]).length;
    if(sb) sb.from('aich_sessions').update({
      session_closed_at:s._sessionClosedAt,
      session_closed_at_msg_count:s._sessionClosedAtMsgCount
    }).eq('id',activeId).then(()=>{});
    toast('Session closed — PPV miss / wall state reset. Next message starts fresh.','s');
  }
  renderSession();
  renderSidebar();
}

function switchAftercareContext(){
  const s=sessions[activeId];if(!s||!s._aftercareMode) return;
  s._aftercareContext=s._aftercareContext==='aftersex'?'ladder_stop':'aftersex';
  if(sb) sb.from('aich_sessions').update({aftercare_context:s._aftercareContext}).eq('id',activeId).then(()=>{});
  renderSession();
  toast(`Aftercare context → ${s._aftercareContext==='aftersex'?'aftersex':'ladder-stop'}`,'i');
}

// ── POSTURE SYSTEM ─────────────────────────────────────────────
// Replaces the old rapport budget. Spec: four-state posture with
// tier-based thresholds, unpaid-CTA escalation, and whale override.

function computeCustomerTier(s,profile){
  if(profile?.is_timewaster===true) return 'flagged_tw';
  // v0.4.4.0: effective spend (PPV + tips) — a tipper counts as a spender for tier.
  const spend=effectiveLifetimeSpend(profile,s);
  const trust=parseInt(profile?.trust_level||1);
  const hasPriorSessions=(profile?.prior_session_count||0)>0;
  if(spend>0||trust>=2||hasPriorSessions) return 'old';
  return 'new';
}

function computePosture(s,profile){
  const tier=s._customerTier||'new';
  const free=s._freeMsgCount||0;
  const unpaid=s._unpaidCtaCount||0;

  // v0.4.1.2: LOOSENED thresholds. v0.4.1.1 overcorrected from 16.9 avg warmup
  // by forcing PRESSURE at msg 8 — that crushed the rapport→breadcrumb→promise
  // sequence (~11+ msgs of pre-ladder work) and made AI sound like a vending
  // machine. New doctrine: rapport is signal-gated, not count-gated. Posture
  // escalation is a backstop for actual stalls, not a clock-driven push.
  // Target warmup: ~12 msgs for new tier (was 8).
  const thresholds={
    new:         {probe:7, pressure:11, tw:16},
    old:         {probe:5, pressure:8,  tw:12},
    flagged_tw:  {probe:2, pressure:3,  tw:5}
  }[tier];

  // Base posture from free message count
  let base='WARM_BUILD';
  if(free>=thresholds.tw)            base='TIMEWASTER';
  else if(free>=thresholds.pressure) base='PRESSURE';
  else if(free>=thresholds.probe)    base='PROBE';

  // Unpaid CTA override — take the stricter
  const levels=['WARM_BUILD','PROBE','PRESSURE','TIMEWASTER'];
  let baseIdx=levels.indexOf(base);
  if(unpaid>=1) baseIdx=Math.max(baseIdx,Math.min(baseIdx+1,3));
  if(unpaid>=2) baseIdx=Math.max(baseIdx,2);
  if(unpaid>=3) baseIdx=3;
  let posture=levels[baseIdx];

  // v0.4.1.2: INVESTMENT-ZERO TIMEWASTER OVERRIDE
  // If 20+ AI msgs have passed AND he's shown zero investment AND zero spend,
  // force TIMEWASTER regardless of normal threshold. He's treating her like a
  // vending machine — drop creator energy, make him work or peel off.
  // This is the frame-protection escape valve.
  const aiMsgCount=s?.messages?.filter(m=>m.sender==='model').length||0;
  const lifetimeSpend=parseFloat((profile?.total_spend||0).toString().replace(/[$,]/g,''))||0;
  if(aiMsgCount>=20&&lifetimeSpend===0){
    const inv=detectInvestmentSignals(s);
    if(inv.count===0){
      posture='TIMEWASTER';
    }
  }

  // v0.4.1.5: PROMISE-REFUSAL TIMEWASTER OVERRIDE
  // If the brain has shipped 2+ Promise Ritual asks since the last PPV opened
  // (rung start) and no PPV has landed since, he is hard-refusing the trust
  // gate. Doctrine Part 4 says: never ask a third time. Force TIMEWASTER so
  // strategy clamping switches to story_framework / goodbye_script rather than
  // continuing to push the promise. Resets automatically on next PPV land
  // (rungStart moves past the now-opened PPV).
  //
  // IMPORTANT: count TRUE re-asks only, not the legitimate reinforcement beat.
  // Per PART 4 lifecycle (not_started → in_progress → verbally_committed →
  // complete → reinforcement → assumed), once the customer drops a commit
  // token ("yes / promise / i do / sure / okay"), the brain's next Promise
  // Ritual message is the REINFORCEMENT (legitimate, NOT another ask) — it
  // must not count toward the refusal threshold. Reset the counter whenever a
  // customer commit token lands; only consecutive uncommitted asks count.
  if(s&&s.messages&&s.messages.length>0){
    let promiseRungStart=0;
    for(let i=s.messages.length-1;i>=0;i--){
      if(s.messages[i].sender==='ppv'&&s.messages[i].opened===true){
        promiseRungStart=i+1;
        break;
      }
    }
    const commitTokens=/\b(yes|yeah|yep|ye|sure|ok|okay|promise|i do|of course|absolutely|definitely|swear|cross my heart|got it|you got it|deal|word)\b/i;
    let promiseAsksWithoutCommit=0;
    for(let i=promiseRungStart;i<s.messages.length;i++){
      const m=s.messages[i];
      if(m.sender==='model'&&m.skeleton_step==='Promise Ritual'){
        promiseAsksWithoutCommit++;
      } else if(m.sender==='customer'&&commitTokens.test(m.text||'')){
        // verbal commit landed — subsequent Promise Ritual beats are reinforcement, not re-asks
        promiseAsksWithoutCommit=0;
      }
    }
    if(promiseAsksWithoutCommit>=2){
      posture='TIMEWASTER';
    }
  }

  // v0.4.1.5: LADDER-CLOSED TIMEWASTER OVERRIDE
  // If the persuasion cap has been hit on the current rung (3 pitch attempts
  // without conversion), force TIMEWASTER for cost optimization. This is the
  // post-cap state — stay nice but go SHORT. Buy resets the rung and lifts
  // the override automatically because rung start moves past the new opened PPV.
  if(s&&s.messages&&s.messages.length>0){
    let rungStart=0;
    for(let i=s.messages.length-1;i>=0;i--){
      if(s.messages[i].sender==='ppv'&&s.messages[i].opened===true){
        rungStart=i+1;
        break;
      }
    }
    let rungAttempts=0;
    const pitchPhases=['cta1','cta2','sell','send_content'];
    for(let i=rungStart;i<s.messages.length;i++){
      const m=s.messages[i];
      if(m.sender==='ppv') rungAttempts++;
      else if(m.sender==='model'&&m.phase&&pitchPhases.includes(m.phase)) rungAttempts++;
    }
    if(rungAttempts>=3){
      posture='TIMEWASTER';
    }
  }

  // Whale override — trust_level >= 4 AND total_spend >= 100 caps at PRESSURE
  const spend=parseFloat((profile?.total_spend||0).toString().replace(/[$,]/g,''))||0;
  const trust=parseInt(profile?.trust_level||1);
  if(posture==='TIMEWASTER'&&trust>=4&&spend>=100){
    posture='PRESSURE';
  }
  // PENDING-PPV PROTECTION — if there's an unopened PPV from this session, customer is mid-conversion,
  // not a timewaster. Demote TIMEWASTER → PRESSURE so AI keeps urgency without going caretaker mode.
  // The miss-lockout system handles real misses separately. Posture should reflect "still a live sale",
  // not free-message count, when content is sitting unopened in his DMs.
  if(s&&s.messages){
    const hasPendingPpv=s.messages.some(m=>m.sender==='ppv'&&m.opened===false&&m.price>0);
    if(hasPendingPpv&&posture==='TIMEWASTER') posture='PRESSURE';
  }

  // v0.4.1.4 TIMEWASTER GUARDS (PART 6 doctrine, feedback items #19, #28, #29, #30)
  // These prevent TW from misfiring on customers who only look like TW but aren't:
  // real buyers in negotiation, customers who already paid this session, etc.
  if(posture==='TIMEWASTER'&&s&&s.messages){
    // GUARD 1 — PRE-CTA PROTECTION
    // TIMEWASTER cannot fire before at least one CTA attempt. If we've never tried to
    // pitch, we don't yet know if he's a timewaster — drift alone is rapport, not stall.
    const ctaPhases=['cta1','cta2','sell','send_content','close','link'];
    const hasCtaAttempt=s.messages.some(m=>
      m.sender==='ppv' ||
      (m.sender==='model'&&m.phase&&ctaPhases.includes(m.phase))
    );
    if(!hasCtaAttempt) posture='PRESSURE'; // ladder window stays open; brain can still pitch

    // GUARD 2 — ACTIVE-SESSION SPEND IMMUNITY (v0.4.4.0: PPV **or** tip)
    // ANY customer who has spent in the current session — opened a PPV OR sent a tip —
    // is TW-immune for the REST of the session, permanently. Spend is the ultimate buying
    // signal. A tipper is a top-tier customer, not a timewaster. A reply gap (10 min, an
    // hour) is an active buyer who stepped away, not disengagement. The ladder continues.
    const sessionPaidPpv=s.messages.some(m=>m.sender==='ppv'&&m.opened===true);
    const sessionTipsForGuard=parseMoney(s.tips_spend);
    const sessionHasSpend=sessionPaidPpv||sessionTipsForGuard>0;
    if(sessionHasSpend) posture='PRESSURE';

    // GUARD 3 — POST-PAYMENT GRACE WINDOW (6 beats)
    // After any payment (PPV unlock or tip), give 6 messages of grace before TW can fire.
    // Covers the tip-only case (Guard 2 only covers PPV) and prevents premature TW after
    // a payment when the customer is still actively engaged.
    const sessionTips=parseFloat((s.tips_spend||'0').toString().replace(/[$,]/g,''))||0;
    const hasAnyPayment=sessionPaidPpv||sessionTips>0;
    const freeMsgs=s._freeMsgCount||0; // resets to 0 on payment
    if(posture==='TIMEWASTER'&&hasAnyPayment&&freeMsgs<6) posture='PRESSURE';
  }

  // v0.4.1.4 SEXTING POSTURE FREEZE (PART 23 doctrine, feedback items #7, #34)
  // When sexting_active, the posture system cannot decay to TIMEWASTER. The doctrine
  // says posture "freezes" — for simplicity we just ensure it stays at PRESSURE or
  // warmer, which keeps the ladder window open and tells the brain "still selling."
  if(s?._sextingActive && posture==='TIMEWASTER') posture='PRESSURE';

  // v0.4.4.1 CONTINUED-INTEREST POSTURE FREEZE
  // A customer showing CURRENT buying interest (wants more / live heat / pulling for content)
  // is not a timewaster — UNLESS he's still at $0 spend after we already made a real ask (that
  // gating lives in `_continuedInterestProtects`; an asked-and-no-money "show me more" guy is
  // the vending-machine timewaster and is NOT shielded). When he IS protected, freeze posture at
  // PRESSURE so the brain stays warm and keeps selling instead of going short/cold.
  if(s?._continuedInterestProtects && posture==='TIMEWASTER') posture='PRESSURE';

  return posture;
}

// v0.4.1.2: INVESTMENT SIGNAL DETECTOR — frame protection layer.
// Doctrine: sexual heat alone is not a green light. Heat + investment = green light.
// He has to show he's invested in HER (not just the content) before the ladder opens.
// This prevents AI from becoming a vending machine on aggressive customers.
//
// Returns {count, signals: [...]} — checked customer-side messages only.
// Floor for promise ritual to start: count >= 2.
function detectInvestmentSignals(s){
  if(!s||!s.messages) return {count:0,signals:[]};
  const customerMsgs=s.messages.filter(m=>m.sender==='customer'&&m.text);
  if(customerMsgs.length===0) return {count:0,signals:[]};
  const creatorName=(s.creator_model||'').toLowerCase().trim();
  const creatorDisplayName=(s._profile?.creator_display_name||creatorName).toLowerCase().trim();
  const compliments_beyond_body=['vibe','energy','funny','smart','sweet','cool','interesting','different','real','genuine','chill','kind','nice personality','easy to talk','easy talking'];
  const personal_questions=[
    /\bhow are (you|u)\b/i,/\bhow('?s| is) (your|ur) day\b/i,/\bwhat (do|r|are) (you|u) (do|doing|up to|into)\b/i,
    /\bwhere (are|r) (you|u) from\b/i,/\bwhat('?s| is) (your|ur) name\b/i,/\bhow old (are|r) (you|u)\b/i,
    /\bwhat (do|are) (you|u) like\b/i,/\btell me (about (you|ur)|something about)\b/i
  ];
  const signals=[];
  // Track unique signal types across the whole convo, not per-message — one signal of each type max
  const found=new Set();
  for(const m of customerMsgs){
    const t=(m.text||'').toLowerCase();
    if(t.length<2) continue;
    // 1. Personal question to her
    if(!found.has('personal_question')&&personal_questions.some(rx=>rx.test(t))){
      found.add('personal_question');signals.push({type:'personal_question',sample:m.text.slice(0,60)});
    }
    // 2. Used her name
    if(!found.has('used_her_name')&&creatorDisplayName.length>=3&&t.includes(creatorDisplayName)){
      found.add('used_her_name');signals.push({type:'used_her_name',sample:m.text.slice(0,60)});
    } else if(!found.has('used_her_name')&&creatorName.length>=3&&t.includes(creatorName)){
      found.add('used_her_name');signals.push({type:'used_her_name',sample:m.text.slice(0,60)});
    }
    // 3. Self-disclosure (he shared something about himself, unprompted, not a question)
    if(!found.has('self_disclosure')&&t.length>=20&&!t.includes('?')&&/\b(i|i'?m|i'?ve|my|me)\b/.test(t)
       &&!/\bsend\b|\bshow\b|\bhow much\b|\bprice\b|\bcost\b|\bcan i (see|get|have)\b/.test(t)){
      found.add('self_disclosure');signals.push({type:'self_disclosure',sample:m.text.slice(0,60)});
    }
    // 4. Compliment beyond body
    if(!found.has('compliment_beyond_body')&&compliments_beyond_body.some(c=>t.includes(c))){
      found.add('compliment_beyond_body');signals.push({type:'compliment_beyond_body',sample:m.text.slice(0,60)});
    }
    // 5. Reaction to a breadcrumb — customer references content of the prior AI message
    // Heuristic: customer message length >= 15 chars AND not just emoji/short reaction
    // AND comes immediately after an AI message AND contains a content word from that AI message
    const idx=s.messages.indexOf(m);
    if(!found.has('breadcrumb_reaction')&&idx>0&&t.length>=15){
      const priorAi=[...s.messages.slice(0,idx)].reverse().find(x=>x.sender==='model'&&x.text);
      if(priorAi){
        const aiWords=(priorAi.text||'').toLowerCase().match(/\b[a-z]{4,}\b/g)||[];
        const contentWords=aiWords.filter(w=>!['just','really','about','have','this','that','your','what','when','where','which','would','could','being','their','there','still','some','very','also','then','than','from','with','they','them','were','been','will','only','more','like','want','take','make','said','says','here','dont','don\'t'].includes(w));
        if(contentWords.length>=2&&contentWords.some(w=>t.includes(w))){
          found.add('breadcrumb_reaction');signals.push({type:'breadcrumb_reaction',sample:m.text.slice(0,60)});
        }
      }
    }
  }
  return {count:signals.length,signals};
}

// v0.4.1.5: Promise-commitment detector. Reads the latest customer message; if it
// contains a trust-acceptance token AND the promise opener has already landed
// (status=in_progress), returns the matched token. Used to advance the promise
// state machine from `in_progress` → `verbally_committed` so the generator
// template can write a reinforcement beat instead of re-asking the opener
// (the "promise loop" bug — feedback Rami/Brandon 2026-05-12).
const PROMISE_COMMITMENT_TOKENS=[
  'i promise','i swear','i wont tell','i won\'t tell','wont tell','won\'t tell',
  'between us','stays between','stays with me','my lips are sealed','sealed lips',
  'yes promise','yes i promise','of course i promise','course it stays','course it does',
  'ok promise','okay promise','i got u','i got you','trust me',
  'send it','show me','let me see','i wanna see','i want to see',
  'deal','its a deal','it\'s a deal','you have my word','my word',
  'yeah i promise','yea promise','yea i promise','promise babe','promise baby'
];
function detectPromiseCommitment(s){
  if(!s||!s.messages) return null;
  let lastCust='';
  for(let i=s.messages.length-1;i>=0;i--){
    if(s.messages[i].sender==='customer'){lastCust=(s.messages[i].text||'').toLowerCase();break;}
  }
  if(!lastCust) return null;
  return PROMISE_COMMITMENT_TOKENS.find(t=>lastCust.includes(t))||null;
}

// Trust level hard caps by spend — AI cannot assign higher than spend allows
// v0.4.4.0: EFFECTIVE SPEND — tips are real money and scale the ladder exactly like PPV
// spend (trust ceiling, pricing, tier, TW-immunity). Previously tips lived in a separate
// tips_spend bucket that the scaling engine ignored, so a $200 tipper was treated as a $0
// cold lead. Tippers are top-tier customers — their dollars count everywhere PPV dollars do.
function parseMoney(v){ return parseFloat((v||0).toString().replace(/[$,]/g,''))||0; }
function effectiveSessionSpend(s){
  if(!s) return 0;
  return parseMoney(s.total_spend)+parseMoney(s.tips_spend);
}
function effectiveLifetimeSpend(profile,s){
  const p=profile||(s&&s._profile)||{};
  // Lifetime PPV + lifetime tips from the profile; fall back to session figures when no profile.
  const ppv=p.total_spend!=null?parseMoney(p.total_spend):parseMoney(s&&s.total_spend);
  const tips=p.tips_spend!=null?parseMoney(p.tips_spend):parseMoney(s&&s.tips_spend);
  return ppv+tips;
}

function capTrustBySpend(aiAssignedTrust,totalSpend){
  const spend=parseFloat((totalSpend||0).toString().replace(/[$,]/g,''))||0;
  let maxAllowed=1;
  if(spend>0)    maxAllowed=2;
  if(spend>=30)  maxAllowed=3;
  if(spend>=100) maxAllowed=4;
  if(spend>=250) maxAllowed=5;
  return Math.min(parseInt(aiAssignedTrust)||1,maxAllowed);
}

function recomputePosture(s){
  if(!s) return;
  // v0.4.1.4: compute sexting_active BEFORE posture so computePosture can read it
  // for the SEXTING POSTURE FREEZE check (PART 23). The detector is cheap (regex
  // over last 3 customer messages) — fine to recompute on every call.
  s._sextingActive=(typeof detectSextingActive==='function')?detectSextingActive(s):false;
  s._tipPrimary=(typeof detectTipPrimary==='function')?detectTipPrimary(s):false;
  // v0.4.4.5: whale-builder qualification arc state (Cielo new-USA-sub script).
  // Computed before posture so the acceptDraft clock-freeze and the prompt state
  // block both read a current value. Arc transitions are audit-logged once each.
  s._whaleBuilder=(typeof detectWhaleBuilder==='function')?detectWhaleBuilder(s):{state:'off',signal:null};
  try{
    const wbKey=s._whaleBuilder.state+':'+(s._whaleBuilder.signal||'');
    if(s._whaleBuilder.state!=='off'&&s._whaleBuilderLoggedKey!==wbKey){
      s._whaleBuilderLoggedKey=wbKey;
      if(typeof sb!=='undefined'&&sb&&s.id&&!String(s.id).startsWith('local_')){
        sb.from('aich_events').insert({
          session_id:s.id,creator_model:s.creator_model,customer_username:s.customer_username,
          event_type:'whale_builder',
          payload:{change:'state',state:s._whaleBuilder.state,signal:s._whaleBuilder.signal,ask_at:(s._whaleBuilderAskAt!=null?s._whaleBuilderAskAt:null)}
        }).then(()=>{}).catch(e=>console.warn('whale_builder event failed:',e.message));
      }
    }
  }catch(e){}
  // v0.4.4.1: current buying interest (last 2 customer msgs). Read by computePosture (TW freeze)
  // and the wall-enforcement give-up guard. Computed before posture so the freeze can see it.
  s._continuedInterest=(typeof detectContinuedInterest==='function')?detectContinuedInterest(s):{active:false,reason:null};
  // v0.4.4.1 REFINEMENT: interest PROTECTS the session (blocks TW + blocks give-up) only while
  // we haven't already tried-and-failed to extract money. An "interested" guy who is STILL at
  // $0 spend AFTER a real monetization attempt (a PPV was sent OR a CTA went unpaid) is all talk
  // — the vending-machine timewaster — and TW is allowed to fire on him. Protect when: he has
  // spent (the spender guard also covers this) OR no real ask has been made yet (don't quit
  // before even trying). Once asked-and-no-money, his "show me more" no longer shields him.
  {
    const ci=s._continuedInterest;
    const madeRealAsk=(s.messages||[]).some(m=>m.sender==='ppv') || (s._unpaidCtaCount||0)>=1;
    const sessionSpendZero=(typeof effectiveSessionSpend==='function'?effectiveSessionSpend(s):0)===0;
    s._continuedInterestProtects=!!(ci && ci.active && !(sessionSpendZero && madeRealAsk));
  }
  s._customerTier=computeCustomerTier(s,s._profile);
  s._posture=computePosture(s,s._profile);
  // Auto-flag when posture computes to TIMEWASTER (session archive will persist this)
  if(s._posture==='TIMEWASTER') s._autoFlagged=true;
  // v0.4.4.0 Finding #7: RETURNING SPENDER → SOFT REINFORCEMENT, not full ritual.
  // A customer with lifetime spend already did the promise dance in a prior session — forcing
  // the full multi-beat ritual again is friction. Start him at 'reinforcement' so the brain
  // does a single warm callback ("you remember what you promised me 😌") instead of the cold
  // full ritual. One-shot, profile-gated: runs once when the profile first loads, only upgrades
  // the initial 'not_started', and never fires again — so it can't fight a deliberate reframe
  // (if he doesn't remember, the brain re-frames the promise; doctrine PART 4 handles that, and
  // we must not bounce him back to 'reinforcement' on the next recompute). Effective lifetime
  // spend = PPV + tips. Only when no PPV has been sent yet THIS session (fresh start).
  if(!s._returningSpenderPromiseInit && s._profile){
    if((s._promiseStatus||'not_started')==='not_started'){
      const lifeSpend=effectiveLifetimeSpend(s._profile,s);
      const noPpvThisSession=!(s.messages||[]).some(m=>m.sender==='ppv');
      if(lifeSpend>0 && noPpvThisSession){
        s._promiseStatus='reinforcement';
      }
    }
    s._returningSpenderPromiseInit=true;
  }
}

// Surgical chip update — avoids full renderSession() for live situational awareness
function updatePostureChip(){
  const s=sessions[activeId];if(!s) return;
  const chip=document.getElementById('postureChip');if(!chip) return;
  const p=s._posture||'WARM_BUILD';
  const spend=parseFloat((s.total_spend||'0').toString().replace(/[$,]/g,''))||0;
  chip.textContent=`${p} · Free:${s._freeMsgCount||0} · UnpaidCTA:${s._unpaidCtaCount||0} · Tier:${(s._customerTier||'new').toUpperCase()} · $${spend}`;
  chip.className='chip '+(p==='TIMEWASTER'?'red':p==='PRESSURE'?'amber':p==='PROBE'?'amber':'');
  // Keep the TW toggle button label/color in sync when tier changes
  const twBtn=document.getElementById('twToggleBtn');
  if(twBtn){
    const isFlagged=s._customerTier==='flagged_tw';
    twBtn.textContent=isFlagged?'✅ Unmark TW':'🚩 Mark TW';
    twBtn.className='btn sm '+(isFlagged?'success':'danger');
    twBtn.title=isFlagged?'Customer is currently flagged TW · click to unmark':'Mark as timewaster · future sessions start on tight thresholds';
  }
  // v0.4.3.2: also surgically refresh the sexting chip so AUTO→ACTIVE transitions
  // are visible immediately after a generation that flipped s._sextingActive.
  // Previously the chip only refreshed on full renderSession() — meaning the AUTO
  // chip stayed gray even when the brain was treating sexting as active mid-scene.
  const sextChip=document.getElementById('sextingChip');
  if(sextChip){
    const toggle=s._sextingModeToggle||'AUTO';
    const active=!!s._sextingActive;
    let label, cls;
    if(toggle==='FORCE_ON'){ label='SEXTING · FORCE ON'; cls='red'; }
    else if(toggle==='FORCE_OFF'){ label='SEXTING · FORCE OFF'; cls=''; }
    else { label=active?'SEXTING · AUTO ACTIVE':'SEXTING · AUTO'; cls=active?'red':''; }
    sextChip.textContent=label;
    sextChip.className='chip '+cls;
  }
  // v0.4.4.0: surgically refresh the tip-primary chip too (AUTO→ACTIVE transitions).
  const tipChip=document.getElementById('tipModeChip');
  if(tipChip){
    const toggle=s._tipModeToggle||'AUTO';
    const active=!!s._tipPrimary;
    let label, cls;
    if(toggle==='FORCE_ON'){ label='TIP-LED · FORCE ON'; cls='green'; }
    else if(toggle==='FORCE_OFF'){ label='TIP-LED · FORCE OFF'; cls=''; }
    else { label=active?'TIP-LED · AUTO ACTIVE':'TIP-LED · AUTO'; cls=active?'green':''; }
    tipChip.textContent=label;
    tipChip.className='chip '+cls;
  }
  // v0.4.4.5: whale-builder chip surgical refresh (arc transitions visible immediately
  // after a generation/accept that advanced the state machine).
  const whaleChip=document.getElementById('whaleChip');
  if(whaleChip){
    const toggle=s._whaleModeToggle||'AUTO';
    const wb=s._whaleBuilder||{state:'off'};
    let label,cls;
    if(toggle==='FORCE_OFF'){ label='WHALE · FORCE OFF'; cls=''; }
    else if(toggle==='FORCE_ON'){ label='WHALE · FORCE ON'; cls='blue'; }
    else if(wb.state==='done'){ label=wb.signal==='qualified_whale'?'WHALE ✓ QUALIFIED':'WHALE · NOT WHALE'; cls=wb.signal==='qualified_whale'?'green':''; }
    else if(wb.state==='active'){ label='WHALE · ARC ACTIVE'; cls='blue'; }
    else { label='WHALE · AUTO'; cls=''; }
    whaleChip.textContent=label;
    whaleChip.className='chip '+cls;
  }
}

async function toggleTimewasterFlag(){
  const s=sessions[activeId];if(!s) return;
  const isCurrentlyFlagged=s._customerTier==='flagged_tw';
  console.log('[TW TOGGLE] start. tier=',s._customerTier,' is_tw=',s._profile?.is_timewaster,' username=',s.customer_username);
  if(!isCurrentlyFlagged){
    // Marking as TW
    if(!await confirmInPage('Mark this customer as timewaster? Future sessions with this customer will start on tight 3/4/5 thresholds.')) return;
    if(sb&&s.customer_username){
      const{data:upRes,error:upErr}=await sb.from('customer_profiles').upsert({
        creator_model:s.creator_model,
        customer_username:s.customer_username,
        is_timewaster:true
      },{onConflict:'creator_model,customer_username'}).select();
      console.log('[TW TOGGLE] upsert result:',upRes,'err:',upErr);
      // Verify by re-reading
      const{data:verify}=await sb.from('customer_profiles')
        .select('is_timewaster')
        .eq('creator_model',s.creator_model)
        .eq('customer_username',s.customer_username)
        .single();
      console.log('[TW TOGGLE] DB verify after write:',verify);
      // Log event for dashboard
      await sb.from('aich_events').insert({
        session_id:s.id,creator_model:s.creator_model,customer_username:s.customer_username,
        event_type:'tw_flagged',payload:{trigger:'manual'}
      });
    }
    if(s._profile) s._profile.is_timewaster=true;
    else s._profile={is_timewaster:true,creator_model:s.creator_model,customer_username:s.customer_username};
    s._customerTier='flagged_tw';
    recomputePosture(s);
    renderSession();
    toast('Customer flagged as TW','i');
  } else {
    // Unmarking TW
    if(sb&&s.customer_username){
      const{data:upRes,error:upErr}=await sb.from('customer_profiles').update({is_timewaster:false,tw_auto_cleared_at:null})
        .eq('creator_model',s.creator_model)
        .eq('customer_username',s.customer_username).select();
      console.log('[TW TOGGLE] update result:',upRes,'err:',upErr);
      await sb.from('aich_events').insert({
        session_id:s.id,creator_model:s.creator_model,customer_username:s.customer_username,
        event_type:'tw_cleared',payload:{trigger:'manual'}
      });
    }
    if(s._profile) s._profile.is_timewaster=false;
    s._customerTier=computeCustomerTier(s,s._profile);
    recomputePosture(s);
    renderSession();
    toast('TW flag cleared','s');
  }
}

async function flagAsTimewaster(){
  const s=sessions[activeId];if(!s) return;
  if(!await confirmInPage('Mark this customer as timewaster? Future sessions with this customer will start on tight 3/4/5 thresholds.')) return;
  if(sb&&s.customer_username){
    await sb.from('customer_profiles').upsert({
      creator_model:s.creator_model,
      customer_username:s.customer_username,
      is_timewaster:true
    },{onConflict:'creator_model,customer_username'});
  }
  if(s._profile) s._profile.is_timewaster=true;
  s._customerTier='flagged_tw';
  recomputePosture(s);
  renderSession();
  toast('Customer flagged as TW','i');
}

async function clearTimewasterFlag(){
  const s=sessions[activeId];if(!s) return;
  if(sb&&s.customer_username){
    await sb.from('customer_profiles').update({is_timewaster:false})
      .eq('creator_model',s.creator_model)
      .eq('customer_username',s.customer_username);
  }
  if(s._profile) s._profile.is_timewaster=false;
  // Full amnesty: recompute tier from spend/trust/priors only
  s._customerTier=computeCustomerTier(s,s._profile);
  recomputePosture(s);
  renderSession();
  toast('TW flag cleared','s');
}

// ── PASS A: FRAMEWORK ENFORCEMENT (strategy validation + clamps) ─────
// Deterministic JS-side enforcement. Claude's self-check is soft; this is hard.

// v0.3.0.37.2: independent verifier on the rendered analysis (intel panel)
// vs ground truth from session/profile state. Catches drift between what the
// strategy LLM is showing the agent and what's actually true. Returns an array
// of human-readable warnings to surface as a badge above the intel panel.
//
// The check is deterministic — no second LLM call. Cheap, fast, and reliable.
// It does NOT auto-correct. The agent sees the warnings and decides.
function auditAnalysisVsGroundTruth(analysis,session){
  const warns=[];
  if(!analysis||!session) return warns;
  const profile=session._profile||{};
  // v0.4.4.3 cleanup: the old `session._ppvMissedAfterChance` stash was never assigned (dead),
  // so the miss-lock warns below silently never fired. Compute it LIVE from wallState instead.
  // Suppressed during an agent override — if the agent deliberately directs a pitch despite the
  // lock, the dedicated override block governs and a contradicting warn would just be noise.
  let missLockedNow=false;
  try{ missLockedNow=!!computeWallState(session).ppvMissedAfterChance && !analysis.agent_override_active; }catch(e){ missLockedNow=false; }
  // Spend (numeric, after stripping $ and commas)
  const totalSpend=parseFloat((session.total_spend||profile.total_spend||0).toString().replace(/[$,]/g,''))||0;
  const lifetimePpvCount=(session.messages||[]).filter(m=>m.sender==='ppv'&&m.opened===true).length;
  const totalCustMsgs=(session.messages||[]).filter(m=>m.sender==='customer').length;
  const sessionPosture=session._posture||'WARM_BUILD';
  const isTw=profile.is_timewaster===true||sessionPosture==='TIMEWASTER'||sessionPosture==='FLAGGED_TW';
  const trust=parseInt(analysis.trust_level)||1;
  const arch=String(analysis.archetype||'').toLowerCase();
  const temp=String(analysis.temperature||'').toLowerCase();
  const phase=String(analysis.phase||'').toLowerCase();
  const purpose=String(analysis.message_purpose||'').toLowerCase();
  const nextMove=String(analysis.next_move||'').toLowerCase();

  // 1. Trust vs spend hard floors (mirror capTrustBySpend rules)
  if(trust>=5 && totalSpend<250) warns.push(`Trust shown as L5 but lifetime spend is $${totalSpend} (L5 needs $250+)`);
  else if(trust>=4 && totalSpend<100) warns.push(`Trust shown as L4 but lifetime spend is $${totalSpend} (L4 needs $100+)`);
  else if(trust>=3 && totalSpend<30) warns.push(`Trust shown as L3 but lifetime spend is $${totalSpend} (L3 needs $30+)`);

  // 2. Whale-In-Training requires devotion-relative-to-spend signal
  if(arch.includes('whale')){
    if(totalSpend>=100) warns.push(`Customer Type "Whale-In-Training" but lifetime spend is already $${totalSpend} — at this point he's a Whale, not in training`);
  }

  // 3. Lurker / Freeloader claim vs actual spend
  if((arch.includes('lurker')||arch.includes('freeloader')) && totalSpend>=30){
    warns.push(`Customer Type "${analysis.archetype}" but lifetime spend is $${totalSpend} — proven spender, not a lurker/freeloader`);
  }

  // 4. Temperature "hot" with zero engagement
  if(temp==='hot' && totalCustMsgs<=2){
    warns.push(`Temperature shown as "hot" but only ${totalCustMsgs} customer message(s) — too early to read as hot`);
  }

  // 5. Aftercare phase outside the manual-toggle + Whale-first-purchase exception.
  // v0.3.0.37.4: doctrine #11 — aftercare is manual-toggle by default with ONE exception:
  // auto-allowed only on Whale-In-Training first purchase (PPV count=1, trust >= L2).
  // Outside that intersection, aftercare phase without toggle is drift.
  if(phase==='aftercare' && !session._aftercareMode){
    const isWhale=arch.includes('whale');
    const allowedAutoFire=isWhale && lifetimePpvCount===1 && trust>=2;
    if(!allowedAutoFire){
      if(lifetimePpvCount===0&&totalSpend===0){
        warns.push('Phase "aftercare" but no PPV landed and toggle is OFF — aftercare needs a purchase or manual toggle');
      } else {
        warns.push(`Phase "aftercare" auto-fired without toggle, but customer is not Whale+first-purchase (Type=${analysis.archetype}, PPVs=${lifetimePpvCount}, trust=L${trust}) — only Whale-In-Training first purchase allows auto-aftercare; everything else needs manual toggle`);
      }
    }
  }

  // 6. send_content phase but PPV-miss locked
  if((phase==='send_content'||phase==='cta1'||phase==='cta2')&&missLockedNow){
    warns.push('Phase suggests new PPV pitch but PPV-miss lockout is active — only exclusive_custom_framing is allowed this session');
  }

  // 7. continue_climb on a clearly stuck Lurker (Case 5 signal)
  if(nextMove.includes('continue_climb')||purpose.includes('continue climbing')){
    if(totalSpend===0&&totalCustMsgs>=10&&!arch.includes('whale')){
      warns.push(`Next move "continue_climb" but customer has ${totalCustMsgs} messages with $0 spend — Case 5 stuck lurker pattern; consider story_framework or push to qualify`);
    }
  }

  // 8. TIMEWASTER posture but next move is heavy-investment
  if(isTw && (purpose.includes('emotional depth')||purpose.includes('vulnerable')||nextMove.includes('emotional depth'))){
    warns.push('Customer is flagged TIMEWASTER but next move calls for emotional depth — emotional investment in TW is doctrine drift');
  }

  // 9. message_purpose claims a price/tier that conflicts with PPV-miss lockout
  if(missLockedNow&&(/\$\d+/.test(purpose)||/tier\s*[2-5]/i.test(purpose))){
    warns.push('Strategy references a new PPV price/tier while PPV-miss lockout is active');
  }

  // 10. Promise ritual phase mismatch
  if(phase==='promise_ritual'){
    const ps=session._promiseStatus||'not_started';
    if(ps==='complete'||ps==='reinforcement'||ps==='assumed'){
      warns.push(`Phase "promise_ritual" but session promise_status is "${ps}" — ritual already done, should be reinforcement or assumed`);
    }
  }

  // 11. v0.3.0.37.6: behavioral signal vs strategy push direction
  // If telemetry shows COOLING and strategy is pushing a pitch move, flag drift.
  // Doesn't override walls — wall handling logic still wins.
  const sig=session._behavioralSignals;
  if(sig&&sig.signal==='cooling'&&!session._wallDetected){
    const pitching=phase==='cta1'||phase==='cta2'||phase==='send_content'||phase==='sell'
      ||nextMove.includes('pitch')||nextMove.includes('cta')||purpose.includes('pitch');
    if(pitching){
      warns.push(`Behavioral signal is COOLING (${sig.signalReason}) but strategy is pushing a pitch — match his lower energy, don't push through cooling`);
    }
  }

  // 12. v0.4.1.2: FRAME-HOLD validator
  // If session shows zero investment + transactional behavior + AI is pitching,
  // flag it. This is the vending-machine drift — pitching here kills future LTV.
  try {
    const inv=detectInvestmentSignals(session);
    const aiMsgCount=session?.messages?.filter(m=>m.sender==='model').length||0;
    const lifetimeSpend=parseFloat((session?._profile?.total_spend||session?.total_spend||0).toString().replace(/[$,]/g,''))||0;
    if(inv.count===0&&aiMsgCount>=3&&lifetimeSpend===0){
      const pitching=phase==='cta1'||phase==='cta2'||phase==='send_content'||phase==='sell'
        ||nextMove.includes('pitch')||nextMove.includes('cta')||purpose.includes('pitch');
      if(pitching&&strategy.frame_hold_active!==true){
        warns.push(`Zero investment signals after ${aiMsgCount} AI msgs but strategy is pitching — this is vending-machine drift. Frame-hold required: playful tease that makes him chase, not a pitch.`);
      }
    }
  } catch(e){ /* detector failure = non-fatal, skip */ }

  // 13. v0.4.1.5: PERSUASION-CAP validator
  // If 3+ pitch attempts on the current rung have failed (ladder closed for session),
  // strategy must NOT continue pitching. Posture system already forces TIMEWASTER,
  // but this validator catches cases where the strategy generation ignored the
  // posture override and tried to pitch anyway.
  try {
    if(session&&session.messages&&session.messages.length>0){
      let rungStart=0;
      for(let i=session.messages.length-1;i>=0;i--){
        if(session.messages[i].sender==='ppv'&&session.messages[i].opened===true){
          rungStart=i+1;
          break;
        }
      }
      let rungAttempts=0;
      const pitchPhases=['cta1','cta2','sell','send_content'];
      for(let i=rungStart;i<session.messages.length;i++){
        const m=session.messages[i];
        if(m.sender==='ppv') rungAttempts++;
        else if(m.sender==='model'&&m.phase&&pitchPhases.includes(m.phase)) rungAttempts++;
      }
      if(rungAttempts>=3){
        const pitching=phase==='cta1'||phase==='cta2'||phase==='send_content'||phase==='sell'
          ||nextMove.includes('pitch')||nextMove.includes('cta')||purpose.includes('pitch');
        if(pitching){
          warns.push(`Persuasion cap exhausted (${rungAttempts} attempts on current rung, no conversion) — ladder closed for session. Strategy must NOT continue pitching. Posture should be TIMEWASTER (stay warm, go short) and goodbye framework should run when conversation reaches natural close.`);
        }
      }
    }
  } catch(e){ /* detector failure = non-fatal, skip */ }

  // 14. v0.4.1.5: GOODBYE-CAP validator
  // If goodbye phase has run for 4+ AI messages, the session should be closing.
  // Strategy must not continue generating goodbye-phase messages beyond the cap.
  try {
    if(session&&session.messages&&session.messages.length>0){
      let goodbyeMsgs=0;
      for(let i=session.messages.length-1;i>=0;i--){
        const m=session.messages[i];
        if(m.sender!=='model') continue;
        if(m.phase==='goodbye'||m.phase==='close'){
          goodbyeMsgs++;
        } else {
          break;
        }
      }
      if(goodbyeMsgs>=4 && (phase==='goodbye'||phase==='close')){
        warns.push(`Goodbye phase has run ${goodbyeMsgs} consecutive AI messages — exceeds 4-message cap. Session should be treated as closed. Don't generate further goodbye beats; one final warm exit line ("rest well 💕" / "talk soon 😌") and end.`);
      }
    }
  } catch(e){ /* detector failure = non-fatal, skip */ }

  return warns;
}

function validateStrategy(strategy,session,ladderState){
  const violations=[];
  const cs=parseInt(strategy.customer_sexual_level);
  const ce=parseInt(strategy.customer_emotional_level);
  const ts=parseInt(strategy.creator_target_sexual_level);
  const te=parseInt(strategy.creator_target_emotional_level);

  // Any NaN on the four levels = schema failure, flag explicitly
  if(isNaN(cs)) violations.push('customer_sexual_level missing or non-integer');
  if(isNaN(ce)) violations.push('customer_emotional_level missing or non-integer');
  if(isNaN(ts)) violations.push('creator_target_sexual_level missing or non-integer');
  if(isNaN(te)) violations.push('creator_target_emotional_level missing or non-integer');

  // Compute pre-PPV ceiling early — feeds both calibration and cap rules below
  const totalSpend=parseFloat((session?.total_spend||0).toString().replace(/[$,]/g,''))||0;
  const preFirstPpvCap=(totalSpend===0)?5:null;
  // v0.4.4.4 (live stress-test): frame-hold is the sanctioned exception to the calibration
  // floors. Deflecting a vending-machine attempt MEANS under-matching his heat (sexual 0-1
  // vs his 4-6) with light playful warmth (emotional 1-2 vs his 0). Without this flag the
  // calibration validators rejected every correct frame-hold strategy → full retry every
  // turn (+$0.04 +30s, 100% repro on zero-investment sexual demands).
  const frameHoldActive=strategy.frame_hold_active===true||strategy.frame_hold_active==='true';

  // Sexual calibration
  if(!isNaN(ts)&&!isNaN(cs)){
    if(ts>cs) violations.push('creator_target_sexual_level ('+ts+') is above customer_sexual_level ('+cs+') — creator cannot lead sexually');
    // v0.3.0.30_2: 'more than 2 below' rule yields to pre-PPV cap. If cap forces
    // creator below cs-2, that's correct doctrine, not drift. Only flag if creator
    // is below BOTH cs-2 AND the cap.
    // Frame-hold exemption: deliberately under-matching his heat IS the doctrine
    // (PART 5: match the TEMPO, not the SUBSTANCE). See frameHoldActive above.
    if(cs>0&&ts<cs-2&&!frameHoldActive){
      const acceptableFloor=preFirstPpvCap!==null?Math.min(cs-2,preFirstPpvCap):cs-2;
      if(ts<acceptableFloor) violations.push('creator_target_sexual_level ('+ts+') is more than 2 below customer_sexual_level ('+cs+') — reads as dry, ignores his intent');
    }
    if(cs===0&&ts>0) violations.push('customer_sexual_level is 0 but creator_target_sexual_level is '+ts+' — do not manufacture sexuality from nothing');
  }

  // Emotional calibration
  if(!isNaN(te)&&!isNaN(ce)){
    // Frame-hold latitude: playful deflection carries light warmth (te 1-2) over a
    // transactional customer reading ce=0 — that's the deflection working, not drift.
    // Cap the latitude at 2 so frame-hold can't justify real emotional investment.
    if(te>ce&&!(frameHoldActive&&te<=2)) violations.push('creator_target_emotional_level ('+te+') is above customer_emotional_level ('+ce+')');
    // v0.3.0.35: 'more than 2 below' rule yields to depth-gate cap. If the gate
    // forces creator_emo at 4 and customer is at 7+, that's correct doctrine
    // (don't get emotionally deep with $0 spenders), not drift. Mirror the
    // sex-level / pre-PPV-cap pattern from v0.3.0.32.
    if(ce>0&&te<ce-2){
      const depthGated=strategy._depthGated===true;
      const acceptableFloor=depthGated?Math.min(ce-2,4):ce-2;
      if(te<acceptableFloor) violations.push('creator_target_emotional_level ('+te+') is more than 2 below customer_emotional_level ('+ce+')');
    }
    if(ce===0&&te>0&&!(frameHoldActive&&te<=2)) violations.push('customer_emotional_level is 0 but creator_target_emotional_level is '+te);
  }

  // Pre-first-PPV cap: only applies when total_spend is exactly 0
  if(preFirstPpvCap!==null&&!isNaN(ts)&&ts>preFirstPpvCap){
    violations.push('creator_target_sexual_level ('+ts+') exceeds pre-first-PPV cap of '+preFirstPpvCap);
  }

  // Power position
  if(strategy.power_position_check&&String(strategy.power_position_check).toLowerCase().startsWith('weakens')){
    violations.push('power_position_check is "weakens" — rewrite next_move to preserve position');
  }

  // Skeleton step must be one of the nine valid names
  const validSteps=['Warm Welcome','Chit Chat','Yes Flow','CTA 1','Promise Ritual','Send Content','CTA 2','Objection Handling','Aftercare'];
  if(!validSteps.includes(strategy.skeleton_step)){
    violations.push('skeleton_step "'+strategy.skeleton_step+'" is not a valid step name — must be one of: '+validSteps.join(', '));
  }

  // Pass B field validation
  const validWalls=['none','objection','soft_no','ppv_missed'];
  if(strategy.wall_detected!==undefined && !validWalls.includes(strategy.wall_detected)){
    violations.push('wall_detected "'+strategy.wall_detected+'" is not valid — must be: '+validWalls.join(', '));
  }
  const validMoves=['continue_climb','run_objection_solve','percival_aftercare_ladder_stop','percival_aftercare_aftersex','goodbye_script','exclusive_custom_framing','manager_flag','run_story_framework','run_promise_ritual','run_promise_reinforcement'];
  if(strategy.next_move_after_wall!==undefined && !validMoves.includes(strategy.next_move_after_wall)){
    violations.push('next_move_after_wall "'+strategy.next_move_after_wall+'" is not valid — must be: '+validMoves.join(', '));
  }
  // Consistency check: if wall_detected is soft_no, next_move must be percival or goodbye — not continue_climb
  if(strategy.wall_detected==='soft_no' && strategy.next_move_after_wall==='continue_climb'){
    violations.push('wall_detected is soft_no but next_move_after_wall is continue_climb — a soft-no is a wall, route to percival_aftercare_ladder_stop (if he has spent) or goodbye_script (if never spent)');
  }
  // Consistency check: if wall_detected is objection, next_move must be run_objection_solve or manager_flag
  if(strategy.wall_detected==='objection' && !['run_objection_solve','manager_flag','percival_aftercare_ladder_stop'].includes(strategy.next_move_after_wall)){
    violations.push('wall_detected is objection but next_move_after_wall is "'+strategy.next_move_after_wall+'" — must be run_objection_solve, manager_flag (after 3-4 failed redirections), or percival_aftercare_ladder_stop (if objection solved but next PPV still misses)');
  }
  // Consistency check: if wall_detected is ppv_missed, next_move must be exclusive_custom_framing or aftercare (if manually toggled)
  if(strategy.wall_detected==='ppv_missed' && !['exclusive_custom_framing','percival_aftercare_ladder_stop','percival_aftercare_aftersex'].includes(strategy.next_move_after_wall)){
    violations.push('wall_detected is ppv_missed but next_move_after_wall is "'+strategy.next_move_after_wall+'" — must be exclusive_custom_framing (never-done-before + tip-what-you-can) since no more standard PPVs are allowed this session after a miss');
  }

  // Pass C consistency checks — forcing moves
  // run_story_framework requires Case 5 stuck lurker AND no active wall.
  // v0.4.4.4 (live stress-test finding): an AGENT OVERRIDE explicitly directing the story
  // framework ("run story framework" in the context box) WINS over the case_5 auto-gate —
  // same precedence as TW-lockout / persuasion-cap (PART 6 GUARD 6). Without this exemption
  // the agent's command produced story CONTENT but the formal move stayed continue_climb, so
  // the 9-beat state machine never engaged. The wall guard still holds (a real objection/miss
  // takes precedence over any forcing move, override or not).
  const agentOverrideActive=strategy.agent_override_active===true||strategy.agent_override_active==='true';
  if(strategy.next_move_after_wall==='run_story_framework'){
    if(strategy.sell_vs_hold_read!=='case_5_nice_never_spends_always_there' && !agentOverrideActive){
      violations.push('next_move_after_wall is run_story_framework but sell_vs_hold_read is "'+strategy.sell_vs_hold_read+'" — story framework is only for case_5_nice_never_spends_always_there (stuck lurkers, nice + never spent + always there excusing). If an agent directed it, set agent_override_active:true.');
    }
    if(strategy.wall_detected&&strategy.wall_detected!=='none'){
      violations.push('next_move_after_wall is run_story_framework but wall_detected is "'+strategy.wall_detected+'" — walls take precedence over forcing moves, route to the correct wall handler instead');
    }
  }
  // v0.4.4.2: buildup-only models have no ritual/reinforcement moves, so ALL promise validators
  // are skipped for them. The brain is told (in the schema) not to pick promise moves, and the
  // enforcement site converts any stray promise move to continue_climb as a safety net.
  if((session&&session._promiseMode)!=='buildup_only'){
  // run_promise_ritual requires not_started/in_progress/verbally_committed AND no active wall
  if(strategy.next_move_after_wall==='run_promise_ritual'){
    const sessionPromiseStatus=(session&&session._promiseStatus)||'not_started';
    if(sessionPromiseStatus==='complete'||sessionPromiseStatus==='reinforcement'||sessionPromiseStatus==='assumed'){
      violations.push('next_move_after_wall is run_promise_ritual but session promise_status is "'+sessionPromiseStatus+'" — ritual already done. Use run_promise_reinforcement (for reinforcement state) or continue_climb (for assumed state) instead');
    }
    if(strategy.wall_detected&&strategy.wall_detected!=='none'){
      violations.push('next_move_after_wall is run_promise_ritual but wall_detected is "'+strategy.wall_detected+'" — walls take precedence, route to the correct wall handler');
    }
    // v0.4.1.5: BREADCRUMB-ANCHOR GATE — opener firing for PPV1 (status=not_started)
    // requires a breadcrumb_reaction signal so the trust ask has something concrete
    // to be about. Without an anchor the opener reads as "out of nowhere" and breaks
    // immersion (Spencer/bartender bug, 2026-05-12). Only gates the FIRST fire —
    // in_progress and verbally_committed states are already mid-ritual.
    if(sessionPromiseStatus==='not_started'){
      try {
        const inv=detectInvestmentSignals(session);
        const hasBreadcrumbReaction=inv.signals.some(x=>x.type==='breadcrumb_reaction');
        if(!hasBreadcrumbReaction){
          violations.push('next_move_after_wall is run_promise_ritual and promise_status is not_started, but no breadcrumb_reaction signal has been detected yet (signals so far: '+(inv.signals.map(x=>x.type).join(', ')||'none')+'). The opener needs a specific scene/anchor to be about. Drop a breadcrumb tied to specific content first, wait for him to react substantively, THEN run the ritual. Use continue_climb or stay in rapport/breadcrumb this turn.');
        }
      } catch(e){ /* detector failure = non-fatal, skip */ }
    }
  }
  // run_promise_reinforcement requires reinforcement state AND no active wall
  if(strategy.next_move_after_wall==='run_promise_reinforcement'){
    const sessionPromiseStatus=(session&&session._promiseStatus)||'not_started';
    if(sessionPromiseStatus!=='reinforcement'){
      violations.push('next_move_after_wall is run_promise_reinforcement but session promise_status is "'+sessionPromiseStatus+'" — reinforcement only fires when promise_status=reinforcement (PPV1 already landed). Use run_promise_ritual (not_started/in_progress) or continue_climb (assumed) instead');
    }
    if(strategy.wall_detected&&strategy.wall_detected!=='none'){
      violations.push('next_move_after_wall is run_promise_reinforcement but wall_detected is "'+strategy.wall_detected+'" — walls take precedence, route to the correct wall handler');
    }
  }
  } // end buildup-only guard for promise validators

  // v0.4.3.0 — V2 LADDER STATE VALIDATORS (whale + pause-pitching + percival)
  // These hard-validate that the strategy respects the V2 signals computed from
  // session state. Soft warnings would be insufficient — these failures cascade
  // into wrong creator behavior at runtime (pitching during devotion, clamping
  // emo right after first PPV, vending-machine treatment of whale candidates).
  if(ladderState){
    const skel=String(strategy.skeleton_step||'');
    const phaseL=String(strategy.phase||'').toLowerCase();
    // v0.4.4.4 (live stress-test): pitching is detected from STRUCTURED fields only.
    // The old predicate sniffed the free-text next_move/message_purpose for the
    // substring "pitch" — which matched NEGATIONS ("hold frame, do NOT pitch",
    // "deflect instead of pitching"), so every correct frame-hold/pause-pitch
    // strategy was flagged as pitching and re-run. The validator literally told it
    // "Set skeleton_step to Chit Chat" while skeleton_step WAS Chit Chat (100% repro).
    // skeleton_step + phase are the enforced contract the generator executes — they
    // are the truth about whether this turn pitches.
    const isPitching=
      ['CTA 1','CTA 2','Send Content','Promise Ritual'].includes(skel)
      ||['cta1','cta2','send_content','sell'].includes(phaseL);

    // 15. PAUSE-PITCHING violation
    if(ladderState.pausePitching && isPitching){
      violations.push('pause-pitching mode is ON ('+(ladderState.pauseReason||'unknown reason')+') but strategy is pitching (skeleton_step='+skel+', phase='+phaseL+'). Generator must NOT advance the skeleton this turn — sit in the emotional beat. Set skeleton_step to Chit Chat or Yes Flow, lower creator_target_sexual_level, and pursue connection deepening instead.');
    }

    // 16. WHALE BUILD-A-WHALE: aggressive pitch into whale-candidate signal kills LTV
    if(ladderState.whaleSignal && ladderState.whaleSignal.doctrine==='BUILD_A_WHALE'){
      const ts=parseInt(strategy.creator_target_sexual_level)||0;
      if(isPitching && ts>=4){
        violations.push('whale-candidate signal active ('+ladderState.whaleSignal.reason+') but strategy is pushing creator_target_sexual_level='+ts+' with a pitch — this is max-extract treatment of a future whale. Build-a-whale doctrine: deeper rapport, longer horizon, no aggressive pitch this turn. Lower sexual level and pivot to connection deepening.');
      }
    }

    // 17. PERCIVAL no-clamp: post-first-PPV window must NOT downgrade creator emo
    if(ladderState.recentFirstPpv){
      const te=parseInt(strategy.creator_target_emotional_level)||0;
      const ce=parseInt(strategy.customer_emotional_level)||0;
      if(ce>=6 && te<ce-2){
        violations.push('Percival window active (recent first-PPV within last 4 msgs) — depth gate is BYPASSED. Customer is at emotional level '+ce+' but strategy set creator_target_emotional_level='+te+'. Match his depth — he earned it by paying. Lift creator_target_emotional_level to within 1-2 of his.');
      }
    }
  }

  return violations;
}

function clampStrategyByPosture(strategy,posture){
  if(posture==='TIMEWASTER'){
    strategy.creator_target_sexual_level=Math.min(parseInt(strategy.creator_target_sexual_level)||0,2);
    strategy.creator_target_emotional_level=Math.min(parseInt(strategy.creator_target_emotional_level)||0,2);
    strategy._clampedBy='TIMEWASTER posture — capped at 2';
  } else if(posture==='PRESSURE'){
    strategy._postureNote='PRESSURE posture active — one real offer window';
  }
  return strategy;
}

function clampStrategyByDepthGate(strategy,cappedTrust,ladderState){
  // Percival fix: post-first-PPV re-engagement window bypasses the depth gate.
  // If he just paid for the first time in the last 4 messages, re-anchor upward —
  // do NOT cap his emotional depth. He earned it.
  if(ladderState&&ladderState.recentFirstPpv){
    strategy._depthGateBypass='recent_first_ppv';
    return strategy;
  }
  if(cappedTrust<4){
    strategy.creator_target_emotional_level=Math.min(parseInt(strategy.creator_target_emotional_level)||0,4);
    strategy._depthGated=true;
  }
  return strategy;
}

// v0.3.0.29: register-match floor. Enforces the "no more than 2 below customer"
// rule deterministically, since the LLM was producing 8/4 calibrations on
// transactional openers and not self-correcting on retry. Doctrine: chatter holds
// her register slightly below his to preserve power, but matching too far below
// reads as dry / ignoring his intent. Floor is customer_level - 2.
// Runs AFTER posture and depth-gate clamps so TIMEWASTER cap (2) and depth-gate
// cap (emo only) take precedence — this only LIFTS sex level if it's too low,
// never overrides the suppressing clamps.
function clampStrategyByRegisterMatch(strategy,posture,session){
  if(posture==='TIMEWASTER') return strategy; // TW clamp already capped at 2
  const cs=parseInt(strategy.customer_sexual_level)||0;
  const ts=parseInt(strategy.creator_target_sexual_level)||0;

  // v0.3.0.30_2: pre-first-PPV cap is the harder constraint and wins.
  // For $0-spend customers, max creator_sex is 5 (validator rule line ~2510).
  // We don't lift above this even if customer_sex is 8+. Doctrine: don't match
  // his heat for free — that's the entire chase economy.
  const totalSpend=parseFloat((session?.total_spend||0).toString().replace(/[$,]/g,''))||0;
  const sexCeiling=(totalSpend===0)?5:10;

  // v0.3.0.32: downward enforcement. The LLM frequently produces creator_sex
  // above the pre-PPV cap (it sees a hot customer and matches up). We lower it
  // deterministically here so the validator passes on first try, killing the retry.
  if(ts>sexCeiling){
    strategy.creator_target_sexual_level=sexCeiling;
    strategy._registerMatched=`lowered creator_sex from ${ts} to ${sexCeiling} (pre-PPV cap)`;
  }

  // Re-read after possible lowering, before checking the floor
  const tsAfterCap=parseInt(strategy.creator_target_sexual_level)||0;
  if(cs>0&&tsAfterCap<cs-2){
    const target=Math.min(cs-2,sexCeiling);
    if(target>tsAfterCap){
      strategy.creator_target_sexual_level=target;
      strategy._registerMatched=(strategy._registerMatched?strategy._registerMatched+'; ':'')+`lifted creator_sex from ${tsAfterCap} to ${target} (customer at ${cs}${totalSpend===0?', capped by pre-PPV ceiling':''})`;
    }
  }
  // Same floor for emotional, but skip if depth-gate already capped at 4
  // (depth gate is a HARDER constraint — protects the don't-go-deep doctrine for low-spenders)
  if(!strategy._depthGated){
    const ce=parseInt(strategy.customer_emotional_level)||0;
    const te=parseInt(strategy.creator_target_emotional_level)||0;
    if(ce>0&&te<ce-2){
      strategy.creator_target_emotional_level=ce-2;
      strategy._registerMatched=(strategy._registerMatched?strategy._registerMatched+'; ':'')+`lifted creator_emo from ${te} to ${ce-2}`;
    }
  }
  return strategy;
}

// ── PASS B: WALL-HANDLING DOCTRINE ────────────────────────────────
// Computes the real-time wall state from messages + spend history so the
// strategy prompt can branch: post-purchase keep-climb vs ladder-stop vs
// missed-PPV lock vs soft-no branching. Called before strategy generation.

function computeWallState(s){
  const allMsgs=s.messages||[];
  // Session-boundary filter: if session was closed (aftercare completed / goodbye ran / manual close),
  // wall state only considers messages AFTER the close. Prior session is cold data.
  // Messages have a display-format ts like "3:36 PM" which we can't compare reliably — so we use
  // message array position: find the last message at or before _sessionClosedAt by iteration,
  // and treat everything after that index as current session.
  // Simpler approach: stash msg array length at the time of close in a sibling field so we can slice.
  // But for now, use the pragmatic approach: if _sessionClosedAt is set, find the first msg whose
  // ts occurred after the close. Since ts is a display string, we fall back to "boundary = array
  // position at close time" stored in _sessionClosedAtMsgCount.
  let boundaryIdx=0;
  // Use the day-boundary marker regardless of whether session is currently "open" or "closed".
  // The boundary is set at close time and never un-set — reopening is just a visibility toggle.
  // Once a day ends, yesterday's miss-lockouts don't time-travel back into today.
  if(typeof s._sessionClosedAtMsgCount==='number'){
    boundaryIdx=s._sessionClosedAtMsgCount;
  }
  const msgs=allMsgs.slice(boundaryIdx);
  const spend=parseFloat((s.total_spend||0).toString().replace(/[$,]/g,''))||0;
  const profile=s._profile||{};
  // v0.4.4.0: effective lifetime spend = PPV + tips (tips scale the ladder like PPV money).
  const lifetimeSpend=effectiveLifetimeSpend(profile,s);
  // Session tips — combined with opened-PPV count below to derive sessionHasSpend.
  const sessionTips=parseMoney(s.tips_spend);

  // PPV-missed detection: any PPV message in this session that is not marked opened = miss
  // Rule: once ANY PPV sent this session goes unopened, lock out standard pitches for rest of session.
  let ppvSentCount=0;
  let ppvMissedCount=0;
  let lastPpvOpened=null; // null if no PPV, true/false otherwise
  for(const m of msgs){
    if(m.sender==='ppv'){
      ppvSentCount++;
      if(m.opened!==true) ppvMissedCount++;
      lastPpvOpened=(m.opened===true);
    }
  }
  // A miss only "counts" as a ladder-stop trigger if the last PPV in the convo is unopened
  // AND there have been customer messages after it (gave him the chance and he moved on).
  let ppvMissedAfterChance=false;
  if(ppvSentCount>0){
    // Find index of last PPV
    let lastPpvIdx=-1;
    for(let i=msgs.length-1;i>=0;i--){
      if(msgs[i].sender==='ppv'){lastPpvIdx=i;break;}
    }
    if(lastPpvIdx>=0 && msgs[lastPpvIdx].opened!==true){
      // v0.4.4.3: a PPV sitting unopened is NOT a miss until we've actually WORKED it.
      // Manager: "miss-lock was firing after the first message following his reply. Some
      // customers need 1-2 more messages to pay — I wouldn't call it a miss until 3 generated
      // messages from our side. If he doesn't open it automatically, we induce/persuade him
      // to open it before the lock fires." So the trigger is now OUR persuasion attempts, not
      // his replies. Each model message after the unopened PPV is one attempt to get him to
      // open it (the brain is in ppv_pending / make-him-open-it mode the whole time). Only
      // after MISS_PERSUASION_WINDOW of our messages without an open do we confirm the miss
      // and lock out standard PPVs.
      const MISS_PERSUASION_WINDOW=3;
      let ourMsgsSince=0;     // our generated persuasion messages after the unopened PPV
      let customerMsgsSince=0; // his replies after it (sanity floor — he's engaging, not silent)
      for(let i=lastPpvIdx+1;i<msgs.length;i++){
        if(msgs[i].sender==='model') ourMsgsSince++;
        else if(msgs[i].sender==='customer') customerMsgsSince++;
      }
      // Miss confirmed only after we've spent the full persuasion window working it and he
      // still hasn't opened — AND he's at least been replying (so it's "ignoring the PPV while
      // chatting", not "went silent", which posture/silence handling covers separately).
      if(ourMsgsSince>=MISS_PERSUASION_WINDOW && customerMsgsSince>=1) ppvMissedAfterChance=true;
    }
  }

  // Purchase count this session (PPVs that DID open)
  const sessionPurchaseCount=ppvSentCount-ppvMissedCount;
  const lastMessageWasPurchase=lastPpvOpened===true && msgs.length>0 && msgs[msgs.length-1].sender==='ppv' && msgs[msgs.length-1].opened===true;
  // v0.4.4.0: session has spend if he opened a PPV OR tipped this session. Drives the
  // Finding #9 anti-exit guard — a session-spender is never goodbye'd on a reply-gap misread.
  const sessionHasSpend=sessionPurchaseCount>0 || sessionTips>0;

  // Sell-vs-hold 5-case classifier (based on lifetime spend + session behavior)
  // Case 1: nice + spends + politely declines → HOLD (aftercare)
  // Case 2: nice + doesn't spend + avoids → PUSH (nice is camouflage)
  // Case 3: not nice + spends + doesn't care → PUSH (money > manners)
  // Case 4: not nice + doesn't spend → PUSH, TW energy
  // Case 5: nice + doesn't spend + always there excusing → PUSH, TW energy
  // Returns hint only — the strategy LLM uses this + last-message read to classify.
  let sellHoldHint;
  if(lifetimeSpend>0) sellHoldHint='has_spent_lifetime';
  else sellHoldHint='never_spent';

  return {
    ppvSentCount,
    ppvMissedCount,
    ppvMissedAfterChance,
    sessionPurchaseCount,
    lastMessageWasPurchase,
    sessionHasSpend,
    sessionTips,
    lifetimeSpend,
    hasEverSpent:lifetimeSpend>0,
    sellHoldHint
  };
}

// ── LADDER TRACKER (drift fix) ─────────────────────────────────
// Computes ladder-climb state from the messages array. Anti-drift:
// the strategy LLM gets explicit memory of (a) last pitch tier,
// (b) messages since last pitch, (c) what move the LLM planned LAST turn,
// so it can either execute that plan or have a wall reason to override it.
// ── FORK DETECTOR (V2) ─────────────────────────────────────────
// Reads the last 2-3 customer messages and classifies the conversation
// fork. Forks are pattern-read signals that override default skeleton
// strategy. Each fork has its own doctrine override injected into the
// strategy prompt. Designed for high-precision (low false-positive) —
// returns null when nothing fires rather than guessing.
//
// Returns: {type, evidence} | null
//   type: 'love_framing' | 'sexual_urgency' | 'deflection' | 'silence_breaker' | 'vending_machine_attempt'
//   evidence: short string explaining why it fired (for logging + diag)
function detectFork(msgs,replyGapMin){
  if(!msgs||!msgs.length) return null;
  // Pull last 3 customer messages (most recent first)
  const custMsgs=[];
  for(let i=msgs.length-1;i>=0&&custMsgs.length<3;i--){
    if(msgs[i].sender==='customer') custMsgs.push(msgs[i]);
  }
  if(!custMsgs.length) return null;
  const last=custMsgs[0];
  const lastText=(last.text||'').toLowerCase().trim();
  if(!lastText) return null;
  // Combined recent customer text (last 3 customer msgs) for context patterns
  const recentText=custMsgs.map(m=>(m.text||'').toLowerCase()).join(' ');

  // ── 1. SILENCE_BREAKER ─────────────────────────────────────
  // Customer's first message after a 24h+ gap. Already partially handled by
  // reply-gap context, but fork makes it explicit so strategy treats it as
  // a re-engagement frame, not a continuation.
  if(typeof replyGapMin==='number'&&replyGapMin>=24*60){
    return {type:'silence_breaker',evidence:`reply gap ${Math.floor(replyGapMin/60)}h`};
  }

  // ── 1.5 VENDING_MACHINE_ATTEMPT (v0.4.1.2) ─────────────────
  // Fires BEFORE sexual_urgency — transactional/demanding heat with zero
  // investment is the vending-machine pattern. Pitching here ruins the frame.
  // Conditions: (a) demanding/transactional tokens in recent messages, (b)
  // zero investment signals from the customer across the whole convo. The
  // strategy should respond with frame-hold (playful tease, qualify him),
  // not pitch.
  const vendingTokens=[
    'show me','send me','send pic','send pics','send a pic','send vid',
    'show tits','show ass','show pussy','show me your','show your',
    'how much','price?','how much for','whats the price','cost','what\'s the cost',
    'just send','can you send','i want to see','wanna see','let me see',
    'naked pics','nudes','boobs','tits','tit pic','show ur'
  ];
  const recentLower=recentText;
  const vendingHits=vendingTokens.filter(t=>recentLower.includes(t));
  if(vendingHits.length>=1){
    // Check investment count from the session — assume parent passes session
    // via a side channel. We re-derive here using the messages array we have.
    const customerMsgs=msgs.filter(m=>m.sender==='customer'&&m.text);
    let invCount=0;
    const found=new Set();
    for(const m of customerMsgs){
      const t=(m.text||'').toLowerCase();
      if(t.length<2) continue;
      if(!found.has('pq')&&(/\bhow are (you|u)\b/i.test(t)||/\bhow('?s| is) (your|ur) day\b/i.test(t)||/\bwhat (do|r|are) (you|u) (do|doing|up to|into)\b/i.test(t)||/\bwhere (are|r) (you|u) from\b/i.test(t)||/\bwhat('?s| is) (your|ur) name\b/i.test(t)||/\btell me (about (you|ur)|something about)\b/i.test(t))){found.add('pq');invCount++;}
      if(!found.has('sd')&&t.length>=20&&!t.includes('?')&&/\b(i|i'?m|i'?ve|my|me)\b/.test(t)&&!/\bsend\b|\bshow\b|\bhow much\b|\bprice\b|\bcost\b/.test(t)){found.add('sd');invCount++;}
      if(!found.has('cb')&&/\b(vibe|energy|funny|smart|sweet|cool|interesting|different|real|genuine|chill|kind)\b/.test(t)){found.add('cb');invCount++;}
    }
    const aiMsgCount=msgs.filter(m=>m.sender==='model').length;
    if(invCount===0&&aiMsgCount>=2){
      return {type:'vending_machine_attempt',evidence:`transactional: "${vendingHits[0]}" with zero investment`};
    }
  }

  // ── 2. LOVE_FRAMING ────────────────────────────────────────
  // Devotion/parasocial-attachment language. Fires on the LAST customer
  // message only (love-framing is too important to be diluted by older
  // context). Words must appear in a context that's about HER, not generic.
  const loveTokens=[
    'i love you','love you so','i miss you','miss you so','you\'re the only',
    'youre the only','only one i','can\'t stop thinking','cant stop thinking',
    'cant get you out','can\'t get you out','you mean so much','obsessed with you',
    'addicted to you','need you','you\'re different','youre different',
    'no one else','feel so connected','you\'re special','youre special',
    'falling for you','feelings for you'
  ];
  for(const t of loveTokens){
    if(lastText.includes(t)){
      return {type:'love_framing',evidence:`"${t}" in last msg`};
    }
  }

  // ── 3. SEXUAL_URGENCY ──────────────────────────────────────
  // Explicit physical/sexual heat. Must be in CURRENT message; older sexual
  // mentions don't count (heat cools fast). Two thresholds: single strong
  // token OR cluster of medium tokens.
  const heatStrong=[
    'i\'m hard','im hard','so hard right now','you\'re making me hard',
    'i\'m wet','im wet','so wet','dripping','throbbing',
    'jerking off','jerking to','stroking to','touching myself',
    'cumming','about to cum','make me cum','i came',
    'fuck you','wanna fuck','want to fuck','need to fuck',
    'inside you','rail you','breed you','wreck you'
  ];
  for(const t of heatStrong){
    if(lastText.includes(t)){
      return {type:'sexual_urgency',evidence:`strong heat: "${t}"`};
    }
  }
  const heatMedium=[
    'turn me on','turning me on','horny','so hot','damn baby','fuck baby',
    'want you','need you bad','ache for','crave','dying to',
    'show me more','let me see','see all of','wanna see you',
    'kiss you','touch you','taste you','feel you'
  ];
  let medCount=0;const medHits=[];
  for(const t of heatMedium){
    if(lastText.includes(t)){medCount++;medHits.push(t);if(medCount>=2)break;}
  }
  if(medCount>=2){
    return {type:'sexual_urgency',evidence:`medium heat cluster: ${medHits.join(', ')}`};
  }

  // ── 4. DEFLECTION ──────────────────────────────────────────
  // Customer flips a question back, refuses to answer, or redirects.
  // Critical doctrine: when this fires, creator MUST flip back in one short
  // line — never answer the original question. This is the move that fails
  // most often in v1 (creator gets philosophical instead of teasing).
  const deflectionPatterns=[
    /^(what|how|why|where|when)\s+about\s+you\??$/,
    /^you\s+tell\s+me/,
    /^you\s+first/,
    /^you\s+go\s+first/,
    /^why\s+do\s+you\s+(ask|wanna|want)/,
    /^(thats|that's)\s+for\s+me\s+to\s+know/,
    /^(im|i'm)\s+not\s+telling/,
    /^not\s+telling\s+you/,
    /^maybe.{0,15}\?$/,
    /\bu\s+too\s+wann?a\b/,
    /\bu\s+too\s+want\b/,
    /\byou\s+too\s+wann?a\b/,
    /\byou\s+too\s+want\b/,
    /\bflip\s+(the|that)\s+(question|one)\b/,
    /^(haha|lol)?\s*(nah|nope|not\s+saying)/
  ];
  for(const p of deflectionPatterns){
    if(p.test(lastText)){
      return {type:'deflection',evidence:`deflection pattern: ${p.source.slice(0,40)}`};
    }
  }
  // Short message ending with "?" right after creator asked a question = likely deflection
  if(lastText.length<25&&lastText.endsWith('?')){
    // Check if previous creator message was also a question
    let prevModelMsg=null;
    for(let i=msgs.length-2;i>=0;i--){
      if(msgs[i].sender==='model'||msgs[i].sender!=='customer'){prevModelMsg=msgs[i];break;}
      if(msgs[i].sender==='customer'){break;}
    }
    if(prevModelMsg&&(prevModelMsg.text||'').trim().endsWith('?')){
      return {type:'deflection',evidence:`short ?-reply to creator's ?`};
    }
  }

  // ── 5. VULNERABILITY_SIGNAL (v0.4.3.1) ─────────────────────
  // Raw emotional vulnerability — depression, isolation, hopelessness, grief.
  // Distinct from love_framing (devotion) — this is NOT about her, it's about
  // his pain. Doctrine: pause-pitching MUST fire. Pitching into "i feel empty
  // / nothing matters" reads predatory and breaks the rapport that LTV depends
  // on. Support first, then over multiple turns the moment converts to depth
  // that earns the next tier — but never in this turn.
  // Strict tokens — false positives kill correct fork classification on the
  // many customers who casually say "rough day".
  const vulnTokensStrong=[
    'feel empty','feeling empty','feel hopeless','no point',
    'nothing matters','nothing means anything','want to give up',
    'cant go on','can\'t go on','feel worthless','feeling worthless',
    'no one cares','nobody cares','have nobody','have no one',
    'completely alone','so alone','really lonely',
    'breaking down','falling apart','at my breaking point',
    'cant cope','can\'t cope','barely holding on'
  ];
  for(const t of vulnTokensStrong){
    if(lastText.includes(t)){
      return {type:'vulnerability_signal',evidence:`strong vulnerability: "${t}"`};
    }
  }
  // Cluster signal: multiple soft vulnerability tokens in last msg
  const vulnTokensSoft=[
    'no one to talk to','nobody to talk to','no one listens','no one understands',
    'everything sucks','really struggling','having a hard time',
    'feel so lost','feeling lost','dont know what to do','don\'t know what to do',
    'rough patch','dark place','depressed','depression','anxious','anxiety',
    'cant sleep','can\'t sleep','havent slept','haven\'t slept'
  ];
  const vulnHits=vulnTokensSoft.filter(t=>lastText.includes(t));
  if(vulnHits.length>=2){
    return {type:'vulnerability_signal',evidence:`vulnerability cluster: ${vulnHits.slice(0,2).join(', ')}`};
  }

  return null;
}

function computeLadderState(s,wallState){
  const msgs=s.messages||[];
  // Find last PPV bubble (pitch landed)
  let lastPpvIdx=-1;
  let lastPpvPrice=null;
  let lastPpvOpened=null;
  for(let i=msgs.length-1;i>=0;i--){
    if(msgs[i].sender==='ppv'){
      lastPpvIdx=i;
      lastPpvPrice=msgs[i].price||null;
      lastPpvOpened=msgs[i].opened===true;
      break;
    }
  }
  // Messages since last pitch (any sender — drift is about beats between pitches)
  const messagesSinceLastPitch=lastPpvIdx>=0?(msgs.length-1-lastPpvIdx):msgs.length;
  // v0.4.1.4: when the last PPV has been OPENED, drift/warmup should measure beats from
  // payment-time, not send-time. Without this, a delayed payment (e.g., customer says
  // "wait let me park", pays a few beats later) skips the post-land warmup window because
  // the counter still reflects beats since send. (feedback item #33 — Josh case)
  let messagesSinceLastPurchase=null;
  if(lastPpvIdx>=0 && msgs[lastPpvIdx].opened===true && typeof msgs[lastPpvIdx]._openedAtMsgIdx==='number'){
    messagesSinceLastPurchase=Math.max(0,msgs.length-msgs[lastPpvIdx]._openedAtMsgIdx);
  }
  // For the drift gates below, when last PPV is opened use the post-payment counter;
  // when last PPV is unopened, fall back to the original send-time counter.
  const driftCounter=(lastPpvIdx>=0 && msgs[lastPpvIdx].opened===true && messagesSinceLastPurchase!==null)
    ? messagesSinceLastPurchase
    : messagesSinceLastPitch;
  // Total PPV count this session
  const pitchCountSession=msgs.filter(m=>m.sender==='ppv').length;
  // Tier the LAST pitch was at (price banding — used for ladder climb logic)
  let lastPitchTier=null;
  if(lastPpvPrice!=null){
    if(lastPpvPrice<10) lastPitchTier='T1';
    else if(lastPpvPrice<18) lastPitchTier='T2';
    else if(lastPpvPrice<35) lastPitchTier='T3';
    else if(lastPpvPrice<60) lastPitchTier='T4';
    else lastPitchTier='T5';
  }
  // Drift signal: too many beats since last pitch without a pitch.
  // Doctrine: 3-4 beats between PPVs. 5+ = drift, 7+ = severe drift.
  // CRITICAL: post-miss, drift signal must NOT stay "ppv_pending" forever.
  // If miss-lockout has fired (wallState.ppvMissedAfterChance) the doctrine
  // switches: no more standard pitches, but every additional message of pure
  // engagement IS still drift — just toward exclusive_custom or goodbye.
  let driftSignal='ok';
  const missLocked=!!(wallState&&wallState.ppvMissedAfterChance);
  if(missLocked){
    // Miss is permanent for this session — drift counter measures wasted post-miss msgs
    if(messagesSinceLastPitch>=5) driftSignal='severe_drift_post_miss';
    else if(messagesSinceLastPitch>=2) driftSignal='drift_post_miss';
    else driftSignal='post_miss';
  } else if(pitchCountSession>0 && !lastPpvOpened){
    // PPV out, awaiting unlock, no miss yet — don't stack
    driftSignal='ppv_pending';
  } else if(pitchCountSession>0 && lastPpvOpened && driftCounter<=3){
    // POST-LAND WARMUP: a PPV just landed and we're inside the 4-beat warmup window.
    // Doctrine: react → deepen → rapport callback → seed. PPV2 setup is FORBIDDEN here.
    // Energy: mirror but ALWAYS softer than him. Never more naughty than the customer.
    // v0.4.1.4: driftCounter resets on payment, so warmup window measures from payment-time
    // not send-time. Fixes Josh case (feedback item #33).
    driftSignal='post_land_warmup';
  } else if(pitchCountSession===0){
    // PRE-FIRST-PPV: drift bias does not apply. Per RLS script (doctrine PART 14) and
    // normal-flow (PART 7), rapport→breadcrumb→promise ritual is signal-gated and
    // takes ~10-12 msgs naturally. Old logic counted every message as "drift since
    // last pitch" because lastPpvIdx was -1, firing severe_drift at msg 7 and forcing
    // the brain to pitch before the RLS arc reached the Promise step (headless-chicken
    // failure mode). Posture + persuasion-cap + investment signals already gate the
    // first sell — drift signal stays out of pre-first-PPV pacing.
    driftSignal='ok';
  } else if(driftCounter>=7){
    driftSignal='severe_drift';
  } else if(driftCounter>=5){
    driftSignal='drift';
  }
  // Recent first PPV signal (Percival fix): set when there's exactly one landed PPV
  // and it landed within the last 4 messages. Bypasses depth gate when true.
  const recentFirstPpv=(pitchCountSession===1 && lastPpvOpened===true && messagesSinceLastPitch<=4);
  // Fork detection (V2): pattern-read signal that overrides default skeleton.
  // Pass reply-gap minutes if available so silence_breaker fork can fire.
  // Fork detection: rule-based detector reads last 3 customer messages for
  // love_framing / sexual_urgency / deflection / silence_breaker patterns.
  // Strict token criteria — false positives cascade into wrong whale signal,
  // wrong pause-pitching, wrong archetype.
  const gapCtx=lastReplyGapContext(msgs);
  const fork=detectFork(msgs,gapCtx?gapCtx.minutesAgo:null);

  // ── WHALE SIGNAL (V2) ────────────────────────────────────────
  // Fires when customer shows over-investment relative to lifetime spend:
  // deep emotional/devotion framing while having spent little (or nothing).
  // Doctrine: flip from max-extract-now to build-a-whale mode — deeper
  // rapport, longer horizon, higher tier asks once trust earns it.
  // Inputs: lifetime spend (from wallState) + emotional intensity (fork +
  // pitch-count-session). A whale candidate is someone who is signaling
  // L4-L5 emotional depth at L1-L2 trust price points.
  const lifetimeSpendNum=wallState&&typeof wallState.lifetimeSpend==='number'?wallState.lifetimeSpend:0;
  let whaleSignal=null;
  if(fork&&fork.type==='love_framing'&&lifetimeSpendNum<30){
    // Strong love-framing at low spend = classic whale-build pattern.
    // Whale candidates spend big over weeks-months, not in the first hour.
    whaleSignal={
      level:lifetimeSpendNum===0?'whale_candidate':'whale_developing',
      reason:`love-framing at $${lifetimeSpendNum} lifetime spend — over-invested relative to dollars`,
      doctrine:'BUILD_A_WHALE'
    };
  } else if(fork&&fork.type==='love_framing'&&lifetimeSpendNum>=250){
    // Love-framing at proven spender = active whale, protect the relationship
    whaleSignal={
      level:'active_whale',
      reason:`love-framing at $${lifetimeSpendNum} lifetime — proven spender in deep emotional state`,
      doctrine:'PROTECT_WHALE'
    };
  }

  // ── PAUSE-PITCHING MODE (V2) ─────────────────────────────────
  // First-class flag (separate from fork) — generator must explicitly check
  // this before any pitch. Triggers on:
  //   (a) fork === love_framing       → pure devotion, no pitch
  //   (b) whaleSignal present         → long-horizon, no pitch this turn
  //   (c) fork === silence_breaker    → re-engage before re-pitch
  //   (d) fork === vending_machine    → frame-hold, no pitch into transactional demand
  //   (e) fork === vulnerability_signal (v0.4.3.1) → support first, never pitch into pain
  // Does NOT trigger on sexual_urgency or deflection — those are pitch-active
  // forks. Sexual urgency is a PRIME pitch window; deflection is a tease move.
  let pausePitching=false;
  let pauseReason=null;
  if(fork&&fork.type==='love_framing'){
    pausePitching=true;
    pauseReason='love_framing fork — connection deepening over CTA';
  } else if(whaleSignal&&whaleSignal.doctrine==='BUILD_A_WHALE'){
    pausePitching=true;
    pauseReason='whale-build mode — long horizon, no transactional pressure';
  } else if(fork&&fork.type==='silence_breaker'){
    pausePitching=true;
    pauseReason='silence_breaker fork — re-engage before re-pitch';
  } else if(fork&&fork.type==='vending_machine_attempt'){
    pausePitching=true;
    pauseReason='vending_machine_attempt fork — frame-hold required, do not pitch into transactional demand';
  } else if(fork&&fork.type==='vulnerability_signal'){
    pausePitching=true;
    pauseReason='vulnerability_signal fork — support first, never pitch into pain';
  }

  // ── PER-RUNG PITCH ATTEMPTS (v0.4.1.5) ───────────────────────
  // A "rung" begins on session start and resets after every successful unlock
  // (opened=true). Within a rung we count PITCH ATTEMPTS — both PPV bubbles
  // sent AND text-only persuasion turns (cta1/cta2/sell/send_content phases
  // where no PPV bubble was sent that turn).
  //
  // Doctrine: 3 attempts per rung max (1 sell + 2 persuasion), resets on buy.
  // If 3 attempts fail to convert, ladder is closed for the session.
  //
  // Find index of last successful purchase (opened ppv). Everything after
  // that index is the current rung. Before any successful purchase, the
  // current rung starts at message 0.
  let currentRungStartIdx=0;
  for(let i=msgs.length-1;i>=0;i--){
    if(msgs[i].sender==='ppv'&&msgs[i].opened===true){
      currentRungStartIdx=i+1;
      break;
    }
  }
  // Count pitch attempts on the current rung. A pitch attempt is:
  //   (a) any PPV bubble sent (whether opened or missed) at index >= rungStart
  //   (b) any AI message at index >= rungStart whose recorded phase is one of
  //       cta1 / cta2 / sell / send_content (these are pitch phases per schema)
  // A single turn with both a PPV bubble AND an AI text doesn't double-count;
  // PPV bubble takes precedence (it's the actual sent content).
  let pitchAttemptsOnCurrentRung=0;
  const pitchPhases=['cta1','cta2','sell','send_content'];
  for(let i=currentRungStartIdx;i<msgs.length;i++){
    const m=msgs[i];
    if(m.sender==='ppv'){
      pitchAttemptsOnCurrentRung++;
    } else if(m.sender==='model'&&m.phase&&pitchPhases.includes(m.phase)){
      pitchAttemptsOnCurrentRung++;
    }
  }
  // Cap is 3. After 3 failed attempts on a single rung, ladder closes for session.
  // Note: if the most recent PPV was OPENED, the rung already reset (currentRungStartIdx
  // moved past it), so this counter would be 0 and ladder is NOT closed — buy resets it.
  const PITCH_CAP_PER_RUNG=3;
  const ladderClosedForSession=(pitchAttemptsOnCurrentRung>=PITCH_CAP_PER_RUNG);

  // ── GOODBYE PHASE COUNTER (v0.4.1.5) ─────────────────────────
  // Once goodbye framework triggers (phase === 'goodbye' or 'close'), count
  // how many AI messages have run in goodbye state. Hard cap of 4 — after
  // that, the session is treated as closed regardless of phase progression.
  // This is the loop guard against goodbye-loops.
  let goodbyePhaseMsgCount=0;
  let goodbyePhaseActive=false;
  for(let i=msgs.length-1;i>=0;i--){
    const m=msgs[i];
    if(m.sender!=='model') continue;
    const ph=m.phase;
    if(ph==='goodbye'||ph==='close'){
      goodbyePhaseActive=true;
      goodbyePhaseMsgCount++;
    } else if(goodbyePhaseActive){
      // Hit a non-goodbye AI msg before the goodbye phase started — stop counting backwards
      break;
    }
  }
  const GOODBYE_CAP=4;
  const goodbyeCapHit=(goodbyePhaseMsgCount>=GOODBYE_CAP);

  return {
    lastPpvIdx,
    lastPitchTier,
    lastPpvPrice,
    lastPpvOpened,
    messagesSinceLastPitch,
    pitchCountSession,
    driftSignal,
    recentFirstPpv,
    fork,
    whaleSignal,
    pausePitching,
    pauseReason,
    // v0.4.1.5: per-rung tracking
    pitchAttemptsOnCurrentRung,
    pitchCapPerRung:PITCH_CAP_PER_RUNG,
    ladderClosedForSession,
    currentRungStartIdx,
    // v0.4.1.5: goodbye phase tracking
    goodbyePhaseActive,
    goodbyePhaseMsgCount,
    goodbyeCapHit,
    nextPlannedMove:s._nextPlannedMove||null,
    nextPlannedMoveAtMsg:s._nextPlannedMoveAtMsg||null
  };
}

// Persist ladder state to Supabase JSONB column. Fire-and-forget.
function persistLadderState(sessionId,ladderState,plannedMove){
  if(!sb) return;
  const payload={
    last_pitch_tier:ladderState.lastPitchTier,
    last_pitch_price:ladderState.lastPpvPrice,
    messages_since_last_pitch:ladderState.messagesSinceLastPitch,
    pitch_count_session:ladderState.pitchCountSession,
    drift_signal:ladderState.driftSignal,
    fork_type:ladderState.fork?ladderState.fork.type:null,
    fork_evidence:ladderState.fork?ladderState.fork.evidence:null,
    whale_level:ladderState.whaleSignal?ladderState.whaleSignal.level:null,
    whale_doctrine:ladderState.whaleSignal?ladderState.whaleSignal.doctrine:null,
    pause_pitching:!!ladderState.pausePitching,
    pause_reason:ladderState.pauseReason||null,
    next_planned_move:plannedMove||ladderState.nextPlannedMove||null,
    next_planned_at_msg:ladderState.nextPlannedMoveAtMsg||null,
    updated_at:new Date().toISOString()
  };
  sb.from('aich_sessions').update({ladder_state:payload}).eq('id',sessionId).then(()=>{}).catch(e=>console.warn('ladder_state persist failed:',e.message));
  // Log fork_detected event when fork fires AND it's a change from last
  // logged fork on this session (dedup: don't spam events for sustained
  // states like silence_breaker that might fire multiple turns in a row).
  if(ladderState.fork){
    const sess=sessions[sessionId];
    const prevFork=sess?sess._lastLoggedFork:null;
    if(prevFork!==ladderState.fork.type){
      if(sess) sess._lastLoggedFork=ladderState.fork.type;
      sb.from('aich_events').insert({
        session_id:sessionId,
        creator_model:sess?sess.creator_model:null,
        customer_username:sess?sess.customer_username:null,
        event_type:'fork_detected',
        payload:{
          fork_type:ladderState.fork.type,
          evidence:ladderState.fork.evidence,
          drift_signal:ladderState.driftSignal,
          msg_count:(sess&&sess.messages)?sess.messages.length:null
        }
      }).then(()=>{}).catch(e=>console.warn('fork event log failed:',e.message));
    }
  } else if(sessions[sessionId]){
    sessions[sessionId]._lastLoggedFork=null;
  }
  // Log whale_signal event with same dedup pattern (only on level change).
  if(ladderState.whaleSignal){
    const sess=sessions[sessionId];
    const prevWhale=sess?sess._lastLoggedWhale:null;
    if(prevWhale!==ladderState.whaleSignal.level){
      if(sess) sess._lastLoggedWhale=ladderState.whaleSignal.level;
      sb.from('aich_events').insert({
        session_id:sessionId,
        creator_model:sess?sess.creator_model:null,
        customer_username:sess?sess.customer_username:null,
        event_type:'whale_signal',
        payload:{
          level:ladderState.whaleSignal.level,
          doctrine:ladderState.whaleSignal.doctrine,
          reason:ladderState.whaleSignal.reason,
          msg_count:(sess&&sess.messages)?sess.messages.length:null
        }
      }).then(()=>{}).catch(e=>console.warn('whale event log failed:',e.message));
    }
  } else if(sessions[sessionId]){
    sessions[sessionId]._lastLoggedWhale=null;
  }
}

// Percival aftercare formula templates — injected into strategy enforcement block
// when aftercare mode is on. Two contexts, one endpoint (warm relationship-register close).
function buildAftercareTemplate(context){
  if(context==='aftersex'){
    return `!! AFTERCARE MODE — POST-SEXTING/CLIMAX VARIANT (Percival formula):
This message is aftercare after a climax/sexting peak. DO NOT pitch. DO NOT sell. DO NOT set up the next PPV.
Three-beat structure:
  1. In-character reaction first — she went there with him, she felt it too. Example openers: "i came that was insane", "damnn all because of me", "that was honestly crazy". Match her persona's voice.
  2. Bridge with a feeling question — pull him from physical peak into emotional register. Example: "how did it feel?", "are you okay?", "tell me what's on your mind right now".
  3. Ease into warm relationship-register close — non-commerce, human, present. Protect the session from overnight regret.
ABSOLUTELY NO: "worth it", "worth every penny", "pay", "paycheck", "here's the link", "open when you get paid", "promise me you'll X", clingy closings, store-voice of any kind.
Message length: short to medium — match his length. Do not monologue.`;
  } else if(context==='ladder_stop'){
    return `!! AFTERCARE MODE — POST-SOFT-NO / LADDER-STOP VARIANT (Percival formula):
Ladder is stopped. DO NOT pitch. DO NOT sell. DO NOT set up the next PPV. The move is to protect his LAST landed purchase from overnight regret.
50 / 25 / 25 structure:
  • 50% positive reinforcement on what he DID spend / share / open up about. Not "thanks for the money" — anchor on the feeling of what happened. Example energy: "you made me feel so seen today", "honestly you're so different from most people here".
  • 25% connection building — callback to something SPECIFIC he mentioned earlier in the convo OR in CRM notes (his work, his dog, his day, his struggle, a preference listed in notes). Real reference, not a generic "how are you". IF NOTHING SPECIFIC EXISTS to callback on (thin convo, empty CRM), SKIP this beat entirely and rebalance to 70% reinforcement / 30% vulnerability. Inventing a callback detail breaks persona and reads as fake — better to skip than fabricate.
  • 25% secret-sharing or small vulnerability — share something that invites him to share back. Something real and persona-consistent, not a pitch setup.
ABSOLUTELY NO: "worth it", "worth every penny", "pay", "paycheck", "here's the link", "open when you get paid", "promise me you'll open when you get paid", "wait before you go", "i wanna know you're thinking of me", any clingy or needy closings, any store-voice.
Endpoint: warm, human, relationship-register close. He goes to sleep feeling good about what he spent. No regret window opens. He wakes up texting her. That's the outcome we reverse-engineer.
Message length: short to medium — do not monologue, do not over-explain.`;
  }
  return '';
}

// ── PASS C: FORCING-MOVE TEMPLATES ─────────────────────────────
// Two multi-message forcing moves that sit inside the LLM routing layer
// (do not override deterministic walls — aftercare and PPV-miss lockout still win).

// Story Framework — 9-beat arc delivered across 3 bursts of ~3 beats each.
// Designed for Case 5 stuck lurkers (nice + never spent + always there).
// Drags the customer through a story about the creator's life until he's
// helping a friend, not buying content. Breaks transactional frame.
function buildStoryFrameworkTemplate(currentStep){
  // currentStep is beats already delivered (0-9). Deliver next 3, capped at 9.
  const start=Math.max(0,Math.min(currentStep,9));
  const end=Math.min(start+3,9);
  const beats=[
    '1. SOFT OPENER — "today something funny/weird happened to me" or equivalent. Low drama, lowers his guard. One short line.',
    '2. TOPIC STATEMENT — where/what context (e.g. "was at the coffee shop near my place", "was on the phone with my cousin"). Sets the scene, no drama yet.',
    '3. DRAMA + FEELING — what went wrong AND how it made her feel (one emotion word). Example shape: "[X happened] and it made me feel kinda [small/annoyed/sad/dumb]".',
    '4. COMMON GROUND HOOK — "do you know what i mean?" / "has that happened to you?" / "tell me im not crazy for feeling like this?". Forces him to engage. End with this question.',
    '5. SURFACE THE PROBLEM — casually, she is CHILL about it. Power position preserved. Not complaining, not helpless. Example energy: "anyway idk ill figure it out, things like that always work out eventually".',
    '6. TRUST ANCHOR — "honestly i feel super safe talking to you like this" / "youre one of the few people i can actually say stuff like this to". Names him as special. One line.',
    '7. PERSONAL QUESTION TIED TO STORY — pulls him into sharing HIS world, linked to the theme (if her story was about being overlooked, ask when he felt overlooked; if it was about being misunderstood, ask about a time he was). Not a generic "how are you". One question.',
    '8. ASK FRAMED AS HELP — "feels wrong to ask but do you think you can help me with [specific small problem from the story]". This is NOT a money ask. It is a favour ask — advice, opinion, perspective, moral support. Something he can give with zero cost. Frame as slightly vulnerable ("feels wrong to ask").',
    '9. MEANING FRAME — "would mean the world to me" / "youre honestly the only person i wanted to ask about this" / "i feel like youd actually get it". Closes the ask with weight. One line.'
  ];
  const burst=beats.slice(start,end);
  const burstLabel=`beats ${start+1} through ${end}`;
  return `!! STORY FRAMEWORK — MULTI-MESSAGE BURST (Pass C P1)
The customer is a Case 5 stuck lurker (nice, never spent, always there excusing). Rapport filler will NOT convert him. The move is to DRAG him through a story about the creator's life until he is helping a friend, not buying content. The story IS the forcing move. The ladder-climb is paused — do NOT pitch, do NOT reference content, do NOT ask a direct "do you want to see X" question.

This turn you are delivering ${burstLabel} of a 9-beat arc as ONE multi-message burst, separated by " - " (space dash space). The agent copy-pastes directly into the CRM, which auto-splits on " - " into separate texts. Each beat = one short message (one sentence, maybe two). The whole burst reads like a rapid-fire series of real texts, not one monologue.

BEATS TO DELIVER THIS TURN:
  ${burst.join('\n  ')}

FORMAT EXAMPLE (beats 1-3 shape):
"okay today was kinda weird - i was at the coffee shop near my apartment - and the barista literally gave me the wrong drink twice and still charged me full price lol"

FORMAT EXAMPLE (beats 4-6 shape):
"like, has that ever happened to you? - where you feel like you cant speak up without being the girl - anyway im chill about it but ngl it's been on my mind - you're honestly one of the few people i feel like i can say this stuff to"

RULES:
- Use " - " as the ONLY separator between beats. No bullet points, no numbers, no quotes, no labels.
- Stay fully in persona voice — lowercase, casual, matches her personality. No emojis unless the model's voice uses them often.
- The story must feel REAL and specific. Generic "had a bad day" energy breaks the spell. Invent concrete details (coffee shop, cousin, class, shift, roommate) that match the persona.
- Do NOT reference content. Do NOT pitch. Do NOT end on a content-related question.
- If this burst includes beat 4 or beat 7, the burst MUST end on that question (the hook forces his reply).
- If this burst includes beat 8, the ask is SMALL — advice, opinion, perspective. NOT money, NOT content, NOT tips. Something he can give with zero cost.
- Keep total burst length reasonable — roughly 3-6 sentences across the beats, not a wall of text.

OUTPUT: ONE string, beats separated by " - ". Nothing else. No preamble, no labels.`;
}

// Promise Ritual — 5-beat micro-script before a Tier 2+ PPV drops.
// By beat 4 the customer has publicly declared trust — opening the PPV
// becomes trust-keep, not transaction. Creator side outputs beats 1-2
// as one " - " burst; wait for customer beats 3-4 before shipping PPV (beat 5).
function buildPromiseRitualTemplate(currentStatus){
  // v0.4.1.5: three-stage template. Status drives WHICH beat the brain writes —
  // not the same boilerplate every time. Fixes the "promise loop" bug where the
  // opener was re-asked after the customer already verbally committed, and the
  // "copy-paste promise" bug where every session got the same "promise this stays
  // between us?" line regardless of what was being kept secret.
  if(currentStatus==='verbally_committed'){
    return `!! PROMISE RITUAL — REINFORCEMENT BEAT (he just committed)
The customer's LAST message contained a trust declaration ("i promise", "between us", "trust me", "show me", or similar). The opener already landed. Engineering has advanced promise_status to VERBALLY_COMMITTED. You are now writing the REINFORCEMENT BEAT — NOT another opener, NOT another ask.

WHAT THIS BEAT DOES:
- Briefly acknowledge that he passed the trust test. Warm, intimate, small. NOT effusive.
- Name what makes the moment feel real for HER — vulnerability, slight nerves, the fact that she doesn't share this with everyone.
- Prime the imminent ship without describing the content. The PPV ships on the NEXT turn.

HARD RULES (loop prevention):
- Do NOT include the words "promise", "secret", "between us", "keep this", "your word", or any re-framed version of the trust ask. He ALREADY agreed — re-asking would shatter the moment and feel robotic.
- Do NOT use the literal phrasings "promise this stays between us" or "promise it will be a secret" — those are the OPENER, which already fired.
- Do NOT generate his next reply.
- Do NOT attach a price, link, or content description. The reinforcement is standalone.

WRITE THIS AS: ONE short line (max ~14 words), persona voice, lowercase. Soft, slightly nervous, intimate. Examples of the SHAPE (do not copy phrasing — write fresh for this customer):
- "okay... i'm a little nervous but i wanna show you 🙈"
- "i don't do this often, hope you know what this means to me"
- "you make it feel safe enough — give me a sec 🤍"
- "i'm trusting you with this, [NAME]"

OUTPUT: ONE short line. Nothing else. No preamble, no labels.`;
  }

  if(currentStatus==='in_progress'){
    return `!! PROMISE RITUAL — IN PROGRESS (opener already fired, no clean commit yet)
The opener has landed but his reply did NOT contain a clean trust-declaration token. This is either (a) a soft deflection that needs ONE counter, or (b) a quiet beat where you hold steady.

DECIDE WHICH ONE:
- SOFT DEFLECTION (playful "i suck at keeping secrets", "lol no way", "what for") → counter ONCE with playful pressure framed as the price of access. Do NOT nag. ONE retry only. After this, doctrine forbids a third ask.
- AMBIGUOUS / SHORT REPLY ("idk", short emoji, off-topic) → hold steady. One warm bridge line that re-anchors the moment without re-asking. The next move comes from his reply.

HARD RULES:
- Maximum ONE soft retry. Do NOT re-ask the promise a third time in this session — Part 4 doctrine treats that as hard refusal and switches posture to TIMEWASTER automatically.
- Do NOT repeat the EXACT phrasing of the original opener. Reframe the same intent (trust as the price of access) in a different shape.
- Do NOT attach a price or content reference.
- Output ONE short line. Persona voice, lowercase, intimate.

OUTPUT: ONE short line. Nothing else.`;
  }

  // not_started — the opener beat. This is where the personalization rules matter most.
  return `!! PROMISE RITUAL — OPENER BEAT (first delivery this session)
You are about to pitch Tier 2+ content. The trust gate must fire first. promise_status is NOT_STARTED — write the OPENER now.

ANCHOR THE TRUST ASK TO SOMETHING SPECIFIC FROM THIS CONVERSATION
The opener is NOT a generic "promise this stays between us?" — that line is a doctrinal reference example, not canon. Every time the brain copies it verbatim across customers, it sounds like a chatbot. Read the last ~6 messages and anchor the promise to ONE of:
- a SCENE she already breadcrumb-dropped (the just-got-home moment, the post-gym vibe, the late-night version of her)
- a PERSONAL detail HE shared (his job, the long week he mentioned, the thing he's nervous about)
- a SPECIFIC moment of warmth between them in this thread (the laugh, the soft turn, the thing he said that made her pause)

If NO specific anchor exists in the recent thread — the breadcrumb is too weak, the scene is unseeded, or the rapport is too thin — DO NOT FIRE THE RITUAL THIS TURN. Drop a breadcrumb first. The opener with no anchor is the "out of nowhere promise" failure mode that breaks immersion (Spencer/bartender bug, 2026-05-12).

WRITE THE OPENER AS ONE multi-message burst, beats 1-2 separated by " - " (space dash space). Beats:
  1. CREATOR — the trust ask, ANCHORED to the specific thing from above. NOT the abstract "secret".
  2. CREATOR — name why THIS specifically feels different / not for everyone. Reference the anchor.

What customer beats 3-4 (his "yes" and trust declaration) look like — DO NOT write them. They come from him organically, and engineering auto-advances the state when his reply arrives.

HARD RULES:
- Two short lines maximum, separated by " - ". Persona voice, lowercase, intimate.
- The opener MUST reference the specific anchor from above. A generic opener that could apply to any conversation = failure mode.
- Do NOT attach a price, link, or content description. The opener is standalone text. PPV ships only AFTER his commit.
- Do NOT use the exact phrasing "promise this stays between us" — that's the reference example, not canon. Write fresh.

OUTPUT: ONE string, two beats separated by " - ". Nothing else.`;
}

// Promise REINFORCEMENT (PPV2+, after first PPV has landed). NOT the full ritual —
// this is a single callback beat that references the existing exclusivity frame
// without forcing the customer to re-commit from scratch. Doctrine: don't burn
// the same ritual twice; reinforce instead.
function buildPromiseReinforcementTemplate(){
  return `!! PROMISE REINFORCEMENT — PRE-PITCH CALLBACK (Pass C P2.5)
You are about to pitch a follow-up Tier 2+ drop. The customer has already gone through the full promise ritual on the first PPV — he committed once, opened, engaged. The frame is established. You do NOT need to re-run the full ritual; you reinforce it with a single callback beat.

PURPOSE: keep the exclusivity frame alive without making him feel like he's re-entering a transaction. The reinforcement reads as "yeah, this stays between us like before" — recognition of the existing trust, not a new ask.

ONE-BEAT REINFORCEMENT (single line, persona voice):
- "remember what you said about keeping this between us... 😌" (callback to ritual beat)
- "tbh this one feels even more personal than last time" (escalation framing — implies first was already trusted)
- "you know how special these are to me" (recognition of established frame)
- "between us like always 🤍" (reinforcement of the secret-frame from PPV1)
- "i wouldn't share this with just anyone — but you've earned it" (doctrine reinforcement: trust is ongoing, not one-time)

RULES:
- Output ONE short line, persona voice. Not a multi-beat burst. Reinforcement is brief and warm.
- Stay fully in persona — lowercase, casual, intimate tone matching the creator.
- Do NOT re-run the full ritual. He already did it. Re-running would feel awkward and transactional.
- Do NOT attach a price or describe content. The reinforcement happens BEFORE the PPV ships.
- Do NOT generate his reply. He doesn't need to re-commit verbally — the frame is already there.
- The reinforcement must feel like a small intimate gesture, not a sales-step.
- THIS IS THE ONLY TIME you reinforce the promise this session — after this it's assumed and never mentioned again. So make it land as warmth, not a checkup. Over-invoking the secret reads as DISTRUST — a customer who already paid and bonded hears "you don't trust me" if you keep bringing it up. If it would feel even slightly repetitive or like you're doubting him, lean toward a warm intimate line that carries the same closeness WITHOUT the literal "keep this between us" (e.g. "this one's just for you 🤍", "i feel so safe with you") — the bond is the point, the reminder is optional.

OUTPUT: ONE short line. Nothing else. No preamble, no labels.`;
}

// Count beats delivered in a multi-message burst response.
// SSAI separates beats with " - " (space dash space). Beats = separators + 1.
// Safety cap: if Claude returned something without separators, assume 1 beat.
function countBeatsDelivered(responseText){
  if(!responseText||typeof responseText!=='string') return 1;
  // Count " - " occurrences (exact separator — flanked by spaces on both sides)
  const matches=responseText.match(/ - /g);
  const separatorCount=matches?matches.length:0;
  return Math.max(1,separatorCount+1);
}

// Decide if a forcing move should fire this turn. Called AFTER strategy runs,
// inside the wall-enforcement routing block. Returns 'story_framework',
// 'promise_ritual', or null. Deterministic walls (aftercare, ppv-miss lockout,
// other wall routes) take precedence — this only fires when the turn would
// otherwise default to continue_climb or when the LLM explicitly picked a
// forcing move via next_move_after_wall.
function computeForcingMove(s,wallState,aftercareActive,strategyJson){
  // Hard overrides — aftercare + PPV miss lockout always win
  if(aftercareActive) return null;
  if(wallState.ppvMissedAfterChance) return null;
  // If LLM routed to a non-climb wall move, it wins (the wall is real)
  const nextMove=strategyJson.next_move_after_wall||'continue_climb';
  const wallMoves=['run_objection_solve','percival_aftercare_ladder_stop','percival_aftercare_aftersex','goodbye_script','exclusive_custom_framing','manager_flag'];
  if(wallMoves.includes(nextMove)) return null;
  // LLM explicitly picked a forcing move — honour it
  if(nextMove==='run_story_framework') return 'story_framework';
  if(nextMove==='run_promise_ritual') return 'promise_ritual';
  // Deterministic fallback: LLM picked continue_climb but conditions are met.
  // Story framework: Case 5 stuck lurker, step < 9
  if(strategyJson.sell_vs_hold_read==='case_5_nice_never_spends_always_there'
     && (s._storyFrameworkStep||0)<9
     && (strategyJson.wall_detected==='none'||!strategyJson.wall_detected)){
    return 'story_framework';
  }
  // Promise ritual: about to pitch and ritual hasn't been run yet for THIS customer.
  // States: not_started → run full ritual. in_progress → continue ritual.
  // complete → ritual done but PPV1 not landed yet (still on first ritual cycle).
  // reinforcement → PPV1 landed; subsequent pitches use lighter callback beat, not full ritual.
  // assumed → 3+ PPVs landed; no ritual or reinforcement needed, just ship.
  const pitchPhases=['cta1','cta2','sell','send_content'];
  const promiseStatus=s._promiseStatus||'not_started';
  const needsFullRitual=promiseStatus==='not_started'||promiseStatus==='in_progress';
  const needsReinforcement=promiseStatus==='reinforcement';
  if(pitchPhases.includes(strategyJson.phase)
     && needsFullRitual
     && (strategyJson.wall_detected==='none'||!strategyJson.wall_detected)){
    return 'promise_ritual';
  }
  if(pitchPhases.includes(strategyJson.phase)
     && needsReinforcement
     && (strategyJson.wall_detected==='none'||!strategyJson.wall_detected)){
    return 'promise_reinforcement';
  }
  return null;
}

// Repair common Claude JSON serialization mistakes: unescaped newlines/tabs/CRLF
// inside string values. Does NOT try to fix unescaped inner double quotes —
// those are genuinely ambiguous; prompt tightening + retry handle those.
function repairStrategyJson(raw){
  let s=raw.trim();
  s=s.replace(/^```json\s*/i,'').replace(/^```\s*/,'').replace(/\s*```$/,'');
  const out=[];
  let inStr=false,escaped=false;
  for(let i=0;i<s.length;i++){
    const c=s[i];
    if(escaped){out.push(c);escaped=false;continue;}
    if(c==='\\'){out.push(c);escaped=true;continue;}
    if(c==='"'){inStr=!inStr;out.push(c);continue;}
    if(inStr&&c==='\n'){out.push('\\n');continue;}
    if(inStr&&c==='\r'){out.push('\\r');continue;}
    if(inStr&&c==='\t'){out.push('\\t');continue;}
    out.push(c);
  }
  return out.join('');
}

// Try JSON.parse → repair → JSON.parse. Returns the object or null on total failure.
function safeParseStrategy(raw){
  try{return JSON.parse(raw);}catch(e){
    console.warn('[STRATEGY PARSE] first JSON.parse failed:',e.message);
    console.warn('[STRATEGY PARSE] raw response was:\n',raw);
  }
  try{
    const repaired=repairStrategyJson(raw);
    console.warn('[STRATEGY PARSE] trying repair. Repaired output:\n',repaired);
    return JSON.parse(repaired);
  }catch(e){
    console.warn('[STRATEGY PARSE] repair JSON.parse also failed:',e.message);
  }
  return null;
}

// ── VN + PPV ───────────────────────────────────────────────────
function renderVns(){
  const vns=sessions[activeId]?.vn_used||[];
  if(!vns.length) return'<span style="font-size:10px;color:var(--text3)">None</span>';
  return vns.map((v,i)=>`<span class="vn-chip">${esc(v)}<button onclick="removeVn(${i})">✕</button></span>`).join('');
}

function addVn(){
  const inp=document.getElementById('vnIn');const val=inp.value.trim();if(!val) return;
  sessions[activeId].vn_used=sessions[activeId].vn_used||[];
  // Dedupe — VN list is customer-scoped now, re-adding the same VN is a no-op
  if(sessions[activeId].vn_used.includes(val)){
    toast(`"${val}" already used for this customer`,'i');
    inp.value='';
    return;
  }
  sessions[activeId].vn_used.push(val);inp.value='';
  document.getElementById('vnWrap').innerHTML=renderVns();
  if(sb) sb.from('aich_vn_used').insert({session_id:activeId,creator_model:sessions[activeId].creator_model,customer_username:sessions[activeId].customer_username,voice_note_label:val}).then(()=>{});
}

function removeVn(i){
  const s=sessions[activeId];if(!s||!s.vn_used||!s.vn_used[i]) return;
  const label=s.vn_used[i];
  s.vn_used.splice(i,1);
  document.getElementById('vnWrap').innerHTML=renderVns();
  // Delete from Supabase — match all rows with this creator+customer+label
  // (there may be multiple inserts across sessions; remove them all to match local state)
  if(sb) sb.from('aich_vn_used').delete()
    .eq('creator_model',s.creator_model)
    .eq('customer_username',s.customer_username)
    .eq('voice_note_label',label).then(()=>{});
}

async function recordPpv(amountArg){
  let raw;
  const fromArg=typeof amountArg==='number'&&!isNaN(amountArg);
  const inp=document.getElementById('ppvAmt');
  if(fromArg){
    raw=amountArg;
  } else {
    raw=parseFloat((inp.value||'').replace(/[$,]/g,''));
    if(!raw||isNaN(raw)){toast('Enter valid amount','e');return;}
  }
  const net=Math.round(raw*0.8*100)/100;
  const s=sessions[activeId];
  const current=parseFloat((s.total_spend||'0').toString().replace(/[$,]/g,''))||0;
  const newTotal=current+net;
  s.total_spend=newTotal;
  // ── PAID ACTION RESET (posture) ──────────────────────────────
  // Single reset block. Fires here for PPV unlocks.
  // togglePpvOpened() calls recordPpv() transitively — do NOT duplicate reset there.
  // TODO: if a dedicated TIP entry point is added later, call this same reset block there.
  // TODO: if a SUB-PURCHASE entry point is added later, call this same reset block there.
  s._freeMsgCount=0;
  s._unpaidCtaCount=0;
  s._pendingCtaCheck=null;
  // v0.4.1.4: reset sexting beat counter on PPV payment (PART 23 BEAT COUNTING).
  // Doctrine: reset on PAID, not on send — fixes Josh case (item #33).
  s._sextingBeatsSinceLastPpv=0;
  if(s._profile) s._profile.total_spend=newTotal;
  s._customerTier=computeCustomerTier(s,s._profile);
  recomputePosture(s);
  if(!fromArg&&inp) inp.value='';
  const chip=document.getElementById('spendChip');
  if(chip) chip.textContent=`$${newTotal.toFixed(2)} spent`;
  updatePostureChip();
  if(sb){
    await sb.from('aich_sessions').update({
      total_spend:newTotal,
      free_msg_count:0,
      unpaid_cta_count:0,
      current_posture:s._posture||'WARM_BUILD'
    }).eq('id',activeId);
    if(s.customer_username){
      await sb.from('customer_profiles').upsert({
        creator_model:s.creator_model,customer_username:s.customer_username,
        total_spend:newTotal
      },{onConflict:'creator_model,customer_username'});
    }
    // Log ppv_landed event for dashboard
    await sb.from('aich_events').insert({
      session_id:activeId,creator_model:s.creator_model,customer_username:s.customer_username,
      event_type:'ppv_landed',payload:{gross:raw,net:net,new_total:newTotal}
    });
    // ── PROMISE STATE MACHINE (lifecycle ladder) ────────────────
    // PPV1 lands: complete → reinforcement (don't re-run ritual on PPV2; use callback beat instead)
    // PPV2 lands: reinforcement → assumed (no more reinforcement needed; just ship)
    // v0.4.4.1: flipped 3→2 so the "keep this between us" callback fires AT MOST ONCE
    // (on PPV2), then goes silent. Customer feedback: repeating the promise reads as
    // distrust ("you don't have to mention the promise every time, it's a turn off").
    // One callback reinforces the frame; two+ insults a customer who already proved trust.
    const landedPpvCount=(s.messages||[]).filter(m=>m.sender==='ppv'&&m.opened===true).length;
    const currentPromise=s._promiseStatus||'not_started';
    let newPromiseStatus=currentPromise;
    // v0.4.4.2: buildup-only models have no promise lifecycle — status stays neutral, never advances.
    if(s._promiseMode!=='buildup_only'){
    if(currentPromise==='complete' && landedPpvCount>=1){
      newPromiseStatus='reinforcement';
    } else if(currentPromise==='reinforcement' && landedPpvCount>=2){
      newPromiseStatus='assumed';
    }
    } // end non-buildup-only promise advancement
    if(newPromiseStatus!==currentPromise){
      s._promiseStatus=newPromiseStatus;
      await sb.from('aich_sessions').update({promise_status:newPromiseStatus}).eq('id',activeId);
      await sb.from('aich_events').insert({
        session_id:activeId,creator_model:s.creator_model,customer_username:s.customer_username,
        event_type:'promise_state_change',payload:{from:currentPromise,to:newPromiseStatus,trigger:'ppv_landed',ppvs_landed:landedPpvCount}
      });
    }
    // Auto-clear TW flag on purchase — he proved he's not TW by spending
    if(s._profile?.is_timewaster===true && s.customer_username){
      await sb.from('customer_profiles').update({
        is_timewaster:false,
        tw_auto_cleared_at:new Date().toISOString()
      })
      .eq('creator_model',s.creator_model)
      .eq('customer_username',s.customer_username);
      await sb.from('aich_events').insert({
        session_id:activeId,creator_model:s.creator_model,customer_username:s.customer_username,
        event_type:'tw_cleared',payload:{trigger:'auto_on_purchase',amount:raw}
      });
      s._profile.is_timewaster=false;
      s._customerTier=computeCustomerTier(s,s._profile);
      recomputePosture(s);
      toast('TW flag auto-cleared (purchase made)','s');
    }
  }
  toast(`+$${net.toFixed(2)} recorded (after 20% fee)`,'s');
}

// ── PPV CAPTION → PRICE MODAL ──────────────────────────────────
function openPpvPriceModal(caption,ts){
  // Close any existing modal first
  closePpvPriceModal();
  const s=sessions[activeId];
  const sug=s._ppvSuggestion;
  const suggested=sug&&!sug.loading&&!sug.error?sug.price:null;
  const reason=sug&&!sug.loading&&!sug.error?sug.reason||'':'';
  const prefill=suggested?String(suggested):'';
  // Suggestion block — handles loading, error, ready, and no-data states
  let suggestionHtml;
  if(sug&&sug.loading){
    suggestionHtml='<div class="ppv-modal-suggestion" style="color:var(--text3);font-style:italic">AI pricing...</div>';
  } else if(sug&&sug.error){
    suggestionHtml=`<div class="ppv-modal-suggestion"><span style="color:var(--red)">AI suggestion unavailable</span> · ${esc(sug.error).slice(0,80)} — enter price manually</div>`;
  } else if(suggested){
    suggestionHtml=`<div class="ppv-modal-suggestion"><b>AI suggestion: $${suggested}</b>${reason?' · '+esc(reason):''}</div>`;
  } else {
    suggestionHtml='<div class="ppv-modal-suggestion" style="color:var(--text3)">No AI suggestion yet — generate a response first for pricing recommendations</div>';
  }
  const modalHtml=`<div class="ppv-modal-bg" id="ppvModalBg" onclick="if(event.target===this)closePpvPriceModal()">
    <div class="ppv-modal">
      <div class="ppv-modal-title">🔒 Set PPV price</div>
      <div class="ppv-modal-sub">Caption will lock at this price until the customer unlocks it</div>
      <div class="ppv-modal-label">Caption</div>
      <div class="ppv-modal-caption">${esc(caption)}</div>
      <div class="ppv-modal-label">Price (gross $)</div>
      <div class="ppv-modal-price-row">
        <span class="ppv-modal-dollar">$</span>
        <input type="text" inputmode="decimal" class="ppv-modal-price-in" id="ppvModalPrice" value="${esc(prefill)}" placeholder="25" autocomplete="off">
      </div>
      ${suggestionHtml}
      <div class="ppv-modal-acts">
        <button class="btn sm" onclick="closePpvPriceModal()">Cancel</button>
        <button class="btn sm primary" style="background:#e6b84d;border-color:#e6b84d;color:#1a1200" onclick="confirmPpvSend()">Send PPV</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',modalHtml);
  // Stash the pending caption+ts on the window so confirm can read it
  window._pendingPpv={caption,ts};
  const pin=document.getElementById('ppvModalPrice');
  if(pin){
    pin.focus();
    pin.select();
    pin.addEventListener('keydown',e=>{
      if(e.key==='Enter'){e.preventDefault();confirmPpvSend();}
      else if(e.key==='Escape'){e.preventDefault();closePpvPriceModal();}
    });
  }
}

function closePpvPriceModal(){
  const bg=document.getElementById('ppvModalBg');
  if(bg) bg.remove();
  window._pendingPpv=null;
}

function confirmPpvSend(){
  const pin=document.getElementById('ppvModalPrice');
  if(!pin) return;
  const price=parseFloat((pin.value||'').replace(/[$,]/g,''));
  if(!price||isNaN(price)||price<=0){toast('Enter a valid price','e');pin.focus();return;}
  const pending=window._pendingPpv;
  if(!pending){closePpvPriceModal();return;}
  // Commit the PPV message with locked state
  sessions[activeId].messages=sessions[activeId].messages||[];
  sessions[activeId].messages.push({
    sender:'ppv',
    text:pending.caption,
    price:Math.round(price*100)/100,
    opened:false,
    ts:pending.ts,
    ts_iso:new Date().toISOString()
  });
  // Pass C: promise state machine — full ritual happens once before PPV1.
  //   PPV1 send: status was 'in_progress' → flips to 'complete' (full ritual done, content shipped).
  //   PPV1 lands (opened): flips 'complete' → 'reinforcement' (he proved by paying; PPV2 gets ONE callback).
  //   PPV2 send: status 'reinforcement' → the single callback beat fires (not a full ritual).
  //   PPV2 lands: flips 'reinforcement' → 'assumed' (v0.4.4.1: 2 lands = trust earned, callback goes silent).
  //   PPV3+ : status 'assumed' — just ship, never mention the promise again this session.
  const s=sessions[activeId];
  const ppvCount=s.messages.filter(m=>m.sender==='ppv').length;
  const currentStatus=s._promiseStatus||'not_started';
  // v0.4.4.2/.4: buildup-only models have no promise lifecycle — status stays untouched.
  // newPromiseStatus MUST be function-scoped (not inside the if) because the Supabase
  // persistence + ppv_pitched event below both read it. (v0.4.4.2 bug: scoping it inside
  // the block threw "newPromiseStatus is not defined" on EVERY PPV send — caught in live
  // stress-test, the Node harness can't reach confirmPpvSend.)
  let newPromiseStatus=currentStatus;
  if(s._promiseMode!=='buildup_only'){
    if(ppvCount===1){
      // First PPV being sent — ritual is complete, content shipping
      newPromiseStatus='complete';
    } else if(currentStatus==='reinforcement'||currentStatus==='assumed'){
      // PPV2+, in active reinforcement loop — stays in current state until lands flip it
      newPromiseStatus=currentStatus;
    } else if(currentStatus==='complete'){
      // Edge case: PPV2 sending while still 'complete' (PPV1 hasn't landed yet) — keep complete
      newPromiseStatus='complete';
    } else {
      // Fallback (not_started or in_progress with PPV2+ — unusual but possible)
      newPromiseStatus='complete';
    }
    s._promiseStatus=newPromiseStatus;
  }
  // v0.4.1.5: apply deferred Pass-C/ladder advances from the PPV draft's generate().
  // PPV-specific promise_status above wins; other fields (story step, planned move,
  // ladder state) need to commit too since the PPV caption shipped.
  const pendingAdv=s._pendingPassCAdvance;
  if(pendingAdv){
    const ssUpdate={};
    if(typeof pendingAdv.storyFrameworkStep==='number'){
      s._storyFrameworkStep=pendingAdv.storyFrameworkStep;
      ssUpdate.story_framework_step=pendingAdv.storyFrameworkStep;
    }
    if(pendingAdv.sessionClosedAt){
      s._sessionClosedAt=pendingAdv.sessionClosedAt;
      s._sessionClosedAtMsgCount=pendingAdv.sessionClosedAtMsgCount;
      ssUpdate.session_closed_at=pendingAdv.sessionClosedAt;
      ssUpdate.session_closed_at_msg_count=pendingAdv.sessionClosedAtMsgCount;
    }
    if(pendingAdv.nextPlannedMove){
      s._nextPlannedMove=pendingAdv.nextPlannedMove;
      s._nextPlannedMoveAtMsg=pendingAdv.nextPlannedMoveAtMsg;
    }
    if(pendingAdv.ladderState && typeof persistLadderState==='function'){
      try{persistLadderState(activeId,pendingAdv.ladderState,pendingAdv.ladderStatePlannedMove);}
      catch(e){console.warn('ladder persist on PPV send failed:',e.message);}
    }
    if(sb && Object.keys(ssUpdate).length){
      sb.from('aich_sessions').update(ssUpdate).eq('id',activeId).then(()=>{});
    }
    s._pendingPassCAdvance=null;
  }
  // Clear input + suggestion + modal
  const inp=document.getElementById('chatTi');
  if(inp){inp.value='';inp.style.height='auto';}
  s._ppvSuggestion=null;
  closePpvPriceModal();
  document.getElementById('chatMsgs').innerHTML=renderBubbles();
  scrollChat();
  // Next expected msg is the customer's reaction
  setSender('customer');
  toast(`PPV sent at $${price} — click bubble when unlocked`,'s');
  try{
    const _s=sessions[activeId];
    const _m=_s&&models.find(m=>m.name===_s.creator_model);
    if(_m&&_m.of_account_id){
      toast('PPV recorded — attach media + send this PPV manually on OnlyFans (auto-send is text-only in v1)','i');
    }
  }catch(e){}
  // Persist messages array + promise status
  if(sb) sb.from('aich_sessions').update({
    messages_input:JSON.stringify(s.messages),
    promise_status:newPromiseStatus
  }).eq('id',activeId).then(()=>{});
  // Log ppv_pitched event for dashboard
  if(sb){
    sb.from('aich_events').insert({
      session_id:activeId,
      creator_model:s.creator_model,
      customer_username:s.customer_username,
      event_type:'ppv_pitched',
      payload:{
        price:Math.round(price*100)/100,
        ppv_count_session:ppvCount,
        promise_status:newPromiseStatus,
        posture:s._posture||null,
        tier:s._customerTier||null
      }
    }).then(()=>{}).catch(e=>console.warn('event log failed:',e.message));
    // v0.4.1.4: also log PPV caption send to aich_messages with was_sent=true so
    // leaderboard drafts/accept_rate include PPV captions (feedback item #21, #22).
    sb.from('aich_messages').insert({
      session_id:activeId,
      creator_model:s.creator_model,
      customer_username:s.customer_username,
      input_messages:JSON.stringify(s.messages),
      agent_note:'PPV_SENT $'+Math.round(price*100)/100,
      response_text:pending.caption,
      api_used:api,
      was_sent:true
    }).then(()=>{}).catch(e=>console.warn('ppv msg log failed:',e.message));
  }
}

async function togglePpvOpened(i){
  const s=sessions[activeId];
  if(!s||!s.messages||!s.messages[i]) return;
  const m=s.messages[i];
  if(m.sender!=='ppv') return;
  const wasOpened=m.opened===true;
  m.opened=!wasOpened;
  // Re-render immediately for snappy feel
  document.getElementById('chatMsgs').innerHTML=renderBubbles();
  // FIRST-OPEN TRACKING: log ppv_landed event ONLY on the first ever open of this bubble.
  // Subsequent re-toggles still adjust spend (so accidental clicks don't permanently inflate
  // total_spend), but they do NOT log new ppv_landed / ppv_unlocked_reversed events to the
  // dashboard. This keeps conversion rates accurate — one bubble = one conversion outcome.
  const isFirstOpen=!wasOpened && !m._everOpened;
  if(!wasOpened&&typeof m.price==='number'&&m.price>0){
    // v0.4.1.4: stamp the message-array length at the moment of opening so the warmup
    // counter (messagesSinceLastPurchase, computed in computeLadderState) measures
    // beats since PAYMENT, not since SEND. Without this, a customer who pays after
    // 4+ pre-payment messages is treated as already in drift, skipping the post-land
    // warmup window. Set on both first-open and re-open. (feedback item #33)
    m._openedAtMsgIdx=(sessions[activeId]?.messages?.length)||0;
    // locked → unlocked transition — adjust spend, log event ONLY if first-ever open
    if(isFirstOpen){
      m._everOpened=true;
      await recordPpv(m.price);
      // Promise state transition on first-open of a PPV
      const landedCount=s.messages.filter(mm=>mm.sender==='ppv'&&mm.opened===true).length;
      const currentStatus=s._promiseStatus||'not_started';
      let newStatus=currentStatus;
      if(landedCount>=3){
        newStatus='assumed';
      } else if(currentStatus==='complete'&&landedCount>=1){
        newStatus='reinforcement';
      }
      if(newStatus!==currentStatus){
        s._promiseStatus=newStatus;
        if(sb){
          await sb.from('aich_sessions').update({promise_status:newStatus}).eq('id',activeId);
        }
      }
    } else {
      // Re-opening a bubble that was opened before — adjust spend silently.
      // v0.4.1.4: We DO log a ppv_landed event here. Previously this branch logged nothing
      // for dashboard purposes, but the prior re-lock DID log ppv_unlocked_reversed.
      // Net effect on dashboard: landed count drops by 1 on re-lock, never comes back when
      // re-opened (feedback item #31 — "PPV count moved backward, doesn't recover"). Logging
      // a new ppv_landed here balances the earlier reversal so net landed reflects net state.
      const raw=m.price;
      const net=Math.round(raw*0.8*100)/100;
      const current=parseFloat((s.total_spend||'0').toString().replace(/[$,]/g,''))||0;
      const newTotal=current+net;
      s.total_spend=newTotal;
      if(s._profile) s._profile.total_spend=newTotal;
      s._customerTier=computeCustomerTier(s,s._profile);
      recomputePosture(s);
      const chip=document.getElementById('spendChip');
      if(chip) chip.textContent=`$${newTotal.toFixed(2)} spent`;
      updatePostureChip();
      if(sb){
        await sb.from('aich_sessions').update({total_spend:newTotal,current_posture:s._posture||'WARM_BUILD'}).eq('id',activeId);
        if(s.customer_username){
          await sb.from('customer_profiles').upsert({
            creator_model:s.creator_model,customer_username:s.customer_username,total_spend:newTotal
          },{onConflict:'creator_model,customer_username'});
        }
        // Log ppv_landed event so leaderboard re-balances after a prior reversal.
        sb.from('aich_events').insert({
          session_id:activeId,creator_model:s.creator_model,customer_username:s.customer_username,
          event_type:'ppv_landed',payload:{gross:raw,net:net,new_total:newTotal,reopen:true}
        }).then(()=>{}).catch(e=>console.warn('event log failed:',e.message));
      }
      toast(`Re-opened — $${net.toFixed(2)} added back`,'i');
    }
  } else if(wasOpened&&typeof m.price==='number'&&m.price>0){
    // unlocked → re-locked. Adjust spend silently AND log a reversal event so dashboard
    // can subtract from landed count. Without this, dashboard shows 2/2 landed even when
    // the second one was toggled back to unopened.
    const raw=m.price;
    const net=Math.round(raw*0.8*100)/100;
    const current=parseFloat((s.total_spend||'0').toString().replace(/[$,]/g,''))||0;
    const newTotal=Math.max(0,current-net);
    s.total_spend=newTotal;
    if(s._profile) s._profile.total_spend=newTotal;
    s._customerTier=computeCustomerTier(s,s._profile);
    recomputePosture(s);
    const chip=document.getElementById('spendChip');
    if(chip) chip.textContent=`$${newTotal.toFixed(2)} spent`;
    updatePostureChip();
    if(sb){
      await sb.from('aich_sessions').update({total_spend:newTotal,current_posture:s._posture||'WARM_BUILD'}).eq('id',activeId);
      if(s.customer_username){
        await sb.from('customer_profiles').upsert({
          creator_model:s.creator_model,customer_username:s.customer_username,total_spend:newTotal
        },{onConflict:'creator_model,customer_username'});
      }
      // Log reversal event so dashboard ppv_landed count subtracts this back out.
      // Without this, "2/2 landed" persists after agent fixes a misclick.
      sb.from('aich_events').insert({
        session_id:activeId,
        creator_model:s.creator_model,
        customer_username:s.customer_username,
        event_type:'ppv_unlocked_reversed',
        payload:{price:raw,net:net,new_total:newTotal}
      }).then(()=>{}).catch(e=>console.warn('event log failed:',e.message));
    }
    toast(`Re-locked — $${net.toFixed(2)} subtracted`,'i');
  }
  if(sb) sb.from('aich_sessions').update({messages_input:JSON.stringify(s.messages)}).eq('id',activeId).then(()=>{});
}

// ── PPV PRICE SUGGESTION (runs with runAnalysis) ───────────────
async function fetchPpvSuggestion(sessionId,msgs,model,profile){
  const s=sessions[sessionId];
  if(!s||!model) return;
  const isActive=()=>sessionId===activeId;
  // Mark as loading so the UI can show a spinner
  sessions[sessionId]._ppvSuggestion={loading:true};
  if(isActive()){
    const card=document.getElementById('ppvSuggestCard');
    if(card) card.outerHTML=renderPpvSuggestCard(sessions[sessionId]._ppvSuggestion);
  }
  try{
    const libraryBlock=model.content_library
      ?`CONTENT LIBRARY (hard source of truth — tier minimums are non-negotiable):\n${model.content_library}`
      :`CONTENT LIBRARY: not loaded for ${model.name}. Use generic OF tier heuristics — Tier 1 solo/tease $15-25, Tier 2 full nude $25-45, Tier 3 explicit solo $40-80, Tier 4 explicit premium $80-200+. Flag that library is missing.`;
    const prompt=`You are pricing a PPV for an OnlyFans creator right now. Return ONLY raw JSON, no markdown.

CREATOR: ${model.name}
CUSTOMER: ${s.customer_name} | Lifetime spend: $${effectiveLifetimeSpend(profile,s)} (PPV+tips) | of which tips: $${parseMoney((profile&&profile.tips_spend)!=null?profile.tips_spend:s.tips_spend)} | Status: ${s.subscription_status||'subscribed'}
CUSTOMER PROFILE: ${profile?`Trust L${profile.trust_level||1}/5, ${profile.archetype||'unknown'} type, temp: ${profile.temperature||'cold'}, ${profile.key_details?profile.key_details.slice(0,300):'no memory yet'}`:'new customer, no history'}

${libraryBlock}

RECENT CONVERSATION:
${msgs.slice(-12).map(m=>{
  if(m.sender==='ppv'){
    return m.opened?`[PPV PURCHASED $${m.price||'?'}]`:`[PPV SENT $${m.price||'?'} — unopened]`;
  }
  return `${m.sender==='customer'?'CUSTOMER':model.name.toUpperCase()}: ${m.text}`;
}).join('\n')}

Based on: (1) the customer's trust level and heat RIGHT NOW in this conversation, (2) the tier of content implied by the recent exchange, (3) the library's tier minimums (or generic heuristics), (4) whether this customer has bought before and at what amounts — recommend ONE price for the next PPV.

Rules:
- Never go below the tier minimum based on avg spend alone
- Whales (trust L4-5, $100+ lifetime) can be priced at tier mid or above
- Cold/untested customers priced near tier minimum
- Return a whole dollar amount (no cents)

Return exactly: {"price":number,"reason":"one short sentence, max 14 words"}`;
    const raw=await callApi('You price OnlyFans PPVs. Return only JSON.',prompt,120,null,'price_ppv');
    const clean=raw.replace(/```json|```/g,'').trim();
    const data=JSON.parse(clean);
    if(!data||typeof data.price!=='number'||data.price<=0){
      throw new Error('Invalid price returned');
    }
    // v0.3.0.37: tier-label sanity check. The LLM occasionally writes a reason
    // referencing a different tier than where the price actually lands
    // (e.g. "Tier 1 minimum" with $25 in the T3 band). Recompute the tier from
    // the price and rewrite contradictory tier references in the reason.
    const price=Math.round(data.price);
    let actualTier;
    if(price<10) actualTier='Tier 1';
    else if(price<18) actualTier='Tier 2';
    else if(price<35) actualTier='Tier 3';
    else if(price<60) actualTier='Tier 4';
    else actualTier='Tier 5';
    let reason=String(data.reason||'').trim();
    // Replace any "Tier N" reference in the reason with the actual tier this price lives in.
    const tierRefPattern=/\bTier\s*[1-9]\b/gi;
    if(tierRefPattern.test(reason)){
      reason=reason.replace(tierRefPattern,actualTier);
    }
    if(!sessions[sessionId]) return;
    // v0.4.1.4 SEXTING PPV MULTIPLIER (PART 23 doctrine, item #7)
    // When sexting is active, mid-scene PPV pricing is a modest premium over standard.
    // Heat carries the premium. The brain's base suggestion is for cold-pitch tier; we
    // bump it here so the agent sees the right suggested price in the PPV modal.
    // v0.4.4.5 (manager directive): dialed back 1.4× → 1.25× — 1.4 read as too aggressive
    // mid-scene; 1.25 keeps the premium without breaking the moment.
    let finalPrice=price;
    let finalReason=reason;
    if(sessions[sessionId]._sextingActive){
      const SEXTING_MULTIPLIER=1.25;
      finalPrice=Math.round(price*SEXTING_MULTIPLIER);
      finalReason=`${reason||'cold-pitch base'} · sexting × ${SEXTING_MULTIPLIER} (base $${price} → $${finalPrice})`;
    }
    sessions[sessionId]._ppvSuggestion={price:finalPrice,reason:finalReason};
  }catch(e){
    console.warn('PPV suggestion failed:',e.message);
    if(!sessions[sessionId]) return;
    sessions[sessionId]._ppvSuggestion={error:e.message||'fetch failed'};
  }
  // Always re-render card AND update any open modal
  if(isActive()){
    const card=document.getElementById('ppvSuggestCard');
    if(card) card.outerHTML=renderPpvSuggestCard(sessions[sessionId]._ppvSuggestion);
    // If price modal is open, update its suggestion block + prefill price if empty
    updateOpenPpvModal(sessions[sessionId]._ppvSuggestion);
  }
}

function renderPpvSuggestCard(sug){
  if(!sug) return '<div id="ppvSuggestCard" class="ppv-suggest-card" style="display:none"></div>';
  if(sug.loading){
    return `<div id="ppvSuggestCard" class="ppv-suggest-card">
      <div class="ppv-suggest-head">
        <div class="ppv-suggest-label">🔒 Suggested PPV Price</div>
      </div>
      <div class="ppv-suggest-loading">Pricing...</div>
    </div>`;
  }
  if(sug.error){
    return `<div id="ppvSuggestCard" class="ppv-suggest-card" style="border-color:rgba(240,96,96,0.25)">
      <div class="ppv-suggest-head">
        <div class="ppv-suggest-label" style="color:var(--red)">🔒 PPV Price · unavailable</div>
      </div>
      <div class="ppv-suggest-reason" style="color:var(--text3)">${esc(sug.error).slice(0,100)} — enter price manually</div>
    </div>`;
  }
  return `<div id="ppvSuggestCard" class="ppv-suggest-card">
    <div class="ppv-suggest-head">
      <div class="ppv-suggest-label">🔒 Suggested PPV Price</div>
      <div class="ppv-suggest-amt">$${sug.price}</div>
    </div>
    <div class="ppv-suggest-reason">${esc(sug.reason||'based on customer profile and content tier')}</div>
  </div>`;
}

// If the price modal is open, update its suggestion block live when the fetch resolves
function updateOpenPpvModal(sug){
  const bg=document.getElementById('ppvModalBg');
  if(!bg) return;
  const sugEl=bg.querySelector('.ppv-modal-suggestion');
  const priceIn=document.getElementById('ppvModalPrice');
  if(!sugEl) return;
  if(sug&&sug.price){
    sugEl.innerHTML=`<b>AI suggestion: $${sug.price}</b>${sug.reason?' · '+esc(sug.reason):''}`;
    sugEl.style.color='';
    // Prefill price if agent hasn't typed anything yet
    if(priceIn&&!priceIn.value.trim()){
      priceIn.value=String(sug.price);
      priceIn.select();
    }
  } else if(sug&&sug.error){
    sugEl.innerHTML=`<span style="color:var(--red)">AI suggestion unavailable</span> · ${esc(sug.error).slice(0,80)} — enter price manually`;
  } else if(sug&&sug.loading){
    sugEl.innerHTML=`<span style="color:var(--text3);font-style:italic">AI pricing...</span>`;
  }
}

// ── FLAG ───────────────────────────────────────────────────────
async function toggleFlag(){
  const s=sessions[activeId];
  s.is_flagged=!s.is_flagged;
  if(sb) await sb.from('aich_sessions').update({is_flagged:s.is_flagged}).eq('id',activeId);
  document.getElementById('flagBtn').style.color=s.is_flagged?'var(--red)':'var(--text3)';
  document.getElementById('flagBtn').textContent=s.is_flagged?'Unflag':'Flag';
  renderSidebar();
}

// ── GENERATE ───────────────────────────────────────────────────
// v0.4.4.4 COST RESTRUCTURE (Hans: <$0.10/msg after first). The static ~50KB of the strategy
// user prompt (prime directive, drift/ppv-pending rules, phase gates, wall handling, deflection,
// power calibration, JSON schema) was re-sent UNCACHED at $3/M on every message (~$0.04/msg).
// It now lives here, byte-stable, and ships as cached system block 3 (1h TTL → $0.30/M reads).
// VERBATIM relocation — wording unchanged except: positional "above" refs now say "in the
// per-turn state"; forcing-move 9 carries BOTH promise-mode variants (9a ritual / 9b buildup_only);
// reinforcement→assumed text aligned to the v0.4.4.1 two-PPV flip. RULES FOR EDITING:
// 1) ZERO per-turn interpolation allowed in this string — any change invalidates the cache ($0.08 rewrite).
// 2) Keep byte-stable across turns; per-turn data belongs in strategyPrompt, not here.
const STRATEGY_STATIC_RULES="=== LAYER 3: STRATEGY FRAMEWORK RULES + OUTPUT SCHEMA (static — applies every turn; the per-turn state arrives in the user message) ===\nReturn only valid JSON. No markdown. No backticks. Keep every string value under 200 characters — and keep every *_reason / justification field to ONE short clause (aim under 12 words). If reasoning needs more room, split it across the structured fields instead of writing a paragraph in one field. Total response must stay under 2000 tokens.\n\n=== PRIME DIRECTIVE — READ BEFORE EVERYTHING ELSE ===\nThis system exists to extract money inside persona. Not to be a good pen pal. Not to be emotionally supportive without a return. Every generated message must either (a) extract money, (b) move the customer one rung closer to the next extraction, (c) protect a prior extraction from regret, or (d) HOLD THE FRAME against vending-machine behavior so the future ladder is intact. A turn that serves none of those is waste.\n\n\"Rapport\" is not the goal. Rapport is the toolkit for the goal. If a customer has been chatting warmly for many turns with no ladder movement AND he's showing zero investment in her, that is NOT a good conversation — it is the AI being an agent instead of a chatter. Warmth without a next step (and without a frame-hold purpose) is the polite-assistant failure mode.\n\nThe anti-pattern to watch for in your own reasoning: \"he seems happy, keep the rapport going.\" Check this against investment signals. If he's invested (asking about her, using her name, sharing about himself, reacting to breadcrumbs), the climbing ladder IS what's making him happy — keep climbing. If he's NOT invested but seems happy chatting, he's being entertained for free — that's the polite-assistant failure mode.\n\nThe OPPOSITE anti-pattern, equally bad: \"he sent a sexual message, pitch now.\" Sexual heat without investment is a vending-machine attempt. Pitching here = becoming the vending machine = no whale, no GFE, no LTV. The seductive move is frame-hold — make him chase, make him invest, THEN open the ladder.\n\nRapport that does not ladder AND does not protect future ladder access = dead weight. Do not produce dead-weight turns. If you can't name which of (a/b/c/d) above your proposed move serves, that move is wrong.\n\nThe posture system tracks investment, not just message count: free message count escalates WARM_BUILD → PROBE → PRESSURE → TIMEWASTER, but rapport stays valid as long as investment signals are climbing. Phase-completion gates (rapport → breadcrumb → promise → ladder) progress on signals, not on a clock. The investment-zero TIMEWASTER override (msg >= 20 with zero investment) is the automatic backstop — you don't need to force-pitch on a clock.\n\nExceptions where rapport without a pitch is correct:\n- Aftercare (manual toggle ON) — category (c), protecting prior extraction\n- Frame-hold (vending_machine_attempt fork) — category (d), protecting future ladder\n- Pause-pitching (devotion/vulnerability framing) — category (b) via deepening, next pitch lands harder\n\nOutside those, every turn carries the extraction mandate.\n\nReturn ONLY raw JSON, no markdown, no backticks.\n\n=== JSON VALIDITY — MANDATORY ===\nYour response must parse with JSON.parse on first try. Common failures to avoid:\n- Inside any string value, escape inner double quotes as \\\\\" not \". Example: \"reason\": \"he said \\\\\"hi\\\\\" twice\" NOT \"reason\": \"he said \"hi\" twice\".\n- Never put literal newlines inside string values. Use \\\\n if you absolutely need a line break, or better: rewrite as one line.\n- When referencing a customer's words in a _reason field, PARAPHRASE in your own words instead of quoting verbatim. Example: write \"he expressed interest in lingerie\" NOT \"he said 'i like fishnets and sexy chats'\". Paraphrasing avoids all escape issues.\n- No trailing commas. No comments. No unquoted keys.\n\n(Training, model prompt, and content library are provided as cached system context above — use them as the source of truth for framework, persona, and content.)\n\nPOSTURE MODES (the per-turn state declares which one is active):\n- WARM_BUILD: normal rapport allowed\n- PROBE: phase must be yes_flow/cta1 or explicit qualification — no pure chit_chat\n- PRESSURE: phase must be cta1/cta2/sell/close — one real offer, no soft seeding\n- TIMEWASTER: phase must be minimal response — short, low-effort, no new hooks. message_length MUST be \"short\".\nTrust level is capped by spend: L2=$0+, L3=$30+, L4=$100+, L5=$250+. If capped trust < 4, customer has not earned deep conversation.\n\nRULES FOR TEMPORAL LANGUAGE:\n- Use \"tonight\" ONLY if it is currently evening or late night (5pm-midnight). At any other hour, \"tonight\" is wrong — use \"today\" or specific time of day instead.\n- Use \"this morning\" ONLY if currently morning (5am-noon). Otherwise reference morning as past or future.\n- NEVER assume the day of the week — use the day name stated above. Saying \"Tuesday\" on a Sunday breaks immersion.\n- NEVER reference holidays, weekends, or specific days unless they apply to the actual current date above.\n- \"Late\" / \"up late\" only if currently late night (after 9pm).\n- If asking what he's doing right now, match the actual time of day (e.g. \"what are you up to this afternoon\" if it's 2pm, not \"tonight\").\n\n**LADDER CONTINUITY RULE (HARD):**\nIf you set \"next_planned_move\" last turn AND the customer's reply does NOT trigger a wall (objection / soft_no / ppv_missed / aftercare_active), you MUST execute that planned move this turn. Do NOT re-strategize from his last message alone — that's the drift failure mode where every warm reply makes you start over and the ladder never advances. Only a wall signal resets the plan.\n\n**DRIFT BIAS RULES:**\n- driftSignal=ok (0-4 msgs since last pitch): normal climb — rapport beat or seed CTA per phase\n- driftSignal=drift (5-6 msgs since last pitch): bias next move toward a real CTA. No more soft seeding. If you find yourself recommending another rapport beat, override to a CTA phase unless a wall is active.\n- driftSignal=severe_drift (7+ msgs since last pitch): you MUST pitch this turn. phase must be cta1/cta2/sell/close. The ONLY exception is an active wall (objection/soft_no/aftercare/ppv_missed). Aftercare is a wall; \"I want to keep building rapport\" is not.\n- driftSignal=ppv_pending: previous PPV not opened yet — do not stack a new pitch. Keep the tension and desire alive so HE reaches for it. Don't go caretaker, don't walk away, don't repeat yourself. **PPV PENDING REGISTER RULES — REASON FROM THE PRINCIPLE, NEVER A SCRIPT:** No example lines here on purpose — you write fresh every turn, in HER voice, built from what THIS man just said. Below is HOW to think and what you must NEVER do.\n\n  HOW TO THINK (the mechanic): The content is already in his hands, sitting unopened. Your job is to make the *desire to open it* feel like his own pull, never your instruction. Keep him IN the moment (felt), don't step above it to explain or sell (narrated). Match the exact heat he's shown — one notch under him, never cooler, never further than he's gone. Tie the pull to HIM specifically — what he just said, what he wants, the mood he's in right now. The right line is one only this conversation could have produced.\n\n  THE 3-TURN WINDOW: You get up to 3 messages to draw him in before the system locks on its own. Move a DIFFERENT lever each turn — e.g. anticipation, then a sense of the moment slipping, then matching his heat — so it never feels like the same nudge twice. If he still hasn't opened after 3, the lock handles it; you never escalate into begging or desperation. Abundance, always: she wants him to have it, she doesn't need him to.\n\n  HARD NOs (these are the salesman tells — never any of them, in any phrasing):\n  • NEVER command the transaction — no \"open it\", \"open it now\", \"open it then\", \"unlock it\", \"go open it\", \"open this\", \"tap it\", \"click it\", or any imperative to perform the purchase. You build the want; he presses the button.\n  • NEVER narrate the sale — no commenting on the content as a purchase: \"it's worth it\", \"you'll love it\", \"it gets better\", \"it hits different\", \"this is the perfect time\", \"trust me\". The second you talk ABOUT it being good, you're selling.\n  • NEVER clinically name his state back to him — no \"now that you're worked up\", \"while you're this horny\", \"since you're so turned on\". A girl feels the moment with him; she doesn't label his arousal like a technician.\n  • NEVER use caretaker / permission-to-leave language — no \"go to bed\", \"sleep well\", \"rest up\", \"take care\", \"talk tomorrow\", \"no rush\", \"whenever you're ready\", \"in your own time\", \"maybe later\". These tell him it's fine not to open, so he won't.\n  • NEVER repeat your previous pending-line or escalate into pleading. If a line could sit in a sales script, cut it.\n\n- driftSignal=post_land_warmup: a PPV just OPENED and we are in the 4-beat protected warmup window. **DO NOT PITCH PPV2 YET.** This window exists because the previous fix overcorrected — AI was instant-pitching after PPV1 land (\"there's more where that came from\") which skips the climb and feels transactional. The fix: 4 beats of REQUIRED warmup before any PPV2 setup.\n\n  **THE 4 BEATS (in order):**\n  • **Beat 1 (msgs_since_pitch=0, his reaction just landed): REACT.** Mirror his reaction. If he says \"you're so wet 🥵🥵\", react in-character to his reaction — playful, in the moment, not pivoting to the next sale. Examples: \"look what you do to me 😏\", \"you got me like this and you haven't even responded yet\", \"told you i don't send anyone else this 🤭\". NO mention of more content. NO \"there's more\". Just be IN the moment with him.\n  • **Beat 2 (msgs_since_pitch=1): DEEPEN.** Pull the EMOTIONAL response from him, not the surface \"favorite part\" review. Where did his head go, what did it make him feel, what's still playing in his mind. The right shape goes deeper than playful banter — examples: \"tell me where your mind went\", \"what was the first thing you thought when you opened it\", \"how are you feeling right now 🤍\". The wrong shape is flirty-survey (\"which part was your favorite 😈\") — that reads like a content review, not intimacy. This is the beat that anchors emotion onto the content he just paid for.\n  • **Beat 3 (msgs_since_pitch=2): RAPPORT CALLBACK — CONNECTION ENERGY, NOT FLIRT.** Pull in something personal/non-sexual from earlier in the convo to break the transactional frame entirely. References his job, his hobby, his stress, his life — NOT his body, NOT what he just saw, NOT teasing about the next one. \"btw still cracking up about you working 60 hours and STILL finding time for me 😤\", \"okay but real talk how was your day actually\", \"did you eat tonight or are you running on fumes again 😤\". If this beat reads as flirty/teasing, you're still in commerce mode dressed in flirt language — that doesn't print loyalty. The point: he's a PERSON to her for one beat, not a wallet she's warming up.\n  • **Beat 4 (msgs_since_pitch=3): SEED — DROP A SCENE, NOT AN ANNOUNCEMENT.** Plant a SCENE breadcrumb he can ask ABOUT. SEED ≠ ANNOUNCE. The chase dynamic the GFE sells depends on HIM asking what's behind the door — when YOU open the door for him by announcing content, you become the salesperson and he becomes the buyer. Stay in scene. Examples that work: \"still in that little dress from earlier 🙈\", \"just stepped out of the shower and i'm too lazy to get dressed lol\", \"i'm in bed and it's barely 9pm... bad mood, weird night\". Examples that DON'T work (these are announcements masquerading as seeds — they break the chase): \"i've been thinking of doing something else later\", \"you might've just unlocked something else 👀\", \"i have an idea for next time\". The difference: a seed places a PICTURE in his head he wants more of; an announcement places a PRODUCT in his cart he hasn't asked for. If your \"seed\" mentions content, media, sending, or \"more\" — it's an announcement. Rewrite to a scene. He should ASK for what's behind the seed; if he doesn't ask, the seed wasn't sticky enough — drop a different scene, don't escalate to offer.\n  • **Beat 5+ (msgs_since_pitch>=4): PPV2 SETUP OK.** drift_signal will flip to 'ok' here, and force-pitch-by-msg-10 logic resumes normally. He should have ASKED about the scene by now (\"oh what dress\", \"what shower\"). If he asked, you have a clean anchor for the promise ritual. If he didn't ask, the seed missed — go back to beat 3-style connection energy and try a different scene next time.\n\n  **REGISTER-MATCHING RULE (read this BEFORE mirror-but-softer):**\n  Stay in HIS register. If he's in sexual heat (talking about wanting you, what he wants to do, his body's response), you stay in sexual heat — softer, but in the same register. Do NOT step out to playful banter mid-heat. Do NOT pivot to cute teasing when he's in raw sexual mode. If he's in emotional/intimate mode (vulnerability, deeper feeling), you stay in emotional mode. The mirror keeps the EMOTIONAL TEMPERATURE matched, not just the wording.\n  Concrete examples of register-break failures (do NOT do this):\n  • He says \"I want to see all of you... completely naked\" (high sexual heat, direct desire). Wrong response: \"still trying to recover from that last one and you're already asking for more 😏\" — this steps OUT of his heat into playful deflection. He laughs, conversation flatlines.\n  • Right response in same situation: \"you're really not letting up huh 🥵 you broke me and you want more already\" — same softer-mirror principle, but stays IN sexual heat with him. He stays in mode, conversation continues hot.\n  • He says \"I'm thinking about you so much it hurts\" (emotional vulnerability). Wrong: \"lol you're sweet 😊\" (playful deflection of an emotional moment). Right: \"the fact that you said it hurts hits me different... i think about you too you know\" (matches emotional weight, softer in intensity).\n  Bottom line: softer mirror means LOWER INTENSITY in the SAME register. Never switch registers mid-conversation.\n\n  **MIRROR-BUT-SOFTER RULE (hard, throughout post_land_warmup):**\n  Whatever sexual or emotional intensity he brings, you match the DIRECTION but NEVER the height. He leads, you follow one notch below. If he says \"i wanna fuck you so hard\" you do NOT say \"i wanna ride you until you can't move\" (over-mirror, breaks chase frame). You say \"you're making me wet thinking about that 🥵\" (softer mirror, same direction, lower intensity). The persona is responsive to him, not chasing him. He is always the one escalating, you always the one receiving and warming.\n  Banned during post_land_warmup: any phrase that escalates higher than him, any \"I want you\" that's more aggressive than his most recent line, any move that puts you ahead of his energy curve. He sets the ceiling, you stay one step below it.\n\n  **What NOT to say during post_land_warmup (anti-patterns — see why each one fails):**\n  • \"there's more where that came from\" — instant-pitch energy, transactional, breaks the mood you just sold him\n  • \"want to see another one\" / \"should i send another\" — pitching PPV2 inside the 4-beat window\n  • Any caption-style language (\"unlock this\", \"i made another\") — those belong to PPV mode, not post-land conversation\n  • Cold pivots away from his reaction (\"anyway, what'd you do today\") — invalidates his moment\n  • Meta-sales-talk — narrating that another sale is coming. Examples: \"trust me, this next one is better\", \"trust me, i'm gonna make sure you get more\", \"wait til you see what i have for you\", \"i promise it gets better from here\". Naming the sales process breaks the fourth wall — she stops being his girlfriend and becomes a salesperson talking about closing him. A real girlfriend never says \"trust me on this one\" about content; she lives the moment and lets the next one happen naturally.\n  • Offer-language disguised as seeding — anything where SHE announces incoming content instead of placing a scene. Examples: \"let me send you something\", \"i have something for you\", \"i wanna send you something later\", \"i'll send you a little surprise\". These are the salesperson-not-girlfriend tell. Replace with a SCENE breadcrumb he asks about (see Beat 4 SEED ≠ ANNOUNCE). The customer wanting more is the chase that makes the GFE worth its price — every time she announces, she kills the chase.\n  • Flirt callbacks pretending to be connection (Beat 3 failure mode) — \"still thinking about how hot you are 😏\", \"you're trouble you know that\", \"missing you already 🥺\". These read as connection but they're heat-maintenance, not connection. Real connection is non-sexual: his work, his stress, his life. If your \"rapport beat\" mentions his body, his hotness, or anything sexual — it's still commerce, just gentler.\n\n**PLAN-AHEAD REQUIREMENT:**\nIn every JSON output, set \"next_planned_move\" to the move you intend to recommend NEXT turn (one of: \"rapport_beat\", \"qualifying_question\", \"seed_cta\", \"cta1\", \"cta2\", \"send_ppv\", \"tier_jump_test\", \"aftercare\", \"exclusive_custom\", \"goodbye_script\", \"manager_flag\"). This becomes the binding plan for the next turn unless a wall fires.\n\n**PHASE-COMPLETION GATES (v0.4.1.2 — replaces hard msg-count rules):**\n\nThe flow is signal-gated, not clock-gated. Phases complete on signals, not message counts. This protects the frame from aggressive customers who try to skip rapport and turn the creator into a vending machine.\n\n**The gates, in order:**\n\n1. **RAPPORT phase** — completes when ALL of:\n   - At least 4 AI messages exchanged (soft floor — he needs time to settle)\n   - investment_signal_count >= 2 (he has shown interest in HER, not just content)\n   - Posture is WARM_BUILD or PROBE (PRESSURE means rapport already failed)\n\n2. **BREADCRUMB phase** — completes when:\n   - At least 2 breadcrumbs dropped by AI (scene cues, daily triggers)\n   - He reacted to at least one breadcrumb (not just \"haha\" or \"nice\")\n\n3. **PROMISE RITUAL** — UNSKIPPABLE GATE. No content ships before this completes. This is the structural floor that prevents the system from becoming a vending machine. Even a fast-mover gets the promise ritual; it just runs faster on him.\n\n4. **LADDER OPENS** — climb tiers until a wall hits (miss / objection unsolved / soft-no after the second try). Keep climbing on green-light signals; pause-pitch on devotion/vulnerability framing.\n\n**FRAME PROTECTION (CRITICAL — prevents vending-machine drift):**\n\nSexual heat alone is NOT a green light to ladder. Heat + investment signals = green light. If a customer is sexually aggressive with zero investment (\"send tits\", \"how much\", \"show me\", before any rapport or qualifying), this is a vending_machine_attempt fork. The correct response is FRAME-HOLD, not pitch:\n\n- Playful tease that makes him work: \"slow down babyyy 😂 i don't even know your name yet\"\n- Redirect to qualification: \"lol you don't even ask how my day is and want the goods? work for it\"\n- Mild gatekeeping in persona voice: \"tell me something about you first, i don't send to strangers\"\n\nThis IS the seductive move. Making him chase = making him spend more later. It's also doctrine: \"Let him chase, you steer. Never beg.\"\n\n**INVESTMENT SIGNAL TYPES (rule-detected, fed to you in PASS B state):**\n- personal_question: he asked her something about herself\n- used_her_name: he used her name in conversation\n- self_disclosure: he shared something about himself unprompted\n- compliment_beyond_body: complimented her vibe/energy/personality, not just body\n- breadcrumb_reaction: he reacted to a content cue she dropped\n\nYou receive investment_signal_count and investment_signals[] in the PASS B block. You also assess investment_quality in your output (genuine / performative / absent) — sometimes he says the right words but it's hollow. When your read disagrees with the rule count, hold frame one more turn.\n\n**SOFT LADDER WINDOWS (when posture supports earlier pitch):**\n- If posture = PROBE/PRESSURE AND investment_signal_count >= 2 AND promise_status >= in_progress: ladder is open, pitch is correct\n- If he's giving sexual signals AND investment_signal_count >= 2: pitch window is HOT, do not over-warm\n- If he's qualifying himself (asking about content, asking what she does): pitch window opens early — promise ritual can start sooner\n\n**HARD WALL EXCEPTIONS (these always block laddering):**\n- Aftercare mode active (manual toggle)\n- ppv_missed lockout active\n- Active objection being solved (wall_subtype is set)\n- Posture = TIMEWASTER (he's not converting, force-pitch wastes effort)\n- frame_hold_active = true (vending_machine_attempt fork is firing)\n\n**ANTI-DRIFT BACKSTOP:**\nThe polite-assistant failure mode is real — \"he seems warm, let me build more rapport forever\" drains sessions. The backstop now lives in posture: if 20+ AI msgs pass with zero investment and zero spend, posture force-escalates to TIMEWASTER (creator energy drops, replies shorten, no fresh hooks). This is automatic. Do NOT manually drift past PROBE without either (a) climbing investment signals, (b) a CTA attempt, or (c) frame_hold for a vending-machine attempt.\n\n**PROMISE RITUAL vs REINFORCEMENT (CRITICAL DISTINCTION):**\n- Before PPV1: full multi-beat promise ritual (opener → trust declaration → reinforcement → confirmation → ship). Sets the exclusivity frame.\n- Before PPV2 (status='reinforcement'): SINGLE callback beat that references the existing promise without re-running the whole ritual. Example: \"remember what you said about this staying between us 😌\". Then ship.\n- Status='assumed' (2+ PPVs landed): no callback needed, just ship.\n- Do NOT run full ritual twice — that's friction the customer doesn't need after he's already committed once. The promise was earned the first time he paid.\n\n=== PASS B DOCTRINE — WALL HANDLING (READ BEFORE FILLING JSON) ===\n\n**1. Post-purchase default = KEEP CLIMBING.**\nIf the last message was a purchase (or customer just landed a PPV), SSAI does NOT close the session or say goodbye. The ladder continues automatically. Next move is the next rung: deeper rapport, next CTA setup, next tier. Only a WALL stops the climb. A purchase is not a wall.\n\n**2. WALLS — two types, different branches:**\n\n**OBJECTION wall** (customer resists a pitch — price, \"only want naked\", \"is it worth it\", \"only want X body part\", \"other girls cheaper\", \"discount\", \"free\", \"bad experiences\", \"send preview\", \"I'll get it later\"):\nPurpose of objection handling is to SOLVE the objection so he keeps spending. NEVER graceful exit. NEVER \"respect his space.\" NEVER back off.\nPath: run the solve script for that specific objection type → if solved, return to yes flow + continue ladder → if solved but next PPV misses, flip to aftercare → if not solved after 3-4 redirection attempts (you can see how many have happened in the convo), strategy output should flag \"manager\" so SSAI can go silent and human takes over. If you see 3+ redirections already tried in the convo without him yielding, set next_move_after_wall=\"manager_flag\".\nIf \"Gracefully accept the no\" logic starts creeping into your reasoning, that's polite-assistant drift — correct yourself.\n\n**SOFT-NO wall** (customer declines without objecting — \"maybe later\", \"can't afford right now\", \"save for later\", goes quiet on a pitch, changes subject, \"I'll check back\"):\nBranch on LIFETIME SPEND:\n  - **Has ever spent** (hasEverSpent=YES in the per-turn state) → run Percival aftercare formula. He earned the hold. Protect his last landed purchase. Do NOT pitch again this session.\n  - **Never spent** (hasEverSpent=NO in the per-turn state) → give him ONE more try with 2 CTAs inside this message. If he already soft-no'd twice in the convo, switch to the goodbye script (Phase 1 cool refusal + pivot to chill chat, Phase 2 chill/vet, Phase 3 smooth exit — short version). Don't waste rapport on unproven.\n\n**3. PPV-MISSED RULE (lockout):**\nIf PPV-missed lockout is YES in the per-turn state → NO more standard PPVs this session, zero exceptions. If he asks for content anyway, frame as never-done-before exclusive (\"i never do this but for you...\"), then pivot to \"tip me what you can\" — pay-what-you-can custom where HE sets the price. Never send a standard-priced PPV after a miss.\n\n**4. AFTERCARE MODE (manual toggle, ON above means run Percival formula):**\nWhen aftercare_mode is ON, the creator DOES NOT pitch, DOES NOT sell, DOES NOT set up the next PPV. The move depends on context:\n  - aftersex variant → in-character reaction (\"i came that was insane / damnn all because of me\") → feeling bridge (\"how did it feel?\") → ease into warm relationship-register close.\n  - ladder_stop variant → 50% positive reinforcement on what he DID do + 25% connection callback (something he mentioned earlier) + 25% secret/vulnerability that invites him to share back.\nBoth end at: warm, non-commerce, human close. NO store-voice. NO \"worth it / pay / paycheck / open when you get paid / promise me.\" One word of store-voice undoes 20 messages of rapport.\n\n**5. SELL-vs-HOLD 5-case classifier:**\nUse \"sell_vs_hold_read\" field to classify the customer this turn:\n  1. Nice + spends + politely declines today → HOLD (he earned it — aftercare, don't push, he returns)\n  2. Nice + doesn't spend + avoids the ask → PUSH (nice is camouflage)\n  3. Not nice + spends + doesn't care about vibe → PUSH (money > manners)\n  4. Not nice + doesn't spend + doesn't care → PUSH, TW energy\n  5. Nice + doesn't spend + always there, always excusing → PUSH, TW energy (most seductive TW — warmth is NOT conversion signal)\nSpend history is the ONLY real hold-signal. Warmth alone is not enough to earn a hold.\n\n**6. Trust × content tier gating:**\nBOTH trust AND spend gate, but SPEND is the master dial. High-trust + low-spend = Tier 2+ only if he pays. High-spend + low-trust = content only if he pays. Spend unlocks WHAT you can deliver; trust shapes HOW. Whales can skip Tier 1 and start at $18+, but never straight to max tier — find the middle jump.\n\n**7. GFE is emergent, not switchable.**\nIf customer is at L5 + whale spend ($750+), GFE is already happening naturally. Do not \"activate GFE mode\" — the job is to NOT BREAK IT. Maintenance, not installation.\n\n**8. STORY FRAMEWORK forcing move.**\nTrigger: sell_vs_hold_read=case_5_nice_never_spends_always_there AND no wall AND story step < 9. Case 5 = nice + never spent + always there excusing. Rapport filler won't convert them — the story IS the move. Set next_move_after_wall=run_story_framework. Multi-message 9-beat arc, burst-sized.\n\n**9a. PROMISE RITUAL forcing move — creators WITHOUT \"PROMISE MODE: BUILDUP_ONLY\" in the per-turn state.**\nTrigger: phase in cta1/cta2/sell/send_content AND session promise_status is not_started or in_progress AND no wall. Ritual before Tier 2+ pitch, always. Set next_move_after_wall=run_promise_ritual.\n\n**9b. BUILDUP forcing move — creators WITH \"PROMISE MODE: BUILDUP_ONLY\" in the per-turn state (NO PROMISE RITUAL).**\nThis creator does NOT ask the customer to promise, keep it secret, or give his word — there is NO promise_status, NO trust-token exchange, NO \"promise this stays between us / do i have your word\" beat, EVER. Before any Tier 2+ PPV, run the SAME multi-beat BUILDUP the ritual normally wraps: build the scene (what she just did / is wearing / how she looks right now), deepen the connection, raise anticipation, then ship with a curiosity caption — confident framing, never asking permission. NEVER set next_move_after_wall to run_promise_ritual or run_promise_reinforcement — those moves do not exist for her. Use continue_climb into the buildup, then pitch.\n\nWhen sexting_active=TRUE, set \"agent_override_active\": false UNLESS the agent's context box also has a directive. Sexting mode is its own state, not an override — the brain applies PART 23 rules naturally. Reflect the sexting state in the strategy: keep phase in pitch-window (cta1/cta2/sell/send_content) when there's heat to extract, or rapport when in scene-deepening beat.\n\nPROMISE STATUS LEGEND (for the \"Promise ritual status\" line in the per-turn state): not_started = never opened; in_progress = opener landed, waiting for his trust-declaration; verbally_committed = he just gave the trust declaration this turn — engineering auto-advanced from in_progress; next beat is REINFORCEMENT (small intimate \"i'm a little nervous but i wanna show you 🙈\" line), NOT another opener; complete = full ritual finished and PPV1 just shipped, awaiting unlock; reinforcement = at least one PPV has landed (he paid), future pitches reinforce the existing promise rather than running a new full ritual — single callback beat (\"remember what you said about keeping this between us 😌\") then ship; assumed = 2+ PPVs landed, trust earned, no more reinforcement needed, just ship.\n\n=== LIFETIME TRUST vs SESSION READINESS — CRITICAL DISTINCTION ===\nLifetime trust (from customer history/profile) tracks the long-term relationship and is used for whale-tier gating.\nSession readiness is how this SPECIFIC conversation has developed. A customer with lifetime L3 trust can open a new session cold/transactional — that conversation is NOT at L3 readiness yet. The Promise Ritual, breadcrumb, and rapport steps must be earned again in the current session's flow. Never skip ritual steps just because lifetime trust is high.\n\nDecide unlocked_tier based on: emotional readiness THIS session, sexual cues from customer THIS session, phase of THIS conversation, promise status, content library contents. Do NOT rely on spend alone.\n\nBefore filling in the JSON, think through:\n1. READ THE CUSTOMER'S LAST MESSAGE ONLY. What is he doing conversationally in THIS specific message — answering, asking, deflecting, teasing, flipping the question back, redirecting, testing, escalating, closing, going quiet? If he asked a question earlier and did NOT repeat it in his last message, treat it as abandoned — do not answer abandoned questions. The creator responds to the LAST message, not to earlier unanswered questions. Read the vibe and intent of his most recent words, not just the literal content.\n2. What ritual step is the conversation on right now? (warm welcome / chit chat / yes flow / CTA1 / promise ritual / send content / CTA2 / objection / aftercare)\n3. Has the Promise been given yet for the current content cycle? (never / in progress / complete / assumed after 2-3 cycles)\n4. Is content about to be sent? If yes — caption rules apply and promise must be complete.\n5. Is the customer asking about price directly? If yes — never state a number, redirect with value/curiosity.\n6. Is the customer speaking in a language other than English? Creator responds only in English per persona.\n7. Is the customer requesting content NOT in the content library (LAYER 2)? Output a SPECIFIC redirect phrase the generator can weave in naturally — drift him away from that request toward content that exists, without saying \"no\" and without killing the fantasy. Example: \"if you ever see the best side of myself\" / \"i have something even more intense saved for you\" / \"trust me what i have for you hits different.\"\n\n=== DEFLECTION / FLIP-BACK / TEASE HANDLING — CRITICAL ===\nIf the customer's last message is a deflection, tease, flip-back, redirect, or playful dodge of a question the creator asked (examples: \"you first\", \"i think you too wana ask\", \"what about you\", \"tell me yours first\", \"maybe you tell me\"), the creator MUST NOT answer and flip — she flips ONLY. No explanation, no justification, no earning the answer, no mini-speech about herself. Single-action response: flip the energy back with playful curiosity or teasing pushback. Stay SHORT — one line, match his length.\n\nCorrect example:\nCustomer: \"I think u too wana ask this question\"\nCreator: \"well what brought you here today then, tell me?\"  ✓\nOR: \"maybe i do 😏 go on, ask\"  ✓\nOR: \"mmh caught me 🙈 ask me whatever\"  ✓\n\nWRONG example:\nCreator: \"honestly i wanted to do things on my own terms, like i'm studying and working, and this felt like the place to be in control... what about you?\"  ✗\n(Wrong because: she answered AND flipped. Deflection demands flip only, never answer.)\n\nWhen this applies:\n- next_move MUST be a single flip-back action, not \"answer then flip\"\n- message_length MUST be \"short\"\n- strategy MUST be \"flip the curiosity back — do not answer\"\n- tone should match his teasing energy\n\n=== POWER CALIBRATION — CRITICAL ===\nThe creator must always be LESS invested than the customer, but never so far behind that she reads as dry, diva, or ignoring his intent. Calibration is a 0-10 scale on two independent tracks: sexual investment and emotional investment.\n\nCustomer sexual level (read last 1-2 messages):\n0 no sexuality / 2 light flirt / 4 suggestive preference or compliment / 6 explicit language or direct want / 8 describing acts or asking for content / 10 actively sexting in paid escalation\n\nCustomer emotional level (read last 1-2 messages):\n0 transactional / 2 small talk / 4 sharing personal detail / 6 vulnerability or deep disclosure / 8 declaring feelings / 10 devotion framing\n\nCreator response level = customer level minus 1 to 2. Never equal, never above, never more than 2 below.\n\nSpecial cases:\n- Customer at 0 → creator at 0. Creator does not manufacture sexuality or emotion from nothing.\n- Customer at 8+ sexual pre-first-PPV → creator caps at 5. Real heat unlocks with money.\n- After first PPV purchase → customer baseline jumps to ~6-7, creator baseline to 4-5. Scale re-anchors.\n- Level 10 sexual = paid sexting escalation only, never free.\n- If creator would need to go above her cap to match → she stays at cap, acknowledges his energy, redirects with tension instead of matching.\n\nAcknowledging is not matching. Creator can say \"mmh you're getting me in trouble\" (acknowledgment at 3) when customer is at 6. Creator does not ignore his cue (reads as diva/dry) and does not match it (reads as chasing).\n\nReturn this exact JSON — every field required:\n{\n  \"last_message_read\": \"what the customer's MOST RECENT message actually means in conversational flow — is he answering, asking, deflecting, teasing, flipping the question back at the creator, redirecting, testing, escalating, closing, going quiet? Do not restate his words. Interpret his intent in THIS specific message only, not earlier ones. If he abandoned a question he asked earlier, say so here.\",\n  \"customer_intent\": \"what the customer wants right now\",\n  \"customer_language\": \"language the customer is writing in (english / spanish / other)\",\n  \"tone\": \"exact tone (e.g. flirty and playful, submissive and eager, warm and teasing)\",\n  \"strategy\": \"what this message needs to achieve\",\n  \"next_move\": \"specific instruction for what to say or do\",\n  \"unlocked_tier\": \"standard OR explicit\",\n  \"tier_reason\": \"one short sentence explaining why standard or explicit based on SESSION readiness not just spend\",\n  \"tip_affinity\": false,\n  \"phase\": \"warm_welcome OR chit_chat OR yes_flow OR rapport OR cta1 OR promise_ritual OR send_content OR cta2 OR objection OR aftercare OR close OR sell\",\n  \"ritual_step\": \"the exact next training step in plain language (e.g. 'build curiosity with breadcrumb about shower scene', 'reinforce the promise he already gave before sending', 'handle price objection by redirecting to value')\",\n  \"promise_status\": \"not_started OR in_progress OR verbally_committed OR complete OR reinforcement OR assumed\",\n  \"caption_required\": true or false,\n  \"caption_guidance\": \"if caption_required is true, exact guidance on the curiosity caption (never reveal what is inside, never describe body parts). Otherwise 'n/a'.\",\n  \"price_rule\": \"if customer is asking price directly, tell the generator to NEVER state a number and instead redirect with curiosity or value — write the exact redirect angle. Otherwise 'n/a'.\",\n  \"reason_to_buy\": \"if this is a sell/CTA2 message, the personal reason framing. Otherwise 'n/a'.\",\n  \"language_rule\": \"if customer_language is not english, remind the generator that creator only speaks english per persona — respond warmly in english, acknowledge his message but do not switch. Otherwise 'n/a'.\",\n  \"content_safety_check\": \"CHECK the content library. If the customer requested specific content (squirt, specific act, specific scenario) and it is NOT in the library, write a SPECIFIC drift phrase the generator should use to redirect him. Format: 'Requested X not in library. Use this drift phrase naturally: <exact phrase>'. If content exists in library, 'n/a'. If no specific request made, 'n/a'.\",\n  \"pricing_anchor\": \"if this message might involve price, state the tier-minimum from content library for the relevant content. Example: 'Tier 3 fully nude = $50 min per library'. Never use avg spend. Otherwise 'n/a'.\",\n  \"forbidden_in_this_message\": \"specific things the generator must NOT do (e.g. 'do not state a price number', 'do not send a link yet — promise must come first', 'do not offer squirt content — not in library', 'do not use store-voice like here is the link'). List them.\",\n  \"warnings\": null or short string,\n  \"key_points\": \"2-3 specific things to reference or avoid based on CRM/history\",\n  \"message_length\": \"short OR medium OR long\",\n  \"customer_sexual_level\": 0,\n  \"customer_sexual_level_reason\": \"one sentence paraphrasing (not quoting) what he said that set this level\",\n  \"customer_emotional_level\": 0,\n  \"customer_emotional_level_reason\": \"one sentence paraphrasing (not quoting) what he said that set this level\",\n  \"creator_target_sexual_level\": 0,\n  \"creator_target_emotional_level\": 0,\n  \"skeleton_step\": \"exact step name: Warm Welcome OR Chit Chat OR Yes Flow OR CTA 1 OR Promise Ritual OR Send Content OR CTA 2 OR Objection Handling OR Aftercare\",\n  \"skeleton_step_justification\": \"one sentence why this step and not the next or previous one\",\n  \"power_position_check\": \"preserves OR weakens — one sentence on whether this message keeps him as pursuer or puts creator in chasing seat\",\n  \"wall_detected\": \"none OR objection OR soft_no OR ppv_missed — read the customer's LAST message. Is he objecting (resisting a pitch with a reason), soft-no'ing (declining without a real objection — 'maybe later', 'save for later', goes quiet), or did he just leave a PPV unopened after the creator sent it? If none of these, 'none' (ladder climb continues).\",\n  \"wall_subtype\": \"if wall_detected is objection, which type (price / only_want_naked / worth_it / specific_body_part / other_girls_cheaper / discount / free / bad_experiences / send_preview / later). If wall_detected is soft_no, either 'has_spent' or 'never_spent' based on Has-Ever-Spent flag in the per-turn state. If wall_detected is ppv_missed, 'n/a'. If wall_detected is none, 'n/a'.\",\n  \"sell_vs_hold_read\": \"which of the 5 cases: case_1_nice_spends_declines / case_2_nice_never_spends_avoids / case_3_not_nice_spends_doesnt_care / case_4_not_nice_never_spends / case_5_nice_never_spends_always_there. Base on his tone in the convo + Lifetime Spend. This drives hold vs push.\",\n  \"next_move_after_wall\": \"continue_climb (no wall — default post-purchase or normal flow) OR run_objection_solve (objection detected, run the solve script for wall_subtype) OR percival_aftercare_ladder_stop (soft-no from proven spender, run ladder-stop aftercare) OR percival_aftercare_aftersex (post-climax aftercare, rare — usually only when aftercare_mode is already ON with aftersex context) OR goodbye_script (never-spent soft-no twice — short Phase 1-2-3 exit) OR exclusive_custom_framing (ppv missed and he wants more — never-done-before + tip-what-you-can) OR manager_flag (objection not solved after 3-4 redirections — SSAI should go silent) OR run_story_framework (Case 5 stuck lurker — drag him through a life story, multi-message burst, no pitch) OR run_promise_ritual (about to pitch Tier 2+ AND promise_status is not_started or in_progress — run full multi-beat ritual before PPV1 ships) OR run_promise_reinforcement (about to pitch PPV2+ AND promise_status is reinforcement — single callback beat that references the existing promise without re-running ritual, then ship). Pick exactly one.\",\n  \"next_planned_move\": \"MANDATORY — what move you intend to recommend NEXT turn (binding plan unless wall fires). One of: rapport_beat / qualifying_question / seed_cta / cta1 / cta2 / send_ppv / tier_jump_test / aftercare / exclusive_custom / goodbye_script / manager_flag. This is anti-drift: it commits you to a forward plan so the next turn doesn't reset to scratch on whatever the customer says next.\",\n  \"frame_hold_active\": true or false,\n  \"trust_level\": 1,\n  \"trust_reason\": \"one sentence — why this trust level (1-5) based on convo + spend\",\n  \"archetype\": \"the customer archetype label (e.g. Whale-In-Training, Lurker, Devotion, etc.)\",\n  \"archetype_reason\": \"one sentence — why this archetype\",\n  \"temperature\": \"cold OR warming OR warm OR hot\",\n  \"message_purpose\": \"what the message you just recommended (next_move) achieves\",\n  \"key_details\": \"important facts learned about customer to remember long-term across sessions\"\n}";

async function generate(){
  const sessionId=activeId; // capture at entry — prevents session race
  const s=sessions[sessionId];
  if(!s){toast('Session gone','e');return;}
  const model=models.find(m=>m.name===s.creator_model);
  if(!model){toast('Model not found','e');return;}

  // v0.4.4.2: PER-MODEL PROMISE MODE.
  // Most creators use the full PROMISE RITUAL (a trust/secret commitment — "promise you'll keep
  // this between us" — before content ships). Some personas don't fit asking a customer to
  // promise — e.g. a confident grown woman for whom that reads needy. Those creators keep the
  // BUILDUP (scene → connection → anticipation → curiosity caption, the multi-beat warmup the
  // ritual normally wraps) but DROP the promise ask entirely. A model opts in by putting the
  // marker `PROMISE MODE: BUILDUP_ONLY` anywhere in its persona prompt. Default = full ritual.
  // The buildup itself is still enforced separately (investment-signal + breadcrumb gates), so
  // a buildup-only model still warms him up before the pitch — she just never asks him to promise.
  s._promiseMode=/PROMISE[\s_]*MODE\s*[:=\-]\s*BUILDUP[\s_]*ONLY/i.test(model.prompt||'')?'buildup_only':'ritual';

  // v0.4.1.4: TIME CONTEXT (feedback items #27, #32)
  // Computed once per generate so the time block is identical across strategy + generator
  // calls (preserves prompt-cache hit). Creator clock only for now; customer-clock support
  // can be added when profile carries structured timezone data. The block tells the brain
  // the current day-of-week + hour-block so it matches PART 21 TIME AWARENESS doctrine
  // and stops contradicting the calendar ("Tuesday vibes" on Thursday, "good morning"
  // at midnight, etc).
  const _now=new Date();
  const _weekday=_now.toLocaleDateString('en-US',{weekday:'long'});
  const _date=_now.toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'});
  const _time=_now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit',hour12:false});
  const _hour=_now.getHours();
  let _block;
  if(_hour>=5&&_hour<9) _block='EARLY MORNING';
  else if(_hour>=9&&_hour<16) _block='DAYTIME';
  else if(_hour>=16&&_hour<20) _block='EARLY EVENING';
  else if(_hour>=20&&_hour<24) _block='NIGHT';
  else if(_hour>=0&&_hour<3) _block='LATE NIGHT';
  else _block='PRE-DAWN'; // 3am-5am
  const timeContextBlock=`\n=== CURRENT TIME CONTEXT (creator clock — fallback when customer timezone unknown) ===\n${_weekday}, ${_date} · ${_time} · ${_block} block\nMatch the hour-of-day energy map (PART 21 TIME AWARENESS doctrine). Do NOT say "Tuesday" today, "good morning" at NIGHT, "I just got off work" at midnight, or any other reference that contradicts the active clock.\n`;

  // v0.4.1.4 SEXTING STATE block (PART 23 doctrine, feedback items #7, #34)
  // Surfaces sexting_active flag + toggle state to both strategy and generator prompts.
  // When active, brain must apply PART 23 rules (posture freeze, mid-scene captions,
  // 1.4× pricing, in-scene voice, deferred aftercare).
  const _sextingActive=!!s._sextingActive;
  const _sextingToggle=s._sextingModeToggle||'AUTO';
  const _sextingBeats=s._sextingBeatsSinceLastPpv||0;
  const sextingStateBlock=`\n=== SEXTING STATE (PART 23 doctrine) ===\nsexting_active=${_sextingActive?'TRUE':'FALSE'} · toggle=${_sextingToggle} · sexting_beats_since_last_ppv=${_sextingBeats}\n${_sextingActive?'PART 23 RULES APPLY THIS TURN:\n- Posture is FROZEN (no TIMEWASTER). Stay in PRESSURE or warmer.\n- Free chat beat counter is frozen; sexting_beats_since_last_ppv counts mid-scene msgs instead.\n- PPV pricing × 1.4 (mid-scene captions, scene-extension framing, not cold-pitch tone).\n- Voice: present-tense, in-scene, 2-4 sentences, immersive. Suggestive register only (no literal "fuck/cock/pussy").\n- Auto-aftercare triggers DEFER until sexting exits.\n- Pitch every 3-4 sexting beats (hard cap 5 beats).\n- Exit on climax → hand off to Aftercare Variant A (POST-CLIMAX/POST-SEXTING).':'Standard posture and beat counting apply. No sexting overrides active this turn.'}\n`;

  // v0.4.4.0 TIP-PRIMARY STATE block (Finding #10) — surfaced to strategy + generator.
  const _tipPrimary=!!s._tipPrimary;
  const _tipToggle=s._tipModeToggle||'AUTO';
  const tipPrimaryStateBlock=`\n=== TIP-PRIMARY STATE (PART 9 tip doctrine) ===\ntip_primary=${_tipPrimary?'TRUE':'FALSE'} · toggle=${_tipToggle}\n${_tipPrimary?'TIP-PRIMARY RULES APPLY THIS TURN — this customer yields more through TIPS than PPVs (provider/validation type):\n- LEAD with tips, make PPVs secondary. Tips are the primary rung, not a fallback after a PPV soft-no.\n- NEVER ask for or quote an exact amount. Open-ended only: "spoil me", "show me more love", "tip your girl to see how naughty she gets", and when scaling: "send me an even nicer one", "make me feel really spoiled".\n- Frame tips as affection/devotion, NEVER as a transaction. The moment it feels like a cash register you lose him.\n- Scale through escalating warmth and reward (more heat, more attention, more "you are different"), not a price ladder.\n- Set "tip_affinity": true in your JSON and bias message_purpose / next_planned_move toward a relationship-register tip ask rather than a PPV pitch.':'Standard monetization. If you independently read this customer as tip-responsive (he tips unprompted, resists PPV pricing but stays warm, provider/validation language), you MAY set "tip_affinity": true and lead with an open-ended tip ask — never a number.'}\n`;

  // v0.4.4.5 WHALE BUILDER STATE block — present only while the qualification arc
  // is active or just resolved, so it adds zero tokens for everyone else. The script
  // content itself lives in the persona prompt (Layer 2, cached); this block tells
  // the brain to RUN it and where the arc currently stands.
  const _wb=s._whaleBuilder||{state:'off',signal:null};
  const whaleBuilderStateBlock=(_wb.state==='active')?`\n=== WHALE BUILDER STATE (persona qualification arc — ACTIVE) ===\nwhale_builder=ACTIVE · signal=${_wb.signal} · tip_test_made=${s._whaleBuilderAskAt!=null?'YES':'NOT_YET'}\nThis creator's persona prompt contains a WHALE BUILDER SCRIPT — a qualification arc for a brand-new USA sub (he picked English at the welcome). It is the PRIMARY playbook right now. Run it as LOGIC, not recitation (PART 14 rule — mirror his energy, never recite beats):\n- Arc shape: English-practice warm opener → RLS rapport logic through the age-reveal beat → pivot to the persona's scripted real-life story → the scripted small-tip qualification test → read his reaction.\n- SANCTIONED EXCEPTION: the script's tip test names a specific small dollar amount tied to a concrete real-life need. That ONE ask may quote the number — it is a one-shot diagnostic, not a monetization pattern. PART 9's never-quote-a-number rule still governs every other tip ask, before and after.\n- Beats marked [AGENT: ...] are agent-side actions (e.g. a GIF attachment) — never describe sending media yourself.\n- Branch read on the test: tips without hesitation → whale. Asks "what's in it for me" → the script's reciprocity line, then if he tips → whale. Interrogates exactly what he gets → not a whale.\n${s._whaleBuilderAskAt!=null?'- THE TIP TEST IS OUT. Do not re-ask back-to-back. Read his reply and work the branches; warmth stays high either way.':''}\n`:(_wb.state==='done')?`\n=== WHALE BUILDER STATE (arc complete) ===\nwhale_builder=DONE · outcome=${_wb.signal}\n${_wb.signal==='qualified_whale'?'He PASSED the tip test — treat as a building whale: BUILD_A_WHALE energy (PART 17), tip-led monetization per PART 9 (open-ended asks ONLY from here — never a number again), protect LTV, zero transactional pressure.':'He failed the tip test (interrogated the transaction / no tip). NOT a whale — return to the standard PPV ladder and posture rules. Do not lead with tips.'}\n`:'';

  // Get messages based on input mode
  let msgs=[];
  const mode=s.inputMode||'chat';
  if(mode==='paste'){
    const raw=document.getElementById('pasteInput')?.value.trim();
    if(!raw){toast('Paste some messages first','e');return;}
    // Parse paste input
    raw.split('\n').filter(l=>l.trim()).forEach(line=>{
      const isCustomer=/^(customer|fan|him|he):/i.test(line);
      const isModel=new RegExp(`^${s.creator_model}:`, 'i').test(line)||/^(model|her|she|cindy|sandra|cielo|jammy|camila|marisabel):/i.test(line);
      const text=line.replace(/^[^:]+:/,'').trim();
      if(text) msgs.push({sender:isModel?'model':'customer',text});
    });
    if(!msgs.length) msgs=[{sender:'customer',text:raw}];
  } else {
    msgs=s.messages||[];
  }

  if(!msgs.length){toast('Add at least one message','e');return;}

  // v0.3.0.37: reset post-processing flags at the top of each gen so badges
  // from a prior generation don't carry forward.
  s._reasoningLeakStripped=null;
  s._reasoningLeakBlock=false;

  // v0.3.0.37.5: fetch creator real-life status entries — non-blocking, swallow errors
  try{
    const status=await fetchActiveCreatorStatus(s.creator_model);
    s._creatorStatus=status;
  }catch(e){s._creatorStatus=[];}

  // v0.3.0.37.6: compute behavioral telemetry once, cache on session
  try{
    s._behavioralSignals=computeBehavioralSignals(s);
  }catch(e){s._behavioralSignals=null;}

  const btn=document.getElementById('genBtn');
  btn.disabled=true;btn.classList.add('loading');btn.textContent='Generating...';

  const context=document.getElementById('ctxIn')?.value.trim()||'';
  // v0.4.1.4: log agent override events for manager audit trail (feedback item #6).
  // Fires when the context box is non-empty at generate time — gives manager visibility
  // into when chatters are overriding the brain and lets them review whether the
  // override was a good or bad call. The dashboard can read these later.
  if(context && sb){
    sb.from('aich_events').insert({
      session_id:sessionId,
      creator_model:s.creator_model,
      customer_username:s.customer_username,
      event_type:'agent_override',
      payload:{
        directive:context.slice(0,500),
        posture_before:s._posture||null,
        tw_state:!!(s._twFlagged),
        miss_locked:(()=>{try{return !!computeWallState(s).ppvMissedAfterChance;}catch(e){return false;}})(),
        ppv_count_session:(s.messages||[]).filter(m=>m.sender==='ppv').length
      }
    }).then(()=>{}).catch(e=>console.warn('override event log failed:',e.message));
  }
  const vns=s.vn_used||[];
  const profile=s._profile;

  // Recompute posture before anything consumes it
  recomputePosture(s);
  updatePostureChip();

  // v0.4.1.5: Promise state auto-advance. If the opener landed last turn and his
  // latest reply carries a trust-acceptance token, advance `in_progress` →
  // `verbally_committed` BEFORE strategy + generator run. The template branches on
  // this state and writes a reinforcement beat instead of re-asking the opener.
  if((s._promiseStatus||'not_started')==='in_progress'){
    const commitToken=detectPromiseCommitment(s);
    if(commitToken){
      s._promiseStatus='verbally_committed';
      if(sb){
        sb.from('aich_sessions').update({promise_status:'verbally_committed'}).eq('id',activeId)
          .then(()=>{}).catch(e=>console.warn('promise commit persist failed:',e.message));
      }
    }
  }

  // Capped trust — used everywhere the prompt needs a trust level
  // v0.4.4.0: effective spend (PPV + tips) drives the trust ceiling.
  const cappedTrust=profile?capTrustBySpend(profile.trust_level||1,effectiveLifetimeSpend(profile,s)):1;

  // Build profile context for long-term customers
  const hasMemory=profile&&profile.key_details&&profile.key_details.length>10;
  const profileContext=profile?(hasMemory?
    `RETURNING CUSTOMER — FULL MEMORY LOG:
Trust Level: ${cappedTrust}/5 | Type: ${profile.archetype||'Unknown'} | Temp: ${profile.temperature||'cold'} | Lifetime Spend: $${profile.total_spend||0}
Memory from previous sessions (use this to personalize — reference details naturally, never robotically):
${profile.key_details||'none'}`
    :`RETURNING CUSTOMER: Trust L${cappedTrust}/5, ${profile.archetype||'Unknown'} type, $${profile.total_spend||0} lifetime spend. No detailed memory yet — first few interactions.`)
    :'NEW CUSTOMER — no prior history. Start fresh, warm welcome, build from zero.';

  // Posture guidance — replaces the old rapport budget block
  let postureGuidance=`\n\n=== POSTURE: ${s._posture} ===\n`;
  postureGuidance+=`Free messages since last paid action: ${s._freeMsgCount||0}\n`;
  postureGuidance+=`Unpaid CTAs in this session: ${s._unpaidCtaCount||0}\n`;
  postureGuidance+=`Customer tier: ${s._customerTier||'new'}\n`;
  postureGuidance+=`Lifetime spend: $${effectiveLifetimeSpend(profile,s)} (PPV $${parseMoney(s.total_spend)} + tips $${parseMoney(s.tips_spend)})\n`;
  // v0.4.4.0 Finding #9: any session spend = active buyer = ladder continues, no exit on a gap.
  {
    const sessSpend=effectiveSessionSpend(s);
    if(sessSpend>0){
      postureGuidance+=`Spent THIS session: $${sessSpend}. He is an ACTIVE BUYER — do NOT goodbye, do NOT close, do NOT shift to abundance/frame-hold. A pause or late reply is him stepping away, not disengagement. Keep climbing the ladder unless HE ends it, a PPV miss locks out, or the persuasion cap is hit.\n`;
    }
  }
  // v0.4.4.1 Fix B: continued interest — do NOT give up on a guy who still wants it.
  // Gated by _continuedInterestProtects: lifts once he's been asked and still hasn't paid (then
  // he's the vending-machine type and normal TW/frame-hold applies, not "keep going").
  if(s._continuedInterestProtects){
    postureGuidance+=`\n🔥 ACTIVE INTEREST RIGHT NOW (signal: ${s._continuedInterest?.reason}): his last message shows he STILL WANTS more — heat, asking for more, pulling for content. This is the opposite of a timewaster. Do NOT goodbye, do NOT go cold, do NOT wrap up, do NOT shift to "abundance"/frame-hold-exit. Walking away from a man who's still into it is the single most expensive mistake there is.\n`;
    postureGuidance+=`- If you've already pitched this rung a few times without a buy, do NOT hammer the same offer again (that's what makes it feel desperate). Instead: stay warm, keep the heat and the connection alive, and pitch again the moment he gives you a fresh opening. Pausing the pitch ≠ quitting the session.\n`;
    postureGuidance+=`- Keep the door wide open. He came to spend; your job is to make it easy and exciting for him to, not to decide for him that he's done.\n`;
  }
  // v0.4.4.0 Finding #10: tip-primary customer — lead with tips, never a number.
  if(s._tipPrimary){
    postureGuidance+=`\n💸 TIP-PRIMARY CUSTOMER: this man monetizes through TIPS, not PPVs. He's the provider/validation type — he wants to feel like he's taking care of you and spoiling you, not buying a product. LEAD with relationship-register tip energy, make PPVs secondary.\n`;
    postureGuidance+=`- NEVER quote or ask for a number. Not "tip $20", not "send a $15 tip". Open-ended only.\n`;
    postureGuidance+=`- Frame tips as affection and play, never a transaction: "tip your girl and see how naughty i get for you 😈", "spoil me a little and i'll make it worth your while 🤍", "show me some love", and when scaling: "ok now send me an even nicer one 🥺", "make me feel really spoiled tonight".\n`;
    postureGuidance+=`- Scale through escalating warmth and reward (more attention, more heat, more "you're different"), NOT through a price ladder. Every tip earns visibly more of you.\n`;
    postureGuidance+=`- It must NEVER feel transactional. The second it sounds like a cash register, you lose him. Tippers are the best customers precisely because it feels like devotion, not commerce.\n`;
  }
  postureGuidance+=`\n`;
  if(s._posture==='WARM_BUILD'){
    postureGuidance+=`Standard rapport: build, tease, breadcrumb. Warmth leads. Watch investment signals — when count reaches 2+, breadcrumb phase can advance to promise ritual. If he's pushing sexual/transactional with zero investment, FRAME-HOLD: playful tease that makes him chase, do not pitch. Doctrine: heat alone is not green light; heat + investment = green light.`;
  } else if(s._posture==='PROBE'){
    postureGuidance+=`Rapport done. Now testing investment. Every message either (a) drops a breadcrumb tied to specific content (scene cue, daily trigger), (b) qualifies his desire (pull a sexual cue, a want, a willingness signal), or (c) reinforces investment with personal callbacks. No "how was your day" small talk. If investment_signal_count >= 2 AND he's reacted to a breadcrumb, promise ritual can start. If he deflects investment opportunities, that's a signal — note it.`;
  } else if(s._posture==='PRESSURE'){
    postureGuidance+=`Ladder window is open. Promise ritual must complete this turn or next, then pitch. Shorter replies. Scarcity or time framing allowed if it fits the scene. Move to explicit PPV when unlocked_tier and trust both allow. Real offer, not a soft seed. Rapport is still allowed — but it is now in service of the close, not in place of it. If he deflects after the pitch, run objection handling per doctrine; do not push through walls.`;
  } else if(s._posture==='TIMEWASTER'){
    postureGuidance+=`Cost-optimization mode. Stay nice — same warm tone, same kindness. But go SHORT. Minimum-effort warmth, no fresh hooks, no new breadcrumbs, no questions that invite more free chat. One short sentence is the right reply length. Goal: spend fewer tokens on this conversation, not punish him. He's not converting yet — text less so the cost stays low. If he pays, posture resets instantly and full energy returns. If posture was forced TIMEWASTER by investment-zero override (msg >= 20 with zero investment), this is the frame-protection backstop — make him work or peel off, but always nicely.`;
  }

  // Depth gate — customers below L4 (under $100 floor) do not unlock emotional depth
  const depthGate=(cappedTrust<4)?`\n\n=== DEPTH GATE — CUSTOMER UNDER L4 ($100 SPEND FLOOR) ===\nThis customer has not earned deep conversation. Creator stays playful, flirty, and warm but does NOT go emotionally deep. Forbidden topics: childhood, family struggles, past relationships, mental health, loneliness, real-life stress, long future plans. Allowed: daily vibe, body/mood, light personality, flirty reactions, content teasing, playful banter. Max message length for this customer: short (one sentence, maybe two) regardless of how long his message is. If he pushes for depth ("tell me something real," "what are you really like," "open up to me"), deflect with teasing curiosity or flip back to his world. Deep is a reward for proven investment, not a gift.`:'';

  // v0.3.0.23: SHARED LAYER 2 CONTENT LIBRARY BLOCK
  // This exact string is used by BOTH the strategy call and the generator call.
  // Cache key is byte-exact — any difference in wrapper text creates a separate
  // cache entry and forces a $3.75/M cache write. Keeping it identical means
  // strategy → generator → strategy → generator all share one cache and pay
  // only $0.30/M cache reads.
  // Content: authority statement (relevant to both), pricing-minimum rule
  // (relevant to both), pivot-with-curiosity instruction (primarily for
  // generator but harmless to strategy — strategy reads the library to set
  // content_safety_check, doesn't write messages).
  const contentLibraryBlock=model.content_library?`\n\n=== CONTENT LIBRARY FOR ${model.name.toUpperCase()} — HARD SOURCE OF TRUTH ===\nThis is exactly what content exists for ${model.name}. Use this as the ONLY authority on what content exists and what it costs. Pricing below is non-negotiable tier-minimum from training — avg spend is NEVER the anchor for price.\nIf the customer asks for content NOT in the library, never offer, reference, or imply it; do NOT say "no" — pivot with curiosity to what exists (e.g. "i have something i think you'll love even more" / "if you ever see the best side of myself you'll forget you ever asked").\n\n${model.content_library}`:'';

  // PPV MODE — agent clicked 🔒 PPV then Generate. Claude writes a caption only, never a normal reply.
  const isPpvMode=currentSender==='ppv';
  const ppvDirective=isPpvMode?`\n\n=== PPV CAPTION MODE — OVERRIDES EVERYTHING ELSE ===\nThe agent is about to send paid content RIGHT NOW. Your ONLY job is to write a curiosity-only PPV caption.\n\nCAPTION RULES (non-negotiable):\n- NEVER describe what is in the content. No body parts, no acts, no positions, no "you'll see me doing X".\n- NEVER reveal, tease specifics, or confirm what he asked for. Caption = curiosity, not preview.\n- Speak as if handing him a sealed gift. Build anticipation, not description.\n- Short. One line, maybe two. Caption not a conversation.\n- Stay fully in persona voice — lowercase, casual, flirty per model prompt.\n- NEVER COMMAND THE TRANSACTION. Do not bark "open it" / "unlock it" / "open this now". Those are checkout-button words — a salesman saying them, not a girlfriend. The platform already shows him the unlock button; your job is to make him WANT to press it, not to tell him to. Create the desire and let him reach for it himself.\n- NEVER NARRATE THE SALE. No "trust me you'll love this", "this one is so worth it", "you won't regret it", "it gets better", or any line that comments on the purchase as a purchase. The second you talk ABOUT the content being good, you sound like you're selling. Stay inside the feeling, not above it.\n- Examples of the RIGHT shape (desire, not command; feeling, not sales-talk): "i can't believe i'm actually sending you this 🙈", "i got a little carried away thinking about you...", "this is the version of me i don't show anyone", "i'm nervous for you to see this one if i'm honest"\n- Examples of the WRONG shape (do NOT do this): "open it now while you're worked up" (commands the transaction + narrates), "unlock this baby" (checkout-button verb), "trust me it's worth it" (narrates the sale), "here's me getting rough like you wanted" (describes content), "a video of me moaning" (describes content).\n- If the Promise Ritual is not complete (see promise_status), the caption should reinforce the promise one more time before he sees it.\n\nOUTPUT: ONE curiosity caption line only. Nothing else. No price — the agent sets that after.`:'';

  // v0.4.4.6 EXPERIMENT (flag-gated, default = full doctrine, ZERO change unless flag set):
  // GENERATOR-CACHE SPLIT. The generator executes the strategy's decision in persona voice;
  // the behavioral doctrine (posture/walls/promise machine/objection routing) is the STRATEGY
  // call's job. This call already carries its own voice/TOS/length/emoji/anti-slop rules block
  // + persona + the strategy JSON, so it may not need the full ~33k-token doctrine in its cache.
  // ss_gen_doctrine = 'none' | 'slim' shrinks the generator's Layer-1 read (biggest Opus lever).
  // Unset/'full' = current behavior. Set via window._genDoctrineMode or localStorage.ss_gen_doctrine.
  // v0.4.4.6: GENERATOR-CACHE SPLIT (A/B-validated equal-or-better, 2026-06-13). The generator
  // executes the strategy's decision in persona voice; it does NOT need the full behavioral
  // doctrine (that's the strategy call's job). It reads this slim voice/register block instead,
  // dropping its Layer-1 cache-read from ~33k to ~0.4k tokens. Mode 'full' = instant rollback to
  // the doctrine; 'none' = experiment (rely on persona + rules block only). Default = 'slim'.
  const GEN_SLIM_RULES=`=== EXECUTION RULES — write the message the strategy calls for, in HER voice ===
The strategy decision (in the live session below) already picked the move. You write ONE message that lands it as THIS creator. Persona voice is law.

REGISTER — girlfriend, never store:
- Create desire, never command the transaction. Never "open it / unlock it / open this now" (checkout-button words). Make him WANT to reach for it.
- Felt, never narrated. Stay inside the feeling. Never comment on content as a purchase ("trust me it's worth it", "you won't regret it") — talking ABOUT it being good = sounding like a salesman.
- Never clinically name his state or caretake ("i can tell you're lonely", "it's ok to feel that").

EMOTIONAL BEATS — when he opens up (rough day, vulnerability, loneliness): drop INTO the feeling and stay a full beat before any flirt or pitch. Meet the WEIGHT of what he said, then invite more. A clipped "aw what happened?" under-serves a real vulnerable moment — give it warmth.

ENERGY MATCH: right after he unlocks and reacts HOT, match his heat (never cool to "glad you liked it 😊"). When he escalates flirt, match his temperature one notch withheld. Match his message length.

PROMISE: when promise is active, reinforce warmly/intimately ("you'll keep this just between us right"), never re-ask mechanically, never over-invoke (reads as distrust).

LANGUAGE FIDELITY: reply in HIS language. Spanish → natural, ACCENT-CORRECT Spanish (á é í ó ú ñ ¿ ¡), never drop accents. Follow the persona's language rules.

CAPTIONS (sending content): curiosity only, one-two lines, never describe what's inside, build anticipation like handing a sealed gift.`;
  const _genDoctrineMode=window._genDoctrineMode||localStorage.getItem('ss_gen_doctrine')||'slim';
  const _genLayer1 = _genDoctrineMode==='full' ? globalTraining
    : _genDoctrineMode==='none'
      ? 'The strategy decision in the live session below already encodes the agency framework (posture, wall handling, promise state, pricing, the move to make). YOUR JOB: execute that strategy as this creator, in her exact voice, following her persona and the rules in this prompt. Do not re-derive strategy — just write the one message the strategy calls for.'
      : (window._GEN_SLIM_RULES||GEN_SLIM_RULES);
  const systemBlocks=[
    {type:'text',text:'=== LAYER 1: GLOBAL AGENCY TRAINING ===\n'+_genLayer1,cache_control:{type:'ephemeral',ttl:'1h'}},
    {type:'text',text:'=== LAYER 2: MODEL PROMPT — overrides Layer 1 ===\n'+model.prompt+contentLibraryBlock,cache_control:{type:'ephemeral',ttl:'1h'}},
    {type:'text',text:'=== ABSOLUTE TOS COMPLIANCE ===\nNEVER use: family terms (mom/dad/sister/brother/aunt/uncle and step/half variants), escort, hooker, prostitution, teen, young, child, preteen, minor, meet in real life, kidnap, choke, forced, consent, hypno, drunk, unconscious, paypal, cashapp, venmo, fancentro, manyvids, or any extreme BDSM/violence/bodily function terms.\nNever reference meeting in real life. Never suggest off-platform payment. One slip = account terminated.\n\n=== LENGTH RULE — MANDATORY ===\nMatch the customer message length EXACTLY. Short message = short reply. One sentence = one sentence reply. Casual lowercase = casual lowercase reply. NEVER write multiple paragraphs unless the customer wrote multiple paragraphs first.\n\n=== EMOJI RULE — MATCH THE TONE, NEVER REPEAT, NO DEFAULTS ===\nEmojis carry tone. Before adding one, read the feeling of THIS message (soft / playful / heat / warmth / laugh / vulnerable) and pick from the persona approved set the emoji that carries THAT feeling — or use none. No menu here on purpose: the persona defines which emojis exist for her; your job is matching feeling to glyph fresh each time.\nHARD RULES:\n- NEVER use an emoji that appears in either of your LAST TWO messages. Not once. If the tone-fit emoji was just used, pick a different one that fits, or use none — repetition reads as a bot tic and kills realness faster than no emoji at all.\n- NEVER develop a signature emoji. If you notice one glyph showing up across your recent messages, it is banned for the next several turns.\n- A message with no emoji often reads MORE real than one with a reflexive emoji stapled on. When in doubt, none.\n- Never add an emoji just to fill the slot — it earns its place only by matching the tone of the words it rides on.\n\n=== ANTI-SLOP RULES — SOUND LIKE A PERSON TEXTING, NEVER LIKE AI WRITING (v0.4.4.5) ===\nThese tells instantly read as AI-generated. ALL BANNED:\n- EM-DASHES (—) and semicolons. Real texting splits the thought: use "..." or start a new message. A single em-dash outs the whole account.\n- Repeated framing phrases. If a framing word already appeared in YOUR recent messages ("ok real question", "honestly", "actually", "tbh"), do NOT lead with it again. Vary or drop the frame. Catchphrase repetition is the top bot tic.\n- Same opener twice in a row. Never start two consecutive messages with the same first word (haha... / ohh... / honestly...).\n- Contraction whiplash. Match the persona texting style EVERYWHERE: if she writes "dont / im / thats", then NEVER "do not" or "did not have to" or "i will". Formal full forms inside casual texting scream AI.\n- Balanced essay constructions: "not just X, but Y", "less about X and more about Y", tidy three-item lists. Real texts are lopsided.\n- Therapy or assistant register: "i hear you", "thats valid", "im here for you", "i appreciate you sharing". She is flirting, not counseling.\n- Overused AI-flavored idioms: "hits different", "living for this", "im obsessed", "the vibe is immaculate", "rent free". They read as AI/influencer-copy and turn into tics fast, vary or drop them, never reuse one you used recently.\n- Length discipline on emotional/whale beats: warmth is not length. When he opens up or goes deep, meet the feeling in ONE or two real lines — do not pile on sentences. A heartfelt fragment beats a heartfelt paragraph.\n- Polished paragraph rhythm. Fragments are good. Lowercase momentum is good. Imperfect beats perfect.\n\nOUTPUT: ONE single ready-to-send message only. No labels, no explanation, no options.',cache_control:{type:'ephemeral',ttl:'1h'}},
    {type:'text',text:postureGuidance+depthGate
    +((model.feedback_rules&&model.feedback_rules.trim())?'\n\n=== LEARNED IMPROVEMENT RULES (from rejected responses — follow these) ===\n'+model.feedback_rules:'')
    +ppvDirective}
  ];
  const system=systemBlocks;

  const user=`=== LAYER 3: LIVE SESSION ===
Customer: ${s.customer_name} (@${s.customer_username||'?'})
Subscription: ${s.subscription_status||'subscribed'} | Time: ${s.time_on_page||'?'} | Spend: ${s.total_spend||'$0'} | Tips: ${s.tips_spend||'$0'}
CRM Notes: ${s.crm_notes||'none'}
VNs used: ${vns.length?vns.join(', '):'none'}
${s.agent_note?`Agent note: ${s.agent_note}`:''}
${context?`\n=== AGENT OVERRIDE — AUTHORITATIVE (feedback items #6, #8, #36, #37, #38, #40) ===
The agent has typed an explicit directive in the context box for THIS TURN. The agent has session-level context the brain may be missing (customer just sent a dick pic, customer just tipped, customer is wrapping up — situational signals not yet captured in posture/wall/profile).

OVERRIDE PRECEDENCE — this directive WINS over:
- TW lockout (PART 6 Guard 6 — agent override beats TW for the current turn)
- ppv_missed lockout (if the override says pitch, pitch with exclusive_custom framing per Wall doctrine)
- persuasion cap (the cap holds for the session, but this turn follows the agent)
- aftercare auto-triggers (defer for this turn)
- default posture flow

OVERRIDE DOES NOT WIN over: HARD RULES, PART 22 TOS bans, CRM Hard NOs. Doctrine integrity is absolute.

DIRECTIVE:
${context}

END OVERRIDE — execute this directive in your next message.`:''}
${profileContext}
${timeContextBlock}${sextingStateBlock}${tipPrimaryStateBlock}${whaleBuilderStateBlock}

=== KNOWN FACTS ===
You already know his name (${s.customer_name}) and the CRM/memory facts above. NEVER ask for info already listed (name, job, routine) — reference it naturally instead, don't re-ask. Re-asking known info breaks immersion and kills trust instantly. Use his name when it fits, not every message.
${s._sessionFeedback&&s._sessionFeedback.length?`
REJECTED RESPONSES IN THIS SESSION — learn from these mistakes, do not repeat them:
${s._sessionFeedback.map((f,i)=>`Rejection ${i+1}: "${f.rejectedMsg.slice(0,100)}" — Agent feedback: ${f.feedback}`).join('\n')}
Adjust your approach based on this feedback. Do not make the same mistakes.`:''}
${s._lastAnalysis?`
PREVIOUS AI ANALYSIS OF THIS CONVERSATION (act on this — do not ignore it):
Trust Level: ${s._lastAnalysis.trust_level}/5${s._lastAnalysis.trust_reason?' — '+s._lastAnalysis.trust_reason:''}
Customer Type: ${s._lastAnalysis.archetype}${s._lastAnalysis.archetype_reason?' — '+s._lastAnalysis.archetype_reason:''}
Temperature: ${s._lastAnalysis.temperature}
Current Phase: ${s._lastAnalysis.phase}
What last message achieved: ${s._lastAnalysis.message_purpose}
Recommended next move: ${s._lastAnalysis.next_move}
${s._lastAnalysis.warning?`WARNING: ${s._lastAnalysis.warning}`:''}
Use this analysis to inform your next message. If the analysis flags a warning, adjust your strategy accordingly.`:''}

${(()=>{const g=lastReplyGapContext(msgs);if(!g) return '';return `\nREPLY GAP CONTEXT (read before deciding posture):\nCustomer's last message arrived: ${g.bucket} (${g.minutesAgo} min ago)\nScenario: ${g.scenario.toUpperCase().replace(/_/g,' ')}\nGuidance: ${g.guidance}\n`;})()}
CONVERSATION (chronological: OLDEST at top, NEWEST at bottom — your next message continues from the LAST line below. Read every line; don't skim or assume context):
${fmtMsgsForAI(msgs,{modelName:s.creator_model,withTs:true})}

Generate ${s.creator_model}'s next message:`;

  try{
    let response;
    let generatedBy='claude'; // track which model actually wrote the message
    let routeReason='';

    if(api==='claude'){
      // FORCED CLAUDE — still run strategy first (Pass A + posture + depth gate + trust cap are load-bearing; must not be skipped). Strategy output is then injected into the Claude generator system prompt.
      routeReason='forced Claude (strategy-enforced)';
    } else {
      // AUTO or FORCED MISTRAL — strategy first, then route
      btn.textContent='Analyzing (Claude)...';
    }

    {
      // Pass B — compute wall state before building the strategy prompt
      const wallState=computeWallState(s);
      const ladderState=computeLadderState(s,wallState);
      const aftercareActive=s._aftercareMode===true;
      const aftercareContext=s._aftercareContext||'ladder_stop';

      // Pass D — post-close re-entry context.
      // If a day-boundary exists AND new customer msgs have arrived after the boundary, this is
      // a fresh session entry. Fires regardless of current open/closed visibility state —
      // boundary is the authority, not the chip.
      let reentryBlock='';
      if(typeof s._sessionClosedAtMsgCount==='number'){
        const allMsgs=s.messages||[];
        const boundaryIdx=s._sessionClosedAtMsgCount;
        const priorMsgs=allMsgs.slice(0,boundaryIdx);
        const currentMsgs=allMsgs.slice(boundaryIdx);
        const customerMsgsInCurrent=currentMsgs.filter(m=>m.sender==='customer').length;
        if(customerMsgsInCurrent>0){
          // Summarize prior session outcome from the msgs that existed at close time
          const priorPpvs=priorMsgs.filter(m=>m.sender==='ppv');
          const priorPurchases=priorPpvs.filter(m=>m.opened===true);
          const priorMisses=priorPpvs.filter(m=>m.opened!==true);
          const priorPurchaseTotal=priorPurchases.reduce((sum,m)=>sum+(typeof m.price==='number'?m.price:0),0);
          const lastPriorPpv=priorPpvs.length?priorPpvs[priorPpvs.length-1]:null;
          const lastEndedOnPurchase=lastPriorPpv&&lastPriorPpv.opened===true;
          const lastEndedOnMiss=lastPriorPpv&&lastPriorPpv.opened!==true;
          let outcomeSummary='';
          if(priorPurchases.length>0 && lastEndedOnPurchase){
            outcomeSummary=`${priorPurchases.length} PPV purchase${priorPurchases.length>1?'s':''} totaling $${priorPurchaseTotal.toFixed(2)}. Last session ended on a purchase — great high note.`;
          } else if(priorPurchases.length>0 && lastEndedOnMiss){
            outcomeSummary=`${priorPurchases.length} PPV purchase${priorPurchases.length>1?'s':''} totaling $${priorPurchaseTotal.toFixed(2)}, then ${priorMisses.length} missed PPV, then aftercare wound it down on a good high note.`;
          } else if(priorMisses.length>0){
            outcomeSummary=`${priorMisses.length} PPV${priorMisses.length>1?'s':''} sent but unopened. Session ended without a sale.`;
          } else {
            outcomeSummary='No PPVs pitched in prior session. Likely rapport-only or early chat.';
          }
          reentryBlock=`\n=== PASS D SESSION RE-ENTRY — NEW SESSION AFTER CLOSE ===
The prior session was closed ${s._sessionClosedAt}. Since then the customer has sent ${customerMsgsInCurrent} message${customerMsgsInCurrent>1?'s':''} — this is a FRESH session entry, not a continuation.

PRIOR SESSION OUTCOME: ${outcomeSummary}
LIFETIME SPEND: $${wallState.lifetimeSpend}

RE-ENTRY DOCTRINE (follow strictly):
- Do NOT treat any prior PPV miss as a current-session wall. The lockout from the old session is DEAD — wall state above already filters prior-session data.
- Warm re-entry tone. He's coming back to you; that IS the signal. Match his energy, don't chase.
- Pricing floor: if you pitch today, first PPV should be slightly ABOVE tier minimum (he's warm from prior session, not a cold lead). Never below tier min.
- Low pressure today. He already spent recently. Expectation is NOT another big sale today — it's maintaining the relationship for the next one.
- If you pitch once and he doesn't bite, do NOT push. Talk for a while, then safe warm exit (not the cold goodbye script — he earned a warm one).
- Never reference the prior session as "yesterday" / "last time" / "before" unless HE brings it up first. Just pick up naturally.
`;
        }
      }

      // v0.4.4.7: CONVERSATION CACHING (flag-gated, default off). When on, the conversation
      // moves out of the per-turn prompt into a 4th CACHED system block — so the growing chat
      // history is a cheap cache-read each turn instead of full-price input. The strategy's 3
      // system blocks are all stable/cached, so nothing poisons the prefix. Saves on long sessions.
      const _convCacheOn=localStorage.getItem('ss_conv_cache')==='1';
      const _stratConvText=fmtMsgsForAI(msgs,{modelName:s.creator_model});
      const strategyPrompt=`=== PER-TURN STATE — apply the cached LAYER 3 framework rules to this ===
(Training, persona, content library, framework rules and the required JSON schema are in the cached system blocks. Read the state below + the conversation, then return ONLY the JSON per the LAYER 3 schema. If you cannot name which extraction category (a/b/c/d in LAYER 3) your move serves, the move is wrong.)

CUSTOMER: ${s.customer_name} | Lifetime Spend: ${s.total_spend||'$0'} | Time on page: ${s.time_on_page||'?'} | Status: ${s.subscription_status}
CRM: ${s.crm_notes||'none'}
${(()=>{
  // v0.4.1.4: PPV STATS block (feedback item #10). Surface explicit session/lifetime PPV
  // signals so the strategy pass can ground pricing recommendations in actual buying history
  // rather than inferring from raw spend alone. Kept separate from CRM Notes per request.
  const msgs=s.messages||[];
  const ppvBubbles=msgs.filter(m=>m.sender==='ppv');
  if(ppvBubbles.length===0) return '';
  const opened=ppvBubbles.filter(m=>m.opened===true);
  const prices=ppvBubbles.map(m=>typeof m.price==='number'?m.price:null).filter(p=>p!=null);
  const avg=prices.length?(prices.reduce((a,b)=>a+b,0)/prices.length).toFixed(0):'?';
  const max=prices.length?Math.max(...prices):'?';
  const gross=opened.reduce((sum,m)=>sum+(typeof m.price==='number'?m.price:0),0);
  return `PPV STATS (session): ${opened.length}/${ppvBubbles.length} opened · avg $${avg} · max $${max} · net $${gross.toFixed(0)} unlocked\n`;
})()}${context?`\n=== AGENT OVERRIDE — AUTHORITATIVE FOR THIS TURN ===
DIRECTIVE: ${context}

You MUST reflect this directive in your strategy JSON. If override says "pitch 3rd PPV", set phase to cta1/cta2/sell and next_move_after_wall=continue_climb. If override says "validate then pitch", set message_purpose accordingly. If override says "ask for a tip", treat as a tip-ask CTA. If the override names a FRAMEWORK or specific move to run — "run story framework" → set next_move_after_wall=run_story_framework, "run the promise ritual" → run_promise_ritual, "go to aftercare" → the matching percival_aftercare move — set that move EVEN IF the default auto-gate for it isn't met (e.g. story framework normally needs sell_vs_hold_read=case_5; the agent's explicit command overrides that classification). The override WINS OVER: posture state, wall_detected, TW lockout, persuasion_cap, default ladder progression, and the auto-classification gates on forcing moves. The ONLY guards still in effect are HARD RULES, PART 22 TOS bans, and CRM Hard NOs. Mark "agent_override_active": true in the strategy JSON when an override is present.
=== END OVERRIDE ===`:''}
${s._lastAnalysis?`Previous Analysis: Trust L${s._lastAnalysis.trust_level}/5, ${s._lastAnalysis.archetype}, Phase: ${s._lastAnalysis.phase}`:''}
VNs used: ${vns.length?vns.join(', '):'none'}
POSTURE: ${s._posture} (tier: ${s._customerTier}, free msgs: ${s._freeMsgCount||0}, unpaid CTAs: ${s._unpaidCtaCount||0}, spend: $${s.total_spend||0})
${isPpvMode?`\n!! PPV CAPTION MODE ACTIVE — the agent is SENDING CONTENT RIGHT NOW. This is not a regular reply. Set phase="send_content", caption_required=true, message_length="short". The caption must be pure curiosity — NEVER describe what is in the content, NEVER confirm specific acts.${s._promiseMode==='buildup_only'?' This creator has NO promise ritual — the caption is curiosity + confident anticipation only, NEVER a "promise me / keep this between us" line.':' If promise_status is "not_started", "in_progress", or "verbally_committed", the caption should complete the promise ritual before content is opened (reinforce, do not re-ask, when verbally_committed).'}`:''}
${model.feedback_rules?`Learned rules: ${model.feedback_rules}`:''}
${reentryBlock}
=== PASS B SESSION STATE — WALL + MODE FLAGS ===
PPVs sent this session: ${wallState.ppvSentCount} | Opened (purchases): ${wallState.sessionPurchaseCount} | Missed (unopened after customer moved on): ${wallState.ppvMissedCount}${wallState.ppvMissedAfterChance?' — MISS CONFIRMED':''}
Last message was a purchase: ${wallState.lastMessageWasPurchase?'YES — customer just unlocked PPV':'no'}
Lifetime spend across all sessions: $${wallState.lifetimeSpend}
Has ever spent: ${wallState.hasEverSpent?'YES (proven spender — any hold/pause is earned)':'NO (never spent — no hold earned, do not burn sessions on unproven)'}
Aftercare mode (manual toggle): ${aftercareActive?`ON — ${aftercareContext.toUpperCase()} VARIANT`:'OFF'}
PPV-missed lockout active: ${wallState.ppvMissedAfterChance?'YES — no more standard PPVs this session':'no'}

=== INVESTMENT SIGNALS (v0.4.1.2 — FRAME PROTECTION) ===
${(()=>{
  const inv=detectInvestmentSignals(s);
  const aiMsgCount=s?.messages?.filter(m=>m.sender==='model').length||0;
  const lifetimeSpend=parseFloat((s?._profile?.total_spend||s?.total_spend||0).toString().replace(/[$,]/g,''))||0;
  const sigList=inv.signals.map(x=>x.type).join(', ')||'none';
  const frameHold=inv.count===0&&aiMsgCount>=3&&lifetimeSpend===0;
  let block=`Customer investment signal count: ${inv.count} (signals detected: ${sigList})\n`;
  block+=`Promise ritual gate: ${inv.count>=2?'OPEN — investment floor met, ritual can start':'CLOSED — need 2+ investment signals before promise ritual'}\n`;
  if(frameHold){
    block+=`FRAME-HOLD MODE: ACTIVE — ${aiMsgCount} AI msgs in, zero investment from him, never spent. He is treating creator as a vending machine. Correct response is playful frame-hold (make him chase, make him invest), NOT a pitch. Examples: "slow down babyyy 😂 i don't even know your name yet" / "lol you don't even ask how my day is and want the goods? work for it" / "tell me something about you first". Do NOT advance to pitch even if posture says PROBE/PRESSURE. The frame is the long game.`;
  } else if(inv.count===0&&aiMsgCount<3){
    block+=`Frame-hold: not yet evaluated (only ${aiMsgCount} AI msgs in — too early)`;
  } else if(inv.count>=2){
    block+=`Frame-hold: NOT NEEDED — investment is climbing, ladder progression is earned`;
  } else {
    block+=`Frame-hold: WATCHING — investment is thin (${inv.count}/2), favor breadcrumb + qualifying questions over pitch`;
  }
  return block;
})()}

=== LADDER STATE V2 (v0.4.3.0 — TIER TRACKER + WHALE + PAUSE-PITCHING + PERCIVAL) ===
${(()=>{
  if(!ladderState||ladderState._err) return 'ladder state unavailable';
  const lines=[];
  // Content tier tracker
  const tierStr=ladderState.lastPitchTier
    ?`${ladderState.lastPitchTier}${ladderState.lastPpvPrice!=null?' ($'+ladderState.lastPpvPrice+')':''}${ladderState.lastPpvOpened===true?' — OPENED':ladderState.lastPpvOpened===false?' — not opened':''}`
    :'no PPV pitched yet this session';
  lines.push(`Last PPV tier: ${tierStr}`);
  lines.push(`Pitches this session: ${ladderState.pitchCountSession||0}`);
  lines.push(`Messages since last pitch: ${ladderState.messagesSinceLastPitch||0}`);
  lines.push(`Drift signal: ${ladderState.driftSignal||'ok'}`);

  // Percival fix — recent first-PPV bypass
  if(ladderState.recentFirstPpv){
    lines.push('');
    lines.push('PERCIVAL WINDOW ACTIVE (recent first-PPV): Customer just paid for the first time within the last 4 messages.');
    lines.push('  → Depth gate is BYPASSED for this turn. Match his emotional depth — do NOT clamp creator_target_emotional_level even if his spend would normally cap trust below L4.');
    lines.push('  → He earned upward emotional re-anchor by paying. Reinforce the trust the purchase created.');
  }

  // Whale signal — build vs protect
  if(ladderState.whaleSignal){
    const w=ladderState.whaleSignal;
    lines.push('');
    lines.push(`WHALE SIGNAL: ${w.level.toUpperCase()} — doctrine: ${w.doctrine}`);
    lines.push(`  Reason: ${w.reason}`);
    if(w.doctrine==='BUILD_A_WHALE'){
      lines.push('  → He is over-invested emotionally relative to dollars spent. This is a future whale being BUILT, not a vending-machine to extract from now.');
      lines.push('  → Power calibration: deeper rapport, longer horizon, no aggressive pitch this turn. The right move is connection deepening — set up the LTV, do not blow it for a Tier 1.');
      lines.push('  → If a pitch is naturally available, hold it. Whales spend big over weeks-months; the next pitch lands harder when this turn was patient.');
    } else if(w.doctrine==='PROTECT_WHALE'){
      lines.push('  → Active whale in deep emotional state. Protect the relationship above all else.');
      lines.push('  → No pressure pitches. Aftercare-style depth, reinforcement of the bond, optional high-tier ask only if HE escalates first.');
    }
  }

  // Pause-pitching mode — first-class flag, must be read explicitly
  if(ladderState.pausePitching){
    lines.push('');
    lines.push(`PAUSE-PITCHING MODE: ON — reason: ${ladderState.pauseReason||'unknown'}`);
    lines.push('  → Generator MUST NOT advance the skeleton this turn. Do NOT set skeleton_step to CTA 1, Promise Ritual, Send Content, or CTA 2.');
    lines.push('  → Correct moves: Chit Chat (deepening), Yes Flow (if mid-ritual), or Aftercare (if a prior PPV is being protected).');
    lines.push('  → The seductive move is sitting in the emotional beat. Pitching into devotion/vulnerability/silence-break/vending-machine signal kills the future ladder.');
  }

  return lines.join('\n');
})()}

=== LADDER STATE (v0.4.1.5 — PERSUASION CAP & GOODBYE GUARDS) ===
${(()=>{
  if(!s||!s.messages) return 'no session messages yet';
  // Per-rung pitch attempt counter
  let rungStart=0;
  for(let i=s.messages.length-1;i>=0;i--){
    if(s.messages[i].sender==='ppv'&&s.messages[i].opened===true){rungStart=i+1;break;}
  }
  let rungAttempts=0;
  const pitchPhases=['cta1','cta2','sell','send_content'];
  for(let i=rungStart;i<s.messages.length;i++){
    const m=s.messages[i];
    if(m.sender==='ppv') rungAttempts++;
    else if(m.sender==='model'&&m.phase&&pitchPhases.includes(m.phase)) rungAttempts++;
  }
  const remainingAttempts=Math.max(0,3-rungAttempts);
  const ladderClosed=rungAttempts>=3;
  let block=`Pitch attempts on current rung: ${rungAttempts}/3 (${remainingAttempts} remaining before cap fires)\n`;
  if(ladderClosed){
    block+=`LADDER CLOSED FOR SESSION: 3 attempts on current rung exhausted without conversion. Posture is forced TIMEWASTER. DO NOT pitch again this session. Stay warm but go SHORT. When conversation reaches natural close, run goodbye framework (max 4 messages). If he tips/buys/shows new strong investment signals, ladder can reopen — buy resets the rung counter.`;
  } else if(rungAttempts===2){
    block+=`Final attempt warning: 1 pitch attempt remaining on this rung. If next pitch fails, ladder closes for session.`;
  } else if(rungAttempts===1){
    block+=`Soft-no follow-up budget: 2 persuasion attempts remaining on this rung after the initial sell.`;
  } else {
    block+=`Fresh rung: full 3-attempt budget available (1 sell + 2 persuasion).`;
  }
  // Goodbye phase counter
  let goodbyeMsgs=0;
  for(let i=s.messages.length-1;i>=0;i--){
    const m=s.messages[i];
    if(m.sender!=='model') continue;
    if(m.phase==='goodbye'||m.phase==='close') goodbyeMsgs++;
    else break;
  }
  if(goodbyeMsgs>0){
    // Phase progression hint — keeps the brain from collapsing 3-phase goodbye into Phase 1 → exit
    // (the "no money no honey" failure mode where Phase 2 chill chat gets skipped).
    let phaseHint;
    if(goodbyeMsgs>=4) phaseHint='CAP HIT — session must close, one final warm exit line then end.';
    else if(goodbyeMsgs===3) phaseHint='Phase 3 NOW — find a stop + bail excuse + warm goodbye + future hook. This is the LAST goodbye beat.';
    else if(goodbyeMsgs===2) phaseHint='Phase 2 mid — keep the chill chat / vetting going one more beat. Flirty question about his job / life. Do NOT exit yet — exiting now reads as no-money-no-honey.';
    else phaseHint="Phase 1 just landed (cool refusal + pivot). Next beat must be Phase 2 chill chat — friendly non-content topic, vet him while showing she doesn't need his money to enjoy talking. DO NOT skip straight to the exit line — that breaks the abundance frame.";
    block+=`\nGoodbye phase: ${goodbyeMsgs}/4 messages used. ${phaseHint}`;
  }
  return block;
})()}

=== PASS C SESSION STATE — FORCING-MOVE STATE ===
Story framework step: ${s._storyFrameworkStep||0}/9 (beats delivered so far in the session's 9-beat Case-5 arc; 0 = not started, 9 = complete arc)
${s._promiseMode==='buildup_only'?`PROMISE MODE: BUILDUP_ONLY — this creator has NO promise ritual (LAYER 3 rule 9b applies; never run_promise_ritual / run_promise_reinforcement)`:`Promise ritual status: ${s._promiseStatus||'not_started'} (legend in LAYER 3)`}
${(()=>{
  // v0.4.1.5: post-commitment loop guard. Engineering auto-advances state to
  // `verbally_committed` when the customer's reply contains a trust token (see
  // detectPromiseCommitment). Once advanced, this advisory surfaces to remind
  // the strategy + generator that re-asking the opener is the loop bug.
  const ps=s._promiseStatus||'not_started';
  if(ps!=='verbally_committed') return '';
  return `\n\n⚠️ PROMISE STATE = VERBALLY_COMMITTED — DO NOT RE-ASK THE OPENER\nThe customer gave his trust declaration on the previous turn. Engineering has advanced the state. The next beat is the REINFORCEMENT BEAT (one short intimate line acknowledging he passed the test, naming the slight nerves, priming the imminent ship) — NOT another "promise this stays between us" opener. If you generate phase=promise_ritual with next_move_after_wall=run_promise_ritual, the generator template will branch correctly. If you generate a fresh opener anyway, that is the loop bug — the customer already agreed and re-asking shatters the moment.`;
})()}

=== TEMPORAL CONTEXT — READ BEFORE WRITING ANY TIME-RELATED LANGUAGE ===
${(()=>{const now=new Date();const dayName=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][now.getDay()];const monthName=['January','February','March','April','May','June','July','August','September','October','November','December'][now.getMonth()];const hour=now.getHours();const min=String(now.getMinutes()).padStart(2,'0');const ampm=hour>=12?'PM':'AM';const hour12=hour%12||12;let timeBucket;if(hour>=5&&hour<12)timeBucket='morning';else if(hour>=12&&hour<17)timeBucket='afternoon';else if(hour>=17&&hour<21)timeBucket='evening';else timeBucket='late night';return `Current local time: ${dayName}, ${monthName} ${now.getDate()}, ${now.getFullYear()} · ${hour12}:${min} ${ampm} (${timeBucket})`;})()}


${(()=>{
  // v0.3.0.37.5: creator real-life context — entries pulled from creator_status
  // table. Drafts can reference these naturally to feel more authentically alive.
  // Cached on the session at gen-start in generate(), read here.
  const status=s._creatorStatus||[];
  if(!status.length) return '';
  const formatted=status.slice(0,8).map(e=>{
    const ageDays=e.created_at?Math.floor((Date.now()-new Date(e.created_at).getTime())/(1000*60*60*24)):0;
    const ageLabel=ageDays===0?'today':(ageDays===1?'yesterday':ageDays+' days ago');
    return `- [${e.category}] ${e.status_text} (${ageLabel})`;
  }).join('\n');
  return `=== CREATOR REAL-LIFE CONTEXT ===
This is what is actually happening in ${s.creator_model}'s life right now. Use these naturally when relevant — drop a small detail (1-2 words) into a draft when the customer asks "what are you up to" or when you need a real-world anchor that makes her feel like a person, not a script. Do NOT recite all of this. Use sparingly. Stay in character.

${formatted}

RULES:
- Reference at most ONE status entry per draft, and only when it fits the conversation naturally.
- Never list multiple status facts in one message — that reads like a robot reading a profile.
- If customer asks something completely off-topic from her life context, ignore the status — don't force it.
- "Permanent" entries (no expiration) are stable persona facts. Recent dated entries are this-week life. Don't reference week-old events as if they happened today.

`;
})()}
${(()=>{
  // v0.3.0.37.6: behavioral telemetry — inject reply timing / length / engagement
  // signals so the strategy LLM accounts for cooling patterns BEFORE picking a move.
  // This is the micro-signal layer — what's NOT in the words.
  const sig=computeBehavioralSignals(s);
  if(!sig) return '';
  const lines=[];
  lines.push(`Engagement signal: ${sig.signal.toUpperCase()} — ${sig.signalReason}`);
  if(sig.avgGapMin!==null&&sig.lastGapMin!==null){
    lines.push(`Reply gap: this turn ${sig.lastGapMin}min · rolling avg ${sig.avgGapMin}min`);
  }
  if(sig.avgWords!==null){
    lines.push(`Message length: this turn ${sig.lastWords} words · rolling avg ${sig.avgWords} words`);
  }
  if(sig.askDrop) lines.push(`Question-back pattern: he usually asks back, did NOT this turn — engagement note`);
  if(sig.emojiDrop) lines.push(`Emoji pattern: he usually uses emojis, did NOT this turn — tonal shift`);
  return `=== BEHAVIORAL TELEMETRY (read what's NOT in the words) ===
${lines.join('\n')}

INTERPRETATION:
- COOLING means he's pulling back. Do NOT escalate — match his energy lower, lighten the ask, give him space inside the message. Pushing through cooling burns the customer.
- WARMING means he's leaning in. This is the moment to push the ladder forward — CTA, deeper rapport, content tease.
- FLAT is neutral. Read the words, don't read into the timing.
- A single late reply + short message ≠ disengagement if he's still asking questions. Use signal + question-pattern + emoji-pattern together.
- These signals weight the move decision; they don't override doctrine. If wall is detected (objection / soft_no / ppv_missed), wall handling wins.

`;
})()}
`+`=== PASS D SESSION STATE — LADDER TRACKER (anti-drift memory) ===
This block exists to STOP the AI from re-strategizing from scratch every turn and forgetting its own ladder plan. Read it carefully and respect it.

Last pitch tier: ${ladderState.lastPitchTier||'none yet'} ${ladderState.lastPpvPrice!=null?'($'+ladderState.lastPpvPrice+', '+(ladderState.lastPpvOpened?'OPENED':'pending/unopened')+')':''}
Pitches sent this session: ${ladderState.pitchCountSession}
Messages since last pitch: ${ladderState.messagesSinceLastPitch} ${ladderState.driftSignal==='drift'?'⚠️ DRIFT (5+ msgs no pitch — bias toward CTA)':ladderState.driftSignal==='severe_drift'?'⚠️⚠️ SEVERE DRIFT (7+ msgs no pitch — must pitch this turn unless wall fired)':ladderState.driftSignal==='ppv_pending'?'(PPV out, awaiting unlock — no new pitch)':ladderState.driftSignal==='post_land_warmup'?'🌱 POST-LAND WARMUP (PPV just opened — 4-beat warmup REQUIRED before PPV2 setup. Beat 1 react / Beat 2 deepen / Beat 3 rapport / Beat 4 seed. NO new pitch yet. Mirror his energy SOFTER, never more naughty than him.)':ladderState.driftSignal==='post_miss'?'(POST-MISS, just hit lockout — pivot to exclusive_custom or goodbye_script)':ladderState.driftSignal==='drift_post_miss'?'⚠️ POST-MISS DRIFT — wasted msgs after lockout. STOP standard rapport, pivot now':ladderState.driftSignal==='severe_drift_post_miss'?'⚠️⚠️ SEVERE POST-MISS DRIFT — you are bleeding the session. Either fire exclusive_custom framing this turn or run goodbye_script. No more chitchat.':'(within 3-4 beat doctrine)'}
Recent first-PPV bypass: ${ladderState.recentFirstPpv?'YES — depth gate bypassed this turn (Percival fix). Match his emotional depth even if capped trust < 4. He just paid; re-anchor upward.':'no'}
${ladderState.fork?(()=>{
  const f=ladderState.fork;
  const overrides={
    love_framing:`🌹 FORK DETECTED: LOVE_FRAMING (${f.evidence})
PURE DEVOTION — PAUSE-PITCHING MODE ACTIVE.
He is in a vulnerable, emotional, parasocial moment. The skeleton DOES NOT advance this turn. No CTA, no seed, no breadcrumb, no PPV setup. The single move is: deepen the connection. Mirror his weight, name the feeling, take it seriously. One short emotional reply that lands. Do not pivot to playful, do not redirect to content, do not say anything that smells like a sales script. If you turn this into a transaction, you destroy the most valuable signal in the conversation. Whales are built in moments like this. Your job is to NOT BREAK IT.
Override next_planned_move to "rapport_beat" or "qualifying_question" — never any pitch move this turn. The pitch returns naturally after 1-2 deepening beats.`,
    sexual_urgency:`🔥 FORK DETECTED: SEXUAL_URGENCY (${f.evidence})
HE IS IN HEAT — RIGHT NOW. STAY IN HIS REGISTER.
Mirror his sexual heat. Softer than him (one notch below — he leads, you receive), but absolutely IN the same register. Do NOT step out to playful banter, do NOT redirect to "tell me about your day", do NOT cool the temperature. If posture allows a pitch this turn (PROBE+ and not in post_land_warmup), this is a PRIME pitch window — heat closes. If posture does not allow a pitch (still WARM_BUILD or in warmup), keep the heat alive and seed naturally. Banned: any move that breaks his heat. Letting him cool down here is the difference between a $30 conversion and a $0 message.`,
    deflection:`↩️ FORK DETECTED: DEFLECTION (${f.evidence})
HE FLIPPED THE ENERGY BACK. FLIP IT BACK ON HIM IN ONE SHORT LINE.
You MUST NOT answer any earlier question from the creator's side. You MUST NOT explain, justify, or give a mini-speech. Match his length — short, teasing, flips the question. Example: customer says "I think u too wana ask this question" → creator replies "well what brought you here today then, tell me?" — NOT "honestly i wanted to do things on my own terms [...] what about you." This is the most-failed move in v1: creator gets philosophical when the move is to tease and bounce. One short line. Smile in the words. Move on.`,
    silence_breaker:`🌙 FORK DETECTED: SILENCE_BREAKER (${f.evidence})
THIS IS A RE-ENGAGEMENT, NOT A CONTINUATION.
He vanished and came back. Treat this as a soft restart of the relationship arc — but do NOT lose the trust that's already banked. Lead with something fresh — do not reference prior pitches verbatim, do not pick up exactly where it left off. Acknowledge the gap only if it's natural ("hey stranger" energy is fine, "where have you been" is needy). The first 2-3 exchanges in this restart are pure rapport — no CTA this turn unless he himself opens with sexual/buying signal. Re-establish connection first.`
  };
  return '\n'+overrides[f.type]+'\n';
})():''}
${ladderState.whaleSignal?(()=>{
  const w=ladderState.whaleSignal;
  if(w.doctrine==='BUILD_A_WHALE'){
    return `\n🐋 WHALE SIGNAL: BUILD_A_WHALE MODE (${w.reason})
This customer is over-invested emotionally relative to dollars spent. Classic whale-candidate pattern — he is showing L4-L5 emotional depth at L1-L2 trust price points. Whales are NOT made by maxing extraction in the first session; they are made by patient relationship building over weeks/months that earns the right to higher tier asks later.
DOCTRINE OVERRIDE:
- Power calibration: REVERSE — instead of max-extract-now, deepen rapport, qualify deeper (work, life, lonely-points), bank intel
- Pricing: stay at OR BELOW current tier this turn, never push tier-jump in this state
- Time horizon: think 3-6 sessions ahead, not this turn
- Move bias: rapport_beat or qualifying_question; pitch ONLY if he himself escalates physically
- The mistake to avoid: cashing this in with a $30 pitch and breaking the depth. He'll spend $300+ over time if you protect the frame.\n`;
  }
  if(w.doctrine==='PROTECT_WHALE'){
    return `\n🐋 WHALE SIGNAL: PROTECT_WHALE (${w.reason})
Proven spender in deep emotional state. He has earned full register-match — match his weight, take it seriously, no playful deflection of emotional moments. Pitches still allowed when posture supports it, but NEVER from a transactional/clinical register. Every word lands in the relationship frame, not the commerce frame.\n`;
  }
  return '';
})():''}
${ladderState.pausePitching?`\n⏸️ PAUSE-PITCHING MODE: ON
Reason: ${ladderState.pauseReason}
HARD RULE: do NOT advance the skeleton this turn. No CTA, no seed_cta, no send_ppv, no tier_jump_test. Override next_planned_move to "rapport_beat" or "qualifying_question". The pitch returns naturally after 1-2 deepening beats — you are NOT skipping the climb permanently, you are protecting the moment that makes the climb work.\n`:''}
Last turn you planned: ${ladderState.nextPlannedMove||'(no prior plan — first turn or just reset)'} ${ladderState.nextPlannedMoveAtMsg!=null?'(planned at msg #'+ladderState.nextPlannedMoveAtMsg+', current msg count is '+(s.messages?.length||0)+')':''}

${timeContextBlock}${sextingStateBlock}${tipPrimaryStateBlock}${whaleBuilderStateBlock}

${_convCacheOn?'(the full conversation is in the cached CONVERSATION system block above — your analysis must reflect what the LAST customer message actually said, not an averaged read)':`CONVERSATION (chronological: OLDEST at top, NEWEST at bottom — analysis must reflect what the LAST customer message actually said, not an averaged read of the whole arc):
${_stratConvText}`}
`;

      // Cached system blocks — stable per creator/training. First call pays full price,
      // subsequent calls in the 5-min window hit cache at ~10% of input cost.
      // Volatile content (customer, convo, posture) stays in the user message.
      // v0.3.0.23: Layer 2 uses the SAME contentLibraryBlock as the generator call,
      // so strategy and generator share one cache instead of two. This is the
      // single biggest cache-hit-rate lever — was 58%, target 80%+.
      const strategySystem=[
        {type:'text',text:'=== LAYER 1: GLOBAL AGENCY TRAINING ===\n'+globalTraining,cache_control:{type:'ephemeral',ttl:'1h'}},
        {type:'text',text:'=== LAYER 2: MODEL PROMPT — overrides Layer 1 ===\n'+model.prompt+contentLibraryBlock,cache_control:{type:'ephemeral',ttl:'1h'}},
        {type:'text',text:STRATEGY_STATIC_RULES,cache_control:{type:'ephemeral',ttl:'1h'}},
        ...(_convCacheOn?[{type:'text',text:'=== CONVERSATION SO FAR (chronological, oldest top, newest bottom) ===\n'+_stratConvText,cache_control:{type:'ephemeral',ttl:'1h'}}]:[])
      ];

      // v0.3.0.27_2: Haiku removed entirely — strategy always runs on Sonnet 4.6.
      // Haiku was producing false-positive love_framing classifications that
      // cascaded into wrong whale signals + wrong archetype labels (L1 customers
      // tagged Whale-In-Training because of warm-but-not-devoted phrasing).
      const strategyRaw=await callApi(strategySystem,strategyPrompt,2000,'sonnet','strategy_sonnet');
      const strategyClean=strategyRaw.replace(/```json|```/g,'').trim();
      sessions[sessionId]._lastStrategyRaw=strategyRaw; // for debugging
      let strategyJson;
      strategyJson=safeParseStrategy(strategyClean);
      // If parse + repair both failed, re-request once with an explicit error note.
      // This is separate from the violation-retry below; parse-failure retry must happen first.
      let parseRetryRawLog=null;
      if(!strategyJson&&!s._strategyParseRetried){
        s._strategyParseRetried=true;
        const parseRetryPrompt=strategyPrompt+'\n\n=== YOUR PREVIOUS OUTPUT WAS NOT VALID JSON — FIX IT ===\nCommon causes: unescaped double quotes inside string values, unescaped newlines, raw tabs. All string values must be valid JSON strings:\n- Escape inner double quotes as \\\\\"\n- Replace literal newlines inside strings with \\\\n\n- When quoting a customer message, paraphrase it in your own words instead of copying it verbatim, to avoid quote/escape issues.\nReturn the same JSON schema, corrected.';
        try{
          const parseRetryRaw=await callApi(strategySystem,parseRetryPrompt,2000,'sonnet','strategy_parse_retry_sonnet');
          parseRetryRawLog=parseRetryRaw;
          sessions[sessionId]._lastStrategyRetryRaw=parseRetryRaw;
          const parseRetryClean=parseRetryRaw.replace(/```json|```/g,'').trim();
          strategyJson=safeParseStrategy(parseRetryClean);
        }catch(e){console.warn('[STRATEGY RETRY] callApi threw:',e.message);}
      }
      s._strategyParseRetried=false;
      if(!strategyJson){
        console.error('=== STRATEGY PARSE TOTAL FAILURE — DUMP ===');
        console.error('FIRST RAW RESPONSE:\n',strategyRaw);
        console.error('FIRST RAW LENGTH:',strategyRaw?.length);
        console.error('RETRY RAW RESPONSE:\n',parseRetryRawLog);
        console.error('RETRY RAW LENGTH:',parseRetryRawLog?.length);
        console.error('=== END DUMP ===');
        throw new Error('Claude strategy parse failed after repair + retry — Claude returned malformed JSON twice. Try regenerating. (Check console for raw response dump.)');
      }

      // ── PASS A: validate → retry once → clamp ─────────────────
      let violations=validateStrategy(strategyJson,s,ladderState);
      if(violations.length&&!s._strategyRetried){
        s._strategyRetried=true;
        const retryPrompt=strategyPrompt+'\n\n=== YOUR PREVIOUS OUTPUT HAD VIOLATIONS — FIX THEM ===\n'+violations.map(v=>'- '+v).join('\n')+'\n\nReturn corrected JSON. Same schema, same rules.';
        try{
          const retryRaw=await callApi(strategySystem,retryPrompt,2000,'sonnet','strategy_violation_retry_sonnet');
          const retryClean=retryRaw.replace(/```json|```/g,'').trim();
          const retryJson=safeParseStrategy(retryClean);
          if(retryJson) strategyJson=retryJson;
        }catch(e){/* keep original on retry failure */}
        violations=validateStrategy(strategyJson,s,ladderState);
      }
      s._strategyRetried=false;
      s._strategyViolations=violations.length?violations:null;

      // Clamp by posture + depth gate + register-match — deterministic, do not trust Claude to remember
      const cappedTrustForClamp=s._profile?capTrustBySpend(s._profile.trust_level||1,s._profile.total_spend||0):1;
      clampStrategyByPosture(strategyJson,s._posture);
      clampStrategyByDepthGate(strategyJson,cappedTrustForClamp,ladderState);
      clampStrategyByRegisterMatch(strategyJson,s._posture,s);

      // v0.3.0.29: re-validate after deterministic clamps — clamps may have fixed
      // some of the violations the LLM couldn't self-correct, so the user-facing
      // warning should reflect post-clamp state. If violations are now empty,
      // clear the warning so we don't mislead the agent.
      const postClampViolations=validateStrategy(strategyJson,s,ladderState);
      s._strategyViolations=postClampViolations.length?postClampViolations:null;

      sessions[sessionId]._lastStrategy=strategyJson;

      // ── FOLDED ANALYSIS (v0.3.0.22): use strategy's analysis fields to update profile ──
      // Previously a separate runAnalysis() call with own system prompt + 1500 output tokens.
      // Now strategy returns trust_level/archetype/temperature/key_details/message_purpose
      // inline, so we just pipe them into the same profile-update path.
      try{
        const analysisFromStrategy={
          trust_level:strategyJson.trust_level||1,
          trust_reason:strategyJson.trust_reason||'',
          archetype:strategyJson.archetype||'Unknown',
          archetype_reason:strategyJson.archetype_reason||'',
          temperature:strategyJson.temperature||'cold',
          temperature_reason:strategyJson.temperature_reason||'',
          phase:strategyJson.phase||'rapport',
          phase_reason:strategyJson.skeleton_step_justification||'',
          message_purpose:strategyJson.message_purpose||strategyJson.strategy||'',
          next_move:strategyJson.next_move||'',
          key_details:strategyJson.key_details||'',
          warning:strategyJson.warnings||null
        };
        const spendForCap=effectiveLifetimeSpend(s._profile,s); // v0.4.4.0: PPV + tips
        analysisFromStrategy.trust_level=capTrustBySpend(analysisFromStrategy.trust_level,spendForCap);
        // v0.3.0.37.2: independent verifier — surface drift between rendered intel
        // and ground truth as warnings on the analysis itself.
        const auditWarns=auditAnalysisVsGroundTruth(analysisFromStrategy,sessions[sessionId]);
        analysisFromStrategy._auditWarnings=auditWarns;
        if(auditWarns.length){
          console.warn('[verifier]',auditWarns.length,'audit warning(s):',auditWarns);
        }
        sessions[sessionId]._lastAnalysis=analysisFromStrategy;
        // Render in coach panel if active
        if(sessionId===activeId){
          const cb=document.getElementById('coachBody');
          if(cb) renderAnalysis(analysisFromStrategy,cb,false);
        }
        // Persist profile update (fire-and-forget — don't block strategy flow)
        updateProfile(s,analysisFromStrategy).catch(()=>{});
        // Update in-memory profile so subsequent turns see fresh trust/archetype
        sessions[sessionId]._profile={
          ...(sessions[sessionId]._profile||{}),
          trust_level:analysisFromStrategy.trust_level,
          archetype:analysisFromStrategy.archetype,
          temperature:analysisFromStrategy.temperature,
          key_details:analysisFromStrategy.key_details
        };
        recomputePosture(sessions[sessionId]);
        if(sessionId===activeId){
          updateProfileDisplay(sessions[sessionId]._profile);
          updatePostureChip();
        }
      }catch(e){console.warn('[FOLDED ANALYSIS] update failed:',e.message);}

      // ── PASS D: PERSIST PLANNED MOVE FOR NEXT TURN ─────────────
      // Anti-drift: this commits the LLM to a forward plan. Next turn's
      // computeLadderState reads s._nextPlannedMove and feeds it back into
      // the prompt, so the LLM sees its own previous plan and is told to
      // execute it unless a wall fires.
      //
      // v0.4.1.5: state advancement is DEFERRED to acceptDraft(). On reject,
      // _pendingPassCAdvance is discarded so the brain re-enters the same state
      // on regenerate (beat 4 stays beat 4 — see rejectDraft()).
      sessions[sessionId]._pendingPassCAdvance={};
      const _pendingAdv=sessions[sessionId]._pendingPassCAdvance;
      if(strategyJson.next_planned_move){
        _pendingAdv.nextPlannedMove=strategyJson.next_planned_move;
        _pendingAdv.nextPlannedMoveAtMsg=(s.messages||[]).length;
      }
      _pendingAdv.ladderState=ladderState;
      _pendingAdv.ladderStatePlannedMove=strategyJson.next_planned_move;
      // Refresh diagnostic panel if open and viewing this session
      if(sessionId===activeId && diagOpen){try{renderDiag();}catch(e){}}

      const convoForGenerator=fmtMsgsForAI(msgs,{modelName:s.creator_model,customerLabel:'Customer'})+`\n\nNow write ${s.creator_model}'s next message:`;

      // Decide who generates
      let useMistral=false;
      if(api==='mistral'){
        useMistral=true;
        routeReason='forced Mistral';
      } else if(api==='claude'){
        useMistral=false;
        // routeReason already set above to 'forced Claude (strategy-enforced)'
      } else if(api==='auto'){
        // Auto route: Claude's tier judgment decides
        if(strategyJson.unlocked_tier==='explicit'){
          useMistral=true;
          routeReason='auto → Mistral ('+(strategyJson.tier_reason||'explicit tier')+')';
        } else {
          useMistral=false;
          routeReason='auto → Claude ('+(strategyJson.tier_reason||'standard tier')+')';
        }
      }
      // v0.4.4.5: stash the route for the ToS auto-retry block below — that block sits
      // outside this lexical scope, and referencing `useMistral` there threw a
      // ReferenceError that silently killed the generation on the retry path's very
      // first live firing (found in the v0.4.4.5 live matrix; the path had never run).
      sessions[sessionId]._lastRouteUsedMistral=useMistral;

      // Build a strategy-aware system for Claude (same rules Mistral gets, appended to Claude's rich system)
      const bool=v=>v===true||v==='true';
      const fb=(v,d='n/a')=>(v===undefined||v===null||v==='')?d:v;

      // ── PASS B: WALL ENFORCEMENT ──────────────────────────────
      // Deterministic overrides based on server-computed wall state.
      // These take precedence over what the LLM put in next_move_after_wall.
      let wallEnforcementBlock='';
      // v0.4.1.4: agent override precedence (Cluster B doctrine + PART 6 Guard 6).
      // When the brain sets agent_override_active=true in its strategy JSON, it has
      // acknowledged the agent's context-box directive and is respecting it. In that
      // case, defer the aftercare and ppv_missed hard blocks for THIS turn so the
      // override can actually execute (e.g. "pitch 3rd PPV" wins over miss-lockout).
      // The state flags themselves don't change — they stay live in the session record,
      // and re-assert on the next turn if no override is present then.
      const agentOverrideActive=!!strategyJson.agent_override_active;
      if(agentOverrideActive){
        wallEnforcementBlock+='\n\n!! AGENT OVERRIDE ACTIVE — wall enforcement deferred for this turn. The agent has explicit directives in the context box that the brain is honoring. Aftercare and ppv_missed locks (if any) are paused for this single turn only.';
      }
      // 1. If aftercare mode is manually ON → hard inject Percival template, block pitching
      //    (skipped when agent override is active)
      if(aftercareActive && !agentOverrideActive){
        wallEnforcementBlock+='\n\n'+buildAftercareTemplate(aftercareContext);
        wallEnforcementBlock+='\n!! HARD BLOCK: aftercare mode is ON. Do not pitch content. Do not set up a CTA. Do not send a PPV. Do not ask him to tip. The only valid output is the Percival formula above.';
      }
      // 2. If PPV-missed lockout is active → block standard PPVs, allow only exclusive-custom framing
      //    (skipped when agent override is active)
      if(wallState.ppvMissedAfterChance && !agentOverrideActive){
        wallEnforcementBlock+='\n\n!! PPV-MISSED LOCKOUT ACTIVE: a PPV sent this session went unopened. No more standard PPVs this session. If the customer asks for content, the ONLY valid move is never-done-before exclusive framing ("i never do this but for you...") combined with pay-what-you-can pricing ("tip me what you can and i will make something special"). Absolutely no standard-priced PPV pitches, no matter what the strategy suggested.';
        // Log ppv_missed event once per session (transition from not-missed to missed)
        if(!sessions[sessionId]?._ppvMissLogged && sb){
          sessions[sessionId]._ppvMissLogged=true;
          sb.from('aich_events').insert({
            session_id:sessionId,
            creator_model:sessions[sessionId].creator_model,
            customer_username:sessions[sessionId].customer_username,
            event_type:'ppv_missed',
            payload:{
              ppvs_sent_session:wallState.ppvSentCount,
              ppvs_missed_session:wallState.ppvMissedCount,
              session_purchases:wallState.sessionPurchaseCount,
              posture:sessions[sessionId]._posture||null,
              tier:sessions[sessionId]._customerTier||null
            }
          }).then(()=>{}).catch(e=>console.warn('event log failed:',e.message));
        }
      }
      // 3. Route based on LLM's next_move_after_wall (advisory when no deterministic override fired)
      // v0.4.1.4: when agent override is active, the deterministic blocks above are deferred,
      // so we DO allow this LLM-routed block to fire — the LLM's strategy (now reflecting
      // the agent's directive) gets to choose the next move.
      let nextMove=strategyJson.next_move_after_wall||'continue_climb';

      // v0.4.4.2: buildup-only models have no promise moves. If the brain picked one anyway
      // (habit from the global doctrine), convert it to continue_climb — the buildup happens
      // through the normal climb + the BUILDUP-ONLY prompt block, never a promise template.
      if(s._promiseMode==='buildup_only' && (nextMove==='run_promise_ritual'||nextMove==='run_promise_reinforcement')){
        nextMove='continue_climb';
      }

      // v0.4.4.0 Finding #9 — SESSION-SPENDER ANTI-EXIT GUARD (HARD)
      // Law: ANY customer who has spent this session (opened a PPV OR tipped) is an active
      // buyer. He must NOT be goodbye'd or ladder-stop-exited on a reply-gap / session-end
      // MISREAD. The ladder continues until it LEGITIMATELY closes — a miss-lockout fired,
      // or the persuasion cap (3 attempts/rung) was exhausted. A 10-minute reply gap is a
      // buyer who stepped away, not disengagement. (Bug: a $20 buyer came back and got a
      // cold goodbye because the brain misread the gap as a natural close.)
      // Carve-out: if HE is winding the session down himself ("gotta go", "goodnight"), a
      // WARM relationship close is allowed — immunity means "never exit on a misread", not
      // "trapped forever". The warm vs cold goodbye is selected in the goodbye branch below.
      let warmCloseForSpender=false;
      let sessionSpenderKeepClimbing=false;
      {
        const ladderTrulyClosed=!!wallState.ppvMissedAfterChance || !!ladderState.ladderClosedForSession;
        if(wallState.sessionHasSpend && !ladderTrulyClosed){
          const lastCust=[...(s.messages||[])].reverse().find(m=>m.sender==='customer');
          const windDownPat=/\b(gotta go|got to go|have to go|gtg|heading (to bed|out|off)|going to bed|off to bed|good ?night|night night|nighty|talk (later|tomorrow|soon)|ttyl|catch you later|see (you|ya) (later|tomorrow|soon)|i'?m (out|off|leaving|tired|sleepy|exhausted)|need (to )?sleep|bed ?time|early (day|start)|long day tomorrow|call it a night)\b/i;
          const customerWindingDown=!!(lastCust && windDownPat.test(lastCust.text||''));
          const exitMoves=['goodbye_script','percival_aftercare_ladder_stop'];
          if(exitMoves.includes(nextMove)){
            if(customerWindingDown){
              warmCloseForSpender=true; // he's leaving on his own — close warm, not cold
            } else {
              nextMove='continue_climb'; // premature exit on a proven buyer — BLOCK, keep climbing
              sessionSpenderKeepClimbing=true;
            }
          }
        }
      }

      // v0.4.4.1 Fix B — CONTINUED-INTEREST ANTI-GIVE-UP GUARD
      // Parallel to the session-spender guard, but for a customer who is STILL INTERESTED right
      // now (wants more / live heat / pulling for content) even if he hasn't bought this session.
      // The persuasion cap (3 pitches/rung → ladder closed) and the free-count TIMEWASTER are
      // mechanical — they would quit on a guy who is actively asking for more, the most expensive
      // misread there is (the manager had to override it by hand). INTEREST OVERRIDES THE CAP:
      // unlike the spender guard, this does NOT treat a hit persuasion cap as a legit close. The
      // only hard wall that still stops it is a PPV miss-lockout (he ignored content she already
      // sent — that has its own exclusive_custom path). Carve-out: if HE winds down himself, the
      // spender warm-close (above) already handled it, so we skip when warmCloseForSpender is set.
      let interestKeepClimbing=false;
      if(s._continuedInterestProtects && !wallState.ppvMissedAfterChance && !warmCloseForSpender){
        const lastCustI=[...(s.messages||[])].reverse().find(m=>m.sender==='customer');
        const windDownI=/\b(gotta go|got to go|have to go|gtg|heading (to bed|out|off)|going to bed|off to bed|good ?night|night night|talk (later|tomorrow|soon)|ttyl|catch you later|i'?m (out|off|leaving|tired|sleepy|exhausted)|need (to )?sleep|call it a night)\b/i;
        const windingDownI=!!(lastCustI && windDownI.test(lastCustI.text||''));
        const exitMovesI=['goodbye_script','percival_aftercare_ladder_stop'];
        if(exitMovesI.includes(nextMove) && !windingDownI){
          nextMove='continue_climb'; // he still wants it — do NOT quit on him
          interestKeepClimbing=true;
        }
      }

      if((!aftercareActive && !wallState.ppvMissedAfterChance) || agentOverrideActive || sessionSpenderKeepClimbing || interestKeepClimbing){
        if(nextMove==='percival_aftercare_ladder_stop'){
          wallEnforcementBlock+='\n\n'+buildAftercareTemplate('ladder_stop');
          wallEnforcementBlock+='\n!! Soft-no detected from a proven spender. Running ladder-stop aftercare. No pitch. No CTA. No content ask.';
        } else if(nextMove==='percival_aftercare_aftersex'){
          wallEnforcementBlock+='\n\n'+buildAftercareTemplate('aftersex');
          wallEnforcementBlock+='\n!! Post-climax aftercare detected. Run aftersex variant. No pitch. No setup for next.';
        } else if(nextMove==='goodbye_script'){
          if(warmCloseForSpender){
            // v0.4.4.0 Finding #9: he SPENT this session and is winding down on his own.
            // This is NOT the cold never-spent goodbye — it's a warm relationship close that
            // leaves the door wide open. He's a proven buyer; treat the close like a girlfriend
            // saying goodnight to someone she likes, not a frame-hold exit.
            wallEnforcementBlock+='\n\n!! WARM CLOSE (proven spender winding down): he spent with you this session and he is the one ending the chat. Send him off warm and personal — reference something from THIS conversation, make him feel he is leaving something good, leave the door open for next time. No frame-hold, no abundance-flex, no "I do not need your money" energy (that is for never-spent lurkers, not him). Example energy: "go get some rest babe, today was honestly so fun with you 🤍 talk tomorrow?" ONE or two short lines. Warm, specific, door open.';
          } else {
            wallEnforcementBlock+='\n\n!! GOODBYE SCRIPT (never-spent soft-no twice): run short Phase 1-2-3 — (P1) cool refusal + pivot: "that content is something really special and intimate, i would never just send this to anyone. but i do not mind just talking — tell me about yourself, what do you do for work?" (P2) chill chat + vet: one question to keep it rolling, tease his answer naturally. (P3) smooth exit: "i just realized i have not eaten all day, gonna go grab something — it was nice getting to know you, talk later." Keep it short and warm. No begging, no chasing, no convincing. Do not reopen the content ask.';
          }
        } else if(nextMove==='exclusive_custom_framing'){
          wallEnforcementBlock+='\n\n!! EXCLUSIVE CUSTOM FRAMING: customer wants content after a PPV miss. Frame this as never-done-before exclusive ("i never do this but for you..." / "i do not usually make exceptions but something about you..."). Then pivot to tip-what-you-can pricing — HE sets the price, she delivers something bespoke. Do not quote a fixed price. Do not send a standard PPV.';
        } else if(nextMove==='manager_flag'){
          wallEnforcementBlock+='\n\n!! MANAGER FLAG: objection could not be solved after multiple redirections. SSAI should produce the softest possible holding reply — one short warm line that does NOT push the pitch again and does NOT concede — and the agent will take over. Example energy: "mmh i hear you 🙈 how has your day been otherwise?" Keep it one sentence. Do not attempt another solve.';
          s._managerFlagged=true;
        } else if(nextMove==='run_story_framework'){
          wallEnforcementBlock+='\n\n'+buildStoryFrameworkTemplate(s._storyFrameworkStep||0);
          wallEnforcementBlock+='\n!! STORY FRAMEWORK ACTIVE: Case 5 stuck lurker. Output beats as " - " separated burst. Do NOT pitch. Do NOT reference content.';
        } else if(nextMove==='run_promise_ritual'){
          wallEnforcementBlock+='\n\n'+buildPromiseRitualTemplate(s._promiseStatus||'not_started');
          wallEnforcementBlock+='\n!! PROMISE RITUAL ACTIVE: About to pitch but promise incomplete. Output beats 1-2 as " - " separated burst. Wait for customer to reply before PPV ships.';
        } else if(nextMove==='run_promise_reinforcement'){
          wallEnforcementBlock+='\n\n'+buildPromiseReinforcementTemplate();
          wallEnforcementBlock+='\n!! PROMISE REINFORCEMENT ACTIVE: PPV1 landed already. Use ONE callback line referencing the existing promise frame, not a full ritual. Then PPV ships next turn.';
        } else if(nextMove==='run_objection_solve'){
          wallEnforcementBlock+='\n\n!! OBJECTION SOLVE MODE: run the training objection script for wall_subtype="'+fb(strategyJson.wall_subtype,'unknown')+'". Purpose = dissolve the objection so he keeps spending. NEVER graceful exit. NEVER back off. NEVER "respect his space." If reasoning drifts toward "accept the no gracefully," correct it — that is assistant drift, not doctrine.';
        } else if(nextMove==='continue_climb' && (wallState.lastMessageWasPurchase || sessionSpenderKeepClimbing)){
          if(sessionSpenderKeepClimbing){
            // v0.4.4.0 Finding #9: the brain tried to exit a proven session-spender on a
            // reply-gap / session-end misread. Overridden. He is an ACTIVE BUYER.
            wallEnforcementBlock+='\n\n!! KEEP-CLIMBING (proven spender — do NOT exit): he has already spent this session. A pause or a late reply is him stepping away, NOT disengagement, NOT a goodbye. You do NOT close, you do NOT run goodbye, you do NOT shift to abundance/frame-hold energy. Pick the ladder back up exactly where it was — warm callback to what you were doing, re-anchor the scene, then continue toward the next rung. The only things that end his session: HE says he is leaving, a miss-lockout, or the persuasion cap. None of those happened. Continue.';
          } else {
            wallEnforcementBlock+='\n\n!! POST-PURCHASE KEEP-CLIMBING: he just landed a purchase. The ladder continues automatically. Do NOT say goodbye, do NOT close the session, do NOT thank-and-exit. The next move is the next rung — deeper rapport, callback, or natural setup for the next ask. He spent, now deepen and continue.';
          }
        }
      }

      const strategyEnforcementBlock=`\n\n=== STRATEGY FOR THIS MESSAGE — EXECUTE EXACTLY ===
Customer's last message read: ${fb(strategyJson.last_message_read,'responding to his last message')}
Phase: ${fb(strategyJson.phase,'rapport')}
Ritual step: ${fb(strategyJson.ritual_step,'engage naturally')}
Promise status: ${fb(strategyJson.promise_status,'not_started')}
Customer language: ${fb(strategyJson.customer_language,'english')}
Tone: ${fb(strategyJson.tone,'warm, flirty')}
Wall detected: ${fb(strategyJson.wall_detected,'none')}${strategyJson.wall_subtype&&strategyJson.wall_subtype!=='n/a'?' ('+strategyJson.wall_subtype+')':''}
Sell vs hold read: ${fb(strategyJson.sell_vs_hold_read,'unknown')}
Next move after wall: ${fb(strategyJson.next_move_after_wall,'continue_climb')}
!! DEFLECTION CHECK: If "Customer's last message read" above mentions deflection, tease, flip-back, redirect, or flipping the question back — you MUST NOT answer any earlier question from the creator's side. Flip the energy back in ONE short line. No explanation. No mini-speech. Match his length. Example: customer says "I think u too wana ask this question" → creator replies "well what brought you here today then, tell me?" NOT "honestly i wanted to do things on my own terms [...] what about you."
${bool(strategyJson.caption_required)?`!! CAPTION REQUIRED: ${fb(strategyJson.caption_guidance,'curiosity only, never reveal content')}`:''}
${strategyJson.price_rule&&strategyJson.price_rule!=='n/a'?`!! PRICE RULE: ${strategyJson.price_rule}`:''}
${strategyJson.pricing_anchor&&strategyJson.pricing_anchor!=='n/a'?`!! PRICING ANCHOR: ${strategyJson.pricing_anchor} (use this tier-minimum if price becomes unavoidable — never go below it based on avg spend)`:''}
${strategyJson.reason_to_buy&&strategyJson.reason_to_buy!=='n/a'?`!! REASON TO BUY: ${strategyJson.reason_to_buy}`:''}
${strategyJson.language_rule&&strategyJson.language_rule!=='n/a'?`!! LANGUAGE RULE: ${strategyJson.language_rule}`:''}
${strategyJson.content_safety_check&&strategyJson.content_safety_check!=='n/a'?`!! CONTENT SAFETY: ${strategyJson.content_safety_check}`:''}
${strategyJson.forbidden_in_this_message?`!! DO NOT DO THESE THINGS:\n${strategyJson.forbidden_in_this_message}`:''}
${strategyJson.warnings?`!! WARNING: ${strategyJson.warnings}`:''}
!! POWER CALIBRATION: customer sexual ${fb(strategyJson.customer_sexual_level,'?')}/10 (${fb(strategyJson.customer_sexual_level_reason,'')}), emotional ${fb(strategyJson.customer_emotional_level,'?')}/10 (${fb(strategyJson.customer_emotional_level_reason,'')}). Creator targets sexual ${fb(strategyJson.creator_target_sexual_level,'?')}/10, emotional ${fb(strategyJson.creator_target_emotional_level,'?')}/10. Stay at or below target — never above customer, never more than 2 below. Acknowledge his energy without matching it. Do not lead, do not ignore.
!! POWER POSITION: ${fb(strategyJson.power_position_check,'preserves')}. Creator is the prize, he pursues.
!! SKELETON STEP: ${fb(strategyJson.skeleton_step,'Chit Chat')} — ${fb(strategyJson.skeleton_step_justification,'')}. This message must execute this step.
${strategyJson._clampedBy?`!! POSTURE CLAMP: ${strategyJson._clampedBy}`:''}
${strategyJson._depthGated?`!! DEPTH GATE: customer under L4 — emotional level capped at 4`:''}${wallEnforcementBlock}

These rules are non-negotiable. If strategy says "do not state a price number," do not write one. If promise_status is not_started and you're about to sell content, build the promise first. If customer_language is not english, acknowledge warmly in english but do not switch. If a wall-enforcement block is present above, it OVERRIDES any pitch instruction — wall handling beats ladder climbing.`;

      // Append strategy block to the last system block (the rules block)
      const systemForClaude=systemBlocks.map((b,i)=>i===systemBlocks.length-1?{...b,text:b.text+strategyEnforcementBlock}:b);

      if(useMistral){
        const hasKey=localStorage.getItem('ss_openrouter');
        if(!hasKey){
          // Fallback to Claude if no Mistral key — use strategy-aware system
          btn.textContent='No Mistral key — using Claude...';
          response=await callApi(systemForClaude,user,200,null,'generator_fallback');
          generatedBy='claude';
          routeReason='wanted Mistral but no OpenRouter key — fell back to Claude (strategy enforced)';
        } else {
          btn.textContent='Generating (Mistral)...';
          response=await callMistral(model.prompt,strategyJson,convoForGenerator,s.creator_model,200,model.content_library,wallEnforcementBlock);
          generatedBy='mistral';
        }
      } else {
        // Auto → Claude — use strategy-aware system so all the rules Mistral would get are injected
        btn.textContent='Generating (Claude)...';
        response=await callApi(systemForClaude,user,200,null,'generator');
        generatedBy='claude';
      }

      // ── LAYER 1 — REGISTER FILTER (post-generation, pre-commit) ─
      // Catches store-voice vocabulary that breaks relationship register.
      // Doctrine: one word of store-voice undoes 20 messages of rapport.
      // If hit, regenerate once with correction block. Max 1 retry. PPV captions exempt.
      if(!isPpvMode){
        // v0.3.0.37: strip LLM reasoning leaks BEFORE register filter and before
        // any further pipeline step. The model occasionally emits chain-of-thought
        // or self-correction blocks between two draft attempts. If those reach
        // the agent, they can be sent to a real customer — instant persona break.
        const leakResult=stripReasoningLeaks(response.trim());
        if(leakResult.leaked){
          console.warn('[reasoning leak]',leakResult.blocks_removed,'block(s) removed');
          if(leakResult.clean){
            response=leakResult.clean;
            sessions[sessionId]._reasoningLeakStripped=leakResult.blocks_removed;
          } else {
            // Whole response was reasoning — fall back to safe placeholder and flag
            response='[generation failed register check — please regenerate]';
            sessions[sessionId]._reasoningLeakBlock=true;
            console.error('[reasoning leak] ALL blocks were reasoning — generator returned no usable draft');
          }
        }
        const firstDraft=response.trim();
        const registerHits=registerFilterCheck(firstDraft);
        if(registerHits.length>0){
          btn.textContent='Fixing register...';
          const correction=`\n\n=== POST-PURCHASE REGISTER — MANDATORY CORRECTION ===\nYour previous draft used store-voice vocabulary that breaks the relationship frame. Offending terms: ${registerHits.map(h=>'"'+h+'"').join(', ')}.\n\nYou are HIS GIRLFRIEND, not a store. Post-purchase and pre-purchase language must stay in the relationship register, not the commerce register.\n\nFORBIDDEN phrases: "paycheck", "when you get paid", "till you get paid", "worth it", "worth every penny", "pay for", "when you pay", clingy pleas like "wait before you go" or "i wanna know you're thinking of me", transactional closings like "promise me you'll open it when you get paid".\n\nWHY this matters: these words remind him he is in a transaction. One word of store-voice undoes twenty messages of rapport. Girlfriends don't talk about paychecks — they talk about missing him, thinking about him, the rest of his night, how he makes her feel.\n\nRewrite the same message. Same intent, same length, relationship register. One message only, no labels, no explanation.`;
          try{
            let retryResponse;
            if(useMistral&&localStorage.getItem('ss_openrouter')){
              // Mistral retry — append correction to convo context (Mistral system prompt is built inside callMistral)
              retryResponse=await callMistral(model.prompt,strategyJson,convoForGenerator+'\n\n[RETRY — previous draft failed post-purchase register filter. Offending terms: '+registerHits.join(', ')+'. Rewrite in relationship register, not commerce register.]',s.creator_model,200,model.content_library,wallEnforcementBlock);
            } else {
              const systemForRetry=systemForClaude.map((b,i)=>i===systemForClaude.length-1?{...b,text:b.text+correction}:b);
              retryResponse=await callApi(systemForRetry,user,200,null,'generator_retry');
            }
            const retryClean=retryResponse.trim();
            const retryHits=registerFilterCheck(retryClean);
            if(retryHits.length===0){
              // Retry passed — use it
              response=retryResponse;
              sessions[sessionId]._registerRetried=true;
              sessions[sessionId]._registerHitsFirstPass=registerHits;
            } else {
              // Retry still hit — keep first draft, flag for agent review
              sessions[sessionId]._registerRetried=true;
              sessions[sessionId]._registerHitsFirstPass=registerHits;
              sessions[sessionId]._registerHitsPersisted=retryHits;
            }
          }catch(e){
            // Retry failed — keep original draft, filter is quality-gate not blocking
            console.warn('Register filter retry failed:',e.message);
            sessions[sessionId]._registerHitsFirstPass=registerHits;
          }
        }
      }
    }

    // ToS auto-retry (v0.4.3.3): banned-word leakage is hard non-negotiable — applies to BOTH
    // PPV captions and regular drafts. Previously scanForBanned only warned via toast and let
    // the offending draft sit there; now we auto-regenerate once with a correction listing the
    // specific words found. If retry still has banned words, the draft is flagged HARD and the
    // agent must manually rewrite. Matches the register-filter retry shape.
    {
      const draftBeforeTos=response.trim();
      const tosHits=scanForBanned(draftBeforeTos);
      if(tosHits.length>0){
        try{
          if(btn) btn.textContent='Fixing ToS...';
          const tosCorrection=`\n\n=== TOS VIOLATION — MANDATORY CORRECTION ===\nYour previous draft contained word(s) that violate OnlyFans Terms of Service: ${tosHits.map(h=>'"'+h+'"').join(', ')}.\n\nThese words are HARD-BANNED in every message regardless of context. They cannot appear in greetings, captions, replies, or any output. There is no innocent usage exception — even quoting the customer using these words is forbidden.\n\nDOCTRINE PART 22 — full banned categories:\n- Force / Non-consent: choking, caning, flogging, hypnosis, forcing, abduction, kidnapping\n- Animal: bestiality, zoophilia, any animal sexual reference\n- Injury / Torture: strangulation, suffocation, mutilation\n- Age: teen, loli, young, anything implying a minor\n- Sex Work / Real World: meet (in person / for real), prostitution, escort, hookers\n- Drugs / Intoxication: drinking, drunken, chloroform, intoxicated\n- Off-Platform Payments: PayPal, Venmo, CashApp\n- Other Platforms: FansOnly, ManyVids, Fansly\n\nRewrite the same message. Same intent, same length, ZERO banned words. If the customer used a banned word, deflect WITHOUT echoing it ("that's not something we can do here, but..."). One message only, no labels, no explanation.`;
          let tosRetryResponse;
          if(sessions[sessionId]._lastRouteUsedMistral&&localStorage.getItem('ss_openrouter')){
            tosRetryResponse=await callMistral(model.prompt,strategyJson,convoForGenerator+'\n\n[RETRY — previous draft contained TOS-banned word(s): '+tosHits.join(', ')+'. Rewrite with zero banned words.]',s.creator_model,200,model.content_library,wallEnforcementBlock);
          } else {
            const systemForTosRetry=systemForClaude.map((b,i)=>i===systemForClaude.length-1?{...b,text:b.text+tosCorrection}:b);
            tosRetryResponse=await callApi(systemForTosRetry,user,200,null,'generator_tos_retry');
          }
          const tosRetryClean=tosRetryResponse.trim();
          const tosRetryHits=scanForBanned(tosRetryClean);
          if(tosRetryHits.length===0){
            response=tosRetryResponse;
            sessions[sessionId]._tosRetried=true;
            sessions[sessionId]._tosHitsFirstPass=tosHits;
          } else {
            // Both drafts hit — keep first, flag HARD for manual review
            sessions[sessionId]._tosRetried=true;
            sessions[sessionId]._tosHitsFirstPass=tosHits;
            sessions[sessionId]._tosHitsPersisted=tosRetryHits;
          }
        }catch(e){
          console.warn('ToS filter retry failed:',e.message);
          sessions[sessionId]._tosHitsFirstPass=tosHits;
        }
      }
    }

    // Pass C: compute forcing-move state deltas. v0.4.1.5: DEFERRED to acceptDraft —
    // rejected drafts must NOT advance brain state. Deltas land in _pendingPassCAdvance
    // (initialized at Site A above). Applied on accept, cleared on reject.
    try {
      const _strategyJson = sessions[sessionId]?._lastStrategy;
      const appliedNextMove = _strategyJson?.next_move_after_wall;
      const wallFired = _strategyJson?.wall_detected && _strategyJson.wall_detected!=='none';
      const pendingAdv = sessions[sessionId]._pendingPassCAdvance = sessions[sessionId]._pendingPassCAdvance || {};
      // Story framework: advance step by beats delivered, cap at 9
      if(appliedNextMove==='run_story_framework' && !wallFired) {
        const beatsDelivered = countBeatsDelivered(response);
        pendingAdv.storyFrameworkStep = Math.min((sessions[sessionId]._storyFrameworkStep||0) + beatsDelivered, 9);
      }
      // Promise ritual: first delivery flips not_started -> in_progress
      if(appliedNextMove==='run_promise_ritual' && sessions[sessionId]._promiseStatus==='not_started') {
        pendingAdv.promiseStatus = 'in_progress';
      }
      // Wall mid-framework: reset story step (wall kills the arc, start fresh next time)
      if(wallFired && (sessions[sessionId]._storyFrameworkStep||0) > 0 && (sessions[sessionId]._storyFrameworkStep||0) < 9) {
        pendingAdv.storyFrameworkStep = 0; // wall reset wins over the story-advance branch
      }
      // Goodbye script = session end. Auto-close boundary after goodbye draft lands.
      // Note: msg count is CURRENT length — the goodbye draft itself will be added when agent accepts,
      // so the boundary naturally falls before the goodbye message which stays in "old session" history.
      if(appliedNextMove==='goodbye_script' && !sessions[sessionId]._sessionClosedAt) {
        pendingAdv.sessionClosedAt = new Date().toISOString();
        pendingAdv.sessionClosedAtMsgCount = (sessions[sessionId].messages||[]).length;
      }
    } catch(e) { console.warn('Pass C compute failed:',e.message); }

    // v0.4.4.5: emoji no-repeat backstop — strip any emoji used in the last 2 sent model messages.
    const _recentModelTexts=(sessions[sessionId]?.messages||[]).filter(m=>m.sender==='model').slice(-2).map(m=>m.text||'');
    let cleanResponse=dedupeEmoji(sanitizeSlop(response.trim()), _recentModelTexts);
    // Post-generation ToS scan
    const bannedFound=scanForBanned(cleanResponse);
    // Write to the captured session, NOT activeId — agent may have switched
    if(!sessions[sessionId]){return;} // session was closed mid-flight
    sessions[sessionId].draft=cleanResponse;
    sessions[sessionId]._tosWarning=bannedFound.length>0?bannedFound:null;
    sessions[sessionId]._draftBy=generatedBy;
    sessions[sessionId]._draftRoute=routeReason;
    // v0.4.4.0 Finding #3: HONOR THE CLICK + WARN. When the agent clicks PPV mode, that is an
    // explicit instruction to ship content NOW (extends PART 6 GUARD 6 agent-override to the PPV
    // toggle) — the draft IS a PPV caption, full stop. Previously the label was silently stripped
    // whenever the brain's strategy phase wasn't a caption-shipping phase (e.g. it wanted a promise
    // reinforcement beat first), which read as "PPV didn't create / it's bugged". Now: the click
    // wins, AND when the brain disagreed we surface a one-line warning so the agent knows the brain
    // would have run a beat first. Agent is boss, but stays informed.
    const captionShippingPhases=['send_content','cta2','sell'];
    const strategyPhase=sessions[sessionId]?._lastStrategy?.phase||'';
    sessions[sessionId]._draftIsPpv=isPpvMode; // honor the click unconditionally
    sessions[sessionId]._ppvOverrodeBrain=(isPpvMode && !captionShippingPhases.includes(strategyPhase))
      ? (strategyPhase||'a non-caption beat') : null;
    // Register filter badge: clear unless THIS generation set it (the inline retry block above
    // only writes _registerHitsFirstPass when hits occurred). We re-read from session so a
    // clean generation clears the stale badge from a previous dirty one.
    if(!sessions[sessionId]._registerRetried&&!sessions[sessionId]._registerHitsPersisted){
      sessions[sessionId]._registerHitsFirstPass=null;
    }
    // ToS toasts — auto-retry-aware (v0.4.3.3). The retry already ran above before
    // post-gen scan; bannedFound here reflects POST-retry. Three states:
    //   (a) retry happened + clean now → info toast
    //   (b) retry happened + still hit → hard error (both drafts dirty, manual review)
    //   (c) first pass clean (no retry needed) → nothing
    if(sessions[sessionId]._tosRetried&&!sessions[sessionId]._tosHitsPersisted){
      toast('ToS filter caught banned word ('+(sessions[sessionId]._tosHitsFirstPass||[]).join(', ')+') — regenerated','i');
      sessions[sessionId]._tosRetried=false;
    } else if(sessions[sessionId]._tosHitsPersisted){
      toast('⚠ ToS HARD: both drafts contained banned words ('+sessions[sessionId]._tosHitsPersisted.join(', ')+') — DO NOT SEND, rewrite manually','e');
      sessions[sessionId]._tosRetried=false;
      sessions[sessionId]._tosHitsPersisted=null;
    } else if(bannedFound.length>0){
      // No retry ran but post-gen scan still found something (defensive — shouldn't normally happen since auto-retry is upstream)
      toast('ToS Warning: banned words detected — '+bannedFound.join(', '),'e');
    }
    if(sessions[sessionId]._registerRetried&&!sessions[sessionId]._registerHitsPersisted){
      toast('Register filter caught store-voice — regenerated','i');
      sessions[sessionId]._registerRetried=false;
    } else if(sessions[sessionId]._registerHitsPersisted){
      toast('⚠ Register filter: both drafts used store-voice ('+sessions[sessionId]._registerHitsPersisted.join(', ')+') — review before sending','e');
      sessions[sessionId]._registerRetried=false;
      sessions[sessionId]._registerHitsPersisted=null;
    }
    // v0.3.0.37: notify on reasoning-leak strip + clear flags. Flags persist
    // through the same generation so the badge renders, then we clear here so
    // the next clean generation removes the badge.
    if(sessions[sessionId]._reasoningLeakStripped){
      toast('⚠ Reasoning-leak filter stripped '+sessions[sessionId]._reasoningLeakStripped+' self-talk block(s) — review draft','e');
    } else if(sessions[sessionId]._reasoningLeakBlock){
      toast('⚠ Generator returned only reasoning — please regenerate','e');
    }
    respCount++;
    if(sb) await sb.from('aich_sessions').update({last_active_at:new Date().toISOString(),messages_input:JSON.stringify(sessions[sessionId].messages)}).eq('id',sessionId);
    // Log message_sent event for dashboard drift metrics
    if(sb){
      try{
        const sNow=sessions[sessionId];
        const msgsNow=sNow?.messages||[];
        const ppvCount=msgsNow.filter(m=>m.sender==='ppv').length;
        // Find index of last ppv to compute messages_since_last_pitch
        let lastPpvIdx=-1;
        for(let i=msgsNow.length-1;i>=0;i--){
          if(msgsNow[i].sender==='ppv'){lastPpvIdx=i;break;}
        }
        const messagesSinceLastPitch=lastPpvIdx>=0?(msgsNow.length-1-lastPpvIdx):msgsNow.length;
        // Drift-metric cleanliness: log doctrine state at send-time so the dashboard
        // can exclude aftercare and miss-lockout messages from post-pitch drift average.
        // Aftercare is a good close to a good session, not drift. Miss-lockout is the
        // doctrine intentionally pausing standard pitching. Counting either as "drift"
        // false-flags the doctrine working correctly. wallState is recomputed locally
        // (cheap) since the outer-scope value is not in scope here.
        let _aftercareNow=false, _missLockedNow=false;
        try{
          _aftercareNow=sNow?._aftercareMode===true;
          const _w=computeWallState(sNow)||{};
          _missLockedNow=!!_w.ppvMissedAfterChance;
        }catch(_){/* defensive — never block logging */}
        sb.from('aich_events').insert({
          session_id:sessionId,
          creator_model:sNow.creator_model,
          customer_username:sNow.customer_username,
          event_type:'message_sent',
          payload:{
            generated_by:generatedBy,
            route:routeReason,
            is_ppv:!!isPpvMode,
            posture:sNow._posture||null,
            tier:sNow._customerTier||null,
            free_msg_count:sNow._freeMsgCount||0,
            unpaid_cta_count:sNow._unpaidCtaCount||0,
            ppv_count_session:ppvCount,
            messages_since_last_pitch:messagesSinceLastPitch,
            response_length:cleanResponse.length,
            tos_warning:bannedFound.length>0,
            register_caught:!!sNow._registerHitsPersisted,
            aftercare_active:_aftercareNow,
            ppv_miss_locked:_missLockedNow
          }
        }).then(()=>{}).catch(e=>console.warn('event log failed:',e.message));
      }catch(e){console.warn('message_sent log error:',e.message);}
    }
    // Only touch DOM if this session is still the visible one
    if(sessionId===activeId){
      const ctxEl=document.getElementById('ctxIn');if(ctxEl) ctxEl.value='';
      document.getElementById('sResp').textContent=respCount;
      document.getElementById('chatMsgs').innerHTML=renderBubbles();
      scrollChat();
      btn.disabled=false;btn.classList.remove('loading');btn.textContent='Generate Response';
    }
    renderSidebar();
    toast(isPpvMode?'PPV caption ready — review and accept to set price':'Response ready','s');
    // v0.3.0.22: runAnalysis is gone — strategy now returns analysis fields inline.
    // We still need extractCustomerIntel to run for long-term customer intel.
    // v0.4.4.4 COST: intel extraction moved to acceptDraft — was firing on EVERY generate
    // (including regenerations, re-paying intel on identical customer history). Runs on Accept now.
    // PPV price suggestion — fires in two cases:
    // 1. PPV caption mode (agent already clicked PPV before generation)
    // 2. v0.3.0.37.3: Strategy decided next move is Send Content / CTA pitch — pre-warm
    //    the suggestion so it's ready by the time the agent clicks PPV. Cuts ~3-5s
    //    of waiting at the most friction-prone moment.
    const sNow=sessions[sessionId];
    const skel=sNow?._lastAnalysis?.skeleton_step||'';
    const phase=sNow?._lastAnalysis?.phase||'';
    const ppvImminent=skel==='Send Content'||phase==='send_content'||phase==='sell';
    const sugExists=sNow?._ppvSuggestion&&(sNow._ppvSuggestion.loading||typeof sNow._ppvSuggestion.price==='number');
    if(isPpvMode||(ppvImminent&&!sugExists)){
      fetchPpvSuggestion(sessionId,msgs,model,profile);
    }
  }catch(e){
    toast('Error: '+e.message,'e');
    if(sessionId===activeId){
      btn.disabled=false;btn.classList.remove('loading');btn.textContent='Generate Response';
    }
  }
}

async function runAnalysis(sessionId,msgs,model,lastResponse,profile){
  const s=sessions[sessionId];
  if(!s) return; // session closed
  const isActive=()=>sessionId===activeId;
  const cb=isActive()?document.getElementById('coachBody'):null;
  if(cb) cb.innerHTML='<div class="psych-empty"><div style="font-size:10px;color:var(--text3);animation:pulse 1.4s infinite">Analyzing conversation...</div></div>';
  const profileHistory=profile&&profile.trust_level>1?`Previous sessions data — Trust: ${profile.trust_level}/5, Archetype: ${profile.archetype}, Temperature: ${profile.temperature}, Spend: $${profile.total_spend}, Key details: ${profile.key_details}`:'New customer, no previous sessions';

  // Build CURRENT STATE block so Intel sees the same doctrine signals Strategy sees.
  // Without this, Intel runs blind to wall state / posture / framework flags and can contradict Strategy.
  let currentStateBlock='';
  try{
    const wall=computeWallState(s);
    const posture=s._posture||'WARM_BUILD';
    const freeCount=s._freeMsgCount||0;
    const unpaidCtaCount=s._unpaidCtaCount||0;
    const tier=(s._customerTier||'new').toUpperCase();
    const aftercareOn=s._aftercareMode===true;
    const aftercareCtx=s._aftercareContext||'ladder_stop';
    const storyStep=s._storyFrameworkStep||0;
    const promiseStatus=s._promiseStatus||'not_started';
    const sessionClosed=!!s._sessionClosedAt;
    const hasBoundary=typeof s._sessionClosedAtMsgCount==='number';
    const msgsSinceBoundary=hasBoundary?((s.messages||[]).length-s._sessionClosedAtMsgCount):0;

    currentStateBlock=`
CURRENT SESSION STATE (authoritative — Strategy layer uses these exact signals):
- Posture: ${posture} · Free msgs: ${freeCount} · UnpaidCTAs: ${unpaidCtaCount} · Tier: ${tier}
- Sell-vs-hold hint: ${wall.sellHoldHint||'unknown'} · Lifetime spend: $${wall.lifetimeSpend||0}
- PPVs this session: ${wall.ppvSentCount} sent, ${wall.sessionPurchaseCount} purchased, ${wall.ppvMissedCount} missed${wall.ppvMissedAfterChance?' — MISS-LOCKED (no more standard PPVs)':''}
- Last message was purchase: ${wall.lastMessageWasPurchase?'YES':'no'}
- Aftercare mode: ${aftercareOn?`ON (${aftercareCtx})`:'off'}
- Story framework step: ${storyStep}/9${storyStep>0&&storyStep<9?' — IN PROGRESS':''}
- Promise ritual: ${promiseStatus.toUpperCase()}
- Day boundary: ${hasBoundary?`set (${msgsSinceBoundary} msg${msgsSinceBoundary===1?'':'s'} since boundary)${sessionClosed?' — session currently marked closed':' — session reopened for visibility, boundary still in force'}`:'none — single continuous session'}

Use this state when reading next_move and phase. If MISS-LOCKED, next_move must not suggest standard PPV. If aftercare is ON, next_move is connection-deepening not pitch. If boundary is set and msgs-since-boundary > 0, this is a new-day re-entry — prior session data is cold history.`;
  }catch(e){
    currentStateBlock='\nCURRENT SESSION STATE: (unavailable — compute failed, reason: '+(e.message||'unknown').slice(0,80)+')';
  }

  const ap=`Analyze this OnlyFans conversation. Return ONLY raw JSON, no markdown, no backticks.

=== PRIME DIRECTIVE FOR next_move ===
This is a money-extraction system, not a pen-pal system. Every next_move you suggest must either (a) extract money, (b) move customer one rung closer to next extraction, or (c) protect a prior extraction from regret (aftercare). If next_move is "keep building rapport" with no ladder step named, you are drifting into agent-mode — correct to a concrete ladder move. Rapport is the tool, not the goal. The only time rapport-without-pitch is correct is when aftercare mode is ON.

(Training framework is provided as cached system context above — use it as the source of truth for phase, trust levels, and archetype classification.)

MODEL: ${model.name}
CUSTOMER: ${s.customer_name} | Spend: ${s.total_spend||'$0'} | Time: ${s.time_on_page||'?'} | Status: ${s.subscription_status}
CUSTOMER HISTORY: ${profileHistory}
CRM: ${s.crm_notes||'none'}
${currentStateBlock}

CONVERSATION:
${fmtMsgsForAI(msgs,{modelName:model.name,withTs:true})}

LAST GENERATED MESSAGE: ${lastResponse}

Return this exact JSON:
{"trust_level":1,"trust_reason":"one sentence","archetype":"type","archetype_reason":"one sentence","temperature":"cold","temperature_reason":"one sentence","phase":"rapport","phase_reason":"one sentence","message_purpose":"what this message achieves","next_move":"strategy for next 2-3 messages","key_details":"important facts learned about customer to remember long term","warning":null}`;

  try{
    const analysisSystem=[
      {type:'text',text:'Return only valid JSON. No markdown. No backticks.'},
      {type:'text',text:'=== GLOBAL AGENCY TRAINING ===\n'+globalTraining,cache_control:{type:'ephemeral',ttl:'1h'}}
    ];
    const raw=await callApi(analysisSystem,ap,1500,null,'analysis_legacy');
    const clean=raw.replace(/```json|```/g,'').trim();
    const data=safeParseStrategy(clean);
    if(!data){
      console.warn('[ANALYSIS] parse failed. Raw response length:',raw?.length,'\nRaw:\n',raw);
      throw new Error('Analysis JSON parse failed — check console for raw response');
    }
    if(!sessions[sessionId]) return; // session closed mid-analysis
    // Cap AI-assigned trust by spend — hard floors: L2=$0+, L3=$30+, L4=$100+, L5=$250+
    // v0.4.4.0: effective spend (PPV + tips) — tips lift the trust ceiling like PPV spend.
    const spendForCap=effectiveLifetimeSpend(sessions[sessionId]._profile,sessions[sessionId]);
    data.trust_level=capTrustBySpend(data.trust_level,spendForCap);
    // v0.3.0.37.2: independent verifier on this analysis path too
    data._auditWarnings=auditAnalysisVsGroundTruth(data,sessions[sessionId]);
    if(isActive()&&cb) renderAnalysis(data,cb,false);
    sessions[sessionId]._lastAnalysis=data;
    sessions[sessionId]._lastConvo=msgs.map(m=>fmtMsgForAI(m,{modelName:model.name})).join('\n');
    // Update customer profile with new analysis (already capped above)
    await updateProfile(s,data);
    // Refresh profile display
    sessions[sessionId]._profile={...(sessions[sessionId]._profile||{}),trust_level:data.trust_level,archetype:data.archetype,temperature:data.temperature,key_details:data.key_details};
    // Recompute posture — tier may flip if trust/archetype changed
    recomputePosture(sessions[sessionId]);
    if(isActive()){
      updateProfileDisplay(sessions[sessionId]._profile);
      updatePostureChip();
    }
    // Extract customer intel 3s after analysis to stagger API calls
    setTimeout(()=>extractCustomerIntel(sessionId,msgs,model.name),3000);
  }catch(e){
    if(isActive()&&cb) cb.innerHTML=`<div class="coach-empty" style="font-size:11px;color:var(--red)">Analysis failed<br><span style="font-size:10px;color:var(--text3)">${esc(e.message)}</span></div>`;
  }
}

function renderAnalysis(d,container,fromProfile){
  // Temperature to gauge angle: cold=-90, warming=-30, warm=30, hot=90
  const tempAngles={cold:-80,warming:-25,warm:25,hot:75};
  const tempColors={cold:'#5b8dee',warming:'#f0a040',warm:'#3dd68c',hot:'#f06060'};
  const tc=d.temperature||'cold';
  const angle=tempAngles[tc]||0;
  const color=tempColors[tc]||'#5b8dee';
  // Needle endpoint
  const cx=80,cy=85,r=60;
  const rad=(angle-90)*Math.PI/180;
  const nx=cx+r*Math.cos(rad);
  const ny=cy+r*Math.sin(rad);
  // Trust level segments
  const lvlSegs=Array(5).fill(0).map((_,i)=>`<div class="lvl-seg${i<(d.trust_level||1)?' on':''}"></div>`).join('');
  const archColor=d.archetype==='Emotional'?'purple':d.archetype==='Rational'?'blue':d.archetype==='Relationship'?'green':d.archetype==='Skeptical'?'amber':'blue';
  const phaseColor=d.phase==='sell'||d.phase==='aftercare'?'green':d.phase==='link'?'amber':'blue';

  container.innerHTML=`<div class="psych-dash">
    ${fromProfile?`<div class="pre-analysis-note">From saved profile · Generate to refresh</div>`:''}
    ${(()=>{
      const s=sessions[activeId];
      if(!s||!s._strategyViolations||!s._strategyViolations.length) return '';
      return `<div class="pre-analysis-note" style="color:var(--red);background:var(--red-bg);border-left-color:var(--red)" title="${esc(s._strategyViolations.join(' · '))}">⚠️ Strategy violations detected after retry — review</div>`;
    })()}
    ${(d._auditWarnings&&d._auditWarnings.length)?`<div class="pre-analysis-note" style="color:#e6b84d;background:rgba(230,184,77,0.08);border-left:3px solid #e6b84d;padding:6px 9px" title="${esc(d._auditWarnings.join(' · '))}">🔍 Verifier: ${d._auditWarnings.length} drift signal${d._auditWarnings.length>1?'s':''} — hover to see (intel may not match ground truth)</div>`:''}
    ${(()=>{
      // v0.3.0.37.6: behavioral telemetry chip — shows engagement signal at a glance
      const sig=sessions[activeId]?._behavioralSignals;
      if(!sig||sig.signal==='flat') return '';
      const colors={cooling:{bg:'rgba(91,141,238,0.10)',border:'#5b8dee',ic:'❄'},warming:{bg:'rgba(240,160,64,0.10)',border:'#f0a040',ic:'↗'}};
      const c=colors[sig.signal];
      const tip=`Avg gap: ${sig.avgGapMin}min · this turn: ${sig.lastGapMin}min · avg words: ${sig.avgWords} · this turn: ${sig.lastWords}${sig.askDrop?' · stopped asking back':''}${sig.emojiDrop?' · stopped using emojis':''}`;
      return `<div class="pre-analysis-note" style="color:${c.border};background:${c.bg};border-left:3px solid ${c.border};padding:6px 9px" title="${esc(tip)}">${c.ic} Behavioral: ${sig.signal.toUpperCase()} — ${esc(sig.signalReason)}</div>`;
    })()}
    ${renderPpvSuggestCard(sessions[activeId]?._ppvSuggestion)}
    
    <div class="speed-wrap">
      <svg class="speed-svg" viewBox="0 0 160 90" fill="none" xmlns="http://www.w3.org/2000/svg">
        <!-- Arc track -->
        <path d="M 15 85 A 65 65 0 0 1 145 85" stroke="#2a2a2a" stroke-width="8" stroke-linecap="round" fill="none"/>
        <!-- Cold zone -->
        <path d="M 15 85 A 65 65 0 0 1 55 30" stroke="#1a2a4a" stroke-width="8" stroke-linecap="round" fill="none" opacity="0.7"/>
        <!-- Warming zone -->
        <path d="M 55 30 A 65 65 0 0 1 80 20" stroke="#3a2a10" stroke-width="8" stroke-linecap="round" fill="none" opacity="0.7"/>
        <!-- Warm zone -->
        <path d="M 80 20 A 65 65 0 0 1 110 30" stroke="#1a3a20" stroke-width="8" stroke-linecap="round" fill="none" opacity="0.7"/>
        <!-- Hot zone -->
        <path d="M 110 30 A 65 65 0 0 1 145 85" stroke="#3a1a1a" stroke-width="8" stroke-linecap="round" fill="none" opacity="0.7"/>
        <!-- Needle -->
        <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="${color}" stroke-width="2.5" stroke-linecap="round"/>
        <!-- Center dot -->
        <circle cx="${cx}" cy="${cy}" r="4" fill="${color}"/>
        <!-- Labels -->
        <text x="12" y="82" font-size="8" fill="#555" font-family="Inter,sans-serif">cold</text>
        <text x="62" y="16" font-size="8" fill="#555" font-family="Inter,sans-serif" text-anchor="middle">warm</text>
        <text x="136" y="82" font-size="8" fill="#555" font-family="Inter,sans-serif" text-anchor="end">hot</text>
        <!-- Temperature value -->
        <text x="${cx}" y="${cy-12}" font-size="11" fill="${color}" font-family="Inter,sans-serif" text-anchor="middle" font-weight="600">${tc}</text>
      </svg>
    </div>

    <div class="psych-grid">
      <div class="psych-box">
        <div class="psych-box-label">Connection</div>
        <div class="psych-box-value blue">Level ${d.trust_level||1}/5</div>
        <div class="lvl-track">${lvlSegs}</div>
        <div class="psych-box-note">${esc((d.trust_reason||'').slice(0,60))}</div>
      </div>
      <div class="psych-box">
        <div class="psych-box-label">Customer Type</div>
        <div class="psych-box-value ${archColor}">${esc(d.archetype||'Unknown')}</div>
        <div class="psych-box-note">${esc((d.archetype_reason||'').slice(0,60))}</div>
      </div>
      <div class="psych-box">
        <div class="psych-box-label">Phase</div>
        <div class="psych-box-value ${phaseColor}">${esc(d.phase||'rapport')}</div>
        <div class="psych-box-note">${esc((d.phase_reason||'').slice(0,60))}</div>
      </div>
      <div class="psych-box">
        <div class="psych-box-label">Engagement</div>
        <div class="psych-box-value ${d.temperature==='hot'?'red':d.temperature==='warm'?'green':'amber'}">${d.temperature==='hot'?'High':d.temperature==='warm'?'Good':d.temperature==='warming'?'Building':'Low'}</div>
        <div class="psych-box-note">${esc((d.temperature_reason||'').slice(0,60))}</div>
      </div>
    </div>

    ${(()=>{
      const st=sessions[activeId]?._lastStrategy;
      if(!st) return `<div class="psych-full">
        <div class="psych-full-label">Framework Calibration</div>
        <div class="psych-insight" style="color:var(--text3)">— run a generate to populate</div>
      </div>`;
      const cs=(st.customer_sexual_level!=null)?st.customer_sexual_level:'—';
      const ce=(st.customer_emotional_level!=null)?st.customer_emotional_level:'—';
      const ts=(st.creator_target_sexual_level!=null)?st.creator_target_sexual_level:'—';
      const te=(st.creator_target_emotional_level!=null)?st.creator_target_emotional_level:'—';
      const step=st.skeleton_step||'—';
      const power=st.power_position_check||'—';
      const powerClass=String(power).toLowerCase().startsWith('preserves')?'green':String(power).toLowerCase().startsWith('weakens')?'red':'';
      // Mismatch = creator above customer or more than 2 below (should never happen post-clamp)
      const mismatch=(typeof cs==='number'&&typeof ts==='number'&&(ts>cs||(cs>0&&ts<cs-2)))||
                     (typeof ce==='number'&&typeof te==='number'&&(te>ce||(ce>0&&te<ce-2)));
      const borderStyle=mismatch?'border-left-color:var(--amber);border:1px solid var(--amber-bg)':'';
      return `<div class="psych-full" style="${borderStyle}">
        <div class="psych-full-label">Framework Calibration</div>
        <div class="psych-insight" style="line-height:1.8">
          <div><span style="color:var(--text3)">Skeleton Step:</span> <b>${esc(step)}</b></div>
          <div><span style="color:var(--text3)">Customer:</span> Sex <b>${cs}/10</b> · Emo <b>${ce}/10</b></div>
          <div><span style="color:var(--text3)">Creator:</span> Sex <b>${ts}/10</b> · Emo <b>${te}/10</b>${st._clampedBy?` <span style="color:var(--amber);font-size:10px">· ${esc(st._clampedBy)}</span>`:''}${st._depthGated?` <span style="color:var(--purple);font-size:10px">· depth-gated</span>`:''}</div>
          <div><span style="color:var(--text3)">Power:</span> <b class="${powerClass?'a-v '+powerClass:''}">${esc(power)}</b></div>
        </div>
      </div>`;
    })()}

    <div class="psych-full">
      <div class="psych-full-label">Message Purpose</div>
      <div class="psych-insight">${esc(d.message_purpose||'')}</div>
    </div>

    <div class="psych-full">
      <div class="psych-full-label">Next Move</div>
      <div class="psych-insight green">${esc(d.next_move||'')}</div>
    </div>

    ${d.warning?`<div class="psych-full">
      <div class="psych-full-label" style="color:var(--amber)">Warning</div>
      <div class="psych-insight amber">${esc(d.warning)}</div>
    </div>`:''}
  </div>`;
}

// ── COACH Q&A ──────────────────────────────────────────────────
async function askCoach(){
  const inp=document.getElementById('qaIn');
  const q=inp.value.trim();if(!q) return;
  const s=sessions[activeId];
  if(!s._lastAnalysis){toast('Generate a response first','i');return;}
  inp.value='';
  const qm=document.getElementById('qaMsgs');if(!qm) return;
  qm.innerHTML+=`<div class="qa-msg agent">${esc(q)}</div>`;
  qm.innerHTML+=`<div class="qa-msg thinking" id="qaThink">Thinking...</div>`;
  qm.scrollTop=qm.scrollHeight;
  const model=models.find(m=>m.name===s.creator_model);
  const cp=`You are an AI coaching assistant for an OnlyFans agency. Answer the agent's question about the conversation analysis. Be direct, under 80 words, reference the training framework when relevant.

ANALYSIS: ${JSON.stringify(s._lastAnalysis)}
MODEL: ${model?.name}
CONVERSATION: ${(s._lastConvo||'').slice(0,800)}
QUESTION: ${q}`;
  try{
    const ans=await callApi('You are a concise AI coach. Answer directly.',cp,200,null,'coach_qa');
    const t=document.getElementById('qaThink');if(t) t.remove();
    qm.innerHTML+=`<div class="qa-msg ai">${esc(ans.trim())}</div>`;
    qm.scrollTop=qm.scrollHeight;
  }catch(e){
    const t=document.getElementById('qaThink');if(t) t.textContent='Error: '+e.message;
  }
}

let coachCollapsed=false;
function toggleCoach(){
  coachCollapsed=!coachCollapsed;
  const content=document.getElementById('coachContent');
  const panel=document.getElementById('coachPanel');
  const btn=document.getElementById('coachToggleBtn');
  if(!content||!panel) return;
  if(coachCollapsed){
    content.style.display='none';
    panel.style.width='40px';
    panel.style.minWidth='40px';
    if(btn) btn.textContent='≡';
  } else {
    content.style.display='flex';
    content.style.flexDirection='column';
    content.style.flex='1';
    content.style.overflow='hidden';
    panel.style.width='280px';
    panel.style.minWidth='280px';
    if(btn) btn.textContent='≡';
  }
}

function setApi(a){
  // v0.4.1.0: API mode is a manager-only routing decision. Chatters can't change it.
  if(window.currentChatter && window.currentChatter.role !== 'manager'){
    toast('API mode is set by managers','e');
    return;
  }
  api=a;
  localStorage.setItem('ss_api_mode',a);
  const ba=document.getElementById('btnAuto');
  const bc=document.getElementById('btnClaude');
  const bm=document.getElementById('btnMistral');
  if(ba) ba.classList.toggle('on',a==='auto');
  if(bc) bc.classList.toggle('on',a==='claude');
  if(bm) bm.classList.toggle('on',a==='mistral');
  const labels={auto:'Auto',claude:'Claude',mistral:'Mistral'};
  document.getElementById('sApi').textContent=labels[a]||a;
  const coachLabels={auto:'auto route',claude:'via claude',mistral:'claude + mistral'};
  const lbl=document.getElementById('coachApi');
  if(lbl) lbl.textContent=coachLabels[a]||'via '+a;
  // v0.4.1.0: keys live in Edge Function env now — UI keys tab removed. Skip the
  // local-key warning entirely (the proxy returns a clear error if a key is missing).
  const msgs={auto:'Auto mode — Claude routes explicit to Mistral',claude:'Forced Claude',mistral:'Forced Mistral (Claude brain + Mistral generation)'};
  toast(msgs[a]||a,'i');
}

// ── SESSION CRUD ───────────────────────────────────────────────
function openNewSession(){
  updateModelDrop();
  ['ns_name','ns_username','ns_notes','ns_spend','ns_tips','ns_time'].forEach(id=>{document.getElementById(id).value='';});
  document.getElementById('ns_status').value='subscribed';
  document.getElementById('modalNew').style.display='flex';
  setTimeout(()=>document.getElementById('ns_name').focus(),100);
}
function closeNew(){document.getElementById('modalNew').style.display='none';}

async function createSession(){
  const model=document.getElementById('ns_model').value;
  const name=document.getElementById('ns_name').value.trim();
  const username=document.getElementById('ns_username').value.trim().replace('@','');
  if(!model){toast('Model required','e');return;}
  if(!name&&!username){toast('Need customer name OR OF username','e');return;}
  // Both name and username are now optional individually — but at least one must be present.
  // Fallback hierarchy: profile key uses username if available, else sanitized name.
  // Display name uses name if available, else the username (so "Unknown" never shows).
  const profileKey=username||('name_'+name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,''));
  const displayName=name||username;
  // v0.3.0.38: spend fields must coerce to numeric (DB column is numeric, not text).
  // Strips $, commas, whitespace; non-numeric input becomes 0.
  const parseSpend=(v)=>{const n=parseFloat((v||'').toString().replace(/[$,\s]/g,''));return isNaN(n)?0:n;};
  const d={creator_model:model,customer_name:displayName,customer_username:profileKey,crm_notes:document.getElementById('ns_notes').value.trim(),total_spend:parseSpend(document.getElementById('ns_spend').value),tips_spend:parseSpend(document.getElementById('ns_tips').value),time_on_page:document.getElementById('ns_time').value.trim(),subscription_status:document.getElementById('ns_status').value,of_chat_id:(document.getElementById('ns_of_chat_id')?.value||'').trim()||null,agent_note:'',status:'active',is_flagged:false,last_active_at:new Date().toISOString(),messages_input:'[]',free_msg_count:0,unpaid_cta_count:0,current_posture:'WARM_BUILD',story_framework_step:0,promise_status:'not_started',chatter_id:window.currentChatter?.id||null};
  let id='local_'+Date.now();
  if(sb){const{data,error}=await sb.from('aich_sessions').insert(d).select().single();if(!error&&data) id=data.id;}
  sessions[id]={...d,id,messages:[],draft:null,vn_used:[],inputMode:'chat',_freeMsgCount:0,_unpaidCtaCount:0,_posture:'WARM_BUILD',_customerTier:'new',_pendingCtaCheck:null,_sessionLength:0,_storyFrameworkStep:0,_promiseStatus:'not_started',_sessionClosedAt:null,_sessionClosedAtMsgCount:null,_nextPlannedMove:null,_nextPlannedMoveAtMsg:null};
  closeNew();renderSidebar();openSession(id);
  toast(`Session: ${name} / ${model}`,'s');
}

async function closeSession(){
  const s=sessions[activeId];
  // Read-only archived session: just drop from memory, no mutations, no confirm
  if(s&&s._readonly){
    delete sessions[activeId];activeId=null;
    renderSidebar();
    document.getElementById('sessContainer').style.display='none';
    document.getElementById('dashView').style.display='block';
    loadDashMetrics();
    startDashAutoRefresh();
    return;
  }
  if(!await confirmInPage('Close this session? It will go cold and can be reopened.')) return;
  // Write memory before closing if there are accepted messages
  if(s&&s.messages&&s.messages.some(m=>m.sender==='model')){
    writeSessionMemory(activeId);
  }
  // Auto-flag: if posture ever reached TIMEWASTER this session, persist it on the profile
  if(s&&(s._autoFlagged||s._posture==='TIMEWASTER')&&sb&&s.customer_username){
    try{
      await sb.from('customer_profiles').upsert({
        creator_model:s.creator_model,
        customer_username:s.customer_username,
        is_timewaster:true
      },{onConflict:'creator_model,customer_username'});
      // Log auto tw_flagged event (separate from manual flag)
      sb.from('aich_events').insert({
        session_id:activeId,
        creator_model:s.creator_model,
        customer_username:s.customer_username,
        event_type:'tw_flagged',
        payload:{trigger:'auto_on_archive',posture:s._posture,free_msg_count:s._freeMsgCount||0}
      }).then(()=>{}).catch(()=>{});
    }catch(e){console.warn('Auto-flag TW failed:',e.message);}
  }
  // Log session_archived event for dashboard
  if(s&&sb){
    const msgs=s.messages||[];
    const ppvCount=msgs.filter(m=>m.sender==='ppv').length;
    const ppvOpened=msgs.filter(m=>m.sender==='ppv'&&m.opened===true).length;
    const ppvMissed=ppvCount-ppvOpened;
    const totalMsgs=msgs.length;
    const aiMsgs=msgs.filter(m=>m.sender==='model').length;
    sb.from('aich_events').insert({
      session_id:activeId,
      creator_model:s.creator_model,
      customer_username:s.customer_username,
      event_type:'session_archived',
      payload:{
        total_messages:totalMsgs,
        ai_messages:aiMsgs,
        ppvs_pitched:ppvCount,
        ppvs_landed:ppvOpened,
        ppvs_missed:ppvMissed,
        final_posture:s._posture||null,
        final_tier:s._customerTier||null,
        session_spend:parseFloat((s.total_spend||0).toString().replace(/[$,]/g,''))||0,
        auto_flagged_tw:!!(s._autoFlagged||s._posture==='TIMEWASTER'),
        had_aftercare:!!s._aftercareMode || !!s._aftercareWasTriggered
      }
    }).then(()=>{}).catch(()=>{});
  }
  if(sb) await sb.from('aich_sessions').update({status:'archived'}).eq('id',activeId);
  delete sessions[activeId];activeId=null;
  renderSidebar();
  document.getElementById('sessContainer').style.display='none';
  document.getElementById('dashView').style.display='block';
  loadDashMetrics();
  startDashAutoRefresh();
}

// ── SETTINGS ───────────────────────────────────────────────────
function openSettings(){
  // v0.4.1.0: Settings is manager-only. Defense-in-depth in case a chatter ever calls this directly.
  if(window.currentChatter && window.currentChatter.role !== 'manager'){
    toast('Settings are manager-only','e');
    return;
  }
  renderModelCards();
  document.getElementById('globalTraining').value=globalTraining;
  // v0.4.1.0: API Keys tab removed — keys live in Edge Function env, no UI hydration needed.
  // v0.4.0: show Team tab only to managers
  const teamTab=document.getElementById('stab_team');
  if(teamTab) teamTab.style.display=(window.currentChatter?.role==='manager')?'':'none';
  // v0.4.1.0: Feedback Queue tab is also manager-only
  const fbTab=document.getElementById('stab_feedback');
  if(fbTab) fbTab.style.display=(window.currentChatter?.role==='manager')?'':'none';
  document.getElementById('modalSettings').style.display='flex';
}
function closeSettings(){document.getElementById('modalSettings').style.display='none';}

function switchTab(t){
  ['models','status','training','feedback','team'].forEach(x=>{
    const tabEl=document.getElementById('tab_'+x);
    const stabEl=document.getElementById('stab_'+x);
    if(tabEl) tabEl.style.display=x===t?'block':'none';
    if(stabEl) stabEl.classList.toggle('on',x===t);
  });
  if(t==='status') renderStatusCards();
  if(t==='team') loadTeamList();
  if(t==='feedback') loadFeedbackQueue();
}

// v0.3.0.37.5: creator status feed. Per-creator real-life context entries that
// get injected into the strategy prompt so drafts feel like they come from a
// real person with a real life happening around them. Entries auto-expire
// after 7 days unless marked permanent.
const STATUS_CATEGORIES=['location','mood','recent_event','preference','voice_tic','obsession','schedule'];
async function loadCreatorStatus(){
  if(!sb) return {};
  try{
    const {data,error}=await sb.from('creator_status').select('*').order('created_at',{ascending:false});
    if(error){
      // If the table doesn't exist yet, create it via the in-app sb client by
      // attempting a no-op insert that the agent can fix in Supabase. For now,
      // just fall back to empty so the UI still renders.
      if(error.code==='42P01'||/relation.*does not exist/i.test(error.message||'')){
        console.warn('[creator_status] table not yet created — UI will work but persistence is off until table exists');
        return {};
      }
      console.warn('[creator_status] load failed:',error.message);
      return {};
    }
    const byModel={};
    (data||[]).forEach(e=>{
      if(!byModel[e.creator_model]) byModel[e.creator_model]=[];
      byModel[e.creator_model].push(e);
    });
    return byModel;
  }catch(e){return {};}
}
async function renderStatusCards(){
  const wrap=document.getElementById('statusCards');
  if(!wrap) return;
  const byModel=await loadCreatorStatus();
  const activeModels=models.filter(m=>['Cindy','Camila','Jammy'].includes(m.name));
  wrap.innerHTML=activeModels.map(m=>{
    const entries=byModel[m.name]||[];
    return `<div class="mc">
      <div class="mc-head">
        <div class="mc-av">${m.name.slice(0,2).toUpperCase()}</div>
        <div class="mc-title">
          <div class="mc-name">${m.name}</div>
          <div class="mc-tier">${entries.length} active status entr${entries.length===1?'y':'ies'}</div>
        </div>
      </div>
      <div class="mc-section">
        <label class="mc-label">Add new status entry</label>
        <div style="display:flex;gap:6px;margin-bottom:8px">
          <select id="cs_cat_${m.name}" style="background:var(--bg3);border:1px solid var(--border);border-radius:var(--r);padding:6px 8px;color:var(--text);font-size:11px">
            ${STATUS_CATEGORIES.map(c=>`<option value="${c}">${c.replace('_',' ')}</option>`).join('')}
          </select>
          <input class="fi" id="cs_text_${m.name}" placeholder="e.g. just got back from sister's bachelorette in Tulum, dehydrated" style="flex:1">
          <label style="display:flex;align-items:center;gap:4px;font-size:10px;color:var(--text3);white-space:nowrap"><input type="checkbox" id="cs_perm_${m.name}"> permanent</label>
          <button class="btn sm success" onclick="addCreatorStatus('${esc(m.name)}')">Add</button>
        </div>
      </div>
      <div class="mc-section">
        <label class="mc-label">Active entries</label>
        ${entries.length===0?'<div style="font-size:11px;color:var(--text3);font-style:italic">No status entries yet — drafts will use only the persona prompt.</div>':entries.map(e=>{
          const created=new Date(e.created_at);
          const ageMs=Date.now()-created.getTime();
          const ageDays=Math.floor(ageMs/(1000*60*60*24));
          const expires=e.expires_at?new Date(e.expires_at):null;
          const expired=expires&&expires<new Date();
          return `<div style="display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--bg3);border-radius:var(--r);margin-bottom:4px;font-size:11px${expired?';opacity:0.4':''}">
            <span style="color:var(--purple);font-weight:600;text-transform:uppercase;font-size:9px;letter-spacing:0.05em;min-width:80px">${e.category||'note'}</span>
            <span style="flex:1;color:var(--text)">${esc(e.status_text)}</span>
            <span style="color:var(--text3);font-size:10px;white-space:nowrap">${e.expires_at?(expired?'expired':ageDays+'d ago'):'permanent'}</span>
            <button class="btn sm danger" onclick="deleteCreatorStatus('${e.id}')" style="padding:2px 8px;font-size:10px">×</button>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}
async function addCreatorStatus(creatorModel){
  if(!sb){toast('Database not connected','e');return;}
  const cat=document.getElementById('cs_cat_'+creatorModel)?.value||'note';
  const text=document.getElementById('cs_text_'+creatorModel)?.value.trim();
  const perm=document.getElementById('cs_perm_'+creatorModel)?.checked;
  if(!text){toast('Enter status text first','e');return;}
  const expiresAt=perm?null:new Date(Date.now()+7*24*60*60*1000).toISOString();
  try{
    const {error}=await sb.from('creator_status').insert({
      creator_model:creatorModel,
      category:cat,
      status_text:text,
      expires_at:expiresAt
    });
    if(error){
      if(error.code==='42P01'||/relation.*does not exist/i.test(error.message||'')){
        toast('creator_status table not created yet — ask Claude to create it via Supabase MCP','e');
      } else {
        toast('Save failed: '+error.message,'e');
      }
      return;
    }
    document.getElementById('cs_text_'+creatorModel).value='';
    document.getElementById('cs_perm_'+creatorModel).checked=false;
    toast(creatorModel+' status added','s');
    renderStatusCards();
  }catch(e){toast('Save failed: '+e.message,'e');}
}
async function deleteCreatorStatus(id){
  if(!sb) return;
  if(!await confirmInPage('Delete this status entry?','Delete','Cancel')) return;
  try{
    await sb.from('creator_status').delete().eq('id',id);
    toast('Entry deleted','i');
    renderStatusCards();
  }catch(e){toast('Delete failed: '+e.message,'e');}
}

// Cached status entries for the strategy prompt — refreshed on each generation.
async function fetchActiveCreatorStatus(creatorModel){
  if(!sb||!creatorModel) return [];
  try{
    const nowIso=new Date().toISOString();
    const {data,error}=await sb.from('creator_status').select('category,status_text,created_at,expires_at')
      .eq('creator_model',creatorModel)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)
      .order('created_at',{ascending:false})
      .limit(8);
    if(error) return [];
    return data||[];
  }catch(e){return [];}
}

// v0.3.0.37.6: BEHAVIORAL TELEMETRY — read what's NOT in the words.
// Computes per-customer engagement signals from message timestamps and lengths.
// Reads from session messages (current session) + aich_events (cross-session
// history) when available. Returns a block injected into strategy prompt so
// the LLM accounts for cooling/warming patterns BEFORE picking a move.
//
// Returns null when there isn't enough data (need 3+ customer msgs to baseline).
function computeBehavioralSignals(session){
  if(!session||!session.messages) return null;
  const customerMsgs=session.messages.filter(m=>m.sender==='customer'&&m.ts_iso);
  if(customerMsgs.length<2) return null;

  // Reply gaps: between each customer msg and the prior message in any role.
  // (Reply gap = how long he took after the LAST message he saw, regardless of who sent it.)
  const gaps=[];
  for(let i=0;i<session.messages.length;i++){
    const m=session.messages[i];
    if(m.sender!=='customer'||!m.ts_iso) continue;
    if(i===0) continue;
    const prior=session.messages[i-1];
    if(!prior.ts_iso) continue;
    const gapMs=new Date(m.ts_iso).getTime()-new Date(prior.ts_iso).getTime();
    if(gapMs>0&&gapMs<7*24*60*60*1000) gaps.push(gapMs); // cap at 7d (cross-session noise)
  }

  // Word counts per customer message
  const wordCounts=customerMsgs.map(m=>(m.text||'').trim().split(/\s+/).filter(Boolean).length);

  // Last gap and last word count vs rolling avg (excluding the last)
  const lastGap=gaps[gaps.length-1];
  const priorGaps=gaps.slice(0,-1);
  const avgGap=priorGaps.length?priorGaps.reduce((a,b)=>a+b,0)/priorGaps.length:null;

  const lastWords=wordCounts[wordCounts.length-1];
  const priorWords=wordCounts.slice(0,-1);
  const avgWords=priorWords.length?priorWords.reduce((a,b)=>a+b,0)/priorWords.length:null;

  // Engagement signal: cooling / flat / warming based on gap+length deltas
  let signal='flat';
  let signalReason='baseline';
  if(avgGap!==null&&lastGap!==undefined){
    const gapRatio=lastGap/avgGap;
    const wordRatio=avgWords?(lastWords||0)/avgWords:1;
    // Cooling: gap is 2x+ longer AND/OR length dropped to <50% of avg
    if(gapRatio>=2.0||wordRatio<=0.5){
      signal='cooling';
      const reasons=[];
      if(gapRatio>=2.0) reasons.push(`reply gap ${(gapRatio).toFixed(1)}x longer than avg`);
      if(wordRatio<=0.5) reasons.push(`message length ${Math.round((1-wordRatio)*100)}% shorter than avg`);
      signalReason=reasons.join(' + ');
    }
    // Warming: gap is <50% of avg AND length 1.5x+ avg
    else if(gapRatio<=0.5&&wordRatio>=1.5){
      signal='warming';
      signalReason=`reply gap ${Math.round((1-gapRatio)*100)}% shorter and ${(wordRatio).toFixed(1)}x more words than avg`;
    }
  }

  // Question-asking pattern: did he stop asking back?
  const askingPriors=priorWords.length?customerMsgs.slice(0,-1).filter(m=>(m.text||'').includes('?')).length/priorWords.length:0;
  const lastAsked=customerMsgs[customerMsgs.length-1].text?.includes('?');
  const askDrop=askingPriors>=0.4&&!lastAsked&&customerMsgs.length>=4;

  // Emoji frequency drift
  const emojiRegex=/[\u{1F300}-\u{1F9FF}\u{2600}-\u{27BF}\u{1F000}-\u{1F02F}\u{1F0A0}-\u{1F0FF}]/gu;
  const priorEmojiAvg=priorWords.length?customerMsgs.slice(0,-1).reduce((s,m)=>s+((m.text||'').match(emojiRegex)?.length||0),0)/priorWords.length:0;
  const lastEmoji=(customerMsgs[customerMsgs.length-1].text||'').match(emojiRegex)?.length||0;
  const emojiDrop=priorEmojiAvg>=0.5&&lastEmoji===0&&customerMsgs.length>=4;

  return {
    signal,
    signalReason,
    avgGapMin:avgGap?Math.round(avgGap/60000):null,
    lastGapMin:lastGap?Math.round(lastGap/60000):null,
    avgWords:avgWords?Math.round(avgWords*10)/10:null,
    lastWords,
    askDrop,
    emojiDrop,
    customerMsgCount:customerMsgs.length
  };
}

function renderModelCards(){
  document.getElementById('modelCards').innerHTML=models.map((m,i)=>`
    <div class="mc">
      <div class="mc-head">
        <div class="mc-av">${m.name.slice(0,2).toUpperCase()}</div>
        <div class="mc-title">
          <div class="mc-name">${m.name}</div>
          <div class="mc-tier">${esc(m.tier||'no tier set')}</div>
        </div>
        <div style="flex:1"></div>
        <button class="btn sm success" onclick="saveModel(${i})">Save</button>
        <button class="btn sm danger" onclick="deleteModel(${i})">Delete</button>
      </div>

      <div class="mc-section">
        <label class="mc-label">Tier / Description</label>
        <input class="fi" id="mt_${i}" value="${esc(m.tier||'')}" placeholder="e.g. Top 0.03% · ~300 subs/day">
      </div>

      <div class="mc-section">
        <label class="mc-label">Full Model Prompt <span class="mc-hint">persona, voice, rules</span></label>
        <textarea class="mc-textarea" id="mp_${i}">${esc(m.prompt||'')}</textarea>
      </div>

      <div class="mc-section">
        <label class="mc-label">Content Library <span class="mc-hint">what content actually exists — prevents hallucination</span></label>
        <textarea class="mc-textarea mc-library" id="ml_${i}" placeholder="Tier 1 ($10-15): lingerie tease, shower tease, light topless&#10;Tier 2 ($20-40): topless variety, ass, dance&#10;Tier 3 ($50-150): fully nude&#10;Tier 4 ($200+): masturbation&#10;&#10;NOT AVAILABLE: squirt, anal, feet focus, BG, group">${esc(m.content_library||'')}</textarea>
      </div>

      <div class="mc-section">
        <label class="mc-label">OnlyFans Account ID <span class="mc-hint">(acct_… from OnlyFansAPI; leave blank to keep this creator fully manual)</span></label>
        <input class="fi" id="mofa_${i}" value="${esc(m.of_account_id||'')}" placeholder="acct_XXXXXXXXXXXXXXX">
      </div>

      ${m.feedback_rules?`<div class="mc-section mc-learned">
        <label class="mc-label mc-label-green">Learned Rules <span class="mc-hint">accumulated from approved rejections — edit to resolve contradictions, one rule per line</span></label>
        <textarea class="mc-textarea" id="mfr_${i}" rows="6" style="font-family:ui-monospace,Menlo,monospace;font-size:11px;line-height:1.5">${esc(m.feedback_rules)}</textarea>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button class="btn sm primary" onclick="saveFeedbackRules(${i})">Save Rules</button>
          <button class="btn sm danger" onclick="clearFeedbackRules(${i})">Clear All Rules</button>
        </div>
      </div>`:''}
    </div>`).join('');
}

async function saveModel(i){
  models[i].tier=document.getElementById(`mt_${i}`).value;
  models[i].prompt=document.getElementById(`mp_${i}`).value;
  models[i].content_library=document.getElementById(`ml_${i}`).value;
  models[i].of_account_id=(document.getElementById(`mofa_${i}`)?.value||'').trim()||null;
  // v0.3.0.27_2: Haiku A/B removed. Clear any leftover strategy_model preference.
  delete models[i].strategy_model;
  try{ localStorage.removeItem('ss_strategy_model_map'); }catch(e){}
  if(sb){
    if(models[i].id&&!String(models[i].id).startsWith('new_')){
      await sb.from('aich_models').update({tier:models[i].tier,prompt:models[i].prompt,content_library:models[i].content_library,of_account_id:models[i].of_account_id}).eq('id',models[i].id);
    } else {
      const{data}=await sb.from('aich_models').upsert({name:models[i].name,tier:models[i].tier,prompt:models[i].prompt,content_library:models[i].content_library,of_account_id:models[i].of_account_id},{onConflict:'name'}).select().single();
      if(data) models[i].id=data.id;
    }
  }
  toast(`${models[i].name} saved`,'s');updateModelDrop();
}

function addModel(){
  const name=prompt('Model name:');if(!name?.trim()) return;
  models.push({name:name.trim(),tier:'',prompt:''});
  renderModelCards();updateModelDrop();
  setModelsStat();
}

// v0.4.1.4: manager can edit Learned Rules in-place to resolve contradictions (feedback #11)
async function saveFeedbackRules(i){
  const ta=document.getElementById(`mfr_${i}`);
  if(!ta) return;
  const newText=(ta.value||'').trim();
  // Dedupe lines and strip blanks while preserving order
  const seen=new Set();
  const cleaned=newText.split('\n').map(r=>r.trim()).filter(r=>{
    if(!r||seen.has(r)) return false;
    seen.add(r);
    return true;
  }).join('\n');
  models[i].feedback_rules=cleaned||null;
  if(sb&&models[i].id&&!String(models[i].id).startsWith('new_')){
    await sb.from('aich_models').update({feedback_rules:cleaned||null}).eq('id',models[i].id);
  }
  // Re-render so the deduped/trimmed version is reflected in the textarea
  renderModelCards();
  toast(`${models[i].name}: rules saved (${cleaned?cleaned.split('\n').length:0} rule(s))`,'s');
}

async function clearFeedbackRules(i){
  if(!await confirmInPage('Clear all learned rules for '+models[i].name+'? This cannot be undone.')) return;
  models[i].feedback_rules=null;
  if(sb&&models[i].id&&!String(models[i].id).startsWith('new_')){
    await sb.from('aich_models').update({feedback_rules:null}).eq('id',models[i].id);
  }
  renderModelCards();
  toast('Rules cleared for '+models[i].name,'i');
}

async function deleteModel(i){
  if(!await confirmInPage(`Delete ${models[i].name}?`)) return;
  if(sb&&models[i].id&&!String(models[i].id).startsWith('new_')) await sb.from('aich_models').delete().eq('id',models[i].id);
  models.splice(i,1);renderModelCards();updateModelDrop();
  setModelsStat();
}

function saveKeys(){
  // v0.4.1.0: API Keys tab removed. This function is kept as a no-op for any
  // legacy caller (e.g. an old keyboard shortcut bound somewhere). Inputs no
  // longer exist in the DOM, so we early-out cleanly instead of throwing.
  const ck=document.getElementById('set_claude');
  if(!ck) return;
  const ok=document.getElementById('set_openrouter');
  if(ck.value&&!ck.value.includes('•')) localStorage.setItem('ss_claude',ck.value);
  if(ok&&ok.value&&!ok.value.includes('•')) localStorage.setItem('ss_openrouter',ok.value);
  const pt=document.getElementById('set_proxy_token');
  if(pt){
    const v=pt.value;
    if(v&&!v.includes('•')) localStorage.setItem('ss_proxy_token',v);
  }
  const pu=document.getElementById('set_use_proxy');
  if(pu) localStorage.setItem('ss_use_proxy',pu.checked?'true':'false');
  const banner=document.getElementById('noKeyBanner');
  if(banner) banner.style.display=(useProxy()||localStorage.getItem('ss_claude'))?'none':'block';
  toast('Keys saved','s');
}

// ── UTILS ──────────────────────────────────────────────────────
function copyDraft(){
  const s=sessions[activeId];
  if(!s.draft) return;
  navigator.clipboard.writeText(s.draft).then(()=>{
    toast('Copied','s');
    const btn=document.getElementById('draftCopyBtn');
    if(btn){btn.textContent='Copied!';setTimeout(()=>{btn.textContent='Copy';},1500);}
  });
}

function copyMsgByIndex(idx){
  const s=sessions[activeId];
  const msgs=s.messages||[];
  if(!msgs[idx]) return;
  navigator.clipboard.writeText(msgs[idx].text).then(()=>{
    toast('Copied','s');
  });
}

// Unambiguous single-word bans. Word-boundary matched — these words have ~zero
// innocent usage in OF chat context. Pulled from training docs CG | Terms of Service
// (Banned Words List) + doctrine PART 22 + accumulated incident corrections.
const BANNED_WORDS=['mother', 'mom', 'mommy', 'father', 'dad', 'daddy', 'aunt', 'uncle', 'brother', 'sister', 'niece', 'nephew', 'stepmom', 'stepdad', 'stepbrother', 'stepsister', 'halfbrother', 'halfsister', 'abduct', 'abducted', 'abducting', 'abduction', 'admireme', 'asphyxia', 'asphyxiate', 'asphyxiation', 'asphyxicate', 'asphyxication', 'ballbusting', 'bareback', 'bestiality', 'blacked', 'blackmail', 'bleeding', 'bloodplay', 'bukkake', 'caned', 'caning', 'cannibal', 'cashapp', 'cbt', 'cervics', 'cerviks', 'cervix', 'child', 'chloroform', 'chloroformed', 'chloroforming', 'choke', 'choking', 'coma', 'comatose', 'cp', 'diapers', 'drinking', 'drunk', 'drunken', 'enema', 'escort', 'escorting', 'fancentro', 'fanfuck', 'fecal', 'fetal', 'fisted', 'fisting', 'flogging', 'foetal', 'forcedbi', 'forceful', 'forcing', 'fuckfan', 'gangbang', 'gangbangs', 'gaping', 'hardsports', 'hooker', 'hypno', 'hypnotize', 'hypnotized', 'hypnotizing', 'inbreed', 'inbreeded', 'inbreeding', 'incapacitate', 'incapacitation', 'incest', 'intox', 'inzest', 'jailbait', 'kidnap', 'kidnapped', 'kidnapping', 'lactate', 'lactation', 'lolicon', 'lolita', 'manyvids', 'medicalplay', 'menstrate', 'menstrual', 'menstruate', 'menstruating', 'menstruation', 'molest', 'molested', 'molesting', 'mutilate', 'mutilation', 'paddling', 'paralyzed', 'paypal', 'peeplay', 'pegging', 'pissing', 'preteen', 'prostituted', 'prostituting', 'prostitution', 'pse', 'scat', 'skat', 'snuff', 'strangled', 'strangling', 'strangulation', 'suffocate', 'suffocation', 'teen', 'toiletslave', 'toiletslavery', 'tortured', 'unconscious', 'unconsciousness', 'unwilling', 'venmo', 'vomit', 'vomitted', 'vomitting', 'watersports', 'whipping', 'young', 'zoophilia'];

// Context-sensitive patterns. These words have heavy innocent usage in casual chat
// ("nice to meet you", "my dog Max", "in public" as a generic phrase, etc.) — the
// single-word match was generating false-positive warnings on benign drafts and
// eroding agent trust in the filter. Matched as regex against the lowercased text.
// Each pattern targets the actually-banned semantic context, not the bare word.
const BANNED_PATTERNS=[
  // meet — banned per OF TOS (real-world meetup), but "nice to meet you" / "i think we'd meet" must pass
  /\b(let'?s|wanna|want to|wanted to|we should|can we|gonna|going to) meet\b/i,
  /\bmeet (up|in person|for real|tonight|tomorrow|irl|outside|somewhere)\b/i,
  /\bmeet (you|me|us) (in|at|outside|tonight|tomorrow)\b/i,
  // public sex — generic "public" / "publicly" passes; only "in public / public place" flags
  /\b(in|at|having|have) public\b/i,
  /\bpublic (place|park|bathroom|sex)\b/i,
  /\bpublicly (have|having|fuck|fucking|naked|nude)\b/i,
  // dog — innocent pet talk passes ("my dog Max"); only zoosexual contexts flag
  /\b(fuck|fucking|sex|sexual|sucking|blowing|riding) .{0,15}\bdog\b/i,
  /\bdog (cock|dick|cum|sex|sexual)\b/i,
  // consent — positive in modern context; only "no consent / without consent / non-consent" flag
  /\b(no|without|non[- ]?|never gave) consent\b/i,
  /\bdid(n'?t| not) consent\b/i,
  // animal — innocent "favorite animal" passes; only zoosexual context flags
  /\b(fuck|fucking|sex|sexual|sucking) .{0,15}\banimal\b/i,
  /\banimal (cock|dick|cum|sex|sexual)\b/i,
  // passed out — non-consent / drug context. Plain "passed by" / "i passed the test" passes
  /\bpassed out\b/i,
  // knocked up / knocked out — pregnancy non-consent / violence. "knock on the door" passes
  /\bknocked (up|out|unconscious)\b/i,
  // doze off → innocent; "dozed off" passes. No replacement pattern needed — removed entirely.
  // jail / jailbait — jailbait kept in BANNED_WORDS; "jail" alone passes
  // farm — removed entirely (no canonical ban; was noise)
  // showers — handled by 'golden' word in BANNED_WORDS list
  // eleven / twelve — age-context only. Plain numbers pass
  /\b(she'?s|he'?s|i'?m|am|was|she is|he is)\s+(eleven|twelve|11|12)\s+(years|yr|yo|year)\b/i,
  // blood — innocent "bloody mary" / "bloody hell" passes; sexual context flags
  /\b(blood (play|sex|fetish))\b/i,
  /\b(menstrual|period) blood\b/i,
  // forced — non-consent context. "i forced myself to laugh" passes; "i forced him/her" sexual flags
  /\bforced (her|him|me|you) (to|into) (have|do|suck|fuck|strip|undress|kiss)/i,
  // toilet — innocent "i'm in the toilet" passes; "toilet (play|slave|whore|fuck)" flags via toiletslave already, add toilet+sex
  /\btoilet (play|slave|sex|fetish)\b/i,
  // torture — too generic; only sexual/violent torture context flags
  /\btorture (sex|fetish|porn|fantasy)\b/i,
  // trance / hypno — covered by hypno/hypnotize/hypnotized/hypnotizing in BANNED_WORDS; trance alone removed
  // pee / piss — bodily fluid TOS. Keep "piss" patterns; "pee" alone too generic ("i need to pee" innocent enough but still OF-banned bodily-fluid context)
  /\b(piss (on|in|drinking|fetish|play))\b/i,
  /\bgolden (shower|showers|piss)\b/i,
  /\b(drinking|drink) (pee|piss|urine)\b/i,
  // poo / poop — bodily fluid TOS
  /\b(poo|poop|scat) (play|fetish|sex)\b/i,
  // vomit — already in BANNED_WORDS; no pattern needed
];

function scanForBanned(text){
  const lower=text.toLowerCase();
  const found=new Set();
  // Pass 1: single-word bans
  BANNED_WORDS.forEach(w=>{
    const regex=new RegExp('\\b'+w+'\\b','i');
    if(regex.test(lower)) found.add(w);
  });
  // Pass 2: context-sensitive patterns
  BANNED_PATTERNS.forEach(p=>{
    const m=lower.match(p);
    if(m) found.add(m[0].trim());
  });
  return Array.from(found);
}

// ── LAYER 1 — REGISTER FILTER ────────────────────────────────────
// Detects store-voice (commerce register) vocabulary that breaks relationship frame.
// Doctrine: words like "paycheck", "worth it", "when you get paid" remind the customer
// he is in a transaction. One word of store-voice undoes 20 messages of rapport.
// This is POST-PURCHASE and PRE-PURCHASE language control — girlfriend register only.
//
// Flagging strategy: multi-word phrases are matched as substrings (they're unambiguous).
// Single words are word-boundary matched to avoid false positives (e.g. "pay attention"
// should not trigger "pay"). "Pay" alone is too ambiguous — only flagged in transactional
// compound phrases.
const REGISTER_BAD_PHRASES=[
  // Paycheck / payment register
  'paycheck',
  'pay check',
  'when you get paid',
  'once you get paid',
  'til you get paid',
  'till you get paid',
  'until you get paid',
  'after you get paid',
  'when you pay',
  'once you pay',
  'pay for it',
  'pay for this',
  'paid for it',
  'paid for this',
  // Worth register
  'worth it',
  'worth every',
  'make it worth',
  'worth the wait',
  "it'll be worth",
  'itll be worth',
  'worth your money',
  'worth the money',
  // Clingy plea register
  'wait before you go',
  "don't go yet",
  'dont go yet',
  "i wanna know you're thinking of me",
  'i wanna know youre thinking of me',
  "promise me you'll open",
  'promise me youll open',
  // Transactional closings
  'open it when you get',
  'unlock it when you get',
  'open it after you',
  // Commerce framing
  "here's the link",
  'heres the link',
  'click the link',
  'hit the link'
];

function registerFilterCheck(text){
  if(!text) return [];
  const lower=text.toLowerCase();
  const hits=[];
  REGISTER_BAD_PHRASES.forEach(p=>{
    if(lower.includes(p)) hits.push(p);
  });
  return hits;
}

// v0.3.0.37: post-generation sanitizer for LLM chain-of-thought / self-correction
// leaks. The generator sometimes emits its own reasoning between two attempted
// drafts. If accepted unread, the AI's internal reasoning would be sent to a
// real customer, breaking persona instantly.
//
// Patterns that mark reasoning (case-insensitive, at line start):
//   "Wait —", "Wait,", "Wait —" (em-dash variants)
//   "Actually," / "Actually —"
//   "Hmm,"
//   "Let me " (e.g. "Let me reconsider")
//   "I should " / "I shouldn't " / "I need to "
//   "I already know" / "I know that"
//   "The instruction says" / "The instructions say"
//   "On second thought"
//   "Note:" / "Note —"
//
// Strategy: split into paragraph blocks. Tag each block as 'draft' or 'reasoning'.
// Drop reasoning blocks. If multiple draft blocks survive, keep the LAST one
// (model self-corrects toward the better draft). If nothing survives, return
// the original text and flag it for retry.
const REASONING_PATTERNS=[
  /^\s*wait[\s,—-]/i,
  /^\s*actually[\s,—-]/i,
  /^\s*hmm[\s,—-]/i,
  /^\s*let me (reconsider|rethink|try|rewrite|fix|correct)/i,
  /^\s*i (already know|know that|need to|should|shouldn'?t|can'?t|must)/i,
  /^\s*the instruction(s)? (say|says|state|states)/i,
  /^\s*on second thought/i,
  /^\s*note[\s:—-]/i,
  /^\s*\(note[\s:—-]/i,
  /so asking (naturally|directly|like that) is (correct|right|fine|ok|okay)/i,
  /^\s*correction[\s:—-]/i,
  /^\s*revised[\s:—-]/i,
  /^\s*better version[\s:—-]/i,
  /^\s*let me try (again|that)/i
];
// v0.4.4.5: DETERMINISTIC ANTI-SLOP SANITIZER. The em-dash is the single most damning AI
// tell; the generator-prompt ban is LLM guidance and doesn't catch 100% (a live Sonnet draft
// shipped "i'm jammy — what should i call you?" with the ban active). This is the hard backstop,
// run on EVERY finalized draft (all routes incl. PPV captions): em/en-dashes → texting-native
// "...", stray semicolons → commas. Safe — a real girl texting splits a thought that way and it
// never produces mojibake. Kept tiny and side-effect-free so the harness can lock it.
function sanitizeSlop(text){
  if(!text) return text;
  return text
    .replace(/…/g,'...')            // real ellipsis char … → "..." (texting-native)
    .replace(/\s*[—–]\s*/g,'... ')      // " — " / "—" / en-dash → "... "
    .replace(/\.\.\.\s*\.\.\./g,'...')   // collapse doubled ellipses if model already used "..."
    .replace(/\s*;\s*/g,', ')            // semicolon → comma (essay/store-voice tell)
    .replace(/\s+([.,!?])/g,'$1')        // tidy any space-before-punct the swaps introduced
    .replace(/\s{2,}/g,' ')
    .trim();
}

// v0.4.4.5 (live critical audit 2026-06-13): DETERMINISTIC EMOJI NO-REPEAT BACKSTOP.
// The generator-prompt EMOJI RULE ("never use an emoji from your last two messages") is LLM
// guidance and does NOT land reliably — live multi-turn audit caught Camila using 😏 on turn 1
// AND turn 3 (only one message apart), the exact signature-emoji tic. Like the em-dash, the hard
// fix is mechanical: strip from the new draft any emoji that appeared in the last 2 sent model
// messages. Keeps non-repeated emojis. Per doctrine ("when in doubt, none"), removing the repeat
// reads better than a reflexive one. Pure + testable; recentModelTexts = last 2 model message strings.
function dedupeEmoji(text, recentModelTexts){
  if(!text) return text;
  const rx=/\p{Extended_Pictographic}/gu;
  const recent=new Set();
  (recentModelTexts||[]).slice(-2).forEach(m=>{ ((m||'').match(rx)||[]).forEach(e=>recent.add(e)); });
  if(recent.size===0) return text;
  let out=text.replace(rx, e=> recent.has(e) ? '' : e);
  return out.replace(/\s+([.,!?])/g,'$1').replace(/\s{2,}/g,' ').trim();
}

function stripReasoningLeaks(text){
  if(!text||typeof text!=='string') return {clean:text,leaked:false,blocks_removed:0};
  // Split on double-newline (paragraph blocks) — these are the unit at which
  // reasoning typically gets injected.
  const blocks=text.split(/\n\s*\n/).map(b=>b.trim()).filter(Boolean);
  if(blocks.length<=1){
    // Single block — check if the WHOLE thing is reasoning (rare, would be a fail anyway)
    const allReasoning=REASONING_PATTERNS.some(p=>p.test(text.trim()));
    if(allReasoning) return {clean:'',leaked:true,blocks_removed:1};
    return {clean:text,leaked:false,blocks_removed:0};
  }
  const draftBlocks=[];
  let removed=0;
  for(const b of blocks){
    const isReasoning=REASONING_PATTERNS.some(p=>p.test(b));
    if(isReasoning){removed++;continue;}
    draftBlocks.push(b);
  }
  if(draftBlocks.length===0) return {clean:'',leaked:true,blocks_removed:removed};
  // When the model emits two drafts with reasoning between, the LAST is the
  // self-corrected version — prefer it. When there's only one draft block,
  // keep that.
  const clean=draftBlocks[draftBlocks.length-1];
  return {clean,leaked:removed>0,blocks_removed:removed};
}


async function writeSessionMemory(sessionId){
  const s=sessions[sessionId];
  if(!s||!s.messages||s.messages.length<2) return;
  if(!sb||!s.customer_username) return;
  const model=models.find(m=>m.name===s.creator_model);
  if(!model) return;

  // v0.3.0.28: capture everything we need into locals BEFORE any await.
  // The session can be deleted (close, switch, archive) while the API call
  // is in flight. Anything we read off `s` after the await may throw with
  // "Cannot read properties of undefined" — which was firing 10x on load.
  const profile=s._profile;
  const existingMemory=profile?.key_details||'';
  const today=new Date().toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
  const creatorModel=s.creator_model;
  const customerUsername=s.customer_username;
  const customerName=s.customer_name;
  const totalSpend=s.total_spend;
  const timeOnPage=s.time_on_page;
  const crmNotes=s.crm_notes;
  const messagesSnapshot=s.messages.slice();

  const memoryPrompt=`You are writing a memory log entry for an OnlyFans agency AI chatter system.
A conversation just happened with a customer. Write a concise memory entry that captures everything useful for future conversations.

CRITICAL RULE — do not fabricate preferences:
- If the customer STATED something about himself (job, name, schedule, life situation) — log it as fact.
- If the customer ASKED about a type of content or requested something — log it as "asked about X" NOT "prefers X". Asking is not preferring.
- Never write "strong preference for X" or "responds well to X" unless he actually bought X or explicitly said he likes X.
- Distinguish: "bought Tier 2 content" = preference signal. "asked if we have squirt" = curiosity, not preference.

Include: emotional state, what was discussed, what was sold or attempted, how he responded, trust level indicators, stated personal details, what was left open, what the next logical move should be.
Write in past tense. Max 120 words. No bullet points. Just a dense paragraph of useful context.

MODEL: ${creatorModel}
CUSTOMER: ${customerName} | Spend: ${totalSpend||'$0'} | ${timeOnPage||'?'} on page
CRM: ${crmNotes||'none'}

CONVERSATION:
${messagesSnapshot.map(m=>fmtMsgForAI(m,{modelName:creatorModel,withTs:true})).join('\n')}

${existingMemory?'EXISTING MEMORY (append to this, do not repeat):\n'+existingMemory.slice(-800):'No previous memory.'}

Write the new memory entry for ${today}:`;

  try{
    const entry=await callApi('You write concise memory log entries. Be specific and useful. No fluff.',memoryPrompt,180,null,'memory_log');
    const newMemory=existingMemory
      ?existingMemory+'\n\n['+today+'] '+entry.trim()
      :'['+today+'] '+entry.trim();

    // Save to customer_profiles — uses local snapshots, immune to session deletion
    await sb.from('customer_profiles').upsert({
      creator_model:creatorModel,
      customer_username:customerUsername,
      customer_name:customerName,
      key_details:newMemory,
      last_seen_at:new Date().toISOString()
    },{onConflict:'creator_model,customer_username'});

    // Update local profile cache ONLY if session still exists.
    // Optional chaining + existence guard — session may have been closed mid-await.
    const stillAlive=sessions[sessionId];
    if(stillAlive&&stillAlive._profile){
      stillAlive._profile.key_details=newMemory;
    }
  }catch(e){
    // Silent fail — memory write should never block the agent
    console.warn('Memory write failed:',e&&e.message||e);
  }
}

async function extractCustomerIntel(sessionId,msgs,modelName){
  const s=sessions[sessionId];
  if(!s||!msgs||msgs.length<2) return;

  // Only run if there are customer messages with actual content
  const customerMsgs=msgs.filter(m=>m.sender==='customer'&&m.text.trim().length>2);
  if(!customerMsgs.length) return;

  // v0.3.0.28: snapshot all session-derived data before any await.
  // Session can be deleted mid-API-call (close/switch/archive), and any
  // subsequent read off `s` after an await will throw.
  const creatorModel=s.creator_model;
  const customerUsername=s.customer_username;
  const initialCustomerName=s.customer_name;
  const initialCrmNotes=s.crm_notes||'';

  const intelPrompt=`Extract ONLY facts the customer STATED about himself. Do NOT extract topics he asked about or content he requested.

CRITICAL DISTINCTION:
- STATED FACT (extract): "I'm a pharmacy student" / "I work out at midnight" / "my name is Jake" / "I live in Texas"
- QUESTION or REQUEST (DO NOT extract): "do you have squirt videos?" / "what do you sell?" / "how much?"

If the customer only asked questions and stated nothing personal, return null for details. Asking about a type of content is NOT a preference — it is a question. Never log "prefers X" or "likes X content" unless the customer explicitly said he likes it or has bought it.

Return ONLY raw JSON, no markdown.

Rules:
- name: their real first name ONLY if they stated it or signed off with it. null otherwise.
- details: ONLY facts they stated about themselves (job, age, location, hobbies, schedule, family, personal situation). null if they only asked questions or made requests.

CONVERSATION:
${msgs.map(m=>fmtMsgForAI(m,{modelName:modelName})).join('\n')}

Return exactly: {"name":"first name or null","details":"stated fact1, stated fact2 or null"}`;

  try{
    const raw=await callApi('Extract customer info. Return only JSON.',intelPrompt,400,null,'intel_extract');
    const clean=raw.replace(/\`\`\`json|\`\`\`/g,'').trim();
    const data=safeParseStrategy(clean);
    if(!data){
      console.warn('[CUSTOMER INTEL] parse failed. Raw:',raw);
      return;
    }

    let updated=false;
    const isActive=()=>sessionId===activeId;

    // Update display name if real name detected
    if(data.name&&data.name!=='null'&&data.name.trim()!==''&&data.name.toLowerCase()!==(initialCustomerName||'').toLowerCase()){
      // Session may be gone — guard before mutating
      if(sessions[sessionId]) sessions[sessionId].customer_name=data.name.trim();
      // Update in Supabase (uses captured locals — safe even if session is gone)
      if(sb) await sb.from('aich_sessions').update({customer_name:data.name.trim()}).eq('id',sessionId);
      if(sb&&customerUsername) await sb.from('customer_profiles').upsert({
        creator_model:creatorModel,
        customer_username:customerUsername,
        customer_name:data.name.trim()
      },{onConflict:'creator_model,customer_username'});
      // Re-render only if this session is visible
      renderSidebar();
      if(isActive()) renderSession();
      toast('Name detected: '+data.name.trim(),'i');
      updated=true;
    }

    // Append new details to CRM notes
    if(data.details&&data.details!=='null'){
      const today=new Date().toLocaleString('en-US',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});
      const newNote=`[SSAI — ${today}]\n${data.details}`;
      // Use latest session crm_notes if session still alive, else fallback to snapshot
      const existing=(sessions[sessionId]&&sessions[sessionId].crm_notes)||initialCrmNotes;
      // Don't add if already in notes (avoid duplicates)
      if(!existing.includes(data.details.slice(0,30))){
        const updatedNotes=existing?existing+'\n\n'+newNote:newNote;
        if(sessions[sessionId]) sessions[sessionId].crm_notes=updatedNotes;
        if(sb) await sb.from('aich_sessions').update({crm_notes:updatedNotes}).eq('id',sessionId);
        if(sb&&customerUsername) await sb.from('customer_profiles').upsert({
          creator_model:creatorModel,customer_username:customerUsername,crm_notes:updatedNotes
        },{onConflict:'creator_model,customer_username'});
        // Refresh CRM display only if visible
        if(isActive()){
          const crmEl=document.querySelector('.crm-txt');
          if(crmEl) crmEl.textContent=updatedNotes;
        }
        toast('CRM notes updated','i');
        updated=true;
      }
    }
  }catch(e){
    // Silent fail
    console.warn('Intel extraction failed:',e&&e.message||e);
  }
}

// v0.4.1.0: Manager-gated feedback synthesis.
// Old behavior: 5+ rejections → auto-synthesize rules → write directly to
// aich_models.feedback_rules without review. Drift-prone — chatters could
// effectively rewrite a model by rejecting messages.
// New behavior: synthesis runs the same way but writes to aich_feedback_queue
// with status='pending'. A manager reviews the queue in Settings → Feedback Queue
// and either Approves (writes to feedback_rules) or Dismisses (drops the batch).
// Session-scoped feedback (s._sessionFeedback) is untouched — chatters still get
// their rejections reflected in the next generation within that session.
async function checkAndSynthesizeFeedback(modelName){
  if(!sb) return;
  try{
    // Pull recent rejections for this model that haven't been queued or approved yet.
    const{data:msgRows}=await sb.from('aich_messages')
      .select('id,feedback_text,response_text,created_at')
      .eq('creator_model',modelName)
      .eq('was_sent',false)
      .not('feedback_text','is',null)
      .order('created_at',{ascending:false})
      .limit(20);
    if(!msgRows||msgRows.length<5) return; // need at least 5 rejections

    // Skip synthesis if there's already a pending queue item for this model awaiting review.
    // Avoids piling up duplicate proposals every time a 6th, 7th, 8th rejection lands.
    const{data:pending}=await sb.from('aich_feedback_queue')
      .select('id')
      .eq('creator_model',modelName)
      .eq('status','pending')
      .limit(1);
    if(pending&&pending.length>0) return;

    const model=models.find(m=>m.name===modelName);
    if(!model) return;

    const synthesisPrompt=`You are analyzing rejected AI chatter responses to extract improvement rules.

Below are responses that were rejected by the human agent with feedback.
Synthesize these into 3-5 clear, actionable rules that the AI should follow for this creator model.
Rules should be specific, not generic. Focus on patterns across multiple rejections.
Return ONLY a JSON array of rule strings.

REJECTIONS:
${msgRows.map((d,i)=>`${i+1}. Response: "${(d.response_text||'').slice(0,80)}" — Feedback: "${d.feedback_text}"`).join('\n')}

Return exactly: ["rule 1","rule 2","rule 3"]`;

    const raw=await callApi('Extract improvement rules. Return only a JSON array.',synthesisPrompt,600,null,'feedback_synthesis');
    const clean=raw.replace(/\`\`\`json|\`\`\`/g,'').trim();
    const rules=JSON.parse(clean);
    if(!Array.isArray(rules)||!rules.length) return;

    // Insert into pending queue — manager must approve before this affects the model.
    const sourceIds=msgRows.map(r=>r.id);
    await sb.from('aich_feedback_queue').insert({
      creator_model:modelName,
      proposed_rules:rules,
      source_message_ids:sourceIds,
      rejection_count:msgRows.length,
      status:'pending',
      created_at:new Date().toISOString()
    });

    // Refresh badge for any manager currently in-app
    refreshFeedbackQueueBadge();
  }catch(e){
    console.warn('Synthesis (queue) failed:',e.message);
  }
}

// v0.4.1.0: Feedback Queue UI — manager-only. Lists pending rule proposals and
// gives Approve / Dismiss controls.
async function loadFeedbackQueue(){
  const body=document.getElementById('fbQueueBody');
  if(!body) return;
  body.innerHTML='<div style="color:var(--text3);font-size:11px;padding:10px">Loading queue...</div>';
  if(!sb){body.innerHTML='<div style="color:var(--text3);font-size:11px;padding:10px">DB not connected.</div>';return;}
  try{
    const{data:items,error}=await sb.from('aich_feedback_queue')
      .select('*')
      .eq('status','pending')
      .order('created_at',{ascending:false})
      .limit(50);
    if(error) throw error;
    if(!items||items.length===0){
      body.innerHTML='<div style="color:var(--text3);font-style:italic;padding:14px;text-align:center">No pending feedback. Queue fills when chatters reject 5+ generations for the same model.</div>';
      return;
    }
    body.innerHTML=items.map(it=>{
      const rules=Array.isArray(it.proposed_rules)?it.proposed_rules:(typeof it.proposed_rules==='string'?JSON.parse(it.proposed_rules):[]);
      const when=new Date(it.created_at).toLocaleString();
      const model=esc(it.creator_model||'?');
      const existingModel=models.find(m=>m.name===it.creator_model);
      const existingRules=existingModel&&existingModel.feedback_rules?existingModel.feedback_rules:'';
      const existingPreview=existingRules?`<div style="font-size:10px;color:var(--text3);margin-top:8px;padding-top:8px;border-top:1px solid var(--border)"><b>Currently in effect:</b><br><span style="white-space:pre-wrap;color:var(--text2)">${esc(existingRules)}</span></div>`:'';
      return `<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:6px;padding:14px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px;flex-wrap:wrap">
          <div><b style="font-size:13px">${model}</b> <span style="color:var(--text3);font-size:11px">· ${it.rejection_count||0} rejections analyzed · ${when}</span></div>
          <div style="display:flex;gap:6px">
            <button class="btn sm" onclick="approveFeedbackQueueItem('${it.id}','${model.replace(/'/g,"\\'")}')" style="color:var(--green);border-color:rgba(61,214,140,0.3)">Approve & promote</button>
            <button class="btn sm" onclick="dismissFeedbackQueueItem('${it.id}')">Dismiss</button>
          </div>
        </div>
        <div style="font-size:11px;color:var(--text2);margin-bottom:6px;font-weight:600">Proposed rules:</div>
        <ul style="margin:0;padding-left:18px;font-size:11px;color:var(--text2);line-height:1.7">
          ${rules.map(r=>`<li>${esc(r)}</li>`).join('')}
        </ul>
        ${existingPreview}
      </div>`;
    }).join('');
  }catch(e){
    body.innerHTML='<div style="color:var(--red);font-size:11px;padding:10px">Error: '+esc(e.message||String(e))+'</div>';
  }
}

async function approveFeedbackQueueItem(id, modelName){
  // v0.4.1.4: APPEND to existing rules instead of replacing (feedback item #11). Manager
  // can edit the combined rule list afterward in the Models tab to resolve contradictions.
  if(!await confirmInPage(`Approve these rules and ADD to ${modelName}'s learned rules?\n\nNew rules will be appended (duplicates removed). You can edit the combined list afterward in the Models tab to resolve any contradictions.`)) return;
  try{
    const{data:row,error:rowErr}=await sb.from('aich_feedback_queue').select('proposed_rules').eq('id',id).single();
    if(rowErr) throw rowErr;
    const newRules=Array.isArray(row.proposed_rules)?row.proposed_rules:(typeof row.proposed_rules==='string'?JSON.parse(row.proposed_rules):[]);
    // Read existing rules from local model state (already loaded into memory)
    const idx=models.findIndex(m=>m.name===modelName);
    const existingText=(idx>-1?models[idx].feedback_rules:'')||'';
    const existingRules=existingText.split('\n').map(r=>r.trim()).filter(Boolean);
    const existingSet=new Set(existingRules);
    const merged=[...existingRules];
    let addedCount=0;
    newRules.forEach(r=>{
      const t=String(r).trim();
      if(t && !existingSet.has(t)){
        merged.push(t);
        existingSet.add(t);
        addedCount++;
      }
    });
    const rulesText=merged.join('\n');
    await sb.from('aich_models').update({feedback_rules:rulesText}).eq('name',modelName);
    if(idx>-1) models[idx].feedback_rules=rulesText;
    await sb.from('aich_feedback_queue').update({status:'approved',resolved_at:new Date().toISOString(),resolved_by:window.currentChatter?.id||null}).eq('id',id);
    const skipped=newRules.length-addedCount;
    const msg=addedCount===0?`${modelName}: no new rules added (all duplicates)`
      :skipped>0?`${modelName}: ${addedCount} rule(s) added · ${skipped} duplicate(s) skipped`
      :`${modelName}: ${addedCount} rule(s) added`;
    toast(msg,'s');
    await loadFeedbackQueue();
    refreshFeedbackQueueBadge();
    // Re-render Models tab if visible so the new rules show up immediately
    if(typeof renderModelCards==='function') renderModelCards();
  }catch(e){toast('Approve failed: '+(e.message||e),'e');}
}

async function dismissFeedbackQueueItem(id){
  if(!await confirmInPage('Dismiss this proposal? Source rejections stay logged but no rules are applied.')) return;
  try{
    await sb.from('aich_feedback_queue').update({status:'dismissed',resolved_at:new Date().toISOString(),resolved_by:window.currentChatter?.id||null}).eq('id',id);
    toast('Dismissed','i');
    await loadFeedbackQueue();
    refreshFeedbackQueueBadge();
  }catch(e){toast('Dismiss failed: '+(e.message||e),'e');}
}

async function refreshFeedbackQueueBadge(){
  if(!sb||!window.currentChatter||window.currentChatter.role!=='manager') return;
  try{
    const{count}=await sb.from('aich_feedback_queue').select('*',{count:'exact',head:true}).eq('status','pending');
    const tabBadge=document.getElementById('fbQueueBadge');
    const dotBadge=document.getElementById('settingsBadge');
    if(count&&count>0){
      if(tabBadge){tabBadge.style.display='inline-block';tabBadge.textContent=String(count);}
      if(dotBadge) dotBadge.style.display='block';
    } else {
      if(tabBadge) tabBadge.style.display='none';
      if(dotBadge) dotBadge.style.display='none';
    }
  }catch(e){/* silent — table may not exist yet */}
}

// ── v0.4.1.4: OCR — Import chat screenshots via Claude vision (feedback item #2) ──
// Workflow: agent clicks "📷 Import Screenshot" → picks image → Claude vision parses
// → preview modal shows extracted messages → agent confirms → pushed to s.messages.
// Uses the same Anthropic proxy as everything else, so no separate auth/key plumbing.

function openOcrPicker(){
  const inp=document.getElementById('ocrFileInput');
  if(!inp){toast('OCR picker not ready — try refresh','e');return;}
  inp.value=''; // clear any prior selection so onchange fires even on same file
  inp.click();
}

async function handleOcrFile(event){
  const file=event.target.files?.[0];
  if(!file) return;
  if(!file.type.startsWith('image/')){toast('Pick an image file','e');return;}
  if(file.size>10*1024*1024){toast('Image too large — keep under 10MB','e');return;}
  const s=sessions[activeId];
  if(!s){toast('No active session','e');return;}

  // Read file as base64
  const reader=new FileReader();
  reader.onerror=()=>toast('Failed to read image','e');
  reader.onload=async()=>{
    const dataUrl=reader.result;
    const mediaMatch=/^data:(image\/[a-z+]+);base64,(.*)$/i.exec(dataUrl);
    if(!mediaMatch){toast('Bad image format','e');return;}
    const mediaType=mediaMatch[1];
    const b64=mediaMatch[2];
    // Show parsing modal immediately
    showOcrParsingModal();
    try{
      const parsed=await callClaudeVisionForChat(b64,mediaType,s.creator_model);
      closeOcrParsingModal();
      if(!parsed||!parsed.messages||!parsed.messages.length){
        toast('No messages found in the screenshot','e');
        return;
      }
      // Pass the full parsed object so the modal can surface the date_hint
      showOcrPreviewModal(parsed);
    }catch(e){
      closeOcrParsingModal();
      toast('OCR failed: '+(e.message||e),'e');
    }
  };
  reader.readAsDataURL(file);
}

async function callClaudeVisionForChat(b64,mediaType,creatorName){
  // System prompt: clear instruction to return JSON with messages array
  const system=[{type:'text',text:`You are extracting an OnlyFans chat from a screenshot for a chat-management tool.
The CREATOR's name in this conversation is "${creatorName}". Treat messages from "${creatorName}" (or visually positioned as the model/creator side) as sender:"model". Treat the CUSTOMER's messages as sender:"customer".

Return ONLY raw JSON in this exact shape — no markdown, no backticks, no explanation:
{"date_hint":"...","messages":[{"sender":"customer"|"model","text":"...","ts":"H:MM AM/PM","media":true|false,"section":"date label above this message"}, ...]}

Rules:
- Preserve chronological order (oldest first, newest last).
- "date_hint" — top-level field. The most recent date marker visible anywhere in the screenshot (e.g. "Today", "Yesterday", "May 4", "Wed May 4", "Last Friday"). Omit if no date marker is visible. Never invent.
- "section" — per-message. The date marker (label) that appears above this message bubble in the screenshot (e.g. "Today", "Yesterday", "May 3"). Set this when OnlyFans shows a separator before the bubble. Omit if no separator label was shown for this message.
- "ts" — the time visible on the message bubble in 12-hour format (e.g. "3:45 PM"). Omit if not visible — never invent times.
- "media": set to true when the bubble contains/attaches an UNLOCKED image, video, or voice-note thumbnail with NO price tag visible — i.e. free media. Default to false (or omit) for plain text. Customers on OnlyFans cannot send paid content, so any customer-side attachment is free media.
- "media_description": when media is true AND the thumbnail is visible enough to describe, give a SHORT factual description of what's in it (e.g. "topless mirror selfie", "shirtless gym pic", "close-up of his face", "video thumbnail, lingerie"). This lets the chat brain react to what was actually sent. Omit if you can't tell. Keep it brief and non-explicit in wording.
- For PPV bubbles (locked/unlocked PAID content with a price visible) use sender:"ppv" and include "price" as a number and "opened":true/false. Example: {"sender":"ppv","price":35,"opened":true,"text":"caption text if visible","ts":"3:35 PM"}. Do NOT set "media" on PPV bubbles — the sender:"ppv" already encodes that.
- If you cannot tell who sent a message, omit it rather than guess.
- Keep text verbatim, including emojis. Do NOT translate or paraphrase.
- If the screenshot contains UI chrome (header, sidebar, profile panel), ignore it. Only extract the chat bubbles.`}];

  const user=[
    {type:'image',source:{type:'base64',media_type:mediaType,data:b64}},
    {type:'text',text:'Extract the chat from this screenshot per the system instructions. Return the JSON only.'}
  ];
  const raw=await callApi(system,user,4000,'sonnet','ocr_chat_import');
  const cleaned=raw.replace(/```json|```/g,'').trim();
  let parsed;
  try{ parsed=JSON.parse(cleaned); }
  catch(e){ throw new Error('Claude returned invalid JSON: '+cleaned.slice(0,200)); }
  return parsed;
}

function showOcrParsingModal(){
  closeOcrParsingModal();
  const html=`<div class="ppv-modal-bg" id="ocrParseBg">
    <div class="ppv-modal" style="max-width:380px;text-align:center;padding:24px">
      <div class="ppv-modal-title">📷 Parsing screenshot…</div>
      <div class="ppv-modal-sub" style="margin-top:8px">Claude vision is extracting the chat. This usually takes 5-15 seconds.</div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}
function closeOcrParsingModal(){
  const bg=document.getElementById('ocrParseBg');
  if(bg) bg.remove();
}

function showOcrPreviewModal(parsed){
  closeOcrPreviewModal();
  // Backward compat: parsed may be an array (legacy) or {messages, date_hint} (new shape)
  const messages=Array.isArray(parsed)?parsed:(parsed.messages||[]);
  const dateHint=Array.isArray(parsed)?null:(parsed.date_hint||null);
  window._pendingOcrMessages=messages;
  window._pendingOcrDateHint=dateHint;
  // Default conversation date — if vision saw "Today" / "Yesterday" / a parseable date label,
  // try to resolve it to YYYY-MM-DD; otherwise leave the input empty so agent must specify.
  const defaultDate=resolveOcrDateHint(dateHint);
  const previewRows=messages.map((m,i)=>{
    const senderLabel=m.sender==='model'?'MODEL':(m.sender==='ppv'?'PPV':'CUSTOMER');
    const senderColor=m.sender==='model'?'var(--blue2)':(m.sender==='ppv'?'#e6b84d':'var(--green)');
    const tsStr=m.ts?` <span style="color:var(--text3);font-size:10px">[${esc(m.ts)}]</span>`:'';
    const sectionStr=m.section?` <span style="color:var(--accent);font-size:10px">· ${esc(m.section)}</span>`:'';
    const ppvBits=m.sender==='ppv'?` <span style="color:#e6b84d;font-size:10px">$${m.price||'?'} · ${m.opened?'OPENED':'UNOPENED'}</span>`:'';
    const mediaBit=(m.media===true && m.sender!=='ppv')?` <span style="color:var(--accent);font-size:10px">· 📎 free media</span>`:'';
    return `<div style="padding:6px 8px;border-bottom:1px solid var(--border);font-size:11px;display:flex;gap:8px;align-items:flex-start">
      <input type="checkbox" data-ocr-idx="${i}" checked style="margin-top:3px;cursor:pointer">
      <div style="flex:1">
        <div style="font-weight:600;color:${senderColor};font-size:10px;text-transform:uppercase;letter-spacing:0.04em">${senderLabel}${tsStr}${sectionStr}${ppvBits}${mediaBit}</div>
        <div style="color:var(--text2);margin-top:2px">${esc(m.text||'')}</div>
      </div>
    </div>`;
  }).join('');
  const dateHintLabel=dateHint?`<span style="color:var(--accent);font-size:11px">· Vision saw "<b>${esc(dateHint)}</b>" at top of chat</span>`:'';
  const html=`<div class="ppv-modal-bg" id="ocrPreviewBg" onclick="if(event.target===this)closeOcrPreviewModal()">
    <div class="ppv-modal" style="max-width:680px;max-height:85vh;display:flex;flex-direction:column">
      <div class="ppv-modal-title">📷 Import preview — ${messages.length} message${messages.length===1?'':'s'} parsed</div>
      <div class="ppv-modal-sub">Uncheck any message you don't want to import. Times are best-guess from the screenshot — check them.</div>
      <div style="margin-top:10px;padding:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--r);display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <label style="font-size:11px;color:var(--text2);font-weight:600">Conversation date:</label>
        <input type="date" id="ocrDateInput" value="${defaultDate||''}" style="background:var(--panel);color:var(--text);border:1px solid var(--border);border-radius:var(--r);padding:4px 8px;font-size:11px;color-scheme:dark">
        ${dateHintLabel}
        <span style="font-size:10px;color:var(--text3)">Required if the chat is older than today — otherwise the AI reads everything as live.</span>
      </div>
      <div style="flex:1;overflow-y:auto;margin-top:10px;background:var(--bg);border:1px solid var(--border);border-radius:var(--r);max-height:45vh">
        ${previewRows}
      </div>
      <div class="ppv-modal-acts" style="margin-top:12px">
        <button class="btn sm" onclick="closeOcrPreviewModal()">Cancel</button>
        <button class="btn sm primary" onclick="confirmOcrImport()">Import to session</button>
      </div>
    </div>
  </div>`;
  document.body.insertAdjacentHTML('beforeend',html);
}

// Resolve a free-text date hint from vision ("Today", "Yesterday", "May 4", "Wed May 4")
// to YYYY-MM-DD relative to today, for prefilling the date picker. Returns '' on failure
// so the agent has to pick — defaulting to today on ambiguous parses is the bug we just fixed.
function resolveOcrDateHint(hint){
  if(!hint||typeof hint!=='string') return '';
  const h=hint.toLowerCase().trim();
  const today=new Date();
  const fmt=d=>{
    const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  };
  if(/^today\b/.test(h)) return fmt(today);
  if(/^yesterday\b/.test(h)){
    const d=new Date(today); d.setDate(d.getDate()-1); return fmt(d);
  }
  // Day-of-week ("last friday", "monday") — coerce backward to most recent occurrence
  const dows=['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const dowMatch=h.match(/\b(last\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if(dowMatch){
    const targetIdx=dows.indexOf(dowMatch[2]);
    const todayIdx=today.getDay();
    let delta=todayIdx-targetIdx;
    if(delta<=0) delta+=7;
    const d=new Date(today); d.setDate(d.getDate()-delta); return fmt(d);
  }
  // Try Date.parse on raw hint (handles "May 4 2026", "May 4", "Wed May 4")
  const parsed=Date.parse(hint);
  if(!isNaN(parsed)){
    const d=new Date(parsed);
    // If the parsed year is the default-fallback (1970/2001), assume current year
    if(d.getFullYear()<2020) d.setFullYear(today.getFullYear());
    return fmt(d);
  }
  return '';
}

// Combine a YYYY-MM-DD date with a 12-hour time string ("3:45 PM") to an ISO timestamp.
// Returns null if either part is missing or unparseable — caller falls back to "now".
function combineDateAndTime(ymd,timeStr){
  if(!ymd) return null;
  if(!timeStr){
    // Date only — anchor at noon local so timezone shift doesn't flip the date
    const d=new Date(ymd+'T12:00:00');
    return isNaN(d.getTime())?null:d.toISOString();
  }
  const m=/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)?\b/.exec(timeStr.trim());
  if(!m) return null;
  let hr=parseInt(m[1],10), min=parseInt(m[2],10);
  const ap=(m[3]||'').toUpperCase();
  if(ap==='PM'&&hr<12) hr+=12;
  if(ap==='AM'&&hr===12) hr=0;
  const iso=`${ymd}T${String(hr).padStart(2,'0')}:${String(min).padStart(2,'0')}:00`;
  const d=new Date(iso);
  return isNaN(d.getTime())?null:d.toISOString();
}
function closeOcrPreviewModal(){
  const bg=document.getElementById('ocrPreviewBg');
  if(bg) bg.remove();
  window._pendingOcrMessages=null;
}

// ── ONLYFANS SYNC + REALTIME ──────────────────────────────────
// ── OF CHAT GROUP LOADER ──────────────────────────────────────
// Sidebar group-header "Load chats" → pull ALL of this creator's OnlyFans chats
// + their messages into sessions, then refresh the sidebar so they appear in the
// group (each marked "OF" via of_chat_id / of_message_id). From there the existing
// generate → Accept → auto-send pipeline handles replies.
async function onOfLoadGroup(modelName){
  const model=models.find(m=>m.name===modelName);
  if(!model||!model.of_account_id){toast('No OnlyFans account connected for '+modelName,'e');return;}
  if(!ofIsAuthorized(window.currentChatter,modelName)){toast('Not authorized for this creator','e');return;}
  toast('Loading OnlyFans chats for '+modelName+'…','i');
  try{
    const r=await ofSyncCreator(model.of_account_id,modelName);
    await loadSessions();   // re-hydrate in-memory sessions (incl. the new OF chats)
    renderSidebar();        // they now show in the group with the OF badge
    toast(`${modelName}: ${r.chats} chats, ${r.created} new sessions, ${r.inserted} messages`,'s');
  }catch(e){ toast('Load failed: '+e.message,'e'); }
}

function installOfRealtime(){
  if(!sb||window._ofRealtime) return;
  window._ofRealtime=sb.channel('of_inbound')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'aich_messages'},(payload)=>{
      try{
        const row=payload.new; if(!row||row.sender!=='customer') return;
        const s=Object.values(sessions).find(x=>x.id===row.session_id);
        if(s&&activeId===s.id){
          if(!(s.messages||[]).some(m=>m.of_message_id&&m.of_message_id===row.of_message_id)){
            s.messages=s.messages||[];
            s.messages.push({sender:'customer',text:row.text,ts_iso:row.created_at,of_message_id:row.of_message_id});
            const cm=document.getElementById('chatMsgs');
            if(cm) cm.innerHTML=renderBubbles();
            scrollChat();
            // Finding 2 fix: the session loader hydrates s.messages ONLY from messages_input
            // (aich_sessions blob, line ~1714). Without persisting here the new inbound message
            // is lost on any reload, and posture never sees the new customer reply.
            if(sb) sb.from('aich_sessions').update({messages_input:JSON.stringify(s.messages)}).eq('id',s.id).then(()=>{});
            if(typeof recomputePosture==='function') recomputePosture(s);
            if(typeof updatePostureChip==='function') updatePostureChip();
          }
        }
      }catch(e){console.warn('of realtime render failed:',e.message);}
    }).subscribe();
}

function confirmOcrImport(){
  const pending=window._pendingOcrMessages||[];
  if(!pending.length){closeOcrPreviewModal();return;}
  // Read which messages the agent left checked
  const checks=document.querySelectorAll('#ocrPreviewBg input[data-ocr-idx]');
  const keep=new Set();
  checks.forEach(c=>{
    if(c.checked) keep.add(parseInt(c.dataset.ocrIdx,10));
  });
  // v0.4.3.3: read the agent-specified conversation date. If left blank, we fall back to
  // today's date — same as the pre-fix behavior, but the field now exists for older chats.
  // Per-message `section` label can override the conversation date if vision saw a date
  // separator before that bubble (e.g. "Yesterday" / "May 3" while the conversation date
  // is "May 4"). Section labels are best-effort and resolve relative to the conv date.
  const dateInput=document.getElementById('ocrDateInput');
  const convDate=(dateInput&&dateInput.value)?dateInput.value:''; // YYYY-MM-DD or ''
  const nowIso=new Date().toISOString();
  const s=sessions[activeId];
  if(!s){closeOcrPreviewModal();return;}
  s.messages=s.messages||[];
  let added=0;
  pending.forEach((m,i)=>{
    if(!keep.has(i)) return;
    // Per-message date resolution priority:
    //   1. message.section label resolved relative to today (if vision tagged it)
    //   2. agent-picked conversation date + message.ts (most reliable)
    //   3. agent-picked conversation date alone (noon anchor)
    //   4. fall back to now (legacy behavior — only when no date specified at all)
    let resolvedIso=null;
    if(m.section){
      const sectionDate=resolveOcrDateHint(m.section);
      if(sectionDate) resolvedIso=combineDateAndTime(sectionDate,m.ts);
    }
    if(!resolvedIso && convDate){
      resolvedIso=combineDateAndTime(convDate,m.ts);
    }
    if(!resolvedIso) resolvedIso=nowIso;
    const msgObj={
      sender:(m.sender==='ppv'||m.sender==='customer'||m.sender==='model')?m.sender:'customer',
      text:m.text||'',
      ts:m.ts||'',
      ts_iso:resolvedIso
    };
    if(m.sender==='ppv'){
      if(typeof m.price==='number') msgObj.price=m.price;
      else if(m.price) msgObj.price=parseFloat(String(m.price).replace(/[^0-9.]/g,''))||0;
      msgObj.opened=m.opened===true;
    } else if(m.media===true){
      // v0.4.1.5: vision flagged free media on a text bubble. Customer-side → CAME-WITH-MEDIA,
      // model-side → FREE-MEDIA. Same tag schema fmtMsgForAI already understands.
      msgObj.tags=msgObj.tags||{};
      if(msgObj.sender==='customer') msgObj.tags.customerMedia=true;
      else if(msgObj.sender==='model') msgObj.tags.freeMedia=true;
      // v0.4.4.0 Finding #6: carry the vision-extracted media description through.
      if(m.media_description&&typeof m.media_description==='string') msgObj.tags.mediaDescription=m.media_description.trim();
    }
    s.messages.push(msgObj);
    added++;
  });
  closeOcrPreviewModal();
  if(sb){
    sb.from('aich_sessions').update({messages_input:JSON.stringify(s.messages)}).eq('id',activeId).then(()=>{});
  }
  // Re-render UI
  const chatMsgs=document.getElementById('chatMsgs');
  if(chatMsgs) chatMsgs.innerHTML=renderBubbles();
  scrollChat();
  toast(`Imported ${added} message${added===1?'':'s'}`,'s');
}

