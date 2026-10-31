/* Tiny service worker so phones can install the Driver trip form as an app (home screen shortcut).
   It does not store anything: every request goes to the internet as normal. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
