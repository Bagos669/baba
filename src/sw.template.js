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

// Live game notifications (start, goals, saves, end) sent by the live-push function.
self.addEventListener('push', event => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { title: 'BABA', body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(d.title || 'BABA', {
    body: d.body || '',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    icon: 'icons/icon-192.png',
    badge: 'icons/favicon-32.png',
    data: { url: d.url || './' },
    vibrate: d.kind === 'goal' ? [80, 40, 80] : [60]
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const app = wins.find(w => w.url.startsWith(self.registration.scope));
    if (app) { await app.focus(); app.postMessage({ type: 'open', url }); return; }
    await self.clients.openWindow(url);
  })());
});
