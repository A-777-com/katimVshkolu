'use strict';

var CACHE_NAME = 'katim-v1';

var PRECACHE_URLS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
];

// Install: precache core assets
self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(PRECACHE_URLS);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

// Activate: clean old caches
self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (name) {
          return name !== CACHE_NAME;
        }).map(function (name) {
          return caches.delete(name);
        })
      );
    }).then(function () {
      return self.clients.claim();
    })
  );
});

// Fetch: cache first, then network
self.addEventListener('fetch', function (event) {
  var url = event.request.url;

  // Only handle GET requests
  if (event.request.method !== 'GET') return;

  // For tile requests: cache with network fallback, dynamic caching
  if (url.indexOf('tile.openstreetmap.org') !== -1) {
    event.respondWith(
      caches.match(event.request).then(function (cached) {
        if (cached) return cached;
        return fetch(event.request).then(function (response) {
          if (response && response.status === 200) {
            var clone = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              // Limit tile cache size: just cache it, browser handles eviction
              cache.put(event.request, clone);
            });
          }
          return response;
        }).catch(function () {
          // Return empty response for offline tiles
          return new Response('', { status: 408, statusText: 'Offline' });
        });
      })
    );
    return;
  }

  // For API requests (routing, search): network only, no cache
  if (url.indexOf('nominatim') !== -1 ||
      url.indexOf('routing') !== -1 ||
      url.indexOf('router.project-osrm') !== -1 ||
      url.indexOf('valhalla') !== -1) {
    event.respondWith(
      fetch(event.request).catch(function () {
        return new Response(JSON.stringify({ error: 'offline' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      })
    );
    return;
  }

  // For everything else: cache first, then network
  event.respondWith(
    caches.match(event.request).then(function (cached) {
      if (cached) return cached;
      return fetch(event.request).then(function (response) {
        if (response && response.status === 200 && response.type === 'basic') {
          var clone = response.clone();
          caches.open(CACHE_NAME).then(function (cache) {
            cache.put(event.request, clone);
          });
        }
        return response;
      });
    }).catch(function () {
      // Fallback for navigation requests
      if (event.request.mode === 'navigate') {
        return caches.match('./index.html');
      }
      return new Response('Offline', { status: 503 });
    })
  );
});