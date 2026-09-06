/* Yodoku service worker — offline-first app shell */
const CACHE = 'yodoku-v6';
const SHELL = ['./', './index.html', './app.js', './engine.js', './manifest.json', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/apple-touch-icon.png', './assets/ko-icon.svg', ...['yo','ko'].flatMap(character => ['x','clear','place','error','hint','win'].map(event => `./assets/sounds/${character}-${event}.wav`))];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL.map(url => new Request(url, { cache: 'reload' })))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('yodoku-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Fonts may refresh independently; the game scripts must stay one version.
  if (url.origin !== location.origin) {
    e.respondWith((async () => {
      try { const res = await fetch(req); if (res.ok || res.type === 'opaque') { const cache = await caches.open(CACHE); await cache.put(req, res.clone()); } return res; }
      catch { return await caches.match(req) || Response.error(); }
    })());
    return;
  }
  // The install event caches the whole release before activating. Do not replace
  // individual scripts in that cache while the old release is still in use.
  const shellUrl = new URL(url.pathname, self.location.origin).href;
  const isShell = SHELL.some(path => new URL(path, self.location.href).href === shellUrl);
  if (!isShell) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE), cached = await cache.match(shellUrl);
    return cached || fetch(req);
  })());
});
