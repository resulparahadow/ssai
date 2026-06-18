// SSAI AI-slop scanner — detects LLM writing tells in generated drafts.
// Usage:
//   node tests/slop_scan.js '["msg one","msg two",...]'        (JSON array arg)
//   echo '["msg one","msg two"]' | node tests/slop_scan.js     (stdin)
// Also exported for require() so the harness / in-page mirror can share the lexicon.
// Scores a SESSION (ordered array of model messages), not isolated lines —
// half the tells are repetition across messages.

const SLOP_RULES={
  // per-message regex tells
  em_dash:{rx:/—/g,label:'em-dash (writerly, not texting)'},
  semicolon:{rx:/;/g,label:'semicolon in a text message'},
  therapy_register:{rx:/\b(i hear you|that'?s (so )?valid|i'?m here for you|holding space|i appreciate you (sharing|opening up)|your feelings are)\b/gi,label:'therapy/assistant register'},
  meta_ai:{rx:/\b(as an ai|language model|i don'?t have (feelings|a body)|i'?m (just )?an? (ai|assistant|bot))\b/gi,label:'CATASTROPHIC: AI self-reference'},
  balanced_pair:{rx:/\b(it'?s )?not (just |only )?\w[^.!?\n]{0,30}\b(but|it'?s about|more about)\b/gi,label:'balanced not-X-but-Y construction'},
  llm_vocab:{rx:/\b(delve|tapestry|vibrant|unleash|navigate (this|these|life)|journey together|testament to|i must say)\b/gi,label:'LLM vocabulary'},
  formal_full_forms:{rx:/\b(do not|did not|cannot|i will not|you did not|i am unable)\b/gi,label:'formal full form in casual voice'},
};

// framing phrases counted across the session — 1 use is fine, 2+ is a tic
const FRAMING_PHRASES=['real question','honestly','actually','literally','tbh','i can’t lie','i cant lie','to be fair','i have to say','not gonna lie'];

function scanSession(messages){
  const hits=[]; const counts={};
  const add=(cat,msgIdx,snippet)=>{ counts[cat]=(counts[cat]||0)+1; hits.push({cat,msgIdx,snippet:String(snippet).slice(0,60)}); };
  messages.forEach((m,i)=>{
    const text=String(m||'');
    for(const [cat,rule] of Object.entries(SLOP_RULES)){
      const found=text.match(rule.rx);
      if(found) found.forEach(f=>add(cat,i,f));
    }
  });
  // session-level repetition tells
  const lower=messages.map(m=>String(m||'').toLowerCase());
  FRAMING_PHRASES.forEach(p=>{
    const n=lower.filter(t=>t.includes(p)).length;
    if(n>=2) add('framing_repeat','-',`"${p}" x${n} across session`);
  });
  // same opener on consecutive messages
  for(let i=1;i<lower.length;i++){
    const a=(lower[i-1].trim().split(/\s+/)[0]||''), b=(lower[i].trim().split(/\s+/)[0]||'');
    if(a&&a===b&&a.length>1) add('opener_repeat',i,`consecutive msgs open with "${a}"`);
  }
  // contraction whiplash: session drops apostrophes overall but a message uses full forms
  const dropped=lower.filter(t=>/\b(dont|im|thats|cant|didnt|youre|ive)\b/.test(t)).length;
  if(dropped>=2){
    lower.forEach((t,i)=>{ if(/\b(do not|did not|cannot|i will|it is not)\b/.test(t)) add('contraction_whiplash',i,t.match(/\b(do not|did not|cannot|i will|it is not)\b/)[0]); });
  }
  // emoji repetition within a 2-message window
  const emojiRx=/\p{Extended_Pictographic}/gu;
  for(let i=1;i<messages.length;i++){
    const prev=new Set((String(messages[i-1]).match(emojiRx))||[]);
    ((String(messages[i]).match(emojiRx))||[]).forEach(e=>{ if(prev.has(e)) add('emoji_repeat',i,e); });
  }
  const total=hits.length;
  return {total,counts,hits,perMessage:+(total/Math.max(1,messages.length)).toFixed(2)};
}

if(require.main===module){
  const arg=process.argv[2];
  const input=arg||require('fs').readFileSync(0,'utf8');
  const msgs=JSON.parse(input);
  const r=scanSession(msgs);
  console.log(JSON.stringify(r,null,2));
  console.log(`\nSLOP SCORE: ${r.total} hits across ${msgs.length} messages (${r.perMessage}/msg)`);
}

module.exports={scanSession,SLOP_RULES,FRAMING_PHRASES};
