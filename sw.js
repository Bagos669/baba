/* BABA service worker: the app works offline at the court.
   App files: cache first (versioned). Server calls (Supabase) never cached. */
const VERSION = 'd714142ff2cf';
const CACHE = 'baba-' + VERSION;
const PRECACHE = ["./", "app.css", "app.js", "babinha/aura.webp", "babinha/champion.webp", "babinha/coach.webp", "babinha/happy.webp", "babinha/money.webp", "babinha/ney.webp", "babinha/red.webp", "babinha/run.webp", "babinha/scared.webp", "babinha/side.webp", "babinha/siuu.webp", "babinha/tired.webp", "babinha/wave.webp", "babinha/wink.webp", "babinha/worried.webp", "fonts/fa-solid-900.woff2", "fonts/instrument-serif-latin-400-italic.woff2", "fonts/instrument-serif-latin-400-normal.woff2", "fonts/plus-jakarta-sans-latin-400-normal.woff2", "fonts/plus-jakarta-sans-latin-500-normal.woff2", "fonts/plus-jakarta-sans-latin-600-normal.woff2", "fonts/plus-jakarta-sans-latin-700-normal.woff2", "fonts/plus-jakarta-sans-latin-800-normal.woff2", "icons/apple-touch-icon.png", "icons/favicon-32.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "manifest.webmanifest", "vendor/jspdf.umd.min.js", "vendor/supabase.js"];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE)));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('baba-') && k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// The page asks before switching versions, so a match is never interrupted.
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    // Fresh page when online, cached app when not.
    event.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put('./', copy));
      return res;
    }).catch(() => caches.match('./')));
    return;
  }
  event.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
    return res;
  })));
});
