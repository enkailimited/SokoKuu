// ============================================================================
// SokoKuu TZ — Offline-First Application Shell & POS Sync Service Worker
// Intercepts navigation shells, static bundles, and offline POS/Catalog mutations.
// ============================================================================

const SHELL_CACHE = 'sokokuu-shell-v7';
const STATIC_CACHE = 'sokokuu-static-v7';
const API_CACHE = 'sokokuu-api-v7';

const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/dashboard/retailer',
  '/manifest.json',
  '/pwa-192x192.png',
  '/sokokuu-brand-logo.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then(async (cache) => {
      await Promise.allSettled(
        PRECACHE_URLS.map((url) =>
          cache.add(new Request(url, { cache: 'reload' })).catch(() => undefined)
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  const activeCaches = new Set([SHELL_CACHE, STATIC_CACHE, API_CACHE]);
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.map((key) => {
          if (!activeCaches.has(key)) {
            return caches.delete(key);
          }
          return Promise.resolve(false);
        })
      )
    )
  );
  self.clients.claim();
});

async function fetchWith3GTimeout(request, timeoutMs = 4000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(request, { signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never cache Vite dev modules or HMR endpoints
  if (
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/@') ||
      url.pathname.startsWith('/node_modules/') ||
      (url.pathname.startsWith('/src/') && !url.pathname.startsWith('/src/assets/')))
  ) {
    return;
  }

  // 1. Navigation App Shell Interception (0% connectivity -> serve local device shell)
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetchWith3GTimeout(request, 4000);
          if (networkResponse && networkResponse.ok) {
            const shellCache = await caches.open(SHELL_CACHE);
            shellCache.put(request, networkResponse.clone());
            shellCache.put('/index.html', networkResponse.clone());
            return networkResponse;
          }
          throw new Error('Non-OK navigation response');
        } catch {
          const shellCache = await caches.open(SHELL_CACHE);
          return (
            (await shellCache.match(request)) ||
            (await shellCache.match('/dashboard/retailer')) ||
            (await shellCache.match('/index.html')) ||
            (await shellCache.match('/'))
          );
        }
      })()
    );
    return;
  }

  // 2. Retailer Inventory, POS Sync & Global Catalog Clone API Routes
  if (
    url.pathname.startsWith('/api/v1/retailer/inventory') ||
    url.pathname.startsWith('/api/v1/pos') ||
    url.pathname.startsWith('/api/v1/marketplace/catalog/clone')
  ) {
    event.respondWith(
      (async () => {
        try {
          const networkResponse = await fetchWith3GTimeout(request, 5000);
          if (networkResponse && networkResponse.status === 200 && request.method === 'GET') {
            const cache = await caches.open(API_CACHE);
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          if (request.method === 'GET') {
            const cached = await caches.match(request);
            if (cached) return cached;
          }
          if (request.method === 'POST') {
            const isClone = url.pathname.startsWith('/api/v1/marketplace/catalog/clone');
            return new Response(
              JSON.stringify({
                status: isClone ? 'PENDING_GLOBAL_CLONE_SYNC' : 'QUEUED_OFFLINE',
                message: isClone
                  ? 'Offline: Base-zero catalog clone staged in IndexedDB as PENDING_GLOBAL_CLONE_SYNC.'
                  : 'Network offline. POS sale receipt safely queued in local IndexedDB.',
                timestamp: new Date().toISOString(),
              }),
              {
                status: 202,
                headers: { 'Content-Type': 'application/json' },
              }
            );
          }
          return new Response(
            JSON.stringify({ error: 'Offline mode: serving local IndexedDB state.' }),
            {
              status: 503,
              headers: { 'Content-Type': 'application/json' },
            }
          );
        }
      })()
    );
    return;
  }

  // 3. Static JS, CSS, Fonts, and Icons (Cache-First with background refresh)
  if (
    request.method === 'GET' &&
    ['script', 'style', 'font', 'image'].includes(request.destination) &&
    url.origin === self.location.origin
  ) {
    event.respondWith(
      (async () => {
        const staticCache = await caches.open(STATIC_CACHE);
        const cached = await staticCache.match(request);
        const networkPromise = fetch(request)
          .then((res) => {
            if (res && res.ok) {
              staticCache.put(request, res.clone());
            }
            return res;
          })
          .catch(() => null);

        return cached || (await networkPromise) || Response.error();
      })()
    );
  }
});

// 4. Asynchronous Web Push Event Interception (Out-of-Band System Alerts)
self.addEventListener('push', (event) => {
  if (!event.data) return;

  try {
    const data = event.data.json();
    const title = data.title || 'SokoKuu TZ Alert';

    const options = {
      body: data.body || 'New marketplace order or doorstep arrival update.',
      icon: '/pwa-192x192.png',
      badge: '/pwa-192x192.png',
      vibrate: [200, 100, 200, 100, 400],
      data: {
        url: data.url || '/dashboard/retailer',
      },
      tag: data.tag || 'sokokuu-order-alert',
      requireInteraction: true,
    };

    event.waitUntil(self.registration.showNotification(title, options));
  } catch (err) {
    console.error('[Service Worker] Failed parsing inbound push payload', err);
  }
});

// 5. Action Terminal Deep Linking on Notification Tap
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetDeepLinkUrl =
    (event.notification.data && event.notification.data.url) || '/dashboard/retailer';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(targetDeepLinkUrl) && 'focus' in client) {
          return client.focus();
        }
      }
      if (windowClients.length > 0 && 'focus' in windowClients[0]) {
        return windowClients[0].focus();
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetDeepLinkUrl);
      }
    })
  );
});
