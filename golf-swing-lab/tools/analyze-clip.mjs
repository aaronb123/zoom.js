// Run Swing Lab headless on a clip and print the analysis as JSON.
//   node tools/analyze-clip.mjs <video> [--view face|dtl|auto] [--hand R|L] [--slowmo 1|4|8] [--model full] [--height cm] [--shots dir]
import path from "node:path";
import fs from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "./serve.mjs";

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require("playwright")); } catch { ({ chromium } = require(path.join(process.env.NODE_PATH || "/usr/local/lib/node_modules", "playwright"))); }

const args = process.argv.slice(2);
const clip = path.resolve(args[0] || "");
const opt = (k, d) => { const i = args.indexOf("--" + k); return i > 0 ? args[i + 1] : d; };
if (!fs.existsSync(clip)) { console.error("usage: analyze-clip.mjs <video>"); process.exit(1); }

const server = createServer().listen(0);
const port = server.address().port;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, args: ["--autoplay-policy=no-user-gesture-required", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on("console", (m) => { if (["error", "warning"].includes(m.type())) console.error("[page]", m.text()); });
const qs = new URLSearchParams(); if (opt("model")) qs.set("model", opt("model"));
const q = qs.toString() ? "?" + qs : "";
await page.goto(`http://localhost:${port}/${q}`);
await page.evaluate(() => window.__swingLab.engines.ready);
console.error("engine:", await page.textContent("#engineText"));
await page.evaluate(({ view, hand, slowmo, height }) => {
  const set = (id, v) => { const el = document.querySelector(id); if (el && v != null) { el.value = v; el.dispatchEvent(new Event("change")); } };
  set("#view", view); set("#hand", hand); set("#slowmo", slowmo); set("#heightCm", height);
}, { view: opt("view", "auto"), hand: opt("hand", "R"), slowmo: opt("slowmo", "0"), height: opt("height") });
const t0 = Date.now();
await page.setInputFiles("#filePick", clip);
await page.waitForFunction(() => window.__swingLab.last || !document.querySelector("#errorBox").hidden, null, { timeout: 15 * 60 * 1000, polling: 500 });
const err = await page.evaluate(() => document.querySelector("#errorBox").hidden ? null : document.querySelector("#errorBox").textContent);
const out = err ? { error: err } : { seconds: (Date.now() - t0) / 1000, swings: await page.evaluate(() => window.__swingLab.last) };
const shots = opt("shots");
if (shots) {
  fs.mkdirSync(shots, { recursive: true });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(shots, "report.png"), fullPage: true });
  const thumbs = await page.evaluate(() => (window.__swingLab.state.result?.swings || []).map((s) => s.thumbs));
  thumbs.forEach((t, i) => Object.entries(t || {}).forEach(([k, url]) => fs.writeFileSync(path.join(shots, `swing${i + 1}-${k}.jpg`), Buffer.from(url.split(",")[1], "base64"))));
}
console.log(JSON.stringify(out, null, 2));
await browser.close();
server.close();
