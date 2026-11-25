/* TimerMask service worker: full offline support.
   Cache-first from a versioned precache. To release an update, bump VERSION (every release must change this file). */
const VERSION = '3.0.1';
const CACHE = 'timermask-v' + VERSION;
const CORE = [
  './', './index.html', './styles.css', './i18n.js', './engine.js', './config.js', './native.js', './app.js',
  './logo-header.png', './icon-180.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png',
  './manifest.webmanifest', './privacy.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('timermask-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // ignoreSearch: "app.js?v=1" and "app.js" are the same file (this was the v2.5 offline bug).
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      if (req.mode === 'navigate') {
        const page = await cache.match('./index.html', { ignoreSearch: true });
        if (page) return page;
      }
      return new Response('Offline', { status: 503, statusText: 'Offline', headers: { 'Content-Type': 'text/plain' } });
    }
  })());
});
