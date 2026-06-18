/* A/B DOCTRINE TEST — positive-example cut (2026-06-13)
 * Generates the SAME conversations with current doctrine (A) vs doctrine minus the
 * 40 positive "REFERENCE EXAMPLE" lines (B). Same session state for A and B, no accept
 * between, so the only variable is the doctrine. Swaps the live `globalTraining` var,
 * always restores it. Drafts captured for side-by-side voice review.
 *   Load: fetch('tests/ab_doctrine.js').then(r=>r.text()).then(eval)
 *   Run:  _AB.run()   Results: window._AB_RESULTS
 */
window._AB = (function(){
  const sleep=ms=>new Promise(r=>setTimeout(r,ms));
  // treatment: strip positive REFERENCE EXAMPLE lines (NOT negative/WRONG/hard-NO lines)
  function buildCut(orig){
    return orig.split('\n').filter(l=>!/^\s*REFERENCE EXAMPLE\b/i.test(l)).join('\n');
  }
  // voice-stressing scenarios across creators (examples matter most on these beats)
  const SC=[
    {creator:'Camila', label:'flirty opener',        ppv:false, msgs:[['customer',"hey camila just found your page, you're stunning ngl"]]},
    {creator:'Camila', label:'emotional/vulnerable',  ppv:false, msgs:[['model',"hey you 😌"],['customer',"honestly rough week man, just needed someone to talk to"]]},
    {creator:'Camila', label:'objection do15',        ppv:false, msgs:[['model',"i've got something special for you 😏"],['customer',"how much? can you do like 15?"]]},
    {creator:'Cielo',  label:'PPV caption',           ppv:true,  spend:25, msgs:[['customer',"omg yes i wanna see more of you"]]},
    {creator:'Cielo',  label:'high-ticket love-frame',ppv:false, spend:200, msgs:[['customer',"you're honestly the only one i really open up to, you know that?"]]},
    {creator:'Cielo',  label:'flirty opener',         ppv:false, msgs:[['customer',"hey cielo you're gorgeous, what are you up to tonight"]]},
    {creator:'Cindy',  label:'emotional lonely',       ppv:false, msgs:[['customer',"ngl been lonely lately, nice to actually talk to someone real"]]},
    {creator:'Cindy',  label:'objection burned',       ppv:false, msgs:[['model',"i don't share this with just anyone 😌"],['customer',"been burned by other girls before, was it even worth it"]]},
    {creator:'Yendry', label:'spanish opener',         ppv:false, msgs:[['customer',"hola hermosa, acabo de ver tu perfil y me encantó"]]},
    {creator:'Jammy',  label:'flirty opener',          ppv:false, msgs:[['customer',"hey jammy your vibe is everything, hi from california"]]},
  ];
  function draftOf(s){ return typeof s.draft==='string'?s.draft:(s.draft&&s.draft.text)||''; }
  async function run(){
    const orig=globalTraining;
    const cut=buildCut(orig);
    const savedTok=Math.round((orig.length-cut.length)/4);
    const _origIntel=window.extractCustomerIntel; window.extractCustomerIntel=function(){};
    const results=[];
    try{
      for(const sc of SC){
        try{
          document.getElementById('ns_model').value=sc.creator;
          document.getElementById('ns_name').value='ab';
          document.getElementById('ns_username').value='mk_ab_'+sc.creator.toLowerCase()+'_'+sc.label.replace(/\W+/g,'').slice(0,10);
          document.getElementById('ns_spend').value=String(sc.spend||0);
          document.getElementById('ns_tips').value='0'; document.getElementById('ns_time').value='15m'; document.getElementById('ns_status').value='subscribed';
          await createSession(); const s=sessions[activeId];
          const now=Date.now();
          s.messages=sc.msgs.map((m,i)=>({sender:m[0],text:m[1],ts_iso:new Date(now-(sc.msgs.length-i)*60000).toISOString()}));
          if(sc.spend){ s.total_spend=sc.spend; s._profile={total_spend:sc.spend,tips_spend:0}; s._customerTier=(typeof computeCustomerTier==='function')?computeCustomerTier(s,s._profile):'old'; }
          try{ recomputePosture(s); }catch(e){}
          // A — original doctrine
          globalTraining=orig;
          setSender(sc.ppv?'ppv':'customer'); if(!sc.ppv && currentSender==='ppv') setSender('customer');
          await generate(); const A=draftOf(s); const Aphase=s._lastStrategy?.phase; const Amove=s._lastStrategy?.next_move_after_wall||s._lastStrategy?.next_move; s.draft=null; s._draftIsPpv=false;
          // B — cut doctrine (examples removed)
          globalTraining=cut;
          setSender(sc.ppv?'ppv':'customer'); if(!sc.ppv && currentSender==='ppv') setSender('customer');
          await generate(); const B=draftOf(s); const Bphase=s._lastStrategy?.phase; const Bmove=s._lastStrategy?.next_move_after_wall||s._lastStrategy?.next_move; s.draft=null; s._draftIsPpv=false;
          globalTraining=orig;
          results.push({creator:sc.creator, label:sc.label, A, B, Aphase, Bphase, Amove, Bmove});
          window._AB_RESULTS=results;
        }catch(e){ globalTraining=orig; results.push({creator:sc.creator,label:sc.label,err:e.message}); }
        await sleep(300);
      }
    } finally { globalTraining=orig; window.extractCustomerIntel=_origIntel; }
    window._AB_RESULTS=results;
    return {scenarios:results.length, cutTokensSaved:savedTok, done:true};
  }
  return {run, buildCut};
})();
console.log('[AB] loaded — _AB.run() to A/B the positive-example doctrine cut across 10 scenarios.');
