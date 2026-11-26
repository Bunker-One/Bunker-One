/* Contract Register: connection to Supabase (login, database, files, users).
   The page talks to this file through window.claude.use(...); nothing here needs editing.
   Your Supabase address and public key go in config.js. */
(() => {
  const cfg = { ...(window.APP_CONFIG || {}) };
  // Accept a URL pasted with extra parts (e.g. .../rest/v1/): keep only https://xxxx.supabase.co
  try { if (cfg.supabaseUrl) cfg.supabaseUrl = new URL(String(cfg.supabaseUrl).trim()).origin; } catch (_) {}
  if (cfg.supabaseAnonKey) cfg.supabaseAnonKey = String(cfg.supabaseAnonKey).trim();
  const linkType = (/type=(invite|recovery|signup|magiclink)/.exec(location.hash) || [])[1] || null;
  const configured = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && !/YOUR-/.test(cfg.supabaseUrl + cfg.supabaseAnonKey));
  const sb = configured && window.supabase ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey) : null;
  window.__sb = sb;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  let session = null, profile = null, resolveAuth;
  const authed = new Promise(r => (resolveAuth = r));

  /* ---------- sign-in screen ---------- */
  const wrap = document.createElement('div');
  wrap.id = 'auth';
  wrap.innerHTML = '<div class="authbox"><div class="logos"><img src="img/logo-bunker-one.png" alt="Bunker One" class="lg-b"><img src="img/logo-nova-offshore.png" alt="NOVA Offshore" class="lg-n"></div><h1>Contract Register</h1><div id="authBody"><p class="muted">Loading…</p></div></div>';
  document.body.prepend(wrap);
  document.body.classList.add('locked');
  const body = () => document.getElementById('authBody');
  const msg = (t, bad) => { const m = document.getElementById('authMsg'); if (m) { m.textContent = t; m.className = bad ? 'authmsg bad' : 'authmsg'; } };

  function screen(mode, note) {
    const b = body();
    if (mode === 'setup') {
      b.innerHTML = '<p>This copy is not connected to a database yet.</p><p class="muted">Fill in <b>config.js</b> with your Supabase project URL and anon public key, as described in the setup guide (README).</p>';
      return;
    }
    if (mode === 'noaccess') {
      b.innerHTML = `<p>You are signed in as <b>${esc(session?.user?.email)}</b>, but your access has not been set up yet.</p><p class="muted">Ask the administrator to check that the database setup was run.</p>${note ? `<p class="muted small">Details: ${esc(note)}</p>` : ''}<button class="btn" type="button" id="authOut">Sign out</button>`;
      document.getElementById('authOut').onclick = () => sb.auth.signOut().then(() => location.reload());
      return;
    }
    if (mode === 'setpw') {
      b.innerHTML = `<p>${linkType === 'invite' ? 'Welcome! Choose a password to finish setting up your access.' : 'Choose a new password.'}</p>
      <form id="authForm" class="authform"><label>New password<input type="password" id="pw1" autocomplete="new-password" minlength="8" required></label>
      <label>Repeat password<input type="password" id="pw2" autocomplete="new-password" minlength="8" required></label>
      <button class="btn primary" type="submit">Save password</button><p id="authMsg" class="authmsg"></p></form>`;
      document.getElementById('authForm').onsubmit = async e => {
        e.preventDefault();
        const p1 = document.getElementById('pw1').value, p2 = document.getElementById('pw2').value;
        if (p1.length < 8) return msg('Use at least 8 characters.', true);
        if (p1 !== p2) return msg('The two passwords are different.', true);
        msg('Saving…');
        const { error } = await sb.auth.updateUser({ password: p1 });
        if (error) return msg(error.message, true);
        history.replaceState(null, '', location.pathname);
        enter();
      };
      return;
    }
    if (mode === 'forgot') {
      b.innerHTML = `<p>Type your email and we will send you a link to choose a new password.</p>
      <form id="authForm" class="authform"><label>Email<input type="email" id="em" autocomplete="email" required></label>
      <button class="btn primary" type="submit">Send link</button><button class="link" type="button" id="toLogin">Back to sign in</button><p id="authMsg" class="authmsg"></p></form>`;
      document.getElementById('toLogin').onclick = () => screen('login');
      document.getElementById('authForm').onsubmit = async e => {
        e.preventDefault();
        msg('Sending…');
        const { error } = await sb.auth.resetPasswordForEmail(document.getElementById('em').value.trim(), { redirectTo: location.origin + location.pathname });
        msg(error ? error.message : 'If this email has access, a link is on its way. Check your inbox.', !!error);
      };
      return;
    }
    b.innerHTML = `${note ? `<p class="authmsg">${esc(note)}</p>` : ''}<form id="authForm" class="authform">
      <label>Email<input type="email" id="em" autocomplete="email" required></label>
      <label>Password<input type="password" id="pw" autocomplete="current-password" required></label>
      <button class="btn primary" type="submit">Sign in</button><button class="link" type="button" id="toForgot">Forgot your password?</button>
      <p id="authMsg" class="authmsg"></p></form><p class="muted small">Access is by invitation from the administrator.</p>`;
    document.getElementById('toForgot').onclick = () => screen('forgot');
    document.getElementById('authForm').onsubmit = async e => {
      e.preventDefault();
      msg('Signing in…');
      const { data, error } = await sb.auth.signInWithPassword({ email: document.getElementById('em').value.trim(), password: document.getElementById('pw').value });
      if (error) return msg(/invalid login credentials/i.test(error.message) ? 'Email or password is not correct.' : /not confirmed/i.test(error.message) ? 'This email has not been confirmed yet. Ask the administrator to confirm it in Supabase.' : 'Could not sign in: ' + error.message + ' (server: ' + (cfg.supabaseUrl || 'not set') + ')', true);
      session = data.session;
      enter();
    };
  }

  async function enter() {
    const { data: s } = await sb.auth.getSession();
    session = s.session;
    if (!session) return screen('login');
    const { data, error } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    if (error || !data) return screen('noaccess', error ? error.message : 'No profile found for this login.');
    profile = data;
    wrap.remove();
    document.body.classList.remove('locked');
    userBar();
    resolveAuth();
  }

  async function init() {
    if (!sb) return screen('setup');
    sb.auth.onAuthStateChange(ev => { if (ev === 'PASSWORD_RECOVERY') screen('setpw'); if (ev === 'SIGNED_OUT') location.reload(); });
    const { data } = await sb.auth.getSession();
    session = data.session;
    if (session && (linkType === 'invite' || linkType === 'recovery')) return screen('setpw');
    if (session) return enter();
    screen('login', /error_description=([^&]+)/.test(location.hash) ? decodeURIComponent(RegExp.$1.replace(/\+/g, ' ')) : '');
  }

  /* ---------- header: who is signed in, users, sign out ---------- */
  function userBar() {
    const actions = document.querySelector('.head .actions');
    if (!actions) return;
    const who = document.createElement('div');
    who.className = 'who';
    who.innerHTML = `<span class="muted small">${esc(profile.full_name || session.user.email)}</span>${profile.role === 'admin' ? '<button class="btn" type="button" id="usersBtn">Users</button>' : ''}<button class="btn" type="button" id="outBtn">Sign out</button>`;
    actions.prepend(who);
    document.getElementById('outBtn').onclick = () => sb.auth.signOut();
    const ub = document.getElementById('usersBtn');
    if (ub) ub.onclick = usersDialog;
  }

  async function usersDialog() {
    let d = document.getElementById('usersDlg');
    if (!d) { d = document.createElement('dialog'); d.id = 'usersDlg'; document.body.append(d); }
    d.innerHTML = '<p class="muted">Loading…</p>';
    d.showModal();
    const { data, error } = await sb.from('profiles').select('*').order('created_at');
    if (error) { d.innerHTML = `<p>${esc(error.message)}</p><div class="dbtn"><button class="btn" type="button" onclick="this.closest('dialog').close()">Close</button></div>`; return; }
    const roles = [['admin', 'Administrator'], ['editor', 'Editor: adds and edits contracts'], ['viewer', 'Viewer: read only']];
    d.innerHTML = `<h2>Users</h2>
      <p class="hint" style="font-size:15px">To add someone, invite them by email in Supabase (Authentication, Users, Invite user). They appear here as Viewer once they accept; then choose their role.</p>
      <div class="scroll"><table><thead><tr><th>Email</th><th>Name</th><th>Role</th></tr></thead><tbody>
      ${data.map(p => `<tr data-id="${esc(p.id)}"><td>${esc(p.email)}</td><td><input class="u-name" value="${esc(p.full_name)}" maxlength="80" aria-label="Name"></td><td><select class="u-role" aria-label="Role">${roles.map(([k, l]) => `<option value="${k}"${p.role === k ? ' selected' : ''}>${l}</option>`).join('')}</select></td></tr>`).join('')}
      </tbody></table></div><p id="uMsg" class="authmsg"></p>
      <div class="dbtn"><button class="btn" type="button" id="uClose">Close</button><button class="btn primary" type="button" id="uSave">Save changes</button></div>`;
    d.querySelector('#uClose').onclick = () => d.close();
    d.querySelector('#uSave').onclick = async () => {
      const m = d.querySelector('#uMsg');
      m.textContent = 'Saving…'; m.className = 'authmsg';
      const rows = [...d.querySelectorAll('tbody tr')];
      // promote first, demote last, so there is always an administrator
      rows.sort((a, b) => (b.querySelector('.u-role').value === 'admin') - (a.querySelector('.u-role').value === 'admin'));
      for (const r of rows) {
        const id = r.dataset.id, orig = data.find(p => p.id === id);
        const full_name = r.querySelector('.u-name').value.trim(), role = r.querySelector('.u-role').value;
        if (orig.full_name === full_name && orig.role === role) continue;
        const { error: e } = await sb.from('profiles').update({ full_name, role }).eq('id', id);
        if (e) { m.textContent = /administrator/i.test(e.message) ? 'At least one administrator is required.' : e.message; m.className = 'authmsg bad'; return; }
      }
      m.textContent = 'Saved. People see their new access the next time they open the page.';
    };
  }

  /* ---------- database (same shape the page expects) ---------- */
  const toErr = e => ({ code: e?.code === '42501' || /row-level security|permission|not allowed/i.test(e?.message || '') ? 'invalid_argument' : 'unavailable', message: e?.message || 'Error' });
  const meta = { fromCache: false, hasPendingWrites: false };
  const listeners = new Set(), settingsListeners = new Map();
  let loadedOnce = false, timer = null, channel = null;

  async function fetchAll() {
    const all = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from('contracts').select('id,doc').order('id').range(from, from + 999);
      if (error) throw error;
      all.push(...data);
      if (data.length < 1000) break;
    }
    return all;
  }
  function refresh() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      try {
        const rows = await fetchAll();
        const docs = rows.map(r => ({ id: r.id, exists: true, data: () => r.doc, metadata: meta }));
        const snap = { docs, size: docs.length, empty: !docs.length, metadata: meta, docChanges: () => [] };
        loadedOnce = true;
        listeners.forEach(l => l.next(snap));
      } catch (e) {
        if (!loadedOnce) listeners.forEach(l => l.error && l.error(toErr(e)));
      }
    }, 120);
  }
  async function refreshSetting(key) {
    const { data } = await sb.from('settings').select('value').eq('key', key).maybeSingle();
    (settingsListeners.get(key) || []).forEach(fn => fn({ id: key, exists: !!data, data: () => data?.value, metadata: meta }));
  }
  function live() {
    if (channel) return;
    channel = sb.channel('register')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'contracts' }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settings' }, p => refreshSetting(p.new?.key || p.old?.key))
      .subscribe();
    window.addEventListener('focus', refresh);
    setInterval(refresh, 120000);
  }
  function contractRef(id) {
    return {
      id, path: 'contracts/' + id,
      async set(doc) { const { error } = await sb.from('contracts').upsert({ id, doc }); if (error) throw toErr(error); refresh(); },
      async delete() {
        const { data, error } = await sb.from('contracts').delete().eq('id', id).select('id');
        if (error) throw toErr(error);
        if (!data || !data.length) throw { code: 'invalid_argument', message: 'Not allowed' };
        refresh();
      }
    };
  }
  function settingRef(key) {
    return {
      id: key, path: 'settings/' + key,
      async set(value) { const { error } = await sb.from('settings').upsert({ key, value, updated_at: new Date().toISOString() }); if (error) throw toErr(error); refreshSetting(key); },
      onSnapshot(next) {
        if (!settingsListeners.has(key)) settingsListeners.set(key, new Set());
        settingsListeners.get(key).add(next); live(); refreshSetting(key);
        return () => settingsListeners.get(key).delete(next);
      }
    };
  }
  const db = {
    collection(path) {
      if (path !== 'contracts') throw new TypeError('Unknown collection ' + path);
      return {
        path,
        doc: id => contractRef(id || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2))),
        onSnapshot(next, error) { const l = { next, error }; listeners.add(l); live(); refresh(); return () => listeners.delete(l); }
      };
    },
    doc(path) {
      const [col, id] = path.split('/');
      if (col === 'contracts') return contractRef(id);
      if (col === 'settings') return settingRef(id);
      throw new TypeError('Unknown document ' + path);
    }
  };

  const user = {
    id: async () => session.user.id,
    can: async () => ['admin', 'editor'].includes(profile.role),
    canEdit: async () => profile.role === 'admin',
    isOwner: async () => profile.role === 'admin',
    me: async () => ({ id: session.user.id, name: profile.full_name || session.user.email }),
    async profiles(ids) {
      const { data } = await sb.from('profiles').select('id,full_name,email').in('id', ids);
      return Object.fromEntries((data || []).map(p => [p.id, { id: p.id, name: p.full_name || p.email }]));
    }
  };

  const assets = {
    async upload(file) {
      const path = (crypto.randomUUID ? crypto.randomUUID() : Date.now()) + '/' + file.name.replace(/[^\w.\-]+/g, '_');
      const { error } = await sb.storage.from('documents').upload(path, file, { contentType: file.type || undefined });
      if (error) throw { code: 'unavailable', message: error.message };
      return { id: path, url: '', sizeBytes: file.size, contentType: file.type };
    }
  };
  window.openDocument = async (path, download) => {
    const w = download ? null : window.open('', '_blank');
    const name = path.split('/').pop();
    const { data, error } = await sb.storage.from('documents').createSignedUrl(path, 600, download ? { download: name } : undefined);
    if (download && !error) { const a = document.createElement('a'); a.href = data.signedUrl; a.download = name; document.body.append(a); a.click(); a.remove(); return; }
    if (error) { if (w) w.close(); alert('The file could not be opened: ' + error.message); return; }
    if (w) w.location = data.signedUrl; else location.href = data.signedUrl;
  };

  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data], { type: /\.csv$/i.test(filename) ? 'text/csv;charset=utf-8' : 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return { status: 'saved' };
    }
  };

  window.claude = {
    async use(name) {
      if (!sb) return null;
      await authed;
      if (name === 'db') return db;
      if (name === 'user') return user;
      if (name === 'assets') return ['admin', 'editor'].includes(profile.role) ? assets : null;
      if (name === 'downloads') return downloads;
      return null;
    }
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
