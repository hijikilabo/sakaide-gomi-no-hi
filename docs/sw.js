const CACHE = 'sakaide-gominohi-v4-4';
const CORE = ['./', './index.html', './style.css', './schedule.js', './geo.js', './release.js',
  './map.js', './app.js', './manifest.webmanifest', './assets/seto-ohashi.webp',
  './assets/app-icon-32.png', './apple-touch-icon.png', './assets/app-icon-192.png', './assets/app-icon-512.png'];
const coreURLs = new Set(CORE.map(path => new URL(path, self.registration.scope).href));

self.addEventListener('install', event => event.waitUntil(
  caches.open(CACHE).then(cache => cache.addAll(CORE.map(url => new Request(url, {cache: 'reload'}))))
    .then(() => self.skipWaiting())
));
self.addEventListener('activate', event => event.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('sakaide-gominohi-') && key !== CACHE)
    .map(key => caches.delete(key)))).then(() => self.clients.claim())
));
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (request.mode === 'navigate' && url.search && url.origin === self.location.origin) {
    url.search = '';
    if (url.href === new URL('./', self.registration.scope).href
      || url.href === new URL('./index.html', self.registration.scope).href) {
      event.respondWith(fetch(request).catch(async () => {
        const cache = await caches.open(CACHE);
        return (await cache.match(url.href)) || Response.error();
      }));
      return;
    }
  }
  if (!coreURLs.has(request.url)) return;
  // Cache one coherent version of the shell. Reviewed data are validated and stored by the app.
  event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(request)) || fetch(request)));
});
