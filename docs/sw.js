/* Regel-Depot – Service Worker: nimmt Push-Nachrichten an und zeigt sie als Mitteilung. Kein Caching. */
self.addEventListener('install', function () { self.skipWaiting(); });
self.addEventListener('activate', function (e) { e.waitUntil(self.clients.claim()); });

self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: 'Regel-Depot', body: e.data ? e.data.text() : '' }; }
  var title = data.title || 'Regel-Depot';
  var opts = {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    tag: data.tag || 'regel-depot',
    renotify: true,
    timestamp: data.ts ? Date.parse(data.ts) : Date.now(),
    data: { url: data.url || './' }
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var target = new URL((e.notification.data && e.notification.data.url) || './', self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) { var c = list[i]; if (c.url.indexOf(self.registration.scope) === 0 && 'focus' in c) { c.navigate && c.navigate(target); return c.focus(); } }
    if (self.clients.openWindow) return self.clients.openWindow(target);
  }));
});

/* Wenn der Push-Dienst die Anmeldung erneuert, kann die Seite sie beim nächsten Öffnen neu anzeigen */
self.addEventListener('pushsubscriptionchange', function (e) {
  e.waitUntil(self.clients.matchAll({ type: 'window' }).then(function (list) { list.forEach(function (c) { c.postMessage({ type: 'pushsubscriptionchange' }); }); }));
});
