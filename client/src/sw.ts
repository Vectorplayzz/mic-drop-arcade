/**
 * Service worker: precaches the app shell so the PWA installs and opens without a network.
 * It never touches `/api/*` or the game socket; those always go to the server.
 *
 * The two placeholders are filled in at build time by the plugin in vite.config.ts.
 */
const sw = self as unknown as ServiceWorkerGlobalScope;

const VERSION = '__MAATA_SW_VERSION__';
const PRECACHE: string[] = JSON.parse('__MAATA_SW_PRECACHE__');
/** Hashed art and music of this release: cached on first use, kept until no longer listed. */
const MEDIA = new Set<string>(JSON.parse('__MAATA_SW_MEDIA__'));
const CACHE = `maata-shell-${VERSION}`;
const MEDIA_CACHE = 'maata-media';

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
      .then(() => caches.open(MEDIA_CACHE))
      .then(async (cache) => {
        // Art and music from older releases (different hashes) are dropped.
        for (const request of await cache.keys()) {
          if (!MEDIA.has(new URL(request.url).pathname)) await cache.delete(request);
        }
      })
      .then(() => sw.clients.claim()),
  );
});

async function fromMedia(request: Request): Promise<Response> {
  const cache = await caches.open(MEDIA_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') await cache.put(request, response.clone());
  return response;
}

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
  if (MEDIA.has(url.pathname)) {
    event.respondWith(fromMedia(request));
    return;
  }
  // Everything else in the shell has a content hash in its name or changes with the release.
  event.respondWith(caches.match(request).then((cached) => cached ?? fetch(request)));
});
