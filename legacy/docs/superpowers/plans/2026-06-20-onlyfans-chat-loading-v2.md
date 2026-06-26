# OnlyFans Chat Loading v2 (scale-aware) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the eager all-chats-all-messages "Load chats" with a paginated, lazy-loading flow: load a page of chat stubs at a time, pull a chat's messages only when it's opened, with batched DB writes and 429 backoff.

**Architecture:** Browser-side (small scale). The sidebar group header gets "Load chats" (page 1) + "Load more" (next page). `ofListChatsPage` pulls one page; `ofCreateSessionRows` batch-creates stub sessions (no messages); opening a stub fires `ofEnsureChatLoaded` → `ofLoadChatMessages` (one paginated pull + one batch upsert). The proxy gains allowlisted pagination params; `_ofProxy` gains 429 backoff. The old `ofSyncCreator` is removed.

**Tech Stack:** Vanilla browser JS (no build, global scope, `<script>` load order), Supabase (Postgres + RLS + Deno Edge Functions), Node `tests/harness.js` (VM sandbox) for deterministic tests, OnlyFansAPI REST.

## Global Constraints

- No build step / bundler. Browser code is global-scope in `js/onlyfans.js` (pure helpers + network) and `js/app.js` (UI). New pure helpers MUST be added to the `tests/harness.js` load happens automatically (onlyfans.js is already in the load list), listed in its `need[]` array, and tested with `T(name, got, want)`.
- The deterministic test bed is `node tests/harness.js`; it must end `PASS n / FAIL 0`. Network/DB/DOM code is NOT harness-testable (fetch is stubbed to reject) — verify those live.
- Browser → proxy contract is fixed: POST with header `x-ssai-token: <getProxyToken()>` and a JSON body (mirror `js/api.js`). Real keys never touch the browser.
- The proxy stays a STRICT allowlist: only ops `list_chats` / `list_messages` / `send`; rejects `price > 0` and unknown `account_id`; keeps CORS + the `OPTIONS` preflight. Pagination adds ONLY the allowlisted query keys `limit`, `offset`, `id`, `order` — never fetch a raw `next_page` URL.
- **No DB migration.** v2 relies on prerequisites already applied: `aich_messages` has `sender`, `text`, `of_message_id`, `send_state`; `of_message_id` has a **non-partial** unique index (required for `ON CONFLICT` upserts); `aich_sessions.of_chat_id`, `aich_models.of_account_id` exist.
- Message sender side = `fromUser.id === fanId ? 'customer' : 'model'`; chat fan fields live under `chat.fan.{id,name,username}`.
- Display source of truth is `aich_sessions.messages_input` (JSON blob); `aich_messages` is the dedup ledger. Stubs are created with `messages_input` left **null**; "loaded" means `messages_input` is non-null (even `'[]'`).
- Edge Function + live steps (deploy, browser testing) cannot run in this environment — write the code and deploy/verify out of band.
- After any change to `js/onlyfans.js` / `js/app.js` / `tests/harness.js`, run `node tests/harness.js` and confirm `FAIL 0`.

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `js/onlyfans.js` | Modify | Pure helpers (`ofNextCursor`, `ofNeedsLoad`); `_ofProxy` 429 backoff; `ofPull` params; `ofListChatsPage`; `ofCreateSessionRows`; `ofLoadChatMessages`; remove `ofSyncCreator`. |
| `supabase/functions/onlyfans-proxy/index.ts` | Modify | Append allowlisted pagination params on list ops. |
| `js/app.js` | Modify | Rewrite `onOfLoadGroup`; add `onOfLoadMore` + `_ofLoadChatsPage` + cursor state; sidebar "Load more" button; `loadSessions` `_ofNeedsLoad` hydration; `openSession` lazy hook; `ofEnsureChatLoaded`; `renderBubbles` loading placeholder. |
| `tests/harness.js` | Modify | `need[]` += `ofNextCursor`, `ofNeedsLoad`; new assertions in section W. |
| `docs/superpowers/runbooks/onlyfans-integration-deploy.md` | Modify | Note the proxy redeploy for pagination. |

---

### Task 1: Pure helpers `ofNextCursor` + `ofNeedsLoad` (TDD)

**Files:**
- Modify: `js/onlyfans.js`
- Modify: `tests/harness.js` (need array + section W)

**Interfaces:**
- Produces:
  - `ofNextCursor(pagination: object|null) -> object|null` — extracts allowlisted next-page params (`limit/offset/id/order`) from a `_pagination` block; `null` when there's no next page.
  - `ofNeedsLoad(session: object) -> boolean` — true when a session is an unloaded OF stub (`of_chat_id` set AND `messages_input` falsy).

- [ ] **Step 1: Write the failing tests** — append to the existing `══ W. ONLYFANS INTEGRATION ══` section in `tests/harness.js`:

```javascript
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
```

- [ ] **Step 2: Add the names to `need[]`** in `tests/harness.js` (append to the array, preserving existing entries):
```javascript
 ...,'ofShouldAutoSend','ofIsAuthorized','ofNextCursor','ofNeedsLoad'];
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node tests/harness.js 2>&1 | tail -25`
Expected: section W FAILs + `MISSING: ofNextCursor, ofNeedsLoad`.

- [ ] **Step 4: Implement** — append to `js/onlyfans.js`:

```javascript
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node tests/harness.js 2>&1 | tail -5`
Expected: `FAIL 0`.

- [ ] **Step 6: Commit**

```bash
git add js/onlyfans.js tests/harness.js
git commit -m "feat(of): ofNextCursor + ofNeedsLoad pure helpers + tests"
```

---

### Task 2: Proxy pagination params

**Files:**
- Modify: `supabase/functions/onlyfans-proxy/index.ts`

**Interfaces:**
- Consumes: request body now may include `params` (object) on list ops.
- Produces: list-op requests forward `?limit/offset/id/order` to OnlyFansAPI.

- [ ] **Step 1: Add param appending** — in `supabase/functions/onlyfans-proxy/index.ts`, locate the `let url: string, method = "GET", fwdBody …` block that builds `url` for `list_chats` / `list_messages`. After the `if/else if/else` that sets `url` (and before the `fetch`), append allowlisted pagination params for the GET list ops:

```typescript
  // Allowlisted pagination params (list ops only). Never fetch a raw next_page URL.
  if (op === "list_chats" || op === "list_messages") {
    const p = (payload && payload.params) || {};
    const qp = new URLSearchParams();
    for (const k of ["limit", "offset", "id", "order"]) {
      if (p[k] != null && String(p[k]) !== "") qp.set(k, String(p[k]));
    }
    const qs = qp.toString();
    if (qs) url += (url.includes("?") ? "&" : "?") + qs;
  }
```

- [ ] **Step 2: Deploy (human)**

`supabase functions deploy onlyfans-proxy --no-verify-jwt` (or paste in the dashboard; keep Verify JWT off).

- [ ] **Step 3: Smoke test (human)**

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/onlyfans-proxy" \
  -H "x-ssai-token: $SSAI_TOKEN" -H "Content-Type: application/json" \
  -d '{"op":"list_chats","account_id":"acct_XXXX","params":{"limit":5,"offset":5}}' | head -c 300
```
Expected: a JSON `data` array (the second page of 5). Confirm it differs from `offset:0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/onlyfans-proxy/index.ts
git commit -m "feat(of): onlyfans-proxy allowlisted pagination params"
```

---

### Task 3: `ofPull` params + `_ofProxy` 429 backoff

**Files:**
- Modify: `js/onlyfans.js`

**Interfaces:**
- Consumes: proxy `params` support (Task 2).
- Produces: `ofPull(accountId, op, chatId, params)` — `params` forwarded to the proxy. `_ofProxy` retries on HTTP 429.

Not harness-testable (network); the harness must still pass (files load).

- [ ] **Step 1: Replace `_ofProxy`** in `js/onlyfans.js` with a 429-retrying version:

```javascript
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
```

- [ ] **Step 2: Replace `ofPull`** in `js/onlyfans.js` to forward `params`:

```javascript
async function ofPull(accountId,op,chatId,params){
  if(op!=='list_chats'&&op!=='list_messages') throw new Error('ofPull: bad op '+op);
  return _ofProxy({op:op,account_id:accountId,chat_id:chatId,params:params});
}
```

- [ ] **Step 3: Harness check**

Run: `node tests/harness.js 2>&1 | tail -3`
Expected: `FAIL 0` (no pure-fn change; confirms the file still loads).

- [ ] **Step 4: Commit**

```bash
git add js/onlyfans.js
git commit -m "feat(of): ofPull params + 429 backoff in _ofProxy"
```

---

### Task 4: `ofListChatsPage` + `ofCreateSessionRows`

**Files:**
- Modify: `js/onlyfans.js`

**Interfaces:**
- Consumes: `ofPull` (Task 3), `ofNextCursor` (Task 1), `sb`.
- Produces:
  - `async ofListChatsPage(accountId, cursor) -> { chats: array, next: object|null }`
  - `async ofCreateSessionRows(creatorModel, chats) -> { created: number }`

Not harness-testable (network/DB); harness must stay green.

- [ ] **Step 1: Implement** — append to `js/onlyfans.js`:

```javascript
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
```

- [ ] **Step 2: Harness check**

Run: `node tests/harness.js 2>&1 | tail -3`
Expected: `FAIL 0`.

- [ ] **Step 3: Commit**

```bash
git add js/onlyfans.js
git commit -m "feat(of): ofListChatsPage + batched ofCreateSessionRows"
```

---

### Task 5: `ofLoadChatMessages` (lazy single-chat pull)

**Files:**
- Modify: `js/onlyfans.js`

**Interfaces:**
- Consumes: `ofPull` (Task 3), `ofNormalizeMessage`, `sb`.
- Produces: `async ofLoadChatMessages(accountId, creatorModel, fanId) -> array` of normalized messages `{sender,text,of_message_id,ts_iso}`; also writes the dedup ledger + `messages_input`.

Not harness-testable (network/DB); harness must stay green.

- [ ] **Step 1: Implement** — append to `js/onlyfans.js`:

```javascript
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
```

- [ ] **Step 2: Harness check**

Run: `node tests/harness.js 2>&1 | tail -3`
Expected: `FAIL 0`.

- [ ] **Step 3: Commit**

```bash
git add js/onlyfans.js
git commit -m "feat(of): ofLoadChatMessages lazy single-chat pull + batch upsert"
```

---

### Task 6: Rewire "Load chats" to paginate + add "Load more"; remove `ofSyncCreator`

**Files:**
- Modify: `js/app.js` (`onOfLoadGroup`, new `onOfLoadMore` + `_ofLoadChatsPage`, sidebar mg-head button)
- Modify: `js/onlyfans.js` (remove `ofSyncCreator`)

**Interfaces:**
- Consumes: `ofListChatsPage` + `ofCreateSessionRows` (Task 4), `loadSessions`, `renderSidebar`, `ofIsAuthorized`.
- Produces: `onOfLoadGroup(modelName)`, `onOfLoadMore(modelName)`; cursor state `window._ofChatCursor` / `window._ofChatHasMore`.

Not harness-testable (UI/DB); harness must stay green.

- [ ] **Step 1: Replace `onOfLoadGroup`** in `js/app.js` (currently calls `ofSyncCreator`) with the paginated version + helpers:

```javascript
async function onOfLoadGroup(modelName){
  const model=models.find(m=>m.name===modelName);
  if(!model||!model.of_account_id){toast('No OnlyFans account connected for '+modelName,'e');return;}
  if(!ofIsAuthorized(window.currentChatter,modelName)){toast('Not authorized for this creator','e');return;}
  window._ofChatCursor=window._ofChatCursor||{};
  window._ofChatCursor[modelName]=null; // fresh: start at page 1
  await _ofLoadChatsPage(modelName, model.of_account_id);
}

async function onOfLoadMore(modelName){
  const model=models.find(m=>m.name===modelName);
  if(!model||!model.of_account_id) return;
  if(!ofIsAuthorized(window.currentChatter,modelName)){toast('Not authorized for this creator','e');return;}
  await _ofLoadChatsPage(modelName, model.of_account_id);
}

async function _ofLoadChatsPage(modelName, accountId){
  toast('Loading OnlyFans chats for '+modelName+'…','i');
  try{
    window._ofChatCursor=window._ofChatCursor||{};
    window._ofChatHasMore=window._ofChatHasMore||{};
    const cursor=window._ofChatCursor[modelName]||null;
    const { chats, next }=await ofListChatsPage(accountId, cursor);
    const r=await ofCreateSessionRows(modelName, chats);
    window._ofChatCursor[modelName]=next;        // null when no more pages
    window._ofChatHasMore[modelName]=!!next;
    await loadSessions();   // hydrate in-memory sessions (incl. new stubs)
    renderSidebar();        // stubs show in the group with the OF badge
    toast(`${modelName}: +${chats.length} chats (${r.created} new)${next?' · more available':''}`,'s');
  }catch(e){ toast('Load failed: '+e.message,'e'); }
}
```

- [ ] **Step 2: Add the "Load more" button** to the sidebar group header. In `js/app.js`, find the `mg-head` line that renders the "Load chats" button (search `onOfLoadGroup('${model}')`) and replace it with one that also conditionally renders "Load more":

```javascript
        ${(models.find(m=>m.name===model)?.of_account_id)?`<button class="btn sm" title="Load this creator's OnlyFans chats" onclick="event.stopPropagation();onOfLoadGroup('${model}')" style="font-size:10px;padding:1px 7px;margin-left:6px">Load chats</button>${(window._ofChatHasMore&&window._ofChatHasMore[model])?`<button class="btn sm" title="Load the next page of chats" onclick="event.stopPropagation();onOfLoadMore('${model}')" style="font-size:10px;padding:1px 7px;margin-left:4px">Load more ▸</button>`:''}`:''}
```

- [ ] **Step 3: Remove `ofSyncCreator`** from `js/onlyfans.js` (the whole `async function ofSyncCreator(accountId,creatorModel){ … }` block — it's no longer referenced after Step 1).

- [ ] **Step 4: Verify no dangling refs + harness**

Run: `grep -n "ofSyncCreator" js/app.js js/onlyfans.js || echo "none"` → expect `none`.
Run: `node --check js/app.js && node --check js/onlyfans.js && node tests/harness.js 2>&1 | tail -3` → syntax OK, `FAIL 0`.

- [ ] **Step 5: Live verify (human)**

On the pilot creator: "Load chats" creates page-1 stubs in the group (OF badge); if more pages exist, "Load more" appears and advances. Re-clicking is idempotent (no dup sessions).

- [ ] **Step 6: Commit**

```bash
git add js/app.js js/onlyfans.js
git commit -m "feat(of): paginated Load chats + Load more; remove eager ofSyncCreator"
```

---

### Task 7: Lazy message load on open

**Files:**
- Modify: `js/app.js` (`loadSessions` hydration, `openSession`, new `ofEnsureChatLoaded`, `renderBubbles` empty branch)

**Interfaces:**
- Consumes: `ofNeedsLoad` (Task 1), `ofLoadChatMessages` (Task 5), `renderBubbles`, `recomputePosture`, `updatePostureChip`, `scrollChat`.
- Produces: `ofEnsureChatLoaded(session)`; `session._ofNeedsLoad` / `session._ofLoading` flags.

Not harness-testable (UI/DB); harness must stay green.

- [ ] **Step 1: Mark stubs at hydration** — in `js/app.js` `loadSessions`, inside the `sessions[s.id]={ …`  hydration object (after `messages:msgs,`), add:

```javascript
      _ofNeedsLoad: ofNeedsLoad(s),
```

- [ ] **Step 2: Fire lazy load on open** — in `js/app.js` `openSession(id)`, after the final `renderSession();`, add:

```javascript
  const _ofS=sessions[id];
  if(_ofS && _ofS._ofNeedsLoad) ofEnsureChatLoaded(_ofS);
```

- [ ] **Step 3: Implement `ofEnsureChatLoaded`** — add to `js/app.js` (near `maybeSendToOnlyFans`):

```javascript
// Lazy-load an OF stub's messages the first time it's opened. Guarded against
// double-fetch; re-renders only if it's still the active session.
async function ofEnsureChatLoaded(s){
  if(!s||!s._ofNeedsLoad||s._ofLoading) return;
  const model=models.find(m=>m.name===s.creator_model);
  if(!model||!model.of_account_id){s._ofNeedsLoad=false;return;}
  s._ofLoading=true;
  try{
    const norm=await ofLoadChatMessages(model.of_account_id, s.creator_model, s.of_chat_id);
    s.messages=norm.map(m=>({sender:m.sender,text:m.text,of_message_id:m.of_message_id,ts_iso:m.ts_iso}));
    s._ofNeedsLoad=false;
    if(activeId===s.id){
      const cm=document.getElementById('chatMsgs'); if(cm) cm.innerHTML=renderBubbles();
      if(typeof scrollChat==='function') scrollChat();
      if(typeof recomputePosture==='function') recomputePosture(s);
      if(typeof updatePostureChip==='function') updatePostureChip();
    }
  }catch(e){ toast('Failed to load messages: '+e.message,'e'); }
  finally{ s._ofLoading=false; }
}
```

- [ ] **Step 4: Loading placeholder** — in `js/app.js` `renderBubbles`, replace the empty-state line:

```javascript
  if(!msgs.length) html='<div class="chat-empty">Add messages below<br>or use Quick Paste</div>';
```
with:
```javascript
  if(!msgs.length) html=s._ofNeedsLoad
    ?'<div class="chat-empty">Loading conversation from OnlyFans…</div>'
    :'<div class="chat-empty">Add messages below<br>or use Quick Paste</div>';
```

- [ ] **Step 5: Syntax + harness**

Run: `node --check js/app.js && node tests/harness.js 2>&1 | tail -3` → syntax OK, `FAIL 0`.

- [ ] **Step 6: Live verify (human)**

Open a stub chat → "Loading conversation from OnlyFans…" → messages appear (correct sides). Re-open → instant from cache (no fetch). Generate → Accept → sends.

- [ ] **Step 7: Commit**

```bash
git add js/app.js
git commit -m "feat(of): lazy-load chat messages on open"
```

---

### Task 8: Runbook note

**Files:**
- Modify: `docs/superpowers/runbooks/onlyfans-integration-deploy.md`

- [ ] **Step 1: Add a "v2 chat loading" note** to the runbook:

```markdown
## v2 chat loading (paginated + lazy)
- Redeploy `onlyfans-proxy` (adds allowlisted pagination params): `supabase functions deploy onlyfans-proxy --no-verify-jwt`.
- No DB migration (relies on the existing sender/text columns + non-partial of_message_id index).
- UX: sidebar group "Load chats" loads a page of chat stubs; "Load more" pages forward; a chat's messages load when you open it.
- First live "Load more": confirm the `_pagination` param (offset vs id) — the proxy allowlist already supports both.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/runbooks/onlyfans-integration-deploy.md
git commit -m "docs(of): runbook note for v2 paginated/lazy chat loading"
```

---

## Self-Review

**Spec coverage:**
- Paginated chat list → Task 4 (`ofListChatsPage`) + Task 6 (Load chats/more + cursor). ✓
- Batched stub creation → Task 4 (`ofCreateSessionRows`). ✓
- Lazy message load on open → Task 5 (`ofLoadChatMessages`) + Task 7 (`ofEnsureChatLoaded`, `_ofNeedsLoad`, placeholder). ✓
- Batch message upsert → Task 5 (array upsert, onConflict of_message_id). ✓
- Proxy pagination (allowlisted, no raw-URL fetch) → Task 2. ✓
- 429 backoff → Task 3 (`_ofProxy`). ✓
- Remove eager `ofSyncCreator` → Task 6. ✓
- Cursor state + "Load more" visibility → Task 6. ✓
- `ofNextCursor` / `ofNeedsLoad` harness tests → Task 1. ✓
- No DB migration; prerequisites assumed → Global Constraints. ✓
- Sender side = `fromUser.id === fanId`; fan fields under `chat.fan` → Tasks 4/5. ✓
- Display from `messages_input`, ledger = `aich_messages` → Tasks 4/5/7. ✓
- Runbook/rollout → Task 8. ✓

**Placeholder scan:** none (all code provided; the `_pagination` field name is an explicit live-verify, handled by the allowlist).

**Type consistency:** `ofNextCursor(pagination)→object|null`, `ofNeedsLoad(session)→bool`, `ofPull(accountId,op,chatId,params)`, `ofListChatsPage(accountId,cursor)→{chats,next}`, `ofCreateSessionRows(creatorModel,chats)→{created}`, `ofLoadChatMessages(accountId,creatorModel,fanId)→array`, `ofEnsureChatLoaded(session)` — names/shapes consistent between definitions (Tasks 1/3/4/5/7) and call sites (Tasks 6/7). `window._ofChatCursor` / `window._ofChatHasMore` used consistently in Task 6 (set) and the Task 6 Step 2 button (read).
