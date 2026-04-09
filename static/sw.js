const CACHE_NAME = 'setter-crm-v1';
const STATIC_ASSETS = [
  '/',
  '/static/app.js',
  '/static/twilio.min.js',
  '/static/manifest.json',
];

// Install: cache static assets
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network first, fallback to cache
self.addEventListener('fetch', (event) => {
  // Skip non-GET and API calls
  if (event.request.method !== 'GET' || event.request.url.includes('/api/')) {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Push notifications
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'Setter CRM';
  const options = {
    body: data.body || 'Nueva notificacion',
    icon: '/static/icon-192.png',
    badge: '/static/icon-192.png',
    vibrate: [300, 100, 300, 100, 300],
    tag: data.tag || 'default',
    data: data.url || '/',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

// Click notification -> open app
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes('/') && 'focus' in client) return client.focus();
      }
      return clients.openWindow(event.notification.data || '/');
    })
  );
});
