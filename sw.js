/* Planer service worker — offline-first app shell.
   Bump CACHE_VERSION whenever styles.css / app.js / index.html change so
   clients pick up updates on their next load. */
const CACHE_VERSION = 'v1';
const CACHE = `planer-${CACHE_VERSION}`;

const SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './manifest.webmanifest',
  './fonts/inter-latin.woff2',
  './fonts/inter-latin-ext.woff2',
  './fonts/vazirmatn-arabic.woff2',
  './fonts/vazirmatn-latin.woff2',
  './fonts/vazirmatn-latin-ext.woff2',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/** Stale-while-revalidate: serve from cache instantly, refresh in background. */
async function swr(req, fallbackKey) {
  const cache = await caches.open(CACHE);
  let cached = await cache.match(req, { ignoreSearch: true });
  if (!cached && fallbackKey) cached = await cache.match(fallbackKey);
  const refresh = fetch(req)
    .then(res => { if (res && res.ok) cache.put(req, res.clone()); return res; })
    .catch(() => undefined);
  return cached || (await refresh) || new Response('Offline', { status: 503 });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;          // never touch cross-origin
  // page navigations fall back to the shell when offline
  if (req.mode === 'navigate') {
    e.respondWith(swr(req, './index.html'));
    return;
  }
  e.respondWith(swr(req));
});
