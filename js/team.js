// v0.4.0: TEAM MANAGEMENT (manager only) — calls chatter-admin Edge Function
async function callChatterAdmin(action, body){
  const session = (await sb.auth.getSession()).data.session;
  if(!session) throw new Error('Not authenticated');
  const r = await fetch(CHATTER_ADMIN_URL, {
    method:'POST',
    headers:{
      'Content-Type':'application/json',
      'Authorization':'Bearer '+session.access_token,
    },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await r.json();
  if(!r.ok) throw new Error(data?.error || ('HTTP '+r.status));
  return data;
}

function renderModelCheckboxes(boxId, selected){
  const box = document.getElementById(boxId);
  if(!box) return;
  selected = selected || [];
  // v0.4.0 fix: top-level `let models` isn't on window, read via globalThis-eval
  const allModels = (typeof models !== 'undefined' ? models : []).map(m => m.name);
  box.innerHTML = allModels.map(name => {
    const checked = selected.includes(name) ? 'checked' : '';
    return `<label style="display:inline-flex;align-items:center;gap:5px;padding:4px 8px;background:rgba(255,255,255,0.04);border-radius:4px;font-size:11px;cursor:pointer">
      <input type="checkbox" value="${name}" ${checked} style="margin:0;cursor:pointer"> ${name}
    </label>`;
  }).join('');
}

function getCheckedModels(boxId){
  const box = document.getElementById(boxId);
  if(!box) return [];
  return Array.from(box.querySelectorAll('input[type=checkbox]:checked')).map(c => c.value);
}

async function inviteChatter(){
  const status = document.getElementById('ti_status');
  const email = document.getElementById('ti_email').value.trim();
  const password = document.getElementById('ti_password').value;
  const full_name = document.getElementById('ti_name').value.trim();
  const role = document.getElementById('ti_role').value;
  const models = getCheckedModels('ti_models_box');
  if(!email || !password){
    status.innerHTML='<span style="color:var(--red)">Email + password required</span>';
    return;
  }
  status.innerHTML='<span style="color:var(--text3)">Creating chatter...</span>';
  try{
    const res = await callChatterAdmin('create', { email, password, full_name, role, models });
    status.innerHTML=`<span style="color:#4ade80">✓ Invited ${email} — proxy token: <code style="background:rgba(255,255,255,0.06);padding:2px 6px;border-radius:3px;font-size:10px">${res.proxy_token}</code></span>`;
    document.getElementById('ti_email').value='';
    document.getElementById('ti_password').value='';
    document.getElementById('ti_name').value='';
    renderModelCheckboxes('ti_models_box', []);
    await loadTeamList();
  }catch(e){
    status.innerHTML='<span style="color:var(--red)">Error: '+(e.message||e)+'</span>';
  }
}

async function loadTeamList(){
  // Render the model checkboxes for the invite form
  renderModelCheckboxes('ti_models_box', []);
  const list = document.getElementById('teamList');
  if(!list) return;
  list.innerHTML='<div style="color:var(--text3);font-size:11px;padding:10px">Loading team...</div>';
  try{
    const { chatters, assignments } = await callChatterAdmin('list', {});
    const byCh = {};
    (assignments || []).forEach(a => {
      (byCh[a.chatter_id] = byCh[a.chatter_id] || []).push(a.creator_model);
    });
    if(!chatters.length){
      list.innerHTML='<div style="color:var(--text3);font-size:11px;padding:10px">No chatters yet.</div>';
      return;
    }
    list.innerHTML = chatters.map(c => {
      const isYou = c.id === window.currentChatter?.id;
      const isManagerCard = c.role === 'manager';
      // v0.4.1.0: managers have access to all models regardless of assignments,
      // so showing the per-row assignment list is misleading. Display "all (manager)".
      const models = isManagerCard
        ? '<span style="color:var(--text2)">all <span style="color:var(--text3)">(manager)</span></span>'
        : ((byCh[c.id] || []).join(', ') || '<em style="color:var(--text3)">none</em>');
      const lastSeen = c.last_seen_at ? new Date(c.last_seen_at).toLocaleString() : 'never';
      const roleColor = c.role==='manager' ? '#c084fc' : '#60a5fa';
      const roleBg = c.role==='manager' ? 'rgba(168,85,247,0.15)' : 'rgba(59,130,246,0.15)';
      const activeBadge = c.is_active
        ? '<span style="color:#4ade80;font-size:10px;background:rgba(74,222,128,0.1);padding:2px 6px;border-radius:3px">active</span>'
        : '<span style="color:#f87171;font-size:10px;background:rgba(248,113,113,0.1);padding:2px 6px;border-radius:3px">disabled</span>';
      return `<div style="background:rgba(255,255,255,0.03);border:1px solid var(--border);border-radius:6px;padding:12px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
          <span style="font-weight:600;font-size:12px">${c.full_name || c.email.split('@')[0]}</span>
          <span style="background:${roleBg};color:${roleColor};font-size:9px;padding:2px 6px;border-radius:3px;text-transform:uppercase">${c.role}</span>
          ${activeBadge}
          ${isYou ? '<span style="color:var(--text3);font-size:10px">(you)</span>' : ''}
        </div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:4px">${c.email}</div>
        <div style="font-size:11px;color:var(--text3);margin-bottom:4px">Models: ${models}</div>
        <div style="font-size:10px;color:var(--text3);margin-bottom:8px">Last seen: ${lastSeen}</div>
        ${isYou ? '' : `<div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn sm" onclick="toggleChatterActive('${c.id}', ${!c.is_active})">${c.is_active?'Disable':'Enable'}</button>
          <button class="btn sm" onclick="changeChatterRole('${c.id}', '${c.role==='manager'?'chatter':'manager'}')">Make ${c.role==='manager'?'chatter':'manager'}</button>
          ${isManagerCard ? '' : `<button class="btn sm" onclick="editChatterModels('${c.id}', ${JSON.stringify(byCh[c.id]||[]).replace(/"/g,'&quot;')})">Edit models</button>`}
          <button class="btn sm" onclick="rotateChatterToken('${c.id}', '${c.email}')">Rotate token</button>
          <button class="btn sm" onclick="deleteChatter('${c.id}', '${c.email}')" style="color:var(--red)">Delete</button>
        </div>`}
      </div>`;
    }).join('');
  }catch(e){
    list.innerHTML='<div style="color:var(--red);font-size:11px;padding:10px">Error: '+(e.message||e)+'</div>';
  }
}

async function toggleChatterActive(id, makeActive){
  try{
    await callChatterAdmin('update', { chatter_id: id, is_active: makeActive });
    await loadTeamList();
    toast(makeActive?'Chatter enabled':'Chatter disabled', 's');
  }catch(e){ toast('Error: '+(e.message||e), 'e'); }
}

async function changeChatterRole(id, newRole){
  // v0.4.1.0: Self-demotion guard. Block demoting the LAST active manager.
  if(newRole==='chatter'){
    try{
      const{chatters}=await callChatterAdmin('list',{});
      const activeManagers=(chatters||[]).filter(x=>x.role==='manager'&&x.is_active);
      if(activeManagers.length<=1 && activeManagers.some(x=>x.id===id)){
        toast('Cannot demote — would leave the agency with zero managers. Promote someone else first.','e');
        return;
      }
    }catch(e){console.warn('Manager-count check failed:',e.message);}
  }
  if(!await confirmInPage(`Change role to ${newRole}?`)) return;
  try{
    await callChatterAdmin('update', { chatter_id: id, role: newRole });
    await loadTeamList();
    toast('Role updated', 's');
  }catch(e){ toast('Error: '+(e.message||e), 'e'); }
}

// v0.4.1.0: replaces ugly browser prompt() with a proper checkbox modal —
// matches the invite form's UI for consistency.
function editChatterModels(id, current){
  const arr = Array.isArray(current) ? current : [];
  const allModels = (typeof models !== 'undefined' ? models : []).map(m => m.name);
  // Build modal markup
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.style.display = 'flex';
  overlay.style.zIndex = '10001';
  overlay.onclick = (e)=>{ if(e.target===overlay) overlay.remove(); };
  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.style.cssText = 'background:var(--bg2);border:1px solid var(--border2);border-radius:var(--r2);padding:22px;width:480px;max-height:88vh;overflow-y:auto';
  modal.innerHTML = `
    <div class="m-title">Edit assigned models</div>
    <div style="font-size:11px;color:var(--text3);margin-bottom:12px;line-height:1.6">Check the models this chatter should have access to. Managers see all models regardless of assignment.</div>
    <div id="ecm_box" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px"></div>
    <div class="m-acts" style="display:flex;justify-content:flex-end;gap:8px">
      <button class="btn" id="ecm_cancel">Cancel</button>
      <button class="btn primary" id="ecm_save">Save</button>
    </div>
  `;
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  // Populate checkboxes
  const box = modal.querySelector('#ecm_box');
  box.innerHTML = allModels.map(name => {
    const checked = arr.includes(name) ? 'checked' : '';
    return `<label style="display:inline-flex;align-items:center;gap:5px;padding:6px 10px;background:rgba(255,255,255,0.04);border-radius:4px;font-size:11px;cursor:pointer">
      <input type="checkbox" value="${name}" ${checked} style="margin:0;cursor:pointer"> ${name}
    </label>`;
  }).join('');
  // Wire buttons
  modal.querySelector('#ecm_cancel').onclick = () => overlay.remove();
  modal.querySelector('#ecm_save').onclick = async () => {
    const picks = Array.from(box.querySelectorAll('input[type=checkbox]:checked')).map(c => c.value);
    overlay.remove();
    try{
      await callChatterAdmin('update', { chatter_id: id, models: picks });
      await loadTeamList();
      toast('Models updated', 's');
    }catch(e){ toast('Error: '+(e.message||e), 'e'); }
  };
}

async function rotateChatterToken(id, email){
  if(!await confirmInPage(`Rotate proxy token for ${email}? Old token will stop working immediately.`)) return;
  try{
    const res = await callChatterAdmin('rotate_token', { chatter_id: id });
    alert(`New proxy token for ${email}:\n\n${res.proxy_token}\n\nGive this to the chatter — the old one is now invalid.`);
    await loadTeamList();
  }catch(e){ toast('Error: '+(e.message||e), 'e'); }
}

async function deleteChatter(id, email){
  if(!await confirmInPage(`Permanently delete ${email}? This removes their auth account, sessions stay attributed.`)) return;
  try{
    await callChatterAdmin('delete', { chatter_id: id });
    await loadTeamList();
    toast('Chatter deleted', 's');
  }catch(e){ toast('Error: '+(e.message||e), 'e'); }
}

