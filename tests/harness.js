// SSAI deterministic stress harness — loads real app code into a sandbox, hammers the
// guard/detector layer with synthetic customers. Zero API calls, zero DB writes.
const fs=require('fs'),vm=require('vm');
const ROOT=require('path').join(__dirname,'..');

// ── sandbox stubs ──
const noop=()=>{};
const elStub=()=>({style:{},innerHTML:'',textContent:'',value:'',title:'',className:'',
  appendChild:noop,remove:noop,addEventListener:noop,setAttribute:noop,querySelectorAll:()=>[],
  insertAdjacentHTML:noop,focus:noop,click:noop,dataset:{},checked:false});
const documentStub={title:'',getElementById:()=>null,querySelectorAll:()=>[],querySelector:()=>null,
  addEventListener:noop,removeEventListener:noop,createElement:elStub,
  body:{insertAdjacentHTML:noop,appendChild:noop,classList:{add:noop,remove:noop}},
  documentElement:{style:{}},readyState:'complete'};
const sandbox={
  console, setTimeout:(fn)=>0, clearTimeout:noop, setInterval:()=>0, clearInterval:noop,
  document:documentStub,
  localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
  navigator:{clipboard:{writeText:()=>Promise.resolve()},userAgent:'node'},
  fetch:()=>Promise.reject(new Error('no network in harness')),
  alert:noop, confirm:()=>true, prompt:()=>null,
  crypto:{subtle:{digest:async()=>new ArrayBuffer(32)},getRandomValues:(a)=>a},
  supabase:{createClient:()=>null},
  Date, Math, JSON, RegExp, String, Number, Array, Object, Promise, parseFloat, parseInt, isNaN, encodeURIComponent, decodeURIComponent,
};
sandbox.window=sandbox; sandbox.self=sandbox; sandbox.globalThis=sandbox;
sandbox.window.addEventListener=noop; sandbox.window.removeEventListener=noop;
vm.createContext(sandbox);

const load=(f)=>{ try{ vm.runInContext(fs.readFileSync(`${ROOT}/js/${f}`,'utf8'),sandbox,{filename:f}); return true; }
  catch(e){ console.log(`  [load ${f}] threw at top level: ${e.message} (functions defined before the throw still usable)`); return false; } };
['config.js','doctrine.js','ui.js','app.js','onlyfans.js'].forEach(f=>load(f));

// availability check
const need=['computePosture','recomputePosture','computeCustomerTier','computeWallState','computeLadderState',
 'capTrustBySpend','parseMoney','effectiveSessionSpend','effectiveLifetimeSpend','detectContinuedInterest',
 'detectSextingActive','detectTipPrimary','detectInvestmentSignals','detectFork','scanForBanned','detectPromiseCommitment','resolveOcrDateHint','combineDateAndTime','sanitizeSlop','dedupeEmoji','ofPpvBlocked','ofHtmlStripToText','ofNormalizeMessage','ofResolveCreator','ofSessionKey','ofBuildSendBody','ofShouldAutoSend','ofIsAuthorized','ofNextCursor','ofNeedsLoad'];
const missing=need.filter(n=>typeof sandbox[n]!=='function');
console.log('Functions loaded:',need.length-missing.length,'/',need.length, missing.length?('— MISSING: '+missing.join(', ')):'');
const F={}; need.forEach(n=>F[n]=sandbox[n]);

// ── mock factory ──
let NOWi=0;
const msg=(sender,text,extra={})=>({sender,text,ts_iso:new Date(Date.now()-1000*60*(500-(NOWi++))).toISOString(),...extra});
const C=(t,e)=>msg('customer',t,e), M=(t,e)=>msg('model',t,e), PPV=(price,opened,e={})=>msg('ppv','caption',{price,opened,...e});
const mk=(o={})=>({creator_model:'Jammy',customer_name:'Mock',customer_username:'mock_test',
  total_spend:o.spend||0,tips_spend:o.tips||0,time_on_page:'1h',subscription_status:'subscribed',crm_notes:'',
  messages:o.msgs||[],_freeMsgCount:o.free||0,_unpaidCtaCount:o.cta||0,
  _customerTier:o.tier||'new',_promiseStatus:o.promise||'not_started',_promiseMode:o.promiseMode||'ritual',
  _sextingModeToggle:o.sexting||'AUTO',_tipModeToggle:o.tipMode||'AUTO',_storyFrameworkStep:0,
  _profile:o.profile||{total_spend:o.lifeSpend||0,tips_spend:o.lifeTips||0,trust_level:o.trust||1,archetype:o.archetype||'Unknown'}});

// ── assert runner ──
let pass=0,fail=0; const fails=[];
const T=(name,got,want)=>{ const ok=(typeof want==='function')?want(got):Object.is(got,want);
  if(ok){pass++;} else {fail++; fails.push(`✗ ${name}\n    got: ${JSON.stringify(got)} | want: ${typeof want==='function'?'(predicate)':JSON.stringify(want)}`);} };
const posture=(s)=>{ F.recomputePosture(s); return s._posture; };

console.log('\n══ A. SPEND / TRUST ══');
T('capTrust(5,$0)=1',F.capTrustBySpend(5,0),1);
T('capTrust(5,$5)=2',F.capTrustBySpend(5,5),2);
T('capTrust(5,$30)=3',F.capTrustBySpend(5,30),3);
T('capTrust(5,$100)=4',F.capTrustBySpend(5,100),4);
T('capTrust(5,$250)=5',F.capTrustBySpend(5,250),5);
T('capTrust respects AI floor (2,$250)=2',F.capTrustBySpend(2,250),2);
T('parseMoney("$1,234")',F.parseMoney('$1,234'),1234);
T('effectiveSessionSpend = PPV+tips',F.effectiveSessionSpend(mk({spend:50,tips:20})),70);
T('effectiveLifetime includes tips',F.effectiveLifetimeSpend({total_spend:100,tips_spend:40},mk()),x=>x>=140);

console.log('══ B. POSTURE LADDER (new tier: 7/11/16) ══');
T('free0 → WARM_BUILD',posture(mk({free:0,msgs:[C('hey Jammy how are you'),M('hi')]})),'WARM_BUILD');
T('free7 → PROBE',posture(mk({free:7,msgs:[C('hey Jammy hows your day'),M('hi')]})),'PROBE');
T('free11 → PRESSURE',posture(mk({free:11,msgs:[C('hey Jammy tell me about you'),M('hi')]})),'PRESSURE');
T('free16+CTA tried → TIMEWASTER',posture(mk({free:16,msgs:[C('hey Jammy whats up'),M('pitch',{phase:'cta1'}),C('cool story')]})),'TIMEWASTER');
T('free16 NO CTA ever → PRESSURE (GUARD1)',posture(mk({free:16,msgs:[C('hey Jammy whats up'),M('chat')]})),'PRESSURE');
T('free16+CTA+opened PPV → PRESSURE (GUARD2)',posture(mk({free:16,msgs:[M('p',{phase:'cta1'}),PPV(20,true),C('nice babe')]})),'PRESSURE');
T('TW + tip in grace window → PRESSURE (GUARD3)',posture(mk({free:5,tips:10,msgs:[M('p',{phase:'cta1'}),C('ok'),C('ok2')],profile:{is_timewaster:true,total_spend:0,trust_level:1}})),'PRESSURE');
T('whale override: TW→PRESSURE (trust4,$100)',posture(mk({free:16,trust:4,lifeSpend:100,msgs:[M('p',{phase:'cta1'}),C('k')],profile:{total_spend:100,trust_level:4,archetype:'Whale'}})),'PRESSURE');
T('pending unopened PPV demotes TW→PRESSURE',posture(mk({free:16,msgs:[M('p',{phase:'cta1'}),PPV(25,false),C('hmm')]})),'PRESSURE');
T('sexting FORCE_ON freezes TW→PRESSURE',posture(mk({free:16,sexting:'FORCE_ON',msgs:[M('p',{phase:'cta1'}),C('k')]})),'PRESSURE');

console.log('══ C. INVESTMENT-ZERO + PROMISE-REFUSAL + CAP OVERRIDES ══');
{ const m=[]; for(let i=0;i<20;i++){m.push(M('chat '+i)); m.push(C(i%2?'ok':'yes'));} m.push(M('p',{phase:'cta1'}));
  T('20 AI msgs, zero investment, $0 → TW backstop',posture(mk({free:3,msgs:m})),'TIMEWASTER'); }
{ const m=[]; for(let i=0;i<20;i++){m.push(M('chat '+i)); m.push(C(i%3?'haha Jammy you are funny':'tell me about your day'));}
  T('20 AI msgs WITH investment → not TW',posture(mk({free:3,msgs:m})),x=>x!=='TIMEWASTER'); }
T('2 promise asks, NO commit → TW (refusal)',posture(mk({free:2,msgs:[M('promise?',{skeleton_step:'Promise Ritual'}),C('lol why should i'),M('promise pls?',{skeleton_step:'Promise Ritual'}),C('not really my thing'),M('p',{phase:'cta1'})]})),'TIMEWASTER');
T('commit token RESETS refusal counter',posture(mk({free:2,msgs:[M('promise?',{skeleton_step:'Promise Ritual'}),C('yes i promise babe'),M('reinforce',{skeleton_step:'Promise Ritual'}),C('cant wait')]})),x=>x!=='TIMEWASTER');
T('3 pitch attempts no buy → TW (cap)',posture(mk({free:2,msgs:[M('p1',{phase:'cta1'}),C('mm'),M('p2',{phase:'cta2'}),C('mm2'),M('p3',{phase:'sell'}),C('mm3')]})),'TIMEWASTER');

console.log('══ D. CONTINUED-INTEREST GATE (v0.4.4.1) ══');
{ const s=mk({free:16,msgs:[M('p',{phase:'cta1'}),C('show me more babe')] ,cta:1}); F.recomputePosture(s);
  T('interested + asked + $0 → NOT protected',s._continuedInterestProtects,false);
  T('interested + asked + $0 → TW allowed',s._posture,'TIMEWASTER'); }
{ const s=mk({free:16,tips:10,msgs:[M('p',{phase:'cta1'}),C('show me more babe')],cta:1}); F.recomputePosture(s);
  T('interested + tipped → protected',s._continuedInterestProtects,true);
  T('interested + tipped → PRESSURE not TW',s._posture,'PRESSURE'); }
{ const s=mk({free:16,msgs:[C('show me more babe'),M('chat')]}); F.recomputePosture(s);
  T('interested + never asked → protected',s._continuedInterestProtects,true); }
T('detect: wants more',F.detectContinuedInterest(mk({msgs:[C('i want more of you')]})).reason,'wants_more');
T('detect: live heat',F.detectContinuedInterest(mk({msgs:[C('im so hard right now')]})).reason,'sexual_heat_now');
T('detect: content pull',F.detectContinuedInterest(mk({msgs:[C('what are you wearing')]})).reason,'content_pull');
T('detect: neutral → inactive',F.detectContinuedInterest(mk({msgs:[C('thanks talk later')]})).active,false);
T('detect: stale heat (3 msgs ago) → inactive',F.detectContinuedInterest(mk({msgs:[C('im so hard'),C('anyway'),C('what time is it')]})).active,false);

console.log('══ E. WALL STATE — MISS-LOCK 3-PERSUASION WINDOW (v0.4.4.3) ══');
const wall=(msgs,extra)=>F.computeWallState(mk({msgs,...extra}));
T('PPV + 1 our persuasion → NO lock',wall([PPV(30,false),C('tell me whats inside'),M('tease1')]).ppvMissedAfterChance,false);
T('PPV + 2 persuasions → NO lock',wall([PPV(30,false),C('a'),M('t1'),C('b'),M('t2')]).ppvMissedAfterChance,false);
T('PPV + 3 persuasions, still closed → LOCK',wall([PPV(30,false),C('a'),M('t1'),C('b'),M('t2'),C('c'),M('t3')]).ppvMissedAfterChance,true);
T('PPV + 3 our msgs but customer SILENT → no lock',wall([PPV(30,false),M('t1'),M('t2'),M('t3')]).ppvMissedAfterChance,false);
T('sessionHasSpend via tips only',wall([C('hi')],{tips:15}).sessionHasSpend,true);
T('lastMessageWasPurchase',wall([C('hi'),PPV(20,true)]).lastMessageWasPurchase,true);

console.log('══ F. LADDER STATE — DRIFT SIGNALS ══');
const lad=(msgs,extra)=>{const s=mk({msgs,...extra});return F.computeLadderState(s,F.computeWallState(s));};
{ const m=[]; for(let i=0;i<12;i++) m.push(i%2?C('q'+i):M('a'+i));
  T('12 msgs pre-first-PPV → drift ok (RLS fix)',lad(m).driftSignal,'ok'); }
T('unopened PPV → ppv_pending',lad([PPV(30,false),C('hm'),M('t')]).driftSignal,'ppv_pending');
{ const p=PPV(20,true); const m=[C('x'),p,C('wow'),M('react')]; p._openedAtMsgIdx=2;
  T('just-opened PPV → post_land_warmup',lad(m).driftSignal,'post_land_warmup'); }
{ const m=[PPV(30,false),C('a'),M('t1'),C('b'),M('t2'),C('c'),M('t3'),C('d'),M('x'),C('e')];
  T('post-lock drift states',lad(m).driftSignal,x=>String(x).includes('post_miss')); }
T('goodbye counter counts model msgs (sender fix)',lad([C('x'),M('bye1',{phase:'goodbye'}),M('bye2',{phase:'goodbye'})]).goodbyePhaseMsgCount,2);
{ const m=[M('p1',{phase:'cta1'}),C('n1'),M('p2',{phase:'cta2'}),C('n2'),M('p3',{phase:'sell'}),C('n3')];
  T('3 attempts → ladderClosedForSession',lad(m).ladderClosedForSession,true); }

console.log('══ G. MODE DETECTORS ══');
T('sexting gate1 blocks $0 fantasy',F.detectSextingActive(mk({msgs:[C('i want to fuck you so bad')]})),false);
T('sexting: spend + fantasy → ON',F.detectSextingActive(mk({lifeSpend:50,msgs:[C('i want to fuck you so bad')],profile:{total_spend:50}})),true);
T('sexting FORCE_OFF wins',F.detectSextingActive(mk({lifeSpend:50,sexting:'FORCE_OFF',msgs:[C('i want to fuck you')],profile:{total_spend:50}})),false);
T('sexting: "id love to taste you" — (to) optional fix (v0.4.4.5)',F.detectSextingActive(mk({spend:30,msgs:[PPV(30,true),C('id love to taste you all night')]})),true);
T('sexting: dominance fantasy "on your knees while i grab your hair" (v0.4.4.5)',F.detectSextingActive(mk({spend:30,msgs:[PPV(30,true),C('id have you on your knees while i grab your hair from behind')]})),true);
T('sexting: descriptive "i keep picturing you riding me" (v0.4.4.5)',F.detectSextingActive(mk({spend:30,msgs:[PPV(30,true),C('i keep picturing you riding me until we both finish')]})),true);
T('sexting: positional "bend you over" (v0.4.4.5)',F.detectSextingActive(mk({spend:30,msgs:[PPV(30,true),C('wanna bend you over so bad')]})),true);
T('sexting: STILL not fired on plain compliment (no false-pos)',F.detectSextingActive(mk({spend:30,msgs:[PPV(30,true),C('youre so pretty and sweet, hope your day was good')]})),false);
T('sexting: not fired on "thinking about you" alone (no false-pos)',F.detectSextingActive(mk({spend:30,msgs:[PPV(30,true),C('been thinking about you today, hope youre well')]})),false);
T('sexting Spanish (Ricardo case)',F.detectSextingActive(mk({lifeSpend:35,msgs:[C('me encantaria venirme en tus pies')],profile:{total_spend:35}})),true);
T('tipPrimary: tipped → true',F.detectTipPrimary(mk({tips:20})),true);
T('tipPrimary: spoil lang + Relationship archetype → true',F.detectTipPrimary(mk({archetype:'Relationship',msgs:[C('i love to spoil you and take care of you')],profile:{archetype:'Relationship',total_spend:0}})),true);
T('tipPrimary: spoil lang ALONE → false (needs corroboration)',F.detectTipPrimary(mk({msgs:[C('i love to spoil you and take care of you')]})),false);
T('tipPrimary FORCE_OFF wins',F.detectTipPrimary(mk({tips:20,tipMode:'FORCE_OFF'})),false);
T('fork: deflection',(F.detectFork([C('you first 😏 you tell me')],null)||{}).type,'deflection');
T('fork: love_framing',(F.detectFork([C('you are the only one i want to talk to, i think about you all day')],null)||{}).type,'love_framing');
T('fork: vending machine',(F.detectFork([C('send tits how much')],null)||{}).type,x=>String(x).includes('vending')||x===undefined);
T('fork: silence breaker (25h gap)',(F.detectFork([C('hey im back')],1500)||{}).type,'silence_breaker');
T('fork: 7h gap NOT silence breaker (24h threshold)',(F.detectFork([C('hey im back')],420)||{}).type,x=>x!=='silence_breaker');

console.log('══ H. INVESTMENT SIGNALS ══');
{ const inv=F.detectInvestmentSignals(mk({msgs:[C('how was your day Jammy'),M('good! just got home from the gym, my legs are dead'),C('haha i bet the gym looked good on you, im an engineer btw long days too')]}));
  T('investment count >= 2',inv.count,x=>x>=2); }

console.log('══ I. TOS FILTER ══');
T('benign: "nice to meet you"',F.scanForBanned('nice to meet you babe').length,0);
T('benign: "my dog Max"',F.scanForBanned('my dog Max is cute').length,0);
T('catch: meetup',F.scanForBanned('lets meet up tonight').length,x=>x>0);
T('catch: cashapp',F.scanForBanned('pay me on cashapp').length,x=>x>0);
T('catch: teen',F.scanForBanned('you look so teen').length,x=>x>0);

console.log('══ J. PROMISE COMMITMENT DETECTOR ══');
{ const s=mk({promise:'in_progress',msgs:[M('promise me?',{skeleton_step:'Promise Ritual'}),C('yes i promise')]});
  T('commit token detected',!!F.detectPromiseCommitment(s),true); }
{ const s=mk({promise:'in_progress',msgs:[M('promise me?',{skeleton_step:'Promise Ritual'}),C('hmm idk about that')]});
  T('no commit on hedge',!!F.detectPromiseCommitment(s),false); }


console.log('══ K. STRATEGY VALIDATORS (brain-output enforcement) ══');
const baseStrat=()=>({customer_sexual_level:4,customer_emotional_level:3,creator_target_sexual_level:3,creator_target_emotional_level:2,
  phase:'rapport',skeleton_step:'Chit Chat',promise_status:'not_started',wall_detected:'none',wall_subtype:'n/a',
  next_move_after_wall:'continue_climb',next_planned_move:'rapport_beat',message_length:'short'});
const V=(strat,sess,lad)=>F2.validateStrategy(strat,sess,lad||lad0(sess));
const lad0=(s)=>F.computeLadderState(s,F.computeWallState(s));
const F2={validateStrategy:sandbox.validateStrategy,clampStrategyByPosture:sandbox.clampStrategyByPosture,clampStrategyByDepthGate:sandbox.clampStrategyByDepthGate,auditAnalysisVsGroundTruth:sandbox.auditAnalysisVsGroundTruth};

T('clean strategy → 0 violations',V(baseStrat(),mk({spend:50,msgs:[C('hi')]})).length,0);
{ const st=baseStrat(); st.creator_target_sexual_level=9; st.customer_sexual_level=4;
  T('creator leads sexually → violation',V(st,mk({spend:50,msgs:[C('hi')]})).length,x=>x>0); }
{ const st=baseStrat(); st.customer_sexual_level=9; st.creator_target_sexual_level=6;
  T('pre-PPV cap: $0 spend, creator>5 → violation',V(st,mk({msgs:[C('hi')]})).length,x=>x>0); }
{ const st=baseStrat(); st.wall_detected='soft_no'; st.wall_subtype='never_spent'; st.next_move_after_wall='continue_climb';
  T('soft_no + continue_climb → violation',V(st,mk({msgs:[C('maybe later')]})).length,x=>x>0); }
{ const st=baseStrat(); st.next_move_after_wall='run_promise_ritual';
  const sess=mk({promise:'assumed',msgs:[C('hi')]});
  T('ritual on assumed status → violation',V(st,sess).length,x=>x>0); }
{ const st=baseStrat(); st.next_move_after_wall='run_promise_ritual';
  const sess=mk({promiseMode:'buildup_only',promise:'assumed',msgs:[C('hi')]});
  T('BUILDUP-ONLY: promise validators skipped → 0 violations',V(st,sess).length,0); }
{ const st=baseStrat(); st.next_move_after_wall='run_promise_reinforcement';
  const sess=mk({promise:'not_started',msgs:[C('hi')]});
  T('reinforcement before PPV1 → violation',V(st,sess).length,x=>x>0); }
{ const st=baseStrat(); st.next_move_after_wall='run_promise_ritual'; st.promise_status='not_started';
  const sess=mk({msgs:[C('hi babe')]}); // no breadcrumb_reaction signal
  T('ritual w/o breadcrumb anchor → violation (Spencer guard)',V(st,sess).length,x=>x>0); }
{ const st=baseStrat(); st.skeleton_step='CTA 1'; st.phase='cta1';
  const sess=mk({msgs:[C('you are the only one i want to talk to, i think about you all day'),M('aw')]});
  T('pitching into love_framing (pause-pitch) → violation',V(st,sess).length,x=>x>0); }
{ const st=baseStrat(); st.skeleton_step='Bogus Step';
  T('invalid skeleton_step name → violation',V(st,mk({spend:50,msgs:[C('hi')]})).length,x=>x>0); }

console.log('══ L. AUDIT WARNS (advisory layer — dead-stash fix live?) ══');
{ const sess=mk({msgs:[PPV(30,false),C('a'),M('t1'),C('b'),M('t2'),C('c'),M('t3')]}); // miss-locked now
  const warns=F2.auditAnalysisVsGroundTruth({phase:'cta1',agent_override_active:false},sess);
  T('miss-locked + cta phase → audit warn fires (v0.4.4.3 fix)',warns.some(w=>/lockout/i.test(w)),true); }
{ const sess=mk({msgs:[PPV(30,false),C('a'),M('t1'),C('b'),M('t2'),C('c'),M('t3')]});
  const warns=F2.auditAnalysisVsGroundTruth({phase:'cta1',agent_override_active:true},sess);
  T('same but agent override → warn suppressed',warns.some(w=>/lockout/i.test(w)),false); }


console.log('══ M. OCR DATE RESOLUTION (screenshot import) ══');
{ const today=new Date(); const fmt=d=>{const y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),dd=String(d.getDate()).padStart(2,'0');return y+'-'+m+'-'+dd;};
  T('hint "Today" → today',F.resolveOcrDateHint('Today'),fmt(today));
  { const y=new Date(today); y.setDate(y.getDate()-1); T('hint "Yesterday" → yesterday',F.resolveOcrDateHint('Yesterday'),fmt(y)); }
  T('hint "last friday" → a past date',F.resolveOcrDateHint('last friday'),x=>!!x && x<fmt(today));
  T('garbage hint → empty (no silent today-default)',F.resolveOcrDateHint('????'),'');
  T('combine date+PM time → ISO',F.combineDateAndTime('2026-05-04','3:45 PM'),x=>typeof x==='string' && x.includes('2026-05-04'));
  T('combine date only → noon anchor ISO',F.combineDateAndTime('2026-05-04',null),x=>typeof x==='string' && x.includes('2026-05-04'));
  T('combine bad time → null',F.combineDateAndTime('2026-05-04','whenever'),null);
  T('combine no date → null',F.combineDateAndTime('','3:45 PM'),null);
}


console.log('══ N. STORY-FRAMEWORK AGENT-OVERRIDE GATE (v0.4.4.4) ══');
{ const lad=mk({msgs:[C('hi')]}); const ls=F.computeLadderState(lad,F.computeWallState(lad));
  const base={customer_sexual_level:1,customer_emotional_level:2,creator_target_sexual_level:0,creator_target_emotional_level:1,phase:'rapport',skeleton_step:'Chit Chat',promise_status:'not_started',wall_detected:'none',wall_subtype:'n/a',next_planned_move:'rapport_beat',message_length:'short',next_move_after_wall:'run_story_framework',sell_vs_hold_read:'case_2_nice_never_spends_avoids'};
  const V=(o)=>sandbox.validateStrategy(Object.assign({},base,o),mk({msgs:[C('hi')]}),ls);
  T('story w/o case_5 + NO override → violation',V({agent_override_active:false}).some(v=>/story framework is only for case_5/.test(v)),true);
  T('story w/o case_5 + AGENT OVERRIDE → allowed',V({agent_override_active:true}).some(v=>/story framework is only for case_5/.test(v)),false);
  T('story + override but real WALL → still blocked',V({agent_override_active:true,wall_detected:'objection',wall_subtype:'price'}).some(v=>/walls take precedence/.test(v)),true);
}

console.log('══ O. WHALE BUILDER (v0.4.4.5 — Cielo new-USA-sub qualification arc) ══');
{ // Inject a marker-bearing Cielo + a plain Jammy into the sandbox's models global.
  vm.runInContext("models=[{name:'Cielo',prompt:'persona text here\\nWHALE BUILDER: ON\\nrest of persona'},{name:'Jammy',prompt:'standard persona, no marker'}];",sandbox);
  const dwb=sandbox.detectWhaleBuilder, dep=sandbox.detectEnglishPick;
  const WB=(o={})=>Object.assign(mk(o),{creator_model:o.creator||'Cielo'});
  T('no marker creator → off',dwb(WB({creator:'Jammy',msgs:[C('english please')]})).state,'off');
  T('explicit english pick → active',dwb(WB({msgs:[C('english please')]})).signal,'explicit_english_pick');
  T('spanish pick → off',dwb(WB({msgs:[C('espanol porfa')]})).state,'off');
  T('"ingles" (pick written in Spanish) → active',dwb(WB({msgs:[C('ingles jaja')]})).state,'active');
  T('implicit english reply → active',dwb(WB({msgs:[C('hey gorgeous how are you doing')]})).signal,'implicit_english_reply');
  T('spanish-language reply → off',dwb(WB({msgs:[C('hola guapa como estas')]})).state,'off');
  T('both languages named → off (unclear)',dwb(WB({msgs:[C('english or spanish idk lol')]})).state,'off');
  T('lifetime spend>0 → off (not_new_sub)',dwb(WB({lifeSpend:50,msgs:[C('english please')]})).signal,'not_new_sub');
  T('session tip pre-arc → off (not_new_sub)',dwb(WB({tips:10,msgs:[C('english please')]})).signal,'not_new_sub');
  T('tier regular → off (not_new_tier)',dwb(WB({tier:'regular',msgs:[C('english please')]})).signal,'not_new_tier');
  T('FORCE_ON skips gates (even a spender) → forced_on',dwb(Object.assign(WB({lifeSpend:500,msgs:[C('hola')]}),{_whaleModeToggle:'FORCE_ON'})).signal,'forced_on');
  T('FORCE_ON without marker → still off',dwb(Object.assign(WB({creator:'Jammy',msgs:[C('english')]}),{_whaleModeToggle:'FORCE_ON'})).state,'off');
  T('FORCE_OFF kills an otherwise-eligible arc',dwb(Object.assign(WB({msgs:[C('english please')]}),{_whaleModeToggle:'FORCE_OFF'})).state,'off');
  T('window passed (15 AI msgs) → off',dwb(WB({msgs:Array.from({length:15},(_,i)=>M('m'+i)).concat([C('english please')])})).signal,'window_passed');
  { const s=WB({msgs:[C('english please'),M('omg hi im practicing my english hihi'),C('cool how are you'),M('do you think if i asked you to send me a tip of idk 37$ so i can order takeout you would do it?')]});
    T('activation + tip-ask detected same pass → ask_made',dwb(s).signal,'ask_made');
    T('ask index recorded on the tip message',s._whaleBuilderAskAt,3);
    s.messages.push(C('done babe',{tags:{tip:true,tipAmount:37}}));
    T('tip after ask → qualified_whale',dwb(s).signal,'qualified_whale');
    T('outcome sticky → state done on recompute',dwb(s).state,'done');
    s._whaleModeToggle='FORCE_OFF';
    T('FORCE_OFF after outcome → off (toggle wins display)',dwb(s).state,'off'); }
  { const s=WB({msgs:[C('english please'),M('a tip of 37$ so i can order takeout for me and mati?')]});
    dwb(s);
    for(let i=0;i<6;i++) s.messages.push(C('but what exactly do i get for it '+i));
    T('6 customer replies after ask, no tip → not_whale',dwb(s).signal,'not_whale'); }
  { const s=WB({msgs:[C('english please'),M('there are multiple things 37 reasons i like about you')]});
    dwb(s);
    T('"multiple"+digits is NOT a tip ask (word boundary)',s._whaleBuilderAskAt==null,true); }
  T('detectEnglishPick: no replies yet → no_reply_yet',dep({messages:[]}).signal,'no_reply_yet');
  // live finding 2026-06-12: disparaged-language mentions must not count as picks
  T('"english please, my spanish is terrible" → ENGLISH pick',dwb(WB({msgs:[C('english please, my spanish is terrible lol')]})).signal,'explicit_english_pick');
  T('"no spanish pls" alone → english pick via negation',dwb(WB({msgs:[C('no spanish pls')]})).signal,'explicit_english_pick');
  T('"my english is bad, espanol porfa" → spanish pick',dwb(WB({msgs:[C('my english is bad, espanol porfa')]})).state,'off');
  T('"espanol porfa, no hablo mucho ingles" → spanish_pick label',dwb(WB({msgs:[C('espanol porfa, no hablo mucho ingles')]})).signal,'spanish_pick');
  T('tips_spend>0 mid-arc also qualifies (no tag path)',(()=>{const s=WB({msgs:[C('english please'),M('tip of 37$ for takeout?'),C('sent it')]});dwb(s);s.tips_spend=37;return dwb(s).signal;})(),'qualified_whale');
}

console.log('══ P. STRATEGY VALIDATORS — FULL RULE SWEEP (v0.4.4.5 Phase 1A) ══');
{ ['customer_sexual_level','customer_emotional_level','creator_target_sexual_level','creator_target_emotional_level'].forEach(f=>{
    const st=baseStrat(); delete st[f];
    T('missing '+f+' → schema violation',V(st,mk({spend:50,msgs:[C('hi')]})).some(v=>v.includes(f)&&/missing/.test(v)),true);
  }); }
{ const st=baseStrat(); st.customer_sexual_level=8; st.creator_target_sexual_level=4;
  T('sexual floor: ts >2 below cs (paid) → violation',V(st,mk({spend:50,msgs:[C('hi')]})).some(v=>/more than 2 below customer_sexual/.test(v)),true); }
{ const st=baseStrat(); st.customer_sexual_level=8; st.creator_target_sexual_level=4; st.frame_hold_active=true;
  T('sexual floor: frame-hold exemption → clean',V(st,mk({spend:50,msgs:[C('hi')]})).some(v=>/more than 2 below customer_sexual/.test(v)),false); }
{ const st=baseStrat(); st.customer_sexual_level=8; st.creator_target_sexual_level=5;
  T('sexual floor yields to pre-PPV cap ($0, ts=5, cs=8) → clean',V(st,mk({msgs:[C('hi')]})).length,0); }
{ const st=baseStrat(); st.customer_sexual_level=8; st.creator_target_sexual_level=4;
  T('below BOTH cs-2 AND pre-PPV cap ($0, ts=4) → violation',V(st,mk({msgs:[C('hi')]})).some(v=>/more than 2 below customer_sexual/.test(v)),true); }
{ const st=baseStrat(); st.customer_sexual_level=0; st.creator_target_sexual_level=2;
  T('manufactured sexuality (cs=0, ts=2) → violation',V(st,mk({spend:50,msgs:[C('hi')]})).some(v=>/do not manufacture/.test(v)),true); }
{ const st=baseStrat(); st.customer_emotional_level=2; st.creator_target_emotional_level=4;
  T('te above ce → violation',V(st,mk({spend:50,msgs:[C('hi')]})).some(v=>/is above customer_emotional_level/.test(v)),true); }
{ const st=baseStrat(); st.customer_sexual_level=5; st.creator_target_sexual_level=1; st.customer_emotional_level=0; st.creator_target_emotional_level=2; st.frame_hold_active=true;
  T('frame-hold: te<=2 over ce=0 + under-matched heat → clean',V(st,mk({msgs:[C('hi')]})).length,0); }
{ const st=baseStrat(); st.customer_emotional_level=0; st.creator_target_emotional_level=3; st.frame_hold_active=true;
  T('frame-hold latitude capped: te=3 over ce=0 → violation',V(st,mk({spend:50,msgs:[C('hi')]})).some(v=>/customer_emotional_level is 0 but/.test(v)),true); }
{ const st=baseStrat(); st.customer_emotional_level=8; st.creator_target_emotional_level=4;
  T('emo floor: te >2 below ce (ungated) → violation',V(st,mk({spend:50,msgs:[C('hi')]})).some(v=>/more than 2 below customer_emotional/.test(v)),true); }
{ const st=baseStrat(); st.customer_emotional_level=8; st.creator_target_emotional_level=4; st._depthGated=true;
  T('emo floor yields to depth gate (te=4, gated) → clean of floor',V(st,mk({spend:50,msgs:[C('hi')]})).some(v=>/more than 2 below customer_emotional/.test(v)),false); }
{ const st=baseStrat(); st.power_position_check='weakens — chasing him now';
  T('power_position weakens → violation',V(st,mk({spend:50,msgs:[C('hi')]})).some(v=>/power_position_check/.test(v)),true); }
{ const st=baseStrat(); st.wall_detected='hard_no';
  T('invalid wall_detected enum → violation',V(st,mk({spend:50,msgs:[C('hi')]})).some(v=>/wall_detected "hard_no" is not valid/.test(v)),true); }
{ const st=baseStrat(); st.next_move_after_wall='run_discount';
  T('invalid next_move enum → violation',V(st,mk({spend:50,msgs:[C('hi')]})).some(v=>/next_move_after_wall "run_discount" is not valid/.test(v)),true); }
{ const st=baseStrat(); st.wall_detected='objection'; st.wall_subtype='price'; st.next_move_after_wall='continue_climb';
  T('objection + continue_climb → violation',V(st,mk({spend:50,msgs:[C('too expensive')]})).some(v=>/wall_detected is objection but/.test(v)),true); }
{ const st=baseStrat(); st.wall_detected='objection'; st.wall_subtype='price'; st.next_move_after_wall='run_objection_solve';
  T('objection + run_objection_solve → allowed',V(st,mk({spend:50,msgs:[C('too expensive')]})).some(v=>/wall_detected is objection but/.test(v)),false); }
{ const st=baseStrat(); st.wall_detected='objection'; st.wall_subtype='price'; st.next_move_after_wall='manager_flag';
  T('objection + manager_flag → allowed',V(st,mk({spend:50,msgs:[C('too expensive')]})).some(v=>/wall_detected is objection but/.test(v)),false); }
{ const st=baseStrat(); st.wall_detected='ppv_missed'; st.next_move_after_wall='continue_climb';
  T('ppv_missed + continue_climb → violation',V(st,mk({spend:50,msgs:[C('hi')]})).some(v=>/wall_detected is ppv_missed but/.test(v)),true); }
{ const st=baseStrat(); st.wall_detected='ppv_missed'; st.next_move_after_wall='exclusive_custom_framing';
  T('ppv_missed + exclusive_custom → allowed',V(st,mk({spend:50,msgs:[C('hi')]})).some(v=>/wall_detected is ppv_missed but/.test(v)),false); }
{ const st=baseStrat(); st.next_move_after_wall='run_promise_ritual'; st.wall_detected='objection'; st.wall_subtype='price';
  T('ritual + active wall → walls-take-precedence violation',V(st,mk({promise:'in_progress',msgs:[C('hi')]})).some(v=>/run_promise_ritual but wall_detected/.test(v)),true); }
{ const st=baseStrat(); st.next_move_after_wall='run_promise_reinforcement'; st.wall_detected='objection'; st.wall_subtype='price';
  T('reinforcement + active wall → walls-take-precedence violation',V(st,mk({promise:'reinforcement',msgs:[C('hi')]})).some(v=>/run_promise_reinforcement but wall_detected/.test(v)),true); }
{ const st=baseStrat(); st.skeleton_step='CTA 1'; st.phase='cta1'; st.customer_sexual_level=6; st.creator_target_sexual_level=4;
  const lad={pausePitching:false,whaleSignal:{doctrine:'BUILD_A_WHALE',reason:'test'},recentFirstPpv:false};
  T('BUILD_A_WHALE + pitch at ts>=4 → violation',V(st,mk({spend:50,msgs:[C('hi')]}),lad).some(v=>/whale-candidate/.test(v)),true); }
{ const st=baseStrat(); st.skeleton_step='CTA 1'; st.phase='cta1'; st.customer_sexual_level=5; st.creator_target_sexual_level=3;
  const lad={whaleSignal:{doctrine:'BUILD_A_WHALE',reason:'test'}};
  T('BUILD_A_WHALE + gentle pitch ts=3 → allowed',V(st,mk({spend:50,msgs:[C('hi')]}),lad).some(v=>/whale-candidate/.test(v)),false); }
{ const st=baseStrat(); st.customer_emotional_level=7; st.creator_target_emotional_level=3; st.customer_sexual_level=4; st.creator_target_sexual_level=3;
  const lad={recentFirstPpv:true};
  T('Percival window + te below ce-2 → violation',V(st,mk({spend:30,msgs:[C('hi')]}),lad).some(v=>/Percival window/.test(v)),true); }
{ const st=baseStrat(); st.customer_emotional_level=7; st.creator_target_emotional_level=6;
  const lad={recentFirstPpv:true};
  T('Percival window + matched depth → allowed',V(st,mk({spend:30,msgs:[C('hi')]}),lad).some(v=>/Percival window/.test(v)),false); }
{ const st=baseStrat(); st.next_planned_move='hold frame, do NOT pitch — deflect with warmth'; st.message_purpose='not pitching, holding the frame';
  const lad={pausePitching:true,pauseReason:'love_framing'};
  T('pause-pitch + negation free text + Chit Chat → NO false positive (v0.4.4.4 regression)',V(st,mk({spend:50,msgs:[C('hi')]}),lad).some(v=>/pause-pitching mode is ON/.test(v)),false); }
{ const st=baseStrat(); st.skeleton_step='Send Content'; st.phase='send_content';
  const lad={pausePitching:true,pauseReason:'love_framing'};
  T('pause-pitch + Send Content skeleton → violation',V(st,mk({spend:50,msgs:[C('hi')]}),lad).some(v=>/pause-pitching mode is ON/.test(v)),true); }

console.log('══ Q. CLAMPS (posture / depth gate / register match) ══');
{ const st=baseStrat(); st.creator_target_sexual_level=6; st.creator_target_emotional_level=5;
  F2.clampStrategyByPosture(st,'TIMEWASTER');
  T('TW clamp caps sex at 2',st.creator_target_sexual_level,2);
  T('TW clamp caps emo at 2',st.creator_target_emotional_level,2);
  T('TW clamp records _clampedBy',!!st._clampedBy,true); }
{ const st=baseStrat(); st.creator_target_sexual_level=6;
  F2.clampStrategyByPosture(st,'PRESSURE');
  T('PRESSURE: no cap + note set',st.creator_target_sexual_level===6&&!!st._postureNote,true); }
{ const st=baseStrat(); st.creator_target_sexual_level=6;
  F2.clampStrategyByPosture(st,'WARM_BUILD');
  T('WARM_BUILD: untouched',st.creator_target_sexual_level===6&&!st._postureNote&&!st._clampedBy,true); }
{ const st=baseStrat(); st.creator_target_emotional_level=8;
  F2.clampStrategyByDepthGate(st,3,null);
  T('depth gate trust<4 caps emo at 4',st.creator_target_emotional_level,4);
  T('depth gate sets _depthGated',st._depthGated,true); }
{ const st=baseStrat(); st.creator_target_emotional_level=8;
  F2.clampStrategyByDepthGate(st,3,{recentFirstPpv:true});
  T('Percival bypass: emo NOT capped',st.creator_target_emotional_level,8);
  T('Percival bypass flag set',st._depthGateBypass,'recent_first_ppv'); }
{ const st=baseStrat(); st.creator_target_emotional_level=8;
  F2.clampStrategyByDepthGate(st,4,null);
  T('depth gate trust>=4: no cap',st.creator_target_emotional_level,8); }
{ const cr=sandbox.clampStrategyByRegisterMatch;
  { const st=baseStrat(); st.customer_sexual_level=8; st.creator_target_sexual_level=1;
    cr(st,'TIMEWASTER',mk({}));
    T('register match skipped in TW',st.creator_target_sexual_level,1); }
  { const st=baseStrat(); st.customer_sexual_level=9; st.creator_target_sexual_level=8;
    cr(st,'WARM_BUILD',mk({}));
    T('$0: creator_sex lowered to pre-PPV ceiling 5',st.creator_target_sexual_level,5); }
  { const st=baseStrat(); st.customer_sexual_level=9; st.creator_target_sexual_level=8;
    cr(st,'WARM_BUILD',mk({spend:100}));
    T('paid: ts=8 within floor → unchanged',st.creator_target_sexual_level,8); }
  { const st=baseStrat(); st.customer_sexual_level=8; st.creator_target_sexual_level=3;
    cr(st,'WARM_BUILD',mk({spend:100}));
    T('paid floor lift: ts 3 → 6 (cs-2)',st.creator_target_sexual_level,6); }
  { const st=baseStrat(); st.customer_sexual_level=9; st.creator_target_sexual_level=2;
    cr(st,'WARM_BUILD',mk({}));
    T('$0 floor lift capped at ceiling: ts 2 → 5',st.creator_target_sexual_level,5); }
  { const st=baseStrat(); st.customer_emotional_level=7; st.creator_target_emotional_level=3;
    cr(st,'WARM_BUILD',mk({spend:100}));
    T('emo floor lift: te 3 → 5',st.creator_target_emotional_level,5); }
  { const st=baseStrat(); st.customer_emotional_level=7; st.creator_target_emotional_level=3; st._depthGated=true;
    cr(st,'WARM_BUILD',mk({spend:100}));
    T('depth-gated: emo floor lift SKIPPED',st.creator_target_emotional_level,3); }
}

console.log('══ R. POSTURE/TIER/WALL/LADDER — FULL BRANCH SWEEP (Phase 1A) ══');
T('tier: is_timewaster → flagged_tw',F.computeCustomerTier(mk(),{is_timewaster:true}),'flagged_tw');
T('tier: lifetime tips only → old (effective spend)',F.computeCustomerTier(mk(),{total_spend:0,tips_spend:25}),'old');
T('tier: trust>=2 → old',F.computeCustomerTier(mk(),{total_spend:0,trust_level:2}),'old');
T('tier: prior sessions → old',F.computeCustomerTier(mk(),{prior_session_count:3}),'old');
T('tier: fresh $0 → new',F.computeCustomerTier(mk(),{total_spend:0,trust_level:1}),'new');
T('old tier: free5 → PROBE',posture(mk({free:5,trust:2,msgs:[C('hey Jammy'),M('hi')]})),'PROBE');
T('old tier: free8 → PRESSURE',posture(mk({free:8,trust:2,msgs:[C('hey Jammy'),M('hi')]})),'PRESSURE');
T('old tier: free12+CTA → TIMEWASTER',posture(mk({free:12,trust:2,msgs:[M('p',{phase:'cta1'}),C('k')]})),'TIMEWASTER');
T('flagged tier: free5+CTA → TIMEWASTER',posture(mk({free:5,profile:{is_timewaster:true,total_spend:0,trust_level:1},msgs:[M('p',{phase:'cta1'}),C('k')]})),'TIMEWASTER');
T('unpaid=1 bumps WARM→PROBE',posture(mk({free:0,cta:1,msgs:[M('p',{phase:'cta1'}),C('k')]})),'PROBE');
T('unpaid=2 → PRESSURE',posture(mk({free:0,cta:2,msgs:[M('p',{phase:'cta1'}),C('k')]})),'PRESSURE');
T('unpaid=3 + CTA attempted → TIMEWASTER',posture(mk({free:0,cta:3,msgs:[M('p',{phase:'cta1'}),C('k')]})),'TIMEWASTER');
T('whale override needs trust≥4: trust3 $300 stays TW',posture(mk({free:16,profile:{total_spend:300,trust_level:3},msgs:[M('p',{phase:'cta1'}),C('k')]})),'TIMEWASTER');
{ const s=mk({msgs:[PPV(20,false),C('nah'),M('p1'),M('p2'),M('p3')]}); s._sessionClosedAtMsgCount=5;
  T('session boundary: pre-close miss invisible after close',F.computeWallState(s).ppvSentCount,0); }
{ const ws=F.computeWallState(mk({msgs:[PPV(20,true),PPV(30,false),C('hmm')]}));
  T('wall counts: sent2 missed1 purchased1',ws.ppvSentCount===2&&ws.ppvMissedCount===1&&ws.sessionPurchaseCount===1,true);
  T('sessionHasSpend via opened PPV',ws.sessionHasSpend,true); }
T('sellHoldHint lifetime spender',F.computeWallState(mk({lifeSpend:50,msgs:[C('hi')]})).sellHoldHint,'has_spent_lifetime');
T('sellHoldHint never spent',F.computeWallState(mk({msgs:[C('hi')]})).sellHoldHint,'never_spent');
const LS=(s)=>F.computeLadderState(s,F.computeWallState(s));
T('tier band T1 (<$10)',LS(mk({msgs:[PPV(8,true)]})).lastPitchTier,'T1');
T('tier band T2 (<$18)',LS(mk({msgs:[PPV(15,true)]})).lastPitchTier,'T2');
T('tier band T3 (<$35)',LS(mk({msgs:[PPV(25,true)]})).lastPitchTier,'T3');
T('tier band T4 (<$60)',LS(mk({msgs:[PPV(50,true)]})).lastPitchTier,'T4');
T('tier band T5 (≥$60)',LS(mk({msgs:[PPV(80,true)]})).lastPitchTier,'T5');
T('drift at 5 beats post-open',LS(mk({msgs:[PPV(20,true),M('a'),C('b'),M('c'),C('d'),M('e')]})).driftSignal,'drift');
T('severe_drift at 7 beats',LS(mk({msgs:[PPV(20,true),M('a'),C('b'),M('c'),C('d'),M('e'),C('f'),M('g')]})).driftSignal,'severe_drift');
T('Josh fix: warmup measured from PAYMENT not send',LS(mk({msgs:[PPV(20,true,{_openedAtMsgIdx:4}),M('a'),C('b'),M('c'),C('d'),M('e'),C('f')]})).driftSignal,'post_land_warmup');
T('post-miss immediate → drift_post_miss',LS(mk({msgs:[PPV(25,false),C('k'),M('p1'),M('p2'),M('p3')]})).driftSignal,'drift_post_miss');
T('post-miss ≥5 wasted msgs → severe_drift_post_miss',LS(mk({msgs:[PPV(25,false),C('k'),M('p1'),M('p2'),M('p3'),C('x'),M('y')]})).driftSignal,'severe_drift_post_miss');
T('recentFirstPpv true (1 landed within 4)',LS(mk({msgs:[PPV(20,true),M('a'),C('b')]})).recentFirstPpv,true);
T('recentFirstPpv false at 2 PPVs',LS(mk({msgs:[PPV(20,true),PPV(30,true),M('a')]})).recentFirstPpv,false);
{ const love=()=>[C('i think im falling for you, youre the only one i talk to')];
  T('whale candidate at $0',LS(mk({msgs:love()})).whaleSignal&&LS(mk({msgs:love()})).whaleSignal.level,'whale_candidate');
  T('whale developing at $20',LS(mk({lifeSpend:20,msgs:love()})).whaleSignal&&LS(mk({lifeSpend:20,msgs:love()})).whaleSignal.level,'whale_developing');
  T('PROTECT_WHALE at $250',LS(mk({lifeSpend:250,msgs:love()})).whaleSignal&&LS(mk({lifeSpend:250,msgs:love()})).whaleSignal.doctrine,'PROTECT_WHALE');
  T('mid-band $100: no whale signal, pause still on',(()=>{const l=LS(mk({lifeSpend:100,msgs:love()}));return l.whaleSignal===null&&l.pausePitching===true;})(),true); }
T('vending fork → pausePitching frame-hold',(()=>{const l=LS(mk({msgs:[M('hi'),M('hey'),C('show me your tits, how much')]}));return l.fork&&l.fork.type==='vending_machine_attempt'&&l.pausePitching;})(),true);
T('vulnerability fork → pausePitching support-first',(()=>{const l=LS(mk({msgs:[M('hi'),C('i feel empty lately, like nothing matters')]}));return l.fork&&l.fork.type==='vulnerability_signal'&&l.pausePitching;})(),true);
{ const s=mk({msgs:[PPV(10,false),M('p',{phase:'cta1'}),M('q',{phase:'cta2'}),PPV(15,true),M('r')]});
  T('rung resets after opened PPV',LS(s).pitchAttemptsOnCurrentRung,0);
  T('ladder reopens after buy',LS(s).ladderClosedForSession,false); }
{ const gb=(n)=>{const arr=[C('hi')];for(let i=0;i<n;i++)arr.push(M('bye'+i,{phase:'goodbye'}));return mk({msgs:arr});};
  T('goodbye cap NOT hit at 3',LS(gb(3)).goodbyeCapHit,false);
  T('goodbye cap hit at 4',LS(gb(4)).goodbyeCapHit,true); }

console.log('══ S. FORKS + DETECTORS — EDGE SWEEP (Phase 1A) ══');
const DF=(msgs,gap)=>F.detectFork(msgs,gap===undefined?null:gap);
T('fork: sexual_urgency strong token',(DF([C('im hard right now babe')])||{}).type,'sexual_urgency');
T('fork: sexual_urgency medium cluster',(DF([C('you turn me on so much, i want you')])||{}).type,'sexual_urgency');
T('fork: love beats heat (precedence)',(DF([C('im hard but honestly youre the only one i think about')])||{}).type,'love_framing');
T('fork: vending pre-empts heat at zero investment',(DF([M('a'),M('b'),C('show me your tits im hard')])||{}).type,'vending_machine_attempt');
T('fork: vulnerability strong',(DF([C('i feel empty and alone these days')])||{}).type,'vulnerability_signal');
T('fork: vulnerability soft cluster',(DF([C('been so depressed and i cant sleep at night')])||{}).type,'vulnerability_signal');
T('fork: single soft vuln token → null',DF([C('been kinda depressed today')]),null);
T('fork: benign → null',DF([C('thanks babe that was sweet')]),null);
T('fork: short ?-reply after creator ? → deflection',(DF([M('what do you do for work?'),C('why u ask?')])||{}).type,'deflection');
T('sexting: [image sent] satisfies gate 2',F.detectSextingActive(mk({profile:{total_spend:40,trust_level:1},msgs:[C('[image sent]')]})),true);
{ const inv=(msgs)=>F.detectInvestmentSignals(mk({msgs}));
  T('signal: personal_question',inv([C('how are you today')]).signals.some(x=>x.type==='personal_question'),true);
  T('signal: used_her_name',inv([C('jammy you are wild')]).signals.some(x=>x.type==='used_her_name'),true);
  T('signal: self_disclosure',inv([C('i just got home from my shift at the warehouse')]).signals.some(x=>x.type==='self_disclosure'),true);
  T('signal: compliment_beyond_body',inv([C('you have such a chill vibe')]).signals.some(x=>x.type==='compliment_beyond_body'),true);
  T('signal: breadcrumb_reaction',(()=>{const s=mk({msgs:[M('just got back from yoga class feeling flexible'),C('flexible from yoga huh thats hot')]});return F.detectInvestmentSignals(s).signals.some(x=>x.type==='breadcrumb_reaction');})(),true);
  T('signal dedup: same type twice counts once',inv([C('how are you'),C('how is your day')]).count,1); }
T('tipPrimary: provider lang + PPV-resistance (no archetype) → true',F.detectTipPrimary(mk({msgs:[C('i dont like paying for ppv tbh, id rather just spoil you directly')]})),true);
{ const s=mk({lifeSpend:80,msgs:[C('hey im back')]});
  F.recomputePosture(s);
  T('returning spender: promise auto-inits to reinforcement',s._promiseStatus,'reinforcement');
  s._promiseStatus='not_started'; F.recomputePosture(s);
  T('one-shot init: deliberate reframe not bounced back',s._promiseStatus,'not_started'); }
{ const s=mk({lifeSpend:80,msgs:[PPV(20,false),C('hmm')]});
  F.recomputePosture(s);
  T('no promise init when PPV already sent this session',s._promiseStatus,'not_started'); }

console.log('══ T. TOS / REGISTER — FULL LIST SWEEP (Phase 1A) ══');
{ const words=vm.runInContext('BANNED_WORDS',sandbox);
  const misses=words.filter(w=>F.scanForBanned('we were talking about '+w+' yesterday').length===0);
  T('every BANNED_WORD fires in-sentence ('+words.length+' words)',misses.join(','),''); }
{ const fires=['we should meet','meet up tomorrow','meet you tonight','lets have public fun','public bathroom fun','publicly naked outside','fucking your dog','dog cock pics','without consent at all','she didnt consent','sex with an animal','animal cum video','he passed out cold','knocked up by you','shes eleven years old','blood play tonight','menstrual blood stuff','forced her to strip','toilet play vid','torture fantasy roleplay','piss on me babe','golden shower content','poop play content'];
  const misses=fires.filter(t=>F.scanForBanned(t).length===0);
  T('every BANNED_PATTERN family fires ('+fires.length+' probes)',misses.join(','),''); }
{ const benigns=['i passed the exam today','knock on the door twice','consent is important to me','bloody hell that was wild','im eleven minutes away','my favorite animal is a cat','publicly available info'];
  const fps=benigns.filter(t=>F.scanForBanned(t).length>0);
  T('benign contexts pass (no false positives)',fps.join(','),''); }
{ const phrases=vm.runInContext('REGISTER_BAD_PHRASES',sandbox);
  const misses=phrases.filter(p=>sandbox.registerFilterCheck('babe '+p+' okay').length===0);
  T('every REGISTER_BAD_PHRASE fires ('+phrases.length+' phrases)',misses.join(','),''); }
{ // v0.4.4.5 live finding: ToS auto-retry referenced out-of-scope `useMistral` —
  // ReferenceError on the path's first-ever live firing. Textual regression guard:
  // the ToS block must read the session-stashed route, never the lexical variable.
  const appSrc=fs.readFileSync(`${ROOT}/js/app.js`,'utf8');
  T('ToS retry uses session-stashed route (scope-bug regression)',appSrc.includes('_lastRouteUsedMistral&&localStorage'),true);
  T('route is stashed at decision site',appSrc.includes('_lastRouteUsedMistral=useMistral'),true); }

console.log('══ U. ANTI-SLOP SANITIZER (v0.4.4.5 — deterministic backstop) ══');
{ const ss=F.sanitizeSlop;
  T('spaced em-dash → "..."',ss("i'm jammy — what should i call you?"),"i'm jammy... what should i call you?");
  T('tight em-dash → "..."',ss('hey—you there?'),'hey... you there?');
  T('en-dash also caught',ss('wait – really?'),'wait... really?');
  T('no doubled ellipsis when model already used ...',ss('hmm — ... yeah'),'hmm... yeah');
  T('semicolon → comma',ss('i was thinking; you free tonight?'),'i was thinking, you free tonight?');
  T('clean text untouched',ss('hey babe how are you 😏'),'hey babe how are you 😏');
  T('no space-before-punct artifact',ss('really — ?'),'really...?');
  T('empty stays empty',ss(''),'');
  T('real ellipsis … → "..." (v0.4.4.5 audit)',ss('late night hits different… you know'),'late night hits different... you know');
  T('multiple em-dashes all replaced',(ss('a — b — c').match(/—/g)||[]).length,0); }

console.log('══ V. EMOJI NO-REPEAT BACKSTOP (v0.4.4.5 — live audit fix) ══');
{ const de=F.dedupeEmoji;
  T('strips emoji repeated from last 2 msgs (Camila 😏 case)',de("haha well i'll take that 😏 so whats up",["you started like that 😏 whats your name?","thats sweet 😌"]),"haha well i'll take that so whats up");
  T('keeps a fresh emoji not in last 2',de("aw youre sweet 🥰",["hey 😏","hi 😌"]),"aw youre sweet 🥰");
  T('strips only the repeated one, keeps fresh',de("omg 😏 stop it 🥹",["hey 😏","hi 😌"]),"omg stop it 🥹");
  T('no recent msgs → unchanged',de("hey babe 😏",[]),"hey babe 😏");
  T('only looks back 2 msgs (😏 3 ago is allowed)',de("hi 😏",["a 😏","b 😌","c 🥰"]),"hi 😏");
  T('no space-before-punct artifact after strip',de("really 😏?",["hm 😏"]),"really?");
  T('empty stays empty',de("",["😏"]),""); }

console.log('══ W. ONLYFANS INTEGRATION ══');
T('htmlStrip removes <p>',F.ofHtmlStripToText('<p>hello babe</p>'),'hello babe');
T('htmlStrip decodes entities',F.ofHtmlStripToText('<p>you &amp; me &lt;3</p>'),'you & me <3');
T('htmlStrip neutralizes script',F.ofHtmlStripToText('<script>alert(1)</script>hi'),'alert(1)hi');
T('htmlStrip collapses whitespace',F.ofHtmlStripToText('<p>a</p>\n  <p>b</p>'),'a b');
T('htmlStrip empty',F.ofHtmlStripToText(''),'');
T('normalize maps fields',F.ofNormalizeMessage({id:'of_99',text:'<p>hey</p>',createdAt:'2025-05-16T00:27:25+00:00'},'customer'),
  x=>x.sender==='customer'&&x.text==='hey'&&x.of_message_id==='of_99'&&x.ts_iso==='2025-05-16T00:27:25+00:00');
T('resolveCreator finds match',F.ofResolveCreator([{name:'Cielo',of_account_id:'acct_A'},{name:'Jammy',of_account_id:'acct_B'}],'acct_B'),'Jammy');
T('resolveCreator unmapped → null',F.ofResolveCreator([{name:'Cielo',of_account_id:'acct_A'}],'acct_ZZZ'),null);
T('resolveCreator ignores null of_account_id',F.ofResolveCreator([{name:'X',of_account_id:null}],'acct_A'),null);
T('sessionKey shape',F.ofSessionKey('Cielo',12345),x=>x.creator_model==='Cielo'&&x.of_chat_id==='12345');
T('buildSendBody text only',F.ofBuildSendBody('hi there'),x=>x.text==='hi there'&&x.price===undefined);
T('shouldAutoSend happy path',F.ofShouldAutoSend({of_chat_id:'123',_draftIsPpv:false},{of_account_id:'acct_A'}),true);
T('shouldAutoSend no of_chat_id → false',F.ofShouldAutoSend({of_chat_id:null,_draftIsPpv:false},{of_account_id:'acct_A'}),false);
T('shouldAutoSend creator not connected → false',F.ofShouldAutoSend({of_chat_id:'123',_draftIsPpv:false},{of_account_id:null}),false);
T('shouldAutoSend PPV draft → false',F.ofShouldAutoSend({of_chat_id:'123',_draftIsPpv:true},{of_account_id:'acct_A'}),false);
T('authz manager → true',F.ofIsAuthorized({role:'manager'},'Cielo'),true);
T('authz assigned chatter → true',F.ofIsAuthorized({role:'chatter',assignments:['Cielo','Jammy']},'Cielo'),true);
T('authz unassigned chatter → false',F.ofIsAuthorized({role:'chatter',assignments:['Jammy']},'Cielo'),false);
T('authz null chatter → false',F.ofIsAuthorized(null,'Cielo'),false);
T('nextCursor null pagination → null',F.ofNextCursor(null),null);
T('nextCursor no next_page → null',F.ofNextCursor({next_page:null}),null);
T('nextCursor url offset → {offset}',F.ofNextCursor({next_page:'https://x/api/acct/chats?limit=10&offset=20'}),x=>x&&x.offset==='20'&&x.limit==='10');
T('nextCursor url cursor id → {id}',F.ofNextCursor({next_page:'/api/acct/chats?id=998877'}),x=>x&&x.id==='998877');
T('nextCursor url no query → null',F.ofNextCursor({next_page:'https://x/api/acct/chats'}),null);
T('nextCursor object form → params',F.ofNextCursor({next_page:{offset:40}}),x=>x&&x.offset==='40');
T('needsLoad stub (of_chat_id, no messages_input) → true',F.ofNeedsLoad({of_chat_id:'123'}),true);
T('needsLoad loaded ([] blob) → false',F.ofNeedsLoad({of_chat_id:'123',messages_input:'[]'}),false);
T('needsLoad loaded (real blob) → false',F.ofNeedsLoad({of_chat_id:'123',messages_input:'[{}]'}),false);
T('needsLoad no of_chat_id → false',F.ofNeedsLoad({messages_input:null}),false);
T('needsLoad null session → false',F.ofNeedsLoad(null),false);

console.log('\n════════ RESULT ════════');
console.log(`PASS ${pass} / FAIL ${fail} (${pass+fail} assertions)`);
if(fails.length){ console.log('\nFAILURES:'); fails.forEach(f=>console.log(f)); }
