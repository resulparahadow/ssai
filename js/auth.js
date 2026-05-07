// ═══════════════════════════════════════════════════════════════
// v0.4.0: AUTH BOOTSTRAP — invite-only, replaces direct init() call
// ═══════════════════════════════════════════════════════════════
window.currentChatter = null; // {id, email, full_name, role, proxy_token, assignments:[]}

const CHATTER_ADMIN_URL = SB_URL + '/functions/v1/chatter-admin';

function renderChatterBadge(){
  const c = window.currentChatter;
  if(!c) return;
  const nameEl = document.getElementById('chatterName');
  const roleEl = document.getElementById('chatterRoleBadge');
  if(nameEl) nameEl.textContent = c.full_name || c.email.split('@')[0];
  if(roleEl){
    roleEl.textContent = c.role;
    if(c.role === 'manager'){
      roleEl.style.background = 'rgba(168,85,247,0.15)';
      roleEl.style.color = '#c084fc';
    } else {
      roleEl.style.background = 'rgba(59,130,246,0.15)';
      roleEl.style.color = '#60a5fa';
    }
  }
  applyRoleGating();
}

// v0.4.1.0: centralised role gating. Manager-only UI is hidden for chatters.
// Called from renderChatterBadge (post-auth) and after any role change.
function applyRoleGating(){
  const c = window.currentChatter;
  const isManager = c && c.role === 'manager';
  // Top bar: API toggle + Settings button are manager-only
  const apiSw = document.getElementById('apiSwitcher');
  const settingsBtn = document.getElementById('settingsBtn');
  const settingsSep = document.getElementById('settingsSep');
  if(apiSw) apiSw.style.display = isManager ? 'flex' : 'none';
  if(settingsBtn) settingsBtn.style.display = isManager ? 'inline-flex' : 'none';
  if(settingsSep) settingsSep.style.display = isManager ? 'block' : 'none';
  // Manager-only dashboard widgets
  const chatterFilter = document.getElementById('dashChatterWrap');
  if(chatterFilter) chatterFilter.style.display = isManager ? 'inline-flex' : 'none';
  // v0.4.1.0: leaderboard is shown to BOTH roles. Chatters see it in anonymized rank-only
  // mode (their own row by name + everyone else as "Chatter #N"). Managers see full table.
  const leaderboard = document.getElementById('chatterLeaderboardWrap');
  if(leaderboard) leaderboard.style.display = 'block';
  // CSV export is manager-only — chatters shouldn't be able to download the full table.
  const exportBtn = document.getElementById('leaderboardExportBtn');
  if(exportBtn) exportBtn.style.display = isManager ? 'inline-flex' : 'none';
  // v0.4.1.0: chatters don't see Active API card or $/msg cost card.
  // Re-flow the top stat row from 5 cols to 3 when those are hidden.
  const apiCard = document.getElementById('sApiCard');
  const costCard = document.getElementById('sApiCostCard');
  const topRow = document.getElementById('topStatsRow');
  if(apiCard) apiCard.style.display = isManager ? 'block' : 'none';
  if(costCard) costCard.style.display = isManager ? 'block' : 'none';
  if(topRow) topRow.style.gridTemplateColumns = isManager ? 'repeat(5,1fr)' : 'repeat(3,1fr)';
}

function showLogin(errMsg){
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('authOverlay').style.display = 'flex';
  const errEl = document.getElementById('authError');
  if(errMsg){
    errEl.textContent = errMsg;
    errEl.style.display = 'block';
  } else {
    errEl.style.display = 'none';
  }
}

function hideLogin(){
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';
}

async function loadCurrentChatterContext(){
  // Loads chatter row + assignments after a successful auth.
  const { data: { user } } = await sb.auth.getUser();
  if(!user) return null;
  const { data: chatter, error: chErr } = await sb.from('chatters').select('*').eq('id', user.id).maybeSingle();
  if(chErr || !chatter){
    console.warn('chatter row missing or RLS-blocked', chErr);
    return null;
  }
  if(!chatter.is_active){
    return { _disabled: true };
  }
  // Auto-provision proxy token from the authoritative chatters row.
  // Eliminates manual paste — every login refreshes localStorage from the DB,
  // so manager-side token rotations are picked up automatically. RLS must
  // allow a chatter to read their own row including proxy_token.
  if(chatter.proxy_token){
    localStorage.setItem('ss_proxy_token', chatter.proxy_token);
  }
  const { data: assignments } = await sb.from('model_assignments').select('creator_model').eq('chatter_id', user.id);
  chatter.assignments = (assignments || []).map(a => a.creator_model);
  return chatter;
}

// v0.4.0: auto-inject chatter_id on inserts to user-attributable tables.
// Wraps sb.from(table).insert(payload) so any existing code that doesn't
// know about chatter_id still produces correctly-attributed rows.
function installChatterIdAutoInject(){
  if(!sb || sb._chatterIdPatched) return;
  const tables = ['aich_sessions','aich_messages','aich_vn_used','aich_events'];
  const origFrom = sb.from.bind(sb);
  sb.from = function(name){
    const builder = origFrom(name);
    if(!tables.includes(name)) return builder;
    const origInsert = builder.insert?.bind(builder);
    if(origInsert){
      builder.insert = function(payload, opts){
        const cid = window.currentChatter?.id || null;
        if(cid){
          if(Array.isArray(payload)){
            payload = payload.map(r => ({chatter_id:cid, ...r}));
          } else if(payload && typeof payload === 'object' && payload.chatter_id === undefined){
            payload = {chatter_id:cid, ...payload};
          }
        }
        return origInsert(payload, opts);
      };
    }
    return builder;
  };
  sb._chatterIdPatched = true;
}

async function doLogin(){
  const btn = document.getElementById('authBtn');
  const email = document.getElementById('authEmail').value.trim();
  const password = document.getElementById('authPassword').value;
  if(!email || !password){
    showLogin('Email and password required');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Signing in...';
  try {
    if(!window.sb){
      await getOrCreateSb();
    }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if(error){
      showLogin(error.message || 'Sign in failed');
      btn.disabled = false;
      btn.textContent = 'Sign in';
      return;
    }
    // Load chatter context
    const chatter = await loadCurrentChatterContext();
    if(!chatter){
      showLogin('Account not provisioned. Contact your manager.');
      await sb.auth.signOut();
      btn.disabled = false;
      btn.textContent = 'Sign in';
      return;
    }
    if(chatter._disabled){
      showLogin('Your account has been disabled. Contact your manager.');
      await sb.auth.signOut();
      btn.disabled = false;
      btn.textContent = 'Sign in';
      return;
    }
    // v0.4.1.1: force password change on first login after invite.
    // Manager creates accounts with a temp password. The chatters row has
    // must_change_password=true by default; the chatter must set their own
    // password before they can use the app.
    if(chatter.must_change_password){
      window._pendingChatter = chatter;
      document.getElementById('authPassword').value = '';
      btn.disabled = false;
      btn.textContent = 'Sign in';
      showPasswordChange();
      return;
    }
    window.currentChatter = chatter;
    installChatterIdAutoInject();
    hideLogin();
    renderChatterBadge();
    document.getElementById('authPassword').value = '';
    await init();
  } catch(e){
    showLogin('Unexpected error: ' + (e?.message || e));
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

async function doLogout(){
  try { await sb.auth.signOut(); } catch(_){}
  window.currentChatter = null;
  // Reload to fully reset app state — simplest and safest
  location.reload();
}

// Allow Enter key in password field to submit
document.addEventListener('DOMContentLoaded', () => {
  const pw = document.getElementById('authPassword');
  const em = document.getElementById('authEmail');
  if(pw) pw.addEventListener('keydown', e => { if(e.key==='Enter') doLogin(); });
  if(em) em.addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); pw?.focus(); } });
});

// Bootstrap: check existing session, otherwise show login
(async () => {
  try {
    await getOrCreateSb();
    const { data: { session } } = await sb.auth.getSession();
    if(session){
      const chatter = await loadCurrentChatterContext();
      if(chatter && !chatter._disabled){
        // v0.4.1.1: even on session-restore, force password change if flag still set
        if(chatter.must_change_password){
          window._pendingChatter = chatter;
          showPasswordChange();
          return;
        }
        window.currentChatter = chatter;
        installChatterIdAutoInject();
        hideLogin();
        renderChatterBadge();
        await init();
        return;
      }
      // Stale or disabled session — clear it
      await sb.auth.signOut();
    }
  } catch(e){
    console.warn('Auth bootstrap failed:', e);
  }
  showLogin();
})();

// v0.4.1.1: PASSWORD CHANGE FLOW
function showPasswordChange(){
  document.getElementById('authOverlay').style.display = 'none';
  document.getElementById('appShell').style.display = 'none';
  document.getElementById('pwChangeOverlay').style.display = 'flex';
  document.getElementById('pwError').style.display = 'none';
  document.getElementById('pwNew').value = '';
  document.getElementById('pwConfirm').value = '';
  setTimeout(()=>document.getElementById('pwNew').focus(), 100);
}

function showPwError(msg){
  const el = document.getElementById('pwError');
  el.textContent = msg;
  el.style.display = 'block';
}

async function savePasswordChange(){
  const btn = document.getElementById('pwSaveBtn');
  const newPw = document.getElementById('pwNew').value;
  const confirm = document.getElementById('pwConfirm').value;
  if(!newPw || newPw.length < 8){
    showPwError('Password must be at least 8 characters');
    return;
  }
  if(newPw !== confirm){
    showPwError('Passwords do not match');
    return;
  }
  btn.disabled = true;
  btn.textContent = 'Saving...';
  try {
    // Update Supabase auth password
    const { error: pwErr } = await sb.auth.updateUser({ password: newPw });
    if(pwErr){
      showPwError(pwErr.message || 'Failed to update password');
      btn.disabled = false;
      btn.textContent = 'Save & continue';
      return;
    }
    // Flip must_change_password to false on the chatters row
    const pending = window._pendingChatter;
    if(!pending || !pending.id){
      showPwError('Session lost — please reload and sign in again');
      return;
    }
    const { error: rowErr } = await sb.from('chatters').update({ must_change_password: false }).eq('id', pending.id);
    if(rowErr){
      // Password DID save but flag didn't flip — they'd be prompted again next login.
      // Surface the error but proceed; flag check is non-blocking after this point.
      console.warn('must_change_password flip failed:', rowErr.message);
    }
    // Continue into the app
    pending.must_change_password = false;
    window.currentChatter = pending;
    window._pendingChatter = null;
    installChatterIdAutoInject();
    document.getElementById('pwChangeOverlay').style.display = 'none';
    hideLogin();
    renderChatterBadge();
    await init();
  } catch(e){
    showPwError('Unexpected error: ' + (e?.message || e));
    btn.disabled = false;
    btn.textContent = 'Save & continue';
  }
}

// Allow Enter in password fields to submit
document.addEventListener('DOMContentLoaded', () => {
  const pw1 = document.getElementById('pwNew');
  const pw2 = document.getElementById('pwConfirm');
  if(pw1) pw1.addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); pw2?.focus(); } });
  if(pw2) pw2.addEventListener('keydown', e => { if(e.key==='Enter'){ e.preventDefault(); savePasswordChange(); } });
});
