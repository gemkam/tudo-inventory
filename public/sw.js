/* Tiny service worker so phones can install the Driver trip form and the employee salary slip link as an app
   (home screen shortcut). It does not store anything: every request goes to the internet as normal.
   1 Nov 2026: shows salary slip notifications (push) and opens the slip when tapped. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Tudo Num', body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'Tudo Num', {
    body: d.body || '', icon: '/icons/slip-192.png', badge: '/icons/slip-192.png', data: { url: d.url || '/' }, tag: d.url || 'slip'
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.includes(url) && 'focus' in c) { c.navigate(url); return c.focus(); } }
    return self.clients.openWindow(url);
  }));
});
