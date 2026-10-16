/* ============================================================
   Swing Lab UI: results, coach lines, progress, crew, coach, sharing.
   ============================================================ */

video = $("#video");
const CLUBS = ["Driver", "3 wood", "Hybrid", "5 iron", "7 iron", "9 iron", "Wedge"];
const BALL_TAGS = ["Good", "Slice", "Hook", "Pull", "Push", "Topped", "Fat", "Shank"];
const STAGES = [
  { name: "Setup and balance", checks: ["spineAddress", "kneeFlex", "stance", "finishHold"] },
  { name: "Stay centred", checks: ["headSway", "hipSway", "headHeight"] },
  { name: "Keep your posture", checks: ["posture", "spineTop"] },
  { name: "Turn and transfer", checks: ["weightShift", "finishPos"] },
  { name: "Strike and direction", checks: ["stayBehind", "headImpact", "overTop"] },
  { name: "Rhythm and repeat", checks: ["tempo"] },
];
const ui = { lines: true, slow: true, numbers: false };
const state = { result: null, cur: 0, opts: null, file: null, sessionId: null };
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ---------- engine status ---------- */
Engines.listeners.add(({ stage, pct }) => {
  const el = $("#engine"), txt = $("#engineText");
  el.dataset.state = stage === "error" ? "error" : stage === "ready" ? "ready" : "loading";
  txt.textContent = stage === "loading" ? `Loading the swing tracker ${Math.round(pct * 100)}%`
    : stage === "fast" || stage === "upgrading" ? `Ready · sharpening ${Math.round(pct * 100)}%`
    : stage === "ready" ? "Tracker ready" : "Tracker failed to load";
});
Engines.ready.catch((e) => showError("The swing tracker could not start in this browser. Screenshot this and send it over. Details: " + (e?.message || e)));

function showError(msg) { const e = $("#errorBox"); e.textContent = msg; e.hidden = false; }
function hideError() { $("#errorBox").hidden = true; }

/* ---------- settings ---------- */
const settings = lsGet("swinglab:settings", { club: "7 iron", view: "auto", slowmo: "0", voiceOn: "off" });
function saveSettings() { lsSet("swinglab:settings", settings); }
function renderClubChips() {
  $("#clubChips").innerHTML = CLUBS.map((c) => `<button class="chip" type="button" aria-pressed="${c === settings.club}" data-club="${esc(c)}">${esc(c)}</button>`).join("");
  $$("#clubChips [data-club]").forEach((b) => b.onclick = () => { settings.club = b.dataset.club; saveSettings(); renderClubChips(); });
}
for (const id of ["view", "slowmo", "voiceOn"]) {
  const el = $("#" + id); el.value = settings[id] || el.value;
  el.onchange = () => { settings[id] = el.value; saveSettings(); summariseSettings(); };
}
$("#hand").onchange = async () => { const p = currentPlayer(); if (p && canEditPlayer(p.id)) { p.hand = $("#hand").value; await Store.savePlayer(p); } summariseSettings(); };
$("#heightCm").onchange = async () => { const p = currentPlayer(); const v = +$("#heightCm").value; if (p && canEditPlayer(p.id) && v >= 120 && v <= 220) { p.heightCm = v; await Store.savePlayer(p); } summariseSettings(); };
function heightFor(p) { const v = +$("#heightCm").value; return v >= 120 && v <= 220 ? v : (p?.heightCm || 178); }
function summariseSettings() {
  const v = { auto: "angle auto", face: "face-on", dtl: "down the line" }[$("#view").value];
  const s = { "0": "", "1": " · normal speed" }[$("#slowmo").value] ?? ` · slo-mo ×${$("#slowmo").value}`;
  $("#settingsSummary").textContent = `${v} · ${$("#hand").value === "L" ? "left" : "right"}-handed · ${$("#heightCm").value || 178} cm${s}`;
}

/* ---------- voice ---------- */
function primeVoice() { try { if ("speechSynthesis" in window) { const u = new SpeechSynthesisUtterance(""); speechSynthesis.speak(u); } } catch {} }
function speak(text) {
  try {
    if (!("speechSynthesis" in window)) return false;
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const v = speechSynthesis.getVoices().find((x) => /en-GB/i.test(x.lang)) || speechSynthesis.getVoices().find((x) => /^en/i.test(x.lang));
    if (v) u.voice = v;
    u.rate = 1.02; speechSynthesis.speak(u);
    return true;
  } catch { return false; }
}

/* ---------- analysis run ---------- */
const preview = $("#previewCanvas"), pctx = preview.getContext("2d");
function drawPreview(f) {
  const src = f.canvas;
  const maxW = Math.min(720, preview.parentElement.clientWidth * (window.devicePixelRatio || 1));
  const sc = Math.min(1, maxW / src.width);
  if (preview.width !== Math.round(src.width * sc)) { preview.width = Math.round(src.width * sc); preview.height = Math.round(src.height * sc); }
  pctx.drawImage(src, 0, 0, preview.width, preview.height);
  if (f.kp) {
    const ox = f.crop?.x || 0, oy = f.crop?.y || 0;
    const kp = {}; for (const k of KEYS) kp[k] = { x: f.kp[k].x - ox, y: f.kp[k].y - oy, v: f.kp[k].v };
    drawSkeleton(pctx, kp, sc, 2.5);
  }
}
function setWork(pct, step, note) {
  $("#workBar").style.width = Math.round(pct) + "%";
  $("#workPct").textContent = Math.round(pct) + "%";
  if (note) $("#workNote").textContent = note;
  const order = ["find", "track", "score"];
  $$("#steps li").forEach((li) => { const i = order.indexOf(li.dataset.step), j = order.indexOf(step); li.dataset.state = i < j ? "done" : i === j ? "active" : ""; });
}

async function analyze(file) {
  hideError();
  try { await Engines.ready; } catch { return; }
  const p = currentPlayer();
  const opts = {
    view: $("#view").value, hand: $("#hand").value, slow: +$("#slowmo").value, club: settings.club,
    heightCm: heightFor(p),
  };
  state.opts = opts; state.file = file;
  $("#intake").hidden = true; $("#results").hidden = true; $("#working").hidden = false;
  $("#workTitle").textContent = "Reading your swing…"; setWork(0, "find", "");
  let lastDraw = 0;
  try {
    const result = await analyzeClip(file, opts, {
      progress: (pct, step, note) => setWork(pct, step, note),
      frame: (f) => { const now = performance.now(); if (now - lastDraw > 60) { lastDraw = now; drawPreview(f); } },
    });
    setWork(97, "score", "Saving key frames");
    for (const s of result.swings) s.thumbs = await grabThumbs(s, result);
    state.result = result;
    const rank = (s) => (s.total.partial ? -1000 : 0) + (s.total.score ?? -1);
    state.cur = result.swings.reduce((bi, s, i) => (rank(s) > rank(result.swings[bi]) ? i : bi), 0);
    $("#working").hidden = true; $("#results").hidden = false;
    renderResults();
    await saveSession(result.swings, opts);
    if (settings.voiceOn === "on") speak(spokenSummary(result.swings[state.cur]));
    window.__swingLab.last = exportAnalysis();
  } catch (e) {
    console.error(e);
    $("#working").hidden = true; $("#intake").hidden = false;
    showError(e.message || String(e));
  }
}
for (const id of ["fileRec", "filePick"]) {
  const inp = $("#" + id);
  inp.addEventListener("click", primeVoice);
  inp.onchange = () => { if (inp.files[0]) analyze(inp.files[0]); inp.value = ""; };
}
const pick = $("#pickBtn");
pick.addEventListener("dragover", (e) => { e.preventDefault(); pick.classList.add("over"); });
pick.addEventListener("dragleave", () => pick.classList.remove("over"));
pick.addEventListener("drop", (e) => { e.preventDefault(); pick.classList.remove("over"); const f = e.dataTransfer.files[0]; if (f) analyze(f); });

/* ---------- drawing ---------- */
function drawSkeleton(g, kp, sc, lw = 3, highlight = null) {
  if (!kp) return;
  g.lineCap = "round";
  for (const [a, b] of BONES) {
    const p = kp[a], q = kp[b];
    if (!Number.isFinite(p.x) || !Number.isFinite(q.x)) continue;
    const hot = highlight && highlight.has(a) && highlight.has(b);
    g.strokeStyle = hot ? (css("--flag") || "#d9432a") : "rgba(255,255,255,.9)";
    g.lineWidth = hot ? lw * 1.8 : lw;
    g.beginPath(); g.moveTo(p.x * sc, p.y * sc); g.lineTo(q.x * sc, q.y * sc); g.stroke();
  }
  g.fillStyle = "rgba(255,255,255,.95)";
  for (const k of KEYS) { const p = kp[k]; if (!Number.isFinite(p.x) || k.endsWith("idx")) continue; g.beginPath(); g.arc(p.x * sc, p.y * sc, lw * 1.1, 0, 7); g.fill(); }
}
const HIGHLIGHT = {
  weightShift: ["lhip", "rhip", "lkne", "rkne", "lank", "rank"], hipSway: ["lhip", "rhip", "lkne", "rkne"], finishPos: ["lhip", "rhip", "lkne", "rkne", "lank", "rank"],
  posture: ["lsho", "rsho", "lhip", "rhip"], spineAddress: ["lsho", "rsho", "lhip", "rhip"], spineTop: ["lsho", "rsho", "lhip", "rhip"], stayBehind: ["lsho", "rsho", "lhip", "rhip"],
  leadArm: ["lsho", "lelb", "lwri", "rsho", "relb", "rwri"], shoulderPlane: ["lsho", "rsho"], shoulderTurn: ["lsho", "rsho"], hipTurn: ["lhip", "rhip"],
  kneeFlex: ["lhip", "lkne", "lank", "rhip", "rkne", "rank"], stance: ["lank", "rank", "lheel", "rheel", "ltoe", "rtoe"], overTop: ["lsho", "lelb", "lwri", "rsho", "relb", "rwri"],
};
const statusColor = (c) => !c || !c.measured ? "rgba(255,255,255,.55)" : c.score >= 70 ? "#3ddc84" : c.score >= 40 ? "#ffc23d" : "#ff5a3d";

const overlay = $("#overlay"), octx = overlay.getContext("2d");
function nearestFrame(series, t) {
  let lo = 0, hi = series.length - 1;
  if (t < series[0].t - 0.3 || t > series[hi].t + 0.3) return -1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (series[m].t < t) lo = m; else hi = m; }
  return Math.abs(series[lo].t - t) < Math.abs(series[hi].t - t) ? lo : hi;
}
function phaseAt(s, t) {
  const tm = s.times;
  if (t < tm.takeaway) return "Address";
  if (t < tm.top - 0.02) return "Backswing";
  if (t < tm.top + 0.04) return "Top";
  if (t < tm.impact - 0.02) return "Downswing";
  if (t < tm.impact + 0.04) return "Impact";
  if (t < tm.finish) return "Follow-through";
  return "Finish";
}
/* Coach lines: the reference lines a teacher draws on your video, coloured by how that check went. */
function drawCoachLines(g, s, sc, t, dpr) {
  const A = s.poses.address, ch = s.checks, ev = s.ev;
  const hc = headCentre(A);
  const cmPx = s.pxPerCm * sc;
  g.save();
  g.setLineDash([7 * dpr, 6 * dpr]); g.lineWidth = 2.2 * dpr;
  // Head circle at setup.
  const headCheck = s.view === "face" ? (t < s.times.top + 0.05 ? ch.headSway : ch.headImpact) : ch.headHeight;
  g.strokeStyle = statusColor(headCheck);
  g.beginPath(); g.arc(hc.x * sc, hc.y * sc, 9 * cmPx, 0, 7); g.stroke();
  if (s.view === "dtl") {
    // Spine line and "tush line" from setup.
    const sh = mid(A.lsho, A.rsho), hp = mid(A.lhip, A.rhip);
    const ex = (sh.x - hp.x) * 0.3, ey = (sh.y - hp.y) * 0.3;
    g.strokeStyle = statusColor(ch.posture);
    g.beginPath(); g.moveTo((hp.x - ex) * sc, (hp.y - ey) * sc); g.lineTo((sh.x + ex) * sc, (sh.y + ey) * sc); g.stroke();
    const handA = mid(A.lwri, A.rwri), away = Math.sign(hp.x - handA.x) || 1;
    const rear = (Math.max(A.lhip.x * away, A.rhip.x * away) * away) + away * 6 * cmPx / sc;
    g.beginPath(); g.moveTo(rear * sc, (hp.y - 25 * cmPx / sc) * sc); g.lineTo(rear * sc, (hp.y + 45 * cmPx / sc) * sc); g.stroke();
  } else {
    // Hip line at setup: sway reference going back, shift reference coming down.
    const hp = mid(A.lhip, A.rhip);
    g.strokeStyle = statusColor(t < s.times.top + 0.05 ? ch.hipSway : ch.weightShift);
    g.beginPath(); g.moveTo(hp.x * sc, (hp.y - 70 * cmPx / sc) * sc); g.lineTo(hp.x * sc, (hp.y + 55 * cmPx / sc) * sc); g.stroke();
  }
  g.setLineDash([]);
  // Hand path: blue going back, red coming down.
  const i = nearestFrame(s.series, t);
  const end = i < 0 ? ev.idx.finish : Math.min(i, ev.idx.finish);
  const seg = (from, to, color) => {
    if (to <= from) return;
    g.strokeStyle = color; g.lineWidth = 3 * dpr; g.beginPath();
    for (let j = from; j <= to; j++) { const p = handCentre(s.series[j].kp); j === from ? g.moveTo(p.x * sc, p.y * sc) : g.lineTo(p.x * sc, p.y * sc); }
    g.stroke();
  };
  seg(ev.idx.takeaway, Math.min(end, ev.idx.top), css("--trail-back") || "#2f6fd6");
  if (end > ev.idx.top) seg(ev.idx.top, end, css("--trail-down") || "#d9432a");
  g.restore();
}
function drawOverlay() {
  const s = curSwing(); if (!s) return;
  const r = overlay.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  if (overlay.width !== Math.round(r.width * dpr)) { overlay.width = Math.round(r.width * dpr); overlay.height = Math.round(r.height * dpr); }
  const sc = overlay.width / state.result.W;
  octx.clearRect(0, 0, overlay.width, overlay.height);
  const t = video.currentTime;
  if (ui.lines) drawCoachLines(octx, s, sc, t, dpr);
  const i = nearestFrame(s.series, t);
  const fix = pickFix(s.checks, s.view);
  const hl = fix && ui.highlight ? new Set(HIGHLIGHT[fix.id] || []) : null;
  if (i >= 0) drawSkeleton(octx, s.series[i].kp, sc, 2.6 * dpr, hl);
  $("#phaseTag").textContent = phaseAt(s, t);
  const span = s.view_t1 - s.view_t0;
  $("#scrub").value = Math.round(1000 * clamp((t - s.view_t0) / span, 0, 1));
}
function loop() { drawOverlay(); const s = curSwing(); if (s && !ui.recording && !video.paused && video.currentTime >= s.view_t1) { video.currentTime = s.view_t0; } if (!video.paused) requestAnimationFrame(loop); }
video.addEventListener("play", () => { $("#play").innerHTML = '<svg><use href="#i-pause"/></svg><span>Pause</span>'; requestAnimationFrame(loop); });
video.addEventListener("pause", () => { $("#play").innerHTML = '<svg><use href="#i-play"/></svg><span>Play</span>'; drawOverlay(); });
video.addEventListener("seeked", drawOverlay);
window.addEventListener("resize", () => { sizeStage(); drawOverlay(); });

/* ---------- thumbnails ---------- */
async function grabThumbs(s, result, width = 240) {
  const out = {};
  const c = document.createElement("canvas");
  const box = s.crop || { x: 0, y: 0, w: result.W, h: result.H };
  const sc = width / box.w;
  c.width = width; c.height = Math.round(box.h * sc);
  const g = c.getContext("2d");
  const vs = result.W / video.videoWidth;
  for (const [k] of KEY_EVENTS) {
    await seekTo(s.times[k]);
    g.drawImage(video, box.x / vs, box.y / vs, box.w / vs, box.h / vs, 0, 0, c.width, c.height);
    const kp = {}; const P = s.poses[k];
    for (const key of KEYS) kp[key] = { x: P[key].x - box.x, y: P[key].y - box.y, v: P[key].v };
    drawSkeleton(g, kp, sc, 1.6);
    out[k] = c.toDataURL("image/jpeg", 0.72);
  }
  return out;
}

/* ---------- results ---------- */
const curSwing = () => state.result?.swings[state.cur];
function sizeStage() {
  const st = $("#stage"); const R = state.result; if (!R) return;
  st.style.aspectRatio = `${R.W} / ${R.H}`;
  st.style.width = `min(100%, ${Math.round((R.W / R.H) * 66)}vh)`;
}
function verdictLine(s) {
  if (s.total.score == null) return "Not enough of the swing was measured to give a score.";
  return levelOf(s.total.score).line;
}
function renderResults() {
  const s = curSwing(), R = state.result;
  s.view_t0 = Math.max(0, s.times.address - 0.35 * state.opts.slow);
  s.view_t1 = Math.min(R.dur, s.times.finish + 0.8 * state.opts.slow);
  sizeStage();
  // swing chips
  $("#strip").innerHTML = R.swings.map((sw, i) => `<button class="chip" aria-pressed="${i === state.cur}" data-i="${i}">Swing ${i + 1} <span class="mark ${statusOf(sw.total.score)}">${sw.total.score ?? "–"}</span></button>`).join("");
  $$("#strip [data-i]").forEach((b) => b.onclick = () => { state.cur = +b.dataset.i; $("#coachOut").hidden = true; renderResults(); });
  // score + level
  const score = s.total.score;
  const C = 2 * Math.PI * 52;
  $("#ringArc").setAttribute("stroke-dasharray", `${C * (score ?? 0) / 100} ${C}`);
  const st0 = statusOf(score);
  $("#ringArc").setAttribute("stroke", css(st0 === "good" ? "--good" : st0 === "ok" ? "--ok" : "--work"));
  $("#ringNum").textContent = score ?? "–";
  const lv = levelOf(score ?? 0);
  $("#levelName").textContent = score == null ? "Not scored" : lv.name;
  $("#ladder").innerHTML = LADDER.map((l) => `<span class="${(score ?? 0) >= l.min ? "on" : ""}"></span>`).join("");
  $("#ladderNames").innerHTML = LADDER.map((l, i) => `<span>${i === 0 || i === LADDER.length - 1 || l.name === lv.name ? esc(l.name) : ""}</span>`).join("");
  $("#swingMeta").textContent = `${s.view === "face" ? "Face-on" : "Down the line"} · ${state.opts.club}`;
  const extra = [];
  if (s.total.capped) extra.push(s.total.capped);
  if (s.total.partial) extra.push("Some checks could not be measured from this clip, so this is a partial score.");
  extra.push("One swing is a snapshot. Your level settles after 3 or more swings.");
  $("#levelLine").textContent = verdictLine(s) + " " + extra.join(" ");
  // quality
  const q = s.quality;
  $("#quality").dataset.level = q.level;
  $("#quality").innerHTML = q.level === "good"
    ? `<b>Tracking: good.</b><span>Clear view, ${Math.round(R.fps)} fps${state.opts.slowGuessed ? ", slo-mo detected" : ""}${s.ev.audioImpact ? ", impact timed from the strike sound" : ""}.</span>`
    : `<b>Tracking: ${q.level === "ok" ? "fair" : "poor"}.</b><span>${q.issues.map((x) => esc(x.text)).join(" ")}</span>`;
  for (const n of s.notes) $("#quality").insertAdjacentHTML("beforeend", `<span>${esc(n)}</span>`);
  renderFixCard(s);
  const good = pickStrength(s.checks, s.view);
  $("#goodCard").hidden = !good;
  if (good) $("#goodCard").innerHTML = `<span class="label">What you did well</span><b>${esc(CHECKS[good.id].name)}</b><p class="muted">${esc(CHECKS[good.id].good)}</p>`;
  renderRest(s, R);
}
function renderFixCard(s) {
  const fix = pickFix(s.checks, s.view);
  if (fix) {
    const d = CHECKS[fix.id];
    const streak = graduation(fix.id);
    $("#fix").innerHTML = `
      <span class="label">Fix this first</span>
      <h3>${esc(d.name)}</h3>
      <p>${esc(adviceFor(fix.id, fix.c, state.opts.club))}</p>
      <p class="muted">${esc(d.ball)}</p>
      <p><b>Drill:</b> ${esc(d.drill)}</p>
      <div class="row spread"><button class="btn small flag" id="showFix">Show me</button>
      <span class="note" title="Five good swings in a row marks it fixed">${dots(streak)} ${streak}/5 good in a row</span></div>`;
    $("#showFix").onclick = () => showMe(fix.id);
  } else {
    $("#fix").innerHTML = `<span class="label">Fix this first</span><h3>Nothing big stands out</h3><p>Film the other camera angle to check the rest of your swing.</p>`;
  }
}
function renderRest(s, R) {
  renderBallTags();
  renderChecks();
  renderRhythm();
  $("#frames").innerHTML = KEY_EVENTS.map(([k, l]) => `<figure data-k="${k}"><img alt="${l} position" src="${safeImg(s.thumbs?.[k])}"><figcaption>${l}</figcaption></figure>`).join("");
  $$("#frames figure").forEach((f) => f.onclick = () => { video.pause(); seekTo(s.times[f.dataset.k]); $("#stage").scrollIntoView({ behavior: "smooth", block: "center" }); });
  // scrubber ticks
  const span = s.view_t1 - s.view_t0;
  $("#ticks").innerHTML = KEY_EVENTS.map(([k, l]) => `<span style="left:${clamp((s.times[k] - s.view_t0) / span, 0.05, 0.95) * 100}%">${l}</span>`).join("");
  ui.highlight = false;
  video.playbackRate = ui.slow ? 0.3 : 1;
  seekTo(s.view_t0).then(() => { video.play().catch(() => drawOverlay()); });
}
const safeImg = (u) => (typeof u === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(u) ? u : "");
const dots = (n) => Array.from({ length: 5 }, (_, i) => (i < n ? "●" : "○")).join("");

function renderChecks() {
  const s = curSwing();
  const ids = Object.keys(CHECKS).filter((id) => CHECKS[id].view === "both" || CHECKS[id].view === s.view);
  const rows = ids.map((id) => ({ id, c: s.checks[id] })).sort((a, b) => (a.c?.measured ? a.c.score : 999) - (b.c?.measured ? b.c.score : 999));
  $("#checks").innerHTML = rows.map(({ id, c }) => {
    const d = CHECKS[id];
    if (!c || !c.measured) {
      return `<details class="check"><summary><span class="mark na">–</span><span class="name">${esc(d.name)}<span class="verdict">Not measured on this clip</span></span><svg class="chev" width="16" height="16"><use href="#i-chev"/></svg></summary>
        <div class="more"><p>${esc(d.explain)}</p><p class="muted">${c ? "The joints it needs were hidden or blurred around that moment." : "This needs a clearer view of that moment."}</p></div></details>`;
    }
    const st = statusOf(c.score);
    const sc = checkScale(id, state.opts.club);
    const pos = (v) => clamp((v - sc.lo) / (sc.hi - sc.lo), 0, 1) * 100;
    const verdict = c.score >= 70 ? "On target" : c.score >= 40 ? "Close" : "Work on this";
    return `<details class="check"><summary><span class="mark ${st}">${c.score}</span><span class="name">${esc(d.name)}<span class="verdict">${verdict}${ui.numbers ? " · " + esc(fmtCheck(id, c.value, c)) : ""}${d.conf === "low" ? " · estimate" : ""}</span></span><svg class="chev" width="16" height="16"><use href="#i-chev"/></svg></summary>
      <div class="more">
        <p>${esc(adviceFor(id, c, state.opts.club))}</p>
        <div><div class="track"><span class="band" style="left:${pos(sc.band[0])}%;width:${pos(sc.band[1]) - pos(sc.band[0])}%"></span><span class="dot" style="left:${pos(c.value)}%"></span></div>
        <div class="track-labels"><span>You: ${esc(fmtCheck(id, c.value, c))}</span><span>Target: ${esc(fmtCheck(id, sc.a.tour[0], {}))}${!sc.a.atLeast ? " to " + esc(fmtCheck(id, sc.a.tour[1], {})) : "+"}</span></div></div>
        <p class="muted">${esc(d.explain)} ${esc(d.ball)}</p>
        <p><b>Drill:</b> ${esc(d.drill)}</p>
        <button class="btn small" data-show="${id}">Show me</button>
      </div></details>`;
  }).join("");
  $$("#checks [data-show]").forEach((b) => b.onclick = () => showMe(b.dataset.show));
}
function showMe(id) {
  const s = curSwing(); const ev = CHECKS[id].event;
  video.pause(); ui.highlight = true;
  const t = s.times[ev] ?? s.times.impact;
  seekTo(t).then(drawOverlay);
  $("#stage").scrollIntoView({ behavior: "smooth", block: "center" });
}
function renderRhythm() {
  const s = curSwing(), t = s.ev.tempo, c = s.checks.tempo;
  if (!t.ok || !c) { $("#rhythm").innerHTML = `<p class="muted">Rhythm could not be timed on this swing. The start of the backswing was not clear.</p>`; return; }
  const max = Math.max(t.back, t.down * 3, 1.2);
  $("#rhythm").innerHTML = `
    <div class="rbar"><span>Backswing</span><i class="back" style="width:${t.back / max * 100}%"></i><span class="num">${t.back.toFixed(2)}s</span></div>
    <div class="rbar"><span>Downswing</span><i class="down" style="width:${t.down / max * 100}%"></i><span class="num">${t.down.toFixed(2)}s</span></div>
    <p><b>${esc(fmtCheck("tempo", c.value, c))}</b> <span class="muted">· pros sit near 3 : 1, smooth back and three times quicker down.</span></p>
    <p class="note">${c.precise ? "" : "Filmed at under 60 fps, so this is about ±0.5. "}${s.ev.audioImpact ? "Impact timed from the strike sound." : ""}</p>
    <button class="btn small" id="tempoTone">Hear 3 : 1 rhythm</button>`;
  $("#tempoTone").onclick = playTempo;
}
/* Tour Tempo 27/9 at 30 fps: start, top 0.9 s later, impact 0.3 s after that. */
function playTempo() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext; const ac = new AC();
    const beep = (at, f) => { const o = ac.createOscillator(), g = ac.createGain(); o.frequency.value = f; o.connect(g); g.connect(ac.destination); g.gain.setValueAtTime(0.0001, ac.currentTime + at); g.gain.exponentialRampToValueAtTime(0.4, ac.currentTime + at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + at + 0.12); o.start(ac.currentTime + at); o.stop(ac.currentTime + at + 0.15); };
    for (let r = 0; r < 3; r++) { const b = r * 2.4; beep(b, 520); beep(b + 0.9, 660); beep(b + 1.2, 880); }
  } catch { toast("Sound is not available here"); }
}
function renderBallTags() {
  const s = curSwing();
  $("#ballTags").innerHTML = BALL_TAGS.map((t) => `<button class="chip" type="button" aria-pressed="${(s.tags || []).includes(t)}" data-tag="${t}">${t}</button>`).join("");
  $$("#ballTags [data-tag]").forEach((b) => b.onclick = async () => {
    const t = b.dataset.tag;
    s.tags = (s.tags || []).includes(t) ? s.tags.filter((x) => x !== t) : [...(s.tags || []).filter((x) => t !== "Good" && x !== "Good"), t];
    renderBallTags();
    if (s.savedId && canEditPlayer(s.savedPid)) { try { await Store.updateSwing(s.savedPid, s.savedId, { tags: s.tags }); } catch { toast("Could not save that tag"); } }
  });
}

$("#play").onclick = async () => {
  const s = curSwing();
  if (video.paused) {
    ui.highlight = false;
    if (video.currentTime >= s.view_t1 - 0.05 || video.currentTime < s.view_t0) await seekTo(s.view_t0);
    video.playbackRate = ui.slow ? 0.3 : 1; video.play();
  } else video.pause();
};
function stepFrame(dir) {
  const s = curSwing(); video.pause();
  const i = nearestFrame(s.series, video.currentTime);
  const j = clamp((i < 0 ? 0 : i) + dir, 0, s.series.length - 1);
  seekTo(s.series[j].t);
}
$("#prevF").onclick = () => stepFrame(-1);
$("#nextF").onclick = () => stepFrame(1);
$("#scrub").oninput = () => { const s = curSwing(); video.pause(); seekTo(s.view_t0 + (s.view_t1 - s.view_t0) * $("#scrub").value / 1000); };
document.addEventListener("keydown", (e) => {
  if ($("#results").hidden || $("#v-swing").hidden || ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "SUMMARY", "A"].includes(e.target.tagName) || e.target.isContentEditable) return;
  if (e.key === "ArrowLeft") stepFrame(-1);
  if (e.key === "ArrowRight") stepFrame(1);
  if (e.key === " ") { e.preventDefault(); $("#play").click(); }
});
$("#speed").onclick = (e) => { ui.slow = !ui.slow; e.currentTarget.setAttribute("aria-pressed", String(ui.slow)); video.playbackRate = ui.slow ? 0.3 : 1; };
$("#lines").onclick = (e) => { ui.lines = !ui.lines; e.currentTarget.setAttribute("aria-pressed", String(ui.lines)); drawOverlay(); };
$("#numbersBtn").onclick = (e) => { ui.numbers = !ui.numbers; e.currentTarget.setAttribute("aria-pressed", String(ui.numbers)); e.currentTarget.textContent = ui.numbers ? "Hide numbers" : "Show numbers"; renderChecks(); };
$("#newClip").onclick = () => { $("#results").hidden = true; $("#intake").hidden = false; video.pause(); window.scrollTo({ top: 0 }); };

/* ---------- voice summary ---------- */
function spokenSummary(s) {
  const fix = pickFix(s.checks, s.view), good = pickStrength(s.checks, s.view);
  const parts = [s.total.score == null ? "Not enough of this swing was measured to score it." : `Swing score ${s.total.score}. ${levelOf(s.total.score).name}.`];
  if (good) parts.push(`Good: ${CHECKS[good.id].short.toLowerCase()}.`);
  if (fix) parts.push(`Fix this first: ${CHECKS[fix.id].name.toLowerCase()}. ${adviceFor(fix.id, fix.c, state.opts.club)} Drill: ${CHECKS[fix.id].drill}`);
  if (s.checks.tempo) parts.push(`Rhythm ${s.checks.tempo.value.toFixed(1)} to 1.`);
  return parts.join(" ");
}
$("#speakBtn").onclick = () => { const s = curSwing(); if (!speak(spokenSummary(s))) toast("Speech is not available in this browser"); };

/* ---------- Coach Claude on this swing ---------- */
let coachCtl = null;
function swingFacts(s) {
  const rows = Object.entries(s.checks).map(([id, c]) => `- ${CHECKS[id].name} (${CHECKS[id].short}): ${c.measured ? fmtCheck(id, c.value, c) + `, score ${c.score}/100` : "not measured"}; tour range ${fmtCheck(id, anchorsFor(id, state.opts.club).tour[0], {})} to ${fmtCheck(id, anchorsFor(id, state.opts.club).tour[1], {})}`).join("\n");
  return `Camera: ${s.view === "face" ? "face-on" : "down the line"}. Club: ${state.opts.club}. Handed: ${state.opts.hand === "L" ? "left" : "right"}.
Overall swing score: ${s.total.score} (${levelOf(s.total.score ?? 0).name})${s.total.capped ? "; " + s.total.capped : ""}.
Tracking quality: ${s.quality.level}${s.quality.issues.length ? " — " + s.quality.issues.map((x) => x.text).join(" ") : ""}.
Tempo: backswing ${s.ev.tempo.back.toFixed(2)} s, downswing ${s.ev.tempo.down.toFixed(2)} s${s.ev.audioImpact ? " (impact from strike sound)" : ""}.
Ball result tagged by golfer: ${(s.tags || []).join(", ") || "not tagged"}.
Measured checks:
${rows}`;
}
function contextFacts() {
  const p = currentPlayer();
  const cues = (coachDoc.cues || []).map((c) => `- ${c.text}${c.done ? " (feels automatic now)" : ""}`).join("\n") || "- none recorded";
  const recent = historyCache.slice(0, 10).map((h) => `${fmtDate(h.at)} ${h.club} ${h.view}: ${h.score}${h.tags?.length ? " [" + h.tags.join(",") + "]" : ""}`).join("; ") || "none yet";
  const rounds = roundsCache.slice(0, 6).map((r) => `${fmtDate(r.at)} ${r.course} ${r.holes} holes: ${r.score}`).join("; ") || "none logged";
  return `Golfer: ${p?.name || "Aaron"}, complete beginner (a few 9-hole rounds two years ago, first lesson recently). Goal: break 90 over 18 holes, then a 20-40 handicap and lower.
Coach's cues from lessons:
${cues}
Recent swing scores: ${recent}
Recent rounds: ${rounds}`;
}
const COACH_RULES = `You are Coach Claude, a PGA-qualified golf coach working with a beginner through the Swing Lab app.
Be honest and specific: never inflate. Write for someone who knows nothing about golf, in short plain sentences, no jargon without a quick explanation.
The measurements come from a single phone camera and body tracking (no club or ball data). Trust them but say if the images suggest a measurement is off (for example the camera angle).
Reply in exactly four short sections with these headings on their own lines: "What I see", "Fix this first", "Drill", "Next time you film". Total under 180 words.`;
async function askCoach() {
  const out = $("#coachOut"), btn = $("#askCoach");
  const sample = await window.claude?.use?.("sample").catch(() => null);
  if (!sample) { out.hidden = false; out.textContent = "Coach Claude is available when you open Swing Lab inside Claude."; return; }
  const s = curSwing();
  coachCtl?.abort(); coachCtl = new AbortController();
  out.hidden = false; out.textContent = "Coach Claude is looking at your swing…"; btn.disabled = true;
  try {
    const limits = await sample.limits?.().catch(() => null);
    const images = [];
    try {
      if (limits?.images) for (const k of ["address", "top", "impact", "finish"]) { const u = s.thumbs?.[k]; if (u) images.push(new Blob([decodeB64(u.slice(u.indexOf(",") + 1))], { type: "image/jpeg" })); }
    } catch { images.length = 0; }
    const prompt = `${COACH_RULES}\n\n${contextFacts()}\n\nThis swing:\n${swingFacts(s)}\n\n${images.length ? "The four images are this swing at address, top, impact and finish, with the tracked skeleton drawn on." : ""}`;
    await sample(prompt, { signal: coachCtl.signal, images: images.length ? images.slice(0, limits.images.maxCount || 4) : undefined, onText: ({ text }) => { out.textContent = text.replace(/\*\*/g, ""); } });
  } catch (e) {
    if (e?.code !== "cancelled") out.textContent = (e?.text ? e.text + "\n\n" : "") + (e?.code === "not_granted" ? "Coach Claude needs your OK to run. Tap the button again and allow it." : e?.code === "rate_limited" ? "Coach Claude is busy. Try again in a minute." : "Coach Claude could not answer this time.");
  } finally { btn.disabled = false; }
}
$("#askCoach").onclick = askCoach;

/* ---------- share card and clip ---------- */
async function offerFile(blob, filename) {
  const dl = await window.claude?.use?.("downloads").catch(() => null);
  if (dl) {
    try { await dl.save({ filename, data: blob }); toast("Saved"); return; }
    catch (e) { if (e?.code === "declined") return; }
  }
  // No save surface here: show it so it can be long-pressed.
  const url = URL.createObjectURL(blob);
  const out = $("#coachOut"); out.hidden = false;
  out.innerHTML = blob.type.startsWith("video") ? `<video src="${url}" controls playsinline style="width:100%;border-radius:10px"></video><p class="note">Press and hold the video to save it.</p>` : `<img src="${url}" alt="Swing card" style="width:100%;border-radius:10px"><p class="note">Press and hold the image to save it.</p>`;
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
async function shareCard() {
  const s = curSwing(), R = state.result;
  const W = 1080, H = 1350, c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#0b1310"; g.fillRect(0, 0, W, H);
  // frame at impact, cropped to the golfer
  await seekTo(s.times.impact);
  const box = s.crop || { x: 0, y: 0, w: R.W, h: R.H };
  const vs = R.W / video.videoWidth;
  const imgH = 860, imgW = W - 96, fit = Math.min(imgW / box.w, imgH / box.h);
  const dw = box.w * fit, dh = box.h * fit, dx = (W - dw) / 2, dy = 150 + (imgH - dh) / 2;
  g.save(); roundRect(g, 48, 150, imgW, imgH, 28); g.clip(); g.fillStyle = "#000"; g.fillRect(48, 150, imgW, imgH);
  g.drawImage(video, box.x / vs, box.y / vs, box.w / vs, box.h / vs, dx, dy, dw, dh);
  g.translate(dx - box.x * fit, dy - box.y * fit);
  drawCoachLines(g, s, fit, s.times.impact, 2.2);
  drawSkeleton(g, s.poses.impact, fit, 5, null);
  g.restore();
  g.fillStyle = "#e6eee8"; g.font = "800 46px Archivo, sans-serif"; g.fillText("Swing/Lab", 48, 96);
  g.fillStyle = "#8fa198"; g.font = "500 30px 'Instrument Sans', sans-serif"; g.textAlign = "right"; g.fillText(new Date().toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) + " · " + state.opts.club, W - 48, 96); g.textAlign = "left";
  const fix = pickFix(s.checks, s.view), good = pickStrength(s.checks, s.view);
  g.fillStyle = "#5cc98b"; g.font = "850 150px Archivo, sans-serif"; g.fillText(String(s.total.score ?? "–"), 48, 1170);
  g.fillStyle = "#e6eee8"; g.font = "800 46px Archivo, sans-serif"; g.fillText(s.total.score == null ? "Not scored" : levelOf(s.total.score).name, 300, 1100);
  g.fillStyle = "#8fa198"; g.font = "500 30px 'Instrument Sans', sans-serif";
  if (good) g.fillText("Good: " + CHECKS[good.id].name, 300, 1150);
  if (fix) { g.fillStyle = "#ff6b4f"; g.fillText("Working on: " + CHECKS[fix.id].name, 300, 1195); }
  g.fillStyle = "#8fa198"; g.font = "500 24px 'Instrument Sans', sans-serif"; g.fillText("Body tracking from one phone camera · honest scoring", 48, 1290);
  const blob = await new Promise((res) => c.toBlob(res, "image/png"));
  await offerFile(blob, `swing-${new Date().toISOString().slice(0, 10)}.png`);
}
async function shareClip() {
  const s = curSwing(), R = state.result;
  if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) { toast("Clip export is not available in this browser"); return; }
  const btn = $("#shareClip"); btn.disabled = true; const label = btn.innerHTML; btn.textContent = "Recording…";
  try {
    const box = s.crop || { x: 0, y: 0, w: R.W, h: R.H };
    const outW = 720, fit = outW / box.w, outH = Math.round(box.h * fit / 2) * 2;
    const c = document.createElement("canvas"); c.width = outW; c.height = outH; const g = c.getContext("2d");
    const vs = R.W / video.videoWidth;
    const mime = ["video/mp4", "video/webm;codecs=vp9", "video/webm"].find((m) => MediaRecorder.isTypeSupported(m)) || "";
    const rec = new MediaRecorder(c.captureStream(30), mime ? { mimeType: mime, videoBitsPerSecond: 4e6 } : undefined);
    const chunks = []; rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const done = new Promise((res) => (rec.onstop = res));
    video.pause(); await seekTo(s.view_t0);
    const draw = () => {
      g.drawImage(video, box.x / vs, box.y / vs, box.w / vs, box.h / vs, 0, 0, outW, outH);
      g.save(); g.translate(-box.x * fit, -box.y * fit);
      drawCoachLines(g, s, fit, video.currentTime, 1.4);
      const i = nearestFrame(s.series, video.currentTime); if (i >= 0) drawSkeleton(g, s.series[i].kp, fit, 3);
      g.restore();
      g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(14, 14, 250, 64); g.fillStyle = "#fff"; g.font = "800 34px Archivo, sans-serif"; g.fillText(`${s.total.score ?? "–"}  ${s.total.score == null ? "" : levelOf(s.total.score).name}`, 26, 58);
      g.font = "700 22px Archivo, sans-serif"; g.fillText(phaseAt(s, video.currentTime).toUpperCase(), 18, outH - 22);
    };
    draw(); rec.start();
    video.playbackRate = 0.4;
    ui.recording = true;
    await video.play();
    await new Promise((res) => {
      const tick = () => { draw(); if (video.currentTime >= s.view_t1 || video.paused) res(); else requestAnimationFrame(tick); };
      tick();
    });
    video.pause(); rec.stop(); await done;
    const type = (rec.mimeType || mime || "video/webm").split(";")[0];
    await offerFile(new Blob(chunks, { type }), `swing-${new Date().toISOString().slice(0, 10)}.${type.includes("mp4") ? "mp4" : "webm"}`);
  } catch (e) { console.error(e); toast("Could not record the clip"); }
  finally { ui.recording = false; btn.disabled = false; btn.innerHTML = label; video.playbackRate = ui.slow ? 0.3 : 1; }
}
$("#shareCard").onclick = shareCard;
$("#shareClip").onclick = shareClip;

/* ============================================================
   Storage: artifact db when available, browser storage otherwise
   ============================================================ */
const Store = {
  mode: "local", db: null, user: null, me: "me", owner: true, ready: null,
  local: lsGet("swinglab:v2", { players: {}, swings: {}, coach: {}, rounds: {} }),
  flush() {
    if (lsSet("swinglab:v2", this.local)) return;
    const lite = { ...this.local, swings: Object.fromEntries(Object.entries(this.local.swings).map(([k, l]) => [k, l.map(({ thumbs, ...r }) => r)])) };
    if (!lsSet("swinglab:v2", lite)) throw new Error("Could not save in this browser");
  },
  async init() {
    try {
      if (window.claude?.use) {
        const [db, user] = await Promise.all([window.claude.use("db"), window.claude.use("user")]);
        if (db && user) {
          const id = await user.id();
          if (id) { this.db = db; this.user = user; this.me = id; this.mode = "db"; this.owner = await user.isOwner(); }
        }
      }
    } catch (e) { console.warn("db unavailable", e); }
    const players = await this.players();
    if (!players.find((p) => p.id === this.me)) {
      let name = "Me";
      try { if (this.user) { const m = await this.user.me(); name = (m && m.name) || "Me"; } } catch {}
      await this.savePlayer({ id: this.me, name, hand: "R", heightCm: 178, kind: "self", createdAt: Date.now(), stats: {} });
    }
  },
  col(path) { return this.db.collection(path); },
  async players() {
    if (this.mode === "db") return (await this.col("crew").get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    return Object.entries(this.local.players).map(([id, p]) => ({ id, ...p }));
  },
  async savePlayer(p) {
    const { id, ...body } = p;
    if (this.mode === "db") await this.db.doc("crew/" + id).set(body); else { this.local.players[id] = body; this.flush(); }
  },
  async swings(pid) {
    if (this.mode === "db") return (await this.col(`crew/${pid}/swings`).orderBy("at", "desc").limit(500).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    return [...(this.local.swings[pid] || [])].sort((a, b) => b.at - a.at);
  },
  async addSwing(pid, s) {
    const id = uid();
    if (this.mode === "db") await this.db.doc(`crew/${pid}/swings/${id}`).set(s); else { (this.local.swings[pid] ||= []).push({ id, ...s }); this.flush(); }
    return id;
  },
  async updateSwing(pid, id, patch) {
    if (this.mode === "db") await this.db.doc(`crew/${pid}/swings/${id}`).update(patch);
    else { const s = (this.local.swings[pid] || []).find((x) => x.id === id); if (s) Object.assign(s, patch); this.flush(); }
  },
  async deleteSwing(pid, id) {
    if (this.mode === "db") await this.db.doc(`crew/${pid}/swings/${id}`).delete();
    else { this.local.swings[pid] = (this.local.swings[pid] || []).filter((s) => s.id !== id); this.flush(); }
  },
  async rounds(pid) {
    if (this.mode === "db") return (await this.col(`crew/${pid}/rounds`).orderBy("at", "desc").limit(200).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
    return [...(this.local.rounds[pid] || [])].sort((a, b) => b.at - a.at);
  },
  async addRound(pid, r) {
    const id = uid();
    if (this.mode === "db") await this.db.doc(`crew/${pid}/rounds/${id}`).set(r); else { (this.local.rounds[pid] ||= []).push({ id, ...r }); this.flush(); }
  },
  async deleteRound(pid, id) {
    if (this.mode === "db") await this.db.doc(`crew/${pid}/rounds/${id}`).delete();
    else { this.local.rounds[pid] = (this.local.rounds[pid] || []).filter((s) => s.id !== id); this.flush(); }
  },
  async coach(pid) {
    // Snapshots from the store are frozen; work on a copy.
    if (this.mode === "db") { const d = await this.db.doc(`crew/${pid}/meta/coach`).get(); return d.exists ? JSON.parse(JSON.stringify(d.data())) : { notes: "", cues: [] }; }
    return JSON.parse(JSON.stringify(this.local.coach[pid] || { notes: "", cues: [] }));
  },
  async saveCoach(pid, c) {
    if (this.mode === "db") await this.db.doc(`crew/${pid}/meta/coach`).set(c); else { this.local.coach[pid] = c; this.flush(); }
  },
};

let players = [], currentPid = "me", historyCache = [], roundsCache = [];
const canEditPlayer = (pid) => pid === Store.me || Store.owner;
const currentPlayer = () => players.find((p) => p.id === currentPid);

async function refreshPlayers() {
  players = await Store.players();
  const editable = players.filter((p) => canEditPlayer(p.id)).sort((a, b) => (a.id === Store.me ? -1 : b.id === Store.me ? 1 : a.name.localeCompare(b.name)));
  if (!editable.find((p) => p.id === currentPid)) currentPid = Store.me;
  $("#golfer").innerHTML = editable.map((p) => `<option value="${esc(p.id)}">${esc(p.id === Store.me ? p.name + " (you)" : p.name)}</option>`).join("");
  $("#golfer").value = currentPid;
  applyPlayer();
}
function applyPlayer() {
  const p = currentPlayer();
  if (p?.hand) $("#hand").value = p.hand;
  $("#heightCm").value = p?.heightCm || "";
  summariseSettings();
}
$("#golfer").onchange = async (e) => { currentPid = e.target.value; applyPlayer(); await loadHistory(); renderActiveTab(); };
async function loadHistory() {
  try { [historyCache, roundsCache] = await Promise.all([Store.swings(currentPid), Store.rounds(currentPid)]); } catch { historyCache = []; roundsCache = []; }
}

function swingRecord(s, opts, sessionId, extra = {}) {
  const checks = Object.fromEntries(Object.entries(s.checks).map(([id, c]) => [id, { v: c.value, s: c.score, m: c.measured }]));
  return {
    at: Date.now(), session: sessionId, club: opts.club, view: s.view, hand: opts.hand, score: s.total.score, partial: !!s.total.partial,
    quality: s.quality.level, tempo: s.ev.tempo.ok ? { back: +s.ev.tempo.back.toFixed(3), down: +s.ev.tempo.down.toFixed(3) } : null,
    checks, fix: pickFix(s.checks, s.view)?.id || null, tags: s.tags || [], thumbs: s.thumbs, ...extra,
  };
}
async function saveSession(swings, opts, extra) {
  let saved = false;
  try {
    await Store.ready;
    if (!canEditPlayer(currentPid)) return false;
    const pid = currentPid, sessionId = uid();
    for (const s of swings) { s.savedId = await Store.addSwing(pid, swingRecord(s, opts, sessionId, extra)); s.savedPid = pid; }
    await updateStats(pid);
    saved = true;
    toast(`Saved ${swings.length} swing${swings.length > 1 ? "s" : ""} to ${players.find((x) => x.id === pid)?.id === Store.me ? "your" : (players.find((x) => x.id === pid)?.name || "their") + "’s"} progress`);
  } catch (e) {
    console.error(e);
    toast(e?.code === "quota_exceeded" ? "Storage is full. Delete some old swings in Progress." : "Could not save these swings. Your results are still here.");
  }
  // Refresh only the fix card's streak (never re-seek or replay the video from here).
  if (saved && state.result?.swings === swings && !$("#results").hidden) renderFixCard(curSwing());
  return saved;
}
async function updateStats(pid) {
  await loadHistory();
  const p = players.find((x) => x.id === pid) || { id: pid, name: "Me", kind: "self" };
  const full = historyCache.filter((s) => !s.partial && Number.isFinite(s.score));
  const scores = (full.length ? full : historyCache).map((s) => s.score).filter(Number.isFinite);
  const r18 = roundsCache.map(to18).filter(Number.isFinite);
  p.stats = {
    swings: historyCache.length, best: scores.length ? Math.max(...scores) : null, form: scores.length ? Math.round(mean(scores.slice(0, 10))) : null,
    lastAt: historyCache[0]?.at || roundsCache[0]?.at || null, bestRound: r18.length ? Math.min(...r18) : null, hcp: handicapIndex(roundsCache),
  };
  await Store.savePlayer(p);
  players = await Store.players();
}

/* Five good swings in a row on a check marks it fixed. Counts back from the newest saved swing. */
function graduation(id) {
  let n = 0;
  for (const h of historyCache) { const c = h.checks?.[id]; if (!c || !c.m) continue; if (c.s >= 70) n++; else break; if (n >= 5) break; }
  return n;
}
function fixedMoves() {
  const res = [];
  for (const id of Object.keys(CHECKS)) {
    const seq = [...historyCache].reverse().filter((h) => h.checks?.[id]?.m);
    let run = 0, at = null;
    for (const h of seq) { if (h.checks[id].s >= 70) { run++; if (run === 5) at = h.at; } else { run = 0; at = null; } }
    if (run >= 5) res.push({ id, at });
  }
  return res;
}

/* ============================================================
   Progress: Road to 90, swing trend, fixed moves, history
   ============================================================ */
const to18 = (r) => r.holes === 9 ? r.score * 2 : r.score;
function differential(r) {
  let rating = r.rating || (r.holes === 9 ? 36 : 72);
  if (r.holes === 9 && rating > 50) rating /= 2;     // an 18-hole rating entered for a 9-hole round
  const slope = r.slope || 113;
  const d = (113 / slope) * (r.score - rating);
  return r.holes === 9 ? 2 * d : d;
}
/* WHS-style index: lowest N of the last 20 differentials (with the small-count adjustments), capped at 54. */
function handicapIndex(rounds) {
  const diffs = rounds.slice(0, 20).map(differential).filter(Number.isFinite).sort((a, b) => a - b);
  const n = diffs.length; if (n < 3) return null;
  const table = { 3: [1, -2], 4: [1, -1], 5: [1, 0], 6: [2, -1], 7: [2, 0], 8: [2, 0], 9: [3, 0], 10: [3, 0], 11: [3, 0], 12: [4, 0], 13: [4, 0], 14: [4, 0], 15: [5, 0], 16: [5, 0], 17: [6, 0], 18: [6, 0], 19: [7, 0] };
  const [k, adj] = table[n] || [8, 0];
  return Math.min(54, +(mean(diffs.slice(0, k)) + adj).toFixed(1));
}
function lineChart(points, { target = null, yMin, yMax, invert = false, fmt = (v) => v, label = "" } = {}) {
  const W = 720, H = 230, L = 38, R = 18, T = 16, B = 30, n = points.length;
  const x = (i) => n === 1 ? (L + W - R) / 2 : L + (W - L - R) * i / (n - 1);
  const y = (v) => { const f = (v - yMin) / (yMax - yMin); return T + (H - T - B) * (invert ? f : 1 - f); };
  const ticks = 4; let g = "";
  for (let k = 0; k <= ticks; k++) { const v = yMin + (yMax - yMin) * k / ticks; g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${L - 8}" y="${y(v) + 4}" text-anchor="end">${Math.round(v)}</text>`; }
  if (target != null) g += `<line x1="${L}" x2="${W - R}" y1="${y(target)}" y2="${y(target)}" stroke="var(--flag)" stroke-width="2" stroke-dasharray="6 5"/><text x="${W - R}" y="${y(target) - 6}" text-anchor="end" style="fill:var(--flag);font-weight:500">${esc(label)}</text>`;
  const pts = points.map((p, i) => `${x(i)},${y(p.v)}`).join(" ");
  const line = n > 1 ? `<polyline points="${pts}" fill="none" stroke="var(--accent)" stroke-width="2.5"/>` : "";
  const dots = points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p.v)}" r="${i === n - 1 ? 6 : 3.5}" fill="${i === n - 1 ? "var(--flag)" : "var(--accent)"}"><title>${esc(p.title || fmt(p.v))}</title></circle>`).join("");
  const labels = points.map((p, i) => (n <= 8 || i % Math.ceil(n / 8) === 0 || i === n - 1) ? `<text x="${x(i)}" y="${H - 8}" text-anchor="middle">${esc(p.label)}</text>` : "").join("");
  const last = points[n - 1];
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}${line}${dots}<text x="${x(n - 1)}" y="${y(last.v) - 12}" text-anchor="middle" style="fill:var(--ink);font-weight:500">${esc(fmt(last.v))}</text>${labels}</svg>`;
}
function sessions(list) {
  const map = new Map();
  for (const s of [...list].reverse()) { if (!map.has(s.session)) map.set(s.session, { id: s.session, at: s.at, swings: [] }); map.get(s.session).swings.push(s); }
  return [...map.values()].map((g) => {
    const sc = g.swings.map((s) => s.score).filter(Number.isFinite);
    const med = median(sc), sd = sc.length > 1 ? Math.sqrt(mean(sc.map((v) => (v - mean(sc)) ** 2))) : 0;
    return { ...g, median: Math.round(med), score: Math.max(0, Math.round(med - 0.5 * sd)), best: Math.max(...sc) };
  }).filter((g) => Number.isFinite(g.median));
}
async function renderProgress() {
  await loadHistory();
  const p = currentPlayer();
  const mine = canEditPlayer(currentPid);
  $("#goalTitle").textContent = (p?.id === Store.me ? "Your" : (p?.name || "Golfer") + "’s") + " road to 90";
  $("#storeNote").textContent = Store.mode === "db" ? "Synced to this lab" : "Saved in this browser only";
  $("#roundFormWrap").hidden = !mine;
  $("#rDate").value ||= new Date().toISOString().slice(0, 10);
  // rounds
  const rounds = roundsCache;
  if (rounds.length) {
    const r18 = rounds.map(to18), hcp = handicapIndex(rounds);
    const last5 = Math.round(mean(r18.slice(0, 5)));
    $("#roundStats").innerHTML = `
      <div class="stat"><span class="label">Best round</span><b>${Math.min(...r18)}</b><small>18-hole score</small></div>
      <div class="stat"><span class="label">Last 5 average</span><b>${last5}</b><small>${last5 < 90 ? "under 90" : (last5 - 89) + " to go"}</small></div>
      <div class="stat"><span class="label">Handicap estimate</span><b>${hcp ?? "–"}</b><small>${hcp == null ? "after 3 rounds" : "rough WHS-style"}</small></div>
      <div class="stat"><span class="label">Rounds</span><b>${rounds.length}</b><small>logged</small></div>`;
    const pts = [...rounds].reverse().map((r) => ({ v: to18(r), label: fmtDate(r.at), title: `${r.course}: ${r.score}${r.holes === 9 ? " (9 holes, doubled)" : ""}` }));
    const vals = pts.map((x) => x.v);
    $("#roundChart").innerHTML = lineChart(pts, { target: 90, yMin: Math.min(80, ...vals) - 4, yMax: Math.max(110, ...vals) + 4, invert: true, label: "Break 90" }) +
      `<div class="history" style="margin-top:8px">${rounds.slice(0, 8).map((r) => `<div class="hist" style="grid-template-columns:minmax(0,1fr) auto auto"><span><b>${esc(r.score)}</b> <span class="muted">· ${esc(r.course)} · ${esc(r.holes)} holes · ${fmtDate(r.at)}</span></span><span class="num muted">${r.holes === 9 ? "≈ " + esc(to18(r)) : ""}</span>${mine ? `<button class="btn small" data-rdel="${esc(r.id)}">Delete</button>` : "<span></span>"}</div>`).join("")}</div>`;
    $$("[data-rdel]").forEach((b) => b.onclick = async () => { if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Tap to confirm"; return; } await Store.deleteRound(currentPid, b.dataset.rdel); await updateStats(currentPid); renderProgress(); });
  } else {
    $("#roundStats").innerHTML = "";
    $("#roundChart").innerHTML = `<div class="empty"><h3>Log your first round</h3><p class="muted">Every round you play goes on this chart against the 90 line, with a rough handicap once you have three.</p></div>`;
  }
  // swings
  const list = historyCache;
  if (!list.length) {
    $("#stats").innerHTML = ""; $("#levelNow").textContent = "";
    $("#chart").innerHTML = `<div class="empty"><h3>No swings yet</h3><p class="muted">Analyze your first clip and your score lands here.</p><button class="btn primary" data-goto="swing">Analyze a swing</button></div>`;
    $("#trendTable").innerHTML = `<p class="muted">Your first and latest numbers for each check will sit side by side here.</p>`;
    $("#history").innerHTML = `<p class="muted">Saved swings with key frames appear here.</p>`;
    $("#fixedShelf").innerHTML = `<p class="muted">Moves you have fixed (five good swings in a row) collect here.</p>`;
    $$("[data-goto]").forEach((b) => b.onclick = () => switchTab(b.dataset.goto));
    return;
  }
  const fullList = list.filter((s) => !s.partial && Number.isFinite(s.score));
  const ss = sessions(fullList.length ? fullList : list);
  const scores = (fullList.length ? fullList : list).map((s) => s.score).filter(Number.isFinite);
  if (!ss.length || !scores.length) { $("#stats").innerHTML = ""; $("#levelNow").textContent = ""; $("#chart").innerHTML = `<p class="muted">No scored swings yet. Swings where too little could be measured are listed below without a score.</p>`; }
  else {
  const form = Math.round(mean(scores.slice(0, 10)));
  $("#levelNow").textContent = scores.length >= 3 ? `Level: ${levelOf(form).name}` : `Level after ${3 - scores.length} more swing${3 - scores.length > 1 ? "s" : ""}`;
  $("#stats").innerHTML = `
    <div class="stat"><span class="label">Form</span><b>${form}</b><small>last 10 swings</small></div>
    <div class="stat"><span class="label">Best swing</span><b>${Math.max(...scores)}</b><small>single swing</small></div>
    <div class="stat"><span class="label">Since first session</span><b style="color:${ss.at(-1).score >= ss[0].score ? "var(--good)" : "var(--work)"}">${ss.at(-1).score >= ss[0].score ? "+" : "−"}${Math.abs(ss.at(-1).score - ss[0].score)}</b><small>session score</small></div>
    <div class="stat"><span class="label">Swings</span><b>${list.length}</b><small>${ss.length} sessions</small></div>`;
  $("#chart").innerHTML = lineChart(ss.map((g) => ({ v: g.score, label: fmtDate(g.at), title: `${fmtDate(g.at)}: session ${g.score}, best ${g.best}, ${g.swings.length} swings` })), { yMin: 0, yMax: 100, target: 55, label: "Breaking 90 level" }) +
    `<p class="note">Session score = your typical swing that day, minus a bit for inconsistency. Repeatable beats one lucky swing.</p>`;
  }
  // fixed shelf
  const fixed = fixedMoves();
  $("#fixedShelf").innerHTML = fixed.length ? `<div class="chips">${fixed.map((f) => `<span class="chip"><span class="mark good" style="width:22px;height:22px">✓</span>${esc(CHECKS[f.id].name)} <span class="muted">${f.at ? fmtDate(f.at) : ""}</span></span>`).join("")}</div>` : `<p class="muted">None yet. Five good swings in a row on a check moves it here.</p>`;
  // trends
  const ids = Object.keys(CHECKS).filter((id) => list.some((s) => s.checks?.[id]?.m));
  const firstOf = (id) => ss.find((g) => g.swings.some((s) => s.checks?.[id]?.m));
  const lastOf = (id) => [...ss].reverse().find((g) => g.swings.some((s) => s.checks?.[id]?.m));
  const avg = (g, id, k) => mean(g.swings.filter((s) => s.checks?.[id]?.m).map((s) => s.checks[id][k]));
  $("#trendTable").innerHTML = `<table><thead><tr><th>Check</th><th class="n">First</th><th class="n">Latest</th><th>Now</th></tr></thead><tbody>${ids.map((id) => {
    const f = firstOf(id), l = lastOf(id), fs = avg(f, id, "s"), ls = avg(l, id, "s");
    const arrow = f === l ? "" : ls > fs + 4 ? " ↑" : ls < fs - 4 ? " ↓" : " →";
    return `<tr><td>${esc(CHECKS[id].short)}</td><td class="n">${esc(fmtCheck(id, avg(f, id, "v"), {}))}</td><td class="n">${esc(fmtCheck(id, avg(l, id, "v"), {}))}</td><td><span class="mark ${statusOf(ls)}" style="display:inline-grid;width:26px;height:26px">${Math.round(ls)}</span>${arrow}</td></tr>`;
  }).join("")}</tbody></table>`;
  $("#history").innerHTML = list.slice(0, 60).map((s) => `
    <div class="hist"><img alt="" src="${safeImg(s.thumbs?.top)}">
      <div><b>${esc(s.score ?? "–")}</b> <span class="muted">· ${esc(s.club || "")} · ${s.view === "face" ? "Face-on" : "Down the line"}${s.tags?.length ? " · " + esc(s.tags.join(", ")) : ""}${s.lesson ? " · lesson" : ""}${s.partial ? " · partial" : ""}</span><br>
      <span class="note">${new Date(s.at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}${s.fix ? " · working on " + esc(CHECKS[s.fix]?.short || "") : ""}</span></div>
      ${mine ? `<button class="btn small" data-del="${esc(s.id)}">Delete</button>` : "<span></span>"}</div>`).join("");
  $$("#history [data-del]").forEach((b) => b.onclick = async () => {
    if (b.dataset.armed !== "1") { b.dataset.armed = "1"; b.textContent = "Tap to confirm"; return; }
    await Store.deleteSwing(currentPid, b.dataset.del); await updateStats(currentPid); renderProgress();
  });
}
$("#roundForm").onsubmit = async (e) => {
  e.preventDefault();
  const r = {
    at: new Date($("#rDate").value + "T12:00:00").getTime() || Date.now(), course: $("#rCourse").value.trim(), holes: +$("#rHoles").value,
    score: +$("#rScore").value, rating: +$("#rRating").value || null, slope: +$("#rSlope").value || null,
  };
  if (!r.course || !(r.score > 0)) return;
  await Store.addRound(currentPid, r); await updateStats(currentPid);
  $("#rScore").value = ""; $("#roundFormWrap").open = false;
  toast(r.holes === 18 && r.score < 90 ? "Under 90. Massive." : "Round saved");
  renderProgress();
};

/* ============================================================
   Crew
   ============================================================ */
async function renderCrew() {
  players = await Store.players();
  const ranked = [...players].sort((a, b) => (b.stats?.form ?? -1) - (a.stats?.form ?? -1) || (b.stats?.best ?? -1) - (a.stats?.best ?? -1));
  $("#board").innerHTML = `<div class="rank head"><span>#</span><span>Golfer</span><span class="c">Form</span><span class="c">Best</span><span class="c hide-s">Round</span></div>` +
    ranked.map((p, i) => `<div class="rank"><span class="pos">${p.stats?.form != null ? i + 1 : "–"}</span>
      <span class="who">${esc(p.name)}${p.id === Store.me ? '<span class="you">you</span>' : ""}<small>${p.stats?.form != null ? levelOf(p.stats.form).name + " · " : ""}${p.stats?.lastAt ? "active " + fmtDate(p.stats.lastAt) : "no swings yet"}</small></span>
      <span class="c">${esc(p.stats?.form ?? "–")}</span><span class="c">${esc(p.stats?.best ?? "–")}</span><span class="c hide-s">${esc(p.stats?.bestRound ?? "–")}</span></div>`).join("");
  $("#meName").value = players.find((p) => p.id === Store.me)?.name || "";
  $("#addGuestPanel").hidden = !Store.owner;
  $("#crewNote").textContent = Store.mode === "db" ? "Share this lab with your crew (as Contributor or Editor) and they post their own swings here." : "Running locally: the board lives in this browser.";
}
$("#guestForm").onsubmit = async (e) => {
  e.preventDefault();
  const name = $("#guestName").value.trim(); if (!name) return;
  const id = "g-" + name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20) + "-" + Math.random().toString(36).slice(2, 6);
  await Store.savePlayer({ id, name, hand: $("#guestHand").value, heightCm: 178, kind: "guest", createdAt: Date.now(), stats: {} });
  $("#guestName").value = "";
  await refreshPlayers(); renderCrew(); toast(`${name} added. Pick them under Golfer to analyze their clip.`);
};
$("#meForm").onsubmit = async (e) => {
  e.preventDefault();
  const me = players.find((p) => p.id === Store.me); if (!me) return;
  me.name = $("#meName").value.trim() || me.name;
  await Store.savePlayer(me); await refreshPlayers(); renderCrew(); toast("Name saved");
};

/* ============================================================
   Coach: chat, practice plan, roadmap, lesson mode, notes
   ============================================================ */
let coachDoc = { notes: "", cues: [] };
const chatTurns = [];
async function renderCoach() {
  await loadHistory();
  coachDoc = await Store.coach(currentPid);
  const recent = historyCache.slice(0, 10);
  const loss = {};
  for (const s of recent) for (const [id, c] of Object.entries(s.checks || {})) if (c.m && CHECKS[id]) (loss[id] ||= []).push((100 - c.s) * CHECKS[id].prio * BUCKETS[CHECKS[id].bucket].weight * (CHECKS[id].conf === "low" ? 0.5 : 1));
  const meanScore = (id) => mean(recent.filter((s) => s.checks?.[id]?.m).map((s) => s.checks[id].s));
  const top = Object.entries(loss).map(([id, a]) => [id, mean(a)]).filter(([id, v]) => v > 200 && meanScore(id) < 80).sort((a, b) => b[1] - a[1]).slice(0, 3);
  $("#plan").innerHTML = top.length ? top.map(([id], i) => {
    const d = CHECKS[id]; const vals = recent.filter((s) => s.checks?.[id]?.m);
    const v = mean(vals.map((s) => s.checks[id].v)), sc = mean(vals.map((s) => s.checks[id].s));
    return `<article><span class="label">Priority ${i + 1} · now ${esc(fmtCheck(id, v, {}))} · ${graduation(id)}/5 good in a row</span><h3 style="font-size:17px">${esc(d.name)}</h3><p>${esc(adviceFor(id, { value: v, score: sc }, settings.club))}</p><p><b>Drill:</b> ${esc(d.drill)}</p></article>`;
  }).join("") : `<div class="empty"><h3>Plan builds itself</h3><p class="muted">Analyze a few swings and your three biggest gains show up here, each with a drill.</p></div>`;
  // roadmap
  const fixed = new Set(fixedMoves().map((f) => f.id));
  let current = -1;
  $("#roadmap").innerHTML = STAGES.map((st, i) => {
    const parts = st.checks.map((id) => {
      const vals = historyCache.filter((s) => s.checks?.[id]?.m).slice(0, 5);
      const state2 = fixed.has(id) ? "fixed" : !vals.length ? "unseen" : mean(vals.map((s) => s.checks[id].s)) >= 70 ? "good" : "work";
      return { id, state: state2 };
    });
    const done = parts.every((x) => x.state === "fixed" || x.state === "good") && parts.some((x) => x.state !== "unseen");
    if (!done && current < 0) current = i;
    const tag = done ? "Done" : current === i ? "You are here" : "Coming up";
    return `<article><span class="label" style="${current === i ? "color:var(--flag)" : ""}">Stage ${i + 1} · ${tag}</span><h3 style="font-size:17px">${esc(st.name)}</h3>
      <div class="chips">${parts.map((x) => `<span class="chip" style="font-weight:500"><span class="mark ${x.state === "fixed" || x.state === "good" ? "good" : x.state === "work" ? "work" : "na"}" style="width:20px;height:20px;font-size:10px">${x.state === "fixed" ? "✓" : x.state === "unseen" ? "?" : ""}</span>${esc(CHECKS[x.id].short)}</span>`).join("")}</div></article>`;
  }).join("") + `<p class="note">? = not measured yet. Some moves need a face-on clip, others a down-the-line clip.</p>`;
  renderCues();
  $("#notes").value = coachDoc.notes || "";
  $("#notesState").textContent = coachDoc.updatedAt ? "Saved " + fmtDate(coachDoc.updatedAt) : "";
  const editable = canEditPlayer(currentPid);
  $("#cueForm").hidden = !editable; $("#saveNotes").disabled = !editable;
  renderChat();
}
function renderCues() {
  const cues = coachDoc.cues || [];
  $("#cues").innerHTML = cues.length ? cues.map((c, i) => `<label class="cue ${c.done ? "done" : ""}"><input type="checkbox" data-i="${i}" ${c.done ? "checked" : ""}><span>${esc(c.text)}</span><button class="btn small" type="button" data-rm="${i}" aria-label="Remove cue">✕</button></label>`).join("")
    : `<p class="muted">No cues yet. Add the two or three things your coach repeated most.</p>`;
  $$("#cues input[data-i]").forEach((cb) => cb.onchange = () => { coachDoc.cues[+cb.dataset.i].done = cb.checked; persistCoach(); renderCues(); });
  $$("#cues [data-rm]").forEach((b) => b.onclick = (e) => { e.preventDefault(); coachDoc.cues.splice(+b.dataset.rm, 1); persistCoach(); renderCues(); });
}
let coachSaving = Promise.resolve();
function persistCoach() {
  coachDoc.updatedAt = Date.now();
  const snap = JSON.parse(JSON.stringify(coachDoc)), pid = currentPid;
  coachSaving = coachSaving.then(() => Store.saveCoach(pid, snap)).then(() => true, () => { toast("Could not save notes"); return false; });
  return coachSaving;
}
$("#cueForm").onsubmit = (e) => { e.preventDefault(); const t = $("#cueText").value.trim(); if (!t) return; (coachDoc.cues ||= []).push({ text: t, done: false, at: Date.now() }); $("#cueText").value = ""; persistCoach(); renderCues(); };
$("#saveNotes").onclick = async () => { coachDoc.notes = $("#notes").value; if (await persistCoach()) $("#notesState").textContent = "Saved just now"; };

function renderChat() {
  $("#chat").innerHTML = chatTurns.length ? chatTurns.map((t) => `<div class="msg ${t.role === "user" ? "me" : "ai"}">${esc(t.content)}</div>`).join("")
    : `<div class="msg ai">Ask me anything about your swing or your game. I can see your recent swings, rounds and lesson notes.</div>`;
}
$("#chatForm").onsubmit = async (e) => {
  e.preventDefault();
  const q = $("#chatText").value.trim(); if (!q) return;
  const sample = await window.claude?.use?.("sample").catch(() => null);
  chatTurns.push({ role: "user", content: q }); $("#chatText").value = ""; renderChat();
  if (!sample) { chatTurns.push({ role: "assistant", content: "Coach Claude works when Swing Lab is opened inside Claude." }); renderChat(); return; }
  const rules = `You are Coach Claude, a PGA-qualified coach for a beginner using Swing Lab. Be honest, practical and plain-spoken; short answers (under 150 words) unless asked for more. Use their data below; say when the data cannot answer something.\n\n${contextFacts()}\n\nLatest swing checks (newest swing): ${historyCache[0] ? Object.entries(historyCache[0].checks || {}).filter(([, c]) => c.m).map(([id, c]) => `${CHECKS[id]?.short}: ${fmtCheck(id, c.v, {})} (${c.s}/100)`).join("; ") : "none"}`;
  const turns = [{ role: "user", content: rules }, ...chatTurns.slice(-10)];
  const bubble = { role: "assistant", content: "Thinking…" }; chatTurns.push(bubble); renderChat();
  try {
    const { text } = await sample(turns, { cache: false, onText: ({ text }) => { bubble.content = text.replace(/\*\*/g, ""); renderChat(); } });
    bubble.content = text.replace(/\*\*/g, "");
  } catch (err) { bubble.content = err?.code === "not_granted" ? "I need your OK to answer. Ask again and allow it." : "I could not answer that one. Try again in a moment."; }
  renderChat();
};

/* Lesson mode: scan a long video, tick your swings, compare the start of the session with the end. */
$("#lessonFile").onchange = async () => {
  const file = $("#lessonFile").files[0]; $("#lessonFile").value = "";
  if (!file) return;
  const out = $("#lessonOut");
  try { await Engines.ready; } catch { return; }
  const opts = { view: $("#view").value, hand: $("#hand").value, slow: +$("#slowmo").value, club: settings.club, heightCm: heightFor(currentPlayer()), coarseStep: 0.3 };
  // Lesson mode uses the same video player, so clear any swing results on the Swing tab.
  state.result = null; video.pause(); $("#results").hidden = true; $("#intake").hidden = false;
  out.innerHTML = `<div class="working"><div class="meter"><i id="lessonBar"></i></div><p class="note" id="lessonNote">Scanning the lesson…</p></div>`;
  try {
    const res = await analyzeClip(file, opts, { progress: (pct, step, note) => { $("#lessonBar").style.width = pct + "%"; $("#lessonNote").textContent = note + ` · ${Math.round(pct)}%`; } });
    for (const s of res.swings) s.thumbs = await grabThumbs(s, res, 180);
    state.lesson = { res, opts };
    out.innerHTML = `<p><b>${res.swings.length} swings found.</b> Untick any that are not you (your coach demonstrating, for example).</p>
      <div class="lesson-grid">${res.swings.map((s, i) => `<label><input type="checkbox" data-li="${i}" checked><img src="${s.thumbs.top}" alt=""><span class="note">#${i + 1} · ${s.total.score ?? "–"} · ${Math.floor(s.times.address / 60)}:${String(Math.floor(s.times.address % 60)).padStart(2, "0")}</span></label>`).join("")}</div>
      <div class="row"><button class="btn primary" id="lessonSave">Save my swings and compare</button></div><div id="lessonSummary"></div>`;
    $("#lessonSave").onclick = async () => {
      const keep = $$("[data-li]").filter((c) => c.checked).map((c) => res.swings[+c.dataset.li]);
      if (!keep.length) return;
      if (await saveSession(keep, opts, { lesson: true })) $("#lessonSave").disabled = true;
      $("#lessonSummary").innerHTML = lessonSummary(keep);
    };
  } catch (e) { out.innerHTML = `<div class="err">${esc(e.message || String(e))}</div>`; }
};
function lessonSummary(sw) {
  if (sw.length < 4) return `<p class="note">Save at least 4 swings to compare the start of the lesson with the end.</p>`;
  const k = Math.max(2, Math.floor(sw.length / 3));
  const early = sw.slice(0, k), late = sw.slice(-k);
  const avgScore = (a) => Math.round(mean(a.map((s) => s.total.score)));
  const deltas = Object.keys(CHECKS).map((id) => {
    const e = early.filter((s) => s.checks[id]?.measured), l = late.filter((s) => s.checks[id]?.measured);
    if (!e.length || !l.length) return null;
    return { id, d: mean(l.map((s) => s.checks[id].score)) - mean(e.map((s) => s.checks[id].score)) };
  }).filter(Boolean).sort((a, b) => b.d - a.d);
  const up = deltas.filter((x) => x.d >= 8).slice(0, 3), down = deltas.filter((x) => x.d <= -8).slice(-2);
  return `<div class="stats" style="margin-top:12px"><div class="stat"><span class="label">First ${k} swings</span><b>${avgScore(early)}</b></div><div class="stat"><span class="label">Last ${k} swings</span><b>${avgScore(late)}</b></div></div>
    ${up.length ? `<p><b>Got better:</b> ${up.map((x) => esc(CHECKS[x.id].short) + " (+" + Math.round(x.d) + ")").join(", ")}</p>` : ""}
    ${down.length ? `<p><b>Slipped:</b> ${down.map((x) => esc(CHECKS[x.id].short) + " (" + Math.round(x.d) + ")").join(", ")}</p>` : ""}`;
}

/* ============================================================
   Tabs + boot
   ============================================================ */
let activeTab = "swing";
function switchTab(name) {
  activeTab = name;
  $$("[data-tab]").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  for (const v of ["swing", "progress", "crew", "coach"]) $("#v-" + v).hidden = v !== name;
  if (name !== "swing") video.pause();
  window.scrollTo({ top: 0 });
  renderActiveTab();
}
async function renderActiveTab() {
  await Store.ready;
  if (activeTab === "progress") renderProgress();
  if (activeTab === "crew") renderCrew();
  if (activeTab === "coach") renderCoach();
}
$$("[data-tab]").forEach((t) => t.onclick = () => switchTab(t.dataset.tab));
renderClubChips();
summariseSettings();

function exportAnalysis() {
  return state.result.swings.map((s) => ({
    score: s.total.score, partial: s.total.partial, capped: s.total.capped, buckets: s.total.buckets, view: s.view, viewRatio: +s.viewInfo.ratio.toFixed(2),
    times: Object.fromEntries(Object.entries(s.times).map(([k, v]) => [k, +v.toFixed(3)])), topPeakT: s.ev.topPeakT, tempo: s.ev.tempo, hold: s.ev.hold, downFrames: s.ev.downFrames, audioImpact: !!s.ev.audioImpact,
    quality: { level: s.quality.level, issues: s.quality.issues.map((x) => x.key) }, fps: s.fps, stride: s.stride, pxPerCm: +s.pxPerCm.toFixed(3), notes: s.notes,
    checks: Object.fromEntries(Object.entries(s.checks).map(([id, c]) => [id, { value: c.value, score: c.score, measured: c.measured, vis: c.vis, display: fmtCheck(id, c.value, c) }])),
    fix: pickFix(s.checks, s.view)?.id || null, strength: pickStrength(s.checks, s.view)?.id || null,
  }));
}
window.__swingLab = { analyze, state, engines: Engines, exportAnalysis, last: null };
Store.ready = Store.init().then(refreshPlayers).then(loadHistory).catch((e) => console.warn(e));
if (["progress", "crew", "coach"].includes(location.hash.slice(1))) switchTab(location.hash.slice(1));
