/* Broker Desk boot: sign in (or set a password from an invite link), load /api/me, draw the
 * sidebar, start the background checks (inbox count, ringing calls, new texts), then hand over to
 * the router. */
(function () {
  'use strict';
  var BD = window.BD, esc = BD.esc, ICON = BD.ICON;

  // ---------- sign in ----------
  // The password never leaves the browser: it is stretched with PBKDF2 (salted with the email) and
  // only the result is sent, like ISO Desk.
  function deriveKey(email, pw) {
    var te = new TextEncoder();
    return crypto.subtle.importKey('raw', te.encode(pw), 'PBKDF2', false, ['deriveBits'])
      .then(function (k) { return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('brokerdesk:v1:' + email.trim().toLowerCase()), iterations: 200000 }, k, 256); })
      .then(function (bits) { var b = new Uint8Array(bits), s = ''; for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); });
  }
  BD.deriveKey = deriveKey;
  var AUTH = { mode: 'login', busy: false, err: '' };
  function renderAuth() {
    document.body.classList.add('signed-out');
    document.getElementById('side').innerHTML = '';
    var a = AUTH, busy = a.busy ? ' disabled' : '';
    var brand = '<div class="auth-brand">' + logo('BD') + '<span>Broker Desk</span></div>';
    var body = a.mode === 'invite'
      ? '<h1>Set your password</h1><p>' + esc(a.name ? 'Welcome, ' + BD.first(a.name) + '. ' : '') + 'Pick a password for ' + esc(a.email || 'your login') + '.</p>' +
        '<form class="auth-form" data-form="accept"><label class="field"><span>Password</span><input name="pw" type="password" autocomplete="new-password" minlength="8" required></label>' +
        '<label class="field"><span>Type it again</span><input name="pw2" type="password" autocomplete="new-password" required></label>' + (a.err ? '<p class="err">' + esc(a.err) + '</p>' : '') +
        '<button class="btn primary big" type="submit"' + busy + '>' + (a.busy ? 'Setting it up...' : 'Set password and sign in') + '</button></form>'
      : (a.guest ? '<h1>See the demo</h1><p>Made-up leads and deals for ' + esc(a.guest) + '. Calls and texts are simulated, so try anything.</p>' +
          '<button class="btn primary big auth-guest" type="button" data-act="guest-in"' + busy + '>' + (a.busy ? 'Opening...' : 'Open the demo') + '</button><div class="auth-or"><span>or sign in</span></div>'
        : '<h1>Sign in</h1><p>Your leads, calls, texts and deals.</p>') + '<form class="auth-form" data-form="login"><label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>' +
        '<label class="field"><span>Password</span><input name="pw" type="password" autocomplete="current-password" required></label>' + (a.err ? '<p class="err">' + esc(a.err) + '</p>' : '') +
        '<button class="btn ' + (a.guest ? '' : 'primary ') + 'big" type="submit"' + busy + '>' + (a.busy && !a.guest ? 'Signing in...' : 'Sign in') + '</button></form><p class="auth-help muted">Forgot it? Ask your manager for a reset link.</p>';
    document.getElementById('main').innerHTML = '<div class="auth"><div class="auth-card">' + brand + body + '</div></div>';
    var dr = document.getElementById('demo-root'); if (dr) dr.innerHTML = '';
    if (a.mode === 'login' && a.guest === undefined) { a.guest = null; BD.api('/api/auth/guest', { auth: true }).then(function (r) { if (r.available && AUTH === a) { a.guest = r.name; renderAuth(); } }, function () {}); }
    var f = document.querySelector('.auth-form'); f.addEventListener('submit', submitAuth);
    var first = f.querySelector('input'); if (first && !a.guest) first.focus();
  }
  function submitAuth(e) {
    e.preventDefault();
    var f = BD.formData(e.target);
    if (AUTH.mode === 'invite') {
      if ((f.pw || '').length < 8) { AUTH.err = 'Use at least 8 characters.'; return renderAuth(); }
      if (f.pw !== f.pw2) { AUTH.err = 'The two passwords do not match.'; return renderAuth(); }
      AUTH.busy = true; AUTH.err = ''; renderAuth();
      deriveKey(AUTH.email, f.pw).then(function (key) { return BD.api('/api/auth/accept', { body: { token: AUTH.token, key: key }, auth: true }); })
        .then(function () { history.replaceState(null, '', location.pathname + '#/inbox'); boot(); }, function (err) { AUTH.busy = false; AUTH.err = err.message; renderAuth(); });
      return;
    }
    var email = String(f.email || '').trim().toLowerCase();
    if (!email || !f.pw) { AUTH.err = 'Enter your email and password.'; return renderAuth(); }
    AUTH.busy = true; AUTH.err = ''; renderAuth();
    deriveKey(email, f.pw).then(function (key) { return BD.api('/api/auth/login', { body: { email: email, key: key }, auth: true }); })
      .then(function () { boot(); }, function (err) { AUTH.busy = false; AUTH.err = err.message; renderAuth(); });
  }
  BD.signedOut = function () { BD.state.me = null; BD.stopPolls(); var m = /invite=([\w-]+)/.exec(location.hash); if (m) return startInvite(m[1]); AUTH = { mode: 'login' }; if (location.hash === '#demo') return guestIn(); renderAuth(); };
  // The demo's guest login: one click, no password. Also what a link to /#demo does.
  function guestIn() {
    AUTH.busy = true; AUTH.err = ''; renderAuth();
    BD.api('/api/auth/guest', { body: {}, auth: true }).then(function () { history.replaceState(null, '', location.pathname + '#/inbox'); boot(); },
      function (err) { AUTH.busy = false; AUTH.err = err.message; renderAuth(); });
  }
  BD.on('guest-in', guestIn);
  // An invite link pasted into a tab that already has the desk open only changes the hash.
  window.addEventListener('hashchange', function () { var m = /invite=([\w-]+)/.exec(location.hash); if (m && !BD.state.me) startInvite(m[1]); });
  function startInvite(token) {
    AUTH = { mode: 'invite', token: token, busy: true };
    BD.api('/api/auth/accept', { body: { token: token, peek: true }, auth: true }).then(function (r) { AUTH.busy = false; AUTH.email = r.email; AUTH.name = r.name; renderAuth(); },
      function (err) { AUTH = { mode: 'login', err: err.message }; renderAuth(); });
  }

  // ---------- sidebar ----------
  function logo(text, color) { return '<span class="logo" style="background:' + esc(color || 'var(--accent)') + '">' + esc(text) + '</span>'; }
  var NAV = [['inbox', 'Inbox', 'inbox'], ['leads', 'Leads', 'leads'], ['deals', 'Deals', 'deals'], ['lenders', 'Lenders', 'lenders'], ['sequences', 'Sequences', 'seq'], ['dash', 'Dashboard', 'dash']];
  var listCounts = {};
  BD.renderNav = function () {
    var st = BD.state.me; if (!st) return;
    var r = BD.route, brand = st.ws.brand || {}, name = brand.logoText || st.ws.name || 'Broker Desk';
    var pinned = (st.mine.pinned || []).map(function (id) { return BD.lists().filter(function (l) { return l.id === id; })[0]; }).filter(Boolean);
    var curList = r.name === 'leads' ? r.query.list || '' : null;
    var phone = st.phone, line = phone.mine;
    var html = '<div class="side-top"><button class="ws" data-act="go" data-v="#/inbox">' + logo(BD.initials(name), brand.color) + '<span class="trunc">' + esc(name) + '</span></button></div>' +
      '<div class="side-search">' + ICON.search + '<input id="q" type="search" placeholder="Search leads" autocomplete="off" data-input="search" aria-label="Search leads"><kbd>/</kbd></div>' +
      '<nav class="side-nav">' + NAV.map(function (n) {
        var on = r.name === n[0] || (n[0] === 'leads' && r.name === 'lead') || (n[0] === 'deals' && r.name === 'deal') || (n[0] === 'leads' && r.name === 'dialer');
        var badge = n[0] === 'inbox' && st.inbox ? '<span class="badge hot">' + (st.inbox > 99 ? '99+' : st.inbox) + '</span>' : '';
        return '<a href="#/' + n[0] + '" class="' + (on && !(n[0] === 'leads' && curList) ? 'on' : '') + '">' + ICON[n[2]] + '<span>' + n[1] + '</span>' + badge + '</a>';
      }).join('') + '</nav>' +
      '<div class="side-h"><span>Lists</span><button class="ib sm" data-act="lists-manage" data-tip="Pin or unpin lists" aria-label="Manage lists">' + ICON.dots + '</button></div>' +
      '<nav class="side-lists">' + pinned.map(function (l) {
        return '<a href="#/leads?list=' + esc(l.id) + '" class="' + (curList === l.id ? 'on' : '') + '">' + ICON.list + '<span class="trunc">' + esc(l.name) + '</span><span class="n">' + (listCounts[l.id] != null ? BD.num(listCounts[l.id]) : '') + '</span></a>';
      }).join('') + (pinned.length ? '' : '<p class="muted side-empty">Pin a saved list to see it here.</p>') + '</nav>' +
      '<div class="side-foot">' +
        '<button class="line" data-act="go" data-v="#/settings/phone">' + '<span class="dot ' + (line ? 'on' : '') + '"></span><span class="trunc">' + (line ? BD.fmtPhone(line.e164) : 'No phone number yet') + '</span>' + (phone.provider === 'sim' ? '<span class="pill">Demo line</span>' : '') + '</button>' +
        '<a href="#/settings" class="' + (r.name === 'settings' ? 'on' : '') + '">' + ICON.settings + '<span>Settings</span></a>' +
        '<button class="me" data-act="me-menu">' + '<span class="av">' + esc(BD.initials(st.user.name)) + '</span><span class="trunc">' + esc(st.user.name) + '</span>' + ICON.down + '</button>' +
      '</div>';
    document.getElementById('side').innerHTML = html;
    if (BD.renderDemoBar) BD.renderDemoBar();
    var q = document.getElementById('q'); if (q && searchState.q) q.value = searchState.q;
  };
  BD.loadListCounts = function () {
    var st = BD.state.me; if (!st) return;
    BD.api('/api/leads?listCounts=' + encodeURIComponent(JSON.stringify(st.mine.pinned || []))).then(function (r) { listCounts = r.counts || {}; BD.renderNav(); }, function () {});
  };
  BD.on('me-menu', function (el) {
    var st = BD.state.me, items = [{ head: st.user.guest ? 'Demo login' : st.user.email }];
    if (st.settings.demo) items.push({ v: 'feedback', label: 'Send feedback' }, { v: 'reset', label: 'Reload demo data' });
    if (!st.user.guest) items.push({ v: 'password', label: 'Change password' });
    items.push({ v: 'logout', label: 'Sign out' });
    BD.menu(el, items, function (v) {
      if ((v === 'feedback' || v === 'reset') && BD.acts['demo-' + v]) BD.acts['demo-' + v]();
      if (v === 'logout') BD.api('/api/auth/logout', { body: {} }).then(function () { location.hash = ''; BD.signedOut(); });
      if (v === 'password') BD.go('#/settings/account');
    });
  });
  BD.on('lists-manage', function (el) {
    var st = BD.state.me, pinned = st.mine.pinned || [];
    BD.pop(el, '<div class="head">Pinned lists</div>' + BD.lists().map(function (l) {
      return '<label><input type="checkbox" data-change="pin-list" value="' + esc(l.id) + '"' + (pinned.indexOf(l.id) >= 0 ? ' checked' : '') + '><span>' + esc(l.name) + '</span></label>';
    }).join('') + '<div class="sep"></div><button class="opt" data-act="go" data-v="#/leads"><span>Make a new list from Leads</span></button>');
  });
  BD.on('pin-list', function (el) {
    var st = BD.state.me, p = (st.mine.pinned || []).filter(function (x) { return x !== el.value; });
    if (el.checked) p.push(el.value);
    BD.saveMine({ pinned: p }).then(BD.loadListCounts);
  });
  BD.saveMine = function (patch) { return BD.api('/api/settings', { body: { key: 'mine', data: patch } }).then(function (r) { BD.state.me.mine = r.mine; BD.renderNav(); return r.mine; }, BD.fail); };

  // ---------- global search ----------
  var searchState = { q: '', seq: 0 };
  BD.on('search', BD.debounce(function (el) {
    var q = el.value.trim(); searchState.q = q;
    if (q.length < 2) { BD.closePop(); return; }
    var n = ++searchState.seq;
    BD.api('/api/leads?limit=8&f=' + encodeURIComponent(JSON.stringify({ q: q }))).then(function (r) {
      if (n !== searchState.seq || document.activeElement !== el) return;
      BD.pop(el, (r.leads.length ? r.leads.map(function (l) {
        return '<button class="opt" data-act="search-open" data-v="' + esc(l.id) + '"><span class="trunc"><b>' + esc(l.name) + '</b> <span class="muted">' + esc(l.contactName || '') + '</span></span><span class="muted">' + esc(l.phone || l.city || '') + '</span></button>';
      }).join('') : '<div class="head">No leads match "' + esc(q) + '"</div>') + (r.total > 8 ? '<div class="sep"></div><button class="opt" data-act="search-all"><span>See all ' + BD.num(r.total) + ' matches</span></button>' : ''), { wide: true, noFocus: true });
    }, function () {});
  }, 220));
  // Opening a result clears the box, so the next search starts fresh.
  BD.on('search-open', function (el) { var q = document.getElementById('q'); searchState.q = ''; BD.closePop(); if (q) { q.value = ''; q.blur(); } BD.go('#/lead/' + el.getAttribute('data-v')); });
  BD.on('search-all', function () { BD.go('#/leads?q=' + encodeURIComponent(searchState.q)); });
  document.addEventListener('keydown', function (e) {
    if (e.target.id === 'q' && e.key === 'Enter') { BD.closePop(); BD.go('#/leads?q=' + encodeURIComponent(e.target.value.trim())); e.target.blur(); }
  });

  // ---------- background checks ----------
  var timers = [];
  BD.stopPolls = function () { timers.forEach(clearInterval); timers = []; };
  BD.refreshInboxCount = function () {
    return BD.api('/api/inbox?count=1').then(function (r) { if (!BD.state.me) return; var changed = r.count !== BD.state.me.inbox; BD.state.me.inbox = r.count; if (changed) BD.renderNav(); return r.count; }, function () {});
  };
  BD.reloadMe = function () { return BD.api('/api/me').then(function (st) { BD.state.me = st; BD.renderNav(); return st; }); };
  function boot() {
    BD.api('/api/me').then(function (st) {
      BD.state.me = st;
      document.body.classList.remove('signed-out');
      window.__BD_READY = true;
      if (!location.hash || /invite=/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/inbox');
      BD.render();
      BD.loadListCounts();
      if (BD.phone) BD.phone.init();
      BD.stopPolls();
      timers.push(setInterval(BD.refreshInboxCount, 20000));
      timers.push(setInterval(BD.loadListCounts, 60000));
    }, function (e) { if (!e.quiet) { document.getElementById('main').innerHTML = '<div class="auth"><div class="auth-card"><h1>No connection</h1><p>The desk could not be reached. Check the connection, then reload.</p><button class="btn primary" onclick="location.reload()">Reload</button></div></div>'; } });
  }
  var inv = /invite=([\w-]+)/.exec(location.hash);
  if (inv) { window.__BD_READY = true; startInvite(inv[1]); } else boot();
})();
