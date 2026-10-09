/* BABA service worker: the app works offline at the court.
   Page and app files come from the same versioned cache, so a new page
   never runs with old code. Server calls (Supabase) are never cached. */
const VERSION = '__VERSION__';
const CACHE = 'baba-' + VERSION;
const PRECACHE = __PRECACHE__;

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
  if (req.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(c => c.match('./')).then(hit => hit || fetch(req)));
    return;
  }
  event.respondWith(caches.open(CACHE).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok) c.put(req, res.clone());
    return res;
  }))));
});
