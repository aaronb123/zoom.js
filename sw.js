// Swing Lab offline cache. Shell: versioned by content. Models: own cache, filled by the page (core.js fetchModel).
const CACHE = "swing-lab-033ac3496e", MODELS = "swing-lab-models-19f421e0c5";
const SHELL = ["./","manifest.webmanifest","icon-192.png","icon-512.png","apple-touch-icon.png","vendor/tf.min.js","vendor/pose-detection.min.js"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith("swing-lab-") && k !== CACHE && k !== MODELS).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const req = e.request, u = new URL(req.url);
  if (req.method !== "GET") return;
  if (req.mode === "navigate") {   // network first (3 s), so a refresh shows a new build; cached shell offline or on a stalled signal
    const net = fetch(req).then((r) => { if (r.ok) { const c = r.clone(); caches.open(CACHE).then((k) => k.put("./", c)); } return r; });
    e.respondWith(Promise.race([net.catch(() => null), new Promise((r) => setTimeout(r, 3000, null))]).then((r) => r || caches.match("./")).then((r) => r || net));
    return;
  }
  if (!(u.origin === location.origin || u.hostname.endsWith("gstatic.com") || u.hostname === "fonts.googleapis.com")) return;
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => {
    if ((res.ok || res.type === "opaque") && !u.pathname.includes("/models/")) { const c = res.clone(); caches.open(CACHE).then((k) => k.put(req, c)); }
    return res;
  })));   // no HTML fallback for scripts/models: a network error lets the page try its next source
});
