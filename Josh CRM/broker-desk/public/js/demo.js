/* Broker Desk demo helpers: on a workspace flagged demo, a small bar in the corner with "Send
 * feedback" (saved with the screen it was sent from, read under Settings, Feedback) and "Reload data"
 * (puts the made-up book back the way it started, a part at a time with progress). */
(function () {
  'use strict';
  var esc = BD.esc;
  var isDemo = function () { var me = BD.state.me; return !!(me && me.settings && me.settings.demo); };

  BD.renderDemoBar = function () {
    var root = document.getElementById('demo-root'); if (!root) return;
    if (!isDemo()) { root.innerHTML = ''; return; }
    root.innerHTML = '<div class="demo-bar" data-spec-id="demo-bar"><span class="db-tag" data-tip="Made-up leads and deals. Calls and texts are simulated.">Demo</span>' +
      '<button class="db-btn" data-act="demo-feedback">' + BD.ICON.msg + 'Send feedback</button>' +
      (BD.isMgr() ? '<button class="db-btn" data-act="demo-reset">Reload data</button>' : '') + '</div>';
  };

  BD.on('demo-feedback', function () {
    var where = (document.querySelector('.page h1') || {}).textContent || '';
    BD.modal({
      title: 'Send feedback', sub: 'What would you change, add or fix? It goes to the team building Broker Desk, along with the screen you are on.',
      body: '<label class="field"><span>Your note</span><textarea name="text" rows="6" placeholder="For example: the dialer should show the last note before it connects." autofocus></textarea></label>' +
        (where ? '<p class="muted small">Screen: ' + esc(where) + '</p>' : ''),
      submit: 'Send',
      onSubmit: function (f) {
        var text = f.text.value.trim();
        if (!text) return Promise.reject(new Error('Write what you would change first.'));
        return BD.api('/api/feedback', { body: { text: text, route: location.hash + (where ? ' (' + where + ')' : '') } }).then(function () { BD.toast('Thanks. Your note was sent.'); });
      }
    });
  });

  BD.on('demo-reset', function () {
    BD.confirm('Reload the demo data?', 'Leads, calls, texts, deals and settings go back to how the demo started, with fresh dates. Logins and feedback stay as they are.', 'Reload data', function () {
      return run();
    });
  });
  function run() {
    BD.modal({ title: 'Reloading the demo', body: '<div class="progress"><i id="dr-bar" style="width:4%"></i></div><p class="muted small" id="dr-txt">Starting...</p>', foot: false });
    var at = null;
    function step(i) {
      return BD.api('/api/demo/reset', { body: { part: i, at: at } }).then(function (r) {
        at = r.at;
        var pct = Math.round((i + 1) / r.parts * 100), bar = document.getElementById('dr-bar'), txt = document.getElementById('dr-txt');
        if (bar) bar.style.width = pct + '%';
        if (txt) txt.textContent = pct + '% done';
        return r.done ? null : step(i + 1);
      });
    }
    return step(0).then(function () {
      return BD.reloadMe();
    }).then(function () {
      BD.closeModal(); BD.toast('Demo data reloaded');
      if (BD.loadListCounts) BD.loadListCounts();
      if (location.hash === '#/inbox') BD.render(); else BD.go('#/inbox');
    }, function (err) {
      BD.closeModal(); BD.toast('The reload stopped: ' + (err && err.message || 'try again') + ' Run it again to finish.', { bad: true, long: true });
    }).then(function () { return true; });
  }
})();
