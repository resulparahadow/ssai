/* A/B GENERATOR-CACHE SPLIT (2026-06-13)
 * Tests the biggest T3 lever: does the generator need the full doctrine in its cache?
 * A = generator reads full doctrine (current). B = generator reads NO doctrine Layer-1
 * (just persona + its own rules block + the strategy JSON). Same conversation, same session
 * state, same STRATEGY (strategy call is identical both runs — only the generator's Layer-1
 * differs, toggled via window._genDoctrineMode). Drafts captured for side-by-side voice review.
 *   Load: fetch('tests/ab_gensplit.js').then(r=>r.text()).then(eval)
 *   Run:  _ABG.run()   Results: window._ABG_RESULTS
 */
window._ABG = (function(){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  const SC=[
    {creator:'Camila', label:'flirty opener',        ppv:false, msgs:[['customer',"hey camila just found your page, you're stunning ngl"]]},
    {creator:'Camila', label:'emotional/vulnerable',  ppv:false, msgs:[['model',"hey you 😌"],['customer',"honestly rough week man, just needed someone to talk to"]]},
    {creator:'Camila', label:'objection do15',        ppv:false, msgs:[['model',"i've got something special for you 😏"],['customer',"how much? can you do like 15?"]]},
    {creator:'Cielo',  label:'PPV caption',           ppv:true,  spend:25, msgs:[['customer',"omg yes i wanna see more of you"]]},
    {creator:'Cielo',  label:'high-ticket love-frame',ppv:false, spend:200, msgs:[['customer',"you're honestly the only one i really open up to, you know that?"]]},
    {creator:'Cielo',  label:'promise reinforce ppv', ppv:true,  spend:60, msgs:[['model',"i don't show this side to just anyone 😌"],['customer',"i won't share it i promise, send it"]]},
    {creator:'Cindy',  label:'emotional lonely',       ppv:false, msgs:[['customer',"ngl been lonely lately, nice to actually talk to someone real"]]},
    {creator:'Cindy',  label:'objection burned',       ppv:false, msgs:[['model',"i don't share this with just anyone 😌"],['customer',"been burned by other girls before, was it even worth it"]]},
    {creator:'Yendry', label:'spanish opener',         ppv:false, msgs:[['customer',"hola hermosa, acabo de ver tu perfil y me encantó"]]},
    {creator:'Jammy',  label:'flirty opener',          ppv:false, msgs:[['customer',"hey jammy your vibe is everything, hi from california"]]},
  ];
  function draftOf(s){ return typeof s.draft==='string'?s.draft:(s.draft&&s.draft.text)||''; }
  async function genOnce(s, ppv){
    setSender(ppv?'ppv':'customer'); if(!ppv && currentSender==='ppv') setSender('customer');
    await generate(); const d=draftOf(s); s.draft=null; s._draftIsPpv=false; return d;
  }
  async function run(){
    const _origIntel=window.extractCustomerIntel; window.extractCustomerIntel=function(){};
    const results=[];
    try{
      for(const sc of SC){
        try{
          document.getElementById('ns_model').value=sc.creator;
          document.getElementById('ns_name').value='abg'; document.getElementById('ns_username').value='mk_abg_'+sc.creator.toLowerCase()+'_'+sc.label.replace(/\W+/g,'').slice(0,8);
          document.getElementById('ns_spend').value=String(sc.spend||0); document.getElementById('ns_tips').value='0'; document.getElementById('ns_time').value='15m'; document.getElementById('ns_status').value='subscribed';
          await createSession(); const s=sessions[activeId];
          const now=Date.now();
          s.messages=sc.msgs.map((m,i)=>({sender:m[0],text:m[1],ts_iso:new Date(now-(sc.msgs.length-i)*60000).toISOString()}));
          if(sc.spend){ s.total_spend=sc.spend; s._profile={total_spend:sc.spend,tips_spend:0}; s._customerTier=(typeof computeCustomerTier==='function')?computeCustomerTier(s,s._profile):'old'; }
          try{ recomputePosture(s); }catch(e){}
          // A — generator reads FULL doctrine (current)
          window._genDoctrineMode='full';
          const A=await genOnce(s, sc.ppv);
          // B — generator reads NO doctrine Layer-1
          window._genDoctrineMode='none';
          const B=await genOnce(s, sc.ppv);
          window._genDoctrineMode='full';
          results.push({creator:sc.creator, label:sc.label, A, B});
          window._ABG_RESULTS=results;
        }catch(e){ window._genDoctrineMode='full'; results.push({creator:sc.creator,label:sc.label,err:e.message}); }
        await sleep(300);
      }
    } finally { window._genDoctrineMode='full'; window.extractCustomerIntel=_origIntel; }
    window._ABG_RESULTS=results;
    return {scenarios:results.length, done:true};
  }
  return {run};
})();
console.log('[ABG] loaded — _ABG.run() to A/B the generator-cache split (full doctrine vs none).');
