/*
 * spec-mode.js — drop-in "Spec Mode" engineering-handoff layer for any web mockup.
 *
 * Tag elements with data-spec-id; each gets a small chip (top-right). Click it
 * for a side panel: what the component does in plain language, data source, states,
 * interactions, acceptance criteria, an Edit button to revise the description, and a
 * per-component comment thread for engineers/reviewers. Off = looks like production.
 *
 * Self-contained vanilla JS. No framework, no build step. Complements annotate.js
 * (free-form pins); this is the structured per-component spec layer.
 *
 *   window.SPEC_MODE = {
 *     defaultOn: true,                       // chips visible on load (People Pulse style)
 *     title: 'LaunchPad — Seuite PM Portfolio',
 *     commentsApi: '/api/spec',              // optional: enables comments + edit sync
 *     authors: ['Marko','Vigan','Brad','Tiago','Yonatan'],  // quick-pick names
 *     specs: { 'leader-breakdown': { name, oneLiner, points:[], dataSource, states:[],
 *              interactions:[], acceptance:[], notes:[], openQuestions:[] }, ... }
 *   };
 *   <script src="/spec-mode.js"></script>
 *
 * Comments + edits persist to commentsApi: GET -> {comments:[...]}, POST {comments:[...]}
 * merges by id (newest updatedAt wins, deletes are tombstones). Edits are stored as
 * records with id "ov:<specId>". Use api-spec.js / api-spec-cloudflare.js for the endpoint.
 */
(function () {
  if (window.__specModeLoaded) return;
  window.__specModeLoaded = true;

  var CFG = window.SPEC_MODE || {};
  var SPECS = CFG.specs || {};
  var API = CFG.commentsApi || null;
  var AUTHORS = CFG.authors || [];
  var on = CFG.defaultOn !== false; // default ON unless explicitly false

  var records = [];        // comments + overrides (ov:<id>)
  var openId = null;
  var editing = false;
  var poll = null;
  var author = '';
  try { author = localStorage.getItem('spec-author') || ''; } catch (e) {}

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function uid() { return 'c-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); }
  function ago(ts) { var s = (Date.now() - ts) / 1000; if (s < 60) return 'now'; if (s < 3600) return Math.floor(s / 60) + 'm'; if (s < 86400) return Math.floor(s / 3600) + 'h'; return Math.floor(s / 86400) + 'd'; }

  // ---- styles (dark panel to sit cleanly over light OR dark mockups) ----
  var css = [
    '.spec-fab{position:fixed;left:12px;bottom:12px;z-index:2147483000;display:inline-flex;align-items:center;gap:4px;font:600 10px/1 system-ui,sans-serif;padding:4px 8px;border-radius:6px;border:1px solid rgba(99,102,241,.35);background:rgba(255,255,255,.7);color:#6366f1;cursor:pointer;box-shadow:0 1px 3px rgba(0,0,0,.1);opacity:.45;transition:opacity .15s ease,border-color .15s ease}',
    '.spec-fab:hover{opacity:1;border-color:#6366f1}',
    '.spec-fab.active{background:#4f46e5;border-color:#4f46e5;color:#fff;opacity:1}',
    'body.spec-on [data-spec-id]{outline:1px dashed rgba(99,102,241,.5);outline-offset:2px;border-radius:4px}',
    '.spec-au-name{flex:1;min-width:120px;font:inherit;font-size:12px;padding:4px 8px;border:1px solid #d1d5db;border-radius:999px;background:#fff;color:#111}',
    'body.spec-on [data-spec-id]:hover{outline-style:solid;outline-color:#6366f1}',
    '.spec-chip{position:absolute;top:2px;right:2px;z-index:60;display:none;align-items:center;gap:4px;height:20px;padding:0 7px;border-radius:10px;background:#4f46e5;color:#fff;font:700 10px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 1px 4px rgba(0,0,0,.3);white-space:nowrap}',
    'body.spec-on .spec-chip{display:inline-flex}',
    '.spec-chip:hover{background:#4338ca}',
    '.spec-overlay{position:fixed;inset:0;z-index:2147483100;background:rgba(0,0,0,.45);display:none}.spec-overlay.open{display:block}',
    '.spec-panel{position:fixed;top:0;right:0;height:100%;width:400px;max-width:94vw;z-index:2147483200;background:#0f172a;color:#e2e8f0;box-shadow:-6px 0 30px rgba(0,0,0,.4);transform:translateX(100%);transition:transform .18s ease;display:flex;flex-direction:column;font:14px/1.5 system-ui,sans-serif}',
    '.spec-panel.open{transform:translateX(0)}',
    '.spec-head{padding:16px;border-bottom:1px solid #1e293b;position:relative}',
    '.spec-eyebrow{font:700 10px/1 system-ui;text-transform:uppercase;letter-spacing:.06em;color:#64748b}',
    '.spec-title{font-size:17px;font-weight:700;margin:5px 0 3px;color:#f8fafc}',
    '.spec-id{font:600 11px/1 ui-monospace,monospace;color:#818cf8;cursor:pointer}.spec-id:hover{text-decoration:underline}',
    '.spec-close{position:absolute;top:14px;right:14px;border:none;background:none;font-size:20px;color:#94a3b8;cursor:pointer;line-height:1}',
    '.spec-body{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:16px}',
    '.spec-sec{}',
    '.spec-sec-label{font:700 10px/1 system-ui;text-transform:uppercase;letter-spacing:.06em;color:#64748b;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center}',
    '.spec-edit-btn{font:600 11px system-ui;color:#818cf8;background:none;border:none;cursor:pointer}',
    '.spec-one{font-size:14px;color:#e2e8f0;font-style:italic}',
    '.spec-list{margin:0;padding-left:18px}.spec-list li{margin:4px 0;color:#cbd5e1}',
    '.spec-pillrow{display:flex;flex-wrap:wrap;gap:6px}',
    '.spec-pill{font:600 11px/1 system-ui;padding:4px 9px;border-radius:5px;background:#1e293b;color:#cbd5e1}',
    '.spec-ds{font-size:13px;color:#c7d2fe;background:#1e1b4b;border:1px solid #312e81;border-radius:6px;padding:8px 10px}',
    '.spec-q{font-size:13px;color:#fcd34d;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:6px;padding:8px 10px;margin-bottom:4px}',
    '.spec-empty{color:#64748b;font-size:13px}',
    '.spec-ta{width:100%;box-sizing:border-box;background:#1e293b;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font:13px/1.4 system-ui;padding:7px 9px;resize:vertical}',
    '.spec-editrow{display:flex;gap:8px;margin-top:8px}',
    '.spec-btn{border:none;border-radius:6px;font:600 12px system-ui;padding:6px 12px;cursor:pointer}',
    '.spec-btn.primary{background:#4f46e5;color:#fff}.spec-btn.ghost{background:#1e293b;color:#cbd5e1}',
    '.spec-editby{font-size:11px;color:#64748b;margin-top:4px}',
    /* comments */
    '.spec-cm{border-top:1px solid #1e293b;padding-top:14px}',
    '.spec-cm-item{margin-bottom:12px}',
    '.spec-cm-meta{font:600 12px/1 system-ui;color:#818cf8}.spec-cm-meta .t{color:#64748b;font-weight:400;margin-left:6px}',
    '.spec-cm-text{font-size:13px;color:#e2e8f0;white-space:pre-wrap;margin-top:3px}',
    '.spec-cm-del{border:none;background:none;color:#475569;cursor:pointer;font-size:13px;float:right}.spec-cm-del:hover{color:#f87171}',
    '.spec-cm-empty{color:#64748b;font-size:13px}',
    '.spec-foot{border-top:1px solid #1e293b;padding:12px 16px;background:#0b1220}',
    '.spec-au-row{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;align-items:center}',
    '.spec-au-lbl{font:600 10px/1 system-ui;text-transform:uppercase;letter-spacing:.05em;color:#64748b;margin-right:2px}',
    '.spec-au{font:600 11px system-ui;padding:4px 9px;border-radius:12px;border:1px solid #334155;background:#1e293b;color:#cbd5e1;cursor:pointer}',
    '.spec-au.sel{background:#4f46e5;border-color:#4f46e5;color:#fff}',
    '.spec-cm-ta{width:100%;box-sizing:border-box;background:#1e293b;border:1px solid #334155;border-radius:6px;color:#e2e8f0;font:13px/1.4 system-ui;padding:8px 10px;resize:vertical;min-height:46px}',
    '.spec-send{margin-top:6px;width:100%;border:none;border-radius:6px;background:#4f46e5;color:#fff;font:600 13px system-ui;padding:9px;cursor:pointer}.spec-send:disabled{opacity:.45;cursor:default}'
  ].join('');
  var styleEl = document.createElement('style'); styleEl.textContent = css; document.head.appendChild(styleEl);

  // ---- elements ----
  var fab = document.createElement('button'); fab.type = 'button'; fab.className = 'spec-fab';
  fab.innerHTML = '<span>' + (CFG.fabLabel || 'Spec mode') + '</span>';
  fab.addEventListener('click', function () { setMode(!on); });
  var overlay = document.createElement('div'); overlay.className = 'spec-overlay'; overlay.addEventListener('click', closePanel);
  var panel = document.createElement('div'); panel.className = 'spec-panel'; panel.addEventListener('click', function (e) { e.stopPropagation(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closePanel();
    if ((e.key === 's' || e.key === 'S') && !/input|textarea|select/i.test(e.target.tagName || '')) setMode(!on);
  });

  function ready() {
    document.body.appendChild(fab); document.body.appendChild(overlay); document.body.appendChild(panel);
    if (API) loadRecords();
    setMode(on);
    observing = true; mo.observe(document.body, { childList: true, subtree: true });
  }

  // ---- data ----
  function overrideFor(id) { return records.find(function (r) { return r.id === 'ov:' + id && !r.deleted; }); }
  function commentsFor(id) { return records.filter(function (r) { return r.specId === id && !r.override && !r.deleted; }).sort(function (a, b) { return a.ts - b.ts; }); }
  function specFor(el) {
    var id = el.getAttribute('data-spec-id');
    var base = SPECS[id] ? JSON.parse(JSON.stringify(SPECS[id])) : { name: el.getAttribute('data-spec-name') || id, oneLiner: el.getAttribute('data-spec-oneliner') || '', points: [] };
    base.specId = id;
    var ov = overrideFor(id);
    if (ov) { base.oneLiner = ov.oneLiner; base.points = ov.points || []; base.editedBy = ov.author; }
    return base;
  }

  // ---- chips ----
  function renderChips() {
    mo.disconnect();
    Array.prototype.forEach.call(document.querySelectorAll('.spec-chip'), function (c) { c.remove(); });
    if (on) {
      Array.prototype.forEach.call(document.querySelectorAll('[data-spec-id]'), function (el) {
        if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
        var id = el.getAttribute('data-spec-id');
        var n = API ? commentsFor(id).length : 0;
        var chip = document.createElement('span'); chip.className = 'spec-chip';
        chip.innerHTML = (CFG.chipLabel || 'Spec') + (n ? ' (' + n + ')' : '');
        chip.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); openSpec(el); });
        el.appendChild(chip);
      });
    }
    if (observing) mo.observe(document.body, { childList: true, subtree: true });
  }
  // Only the chip opens the spec — the rest of the element stays fully interactive,
  // so the mockup's own controls (filters, tabs, sort) keep working in spec mode.

  // ---- panel render ----
  function section(label, inner, editBtn) {
    return '<div class="spec-sec"><div class="spec-sec-label"><span>' + esc(label) + '</span>' + (editBtn || '') + '</div>' + inner + '</div>';
  }
  function list(arr) { return '<ul class="spec-list">' + (arr || []).map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>'; }
  function pills(arr) { return '<div class="spec-pillrow">' + arr.map(function (x) { return '<span class="spec-pill">' + esc(x) + '</span>'; }).join('') + '</div>'; }

  function whatItDoesHtml(s) {
    if (editing) {
      return '<div class="spec-sec"><div class="spec-sec-label"><span>What it does</span></div>' +
        '<textarea class="spec-ta" id="ed-one" rows="2" placeholder="One plain sentence">' + esc(s.oneLiner || '') + '</textarea>' +
        '<textarea class="spec-ta" id="ed-points" rows="4" style="margin-top:8px" placeholder="One bullet per line">' + esc((s.points || []).join('\n')) + '</textarea>' +
        '<div class="spec-editrow"><button class="spec-btn primary" id="ed-save">Save</button><button class="spec-btn ghost" id="ed-revert">Revert to original</button></div></div>';
    }
    var inner = (s.oneLiner ? '<div class="spec-one">' + esc(s.oneLiner) + '</div>' : '') + (s.points && s.points.length ? list(s.points) : '');
    if (!inner) inner = '<div class="spec-empty">No description yet.</div>';
    if (s.editedBy) inner += '<div class="spec-editby">edited by ' + esc(s.editedBy) + '</div>';
    var editBtn = API ? '<button class="spec-edit-btn" id="ed-open">Edit</button>' : '';
    return '<div class="spec-sec"><div class="spec-sec-label"><span>What it does</span>' + editBtn + '</div>' + inner + '</div>';
  }

  function openSpec(el) {
    var s = specFor(el); openId = s.specId; editing = false;
    renderPanel(s);
    overlay.classList.add('open'); panel.classList.add('open');
    if (API) startPoll();
  }

  function renderPanel(s) {
    var parts = [whatItDoesHtml(s)];
    if (s.acceptance && s.acceptance.length) parts.push(section('Acceptance criteria', list(s.acceptance)));
    if (API) parts.push('<div class="spec-cm" id="cm-thread">' + threadHtml(s.specId) + '</div>');

    panel.innerHTML =
      '<div class="spec-head"><button class="spec-close" aria-label="Close">×</button>' +
      '<div class="spec-eyebrow">' + esc(CFG.title || 'Spec') + '</div>' +
      '<div class="spec-title">' + esc(s.name || s.specId) + '</div>' +
      '<span class="spec-id" title="Copy id">#' + esc(s.specId) + '</span></div>' +
      '<div class="spec-body">' + parts.join('') + '</div>' +
      (API ? footHtml() : '');

    panel.querySelector('.spec-close').addEventListener('click', closePanel);
    var idEl = panel.querySelector('.spec-id');
    idEl.addEventListener('click', function () { try { navigator.clipboard.writeText(s.specId); idEl.textContent = '#' + s.specId + ' ✓'; setTimeout(function () { idEl.textContent = '#' + s.specId; }, 1200); } catch (e) {} });
    wireEdit(s);
    if (API) { wireFoot(s.specId); }
  }

  // ---- edit "what it does" (override stored as ov:<specId>) ----
  function wireEdit(s) {
    var open = panel.querySelector('#ed-open');
    if (open) open.addEventListener('click', function () { editing = true; renderPanel(specFor4(s.specId) || s); });
    var save = panel.querySelector('#ed-save');
    if (save) save.addEventListener('click', function () {
      var one = panel.querySelector('#ed-one').value.trim();
      var pts = panel.querySelector('#ed-points').value.split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
      upsert({ id: 'ov:' + s.specId, specId: s.specId, override: true, oneLiner: one, points: pts, author: author || 'Editor', ts: Date.now(), updatedAt: Date.now() });
      editing = false; renderPanel(specForId(s.specId)); renderChips(); pushRecords();
    });
    var revert = panel.querySelector('#ed-revert');
    if (revert) revert.addEventListener('click', function () {
      var ov = overrideFor(s.specId);
      if (ov) { ov.deleted = true; ov.updatedAt = Date.now(); }
      editing = false; renderPanel(specForId(s.specId)); renderChips(); pushRecords();
    });
  }
  function specForId(id) { var node = document.querySelector('[data-spec-id="' + id + '"]'); return node ? specFor(node) : null; }
  function specFor4(id) { return specForId(id); }

  // ---- comments ----
  function threadHtml(id) {
    var cs = commentsFor(id);
    var head = '<div class="spec-sec-label"><span>Conversation</span></div>';
    if (!cs.length) return head + '<div class="spec-cm-empty">No comments yet. Pick who you are and leave a note below.</div>';
    return head + cs.map(function (c) {
      return '<div class="spec-cm-item" data-cid="' + esc(c.id) + '"><div class="spec-cm-meta">' + esc(c.author || 'Anon') + '<span class="t">' + ago(c.ts) + '</span><button class="spec-cm-del" title="Delete">×</button></div><div class="spec-cm-text">' + esc(c.text) + '</div></div>';
    }).join('');
  }
  function footHtml() {
    var picks = AUTHORS.map(function (a) { return '<button class="spec-au' + (a === author ? ' sel' : '') + '" data-au="' + esc(a) + '">' + esc(a) + '</button>'; }).join('');
    // With no configured names, a free-text field beats forcing every reviewer
    // through the Other… prompt() just to sign a comment.
    if (!AUTHORS.length) {
      return '<div class="spec-foot"><div class="spec-au-row"><span class="spec-au-lbl">You are</span>' +
        '<input class="spec-au-name" placeholder="your name" value="' + esc(author || '') + '"></div>' +
        '<textarea class="spec-cm-ta" placeholder="Add a comment for this component..."></textarea>' +
        '<button class="spec-send" disabled>Comment</button></div>';
    }
    return '<div class="spec-foot"><div class="spec-au-row"><span class="spec-au-lbl">You are</span>' + picks + '<button class="spec-au" data-au="__other">Other…</button></div>' +
      '<textarea class="spec-cm-ta" placeholder="Add a comment for this component..."></textarea>' +
      '<button class="spec-send" disabled>Comment</button></div>';
  }
  function wireFoot(specId) {
    var ta = panel.querySelector('.spec-cm-ta');
    var send = panel.querySelector('.spec-send');
    function refresh() { send.disabled = !(author && ta.value.trim()); }
    ta.addEventListener('input', refresh);
    var nameEl = panel.querySelector('.spec-au-name');
    if (nameEl) nameEl.addEventListener('input', function () {
      author = nameEl.value.trim();
      try { localStorage.setItem('spec-author', author); } catch (e) {}
      refresh();
    });
    Array.prototype.forEach.call(panel.querySelectorAll('.spec-au'), function (b) {
      b.addEventListener('click', function () {
        var v = b.getAttribute('data-au');
        if (v === '__other') { var name = prompt('Your name'); if (!name) return; author = name.trim(); }
        else author = v;
        try { localStorage.setItem('spec-author', author); } catch (e) {}
        Array.prototype.forEach.call(panel.querySelectorAll('.spec-au'), function (x) { x.classList.toggle('sel', x.getAttribute('data-au') === author); });
        refresh();
      });
    });
    send.addEventListener('click', function () {
      var text = ta.value.trim(); if (!text || !author) return;
      upsert({ id: uid(), specId: specId, author: author, text: text, ts: Date.now(), updatedAt: Date.now() });
      ta.value = ''; send.disabled = true; refreshThread(specId); renderChips(); pushRecords();
    });
    panel.addEventListener('click', function (e) {
      var del = e.target.closest('.spec-cm-del'); if (!del) return;
      var item = del.closest('.spec-cm-item'); var cid = item && item.getAttribute('data-cid');
      var c = records.find(function (x) { return x.id === cid; });
      if (c) { c.deleted = true; c.updatedAt = Date.now(); refreshThread(specId); renderChips(); pushRecords(); }
    });
    refresh();
  }
  function refreshThread(id) { var t = panel.querySelector('#cm-thread'); if (t) t.innerHTML = threadHtml(id); }

  // ---- sync (merge by id, newest updatedAt wins) ----
  function upsert(rec) { var i = records.findIndex(function (r) { return r.id === rec.id; }); if (i >= 0) records[i] = rec; else records.push(rec); }
  function mergeIn(incoming) {
    var byId = {}; records.concat(incoming).forEach(function (c) { if (!c || !c.id) return; var cur = byId[c.id]; if (!cur || (c.updatedAt || c.ts || 0) >= (cur.updatedAt || cur.ts || 0)) byId[c.id] = c; });
    records = Object.keys(byId).map(function (k) { return byId[k]; });
  }
  function loadRecords() { fetch(API, { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : { comments: [] }; }).then(function (d) { mergeIn(Array.isArray(d.comments) ? d.comments : []); renderChips(); if (openId) { refreshThread(openId); } }).catch(function () {}); }
  function pushRecords() { if (!API) return; fetch(API, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ comments: records }) }).then(function () { loadRecords(); }).catch(function () {}); }
  function startPoll() { if (poll || !API) return; poll = setInterval(function () { if (panel.classList.contains('open')) loadRecords(); else stopPoll(); }, 8000); }
  function stopPoll() { if (poll) { clearInterval(poll); poll = null; } }

  function closePanel() { overlay.classList.remove('open'); panel.classList.remove('open'); openId = null; editing = false; stopPoll(); }
  function setMode(v) { on = v; document.body.classList.toggle('spec-on', on); fab.classList.toggle('active', on); if (!on) closePanel(); renderChips(); }

  var observing = false, rafPending = false;
  var mo = new MutationObserver(function () {
    if (!on || rafPending) return;
    rafPending = true;
    var run = function () { if (!rafPending) return; rafPending = false; renderChips(); };
    requestAnimationFrame(run);
    // rAF never fires while the tab is hidden, which would wedge rafPending and
    // stop re-chipping for the rest of the session. The timer covers that case;
    // whichever runs first wins, so visible-tab behaviour is unchanged.
    setTimeout(run, 100);
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready);
  else ready();
})();
