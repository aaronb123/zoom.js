/* ============================================================
   Live coach: camera on, framing prompts, automatic swing detection,
   one spoken cue after every swing, recorded clip for full analysis.
   Needs camera access, so it runs on the web version, not inside the Claude viewer.
   ============================================================ */

const IN_CLAUDE = !!window.claude?.use;
const CAN_CAMERA = !!navigator.mediaDevices?.getUserMedia && !IN_CLAUDE;
const LIVE_URL = "https://aaronb123.github.io/zoom.js/#live";
// Short spoken cues: [when it is off, when it is good]
const CUES = {
  weightShift: ["Get onto your front foot", "Good weight shift"], posture: ["Stay down through the hit", "Nice, you stayed in posture"],
  headHeight: ["Keep your head level", "Head nice and level"], stayBehind: ["Keep your chest behind the ball", "Good, chest behind the ball"],
  headImpact: ["Keep your head behind the ball", "Head stayed back, good"], overTop: ["Swing down from the inside", "Good path down"],
  hipSway: ["Turn, don't slide", "Good turn"], headSway: ["Keep your head centred", "Head centred, good"], spineTop: ["Lean away at the top", "Good tilt at the top"],
  spineAddress: ["Check your setup posture", "Good setup"], kneeFlex: ["Soften your knees", "Good knees"], stance: ["Check your stance width", "Good stance"],
  tempo: ["Smooth back, then go", "Lovely rhythm"], finishPos: ["Finish on your front foot", "Good finish"], finishHold: ["Hold your finish", "Nice balance"],
};
const FOCUS = [["auto", "My #1 fix"], ["tempo", "Rhythm"], ["posture", "Posture"], ["headHeight", "Head"], ["weightShift", "Weight shift"], ["hipSway", "Sway"], ["finishPos", "Finish"]];

const Live = {
  running: false, stream: null, facing: "environment", voice: true, focus: lsGet("swinglab:liveFocus", "auto"),
  buf: [], snaps: [], state: "frame", stateT: 0, readyT: 0, swingT: 0, lastSay: 0, busy: false, fpsT: [], rec: null, chunks: [],
  session: [], timeScale: +new URLSearchParams(location.search).get("liveslow") || 1,   // test hook: slowed fake camera
};
const liveVideo = $("#liveVideo"), liveOverlay = $("#liveOverlay"), lctx = liveOverlay.getContext("2d");

function liveSay(text, force = false) {
  const now = performance.now();
  if (!Live.voice || (!force && now - Live.lastSay < 4500)) return;
  Live.lastSay = now; speak(text);
}
function setStatus(state, text) {
  if (Live.state !== state) { Live.state = state; Live.stateT = performance.now(); }
  const el = $("#liveStatus"); el.dataset.state = state; el.textContent = text;
}
function renderFocus() {
  $("#liveFocus").innerHTML = FOCUS.map(([id, l]) => `<button class="chip" type="button" aria-pressed="${Live.focus === id}" data-f="${id}">${l}</button>`).join("");
  $$("#liveFocus [data-f]").forEach((b) => b.onclick = () => { Live.focus = b.dataset.f; lsSet("swinglab:liveFocus", Live.focus); renderFocus(); });
}

async function startLive() {
  hideError();
  $("#intake").hidden = true; $("#results").hidden = true; $("#live").hidden = false;
  renderFocus(); primeVoice();
  setStatus("frame", "Loading the tracker…");
  try { await Engines.ready; } catch { setStatus("frame", "The tracker could not start."); return; }
  try {
    Live.stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: Live.facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } }, audio: false });
  } catch (e) {
    setStatus("frame", "Camera blocked. Allow camera access for this site in your browser settings, then try again.");
    return;
  }
  liveVideo.srcObject = Live.stream;
  await liveVideo.play().catch(() => {});
  await waitEvent(liveVideo, "loadeddata", 3000);
  // The pose library sizes video input from the element's width/height attributes, not the stream: set them.
  liveVideo.width = liveVideo.videoWidth; liveVideo.height = liveVideo.videoHeight;
  liveVideo.addEventListener("resize", () => { liveVideo.width = liveVideo.videoWidth; liveVideo.height = liveVideo.videoHeight; });
  $("#liveStage").classList.toggle("landscape", liveVideo.videoWidth > liveVideo.videoHeight);
  Engines.fast.reset();
  Live.running = true; Live.buf = []; Live.snaps.forEach((s) => s.bmp?.close?.()); Live.snaps = [];
  setStatus("frame", "Step into the frame, whole body in shot");
  liveSay("Step into the frame so I can see all of you.", true);
  liveTick();
}
function stopLive() {
  Live.running = false;
  try { Live.rec?.state === "recording" && Live.rec.stop(); } catch {}
  Live.stream?.getTracks().forEach((t) => t.stop()); Live.stream = null;
  $("#live").hidden = true; $("#intake").hidden = false;
}

function liveTick() {
  if (!Live.running) return;
  const next = () => ("requestVideoFrameCallback" in liveVideo ? liveVideo.requestVideoFrameCallback(() => liveTick()) : requestAnimationFrame(() => liveTick()));
  if (Live.busy) { next(); return; }
  Live.busy = true;
  const t = performance.now() / 1000 / Live.timeScale;
  Engines.fast.detect(liveVideo, Math.round(t * 1000)).then((kp) => {
    Live.busy = false;
    if (!Live.running) return;
    Live.buf.push({ t, kp });
    while (Live.buf.length && t - Live.buf[0].t > 12) Live.buf.shift();
    snapshot(t);
    drawLive(kp);
    liveStep(t, kp);
    Live.fpsT.push(performance.now()); while (Live.fpsT.length > 30) Live.fpsT.shift();
    if (Live.fpsT.length > 5) $("#liveFps").textContent = `${Math.round(1000 * (Live.fpsT.length - 1) / (Live.fpsT.at(-1) - Live.fpsT[0]))} fps tracking`;
    next();
  }).catch((e) => { Live.busy = false; console.warn(e); next(); });
}
/* Small stills (~8 a second) so key positions can be shown after the swing. */
function snapshot(t) {
  const last = Live.snaps.at(-1);
  if (last && t - last.t < 0.12 / Live.timeScale) return;
  if (!window.createImageBitmap) return;
  createImageBitmap(liveVideo, { resizeWidth: 240, resizeQuality: "low" }).then((bmp) => {
    Live.snaps.push({ t, bmp });
    while (Live.snaps.length > 100) Live.snaps.shift().bmp.close?.();
  }).catch(() => {});
}
function drawLive(kp) {
  const r = liveOverlay.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  if (liveOverlay.width !== Math.round(r.width * dpr)) { liveOverlay.width = Math.round(r.width * dpr); liveOverlay.height = Math.round(r.height * dpr); }
  lctx.clearRect(0, 0, liveOverlay.width, liveOverlay.height);
  if (!kp || !liveVideo.videoWidth) return;
  // object-fit: contain mapping
  const vw = liveVideo.videoWidth, vh = liveVideo.videoHeight, sc = Math.min(liveOverlay.width / vw, liveOverlay.height / vh);
  lctx.save(); lctx.translate((liveOverlay.width - vw * sc) / 2, (liveOverlay.height - vh * sc) / 2);
  drawSkeleton(lctx, kp, sc, 2.6 * dpr);
  lctx.restore();
}

/* Swing detection on the live stream:
   frame -> (whole body seen) -> settle -> (hands still and low for 0.4 s) -> ready -> (hands above shoulders) -> swing
   -> (body still after the finish, or 3.5 s) -> analyse. */
function liveStep(t, kp) {
  const W = liveVideo.videoWidth, H = liveVideo.videoHeight;
  const recent = Live.buf.filter((f) => f.kp && t - f.t <= 0.45);
  const ok = kp && isGolferPose(kp, W, H);
  const since = (performance.now() - Live.stateT) / 1000 / Live.timeScale;
  if (Live.state === "analyse" || Live.state === "cool") return;
  if (!ok) {
    if (Live.state === "swing") return;   // brief loss mid-swing: keep going
    if (since > 1.2 || Live.state !== "frame") {
      const why = !kp ? "I can't see you" : Math.max(kp.lank.y, kp.rank.y) > 0.98 * H ? "Step back, I can't see your feet" : kp.nose.y < 0.02 * H ? "Step back, I can't see your head" : "Whole body in shot, please";
      setStatus("frame", why); liveSay(why + ".");
    }
    return;
  }
  const torso = dist(mid(kp.lsho, kp.rsho), mid(kp.lhip, kp.rhip)) || 1;
  const bodyH = Math.max(kp.lank.y, kp.rank.y) - kp.nose.y;
  const hand = handCentre(kp), sho = mid(kp.lsho, kp.rsho), hip = mid(kp.lhip, kp.rhip);
  const handsHighNow = hand.y < sho.y;
  const still = recent.length >= 4 && recent.every((f) => dist(handCentre(f.kp), hand) < 0.05 * bodyH);
  if (Live.state === "frame") {
    if (bodyH < 0.35 * H) { setStatus("frame", "Come a bit closer"); liveSay("Come a little closer."); return; }
    setStatus("settle", "Set up to the ball"); liveSay("Got you. Set up when you're ready.", true); return;
  }
  if (Live.state === "settle") {
    if (still && hand.y > hip.y - 0.3 * torso) {
      setStatus("ready", "Ready. Swing when you like"); liveSay("Ready.", true);
      Live.readyT = t; startClip();
    }
    return;
  }
  if (Live.state === "ready") {
    if (handsHighNow) { setStatus("swing", "Swinging…"); Live.swingT = t; return; }
    if (!still && since > 6) { setStatus("settle", "Set up to the ball"); }   // they moved off; wait to settle again
    if (since > 0.3 && still) Live.readyT = Math.max(Live.readyT, t - 1.0);   // keep the address window fresh while waiting
    return;
  }
  if (Live.state === "swing") {
    const dt = t - Live.swingT;
    if ((dt > 1.0 && still) || dt > 3.5) analyseLive(t);
  }
}

function startClip() {
  try {
    if (!window.MediaRecorder || !Live.stream) return;
    if (Live.rec?.state === "recording") Live.rec.stop();
    const mime = ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
    Live.chunks = [];
    Live.rec = new MediaRecorder(Live.stream, mime ? { mimeType: mime, videoBitsPerSecond: 6e6 } : undefined);
    Live.rec.ondataavailable = (e) => e.data.size && Live.chunks.push(e.data);
    Live.rec.start();
  } catch (e) { console.warn("recorder", e); Live.rec = null; }
}
function stopClip() {
  return new Promise((res) => {
    const r = Live.rec;
    if (!r || r.state !== "recording") return res(null);
    r.onstop = () => { const type = (r.mimeType || "video/webm").split(";")[0]; res(new File(Live.chunks, `swing-${Date.now()}.${type.includes("mp4") ? "mp4" : "webm"}`, { type })); };
    r.stop();
  });
}

async function analyseLive(tEnd) {
  setStatus("analyse", "Checking that swing…");
  const t0 = Live.readyT - 0.8;
  const frames = Live.buf.filter((f) => f.t >= t0 && f.t <= tEnd + 0.1).map((f) => ({ t: f.t, kp: f.kp }));
  const clipP = new Promise((r) => setTimeout(() => stopClip().then(r), 400));   // keep a little of the finish
  const W = liveVideo.videoWidth, H = liveVideo.videoHeight;
  const opts = { view: $("#view").value, hand: $("#hand").value, slow: 1, club: settings.club, heightCm: heightFor(currentPlayer()) };
  let s = null;
  try {
    const dts = frames.slice(1).map((f, i) => f.t - frames[i].t);
    const fs = 1 / (median(dts) || 1 / 30);
    const viewGuess = classifyView(frames.filter((f) => f.kp).map((f) => ({ kp: f.kp })), 0, opts.view);
    const series = cleanSeries(frames, fs, viewGuess.view);
    const ev = findEvents(series, 1, opts.hand === "L" ? "r" : "l");
    if (ev) {
      ev.slow = 1; ev.lead = opts.hand === "L" ? "r" : "l";
      const viewInfo = classifyView(series, ev.idx.address, opts.view);
      s = { series, ev, viewInfo, fps: fs, stride: 1, t0, t1: tEnd, crop: null };
      s.quality = assessQuality(series, ev, W, H, viewInfo, fs, 1);
      Object.assign(s, computeChecks(series, ev, opts, viewInfo));
      if (s.quality.cameraMoved) for (const id of ["hipSway", "headSway", "weightShift", "headImpact", "stayBehind", "posture", "headHeight"]) if (s.checks[id]) s.checks[id].measured = false;
      s.total = scoreSwing(s.checks, s.view);
      if (s.quality.level === "poor" && s.total.score > 54) { s.total.score = 54; s.total.capped = "Tracking was poor, so the score is capped at 54."; }
      s.times = ev.times;
      s.thumbs = liveThumbs(s);
    }
    else console.warn("live swing rejected:", findEvents.why, "frames", frames.length);
  } catch (e) { console.warn("live analysis", e); s = null; }
  const clip = await clipP;
  if (!s) {
    setStatus("cool", "Didn't catch that one");
    liveSay("Didn't catch that one. Keep your whole body in shot and hold your finish.", true);
  } else {
    s.clip = clip;
    Live.session.unshift(s);
    const said = liveCue(s);
    setStatus("cool", `${s.total.score ?? "–"} · ${said}`);
    liveSay(`${s.total.score ?? ""}. ${said}.`, true);
    renderLiveResult(s);
    try { await saveSession([s], { ...opts, club: settings.club }, { live: true }); } catch {}
  }
  setTimeout(() => { if (Live.running) { setStatus("settle", "Set up to the ball"); } }, 2500);
}
function liveCue(s) {
  const want = Live.focus !== "auto" ? Live.focus : pickFix(s.checks, s.view)?.id;
  const c = want && s.checks[want];
  if (want && c?.measured) return CUES[want][c.score >= 70 ? 1 : 0];
  if (Live.focus !== "auto") return `${CHECKS[Live.focus]?.short || "That"} not visible from this angle`;
  const good = pickStrength(s.checks, s.view);
  return good ? CUES[good.id][1] : "Solid swing";
}
function liveThumbs(s) {
  const out = {};
  if (!Live.snaps.length) return out;
  const c = document.createElement("canvas"); const g = c.getContext("2d");
  for (const [k] of KEY_EVENTS) {
    const t = s.times[k]; if (!Number.isFinite(t)) continue;
    const snap = Live.snaps.reduce((b, x) => (Math.abs(x.t - t) < Math.abs(b.t - t) ? x : b), Live.snaps[0]);
    c.width = snap.bmp.width; c.height = snap.bmp.height;
    g.drawImage(snap.bmp, 0, 0);
    drawSkeleton(g, s.poses[k], c.width / liveVideo.videoWidth, 1.5);
    out[k] = c.toDataURL("image/jpeg", 0.7);
  }
  return out;
}
function renderLiveResult(s) {
  const fix = pickFix(s.checks, s.view);
  $("#liveResult").hidden = false;
  $("#liveResult").innerHTML = `<div class="row spread"><span class="big-score">${esc(s.total.score ?? "–")}</span><span class="label">${esc(s.total.score == null ? "" : levelOf(s.total.score).name)}</span></div>
    ${fix ? `<p><b>${esc(CHECKS[fix.id].name)}</b>: ${esc(adviceFor(fix.id, fix.c, settings.club))}</p><p class="muted"><b>Drill:</b> ${esc(CHECKS[fix.id].drill)}</p>` : `<p>Nothing big stands out on that one.</p>`}
    ${s.quality.level !== "good" ? `<p class="note">${esc(s.quality.issues.map((x) => x.text).join(" "))}</p>` : ""}
    <div class="row">${s.clip ? `<button class="btn small primary" id="liveFull">Full analysis of this swing</button>` : ""}</div>`;
  const b = $("#liveFull");
  if (b) b.onclick = () => { const f = s.clip; stopLive(); analyze(f); };
  $("#liveList").innerHTML = Live.session.slice(0, 12).map((x, i) => `<div class="hist" style="grid-template-columns:52px minmax(0,1fr) auto"><img alt="" src="${safeImg(x.thumbs?.top)}"><span><b>${esc(x.total.score ?? "–")}</b> <span class="muted">· swing ${Live.session.length - i}${pickFix(x.checks, x.view) ? " · " + esc(CHECKS[pickFix(x.checks, x.view).id].short) : ""}</span></span><span></span></div>`).join("");
}

/* ---------- export / import between the web version and the Claude version ---------- */
async function exportSwings() {
  await Store.ready;
  const data = { app: "swing-lab", version: 1, exportedAt: Date.now(), player: currentPlayer()?.name || "Me", swings: historyCache.map(({ id, ...s }) => s), rounds: roundsCache.map(({ id, ...r }) => r) };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const name = `swing-lab-${new Date().toISOString().slice(0, 10)}.json`;
  if (IN_CLAUDE) return offerFile(blob, name);
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  toast("Exported");
}
async function importSwings(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data?.app !== "swing-lab" || !Array.isArray(data.swings)) throw new Error("not a Swing Lab export");
    await Store.ready;
    if (!canEditPlayer(currentPid)) { toast("Pick yourself (or a mate you added) as Golfer first"); return; }
    const seen = new Set(historyCache.map((s) => s.at + ":" + s.score));
    let n = 0;
    for (const s of data.swings) {
      if (!Number.isFinite(s.at) || seen.has(s.at + ":" + s.score)) continue;
      const clean = { at: s.at, session: String(s.session || "import"), club: String(s.club || ""), view: s.view === "face" ? "face" : "dtl", hand: s.hand === "L" ? "L" : "R",
        score: Number.isFinite(s.score) ? s.score : null, partial: !!s.partial, quality: String(s.quality || ""), tempo: s.tempo || null,
        checks: Object.fromEntries(Object.entries(s.checks || {}).filter(([id]) => CHECKS[id]).map(([id, c]) => [id, { v: +c.v, s: +c.s, m: !!c.m }])),
        fix: CHECKS[s.fix] ? s.fix : null, tags: Array.isArray(s.tags) ? s.tags.filter((x) => BALL_TAGS.includes(x)) : [],
        thumbs: Object.fromEntries(Object.entries(s.thumbs || {}).filter(([, u]) => safeImg(u))), live: !!s.live, lesson: !!s.lesson };
      await Store.addSwing(currentPid, clean); n++;
    }
    for (const r of data.rounds || []) {
      if (!Number.isFinite(r.at) || roundsCache.some((x) => x.at === r.at && x.score === r.score)) continue;
      await Store.addRound(currentPid, { at: r.at, course: String(r.course || "").slice(0, 60), holes: r.holes === 9 ? 9 : 18, score: +r.score, rating: +r.rating || null, slope: +r.slope || null });
    }
    await updateStats(currentPid);
    toast(`Imported ${n} swing${n === 1 ? "" : "s"}`);
    renderProgress();
  } catch (e) { toast("That file is not a Swing Lab export"); }
}
$("#exportBtn").onclick = exportSwings;
$("#importFile").onchange = () => { const f = $("#importFile").files[0]; $("#importFile").value = ""; if (f) importSwings(f); };

/* ---------- wiring ---------- */
if (CAN_CAMERA) {
  $("#liveBtn").onclick = startLive;
  $("#liveStop").onclick = stopLive;
  $("#liveFlip").onclick = async () => { Live.facing = Live.facing === "environment" ? "user" : "environment"; stopLive(); await startLive(); };
  $("#liveVoice").onclick = (e) => { Live.voice = !Live.voice; e.currentTarget.setAttribute("aria-pressed", String(Live.voice)); e.currentTarget.textContent = Live.voice ? "Voice on" : "Voice off"; };
  if (location.hash === "#live") setTimeout(() => $("#liveBtn").focus(), 300);
} else {
  $("#liveBtn").hidden = true;
  $("#liveLink").hidden = !IN_CLAUDE;
}
$("#syncNote").textContent = IN_CLAUDE
  ? "Swings from the live coach on the web are saved on that phone. Export them there, then Import here to add them to your progress (and the crew board)."
  : "Swings here are saved in this browser. Export them, then Import in Swing Lab inside Claude to add them to your progress and Coach Claude.";
document.addEventListener("visibilitychange", () => { if (document.hidden && Live.running) stopLive(); });
