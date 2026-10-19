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
  running: false, gen: 0, stream: null, facing: "environment", voice: true, focus: lsGet("swinglab:liveFocus", "auto"),
  buf: [], snaps: [], state: "frame", stateT: 0, readyT: 0, stillT: 0, lostT: null, resetT: 0, swingT: 0, lastSay: 0, said: new Set(),
  busy: false, fpsT: [], rec: null, clipT: 0, wake: null, session: [], timeScale: +new URLSearchParams(location.search).get("liveslow") || 1,   // test hook: slowed fake camera
};
const liveVideo = $("#liveVideo"), liveOverlay = $("#liveOverlay"), lctx = liveOverlay.getContext("2d");

function liveSay(text, force = false, interrupt = true) {
  const now = performance.now();
  if (!Live.voice || (!force && now - Live.lastSay < 4500)) return false;
  Live.lastSay = now;
  if (!interrupt && speechBusy()) { Live.next = text; Live.nextT = now; return true; }   // one line waits, newest wins: no backlog talking over the swing
  Live.next = null; return speak(text, interrupt);
}
function speechBusy() { try { return speechSynthesis.speaking || speechSynthesis.pending; } catch { return false; } }
// Runs every tracked frame. After 4 s it queues the line anyway, in case a browser never clears `speaking`.
function livePump() { if (Live.next && Live.voice && (!speechBusy() || performance.now() - Live.nextT > 4000)) { const t = Live.next; Live.next = null; speak(t, false); } }
function setStatus(state, text) {
  if (Live.state !== state) { Live.state = state; Live.stateT = performance.now(); Live.next = null; }   // a waiting line is only said in the state that queued it
  const el = $("#liveStatus"); el.dataset.state = state; el.textContent = text;
}
function renderFocus() {
  $("#liveFocus").innerHTML = FOCUS.map(([id, l]) => `<button class="chip" type="button" aria-pressed="${Live.focus === id}" data-f="${id}">${l}</button>`).join("");
  $$("#liveFocus [data-f]").forEach((b) => b.onclick = () => { Live.focus = b.dataset.f; lsSet("swinglab:liveFocus", Live.focus); renderFocus(); });
}

function showLiveBig(score, cue) { $("#liveBigScore").textContent = score; $("#liveBigCue").textContent = cue; $("#liveBig").hidden = false; }
function hideLiveBig() { $("#liveBig").hidden = true; }
function holdAwake(gen) {   // must run before the first await (needs the tap); keeps a Home Screen copy awake on iOS 18.4+ and Android
  try { navigator.wakeLock?.request("screen").then((l) => { if (gen === Live.gen) Live.wake = l; else l.release().catch(() => {}); }, () => {}); } catch {}
}
function releaseAwake() { try { Live.wake?.release().catch(() => {}); } catch {} Live.wake = null; }
function fitLiveStage() {
  const w = liveVideo.videoWidth, h = liveVideo.videoHeight;
  if (!w || !h) return;
  liveVideo.width = w; liveVideo.height = h;   // the pose library sizes video input from these attributes, not the stream
  $("#liveStage").classList.toggle("landscape", w > h);
}
liveVideo.addEventListener("resize", fitLiveStage);   // iOS rotates the camera track when the phone turns
function cameraError(e) {
  const n = e?.name;
  const still = navigator.standalone   // Home Screen app: no address bar or aA menu, only the system setting
    ? "Still blocked? Open Settings › Apps › Safari › Camera (Settings › Safari › Camera before iOS 18), choose Ask or Allow, then reopen Swing Lab."
    : "Still blocked? Tap aA (or the page icon) next to the address › Website Settings › Camera › Allow.";
  return n === "NotAllowedError" || n === "SecurityError" ? "No camera access. Tap Stop, then Live coach, and choose Allow. " + still
    : n === "NotReadableError" || n === "AbortError" ? "The camera is busy. Close any app or call using it, then tap Stop and Live coach again."
    : n === "NotFoundError" ? "No camera found on this device." : "The camera could not start. Tap Stop and try again.";
}
async function startLive() {
  if (engineLost()) return;
  const gen = ++Live.gen, stale = () => gen !== Live.gen;   // Stop, a tab, a lock or a second tap cancels this start
  holdAwake(gen);
  hideError(); hideLiveBig();
  $("#intake").hidden = true; $("#results").hidden = true; $("#live").hidden = false; $("#liveResume").hidden = true;
  renderFocus(); primeVoice(); Live.said.clear();
  setStatus("frame", "Starting the camera…");
  let stream;   // camera first: the prompt shows while they still hold the phone, and the preview runs during the download
  try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: Live.facing, width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } }, audio: false }); }
  catch (e) { if (!stale()) { setStatus("frame", cameraError(e)); releaseAwake(); } return; }
  if (stale()) { stream.getTracks().forEach((t) => t.stop()); return; }
  Live.stream?.getTracks().forEach((t) => t.stop());
  Live.stream = stream;
  const loaded = waitEvent(liveVideo, "loadeddata", 3000);
  liveVideo.srcObject = stream;
  await liveVideo.play().catch(() => {});
  if (liveVideo.readyState < 2) await loaded;
  if (!Engines.fast) {
    const onEng = ({ stage, pct }) => { if (!stale() && stage === "loading") setStatus("frame", pct > 0 ? `Loading the tracker ${Math.round(Math.min(1, pct / 0.2) * 100)}%… frame yourself meanwhile` : "Loading the tracker… frame yourself meanwhile"); };
    Engines.listeners.add(onEng);
    onEng(Engines.status);   // the libraries and model JSON load without progress events: don't leave "Starting the camera…" up
    try { await Engines.ready; } catch (e) { if (!stale()) { stopLive(); showEngineError(e); } return; }
    finally { Engines.listeners.delete(onEng); }
  }
  if (stale()) return;   // stopLive already stopped this stream
  fitLiveStage();
  Engines.fast.reset();
  Live.running = true; Live.buf = []; Live.lostT = null; Live.blink = false; Live.hush = false; Live.fpsT = []; Live.snaps.forEach((s) => s.bmp?.close?.()); Live.snaps = [];
  setStatus("frame", "Prop me at hip height, 3–4 m away, then step in");
  liveSay("Prop me up at hip height, about three or four metres away, then step into the frame so I can see all of you.", true);
  liveTick(gen);
}
function stopLive(pause = false) {
  Live.gen++; Live.running = false;
  Live.next = null; try { speechSynthesis.cancel(); } catch {}   // nothing queued keeps talking after Stop, a tab change, a lock or Full analysis
  dropClip(); releaseAwake(); hideLiveBig();
  Live.stream?.getTracks().forEach((t) => t.stop()); Live.stream = null; liveVideo.srcObject = null;
  lctx.clearRect(0, 0, liveOverlay.width, liveOverlay.height);   // no frozen skeleton on the Paused stage or the next start
  if (pause) {
    $("#liveResume").hidden = false;
    setStatus("frame", "Paused: the screen locked or you left the page. Tap Resume." + (navigator.standalone ? " To stop it locking: turn off Low Power Mode, then Settings › Display & Brightness › Auto-Lock › Never." : ""));
    return;
  }
  $("#live").hidden = true; $("#intake").hidden = false;
  if (a2hsDue) { a2hsDue = false; lsSet("swinglab:a2hsTip", true); setTimeout(a2hsTip, 600); }
}

function liveTick(gen = Live.gen) {
  if (!Live.running || gen !== Live.gen) return;
  const next = () => ("requestVideoFrameCallback" in liveVideo ? liveVideo.requestVideoFrameCallback(() => liveTick(gen)) : requestAnimationFrame(() => liveTick(gen)));
  if (Live.busy) { next(); return; }
  Live.busy = true;
  const t = performance.now() / 1000 / Live.timeScale;
  Engines.fast.detect(liveVideo, Math.round(t * 1000)).then((kp) => {
    Live.busy = false;
    if (!Live.running || gen !== Live.gen) return;
    Live.buf.push({ t, kp });
    while (Live.buf.length && t - Live.buf[0].t > 12) Live.buf.shift();
    snapshot(t);
    drawLive(kp);
    liveStep(t, kp);
    livePump();
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
   frame -> (whole body seen) -> settle -> (hands still and low for 0.3 s) -> ready -> (hands above shoulders) -> swing
   -> (body still after the finish, or 3.5 s) -> analyse. Brief tracking drop-outs are ridden out, not treated as leaving. */
function framePrompt(why, say = true) { setStatus("frame", why); if (say && !Live.said.has(why) && liveSay(why + ".", false, false)) Live.said.add(why); }   // each prompt once per lost spell
function liveStep(t, kp) {
  const W = liveVideo.videoWidth, H = liveVideo.videoHeight;
  const recent = Live.buf.filter((f) => f.kp && t - f.t <= 0.45);
  const ok = kp && isGolferPose(kp, W, H);
  const since = (performance.now() - Live.stateT) / 1000 / Live.timeScale;
  if (Live.state === "analyse" || Live.state === "cool") return;
  if (Live.state === "swing" && t - Live.swingT > 3.5) { analyseLive(t); return; }   // ends even if they walked off after the swing
  if (!ok) {
    if (Live.state === "swing") return;                                     // brief loss mid-swing: keep going
    Live.lostT ??= t;
    if (Live.state !== "frame" && t - Live.lostT < 0.6) return;             // one bad frame: hold settle/ready (and the recorder)
    if (Live.state === "frame" && since > 1.2 && t - Live.resetT > 1) { Engines.fast.reset(); Live.resetT = t; }   // let go of a bystander
    if (since > 1.2 || Live.state !== "frame") {
      const why = !kp ? "I can't see you" : Math.max(kp.lank.y, kp.rank.y) > 0.98 * H ? "Step back, I can't see your feet" : kp.nose.y < 0.02 * H ? "Step back, I can't see your head" : "Whole body in shot, please";
      if (Live.state !== "frame") Live.blink = true;   // fell out of settle/ready: greet on return only if a prompt was spoken
      if (Live.state === "ready") dropClip();
      framePrompt(why, t - Live.lostT > 1.5);           // a short drop-out at address: show it, don't say it
    }
    return;
  }
  Live.lostT = null;
  const torso = dist(mid(kp.lsho, kp.rsho), mid(kp.lhip, kp.rhip)) || 1;
  const bodyH = Math.max(kp.lank.y, kp.rank.y) - kp.nose.y;
  const hand = handCentre(kp), sho = mid(kp.lsho, kp.rsho), hip = mid(kp.lhip, kp.rhip);
  const handsHighNow = hand.y < sho.y;
  const still = recent.length >= 3 && t - recent[0].t >= 0.3 && recent.every((f) => dist(handCentre(f.kp), hand) < 0.05 * bodyH);   // time-based: works down to ~5 fps
  if (Live.state === "frame") {
    if (bodyH < 0.35 * H) { framePrompt("Come a little closer"); return; }
    const greet = !Live.blink || Live.said.size > 0; Live.blink = false; Live.hush = !greet;
    Live.said.clear();
    setStatus("settle", "Set up to the ball"); if (greet) liveSay("Got you. Set up when you're ready.", true, false); return;
  }
  if (Live.state === "settle") {
    if (still && hand.y > hip.y - 0.3 * torso) {
      setStatus("ready", "Ready. Swing when you like"); if (!Live.hush) liveSay("Ready.", true, false); Live.hush = false;   // re-armed after a silent drop-out: stay quiet
      Live.readyT = t; Live.stillT = t; startClip();
    }
    return;
  }
  if (Live.state === "ready") {
    if (handsHighNow) { hideLiveBig(); setStatus("swing", "Swinging…"); Live.swingT = t; return; }
    if (still) { Live.stillT = t; if (since > 0.3) Live.readyT = Math.max(Live.readyT, t - 1.0); }
    if (t - Live.stillT > 3) { dropClip(); setStatus("settle", "Set up to the ball"); }        // 3 s with no pause: re-arm (a takeaway reaches hands-high in < 1 s)
    else if (still && performance.now() - Live.clipT > 20000) startClip();                    // long wait at address: keep the clip short
    return;
  }
  if (Live.state === "swing" && t - Live.swingT > 1.0 && still) analyseLive(t);
}

function dropClip() {                       // discard a recording nobody will use; a pending stopClip still resolves
  const r = Live.rec; Live.rec = null;
  if (r?.state === "recording") { if (!r.onstop) r.ondataavailable = null; try { r.stop(); } catch {} }
}
function startClip() {
  try {
    if (!window.MediaRecorder || !Live.stream) return;
    dropClip();
    const mime = ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
    const chunks = [], rec = new MediaRecorder(Live.stream, mime ? { mimeType: mime, videoBitsPerSecond: 4e6 } : undefined);
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);   // own array per recorder: a late blob can't leak into the next clip
    rec.chunks = chunks; Live.rec = rec; Live.clipT = performance.now(); rec.start();
  } catch (e) { console.warn("recorder", e); Live.rec = null; }
}
function stopClip() {
  return new Promise((res) => {
    const r = Live.rec;
    if (!r || r.state !== "recording") return res(null);
    r.onstop = () => { const type = (r.mimeType || "video/webm").split(";")[0]; res(new File(r.chunks, `swing-${Date.now()}.${type.includes("mp4") ? "mp4" : "webm"}`, { type })); };
    r.stop();
  });
}

async function analyseLive(tEnd) {
  const gen = Live.gen;
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
      s.quality = assessQuality(series, ev, W, H, viewInfo, fs, 1, true);
      Object.assign(s, computeChecks(series, ev, opts, viewInfo));
      s.notes = s.notes.filter((n) => !n.includes("Recorded at"));   // live is real time and has no "Recorded at" setting (keeps the Plays note)
      // Live tracking on a phone often runs well under 60 fps: too few downswing frames to time rhythm honestly.
      if (fs < 45 || ev.downFrames < 9) { if (s.checks.tempo) s.checks.tempo.measured = false; s.slowTrack = Math.round(fs); }
      if (s.quality.cameraMoved) for (const id of ["hipSway", "headSway", "weightShift", "headImpact", "stayBehind", "posture", "headHeight"]) if (s.checks[id]) s.checks[id].measured = false;
      s.total = scoreSwing(s.checks, s.view);
      if (s.quality.level === "poor" && s.total.score > 54) { s.total.score = 54; s.total.capped = "Tracking was poor, so the score is capped at 54."; }
      s.times = ev.times;
      s.thumbs = liveThumbs(s);
    }
    else console.warn("live swing rejected:", findEvents.why, "frames", frames.length);
  } catch (e) { console.warn("live analysis", e); s = null; }
  const clip = await clipP;
  const here = gen === Live.gen;        // false after Stop/tab/lock: still save, but don't talk or touch the stage
  if (!s) {
    if (here) { setStatus("cool", "Didn't catch that one"); showLiveBig("–", "Didn't catch that one"); liveSay("Didn't catch that one. Keep your whole body in shot and hold your finish.", true); }
  } else {
    for (const x of Live.session) x.clip = null;   // only the newest swing has a Full analysis button
    s.clip = clip; Live.session.unshift(s);
    const said = liveCue(s), sc = s.total.score;
    if (here) { setStatus("cool", `${sc ?? "–"} · ${said}`); showLiveBig(sc ?? "–", said); liveSay(sc == null ? `${said}.` : `${sc} out of 100. ${said}.`, true); }
    renderLiveResult(s);
    try { await saveSession([s], { ...opts, club: settings.club }, { live: true }); } catch {}
  }
  setTimeout(() => { if (Live.running && gen === Live.gen) setStatus("settle", "Set up to the ball"); }, 2500);
}
function liveCue(s) {
  const want = Live.focus !== "auto" ? Live.focus : pickFix(s.checks, s.view)?.id;
  const c = want && s.checks[want];
  if (want && c?.measured) return CUES[want][c.score >= 70 ? 1 : 0];
  if (Live.focus === "tempo" && s.slowTrack) return "Rhythm needs the full analysis";
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
    ${s.slowTrack ? `<p class="note">Live tracking ran at about ${s.slowTrack} fps, too slow to time your rhythm.${s.clip ? " Tap Full analysis for rhythm." : ""}</p>` : ""}
    ${s.notes?.length ? `<p class="note">${esc(s.notes.join(" "))}</p>` : ""}
    <div class="row">${s.clip ? `<button class="btn small primary" id="liveFull">Full analysis of this swing</button>` : ""}</div>`;
  const b = $("#liveFull");
  if (b) b.onclick = () => { const f = s.clip, rep = s.savedId ? { pid: s.savedPid, id: s.savedId } : null; stopLive(); analyze(f, { slow: 1, replace: rep, extra: { live: true } }); };
  $("#liveList").innerHTML = Live.session.slice(0, 12).map((x, i) => `<div class="hist" style="grid-template-columns:52px minmax(0,1fr) auto"><img alt="" src="${safeImg(x.thumbs?.top)}"><span><b>${esc(x.total.score ?? "–")}</b> <span class="muted">· swing ${Live.session.length - i}${pickFix(x.checks, x.view) ? " · " + esc(CHECKS[pickFix(x.checks, x.view).id].short) : ""}</span></span><span></span></div>`).join("");
}

/* ---------- export / import between the web version and the Claude version ---------- */
async function exportSwings() {
  await Store.ready;
  const data = { app: "swing-lab", version: 1, exportedAt: Date.now(), player: currentPlayer()?.name || "Me", swings: historyCache.map(({ id, ...s }) => s), rounds: roundsCache.map(({ id, ...r }) => r) };
  const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
  const name = `swing-lab-${localDay()}.json`;
  if (IN_CLAUDE) return offerFile(blob, name);
  const file = new File([blob], name, { type: "application/json" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: "Swing Lab swings" }); settings.lastExport = Date.now(); saveSettings(); return; }
    catch (e) { if (e?.name === "AbortError") return; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); a.remove();
  settings.lastExport = Date.now(); saveSettings(); toast("Saved to Downloads: " + name);
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
  $("#liveStop").onclick = () => stopLive();          // not `= stopLive`: the click event would arrive as `pause`
  $("#liveResume").onclick = startLive;               // a fresh tap: re-primes voice and the wake lock
  $("#liveFlip").onclick = () => { Live.facing = Live.facing === "environment" ? "user" : "environment"; stopLive(); startLive(); };
  $("#liveVoice").onclick = (e) => { Live.voice = !Live.voice; e.currentTarget.setAttribute("aria-pressed", String(Live.voice)); e.currentTarget.textContent = Live.voice ? "Voice on" : "Voice off"; };
  // Leaving the Swing tab ends the session (not inside switchTab: Live is not initialised when ui.js boots).
  $$("[data-tab]").forEach((t) => t.addEventListener("click", () => { if (t.dataset.tab !== "swing" && !$("#live").hidden) stopLive(); }));
  if (location.hash === "#live") setTimeout(() => $("#liveBtn").focus(), 300);
} else {
  $("#liveBtn").hidden = true;
  $("#liveLink").hidden = !IN_CLAUDE;
}
$("#syncNote").textContent = IN_CLAUDE
  ? "Swings from the live coach on the web are saved on that phone. Export them there, then Import here to add them to your progress (and the crew board)."
  : "Swings are saved in this browser only. Export keeps a backup (Safari clears sites you skip for a week) and moves swings to another phone or the Home Screen app. Import loads a file for whoever is picked as Golfer.";
// Claude-only features (Coach Claude) can't run on the public website: hide them rather than lead nowhere.
if (!IN_CLAUDE) {
  $("#askCoach").hidden = true;                    // keep #coachOut: offerFile uses it
  $("#speakBtn").classList.add("primary");
  $("#chatForm").closest(".panel").hidden = true;
  $("#addGuestPanel .note").textContent = "Add a friend, pick them as Golfer, and analyse their clip on this phone.";
}
document.addEventListener("visibilitychange", () => { if (document.hidden && !$("#live").hidden && (Live.running || Live.stream)) stopLive(true); });
