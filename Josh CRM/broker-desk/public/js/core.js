/* Broker Desk core: state, the API helper, the hash router, one delegated click listener keyed on
 * data-act, and the small UI kit (toast, modal, popover, menus). Screens are functions that return
 * HTML strings; each module registers its views and actions on window.BD. No build step, nothing
 * from a CDN. */
(function () {
  'use strict';
  var S = window.BD_SHARED;
  var BD = window.BD = { S: S, views: {}, acts: {}, state: { me: null }, cache: {} };

  // ---------- utils ----------
  var esc = BD.esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  BD.attr = function (o) { return Object.keys(o).map(function (k) { return o[k] == null || o[k] === false ? '' : ' ' + k + '="' + esc(o[k] === true ? '' : o[k]) + '"'; }).join(''); };
  BD.money = S.money; BD.moneyK = S.moneyK; BD.cents = S.cents; BD.fmtPhone = S.fmtPhone;
  BD.plural = function (n, one, many) { return (n || 0).toLocaleString('en-CA') + ' ' + (n === 1 ? one : (many || one + 's')); };
  BD.num = function (n) { return (n || 0).toLocaleString('en-CA'); };
  BD.pct = function (x) { return x == null ? '–' : Math.round(x * 100) + '%'; };
  BD.cap = function (s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; };
  BD.first = function (n) { return String(n || '').replace(/^Dr\.?\s+/, '').split(' ')[0]; };
  BD.initials = function (n) { return String(n || '?').replace(/^Dr\.?\s+/, '').split(/\s+/).map(function (w) { return w[0] || ''; }).slice(0, 2).join('').toUpperCase(); };
  BD.uid = function (p) { return (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  var DAY = S.DAY;
  function dayStart(t) { var d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); }
  BD.daysAgo = function (t) { return Math.round((dayStart(Date.now()) - dayStart(t)) / DAY); };
  BD.fmtDay = function (t, long) { return new Date(t).toLocaleDateString('en-CA', long ? { weekday: 'long', month: 'long', day: 'numeric' } : { month: 'short', day: 'numeric' }); };
  BD.fmtTime = function (t) { return new Date(t).toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' }).replace('a.m.', 'am').replace('p.m.', 'pm'); };
  BD.when = function (t) {
    if (!t) return 'Never';
    var m = Math.round((Date.now() - t) / 60000), n = BD.daysAgo(t);
    if (m >= 0 && m < 1) return 'Just now'; if (m > 0 && m < 60) return m + ' min ago';
    if (n === 0) return m < 0 ? 'Today ' + BD.fmtTime(t) : BD.fmtTime(t);
    if (n === 1) return 'Yesterday'; if (n === -1) return 'Tomorrow ' + BD.fmtTime(t);
    if (n > 1 && n < 7) return n + ' days ago';
    return BD.fmtDay(t);
  };
  BD.due = function (t) {
    var n = BD.daysAgo(t);
    if (n > 0) return { text: n === 1 ? 'Yesterday' : n + ' days late', late: true };
    if (n === 0) return { text: t <= Date.now() ? 'Due ' + BD.fmtTime(t) : 'Today ' + BD.fmtTime(t), late: t <= Date.now() };
    if (n === -1) return { text: 'Tomorrow ' + BD.fmtTime(t), late: false };
    return { text: BD.fmtDay(t) + ', ' + BD.fmtTime(t), late: false };
  };
  BD.dur = function (s) { s = Math.max(0, Math.round(s || 0)); var h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return h ? h + 'h ' + m + 'm' : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  BD.talkTime = function (s) { s = Math.round(s || 0); if (s < 60) return s + 's'; var h = Math.floor(s / 3600), m = Math.round(s % 3600 / 60); return h ? h + 'h ' + m + 'm' : m + 'm'; };
  BD.debounce = function (fn, ms) { var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); }; };

  // ---------- people, statuses ----------
  BD.me = function () { return BD.state.me || {}; };
  BD.isMgr = function () { var u = BD.state.me && BD.state.me.user; return !!u && u.role !== 'rep'; };
  BD.person = function (id) { var t = (BD.state.me && BD.state.me.team || []).filter(function (p) { return p.id === id; })[0]; return t || null; };
  BD.pname = function (id) { var p = BD.person(id); return p ? p.name : id ? 'Someone' : 'Nobody'; };
  BD.statuses = function () { return (BD.state.me && BD.state.me.settings.statuses) || S.STATUSES; };
  BD.status = function (id) { return BD.statuses().filter(function (s) { return s.id === id; })[0] || { id: id, label: id || 'No status', tone: '' }; };
  BD.statusPill = function (id) { var s = BD.status(id); return '<span class="pill ' + esc(s.tone || '') + '">' + esc(s.label) + '</span>'; };
  BD.lists = function () { return (BD.state.me && BD.state.me.settings.lists) || []; };

  // ---------- icons ----------
  var I = function (d, w) { return '<svg width="' + (w || 16) + '" height="' + (w || 16) + '" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>'; };
  BD.ICON = {
    inbox: I('<path d="M2.5 9.5l1.6-5.3a1 1 0 0 1 1-.7h5.8a1 1 0 0 1 1 .7l1.6 5.3v3a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z"/><path d="M2.5 9.5h3l1 1.5h3l1-1.5h3"/>'),
    leads: I('<circle cx="6" cy="5.5" r="2.5"/><path d="M1.8 13.5c.6-2.3 2.2-3.5 4.2-3.5s3.6 1.2 4.2 3.5"/><path d="M10.5 3.2a2.4 2.4 0 0 1 0 4.6M12 10.3c1.1.5 1.9 1.6 2.2 3.2"/>'),
    deals: I('<rect x="2" y="3" width="3.4" height="10" rx="1"/><rect x="6.3" y="3" width="3.4" height="7" rx="1"/><rect x="10.6" y="3" width="3.4" height="4.5" rx="1"/>'),
    lenders: I('<path d="M2 6.5L8 3l6 3.5M3 13.5h10M4 7v5M8 7v5M12 7v5"/>'),
    seq: I('<path d="M3 3.5h4M3 8h7M3 12.5h10"/><circle cx="9.5" cy="3.5" r="1.3"/><circle cx="12.5" cy="8" r="1.3"/>'),
    dash: I('<path d="M2.5 13.5h11M4 11V8M7 11V5M10 11V7M13 11V3.5"/>'),
    settings: I('<circle cx="8" cy="8" r="2"/><path d="M8 1.8v1.6M8 12.6v1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M1.8 8h1.6M12.6 8h1.6M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/>'),
    list: I('<path d="M5.5 4h8M5.5 8h8M5.5 12h8"/><circle cx="2.7" cy="4" r=".6" fill="currentColor"/><circle cx="2.7" cy="8" r=".6" fill="currentColor"/><circle cx="2.7" cy="12" r=".6" fill="currentColor"/>'),
    phone: I('<path d="M3 2.5h3l1.2 3-1.7 1.1a8 8 0 0 0 3.9 3.9l1.1-1.7 3 1.2v3c0 .6-.5 1-1 1A11.5 11.5 0 0 1 2 3.5c0-.6.4-1 1-1z"/>', 15),
    hang: I('<path d="M1.8 9.2c3.8-3 8.6-3 12.4 0l-1.3 2-2.6-.8-.3-1.9a7 7 0 0 0-4 0l-.3 1.9-2.6.8z"/>', 15),
    msg: I('<path d="M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z"/>', 15),
    mail: I('<rect x="2" y="3.5" width="12" height="9" rx="1.2"/><path d="M2.5 4.5L8 8.5l5.5-4"/>', 15),
    note: I('<path d="M3 2.5h10v11H3zM5.5 6h5M5.5 8.5h5M5.5 11h3"/>', 15),
    clock: I('<circle cx="8" cy="8" r="6.2"/><path d="M8 4.6V8l2.3 1.5"/>', 15),
    check: I('<path d="M3 8.3l3 3 7-7"/>', 14),
    x: I('<path d="M4 4l8 8M12 4l-8 8"/>', 16),
    plus: I('<path d="M8 3v10M3 8h10"/>', 14),
    search: I('<circle cx="7" cy="7" r="4.6"/><path d="M10.5 10.5L14 14"/>', 15),
    down: I('<path d="M4 6l4 4 4-4"/>', 12),
    back: I('<path d="M10 3L5 8l5 5"/>', 14),
    play: I('<path d="M5 3.5v9l7-4.5z"/>', 13),
    pause: I('<path d="M5.5 3.5v9M10.5 3.5v9"/>', 13),
    mute: I('<path d="M8 2.5v7M5.5 7a2.5 2.5 0 0 0 5 0V5M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v1.5M2.5 2.5l11 11"/>', 15),
    mic: I('<rect x="6" y="2" width="4" height="7.5" rx="2"/><path d="M3.5 7.5a4.5 4.5 0 0 0 9 0M8 12v1.8"/>', 15),
    vm: I('<circle cx="4.5" cy="8.5" r="2.5"/><circle cx="11.5" cy="8.5" r="2.5"/><path d="M4.5 11h7"/>', 15),
    file: I('<path d="M4 1.8h5l3 3v9.4H4z"/><path d="M9 1.8v3h3"/>', 14),
    up: I('<path d="M8 13V3M4 7l4-4 4 4"/>', 13),
    task: I('<rect x="2.5" y="2.5" width="11" height="11" rx="2.5"/><path d="M5.3 8.2l1.9 1.9 3.7-4"/>', 15),
    form: I('<rect x="3" y="2" width="10" height="12" rx="1.5"/><path d="M5.5 5.5h5M5.5 8h5M5.5 10.5h3"/>', 15),
    bank: I('<path d="M2 6.5L8 3l6 3.5M3 13.5h10M4.5 7v5M8 7v5M11.5 7v5"/>', 15),
    dialer: I('<circle cx="4" cy="4" r="1.1"/><circle cx="8" cy="4" r="1.1"/><circle cx="12" cy="4" r="1.1"/><circle cx="4" cy="8" r="1.1"/><circle cx="8" cy="8" r="1.1"/><circle cx="12" cy="8" r="1.1"/><circle cx="8" cy="12" r="1.1"/>', 15),
    flag: I('<path d="M3.5 14V2.5M3.5 3h8l-1.5 3 1.5 3h-8"/>', 14),
    shield: I('<path d="M8 1.8l5 2v4c0 3-2.2 5.3-5 6.4-2.8-1.1-5-3.4-5-6.4v-4z"/>', 14),
    out: I('<path d="M6 3H3v10h3M10 5l3 3-3 3M13 8H6"/>', 14),
    dots: '<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><circle cx="3.5" cy="8" r="1.3" fill="currentColor"/><circle cx="8" cy="8" r="1.3" fill="currentColor"/><circle cx="12.5" cy="8" r="1.3" fill="currentColor"/></svg>'
  };
  var ICON = BD.ICON;

  // ---------- API ----------
  BD.api = function (path, opt) {
    opt = opt || {};
    var d0 = new Date(); d0.setHours(0, 0, 0, 0);
    var init = { method: opt.method || (opt.body ? 'POST' : 'GET'), credentials: 'same-origin', headers: { 'X-Day0': String(d0.getTime()) } };
    if (opt.body && !(opt.body instanceof FormData)) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opt.body); }
    else if (opt.body) init.body = opt.body;
    return fetch(path, init).then(function (r) {
      return r.json().catch(function () { return { ok: false, error: 'The desk could not read the reply.' }; }).then(function (j) {
        if (r.status === 401 && j.signedOut && !opt.auth) { BD.signedOut(); throw Object.assign(new Error('Signed out'), { quiet: true }); }
        if (!r.ok || j.ok === false) { var e = new Error(j.error || 'Something went wrong. Try again.'); e.status = r.status; e.body = j; throw e; }
        return j;
      });
    }, function () { throw new Error('No connection. Check your internet and try again.'); });
  };
  BD.fail = function (e) { if (e && e.quiet) return; BD.toast((e && e.message) || 'Something went wrong.', { bad: true }); };

  // ---------- toast ----------
  var toastTimer = null;
  BD.toast = function (msg, opt) {
    opt = opt || {};
    var root = document.getElementById('toast-root');
    clearTimeout(toastTimer);
    root.innerHTML = '<div class="toast' + (opt.bad ? ' bad' : '') + '" role="status"><span>' + esc(msg) + '</span>' +
      (opt.action ? '<button data-act="toast-action">' + esc(opt.action.label) + '</button>' : '') + '</div>';
    root._fn = opt.action ? opt.action.fn : null;
    toastTimer = setTimeout(function () { root.innerHTML = ''; root._fn = null; }, opt.action ? 7000 : opt.long ? 6000 : 3600);
  };

  // ---------- modal ----------
  // BD.modal({ title, sub, body, foot, wide, submit, onSubmit(form) }) -> returns the element.
  var modalOpts = null;
  BD.modal = function (o) {
    modalOpts = o;
    var root = document.getElementById('modal-root');
    root.innerHTML = '<div class="modal-wrap enter" data-act="modal-bg"><div class="modal' + (o.wide ? ' wide' : '') + (o.cls ? ' ' + o.cls : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(o.title) + '">' +
      '<div class="modal-h"><div><h2>' + esc(o.title) + '</h2>' + (o.sub ? '<p>' + o.sub + '</p>' : '') + '</div><button class="x" data-act="modal-close" aria-label="Close">' + ICON.x + '</button></div>' +
      '<form class="modal-form" novalidate><div class="modal-b">' + (o.body || '') + '</div>' +
      (o.foot !== false ? '<div class="modal-f">' + (o.left ? '<div class="left">' + o.left + '</div>' : '') + '<button type="button" class="btn ghost" data-act="modal-close">' + esc(o.cancel || 'Cancel') + '</button>' + (o.submit ? '<button type="submit" class="btn primary">' + esc(o.submit) + '</button>' : '') + '</div>' : '') + '</form></div></div>';
    var f = root.querySelector('form');
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      if (!modalOpts || !modalOpts.onSubmit) return;
      var btn = f.querySelector('button[type=submit]'); if (btn) btn.disabled = true;
      Promise.resolve(modalOpts.onSubmit(f)).then(function (keep) { if (keep !== true) BD.closeModal(); }, function (err) { BD.modalErr(err && err.message || String(err)); }).then(function () { if (btn) btn.disabled = false; });
    });
    var first = root.querySelector('[autofocus], .modal-b input:not([type=checkbox]):not([type=radio]), .modal-b textarea, .modal-b select');
    if (first && !o.noFocus) setTimeout(function () { first.focus(); }, 30);
    if (o.mount) o.mount(root.querySelector('.modal'));
    return root.querySelector('.modal');
  };
  BD.modalErr = function (msg) {
    var b = document.querySelector('#modal-root .modal-b'); if (!b) return BD.toast(msg, { bad: true });
    var e = b.querySelector('.err'); if (!e) { e = document.createElement('p'); e.className = 'err'; b.appendChild(e); }
    e.textContent = msg;
  };
  BD.closeModal = function () { modalOpts = null; document.getElementById('modal-root').innerHTML = ''; };
  BD.modalOpen = function () { return !!modalOpts; };
  BD.formData = function (f) {
    var o = {};
    Array.prototype.forEach.call(f.elements, function (el) {
      if (!el.name || el.disabled) return;
      if (el.type === 'checkbox') { if (el.dataset.multi) { (o[el.name] = o[el.name] || []); if (el.checked) o[el.name].push(el.value); } else o[el.name] = el.checked; }
      else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
      else o[el.name] = el.value;
    });
    return o;
  };
  BD.confirm = function (title, text, label, fn, danger) {
    BD.modal({ title: title, body: '<p class="lead">' + text + '</p>', submit: label, cls: danger ? 'danger' : '', onSubmit: fn });
  };

  // ---------- popover ----------
  var popEl = null;
  BD.pop = function (anchor, html, opt) {
    BD.closePop();
    opt = opt || {};
    popEl = document.createElement('div');
    popEl.className = 'pop' + (opt.wide ? ' wide' : '');
    popEl.innerHTML = html;
    document.body.appendChild(popEl);
    var r = anchor.getBoundingClientRect(), w = popEl.offsetWidth, h = popEl.offsetHeight;
    var left = Math.min(window.innerWidth - w - 8, Math.max(8, opt.right ? r.right - w : r.left));
    var top = r.bottom + 6; if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    popEl.style.left = left + 'px'; popEl.style.top = top + 'px';
    popEl._fn = opt.onPick || null;
    var inp = popEl.querySelector('input'); if (inp && !opt.noFocus) inp.focus();
    return popEl;
  };
  BD.closePop = function () { if (popEl) { popEl.remove(); popEl = null; } };
  BD.popPick = function (v, el) { var fn = popEl && popEl._fn; BD.closePop(); if (fn) fn(v, el); };
  // A simple menu: items [{ v, label, sub, danger, sel }]
  BD.menu = function (anchor, items, onPick, opt) {
    return BD.pop(anchor, items.map(function (it) {
      if (it.sep) return '<div class="sep"></div>';
      if (it.head) return '<div class="head">' + esc(it.head) + '</div>';
      return '<button type="button" class="opt' + (it.sel ? ' sel' : '') + (it.danger ? ' danger' : '') + '" data-act="pop-pick" data-v="' + esc(it.v) + '"><span>' + esc(it.label) + '</span>' + (it.sub ? '<span class="muted">' + esc(it.sub) + '</span>' : it.sel ? ICON.check : '') + '</button>';
    }).join(''), Object.assign({ onPick: onPick }, opt || {}));
  };

  // ---------- events ----------
  function on(name, fn) { BD.acts[name] = fn; }
  BD.on = on;
  on('toast-action', function () { var r = document.getElementById('toast-root'), fn = r._fn; r.innerHTML = ''; r._fn = null; if (fn) fn(); });
  on('modal-close', function () { BD.closeModal(); });
  on('modal-bg', function (el, e) { if (e.target === el) BD.closeModal(); });
  on('pop-pick', function (el) { BD.popPick(el.getAttribute('data-v'), el); });
  on('go', function (el) { BD.go(el.getAttribute('data-v')); });
  document.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (popEl && !e.target.closest('.pop') && !(el && el.hasAttribute('data-keep-pop'))) BD.closePop();
    if (!el) return;
    var fn = BD.acts[el.getAttribute('data-act')];
    if (!fn) return;
    if (el.tagName === 'A' && el.getAttribute('href') === '#') e.preventDefault();
    if (el.tagName === 'BUTTON' && el.type !== 'submit') e.preventDefault();
    fn(el, e);
  });
  document.addEventListener('change', function (e) { var el = e.target.closest('[data-change]'); if (el && BD.acts[el.getAttribute('data-change')]) BD.acts[el.getAttribute('data-change')](el, e); });
  document.addEventListener('input', function (e) { var el = e.target.closest('[data-input]'); if (el && BD.acts[el.getAttribute('data-input')]) BD.acts[el.getAttribute('data-input')](el, e); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') { if (popEl) return BD.closePop(); if (modalOpts) return BD.closeModal(); if (BD.onEscape) BD.onEscape(); }
    if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((e.target.tagName || '')) && !modalOpts) { var q = document.getElementById('q'); if (q) { e.preventDefault(); q.focus(); } }
  });
  // Tooltips from data-tip.
  var tipEl = null;
  document.addEventListener('mouseover', function (e) {
    var t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { if (tipEl) tipEl.style.display = 'none'; return; }
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; document.body.appendChild(tipEl); }
    tipEl.textContent = t.getAttribute('data-tip'); tipEl.style.display = 'block';
    var r = t.getBoundingClientRect(), w = tipEl.offsetWidth, h = tipEl.offsetHeight;
    tipEl.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2)) + 'px';
    tipEl.style.top = (r.top - h - 8 < 4 ? r.bottom + 8 : r.top - h - 8) + 'px';
  });

  // ---------- router ----------
  // #/name/arg?k=v  ->  BD.views[name].render(arg, query)
  BD.route = { name: '', arg: '', query: {} };
  BD.parseHash = function () {
    var h = (location.hash || '').replace(/^#\/?/, ''), qi = h.indexOf('?'), path = qi >= 0 ? h.slice(0, qi) : h, qs = qi >= 0 ? h.slice(qi + 1) : '';
    var parts = path.split('/'), query = {};
    qs.split('&').forEach(function (p) { if (!p) return; var kv = p.split('='); query[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || ''); });
    return { name: parts[0] || 'inbox', arg: parts.slice(1).join('/'), query: query };
  };
  BD.go = function (h) { if (location.hash === h) BD.render(); else location.hash = h; };
  var current = null;
  BD.render = function (opt) {
    if (!BD.state.me) return;
    var r = BD.parseHash(), v = BD.views[r.name] || BD.views.inbox;
    if (current && current !== v && current.leave) current.leave();
    var same = current === v && BD.route.name === r.name && BD.route.arg === r.arg;
    current = v; BD.route = r;
    BD.renderNav();
    var main = document.getElementById('main');
    var out = v.render(r.arg, r.query, { same: same, soft: opt && opt.soft });
    if (out && out.then) {
      if (!same) main.innerHTML = '<div class="loading">Loading...</div>';
      out.then(function (html) { if (BD.route === r) { main.innerHTML = html; if (v.mounted) v.mounted(main); } }, BD.fail);
    } else if (out != null) { main.innerHTML = out; if (v.mounted) v.mounted(main); }
    if (!same && !(opt && opt.keepScroll)) main.scrollTop = 0;
  };
  // Redraws the current screen without re-fetching (views decide what that means).
  BD.refresh = function () { BD.render({ soft: true, keepScroll: true }); };
  window.addEventListener('hashchange', function () { BD.closePop(); BD.render(); });
})();
