// Builds index.html (an artifact page body) from src/.
//   node tools/build.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => fs.readFileSync(path.join(ROOT, "src", f), "utf8");

const head = `<title>Swing Lab</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&family=Instrument+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500&display=swap">`;

const js = ["core.js", "checks.js", "ui.js", "live.js"].map(read).join("\n\n");
const out = `${head}
<style>
${read("styles.css")}
</style>

${read("markup.html")}

<script>
"use strict";
${js}
</script>
`;
fs.writeFileSync(path.join(ROOT, "index.html"), out);
new Function(js); // syntax check
console.log(`index.html: ${(out.length / 1024).toFixed(0)} KB`);

// Web version (GitHub Pages): a full document with an app manifest and an offline cache, so the live coach
// can use the camera and works on the course without signal once loaded.
const SITE = path.join(ROOT, "site");
fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(path.join(SITE, "models"), { recursive: true });
fs.mkdirSync(path.join(SITE, "vendor"), { recursive: true });
const copy = (from, to) => fs.copyFileSync(path.join(ROOT, from), path.join(SITE, to));
for (const m of ["detector", "full", "heavy"]) for (const ext of ["json", "bin"]) copy(`models/blazepose-${m}.${ext}`, `models/blazepose-${m}.${ext}`);
for (const v of ["tf.min.js", "pose-detection.min.js"]) copy(`vendor/${v}`, `vendor/${v}`);
for (const i of fs.readdirSync(path.join(ROOT, "assets"))) copy(`assets/${i}`, i);
const version = Date.now().toString(36);
const precache = ["./", "index.html", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png",
  ...["detector", "full", "heavy"].flatMap((m) => [`models/blazepose-${m}.json`, `models/blazepose-${m}.bin`]), "vendor/tf.min.js", "vendor/pose-detection.min.js"];
fs.writeFileSync(path.join(SITE, "sw.js"), `// Offline cache for Swing Lab (cache-first; refreshed on each new version).
const CACHE = "swing-lab-${version}";
const PRECACHE = ${JSON.stringify(precache)};
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
`);
fs.writeFileSync(path.join(SITE, "manifest.webmanifest"), JSON.stringify({
  name: "Swing Lab", short_name: "Swing Lab", start_url: "./", display: "standalone", background_color: "#0b1310", theme_color: "#0b1310",
  icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" }, { src: "icon-512.png", sizes: "512x512", type: "image/png" }],
}, null, 1));
const siteHead = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0b1310"><link rel="manifest" href="manifest.webmanifest"><link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Swing Lab"><meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
<script>if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));</script>
</head><body>`;
fs.writeFileSync(path.join(SITE, "index.html"), siteHead + out + "</body></html>");
fs.writeFileSync(path.join(SITE, ".nojekyll"), "");
console.log("site/ built");
