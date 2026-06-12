// Cyber Treehole service worker.
// Deliberately minimal so it can never "trap" the site:
//   - Page navigations are NOT intercepted → every page load goes straight to
//     the network, exactly as it did before the PWA existed. (Intercepting
//     navigations is what kept Safari/WebKit from opening the site when a
//     redirected or stale response was returned for a navigation request.)
//   - /api/* is never touched → posts/reads are always live.
//   - Only static assets (icons, manifest) are cached, for speed/offline icons.
// Bump VERSION on any change; old caches are purged on activate.
const VERSION = "v2";
const CACHE = `treehole-${VERSION}`;
const SHELL = ["/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .catch(() => {})        // never let a missing asset block installation
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  // Leave everything to the network except same-origin GETs for static assets.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") return;        // pages always load from network
  if (url.pathname.startsWith("/api/")) return;     // live data only, never cached

  // Static assets: serve from cache immediately, refresh in the background.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
