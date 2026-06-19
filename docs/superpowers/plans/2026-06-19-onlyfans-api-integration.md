# OnlyFans API Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual copy-paste at both ends of the chat loop — pull/receive OnlyFans DMs into SSAI and auto-send chatter-approved text replies back — via Supabase Edge Functions, with the human review gate intact.

**Architecture:** Approach A. Two new Deno Edge Functions (`onlyfans-proxy` for outbound + read passthrough; `onlyfans-webhook` for live inbound) hold the single `ONLYFANS_API_KEY` server-side and read/write the existing `aich_*` tables. Generation stays client-side. A new `js/onlyfans.js` browser module holds pure helpers (harness-tested) plus the two proxy network calls. Per-creator routing dereferences a new `aich_models.of_account_id`.

**Tech Stack:** Vanilla browser JS (no build, global-scope `<script>` load order), Supabase (Postgres + RLS + Deno Edge Functions), Node `tests/harness.js` (VM sandbox) as the deterministic test bed, OnlyFansAPI REST (`https://app.onlyfansapi.com/api`).

## Global Constraints

- No build step, no package manager, no bundler. Browser files are loaded via `<script>` tags in `SSAI.html` in dependency order; they share state through global scope. New browser code goes in `js/onlyfans.js`.
- The deterministic test bed is `node tests/harness.js`. It loads `['config.js','doctrine.js','ui.js','app.js']` into a VM sandbox; pure functions to be tested MUST be added to that load list, listed in the `need[]` array, and exercised with `T(name, got, want)` assertions. The harness stubs `fetch` to reject — network code is NOT harness-testable.
- Edge Function source is NOT currently tracked in this repo (the existing `anthropic-proxy`/`mistral-proxy` live only in Supabase). This plan introduces `supabase/functions/`. Deploy via `supabase functions deploy <name>` if the Supabase CLI is configured; otherwise paste the file body into the Supabase Dashboard → Edge Functions editor (matches the existing manual-dashboard workflow — `supabase.com` is hard-blocked for browser automation, so a human runs this).
- SQL migrations are `.sql` files in `sql/`, run by a human in the Supabase Dashboard SQL Editor (runs as `postgres`, bypasses RLS).
- The browser proxy contract is fixed: POST to the function URL with header `x-ssai-token: <getProxyToken()>` and a JSON body. Mirror it exactly (see `js/api.js:10-17`).
- Real API keys NEVER touch the browser. `ONLYFANS_API_KEY` lives only in Edge Function secrets.
- v1 is TEXT ONLY. Any send with `price > 0` is rejected server-side and never auto-sent. PPV stays manual.
- Doctrine (`js/doctrine.js`) and prompt-cache blocks are OUT OF SCOPE — do not touch them.
- After ANY change to a harness-tested file, run `node tests/harness.js` and confirm `FAIL 0`.

## File Structure

| File | Create/Modify | Responsibility |
|---|---|---|
| `sql/onlyfans_integration_migration.sql` | Create | Add `of_account_id`/`of_chat_id`/`of_message_id`/`send_state` columns + unique constraint + indexes. |
| `js/onlyfans.js` | Create | Pure helpers (HTML-strip, normalize, routing, send-guard, authz, ppv-block) + `ofPull`/`ofSend` proxy calls + the "Sync from OnlyFans" action. |
| `supabase/functions/onlyfans-proxy/index.ts` | Create | Token-validated, allowlisted passthrough to OnlyFansAPI for `list_chats` / `list_messages` / `send`. Rejects `price>0`, unknown accounts, other paths. |
| `supabase/functions/onlyfans-webhook/index.ts` | Create | Verifies signature, resolves account→creator, find-or-creates session, normalizes + inserts inbound message idempotently. |
| `tests/harness.js` | Modify | Load `onlyfans.js`, extend `need[]`, add `══ W. ONLYFANS INTEGRATION ══` test sections. |
| `SSAI.html` | Modify | Add `<script src="js/onlyfans.js">`; add `of_account_id` field to the creator-model editor; add "Sync from OnlyFans" button + PPV-manual indicator hooks. |
| `js/app.js` | Modify | `createSession` sets `of_chat_id`; model save persists `of_account_id`; `acceptDraft` text path calls `maybeSendToOnlyFans`; `confirmPpvSend` shows the manual indicator; Realtime subscription renders webhook-inserted messages. |
| `docs/superpowers/runbooks/onlyfans-integration-deploy.md` | Create | Deploy, secrets, webhook registration, staged rollout, kill switch. |

---

### Task 1: Database migration

**Files:**
- Create: `sql/onlyfans_integration_migration.sql`

**Interfaces:**
- Produces: columns `aich_models.of_account_id`, `aich_sessions.of_chat_id`, `aich_messages.of_message_id` (UNIQUE), `aich_messages.send_state`; index `idx_aich_models_of_account_id`.

- [ ] **Step 1: Write the migration SQL**

```sql
-- sql/onlyfans_integration_migration.sql
-- OnlyFans API integration v1 — schema additions.
-- Run in the Supabase Dashboard SQL Editor (runs as postgres, bypasses RLS).
-- Idempotent: safe to re-run.

ALTER TABLE aich_models   ADD COLUMN IF NOT EXISTS of_account_id text;
ALTER TABLE aich_sessions ADD COLUMN IF NOT EXISTS of_chat_id    text;
ALTER TABLE aich_messages ADD COLUMN IF NOT EXISTS of_message_id text;
ALTER TABLE aich_messages ADD COLUMN IF NOT EXISTS send_state    text;

-- Dedup key: stops pull / messages.received / messages.sent-echo triple-insert.
-- Partial unique index so existing NULL rows are unaffected.
CREATE UNIQUE INDEX IF NOT EXISTS uq_aich_messages_of_message_id
  ON aich_messages (of_message_id) WHERE of_message_id IS NOT NULL;

-- Reverse lookup acct_XXXX -> creator_model (webhook + proxy account check).
CREATE INDEX IF NOT EXISTS idx_aich_models_of_account_id
  ON aich_models (of_account_id) WHERE of_account_id IS NOT NULL;

-- Session routing lookup (acct + fan -> session) for the webhook find-or-create.
CREATE INDEX IF NOT EXISTS idx_aich_sessions_of_chat_id
  ON aich_sessions (creator_model, of_chat_id) WHERE of_chat_id IS NOT NULL;
```

- [ ] **Step 2: Apply it (human, Supabase Dashboard SQL Editor)**

Paste the file contents into the SQL Editor and run. Expected: `Success. No rows returned`.

- [ ] **Step 3: Verify columns exist**

Run in SQL Editor:
```sql
SELECT table_name, column_name FROM information_schema.columns
WHERE column_name IN ('of_account_id','of_chat_id','of_message_id','send_state')
ORDER BY table_name, column_name;
```
Expected: 4 rows (`aich_messages.of_message_id`, `aich_messages.send_state`, `aich_models.of_account_id`, `aich_sessions.of_chat_id`).

- [ ] **Step 4: Commit**

```bash
git add sql/onlyfans_integration_migration.sql
git commit -m "feat(of): add OnlyFans integration schema migration"
```

---

### Task 2: Create `js/onlyfans.js` scaffold + wire into harness and HTML

**Files:**
- Create: `js/onlyfans.js`
- Modify: `tests/harness.js:32` (load list), `tests/harness.js:37` (need array)
- Modify: `SSAI.html:396` (script tag, after `app.js`)

**Interfaces:**
- Produces: an `onlyfans.js` file loaded by both the browser and the harness, exposing functions as globals (no module system). Later tasks add functions to it.

- [ ] **Step 1: Create the file with a header and one trivial pure function**

```javascript
// js/onlyfans.js — OnlyFans API integration (v1). Pure helpers + proxy calls.
// No module system: functions are global (loaded via <script> after app.js, and
// into tests/harness.js). Pure helpers here are mirrored in the Deno Edge
// Functions (supabase/functions/onlyfans-*) — keep them in sync.

// Returns true when a paid (PPV) send must be blocked in v1 (text-only).
function ofPpvBlocked(price){
  const n=Number(price)||0;
  return n>0;
}
```

- [ ] **Step 2: Add `onlyfans.js` to the harness load list**

In `tests/harness.js:32`, change:
```javascript
['config.js','doctrine.js','ui.js','app.js'].forEach(f=>load(f));
```
to:
```javascript
['config.js','doctrine.js','ui.js','app.js','onlyfans.js'].forEach(f=>load(f));
```

- [ ] **Step 3: Add `ofPpvBlocked` to the `need[]` availability check**

In `tests/harness.js:37`, append `'ofPpvBlocked'` to the `need` array (before the closing `]`):
```javascript
 ...,'sanitizeSlop','dedupeEmoji','ofPpvBlocked'];
```

- [ ] **Step 4: Run the harness — confirm the file loads and the function is found**

Run: `node tests/harness.js 2>&1 | head -5`
Expected: the `Functions loaded:` line shows no `MISSING: ofPpvBlocked`, and the run still ends `FAIL 0`.

- [ ] **Step 5: Add the script tag to `SSAI.html`**

After `SSAI.html:396` (`<script src="js/app.js"></script>`), add:
```html
<script src="js/onlyfans.js"></script>
```

- [ ] **Step 6: Commit**

```bash
git add js/onlyfans.js tests/harness.js SSAI.html
git commit -m "feat(of): scaffold js/onlyfans.js + wire into harness and HTML"
```

---

### Task 3: Inbound pure helpers (HTML-strip, normalize, routing)

**Files:**
- Modify: `js/onlyfans.js`
- Modify: `tests/harness.js` (need array + new test section)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `ofHtmlStripToText(html: string) -> string` — strips tags, decodes `&amp;&lt;&gt;&quot;&#39;&nbsp;`, collapses whitespace.
  - `ofNormalizeMessage(raw: object, sender: string) -> {sender, text, of_message_id, ts_iso}` — maps an OF message object (`{id, text, createdAt}`) to SSAI shape.
  - `ofResolveCreator(models: array, accountId: string) -> string|null` — finds `models[i].name` where `of_account_id === accountId`.
  - `ofSessionKey(creatorModel: string, fanUserId: string|number) -> {creator_model, of_chat_id}`.

- [ ] **Step 1: Write the failing tests** — add this section to `tests/harness.js` after the last existing section (before the `RESULT` block):

```javascript
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
```

- [ ] **Step 2: Add the four names to `need[]`** in `tests/harness.js:37`:
```javascript
 ...,'ofPpvBlocked','ofHtmlStripToText','ofNormalizeMessage','ofResolveCreator','ofSessionKey'];
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node tests/harness.js 2>&1 | tail -20`
Expected: FAILs in section W (functions missing / `MISSING:` list names them).

- [ ] **Step 4: Implement the helpers** — append to `js/onlyfans.js`:

```javascript
// Strip HTML to plain text + decode the common entities OF returns. Runs before
// any DB insert so fan-controlled markup never reaches the DOM (defense in depth
// with the client esc()).
function ofHtmlStripToText(html){
  if(!html) return '';
  let s=String(html);
  s=s.replace(/<[^>]*>/g,' ');                 // drop tags
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node tests/harness.js 2>&1 | tail -5`
Expected: `FAIL 0`, section W green.

- [ ] **Step 6: Commit**

```bash
git add js/onlyfans.js tests/harness.js
git commit -m "feat(of): inbound pure helpers (strip/normalize/route) + tests"
```

---

### Task 4: Outbound pure helpers (send-guard, authz, build body)

**Files:**
- Modify: `js/onlyfans.js`
- Modify: `tests/harness.js` (need array + section W additions)

**Interfaces:**
- Consumes: `ofPpvBlocked` (Task 2).
- Produces:
  - `ofBuildSendBody(text: string) -> {text}` — v1 text-only request body.
  - `ofShouldAutoSend(session, creatorModelRow) -> boolean` — true only if session has `of_chat_id`, creator has `of_account_id`, draft is not PPV.
  - `ofIsAuthorized(chatter, creatorModel) -> boolean` — manager, or chatter whose `assignments` include `creatorModel`.

- [ ] **Step 1: Write the failing tests** — append to section `══ W` in `tests/harness.js`:

```javascript
T('buildSendBody text only',F.ofBuildSendBody('hi there'),x=>x.text==='hi there'&&x.price===undefined);
T('shouldAutoSend happy path',F.ofShouldAutoSend({of_chat_id:'123',_draftIsPpv:false},{of_account_id:'acct_A'}),true);
T('shouldAutoSend no of_chat_id → false',F.ofShouldAutoSend({of_chat_id:null,_draftIsPpv:false},{of_account_id:'acct_A'}),false);
T('shouldAutoSend creator not connected → false',F.ofShouldAutoSend({of_chat_id:'123',_draftIsPpv:false},{of_account_id:null}),false);
T('shouldAutoSend PPV draft → false',F.ofShouldAutoSend({of_chat_id:'123',_draftIsPpv:true},{of_account_id:'acct_A'}),false);
T('authz manager → true',F.ofIsAuthorized({role:'manager'},'Cielo'),true);
T('authz assigned chatter → true',F.ofIsAuthorized({role:'chatter',assignments:['Cielo','Jammy']},'Cielo'),true);
T('authz unassigned chatter → false',F.ofIsAuthorized({role:'chatter',assignments:['Jammy']},'Cielo'),false);
T('authz null chatter → false',F.ofIsAuthorized(null,'Cielo'),false);
```

- [ ] **Step 2: Add names to `need[]`** in `tests/harness.js:37`:
```javascript
 ...,'ofSessionKey','ofBuildSendBody','ofShouldAutoSend','ofIsAuthorized'];
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `node tests/harness.js 2>&1 | tail -20`
Expected: section W has new FAILs naming the missing functions.

- [ ] **Step 4: Implement** — append to `js/onlyfans.js`:

```javascript
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `node tests/harness.js 2>&1 | tail -5`
Expected: `FAIL 0`.

- [ ] **Step 6: Commit**

```bash
git add js/onlyfans.js tests/harness.js
git commit -m "feat(of): outbound pure helpers (send-guard/authz/body) + tests"
```

---

### Task 5: Proxy network calls (`ofPull`, `ofSend`)

**Files:**
- Modify: `js/onlyfans.js`

**Interfaces:**
- Consumes: `getProxyToken()` (config.js), `ofBuildSendBody` (Task 4), `ofPpvBlocked` (Task 2). Reads `ONLYFANS_PROXY_URL`.
- Produces:
  - `async ofPull(accountId, op, chatId?) -> object` — `op` is `'list_chats'` or `'list_messages'`.
  - `async ofSend(accountId, chatId, text) -> object` — throws if `ofPpvBlocked` or proxy error.

Note: not harness-testable (network). The request *shape* is covered by Task 4's pure helpers. Verified live in Task 12.

- [ ] **Step 1: Add the proxy URL constant** to `js/config.js` after the `MISTRAL_PROXY_URL` line (`js/config.js:31`):

```javascript
const ONLYFANS_PROXY_URL='https://atzuqzdgqqcrcwthshfs.supabase.co/functions/v1/onlyfans-proxy';
```

- [ ] **Step 2: Implement `ofPull` / `ofSend`** — append to `js/onlyfans.js`:

```javascript
// Low-level proxy call. All OF traffic goes through onlyfans-proxy with the
// per-chatter ssai_* token (same contract as callApi). The OF API key never
// leaves the server.
async function _ofProxy(payload){
  const tk=getProxyToken();
  if(!tk) throw new Error('Proxy token missing — contact your manager');
  const r=await fetch(ONLYFANS_PROXY_URL,{
    method:'POST',
    headers:{'Content-Type':'application/json','x-ssai-token':tk},
    body:JSON.stringify(payload)
  });
  const d=await r.json().catch(()=>({}));
  if(!r.ok||d.error){
    throw new Error('OnlyFans proxy error '+r.status+': '+(d.error||r.statusText||'unknown'));
  }
  return d;
}

// Pull chats or a chat's messages for a connected account.
async function ofPull(accountId,op,chatId){
  if(op!=='list_chats'&&op!=='list_messages') throw new Error('ofPull: bad op '+op);
  return _ofProxy({op:op,account_id:accountId,chat_id:chatId});
}

// Send a TEXT reply. Blocks PPV client-side (server rejects it too).
async function ofSend(accountId,chatId,text){
  if(ofPpvBlocked(0)) {/* unreachable; documents intent */}
  return _ofProxy({op:'send',account_id:accountId,chat_id:chatId,message:ofBuildSendBody(text)});
}
```

- [ ] **Step 3: Confirm the harness still passes** (no new pure fns, just ensure the file still loads)

Run: `node tests/harness.js 2>&1 | tail -3`
Expected: `FAIL 0` (network fns are never called by the harness).

- [ ] **Step 4: Commit**

```bash
git add js/config.js js/onlyfans.js
git commit -m "feat(of): ofPull/ofSend proxy calls + proxy URL constant"
```

---

### Task 6: `onlyfans-proxy` Edge Function

**Files:**
- Create: `supabase/functions/onlyfans-proxy/index.ts`

**Interfaces:**
- Consumes: env `ONLYFANS_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Request body `{op, account_id, chat_id?, message?}` + header `x-ssai-token`.
- Produces: JSON from OnlyFansAPI, or `{error}` with a 4xx/5xx status.

Allowlist: only `list_chats` / `list_messages` / `send`. `send` with `message.price > 0` → 400. Unknown `account_id` (not in `aich_models.of_account_id`) → 403.

- [ ] **Step 1: Write the function**

```typescript
// supabase/functions/onlyfans-proxy/index.ts
// Allowlisted passthrough to OnlyFansAPI. Holds ONLYFANS_API_KEY server-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OF_BASE = "https://app.onlyfansapi.com/api";
const OF_KEY = Deno.env.get("ONLYFANS_API_KEY")!;
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const token = req.headers.get("x-ssai-token") || "";
  if (!token.startsWith("ssai_")) return json({ error: "missing/invalid proxy token" }, 401);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const { op, account_id, chat_id, message } = payload || {};

  if (!["list_chats", "list_messages", "send"].includes(op)) return json({ error: "op not allowed" }, 400);
  if (!account_id || typeof account_id !== "string") return json({ error: "account_id required" }, 400);

  // Account must be one SSAI knows about (mapped to a creator).
  const { data: model } = await sb.from("aich_models")
    .select("name").eq("of_account_id", account_id).maybeSingle();
  if (!model) return json({ error: "unknown account_id" }, 403);

  // v1 text-only backstop.
  if (op === "send" && message && Number(message.price) > 0) {
    return json({ error: "PPV/paid send is disabled in v1 (text only)" }, 400);
  }

  let url: string, method = "GET", fwdBody: string | undefined;
  if (op === "list_chats") {
    url = `${OF_BASE}/${account_id}/chats`;
  } else if (op === "list_messages") {
    if (!chat_id) return json({ error: "chat_id required" }, 400);
    url = `${OF_BASE}/${account_id}/chats/${chat_id}/messages`;
  } else { // send
    if (!chat_id) return json({ error: "chat_id required" }, 400);
    if (!message || typeof message.text !== "string" || !message.text.trim()) {
      return json({ error: "non-empty text required" }, 400);
    }
    url = `${OF_BASE}/${account_id}/chats/${chat_id}/messages`;
    method = "POST";
    fwdBody = JSON.stringify({ text: message.text });
  }

  const ofRes = await fetch(url, {
    method,
    headers: { "Authorization": `Bearer ${OF_KEY}`, "Content-Type": "application/json" },
    body: fwdBody,
  });
  const data = await ofRes.json().catch(() => ({}));
  return json(data, ofRes.ok ? 200 : ofRes.status);
});
```

- [ ] **Step 2: Deploy (human)**

CLI: `supabase functions deploy onlyfans-proxy --no-verify-jwt`
Or paste the body into Dashboard → Edge Functions → new function `onlyfans-proxy`.
Set secret: `supabase secrets set ONLYFANS_API_KEY=<key>` (or Dashboard → Edge Functions → Secrets).

- [ ] **Step 3: Smoke test (human, after a creator has `of_account_id` set)**

```bash
curl -s -X POST "$SUPABASE_URL/functions/v1/onlyfans-proxy" \
  -H "x-ssai-token: $SSAI_TOKEN" -H "Content-Type: application/json" \
  -d '{"op":"list_chats","account_id":"acct_XXXX"}' | head -c 400
```
Expected: a JSON `data` array of chats. Then verify rejects:
```bash
# unknown account → 403
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SUPABASE_URL/functions/v1/onlyfans-proxy" \
  -H "x-ssai-token: $SSAI_TOKEN" -H "Content-Type: application/json" \
  -d '{"op":"list_chats","account_id":"acct_NOPE"}'   # expect 403
# PPV send → 400
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SUPABASE_URL/functions/v1/onlyfans-proxy" \
  -H "x-ssai-token: $SSAI_TOKEN" -H "Content-Type: application/json" \
  -d '{"op":"send","account_id":"acct_XXXX","chat_id":"1","message":{"text":"x","price":10}}'  # expect 400
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/onlyfans-proxy/index.ts
git commit -m "feat(of): onlyfans-proxy edge function (allowlist passthrough)"
```

---

### Task 7: `onlyfans-webhook` Edge Function

**Files:**
- Create: `supabase/functions/onlyfans-webhook/index.ts`

**Interfaces:**
- Consumes: env `ONLYFANS_WEBHOOK_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`. Receives `messages.received` payloads.
- Produces: inserts into `aich_sessions` (find-or-create) + `aich_messages` (idempotent). Always returns 2xx for accepted/duplicate/unmapped (so OnlyFansAPI stops retrying).

Mirrors `ofHtmlStripToText` + `ofResolveCreator` logic from `js/onlyfans.js` (keep in sync).

- [ ] **Step 1: Write the function**

```typescript
// supabase/functions/onlyfans-webhook/index.ts
// Receives OnlyFansAPI webhooks, writes inbound fan messages to SSAI.
// Mirrors ofHtmlStripToText/ofResolveCreator from js/onlyfans.js — keep in sync.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SECRET = Deno.env.get("ONLYFANS_WEBHOOK_SECRET")!;
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const ok = () => new Response("ok", { status: 200 });

function stripToText(html: string): string {
  if (!html) return "";
  return String(html).replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  // Verify shared secret (header configured when registering the webhook).
  const sig = req.headers.get("x-ofapi-signature") || req.headers.get("x-webhook-secret") || "";
  if (!SECRET || sig !== SECRET) return new Response("unauthorized", { status: 401 });

  let evt: any;
  try { evt = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  if (evt?.event !== "messages.received") return ok(); // ignore other events in v1

  const accountId = evt.account_id;
  const p = evt.payload || {};
  const fan = p.fromUser || {};
  const ofMsgId = p.id != null ? String(p.id) : null;
  if (!accountId || !fan.id || !ofMsgId) return ok(); // malformed → drop, don't retry

  // acct -> creator (isolation boundary). Unmapped → log + 2xx (never accept).
  const { data: model } = await sb.from("aich_models")
    .select("name").eq("of_account_id", accountId).maybeSingle();
  if (!model) { console.log("unmapped account", accountId); return ok(); }
  const creatorModel = model.name;
  const ofChatId = String(fan.id);

  // Find-or-create session (creator_model + of_chat_id).
  const { data: existing } = await sb.from("aich_sessions")
    .select("id").eq("creator_model", creatorModel).eq("of_chat_id", ofChatId).maybeSingle();
  let sessionId = existing?.id;
  if (!sessionId) {
    // Attribute to a chatter assigned to this creator, else null (system).
    const { data: asg } = await sb.from("model_assignments")
      .select("chatter_id").eq("creator_model", creatorModel).limit(1).maybeSingle();
    const { data: created } = await sb.from("aich_sessions").insert({
      creator_model: creatorModel,
      customer_name: fan.name || fan.username || ofChatId,
      customer_username: fan.username || ("of_" + ofChatId),
      of_chat_id: ofChatId,
      status: "active",
      current_posture: "WARM_BUILD",
      last_active_at: new Date().toISOString(),
      chatter_id: asg?.chatter_id || null,
    }).select("id").single();
    sessionId = created?.id;
  }
  if (!sessionId) return new Response("session create failed", { status: 500 }); // let OF retry

  // Idempotent insert (unique of_message_id). ON CONFLICT DO NOTHING via upsert+ignore.
  await sb.from("aich_messages").upsert({
    session_id: sessionId,
    creator_model: creatorModel,
    customer_username: undefined, // optional; left to existing columns
    sender: "customer",
    text: stripToText(p.text),
    of_message_id: ofMsgId,
    created_at: p.createdAt || new Date().toISOString(),
    chatter_id: null,
  }, { onConflict: "of_message_id", ignoreDuplicates: true });

  return ok();
});
```

> NOTE for the implementer: confirm the actual `aich_messages` column names against the live schema before deploy (this repo has no schema dump). The required columns are `session_id`, `sender`, `text`, `of_message_id`, `created_at`; adjust any others (`creator_model`, `customer_username`) to match what the table actually has. Remove keys the table doesn't define.

- [ ] **Step 2: Deploy + secret (human)**

CLI: `supabase functions deploy onlyfans-webhook --no-verify-jwt`
Secret: `supabase secrets set ONLYFANS_WEBHOOK_SECRET=<random-long-string>`

- [ ] **Step 3: Register the webhook (human, OnlyFansAPI dashboard)**

In the OnlyFansAPI dashboard, add a webhook: URL `=$SUPABASE_URL/functions/v1/onlyfans-webhook`, event `messages.received`, secret header matching `ONLYFANS_WEBHOOK_SECRET`.

- [ ] **Step 4: Smoke test (human) — simulate a delivery**

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST "$SUPABASE_URL/functions/v1/onlyfans-webhook" \
  -H "x-webhook-secret: $ONLYFANS_WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '{"event":"messages.received","account_id":"acct_XXXX","payload":{"id":"of_t1","text":"<p>hi babe</p>","createdAt":"2025-05-16T00:27:25+00:00","fromUser":{"id":777,"username":"testfan","name":"Test"}}}'
# expect 200
```
Then verify in SQL Editor: `SELECT sender,text,of_message_id FROM aich_messages WHERE of_message_id='of_t1';` → one row, `text='hi babe'`. Re-run the curl → still ONE row (idempotent). Bad secret → 401.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/onlyfans-webhook/index.ts
git commit -m "feat(of): onlyfans-webhook edge function (idempotent inbound)"
```

---

### Task 8: Creator-model `of_account_id` field

**Files:**
- Modify: `SSAI.html` (creator-model editor markup)
- Modify: `js/app.js` (model save function)

**Interfaces:**
- Consumes: existing model editor + save path.
- Produces: `of_account_id` persisted on the `aich_models` row.

- [ ] **Step 1: Locate the model editor + save**

Run: `grep -nE "function saveModel|aich_models.*upsert|aich_models.*update|id=.m_" js/app.js | head`
Identify the input-collection block and the `aich_models` write in the model-save function.

- [ ] **Step 2: Add the input to the editor markup**

In `SSAI.html`, in the creator-model editor form (near the existing name/tier/prompt inputs), add:
```html
<div class="fg"><label class="fl">OnlyFans Account ID <span style="color:var(--text3);font-weight:400">(acct_… from OnlyFansAPI; leave blank to keep this creator fully manual)</span></label><input class="fi" id="m_of_account_id" placeholder="acct_XXXXXXXXXXXXXXX"></div>
```

- [ ] **Step 3: Persist it in the save function** (in the `js/app.js` model-save located in Step 1) — add `of_account_id` to the object written to `aich_models`:
```javascript
of_account_id:(document.getElementById('m_of_account_id')?.value||'').trim()||null,
```
And when populating the editor for an existing model, set the field:
```javascript
const ofa=document.getElementById('m_of_account_id'); if(ofa) ofa.value=model.of_account_id||'';
```

- [ ] **Step 4: Verify (human, in browser)**

Open SSAI, edit a creator, set `of_account_id` to a test `acct_…`, save, reload, reopen the editor → the value persists. Confirm in SQL: `SELECT name,of_account_id FROM aich_models WHERE of_account_id IS NOT NULL;`

- [ ] **Step 5: Commit**

```bash
git add SSAI.html js/app.js
git commit -m "feat(of): of_account_id field in creator-model editor"
```

---

### Task 9: Session `of_chat_id` + "Sync from OnlyFans" + Realtime render

**Files:**
- Modify: `js/app.js` (`createSession`, new `ofSyncCreator`, Realtime subscription)
- Modify: `js/onlyfans.js` (sync helper that normalizes + inserts pulled messages)
- Modify: `SSAI.html` (Sync button)

**Interfaces:**
- Consumes: `ofPull` (Task 5), `ofNormalizeMessage`/`ofSessionKey` (Task 3), `sb`.
- Produces: pulled + live messages land in `aich_messages` and render.

- [ ] **Step 1: Add `of_chat_id` to `createSession`'s insert object** — in `js/app.js:7331`, add to the `d` object (after `subscription_status`):
```javascript
of_chat_id:(document.getElementById('ns_of_chat_id')?.value||'').trim()||null,
```
(Optional input in the New Session form; webhook/sync set it for API-sourced sessions. Manual sessions may leave it blank — they just won't auto-send until set.)

- [ ] **Step 2: Implement the sync helper** — append to `js/onlyfans.js`:
```javascript
// Pull a creator's chats + messages and upsert them into aich_messages.
// Returns {chats, inserted}. Server-side webhook handles live; this is backfill/recovery.
async function ofSyncCreator(accountId, creatorModel){
  const chatsRes=await ofPull(accountId,'list_chats');
  const chats=(chatsRes&&chatsRes.data)||[];
  let inserted=0;
  for(const chat of chats){
    const chatId=String(chat.id??chat.withUser?.id??'');
    if(!chatId) continue;
    const sk=ofSessionKey(creatorModel,chatId);
    // find-or-create session
    let{data:sess}=await sb.from('aich_sessions').select('id')
      .eq('creator_model',creatorModel).eq('of_chat_id',sk.of_chat_id).maybeSingle();
    if(!sess){
      const{data:created}=await sb.from('aich_sessions').insert({
        creator_model:creatorModel,
        customer_name:chat.withUser?.name||chat.withUser?.username||chatId,
        customer_username:chat.withUser?.username||('of_'+chatId),
        of_chat_id:sk.of_chat_id,status:'active',current_posture:'WARM_BUILD',
        last_active_at:new Date().toISOString()
      }).select('id').single();
      sess=created;
    }
    if(!sess) continue;
    const msgsRes=await ofPull(accountId,'list_messages',chatId);
    const msgs=(msgsRes&&msgsRes.data)||[];
    for(const raw of msgs){
      const sender=raw.fromUser&&String(raw.fromUser.id)===chatId?'customer':'model';
      const n=ofNormalizeMessage(raw,sender);
      if(!n.of_message_id) continue;
      const{error}=await sb.from('aich_messages').upsert({
        session_id:sess.id,sender:n.sender,text:n.text,
        of_message_id:n.of_message_id,created_at:n.ts_iso
      },{onConflict:'of_message_id',ignoreDuplicates:true});
      if(!error) inserted++;
    }
  }
  return {chats:chats.length,inserted};
}
```

- [ ] **Step 3: Add the Sync button + handler** — add a button in the relevant SSAI.html toolbar:
```html
<button class="btn" id="ofSyncBtn" onclick="onOfSyncClick()" style="display:none">Sync from OnlyFans</button>
```
And in `js/app.js`, add the click handler (gate by `ofIsAuthorized` + creator having `of_account_id`):
```javascript
async function onOfSyncClick(){
  const s=sessions[activeId]; if(!s) return;
  const model=models.find(m=>m.name===s.creator_model);
  if(!model||!model.of_account_id){toast('Creator has no OnlyFans account connected','e');return;}
  if(!ofIsAuthorized(window.currentChatter,s.creator_model)){toast('Not authorized for this creator','e');return;}
  toast('Syncing from OnlyFans…','i');
  try{ const r=await ofSyncCreator(model.of_account_id,s.creator_model);
    toast(`Synced ${r.chats} chats, ${r.inserted} new messages`,'s');
    if(typeof loadSession==='function') loadSession(activeId);
  }catch(e){ toast('Sync failed: '+e.message,'e'); }
}
```

- [ ] **Step 4: Add the Realtime subscription** — in `js/app.js`, after the Supabase client is ready (near `installChatterIdAutoInject`/auth init), subscribe so webhook-inserted rows render:
```javascript
function installOfRealtime(){
  if(!sb||window._ofRealtime) return;
  window._ofRealtime=sb.channel('of_inbound')
    .on('postgres_changes',{event:'INSERT',schema:'public',table:'aich_messages'},(payload)=>{
      try{
        const row=payload.new; if(!row||row.sender!=='customer') return;
        const s=Object.values(sessions).find(x=>x.id===row.session_id);
        if(s&&activeId===s.id){
          if(!(s.messages||[]).some(m=>m.of_message_id===row.of_message_id)){
            s.messages.push({sender:'customer',text:row.text,ts_iso:row.created_at,of_message_id:row.of_message_id});
            document.getElementById('chatMsgs').innerHTML=renderBubbles();
          }
        }
      }catch(e){console.warn('of realtime render failed:',e.message);}
    }).subscribe();
}
```
Call `installOfRealtime()` from the same place `installChatterIdAutoInject()` is invoked post-auth.

- [ ] **Step 5: Show the Sync button when the active creator is connected** — in the session-open/render path, add:
```javascript
const _ofb=document.getElementById('ofSyncBtn');
if(_ofb){const _m=models.find(m=>m.name===sessions[activeId]?.creator_model);_ofb.style.display=_m&&_m.of_account_id?'inline-flex':'none';}
```

- [ ] **Step 6: Harness check + live verify**

Run: `node tests/harness.js 2>&1 | tail -3` → `FAIL 0` (no pure-fn changes; ensures files still load).
Live (human): open a session for a connected creator → "Sync from OnlyFans" → chats + history appear; send a real DM to the creator → it appears live (Realtime).

- [ ] **Step 7: Commit**

```bash
git add js/app.js js/onlyfans.js SSAI.html
git commit -m "feat(of): session of_chat_id + sync backfill + realtime inbound"
```

---

### Task 10: Outbound auto-send on Accept

**Files:**
- Modify: `js/app.js` (`acceptDraft`, new `maybeSendToOnlyFans`)

**Interfaces:**
- Consumes: `ofShouldAutoSend`/`ofIsAuthorized` (Task 4), `ofSend` (Task 5), `scanForBanned` (existing), `sb`.
- Produces: approved text auto-sent; `of_message_id` + `send_state` written back.

- [ ] **Step 1: Implement `maybeSendToOnlyFans`** — add to `js/app.js`:
```javascript
// Auto-send an accepted TEXT reply to OnlyFans. No-op unless the creator is
// connected and the session has of_chat_id. Final ToS gate runs here.
async function maybeSendToOnlyFans(s, acceptedText){
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
    if(sb&&ofId){
      // Tag the just-inserted model row so the messages.sent echo dedupes.
      await sb.from('aich_messages')
        .update({of_message_id:ofId,send_state:'sent'})
        .eq('session_id',s.id).eq('sender','model').is('of_message_id',null)
        .order('created_at',{ascending:false}).limit(1);
    }
    toast('Sent to OnlyFans','s');
  }catch(e){
    if(sb){await sb.from('aich_messages').update({send_state:'send_failed'})
      .eq('session_id',s.id).eq('sender','model').is('of_message_id',null)
      .order('created_at',{ascending:false}).limit(1);}
    toast('OnlyFans send failed — send manually. ('+e.message+')','e');
  }
}
```

- [ ] **Step 2: Call it from `acceptDraft`'s text path** — in `js/app.js`, immediately after the model message is pushed at `js/app.js:2726-2727` (the non-PPV path; the PPV branch already returned at 2711), add:
```javascript
  // OF auto-send (text only). Fire-and-forget; failures surface a toast + send_failed.
  maybeSendToOnlyFans(s, acceptedDraft);
```
(`acceptedDraft` is captured at `js/app.js:2725`; `s` is `sessions[activeId]`.)

- [ ] **Step 3: Harness check**

Run: `node tests/harness.js 2>&1 | tail -3`
Expected: `FAIL 0` (the gate helpers are already covered in Task 4; this wires them).

- [ ] **Step 4: Live verify (human)**

On a connected pilot creator: generate → Accept a text reply → it lands in the OnlyFans chat. Confirm no double row after the `messages.sent` echo: `SELECT count(*) FROM aich_messages WHERE of_message_id='<sent id>';` → 1. Force a failure (bad chat_id) → row shows `send_state='send_failed'` + toast.

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat(of): auto-send accepted text replies on Accept"
```

---

### Task 11: PPV manual indicator

**Files:**
- Modify: `js/app.js` (`confirmPpvSend`)

**Interfaces:**
- Consumes: nothing new.
- Produces: a clear "send this PPV manually on OnlyFans" cue; no auto-send for PPV.

- [ ] **Step 1: Add the indicator** — in `confirmPpvSend` (`js/app.js:5294`), after the PPV message is committed, add (gate to connected creators so manual creators see no noise):
```javascript
  try{
    const _s=sessions[activeId];
    const _m=_s&&models.find(m=>m.name===_s.creator_model);
    if(_m&&_m.of_account_id){
      toast('PPV recorded — attach media + send this PPV manually on OnlyFans (auto-send is text-only in v1)','i');
    }
  }catch(e){}
```

- [ ] **Step 2: Harness check**

Run: `node tests/harness.js 2>&1 | tail -3` → `FAIL 0`.

- [ ] **Step 3: Live verify (human)**

On a connected creator, accept a PPV draft → price modal → confirm → the manual-send toast appears and nothing is auto-sent to OnlyFans.

- [ ] **Step 4: Commit**

```bash
git add js/app.js
git commit -m "feat(of): PPV manual-send indicator (text-only auto-send in v1)"
```

---

### Task 12: Deploy + staged rollout runbook

**Files:**
- Create: `docs/superpowers/runbooks/onlyfans-integration-deploy.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: an operator runbook.

- [ ] **Step 1: Write the runbook**

```markdown
# OnlyFans Integration — Deploy & Rollout Runbook

## One-time setup
1. Run `sql/onlyfans_integration_migration.sql` in the Supabase SQL Editor.
2. Set secrets: `ONLYFANS_API_KEY`, `ONLYFANS_WEBHOOK_SECRET` (Edge Function secrets).
3. Deploy functions: `onlyfans-proxy`, `onlyfans-webhook` (CLI `supabase functions deploy <name> --no-verify-jwt`, or paste in the Dashboard).
4. Register the webhook in the OnlyFansAPI dashboard: URL `<SUPABASE_URL>/functions/v1/onlyfans-webhook`, event `messages.received`, secret header = `ONLYFANS_WEBHOOK_SECRET`.

## Staged rollout
- **Phase 0:** Steps above. No creator has `of_account_id` → zero behavior change.
- **Phase 1:** Connect ONE pilot creator's OF account in the OnlyFansAPI dashboard; copy its `acct_XXXX` into that creator's SSAI model. Use "Sync from OnlyFans" + watch live inbound for a day. Outbound still manual (don't accept-to-send yet — or accept knowing it sends; pilot the inbound first).
- **Phase 2:** Accept a text reply for the pilot creator → confirm it lands on OnlyFans and dedupes (count=1). Watch `send_state` for failures.
- **Phase 3:** Roll out remaining creators by setting `of_account_id` per model.

## Kill switch
Clear a creator's `of_account_id` (`UPDATE aich_models SET of_account_id=NULL WHERE name='<creator>';`). That creator instantly reverts to fully-manual — no inbound auto-import, no auto-send. The manual flow is never removed.

## Monitoring
- Inbound gaps: re-run "Sync from OnlyFans".
- `SELECT send_state, count(*) FROM aich_messages WHERE send_state IS NOT NULL GROUP BY 1;`
- `accounts.session_expired` (future event): reconnect the account in the OnlyFansAPI dashboard.
```

- [ ] **Step 2: Commit**

```bash
git add docs/superpowers/runbooks/onlyfans-integration-deploy.md
git commit -m "docs(of): deploy + staged rollout runbook"
```

---

## Self-Review

**Spec coverage:**
- Pull chats/messages → Task 5 (`ofPull`) + Task 9 (`ofSyncCreator`). ✓
- Webhook inbound → Task 7. ✓
- Auto-send on Accept (text) → Task 10. ✓
- PPV manual + `price>0` reject → Task 6 (server) + Task 11 (UI) + Task 4 (`ofPpvBlocked`). ✓
- Account connection via dashboard + `of_account_id` → Task 8. ✓
- Single key, server-side → Task 6 (env). ✓
- Multi-account routing → `ofResolveCreator` (Task 3) + `of_account_id` lookups (Tasks 6/7/9/10). ✓
- Identity mapping + chatter_id explicit (server) → Task 7. ✓
- HTML-strip / injection defense → Task 3 + Task 7. ✓
- Dedup (`of_message_id` unique) → Task 1 + idempotent upserts (Tasks 7/9) + echo write-back (Task 10). ✓
- Server-side authz → Task 6 (account check) + Task 4/Task 10 (`ofIsAuthorized`). See note below.
- Realtime + sync redundancy → Task 9. ✓
- Security (allowlist, secret) → Task 6/7. ✓
- Error handling (send_failed, 2xx-fast webhook, 429 passthrough) → Tasks 7/10/6. ✓
- Staged rollout + kill switch → Task 12. ✓
- Harness tests for pure fns → Tasks 2/3/4. ✓

**Known gap / confirm during implementation:** The spec's "proxy confirms manager OR assigned chatter" is implemented as (a) known-account check server-side (Task 6) + (b) `ofIsAuthorized` client gate (Task 4/9/10). Full *per-chatter* server enforcement requires resolving the `ssai_*` token → chatter row, which depends on the existing (out-of-repo) proxy-token storage. Confirm that storage when implementing Task 6; if a token→chatter mapping exists, add the `model_assignments` check there. Until then, RLS + the known-account check + the client gate are the enforcement.

**Placeholder scan:** none (no TBD/TODO; all code provided). The two NOTEs (webhook column names, proxy-token→chatter mapping) are explicit confirm-against-live-schema steps, not placeholders.

**Type consistency:** `of_account_id`/`of_chat_id`/`of_message_id`/`send_state` used identically across SQL, helpers, edge functions, and write-backs. `ofShouldAutoSend(session, creatorModelRow)`, `ofIsAuthorized(chatter, creatorModel)`, `ofNormalizeMessage(raw, sender)`, `ofResolveCreator(models, accountId)`, `ofSessionKey(creatorModel, fanUserId)`, `ofPull(accountId, op, chatId)`, `ofSend(accountId, chatId, text)` — signatures consistent between definition (Tasks 3-5) and call sites (Tasks 9-10).
