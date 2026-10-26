// ISO Desk service worker: shows follow-up alerts pushed by the alerts worker, and opens the
// desk on the right shop or deal when one is tapped. No offline caching, so a deploy is never stale.
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { title: 'ISO Desk', body: e.data ? e.data.text() : '' }; }
  var ios = /iPhone|iPad|iPod/.test(self.navigator.userAgent || '');
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    // With the desk open and on screen, it shows its own alert, so a due follow-up is not shown
    // twice. A test alert always shows, and iPhones must always get one.
    var focused = list.some(function (c) { return c.focused && c.visibilityState === 'visible'; });
    if (focused && !ios && d.tag !== 'test') { list.forEach(function (c) { c.postMessage({ pushed: d }); }); return null; }
    return self.registration.showNotification(d.title || 'Follow-up due', {
      body: d.body || '', tag: d.tag || 'isodesk', renotify: true, data: { url: d.url || '/' },
      icon: '/icons/icon-192.png', badge: '/icons/badge-96.png'
    });
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i], path = new URL(c.url).pathname;
      if (path === '/' || path === '/index.html') { c.postMessage({ open: url }); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
