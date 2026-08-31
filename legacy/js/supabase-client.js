
let sb,api=localStorage.getItem('ss_api_mode')||'claude',sessions={},activeId=null,models=[],respCount=0,currentSender='customer';
let globalTraining=localStorage.getItem('ss_training')||DEFAULT_TRAINING;
let collapsed={};
let sidebarMode='active'; // 'active' | 'archived'
let archivedSessions={}; // loaded lazily when user flips to archived tab
let archivedLoaded=false;

// v0.4.1.1: Supabase library readiness guard. The cache-control headers added
// to bust stale builds also forced a re-fetch of the Supabase JS lib from the
// CDN every load, which created a race condition where doLogin() / bootstrap
// could fire before window.supabase was defined. This helper polls up to 5s
// for the library to land before resolving. Throws a clean error after timeout
// instead of the cryptic 'createClient of undefined'.
async function ensureSupabaseLoaded(timeoutMs=5000){
  if(window.supabase && typeof window.supabase.createClient==='function') return;
  const start=Date.now();
  while(Date.now()-start < timeoutMs){
    if(window.supabase && typeof window.supabase.createClient==='function') return;
    await new Promise(r=>setTimeout(r,50));
  }
  throw new Error('Supabase library failed to load. Check your network connection and reload.');
}

// v0.4.1.1: single-source-of-truth client creator. Use this everywhere instead
// of calling window.supabase.createClient directly so the readiness check is
// guaranteed to run first.
async function getOrCreateSb(){
  if(sb) return sb;
  await ensureSupabaseLoaded();
  sb=window.supabase.createClient(SB_URL,SB_KEY);
  return sb;
}
