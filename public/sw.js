// Service worker minimal : réseau d'abord, cache en secours pour l'interface.
const CACHE = 'playroom-v2';
const SHELL = ['/', '/style.css', '/app.js', '/lib/fx.js', '/lib/input.js', '/games/arena.js', '/games/clash.js', '/games/defense.js', '/icon.svg'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/ws') || url.pathname.startsWith('/api')) return;
  e.respondWith(
    fetch(e.request).then(r => {
      if (r.ok && SHELL.includes(url.pathname)) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
      return r;
    }).catch(() => caches.match(url.pathname.startsWith('/c/') ? '/' : e.request))
  );
});
