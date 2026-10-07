/**
 * Service worker: precaches the app shell so the PWA installs and opens without a network.
 * It never touches `/api/*` or the game socket; those always go to the server.
 *
 * The two placeholders are filled in at build time by the plugin in vite.config.ts.
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

const VERSION = '__MAATA_SW_VERSION__';
const PRECACHE: string[] = JSON.parse('__MAATA_SW_PRECACHE__');
const CACHE = `maata-shell-${VERSION}`;

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => sw.skipWaiting()),
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith('maata-shell-') && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => sw.clients.claim()),
  );
});

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== sw.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/')) return;

  if (request.mode === 'navigate') {
    // Fresh HTML when online, so a new release is picked up at once; the cached shell offline.
    event.respondWith(
      fetch(request).catch(async () => (await caches.match('/index.html')) ?? Response.error()),
    );
    return;
  }
  // Everything else in the shell has a content hash in its name or changes with the release.
  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
});
