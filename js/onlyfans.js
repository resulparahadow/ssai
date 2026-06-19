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
