/**
 * IRONFLOW CLUB - Service Worker
 * Bump CACHE_VERSION whenever you deploy updates
 */

const CACHE_VERSION = 'v112';
const CACHE_NAME = `ironflow-${CACHE_VERSION}`;

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/leaderboard.html',
  '/progress.html',
  '/404.html',
  '/manifest.json',
  '/assets/css/main.css',
  '/assets/css/leaderboard.css',
  '/assets/css/progress.css',
  '/assets/css/loader.css',
  '/assets/js/main.js',
  '/assets/js/leaderboard.js',
  '/assets/js/progress.js',
  '/assets/js/data-handler.js',
  '/assets/js/utils.js',
  '/assets/js/translations.js',
  '/tournament.html',
  '/admin.html',
  '/auth-guard.js',
  '/running.html'
];

// ── Install: cache all static assets ──────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting()) // activate immediately, don't wait for tabs to close
  );
});

// ── Activate: delete old caches, then force-reload all open tabs ──
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key.startsWith('ironflow-') && key !== CACHE_NAME)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim()) // take control of all open tabs immediately
      .then(() => {
        // 🔑 Force-reload every open tab/window so they get the new assets
        return self.clients.matchAll({ type: 'window' }).then(clients => {
          clients.forEach(client => client.navigate(client.url));
        });
      })
  );
});

// ── Fetch: network first for data, cache first for assets ──────
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  // Never cache proxy / API calls
  if (url.hostname === 'ironflow-proxy.syed-mujeebprojects.workers.dev') {
    event.respondWith(fetch(event.request));
    return;
  }

  // Always go network-first for Google Sheets data
  if (url.hostname === 'opensheet.elk.sh') {
    event.respondWith(
      fetch(event.request)
        .catch(() => new Response(JSON.stringify([]), {
          headers: { 'Content-Type': 'application/json' }
        }))
    );
    return;
  }

  // Network-first for HTML pages so updates are always fresh
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Cache-first for all other static assets (CSS, JS, images)
  event.respondWith(
    caches.match(event.request)
      .then(cached => {
        if (cached) return cached;
        return fetch(event.request).then(response => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
          return response;
        });
      })
  );
});