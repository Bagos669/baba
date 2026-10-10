/* BABA service worker: the app works offline at the court.
   Page and app files come from the same versioned cache, so a new page
   never runs with old code. Server calls (Supabase) are never cached. */
const VERSION = 'ff57c8fa556a';
const CACHE = 'baba-' + VERSION;
const PRECACHE = ["./", "app.css?v=46f5f78461", "app.js?v=e45d9f7d19", "babinha/aura.webp", "babinha/champion.webp", "babinha/coach.webp", "babinha/happy.webp", "babinha/money.webp", "babinha/ney.webp", "babinha/red.webp", "babinha/run.webp", "babinha/scared.webp", "babinha/side.webp", "babinha/siuu.webp", "babinha/tired.webp", "babinha/wave.webp", "babinha/wink.webp", "babinha/worried.webp", "fonts/fa-solid-900.woff2", "fonts/instrument-serif-latin-400-italic.woff2", "fonts/instrument-serif-latin-400-normal.woff2", "fonts/plus-jakarta-sans-latin-400-normal.woff2", "fonts/plus-jakarta-sans-latin-500-normal.woff2", "fonts/plus-jakarta-sans-latin-600-normal.woff2", "fonts/plus-jakarta-sans-latin-700-normal.woff2", "fonts/plus-jakarta-sans-latin-800-normal.woff2", "icons/apple-touch-icon.png", "icons/favicon-32.png", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "manifest.webmanifest", "vendor/jspdf.umd.min.js", "vendor/qrcode.min.js", "vendor/supabase.js"];

self.addEventListener('install', event => {
  // Take over as soon as the new version is fully cached; the page decides when to reload.
  // cache: 'reload' skips the browser's HTTP cache, so every file is from this version.
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(PRECACHE.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
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
  // The support panel always comes from the network (it needs the server anyway).
  if (/\/admin(\.html|\.js)?$/.test(url.pathname)) return;
  if (req.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(c => c.match('./')).then(hit => hit || fetch(req)));
    return;
  }
  event.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) c.put(req, res.clone());
    return res;
  }))));
});
