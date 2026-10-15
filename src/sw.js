/* Glorious Anchor service worker: app shell cached for offline use, data network-first. */
const VERSION = '__BUILD__';
const SHELL_CACHE = `ga-shell-${VERSION}`;
const DATA_CACHE = 'ga-data';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'assets/anchor.svg', 'assets/icon-192.png', 'assets/icon-512.png', 'assets/site.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ga-shell-') && k !== SHELL_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never cache third-party images/feeds
  if (url.pathname.includes('/admin/')) return; // the admin always loads fresh and talks to GitHub directly

  // Headlines: fresh when online, last copy when offline.
  if (url.pathname.includes('/data/')) {
    event.respondWith(
      fetch(req).then((res) => {
        if (res.ok) caches.open(DATA_CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => caches.match(req)),
    );
    return;
  }

  // App shell: cache first, refresh in the background.
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then((cached) => {
      const network = fetch(req).then((res) => {
        if (res.ok) caches.open(SHELL_CACHE).then((c) => c.put(req, res.clone()));
        return res;
      }).catch(() => cached);
      return cached || network;
    }),
  );
});
