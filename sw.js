/* Global Monitor Service Worker
   ────────────────────────────────────────────────
   Übernimmt das Anzeigen von Notifications für Daily-Briefings.
   Echte Server-Push (auch bei geschlossenem Browser) bräuchte VAPID
   und einen Push-Backend - hier nicht implementiert.
*/

self.addEventListener('install', e => { self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(self.clients.claim()); });

self.addEventListener('message', (event) => {
  const { type, payload } = event.data || {};
  if (type === 'show-notification') {
    self.registration.showNotification(payload.title || 'Global Monitor', {
      body: payload.body || '',
      icon: payload.icon || '/favicon.ico',
      tag: payload.tag || 'gm-briefing',
      data: payload.data || {},
      requireInteraction: !!payload.requireInteraction,
    });
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) return c.focus();
      }
      return self.clients.openWindow('/');
    })
  );
});
