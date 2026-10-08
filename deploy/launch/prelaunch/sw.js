// Retires the game's offline service worker on this address. Browsers that opened the game
// here before keep serving its cached copy until this replaces it: it clears every cache,
// unregisters itself and reloads open tabs, so they fetch the current page from the server.
self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    (async function () {
      var keys = await caches.keys();
      await Promise.all(keys.map(function (k) { return caches.delete(k); }));
      await self.registration.unregister();
      var tabs = await self.clients.matchAll({ type: 'window' });
      tabs.forEach(function (tab) { tab.navigate(tab.url); });
    })(),
  );
});
