// Builds index.html (an artifact page body) from src/.
//   node tools/build.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

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
const hashOf = (files) => { const h = crypto.createHash("sha1"); for (const f of files) h.update(fs.readFileSync(path.join(SITE, f))); return h.digest("hex").slice(0, 10); };
const MODEL_FILES = ["detector", "full", "heavy"].flatMap((m) => [`models/blazepose-${m}.json`, `models/blazepose-${m}.bin`]);
const MODEL_CACHE = "swing-lab-models-" + hashOf(MODEL_FILES);   // changes only when the model files change
const SHELL = ["./", "manifest.webmanifest", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "vendor/tf.min.js", "vendor/pose-detection.min.js"];
fs.writeFileSync(path.join(SITE, "manifest.webmanifest"), JSON.stringify({
  name: "Swing Lab", short_name: "Swing Lab", start_url: "./", display: "standalone", background_color: "#0b1310", theme_color: "#0b1310",
  icons: [{ src: "icon-192.png", sizes: "192x192", type: "image/png" }, { src: "icon-512.png", sizes: "512x512", type: "image/png" }],
}, null, 1));
const siteHead = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#ffffff"><meta name="theme-color" media="(prefers-color-scheme: dark)" content="#121c18"><link rel="manifest" href="manifest.webmanifest"><link rel="apple-touch-icon" href="apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Swing Lab"><meta name="apple-mobile-web-app-status-bar-style" content="default">
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0;font:14px system-ui,sans-serif}img{max-width:100%}[hidden]{display:none!important}</style>
<script>window.SWING_SITE = { modelCache: ${JSON.stringify(MODEL_CACHE)} };
if ("serviceWorker" in navigator) addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));</script>
</head><body>`;
const FONT = '<link rel="stylesheet" href="https://fonts.googleapis.com';
if (!out.includes(FONT)) throw new Error("font link not found");
fs.writeFileSync(path.join(SITE, "index.html"), siteHead + out.replace(FONT, `<link rel="stylesheet" media="print" onload="this.media='all'" href="https://fonts.googleapis.com`) + "</body></html>");
const CACHE = "swing-lab-" + hashOf(["index.html", ...SHELL.slice(1)]);
fs.writeFileSync(path.join(SITE, "sw.js"), `// Swing Lab offline cache. Shell: versioned by content. Models: own cache, filled by the page (core.js fetchModel).
const CACHE = "${CACHE}", MODELS = "${MODEL_CACHE}";
const SHELL = ${JSON.stringify(SHELL)};
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
`);
fs.writeFileSync(path.join(SITE, ".nojekyll"), "");
console.log("site/ built");
