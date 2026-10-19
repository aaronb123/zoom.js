/* ============================================================
   Swing Lab core: pose engine, video sampling, swing finding,
   joint cleaning, swing events and tracking quality.
   ============================================================ */

const CONFIG = {
  tf: [
    "https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/tensorflow/4.22.0/tf.min.js",
    "./vendor/tf.min.js",
  ],
  poseDetection: [
    "https://cdn.jsdelivr.net/npm/@tensorflow-models/pose-detection@2.1.3/dist/pose-detection.min.js",
    "./vendor/pose-detection.min.js",
  ],
  models: "./models/blazepose-",
  modelMB: { detector: 5.9, full: 6.3, heavy: 27.5 },
};
const TORSO_CM = 50;          // shoulder-to-hip distance used to turn pixels into rough centimetres
const BP_NAMES = {
  nose: "nose", lear: "left_ear", rear: "right_ear", lsho: "left_shoulder", rsho: "right_shoulder", lelb: "left_elbow", relb: "right_elbow",
  lwri: "left_wrist", rwri: "right_wrist", lidx: "left_index", ridx: "right_index", lhip: "left_hip", rhip: "right_hip",
  lkne: "left_knee", rkne: "right_knee", lank: "left_ankle", rank: "right_ankle", lheel: "left_heel", rheel: "right_heel", ltoe: "left_foot_index", rtoe: "right_foot_index",
};
const KEYS = Object.keys(BP_NAMES);
const PAIRS = [["lear", "rear"], ["lelb", "relb"], ["lwri", "rwri"], ["lidx", "ridx"], ["lkne", "rkne"], ["lank", "rank"], ["lheel", "rheel"], ["ltoe", "rtoe"]];
const BONES = [["lsho", "rsho"], ["lsho", "lelb"], ["lelb", "lwri"], ["rsho", "relb"], ["relb", "rwri"], ["lsho", "lhip"], ["rsho", "rhip"], ["lhip", "rhip"],
  ["lhip", "lkne"], ["lkne", "lank"], ["rhip", "rkne"], ["rkne", "rank"], ["lank", "lheel"], ["lheel", "ltoe"], ["lank", "ltoe"], ["rank", "rheel"], ["rheel", "rtoe"], ["rank", "rtoe"]];
const EVENTS = [["address", "Address"], ["halfBack", "Halfway back"], ["top", "Top"], ["halfDown", "Halfway down"], ["impact", "Impact"], ["finish", "Finish"]];
const KEY_EVENTS = [["address", "Address"], ["top", "Top"], ["impact", "Impact"], ["finish", "Finish"]];

/* ---------- small helpers ---------- */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, v: Math.min(a.v, b.v) });
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const median = (arr) => { const s = arr.filter(Number.isFinite).sort((a, b) => a - b); return s.length ? s[s.length >> 1] : NaN; };
const mean = (arr) => { const s = arr.filter(Number.isFinite); return s.length ? s.reduce((a, b) => a + b, 0) / s.length : NaN; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const deg = (r) => r * 180 / Math.PI;
function angleAt(a, b, c) {
  const x1 = a.x - b.x, y1 = a.y - b.y, x2 = c.x - b.x, y2 = c.y - b.y;
  const d = Math.hypot(x1, y1) * Math.hypot(x2, y2);
  return d ? deg(Math.acos(clamp((x1 * x2 + y1 * y2) / d, -1, 1))) : NaN;
}
function lsGet(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } }
function toast(msg, ms = 2800) {
  const t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg; document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement("script"); s.src = src; s.crossOrigin = "anonymous";
    s.onload = res; s.onerror = () => rej(new Error("Could not load " + src)); document.head.appendChild(s);
  });
}
const fmtDate = (ms) => new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/* ---------- model files ----------
   Binary files ship as-is locally. The artifact host only serves text, so there they are
   published as base64 chunks: <name>.b64.0.txt, .1.txt, … */
async function readWithProgress(res, onBytes, asText) {
  if (!res.body || !onBytes) return asText ? res.text() : new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader(), parts = []; let n = 0;
  for (;;) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; onBytes(n); }
  const all = new Uint8Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return asText ? new TextDecoder().decode(all) : all;
}
function decodeB64(txt) {
  const bin = atob(txt.trim()), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
const SITE = window.SWING_SITE || null;   // set only by the web build's <head>; the artifact never has it
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const whenVisible = () => document.visibilityState === "visible" ? Promise.resolve() : new Promise((r) => {
  const f = () => { if (document.visibilityState === "visible") { document.removeEventListener("visibilitychange", f); r(); } };
  document.addEventListener("visibilitychange", f);
});
async function modelCache() { try { return SITE?.modelCache && window.caches ? await caches.open(SITE.modelCache) : null; } catch { return null; } }
/* Model file: page-side cache first (web only), then the network, retried on dropped connections (web only).
   A non-OK reply (the artifact host serves no .bin) goes straight to the caller's fallback. */
async function fetchModel(url, onBytes, asText) {
  const c = await modelCache();
  try { const hit = c && await c.match(url); if (hit) return await readWithProgress(hit, onBytes, asText); } catch {}
  let err = null;
  for (let a = 0; a < (window.claude?.use ? 1 : 3); a++) {
    if (a) { await whenVisible(); await sleep(1500 * 2 ** (a - 1)); }
    let r;
    try { r = await fetch(url, a ? { cache: "reload" } : undefined); } catch (e) { err = e; continue; }
    if (!r.ok) { err = Object.assign(new Error("Missing " + url), { status: r.status }); break; }
    try { const b = await readWithProgress(r, onBytes, asText); c?.put(url, new Response(b)).catch(() => {}); return b; }
    catch (e) { err = e; }
  }
  throw err;
}
async function fetchBinary(url, onBytes) {
  let direct;
  try { return await fetchModel(url, onBytes, false); } catch (e) { direct = e; }
  const parts = []; let done = 0;
  for (let i = 0; ; i++) {
    const r = await fetch(`${url}.b64.${i}.txt`).catch(() => null);
    if (!r || !r.ok) break;
    const txt = await readWithProgress(r, onBytes && ((b) => onBytes((done + b) * 0.75)), true);
    done += txt.length; parts.push(decodeB64(txt));
  }
  if (!parts.length) throw direct || new Error("Missing " + url);
  const n = parts.reduce((s, p) => s + p.length, 0), all = new Uint8Array(n); let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}

/* ---------- pose engine ----------
   tf.min.js bundles regenerator-runtime, which falls back to Function() (blocked by the viewer's CSP)
   unless a global regeneratorRuntime already exists. A failed load leaves a half-built global behind,
   so clear it before retrying the next source. */
let libsReady = null;
// The web version ships its own copies: try them first so a stalled CDN never blocks it. The artifact has none.
const localFirst = (a) => SITE ? [...a.filter((s) => s.startsWith("./")), ...a.filter((s) => !s.startsWith("./"))] : a;
function loadLibs() {
  libsReady ||= (async () => {
    if (!("regeneratorRuntime" in window)) window.regeneratorRuntime = undefined;
    if (!window.tf?.loadGraphModel) {
      for (const src of localFirst(CONFIG.tf)) { delete window.tf; try { await loadScript(src); if (window.tf?.loadGraphModel) break; } catch {} }
    }
    if (!window.tf?.loadGraphModel) throw new Error("TensorFlow.js did not load");
    if (!window.poseDetection?.createDetector) {
      for (const src of localFirst(CONFIG.poseDetection)) { delete window.poseDetection; try { await loadScript(src); if (window.poseDetection?.createDetector) break; } catch {} }
    }
    if (!window.poseDetection?.createDetector) throw new Error("Pose library did not load");
    const tf = window.tf;
    if (!(await tf.setBackend("webgl"))) await tf.setBackend("cpu");
    await tf.ready();
    // iOS can reclaim the GPU: TF.js restores the context but its textures are gone, so latch the loss.
    if (tf.getBackend() === "webgl") tf.backend().canvas?.addEventListener?.("webglcontextlost", () => { if (!Engines.lost) { Engines.lost = true; Engines.set("lost", 0); } });
    return tf;
  })();
  return libsReady;
}

async function modelHandler(tf, name, onBytes) {
  const json = JSON.parse(await fetchModel(CONFIG.models + name + ".json", null, true));
  const weights = await fetchBinary(CONFIG.models + name + ".bin", onBytes);
  return tf.io.fromMemory({
    modelTopology: json.modelTopology, weightSpecs: json.weightsManifest.flatMap((g) => g.weights), weightData: weights.buffer,
    format: json.format, generatedBy: json.generatedBy, convertedBy: json.convertedBy,
    signature: json.signature, userDefinedMetadata: json.userDefinedMetadata, modelInitializer: json.modelInitializer,
  });
}

/* BlazePose GHUM (the model behind MediaPipe Pose) on TF.js WebGL, so no WebAssembly is needed.
   Smoothing is off: analysis is offline, so cleanSeries applies zero-lag filtering afterwards. */
async function createBlazePose(type, onProgress) {
  const tf = await loadLibs();
  const total = (CONFIG.modelMB.detector + CONFIG.modelMB[type]) * 1e6;
  const got = { d: 0, l: 0 };
  const report = () => onProgress?.(Math.min(1, (got.d + got.l) / total));
  const [detIO, lmIO] = await Promise.all([
    modelHandler(tf, "detector", (b) => { got.d = b; report(); }),
    modelHandler(tf, type, (b) => { got.l = b; report(); }),
  ]);
  const det = await window.poseDetection.createDetector(window.poseDetection.SupportedModels.BlazePose, {
    runtime: "tfjs", modelType: type, enableSmoothing: false, enableSegmentation: false, detectorModelUrl: detIO, landmarkModelUrl: lmIO,
  });
  return {
    type,
    reset() { det.reset(); },
    async detect(canvas, tMs) {
      const poses = await det.estimatePoses(canvas, { maxPoses: 1, flipHorizontal: false }, tMs);
      const p = poses[0]; if (!p || (p.score ?? 1) < 0.3) return null;
      const byName = {}; for (const k of p.keypoints) byName[k.name] = k;
      const kp = {};
      for (const k of KEYS) { const q = byName[BP_NAMES[k]]; kp[k] = q ? { x: q.x, y: q.y, v: q.score ?? 0 } : { x: NaN, y: NaN, v: 0 }; }
      return kp;
    },
  };
}

/* The fast model loads first so the app is usable straight away; the accurate model follows and is
   used for every measurement once ready. ?model=full skips the heavy download (testing only). */
const Engines = {
  fast: null, accurate: null, error: null, listeners: new Set(),
  status: { stage: "loading", pct: 0 },
  set(stage, pct) { this.status = { stage, pct }; this.listeners.forEach((f) => f(this.status)); },
  ready: null, accurateReady: null,
};
Engines.ready = (async () => {
  const onlyFull = new URLSearchParams(location.search).get("model") === "full";
  try {
    Engines.fast = await createBlazePose("full", (f) => !Engines.error && Engines.set("loading", f * (onlyFull ? 1 : 0.2)));
    Engines.set("fast", onlyFull ? 1 : 0.2);
  } catch (e) { Engines.error = e; Engines.set("error", 0); console.warn("pose engine failed", e); throw e; }
  Engines.accurateReady = onlyFull ? Promise.resolve(Engines.fast) : createBlazePose("heavy", (f) => Engines.set("upgrading", 0.2 + 0.8 * f))
    .then((eng) => { Engines.accurate = eng; Engines.set("ready", 1); return eng; })
    .catch((e) => { console.warn("heavy model failed, staying on full", e); Engines.set("ready", 1); return Engines.fast; });
  if (onlyFull) { Engines.accurate = Engines.fast; Engines.set("ready", 1); }
  return Engines.fast;
})();
Engines.ready.catch(() => {});

/* ---------- video sampling ---------- */
const work = document.createElement("canvas");
const wctx = work.getContext("2d", { willReadFrequently: true });
let video = null;              // set by the UI (the visible <video>)
let lastHash = null, lastKp = null;

function waitEvent(el, name, ms = 4000) {
  return new Promise((res) => {
    let done = false;
    const fin = () => { if (!done) { done = true; el.removeEventListener(name, fin); res(); } };
    el.addEventListener(name, fin); setTimeout(fin, ms);
  });
}
async function loadVideo(file) {
  const prev = video.getAttribute("src") || "";
  video.removeAttribute("src"); video.load();
  if (prev.startsWith("blob:")) URL.revokeObjectURL(prev);
  video.src = URL.createObjectURL(file);
  const loaded = waitEvent(video, "loadeddata", 15000);
  video.load();   // WebKit prepares the player on load() even when play() is refused (Low Power Mode, hot phone)
  // iOS only decodes frames once playback has started; a muted inline play/pause wakes it up.
  try { await video.play(); video.pause(); } catch {}
  await loaded;
  if (!video.videoWidth) throw new Error("This video could not be opened. On iPhone, set Settings › Camera › Formats to “Most Compatible”, or export the clip again.");
  const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
  work.width = Math.round(video.videoWidth * scale); work.height = Math.round(video.videoHeight * scale);
}
async function seekTo(t) {
  if (Math.abs(video.currentTime - t) < 1e-4) return;
  const p = waitEvent(video, "seeked");
  video.currentTime = t;
  await p;
}
/* A cheap fingerprint of the frame so repeated frames (sampling faster than the video's fps) reuse the last pose. */
function frameHash(canvas, ctx) {
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  let h = 0; const step = Math.max(4, Math.floor(d.length / 4 / 997)) * 4;
  for (let i = 0; i < d.length; i += step) h = (h * 31 + d[i] + d[i + 1] * 3 + d[i + 2] * 7) | 0;
  return h;
}
/* Crop canvas: the golfer region at analysis resolution, so bystanders are out of view and the model gets more pixels. */
const cropCanvas = document.createElement("canvas");
const cctx = cropCanvas.getContext("2d", { willReadFrequently: true });
async function sampleAt(t, eng, crop) {
  await seekTo(t);
  const s = work.width / video.videoWidth;
  let cv = work, ctx = wctx, ox = 0, oy = 0;
  if (crop) {
    cropCanvas.width = Math.round(crop.w); cropCanvas.height = Math.round(crop.h);
    cctx.drawImage(video, crop.x / s, crop.y / s, crop.w / s, crop.h / s, 0, 0, cropCanvas.width, cropCanvas.height);
    cv = cropCanvas; ctx = cctx; ox = crop.x; oy = crop.y;
  } else {
    wctx.drawImage(video, 0, 0, work.width, work.height);
  }
  const h = frameHash(cv, ctx);
  if (h === lastHash && lastKp) return { t, kp: lastKp, dup: true, canvas: cv, crop };
  let kp = await eng.detect(cv, Math.round(t * 1000));
  if (kp && (ox || oy)) { const m = {}; for (const k of KEYS) m[k] = { x: kp[k].x + ox, y: kp[k].y + oy, v: kp[k].v }; kp = m; }
  lastHash = h; lastKp = kp;
  return { t, kp, canvas: cv, crop };
}
function resetSampling(eng) { eng.reset(); lastHash = null; lastKp = null; }

/* Frame rate from requestVideoFrameCallback timestamps during a short muted play. Falls back to 30. */
async function estimateFps() {
  if (!("requestVideoFrameCallback" in HTMLVideoElement.prototype)) return 30;
  const times = [];
  const start = video.currentTime;
  await new Promise((res) => {
    let n = 0;
    const cb = (_, meta) => { times.push(meta.mediaTime); if (++n < 14) video.requestVideoFrameCallback(cb); else res(); };
    video.requestVideoFrameCallback(cb);
    video.playbackRate = 0.5;
    video.play().catch(res);
    setTimeout(res, 2500);
  });
  video.pause(); video.playbackRate = 1;
  await seekTo(start);
  const d = times.slice(1).map((t, i) => t - times[i]).filter((x) => x > 0.001);
  const fps = d.length >= 4 ? 1 / median(d) : 30;
  return clamp(Math.round(fps), 15, 240);
}

/* ---------- swing finding ---------- */
function handsHigh(kp) {
  if (!kp) return false;
  const hand = mid(kp.lwri, kp.rwri), sho = mid(kp.lsho, kp.rsho);
  return Number.isFinite(hand.y) && hand.y < sho.y;
}
function findWindows(frames, dur, slow) {
  const runs = [];
  let cur = null;
  for (const f of frames) {
    // Top of backswing and finish are both "hands high"; they sit well under 2.5 s apart, separate swings sit further apart.
    if (handsHigh(f.kp)) { if (cur && f.t - cur[1] <= 2.5 * slow) cur[1] = f.t; else { cur = [f.t, f.t]; runs.push(cur); } }
  }
  const wins = runs.map(([a, b]) => [Math.max(0, a - 2.4 * slow), Math.min(dur, b + 1.8 * slow)]);
  for (let i = 1; i < wins.length; i++) {
    if (wins[i][0] < wins[i - 1][1]) { const cut = (runs[i - 1][1] + runs[i][0]) / 2; wins[i - 1][1] = Math.max(cut, runs[i - 1][1]); wins[i][0] = Math.min(cut, runs[i][0]); }
  }
  if (!wins.length && dur <= 12 * slow) wins.push([0, dur]);
  return wins;
}

/* ---------- joint cleaning ----------
   Offline, zero-lag clean-up in the order the literature recommends:
   left/right swap repair (Viterbi per limb chain, feet anchored), Hampel outlier filter (±50 ms),
   gap fill, then a forward-backward 2nd-order Butterworth low-pass with a cutoff per body part.
   BlazePose still places hidden joints well (its score is visibility, not position quality), so only
   frames with no pose at all are gaps. */
const CHAINS = [["elb", "wri", "idx"], ["kne", "ank", "heel", "toe"], ["ear"]];
const CUTOFF_HZ = { nose: 6, lear: 6, rear: 6, lsho: 8, rsho: 8, lelb: 10, relb: 10, lwri: 12, rwri: 12, lidx: 12, ridx: 12, lhip: 6, rhip: 6, lkne: 6, rkne: 6, lank: 6, rank: 6, lheel: 6, rheel: 6, ltoe: 6, rtoe: 6 };

function repairSwaps(raw, view) {
  const idxs = raw.map((kp, i) => (kp ? i : -1)).filter((i) => i >= 0);
  if (idxs.length < 3) return;
  const torso = median(idxs.map((i) => dist(mid(raw[i].lsho, raw[i].rsho), mid(raw[i].lhip, raw[i].rhip)))) || 1;
  for (const chain of CHAINS) {
    const L = chain.map((c) => "l" + c), R = chain.map((c) => "r" + c);
    const pts = (i, swapped) => swapped ? [R, L] : [L, R];
    const cost = (i, si, j, sj) => {
      const [a1, b1] = pts(i, si), [a2, b2] = pts(j, sj);
      let c = 0;
      for (let k = 0; k < chain.length; k++) {
        const p = raw[i][a1[k]], q = raw[j][a2[k]], r = raw[i][b1[k]], u = raw[j][b2[k]];
        if (Number.isFinite(p.x) && Number.isFinite(q.x)) c += dist(p, q);
        if (Number.isFinite(r.x) && Number.isFinite(u.x)) c += dist(r, u);
      }
      return c / torso;
    };
    const PEN = 0.15 * chain.length;
    let acc = [0, PEN * 2];           // starting "swapped" is unlikely
    const back = [];
    for (let m = 1; m < idxs.length; m++) {
      const i = idxs[m - 1], j = idxs[m], next = [0, 0], bp = [0, 0];
      for (const sj of [0, 1]) {
        const c0 = acc[0] + cost(i, false, j, !!sj) + (sj ? PEN : 0);
        const c1 = acc[1] + cost(i, true, j, !!sj) + (sj ? 0 : PEN);
        next[sj] = Math.min(c0, c1); bp[sj] = c0 <= c1 ? 0 : 1;
      }
      back.push(bp); acc = next;
    }
    let st = acc[0] <= acc[1] ? 0 : 1;
    const states = new Array(idxs.length); states[idxs.length - 1] = st;
    for (let m = idxs.length - 1; m > 0; m--) { st = back[m - 1][st]; states[m - 1] = st; }
    idxs.forEach((i, m) => { if (states[m]) for (let k = 0; k < chain.length; k++) { const t = raw[i][L[k]]; raw[i][L[k]] = raw[i][R[k]]; raw[i][R[k]] = t; } });
  }
  // Feet do not cross during a swing: hold the ankle order seen in the first frames.
  const axis = view === "dtl" ? "y" : "x";
  const order = Math.sign(median(idxs.slice(0, 8).map((i) => raw[i].lank[axis] - raw[i].rank[axis]))) || 0;
  if (order) for (const i of idxs) {
    const kp = raw[i];
    if (Math.sign(kp.lank[axis] - kp.rank[axis]) === -order && Math.abs(kp.lank[axis] - kp.rank[axis]) > 0.05 * torso) {
      for (const c of ["kne", "ank", "heel", "toe"]) { const t = kp["l" + c]; kp["l" + c] = kp["r" + c]; kp["r" + c] = t; }
    }
  }
}

function butterworth(arr, fc, fs) {
  const n = arr.length;
  if (n < 6 || !(fs > 0) || fc >= 0.45 * fs) return arr.slice();
  const K = Math.tan(Math.PI * fc / fs), norm = 1 / (1 + Math.SQRT2 * K + K * K);
  const b0 = K * K * norm, b1 = 2 * b0, b2 = b0, a1 = 2 * (K * K - 1) * norm, a2 = (1 - Math.SQRT2 * K + K * K) * norm;
  const pad = Math.min(n - 1, Math.ceil(3 * fs / fc));
  // Odd reflection padding keeps the ends from ringing.
  const x = [];
  for (let i = pad; i >= 1; i--) x.push(2 * arr[0] - arr[i]);
  x.push(...arr);
  for (let i = n - 2; i >= n - 1 - pad; i--) x.push(2 * arr[n - 1] - arr[i]);
  const run = (v) => {
    const y = new Array(v.length);
    let x1 = v[0], x2 = v[0], y1 = v[0], y2 = v[0];
    for (let i = 0; i < v.length; i++) { const yi = b0 * v[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v[i]; y2 = y1; y1 = yi; y[i] = yi; }
    return y;
  };
  const fwd = run(x), bwd = run(fwd.reverse()).reverse();
  return bwd.slice(pad, pad + n);
}

function cleanSeries(frames, fsReal, view) {
  const n = frames.length;
  const raw = frames.map((f) => f.kp ? Object.fromEntries(KEYS.map((k) => [k, { ...f.kp[k] }])) : null);
  repairSwaps(raw, view);
  const fill = (arr) => {
    let last = -1;
    for (let i = 0; i < n; i++) {
      if (Number.isFinite(arr[i])) {
        if (last === -1) for (let j = 0; j < i; j++) arr[j] = arr[i];
        else for (let j = last + 1; j < i; j++) arr[j] = arr[last] + (arr[i] - arr[last]) * (j - last) / (i - last);
        last = i;
      }
    }
    if (last >= 0) for (let j = last + 1; j < n; j++) arr[j] = arr[last];
  };
  const r = Math.max(2, Math.round(0.05 * fsReal));
  const hampel = (arr, k = 3) => {
    const res = arr.slice();
    for (let i = 0; i < n; i++) {
      const win = arr.slice(Math.max(0, i - r), Math.min(n, i + r + 1));
      const med = median(win), mad = Math.max(1, 1.4826 * median(win.map((v) => Math.abs(v - med))));
      if (Math.abs(arr[i] - med) > k * mad) res[i] = med;
    }
    return res;
  };
  const out = frames.map((f) => ({ t: f.t, kp: {}, has: !!f.kp }));
  for (const k of KEYS) {
    let xs = new Array(n), ys = new Array(n);
    const vs = new Array(n);
    for (let i = 0; i < n; i++) {
      const p = raw[i]?.[k];
      const ok = p && Number.isFinite(p.x);
      xs[i] = ok ? p.x : NaN; ys[i] = ok ? p.y : NaN; vs[i] = ok ? p.v : 0;
    }
    fill(xs); fill(ys);
    xs = butterworth(hampel(xs), CUTOFF_HZ[k], fsReal); ys = butterworth(hampel(ys), CUTOFF_HZ[k], fsReal);
    for (let i = 0; i < n; i++) out[i].kp[k] = { x: xs[i], y: ys[i], v: vs[i] };
  }
  return out;
}

function avgPose(series, i, r = 1) {
  const a = Math.max(0, i - r), b = Math.min(series.length - 1, i + r), kp = {};
  for (const k of KEYS) {
    const pts = series.slice(a, b + 1).map((f) => f.kp[k]);
    kp[k] = { x: mean(pts.map((p) => p.x)), y: mean(pts.map((p) => p.y)), v: mean(pts.map((p) => p.v)) };
  }
  return kp;
}

/* ---------- swing events ----------
   GolfDB-style events from the hand path (hand centre = wrists + index fingers, in torso units above the hips).
   The downswing is the steepest fall of the hands that is followed by a follow-through (rules out lowering
   the club after a finish). Times are interpolated between frames where it matters (takeaway, top, impact). */
function handCentre(kp) {
  return { x: (kp.lwri.x + kp.rwri.x + kp.lidx.x + kp.ridx.x) / 4, y: (kp.lwri.y + kp.rwri.y + kp.lidx.y + kp.ridx.y) / 4 };
}
function findEvents(series, slow, lead, slowAuto = false) {
  const n = series.length;
  const fail = (why) => { findEvents.why = why; return null; };
  if (n < 12) return fail("too few frames");
  const rt = series.map((f) => f.t / slow);
  const torso = median(series.map((f) => dist(mid(f.kp.lsho, f.kp.rsho), mid(f.kp.lhip, f.kp.rhip))));
  if (!(torso > 8)) return fail("body too small");
  const hand = series.map((f) => handCentre(f.kp));
  // Hand height against a fixed reference (the hips' typical height in this window), so hips rising
  // through impact (normal in good players) do not make the hands look lower than they are.
  const hipRef = median(series.map((f) => mid(f.kp.lhip, f.kp.rhip).y));
  const H = series.map((f, i) => (hipRef - hand[i].y) / torso);
  const dH = H.map((_, i) => { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1); return (H[b] - H[a]) / ((rt[b] - rt[a]) || 1); });
  const speed = hand.map((p, i) => { const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2); return dist(hand[a], hand[b]) / torso / ((rt[b] - rt[a]) || 1); });
  const bodyKeys = ["nose", "lsho", "rsho", "lhip", "rhip", "lwri", "rwri", "lank", "rank"];
  const bodySpeed = series.map((f, i) => { const a = Math.max(0, i - 2), b = Math.min(n - 1, i + 2); return mean(bodyKeys.map((k) => dist(series[a].kp[k], series[b].kp[k]))) / torso / ((rt[b] - rt[a]) || 1); });
  const lerpT = (i, j, f) => series[i].t + (series[j].t - series[i].t) * clamp(f, 0, 1);
  // Time bounds hold in real time OR video time, whichever is longer, so an underestimated slo-mo factor
  // cannot cut a swing short.
  const within = (i, j, realS, videoS) => Math.abs(rt[i] - rt[j]) <= realS || Math.abs(series[i].t - series[j].t) <= videoS;
  const pos = series.map((f) => handCentre(f.kp));
  const bodyRef = median(series.map((f) => Math.max(f.kp.lank.y, f.kp.rank.y) - Math.min(f.kp.nose.y, f.kp.lear.y, f.kp.rear.y))) || 4 * torso;
  // Still address: some 0.25 s (real) stretch near i where the hands stay within ~5% of body height.
  const stillNear = (i, backS, maxH = Infinity) => {
    const win = Math.max(3, Math.round(0.25 * slow / Math.max(1e-3, median(series.slice(1).map((f, k) => f.t - series[k].t)))));
    for (let a = i; a >= 0 && within(i, a, backS, backS * 2); a--) {
      const b = Math.min(n - 1, a + win);
      const pts = pos.slice(a, b + 1), mx = median(pts.map((q) => q.x)), my = median(pts.map((q) => q.y));
      if (pts.every((q) => Math.hypot(q.x - mx, q.y - my) < 0.05 * bodyRef) && mean(H.slice(a, b + 1)) <= maxH) return a;
    }
    return -1;
  };

  // Downswing candidates, steepest first.
  const dtV = median(series.slice(1).map((f, k) => f.t - series[k].t)) || 1 / 30;
  const half = Math.max(2, Math.round(0.05 * slow / dtV));
  const fall = H.map((_, i) => { const a = Math.max(0, i - half), b = Math.min(n - 1, i + half); return (H[b] - H[a]) / ((rt[b] - rt[a]) || 1); });
  const order = [...fall.keys()].sort((a, b) => fall[a] - fall[b]);
  const steepest = fall[order[0]];
  const cands = [];
  for (const c of order.slice(0, 60)) {
    if (fall[c] > Math.min(-0.5, 0.3 * steepest)) break;   // relative to this clip, so slo-mo still qualifies
    let i = c; while (i > 0 && H[i - 1] >= H[i] - 0.04) i--;
    let tp = i; for (let j = i; j <= c; j++) if (H[j] > H[tp]) tp = j;
    for (let j = c; j > tp; j--) if (H[j] >= H[tp] - 0.03) { tp = j; break; }   // latest frame still at the top: end of any pause
    if (H[tp] < 0.45) continue;
    let lowAfter = c; for (let j = c; j < n && within(j, c, 0.6, 1.5); j++) if (H[j] < H[lowAfter]) lowAfter = j;
    let follow = false; for (let j = lowAfter; j < n && within(j, lowAfter, 2.5, 5); j++) if (H[j] - H[lowAfter] > 0.5 * (H[tp] - H[lowAfter])) { follow = true; break; }
    // A real swing rises from a still address. A finish being lowered or relaxed rises from impact, where the
    // hands fly through and are never still.
    let lowB = tp; for (let j = tp; j >= 0 && within(j, tp, 3, 8); j--) if (H[j] < H[lowB]) lowB = j;
    // ...and the still moment must be low (hands near setup height), not the pause at the top of a slo-mo backswing.
    const stillB = stillNear(Math.min(tp, lowB + 3), 1.2, H[lowB] + 0.25 * (H[tp] - H[lowB])) >= 0;
    if (follow && stillB && H[tp] - H[lowB] > 0.7 && !cands.some((x) => x[1] === tp)) cands.push([c, tp]);
  }
  if (!cands.length) return fail("no downswing found");
  // Try candidates steepest first; keep the first whose timing is a plausible golf swing. A real backswing takes
  // 1-8x as long as the downswing at any playback speed, so a wrong pick in ramped slo-mo is rejected here.
  for (const [p, top] of cands) {
    const r = build(p, top);
    if (!r) continue;
    const ratio = r.tempo.back / r.tempo.down, downVideo = r.times.impact - r.times.top;
    const downOk = slowAuto ? downVideo >= 0.1 && downVideo <= 3.5 : r.tempo.down >= 0.1 && r.tempo.down <= 0.8;
    if (downOk && (!r.tempo.ok || (ratio >= 1 && ratio <= 8))) return r;
    findEvents.why = "implausible swing timing";
  }
  return null;

  function build(p, top) {
  let peak = top; for (let j = top; j >= 0 && H[j] >= H[top] - 0.08; j--) if (H[j] > H[peak]) peak = j;
  // Sub-frame top: parabola through the hand heights around the top frame.
  let topT = series[top].t;
  if (top > 0 && top < n - 1) {
    const y0 = H[top - 1], y1 = H[top], y2 = H[top + 1], den = y0 - 2 * y1 + y2;
    if (den < 0) topT += clamp(0.5 * (y0 - y2) / den, -0.5, 0.5) * (series[top + 1].t - series[top - 1].t) / 2;
  }

  // Address: the still hand position before the backswing. Takeaway: hands leave it by 3% of body height
  // and keep going up to the top (rules out waggles and forward presses).
  let lowI = top;
  for (let j = top; j >= 0 && within(j, top, 3, 8); j--) if (H[j] < H[lowI]) lowI = j;
  // The address is the still period nearest the top on the way back (a forward press before it is ignored).
  const STILL = 0.55;
  let stillEnd = -1;
  for (let j = top - 1; j >= 1; j--) {
    if (speed[j] < STILL && speed[j - 1] < STILL && H[j] < H[lowI] + 0.35 * (H[top] - H[lowI])) { stillEnd = j; break; }
    if (!within(j, top, 3, 8)) break;
  }
  if (stillEnd < 0) stillEnd = lowI;
  const A0 = series[stillEnd].kp;
  const bodyH = Math.max(A0.lank.y, A0.rank.y) - Math.min(A0.nose.y, A0.lear.y, A0.rear.y) || 4 * torso;
  const addrFrames = []; for (let j = stillEnd; j >= 0 && rt[stillEnd] - rt[j] <= 0.3 && speed[j] < STILL * 1.5; j--) addrFrames.push(j);
  if (!addrFrames.length) addrFrames.push(stillEnd);
  const hAddr = { x: median(addrFrames.map((j) => hand[j].x)), y: median(addrFrames.map((j) => hand[j].y)) };
  const thr = 0.03 * bodyH;
  // Takeaway = the last moment the hands were still at their address spot before the top. Scanning back from the
  // top means a forward press or waggle that returns to address is skipped automatically.
  let take = lowI;
  for (let j = top - 1; j >= Math.max(0, Math.min(lowI, stillEnd) - 1); j--) { if (dist(hand[j], hAddr) <= thr) { take = j; break; } }
  if (!within(take, top, 1.8, 6)) { for (let j = take; j < top; j++) if (within(j, top, 1.8, 6)) { take = j; break; } }
  const d0 = dist(hand[take], hAddr), d1 = dist(hand[Math.min(take + 1, n - 1)], hAddr);
  const takeT = lerpT(take, Math.min(take + 1, n - 1), (thr - d0) / ((d1 - d0) || 1));
  const takeawayFound = take > 0 || addrFrames.length > 2;
  const address = Math.max(0, take);

  // Halfway back / down: lead wrist passes lead shoulder height.
  const lw = lead + "wri", ls = lead + "sho";
  const rel = (j) => series[j].kp[ls].y - series[j].kp[lw].y;   // + when wrist above shoulder
  let halfBack = -1; for (let j = take; j < top; j++) if (rel(j) <= 0 && rel(j + 1) > 0) { halfBack = j + 1; break; }
  let halfDown = -1; for (let j = top; j < Math.min(n - 1, top + 60); j++) if (rel(j) > 0 && rel(j + 1) <= 0) { halfDown = j + 1; break; }
  if (halfBack < 0) halfBack = Math.round((take + top) / 2);
  if (halfDown < 0) halfDown = Math.min(n - 1, top + Math.max(1, Math.round((p - top) / 2)));

  // Impact: after halfway down, hands return to address height (interpolated), 0.12-0.6 s after the top.
  const Haddr = (hipRef - hAddr.y) / torso;
  // Real address hands hang near or below hip height; if the clip starts mid-backswing there is no address.
  if (top === 0 || rt[take] - rt[0] < 0.1 && take < 3 || Haddr > 0.3) { findEvents.why = "start of the swing is cut off"; return null; }
  const target = Haddr + 0.08;
  let impact = -1, impactT = NaN;
  for (let j = Math.max(top + 1, halfDown); j < n; j++) {
    if (!within(j, top, 1.2, 3)) break;
    if (H[j] <= target) {
      impact = j;
      const a = H[j - 1], b = H[j];
      impactT = lerpT(j - 1, j, (a - target) / ((a - b) || 1));
      break;
    }
  }
  // In a real swing the hands always come back to about setup height at impact. A tracking glitch or a
  // relaxed finish never does, so that candidate is not a swing.
  if (impact < 0) {
    // Hands at impact can sit higher than at setup (standing up through the ball, shaft lean): accept the lowest
    // point if the hands came most of the way back down; a glitch or relaxed finish stays up near finish height.
    let lo = -1;
    for (let j = Math.max(top + 1, halfDown); j < n && within(j, top, 1.2, 3); j++) if (lo < 0 || H[j] < H[lo]) lo = j;
    if (lo < 0 || H[lo] > Haddr + 0.35 * (H[top] - Haddr)) { findEvents.why = "hands never came back down"; return null; }
    impact = lo; impactT = series[lo].t;
  }

  // Finish: the held pose after impact. Take the first still stretch that lasts 0.5 s (real), else the longest;
  // a brief pause while the club is still swinging round does not count. The hold is that stretch.
  const stillAt = (k) => bodySpeed[k] < 0.35 && speed[k] < 0.8 && H[k] > Math.max(0.2, 0.45 * H[top]);
  const segs = [];
  for (let j = impact; j < n; j++) {
    if (rt[j] - rt[impact] < 0.2) continue;
    if (!stillAt(j)) continue;
    let k = j; while (k + 1 < n && stillAt(k + 1)) k++;
    segs.push([j, k]); j = k;
  }
  const dur = ([a, b]) => rt[b] - rt[a];
  let seg = segs.find((g) => dur(g) >= 0.5) || segs.reduce((best, g) => (!best || dur(g) > dur(best) ? g : best), null);
  let finish, holdEnd, heldSeen = true;
  if (seg && dur(seg) >= 0.1) { finish = seg[0]; holdEnd = seg[1]; while (holdEnd < n - 1 && bodySpeed[holdEnd + 1] < 0.5) holdEnd++; }
  else { finish = impact; for (let j = impact; j < n; j++) if (H[j] > H[finish]) finish = j; holdEnd = finish; heldSeen = false; }
  const tailAfterFinish = rt[n - 1] - rt[finish];

  return {
    idx: { address, takeaway: take, halfBack, top, halfDown, impact, finish },
    times: { address: series[address].t, takeaway: takeT, halfBack: series[halfBack].t, top: topT, halfDown: series[halfDown].t, impact: impactT, finish: series[finish].t },
    torso, rt, H, bodyH,
    tempo: { back: (topT - takeT) / slow, down: (impactT - topT) / slow, ok: takeawayFound && impact > top + 1 },
    // No still finish found at all: not measured (rather than "held for 0 s").
    hold: { secs: rt[holdEnd] - rt[finish], cut: holdEnd === n - 1, measurable: heldSeen && (holdEnd < n - 1 ? tailAfterFinish >= 0.6 || rt[holdEnd] - rt[finish] >= 0.3 : rt[holdEnd] - rt[finish] >= 1.6) },
    downFrames: impact - top, topPeakT: series[peak].t,
  };
  }
}

/* ---------- strike sound ----------
   The club-ball click is a sharp transient. When the clip's audio decodes (desktop browsers mostly; iOS .mov
   often fails) it pins impact to about a millisecond. Only used if a clear onset sits near the pose impact. */
async function decodeOnsets(file) {
  try {
    if (file.size > 100e6) return null;
    const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AC) return null;
    const ctx = new AC(1, 16000, 16000);
    const ab = await file.arrayBuffer();
    const audio = await new Promise((res, rej) => { try { const r = ctx.decodeAudioData(ab, res, rej); if (r?.then) r.then(res, rej); } catch (e) { rej(e); } });
    const data = audio.getChannelData(0), sr = audio.sampleRate;
    const hop = Math.round(sr * 0.002), env = [];
    for (let i = 0; i + hop <= data.length; i += hop) { let e = 0; for (let j = i; j < i + hop; j++) e += data[j] * data[j]; env.push(Math.sqrt(e / hop)); }
    return { env, dt: hop / sr };
  } catch { return null; }
}
function audioImpact(onsets, tPose) {
  if (!onsets) return null;
  const { env, dt } = onsets;
  const i0 = Math.max(0, Math.floor((tPose - 0.15) / dt)), i1 = Math.min(env.length - 1, Math.ceil((tPose + 0.15) / dt));
  let best = -1, bestR = 0;
  for (let i = i0; i <= i1; i++) {
    const pre = env.slice(Math.max(0, i - 50), Math.max(1, i - 3));   // ~100 ms before
    const base = median(pre) || 1e-6;
    const r = env[i] / base;
    if (r > bestR) { bestR = r; best = i; }
  }
  if (best < 0 || bestR < 8) return null;
  return best * dt - 0.010;   // ~3.5 m of sound travel
}

/* ---------- tracking quality ----------
   Every swing gets an honest confidence rating with the specific reason, so a bad clip never
   produces a confident-looking score. */
function assessQuality(series, ev, W, Hpx, viewInfo, fps, stride = 1, live = false) {
  const issues = [];
  const core = ["lsho", "rsho", "lhip", "rhip"];
  const i0 = ev.idx.address, i1 = ev.idx.finish;
  const seg = series.slice(i0, i1 + 1);
  const coverage = seg.filter((f) => f.has).length / Math.max(1, seg.length);
  if (coverage < 0.85) issues.push({ key: "lost", text: "The tracker lost you for part of the swing. Check nobody walks through the shot and you are not in shadow." });
  const vis = mean(seg.flatMap((f) => core.map((k) => f.kp[k].v)));
  if (vis < 0.6) issues.push({ key: "vis", text: "Your body is hard to see. Film in better light, in clothes that contrast with the background." });
  const A = series[i0].kp;
  const bodyH = ev.bodyH / Hpx;
  if (bodyH < 0.33) issues.push({ key: "small", text: "You are small in the frame. Move the phone closer so you fill at least half the height." });
  const margin = 0.012;
  const out = seg.some((f) => ["nose", "lank", "rank", "lwri", "rwri"].some((k) => { const p = f.kp[k]; return p.x < margin * W || p.x > (1 - margin) * W || p.y < margin * Hpx || p.y > (1 - margin) * Hpx; }));
  if (out) issues.push({ key: "edge", text: "Part of you leaves the frame (often the hands at the top). Step back so your whole swing fits." });
  const realFps = fps * (ev.slow || 1);
  if (!live && realFps < 50 && !ev.audioImpact && ev.downFrames < 9 * stride) issues.push({ key: "fps", text: `This clip is about ${Math.round(fps)} fps, so the downswing is only ${Math.round(ev.downFrames * stride)} frames and rhythm is rough. Film at 60 fps or in slo-mo.` });
  if (viewInfo.unclear) issues.push({ key: "angle", text: "The camera is at an in-between angle. Film straight face-on or straight down the line for reliable numbers." });
  // Planted feet should not move between setup and impact; if they do, the camera moved.
  // A moving camera shifts every planted point together, while one hidden foot point just jitters. So take the
  // smallest movement among the planted points (lead ankle, heel, toe and trail toe; the trail heel lifts at impact).
  const B = series[ev.idx.impact].kp, ld = ev.lead || "l", tr = ld === "l" ? "r" : "l";
  const footDrift = Math.min(...[ld + "ank", ld + "heel", ld + "toe", tr + "toe", tr + "ank"].map((k) => dist(A[k], B[k]))) / (ev.bodyH || 1);
  if (footDrift > 0.04) issues.push({ key: "camera", text: "The camera (or your feet) moved during the swing, so side-to-side readings are switched off. Prop the phone on something solid." });
  if (viewInfo.view === "face") {
    const tilt = Math.abs(deg(Math.atan2(A.lank.y - A.rank.y, Math.abs(A.lank.x - A.rank.x))));
    const shL = dist(A.lkne, A.lank), shR = dist(A.rkne, A.rank);
    if (tilt > 8 || Math.abs(shL - shR) / Math.max(shL, shR) > 0.15) issues.push({ key: "square", text: "The phone is not square to you (one leg looks bigger or the feet look tilted). Put the phone straight in front of your chest." });
  }
  const level = issues.length === 0 ? "good" : issues.some((x) => ["lost", "vis", "small"].includes(x.key)) || issues.length >= 3 ? "poor" : "ok";
  return { level, issues, coverage, vis, bodyH, footDrift, cameraMoved: issues.some((x) => x.key === "camera") };
}

/* A real golf swing shows a whole standing body: head above hips above knees above feet, feet inside the
   frame and the body a sensible size. Selfie clips, walking past the camera or a cut-off frame fail this. */
function isGolferPose(kp, W, Hpx) {
  const hip = mid(kp.lhip, kp.rhip), knee = mid(kp.lkne, kp.rkne), ank = mid(kp.lank, kp.rank);
  if (![kp.nose.y, hip.y, knee.y, ank.y].every(Number.isFinite)) return false;
  const ordered = kp.nose.y < hip.y && hip.y < knee.y && knee.y < ank.y + 2;
  const feetIn = Math.max(kp.lank.y, kp.rank.y) < 0.995 * Hpx && Math.min(kp.lank.x, kp.rank.x) > 0 && Math.max(kp.lank.x, kp.rank.x) < W;
  const bodyH = (ank.y - kp.nose.y) / Hpx;
  const seen = Math.max(kp.lank.v, kp.rank.v) >= 0.15 && (kp.lhip.v + kp.rhip.v) / 2 >= 0.25;
  return ordered && feetIn && bodyH >= 0.2 && bodyH <= 1.02 && seen;
}

/* View from apparent shoulder width over torso length at address: ≥0.6 face-on, ≤0.35 down the line. */
function classifyView(series, i, forced) {
  const kp = avgPose(series, i, 3);
  const ratio = Math.abs(kp.lsho.x - kp.rsho.x) / dist(mid(kp.lsho, kp.rsho), mid(kp.lhip, kp.rhip));
  if (forced !== "auto") return { view: forced, ratio, unclear: forced === "face" ? ratio < 0.45 : ratio > 0.5 };
  return { view: ratio >= 0.48 ? "face" : "dtl", ratio, unclear: ratio > 0.35 && ratio < 0.6 };
}

function estimateSlow(coarse, step = 0.12) {
  const pts = coarse.filter((f) => f.kp).map((f) => {
    const torso = dist(mid(f.kp.lsho, f.kp.rsho), mid(f.kp.lhip, f.kp.rhip)) || 1;
    return { t: f.t, H: (mid(f.kp.lhip, f.kp.rhip).y - mid(f.kp.lwri, f.kp.rwri).y) / torso };
  });
  let fastest = Infinity;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].H < 0.5) continue;
    for (let j = i + 1; j < pts.length && pts[j].t - pts[i].t < 4; j++) {
      if (pts[j].H < pts[i].H - 1.0) { fastest = Math.min(fastest, pts[j].t - pts[i].t); break; }
    }
  }
  if (!Number.isFinite(fastest) || fastest < Math.max(0.6, 2.05 * step)) return 1;   // only clear slo-mo here; the dense pass refines it
  return clamp(Math.round(fastest / 0.2 * 2) / 2, 1.5, 10);
}

/* ---------- the whole analysis ----------
   Pass 1: fast model over the clip at ~8 fps to find swings (reset every frame: frames are not consecutive).
   Pass 2: accurate model on every video frame through each swing, cropped to the golfer. */
async function analyzeClip(file, opts, hooks = {}) {
  const say = hooks.progress || (() => {});
  await loadVideo(file);
  const dur = video.duration, W = work.width, Hpx = work.height;
  say(1, "find", "Checking the video");
  const fps = await estimateFps();
  const onsetsP = opts.slow <= 1 && dur <= 90 ? decodeOnsets(file) : Promise.resolve(null);
  const fast = await Engines.ready;
  const step1 = opts.coarseStep || Math.max(0.12 * Math.min(opts.slow || 1, 2), dur / 480);
  const coarse = [];
  for (let t = 0.02; t < dur; t += step1) {
    resetSampling(fast);
    const f = await sampleAt(t, fast, null);
    coarse.push(f);
    hooks.frame?.(f);
    say(2 + 28 * t / dur, "find", "Finding each swing in the clip");
    if (hooks.cancelled?.()) throw new Error("cancelled");
  }
  // "Work it out": real downswings drop the hands about a torso length in under 0.25 s, so a much slower
  // drop means slo-mo. The estimate sizes the windows and time thresholds; it is flagged on the result.
  if (!opts.slow) { opts.slowAuto = true; opts.slow = estimateSlow(coarse, step1); opts.slowGuessed = opts.slow > 1; }
  const wins = findWindows(coarse, dur, opts.slow);
  if (!wins.length) throw new Error("No swing found. Make sure your whole body is in frame and your hands go above your shoulders at the top.");
  say(30, "track", "Loading the accurate tracker");
  const totalMB = Math.round(CONFIG.modelMB.detector + CONFIG.modelMB.heavy);
  const onEng = ({ stage, pct }) => { if (stage === "upgrading") say(30, "track", `First-time download of the accurate tracker: ${Math.round(Math.max(0, (pct - 0.2) / 0.8) * totalMB)} of ${totalMB} MB. Wi-Fi is faster.`); };
  Engines.listeners.add(onEng);
  let acc; try { acc = await Engines.accurateReady; } finally { Engines.listeners.delete(onEng); }
  const swings = [];
  const total = wins.reduce((s, w) => s + (w[1] - w[0]), 0);
  let doneT = 0;
  for (let w = 0; w < wins.length; w++) {
    const [a, b] = wins[w];
    // Crop: everywhere the golfer's body reached in the coarse pass for this window, with room for the club.
    const pts = coarse.filter((f) => f.kp && f.t >= a && f.t <= b).flatMap((f) => KEYS.map((k) => f.kp[k]).filter((p) => Number.isFinite(p.x)));
    let crop = null;
    if (pts.length > 20) {
      const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      const bh = y1 - y0, padX = 0.45 * bh, padTop = 0.35 * bh, padBot = 0.12 * bh;
      const c = { x: Math.max(0, x0 - padX), y: Math.max(0, y0 - padTop) };
      c.w = Math.min(W, x1 + padX) - c.x; c.h = Math.min(Hpx, y1 + padBot) - c.y;
      if (c.w * c.h < 0.8 * W * Hpx) crop = c;
    }
    // Every frame (frame centres) through the swing; cap the count for long or slow clips.
    const frameDt = 1 / fps;
    const maxFrames = 320;
    const stride = Math.max(1, Math.ceil((b - a) / frameDt / maxFrames));
    const raw = [];
    resetSampling(acc);
    for (let k = Math.ceil(a / frameDt); (k + 0.5) * frameDt <= b; k += stride) {
      const t = (k + 0.5) * frameDt;
      const f = await sampleAt(t, acc, crop);
      raw.push(f);
      hooks.frame?.(f);
      say(30 + 62 * (doneT + (t - a)) / total, "track", `Tracking swing ${w + 1} of ${wins.length}`);
      if (hooks.cancelled?.()) throw new Error("cancelled");
    }
    doneT += b - a;
    const fsReal = fps / stride * opts.slow;
    const viewGuess = classifyView(raw.filter((f) => f.kp).map((f) => ({ kp: f.kp })), 0, opts.view);
    const series = cleanSeries(raw, fsReal, viewGuess.view);
    const lead = opts.hand === "L" ? "r" : "l";
    let ev = findEvents(series, opts.slow, lead, !!opts.slowAuto);
    // Real downswings take about 0.2-0.45 s, so when the speed was not given, the measured downswing tells us.
    if (ev && opts.slowAuto) {
      const downVideo = ev.times.impact - ev.times.top, real = downVideo / opts.slow;
      let est = opts.slow;
      if (real > 0.6) est = clamp(Math.round(downVideo / 0.3 * 2) / 2, 1.5, 10);
      else if (real < 0.15 && opts.slow > 1) est = Math.max(1, Math.round(downVideo / 0.3 * 2) / 2);
      if (est !== opts.slow) {
        const again = findEvents(series, est, lead, true);
        if (again) { opts.slow = est; opts.slowGuessed = est > 1; ev = again; }
      }
    }
    if (!ev) { console.warn("swing window rejected", a.toFixed(2), b.toFixed(2), findEvents.why); continue; }
    if (!isGolferPose(avgPose(series, ev.idx.address, 2), W, Hpx) || !isGolferPose(avgPose(series, ev.idx.impact, 1), W, Hpx)) {
      console.warn("swing window rejected", a.toFixed(2), b.toFixed(2), "no full standing body in frame"); continue;
    }
    ev.slow = opts.slow; ev.lead = lead;
    const viewInfo = classifyView(series, ev.idx.address, opts.view);
    swings.push({ series, ev, viewInfo, t0: a, t1: b, crop, fps, stride });
  }
  if (!swings.length) throw new Error("I could not find a full golf swing. Check your whole body, head to feet, is in frame from setup to finish.");
  if (opts.slow > 1 && !opts.slowGuessed) { /* user said slo-mo: audio is stretched, skip it */ }
  // Strike sound, if the audio decoded and a clear click sits near the pose impact.
  const onsets = await onsetsP;
  for (const s of swings) {
    const tA = audioImpact(onsets, s.ev.times.impact);
    if (tA != null && Math.abs(tA - s.ev.times.impact) < 0.12) {
      s.ev.poseImpactT = s.ev.times.impact;
      s.ev.times.impact = tA; s.ev.audioImpact = true;
      s.ev.tempo.down = (tA - (s.ev.times.top - 0.5 / s.fps)) / opts.slow;   // pose times sit at frame centres
    }
  }
  say(94, "score", "Measuring and scoring");
  for (const s of swings) {
    s.quality = assessQuality(s.series, s.ev, W, Hpx, s.viewInfo, s.fps, s.stride);
    const res = computeChecks(s.series, s.ev, opts, s.viewInfo);
    Object.assign(s, res);
    // A moving camera fakes sway: switch off the side-to-side checks rather than guess.
    if (s.quality.cameraMoved) for (const id of ["hipSway", "headSway", "weightShift", "headImpact", "stayBehind", "posture", "headHeight"]) if (s.checks[id]) s.checks[id].measured = false;
    s.total = scoreSwing(s.checks, s.view);
    if (s.quality.level === "poor" && s.total.score > 54) { s.total.score = 54; s.total.capped = "Tracking was poor on this clip, so the score is capped at 54."; }
    s.times = s.ev.times;
  }
  return { swings, dur, W, H: Hpx, fps };
}
