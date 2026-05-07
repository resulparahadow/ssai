// v0.3.0.37.4: single source of truth for app version. The <title> in the
// HTML head is set to the same value at build time, but if it ever drifts
// (e.g. sed-replace targets the wrong string), this auto-fixes it on load
// so the tab title is always the actual code version.
const SSAI_VERSION='0.4.3.1';
try{document.title='SmartStarsAI v'+SSAI_VERSION;}catch(e){}
try{const bv=document.getElementById('brandVersion');if(bv)bv.textContent='v'+SSAI_VERSION;}catch(e){}
// v0.3.0.38: also surface version in topbar so chatters can confirm which build they're on
try{
  const setBrandVersion=()=>{const el=document.getElementById('brandVersion');if(el) el.textContent='v'+SSAI_VERSION;};
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',setBrandVersion);
  else setBrandVersion();
}catch(e){}

const SB_URL='https://atzuqzdgqqcrcwthshfs.supabase.co';
const SB_KEY='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF0enVxemRncXFjcmN3dGhzaGZzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY1NDY3NzksImV4cCI6MjA5MjEyMjc3OX0.YwUSoh2OHuIBFW9R-BxTFS2DstIn5XjcH7a8jRqYz6I';
// Claude key is loaded from localStorage only (set in Settings → API Keys).
// Never hardcoded in this file. If empty, callApi throws and the UI shows
// a clear "no key" banner instead of silently using a leaked key.
const CK_DEFAULT='';

// v0.3.0.38: Edge Function proxy for Anthropic API.
// Default mode: PROXY ON. The browser never holds a real Anthropic key —
// it sends a per-chatter proxy token to a Supabase Edge Function which
// forwards to Anthropic with the server-held real key.
// To revert temporarily (emergency): set localStorage.ss_use_proxy='false'.
const PROXY_URL='https://atzuqzdgqqcrcwthshfs.supabase.co/functions/v1/anthropic-proxy';
// v0.3.0.38: same proxy pattern for Mistral via OpenRouter.
const MISTRAL_PROXY_URL='https://atzuqzdgqqcrcwthshfs.supabase.co/functions/v1/mistral-proxy';
function useProxy(){
  // Default ON. Only OFF if explicitly set to the string 'false'.
  return localStorage.getItem('ss_use_proxy')!=='false';
}
// Returns the chatter's per-user proxy token from localStorage, or '' if unset.
// Callers MUST check the return value and surface a clear error — no hardcoded
// fallback exists. A shared default token would let anyone with the source
// hit the Anthropic/Mistral proxies on the agency's billing.
function getProxyToken(){
  return localStorage.getItem('ss_proxy_token')||'';
}

