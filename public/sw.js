const CACHE_NAME = 'aldridge-autos-hub-v32.2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css?v=30.0',
  '/app.js?v=30.0',
  '/storefront-menu.js?v=30.0',
  '/sourcing-storefront.js?v=30.0',
  '/vin-aggregator-ui.js?v=30.0',
  '/dvi-portal.js?v=30.0',
  '/wave1-studio.js?v=30.0',
  '/manifest.webmanifest',
  '/assets/aldridge-crest.jpg?v=11',
  '/assets/app-icon.jpg?v=11',
  '/assets/aldridge-shop-hero.jpg?v=11',
  '/assets/aldridge-lot-uhaul.jpg?v=11',
  '/assets/og-banner.jpg?v=11',
  '/assets/oem-parts.jpg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/uploads/') ||
    url.pathname.startsWith('/review-thumbs/') ||
    url.pathname === '/business-plan' ||
    url.pathname === '/business-plan/'
  ) {
    return;
  }
  const isAppShell =
    event.request.mode === 'navigate' ||
    url.pathname === '/' ||
    url.pathname === '/review' ||
    url.pathname === '/portal' ||
    url.pathname.endsWith('.html') ||
    url.pathname.endsWith('.js') ||
    url.pathname.endsWith('.css');
  event.respondWith(
    fetch(event.request, isAppShell ? { cache: 'no-store' } : undefined).catch(() => caches.match(event.request))
  );
});

self.addEventListener('push', (event) => {
  let payload = {
    title: "Aldridge Auto's",
    body: 'New shop special, OEM part arrival, or appointment update available!',
    url: '/'
  };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (_) {}

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/assets/aldridge-crest.jpg',
      badge: '/assets/aldridge-crest.jpg',
      data: { url: payload.url || '/' }
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
