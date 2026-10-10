const CACHE = 'spendo-v40';
const CORE = ['/', '/index.html', '/styles.css', '/budget-core.js', '/backup-core.js', '/app.js', '/manifest.webmanifest', '/brand-assets/pulnora-apple-touch-icon-180.png', '/brand-assets/pulnora-icon-192.png', '/brand-assets/pulnora-icon-512.png', '/brand-assets/pulnora-icon-maskable-512.png', '/brand-assets/pulnora-icon.svg', '/brand-assets/pulnora-favicon-32.png', '/brand-assets/pulnora-favicon-48.png'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(CORE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(
      keys.filter(key => key !== CACHE).map(key => caches.delete(key))
    )),
    self.clients.claim()
  ]));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request)
      .then(response => {
        if (new URL(event.request.url).origin === location.origin) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match('/index.html'))
    )
  );
});
