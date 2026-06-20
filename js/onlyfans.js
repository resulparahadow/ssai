// js/onlyfans.js — OnlyFans API integration (v1). Pure helpers + proxy calls.
// No module system: functions are global (loaded via <script> after app.js, and
// into tests/harness.js). Pure helpers here are mirrored in the Deno Edge
// Functions (supabase/functions/onlyfans-*) — keep them in sync.

// Returns true when a paid (PPV) send must be blocked in v1 (text-only).
function ofPpvBlocked(price){
  const n=Number(price)||0;
  return n>0;
}

// Strip HTML to plain text + decode the common entities OF returns. Runs before
// any DB insert so fan-controlled markup never reaches the DOM (defense in depth
// with the client esc()).
function ofHtmlStripToText(html){
  if(!html) return '';
  let s=String(html);
  s=s.replace(/<[^>]*>/g,'');                  // drop tags
  s=s.replace(/&nbsp;/g,' ')
     .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
     .replace(/&quot;/g,'"').replace(/&#39;/g,"'");
  s=s.replace(/\s+/g,' ').trim();              // collapse whitespace
  return s;
}

// Map an OnlyFansAPI message object to SSAI's message shape.
function ofNormalizeMessage(raw,sender){
  return {
    sender:sender,
    text:ofHtmlStripToText(raw&&raw.text),
    of_message_id:raw&&raw.id!=null?String(raw.id):null,
    ts_iso:(raw&&raw.createdAt)||new Date().toISOString()
  };
}

// acct_XXXX -> creator_model name (the isolation boundary). null if unmapped.
function ofResolveCreator(models,accountId){
  if(!Array.isArray(models)||!accountId) return null;
  const hit=models.find(m=>m&&m.of_account_id&&m.of_account_id===accountId);
  return hit?hit.name:null;
}

// Stable session routing key. of_chat_id is always a string (fan's OF user id).
function ofSessionKey(creatorModel,fanUserId){
  return {creator_model:creatorModel,of_chat_id:String(fanUserId)};
}

// v1 send body — text only. (PPV path never reaches here; ofShouldAutoSend gates it.)
function ofBuildSendBody(text){
  return {text:text};
}

// Outbound auto-send guard. creatorModelRow is the aich_models row for the session's creator.
function ofShouldAutoSend(session,creatorModelRow){
  if(!session||!creatorModelRow) return false;
  if(session._draftIsPpv) return false;
  if(!session.of_chat_id) return false;
  if(!creatorModelRow.of_account_id) return false;
  return true;
}

// Client-side mirror of the proxy's authorization (manager OR assigned chatter).
// The proxy enforces this server-side too; this gives an early, friendly block.
function ofIsAuthorized(chatter,creatorModel){
  if(!chatter) return false;
  if(chatter.role==='manager') return true;
  return Array.isArray(chatter.assignments)&&chatter.assignments.includes(creatorModel);
}

// Low-level proxy call. All OF traffic goes through onlyfans-proxy with the
// per-chatter ssai_* token (same contract as callApi). The OF API key never
// leaves the server.
async function _ofProxy(payload){
  const tk=getProxyToken();
  if(!tk) throw new Error('Proxy token missing — contact your manager');
  let attempt=0;
  while(attempt<3){
    attempt++;
    const r=await fetch(ONLYFANS_PROXY_URL,{
      method:'POST',
      headers:{'Content-Type':'application/json','x-ssai-token':tk},
      body:JSON.stringify(payload)
    });
    if(r.status===429 && attempt<3){
      const ra=parseFloat(r.headers.get('retry-after')||'0');
      const delay=ra>0?Math.min(ra*1000,8000):(attempt===1?1200:3500)+Math.floor(Math.random()*400);
      await new Promise(res=>setTimeout(res,delay));
      continue;
    }
    const d=await r.json().catch(()=>({}));
    if(!r.ok||d.error) throw new Error('OnlyFans proxy error '+r.status+': '+(d.error||r.statusText||'unknown'));
    return d;
  }
  throw new Error('OnlyFans rate limited (429) after retries — try again shortly');
}

// Pull chats or a chat's messages for a connected account.
async function ofPull(accountId,op,chatId,params){
  if(op!=='list_chats'&&op!=='list_messages') throw new Error('ofPull: bad op '+op);
  return _ofProxy({op:op,account_id:accountId,chat_id:chatId,params:params});
}

// Send a TEXT reply. Blocks PPV client-side (server rejects it too).
async function ofSend(accountId,chatId,text){
  return _ofProxy({op:'send',account_id:accountId,chat_id:chatId,message:ofBuildSendBody(text)});
}

// Extract the next-page params from an OnlyFansAPI _pagination block.
// next_page may be null/false (end), a URL/path with a query string, or an object.
// Returns an allowlisted params object (limit/offset/id/order) or null at the end.
function ofNextCursor(pagination){
  if(!pagination) return null;
  const np=pagination.next_page;
  if(!np) return null;
  const keys=['limit','offset','id','order'];
  const out={};
  if(typeof np==='string'){
    const q=np.indexOf('?'); if(q<0) return null;
    for(const pair of np.slice(q+1).split('&')){
      const eq=pair.indexOf('='); if(eq<0) continue;
      const k=decodeURIComponent(pair.slice(0,eq)), v=decodeURIComponent(pair.slice(eq+1));
      if(keys.includes(k)&&v!=='') out[k]=v;
    }
  } else if(typeof np==='object'){
    for(const k of keys) if(np[k]!=null) out[k]=String(np[k]);
  }
  return Object.keys(out).length?out:null;
}

// True when a session is an unloaded OnlyFans stub: it has of_chat_id but its
// messages_input has never been written (null). Once messages_input is set
// (even '[]'), the chat is considered loaded.
function ofNeedsLoad(session){
  return !!(session && session.of_chat_id && !session.messages_input);
}

// One paginated page of an account's chats. `cursor` is the params object from a
// previous ofNextCursor (or null/undefined for page 1). Returns the chats + the
// next cursor (null at end).
async function ofListChatsPage(accountId, cursor){
  const res=await ofPull(accountId,'list_chats',null,cursor||undefined);
  const chats=(res&&res.data)||[];
  const next=ofNextCursor(res&&res._pagination);
  return { chats, next };
}

// Batch find-or-create STUB sessions for a page of chats (name only, no messages).
// One SELECT for existing of_chat_ids + one bulk INSERT of the missing rows.
// messages_input is intentionally left null → ofNeedsLoad(session) === true.
async function ofCreateSessionRows(creatorModel, chats){
  const rows=(chats||[]).map(c=>{
    const fan=c.fan||c.withUser||{};
    const id=String(fan.id??'');
    return id?{ id, name:fan.name||fan.username||id, username:fan.username||('of_'+id) }:null;
  }).filter(Boolean);
  if(!rows.length) return { created:0 };
  const ids=rows.map(r=>r.id);
  const { data:existing }=await sb.from('aich_sessions').select('of_chat_id')
    .eq('creator_model',creatorModel).in('of_chat_id',ids);
  const have=new Set((existing||[]).map(e=>String(e.of_chat_id)));
  const missing=rows.filter(r=>!have.has(r.id));
  if(!missing.length) return { created:0 };
  const { error }=await sb.from('aich_sessions').insert(missing.map(r=>({
    creator_model:creatorModel,
    customer_name:r.name,
    customer_username:r.username,
    of_chat_id:r.id,
    status:'active',
    current_posture:'WARM_BUILD',
    last_active_at:new Date().toISOString()
  })));
  if(error){ console.warn('[of] stub insert failed:',error.message); return { created:0 }; }
  return { created:missing.length };
}

// Pull ONE chat's messages (first page), normalize + sort, batch-upsert to the
// dedup ledger, and write messages_input (the display source). Returns the
// normalized messages. messages_input is always written (even '[]') so the chat
// is marked loaded and won't re-fetch on every open.
async function ofLoadChatMessages(accountId, creatorModel, fanId){
  const chatId=String(fanId);
  const res=await ofPull(accountId,'list_messages',chatId);
  const raws=(res&&res.data)||[];
  const norm=raws
    .map(raw=>ofNormalizeMessage(raw,(raw.fromUser&&String(raw.fromUser.id)===chatId)?'customer':'model'))
    .filter(m=>m.of_message_id)
    .sort((a,b)=>String(a.ts_iso).localeCompare(String(b.ts_iso)));
  const { data:sess }=await sb.from('aich_sessions').select('id')
    .eq('creator_model',creatorModel).eq('of_chat_id',chatId).maybeSingle();
  if(sess && norm.length){
    const { error }=await sb.from('aich_messages').upsert(
      norm.map(n=>({ session_id:sess.id, sender:n.sender, text:n.text, of_message_id:n.of_message_id, created_at:n.ts_iso })),
      { onConflict:'of_message_id', ignoreDuplicates:true }
    );
    if(error) console.warn('[of] message batch upsert failed:',error.message);
  }
  if(sess){
    await sb.from('aich_sessions').update({
      messages_input:JSON.stringify(norm.map(m=>({sender:m.sender,text:m.text,of_message_id:m.of_message_id,ts_iso:m.ts_iso}))),
      last_active_at:new Date().toISOString()
    }).eq('id',sess.id);
  }
  return norm;
}
