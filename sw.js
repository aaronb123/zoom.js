// Offline cache for Swing Lab (cache-first; refreshed on each new version).
const CACHE = "swing-lab-mvb8m7wu";
const PRECACHE = ["./","index.html","manifest.webmanifest","icon-192.png","icon-512.png","apple-touch-icon.png","models/blazepose-detector.json","models/blazepose-detector.bin","models/blazepose-full.json","models/blazepose-full.bin","models/blazepose-heavy.json","models/blazepose-heavy.bin","vendor/tf.min.js","vendor/pose-detection.min.js"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || !(u.origin === location.origin || u.hostname === "cdn.jsdelivr.net" || u.hostname.endsWith("gstatic.com") || u.hostname === "fonts.googleapis.com")) return;
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
    if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match("index.html"))));
});
