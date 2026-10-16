/* ============================================================
   Swing checks and honest scoring.
   Reference ranges come from published coaching and biomechanics data (Sportsbox AI tour averages,
   TPI swing characteristics, GolfTEC SwingTRU, Tour Tempo, Byrne & Kenny 2008, Grober & Cholewicki).
   Values marked "est." in comments are informed estimates and are the first things to tune.
   Scores use anchor points: tour centre = 100, tour edge = 90, good-amateur edge = 70,
   typical beginner = 30, twice the beginner's distance from the tour centre = 0.
   ============================================================ */

const CM_PER_IN = 2.54;

/* Plain names, what it means for anyone, what it does to the ball, and the drill.
   view: "face" | "dtl" | "both". bucket: one of BUCKETS. prio: beginner priority 1-10 (weight inside its bucket).
   conf: measurement confidence; "low" checks are capped at 85 and given half weight. */
const CHECKS = {
  weightShift: {
    name: "Weight onto your front foot", short: "Weight shift", view: "face", bucket: "contact", prio: 10, conf: "med", unit: "cm", event: "impact",
    anchors: { centre: 12.7, tour: [10, 15], amateur: [5, 23], beginner: 0, beginnerHi: 30 },
    good: "Your hips moved forward onto your front foot by the hit. That is where solid contact comes from.",
    lo: "You are hanging back on your back foot at the hit, so the club bottoms out behind the ball.",
    hi: "Your hips slide too far toward the target. Turn through rather than bump.",
    ball: "Hanging back gives fat shots, thin shots and weak slices.",
    drill: "Step-through drill: hit easy half swings and let your back foot walk past your front foot toward the target after the hit.",
    explain: "How far the middle of your hips moved toward the target between setup and the hit.",
  },
  posture: {
    name: "Staying in your posture", short: "Posture", view: "dtl", bucket: "contact", prio: 10, conf: "med", unit: "°", event: "impact",
    anchors: { centre: 3, tour: [-1, 7], amateur: [-7, 10], beginner: 16, beginnerLo: -12 },   // 2D trunk line: shoulders opening at impact read as ~2-3° of "loss"
    good: "You stayed bent over through the hit, so the club came back to the ball.",
    hi: "You stand up through the hit (early extension), so the club rises off the ball.",
    lo: "You dip down toward the ball through the hit.",
    ball: "Standing up gives tops, thin shots, shanks and blocks. Dipping gives fat shots.",
    drill: "Chair drill: set up with your backside just touching a chair. Keep it touching all the way to the hit.",
    explain: "How much forward bend you lost between setup and the hit. The worse of this and hips-toward-ball is used.",
  },
  headHeight: {
    name: "Head at the same height", short: "Head height", view: "both", bucket: "contact", prio: 9, conf: "med", unit: "cm", event: "impact",
    anchors: { centre: -4, tour: [-9, 1], amateur: [-12, 4], beginner: 7.6, beginnerLo: -17 },   // tour heads drop a few cm by impact
    good: "Your head stayed level or dipped slightly, like the pros, so you stayed the same distance from the ball.",
    hi: "Your head rises by the hit. You are standing up or lifting to watch the ball.",
    lo: "Your head drops toward the ball through the hit.",
    ball: "Rising gives tops and thin shots. Dropping gives fat shots.",
    drill: "Towel drill: lay a towel 15 cm behind the ball and hit half shots without touching it, chest staying over the ball.",
    explain: "How far your head moved up (+) or down (−) between setup and the hit.",
  },
  stayBehind: {
    name: "Chest behind the ball at the hit", short: "Staying behind", view: "face", bucket: "direction", prio: 7, conf: "med", unit: "cm", event: "impact",
    anchors: { centre: 15, tour: [12.7, 17.8], amateur: [7.6, 22], beginner: 2.5, beginnerHi: 30 },
    good: "Your hips led and your chest stayed behind them at the hit, like the pros.",
    lo: "Your upper body races ahead of your hips into the hit.",
    hi: "You are leaning back a lot at the hit.",
    ball: "An upper body that gets ahead causes steep swings, pull-slices and big divots.",
    drill: "Hips forward, chest back: rehearse slow swings to the hit with your back shoulder lower than your front, head behind the ball.",
    explain: "How far your shoulders sit behind your hips, toward the back foot, at the hit.",
  },
  headImpact: {
    name: "Head not lunging forward", short: "Head at impact", view: "face", bucket: "direction", prio: 7, conf: "med", unit: "cm", event: "impact",
    anchors: { centre: -3, tour: [-7.6, 0], amateur: [-9, 2.5], beginner: 7.6 },
    good: "Your head stayed at or behind where it started. That keeps your swing from getting steep.",
    hi: "Your head lunges toward the target before the hit.",
    lo: "Your head hangs a long way back at the hit.",
    ball: "Lunging forward goes with pulls, slices and topped drives.",
    drill: "Film face-on, picture a line up from the ball, and keep your head behind it until after contact.",
    explain: "Where your head is at the hit compared with setup. Minus means behind where it started.",
  },
  overTop: {
    name: "Swinging down on the right track", short: "Over the top", view: "dtl", bucket: "direction", prio: 8, conf: "low", unit: "cm", event: "halfDown",
    anchors: { centre: -2.5, tour: [-7.6, 2.5], amateur: [-10, 3.8], beginner: 10 },
    good: "Your hands came down on or inside the path they went back on.",
    hi: "Your hands come down outside the path they went back on (over the top).",
    lo: "Your hands drop well inside on the way down.",
    ball: "Over the top is the classic slice and pull. It is the costliest fault off the tee.",
    drill: "Headcover gate: put a headcover just beyond the ball and slightly behind it, and swing without hitting it.",
    explain: "Body-only estimate: where your hands pass hip height coming down compared with going back. Plus means outside.",
  },
  hipSway: {
    name: "Turning, not sliding, going back", short: "Hip sway", view: "face", bucket: "backswing", prio: 7, conf: "med", unit: "cm", event: "top",
    anchors: { centre: 0, tour: [-2.5, 2.5], amateur: [-4, 5], beginner: 8.9, beginnerLo: -10 },
    good: "Your hips turned in place going back instead of sliding.",
    hi: "Your hips slide away from the target going back instead of turning.",
    lo: "Your hips drift toward the target going back (a reverse pivot).",
    ball: "Sliding moves the bottom of your swing, giving fat and thin shots.",
    drill: "Put your bag or a stick against the outside of your back hip and turn back without pushing it.",
    explain: "How far the middle of your hips slid away from the target by the top.",
  },
  headSway: {
    name: "Head roughly centred going back", short: "Head sway", view: "face", bucket: "backswing", prio: 5, conf: "med", unit: "cm", event: "top",
    anchors: { centre: 5, tour: [2.5, 7.6], amateur: [0, 9], beginner: 12.7, beginnerLo: -6 },
    good: "Your head stayed near the middle, moving only a little behind the ball. That is normal.",
    hi: "Your head drifts a long way back as you swing back.",
    lo: "Your head moves toward the target as you swing back.",
    ball: "A big head drift makes the low point of your swing a guess: fat one shot, thin the next.",
    drill: "Swing back with your back ear next to a door frame or stick and do not let your head move more than a ball’s width.",
    explain: "How far your head moved away from the target by the top. A few centimetres is normal.",
  },
  spineTop: {
    name: "Leaning away from the target at the top", short: "Spine at top", view: "face", bucket: "backswing", prio: 5, conf: "med", unit: "°", event: "top",
    anchors: { centre: 10, tour: [5, 15], amateur: [0, 18], beginner: -5 },
    good: "Your upper body tilts slightly away from the target at the top. Good.",
    lo: "Your upper body leans toward the target at the top (reverse spine).",
    hi: "You lean back a long way at the top.",
    ball: "Reverse spine gives fat and thin shots, slices and low-back strain.",
    drill: "Make backswings in a mirror with a club across your shoulders. Keep your head behind your belt buckle at the top.",
    explain: "The tilt of your trunk at the top. Plus means leaning away from the target.",
  },
  spineAddress: {
    name: "Bending over the right amount", short: "Setup posture", view: "dtl", bucket: "setup", prio: 6, conf: "med", unit: "°", event: "address",
    anchors: null,  // depends on the club, see spineAnchors()
    good: "Athletic setup with a good bend from the hips.",
    lo: "You stand too upright at setup. Bend from your hips so your arms can hang.",
    hi: "You are hunched over a lot at setup.",
    ball: "Too upright gives tops and thin shots. Too bent gives fat shots and heel strikes.",
    drill: "Hold a club along your spine, push your hips back until your chest is over the balls of your feet, soften your knees, let your arms hang.",
    explain: "The forward bend of your trunk at setup, from hips to shoulders.",
  },
  kneeFlex: {
    name: "Soft knees at setup", short: "Knee flex", view: "dtl", bucket: "setup", prio: 3, conf: "high", unit: "°", event: "address",
    anchors: { centre: 20, tour: [13, 28], amateur: [9, 34], beginner: 4, beginnerHi: 45 },   // literature: 18 ± 12° lead, 17 ± 9° trail
    good: "Nicely flexed, athletic knees.",
    lo: "Your knees are nearly locked at setup.",
    hi: "You are squatting at setup.",
    ball: "Locked knees invite standing up and tops. Squatting gives a flat turn and fat shots.",
    drill: "Unlock your knees so they sit over your shoelaces, weight in the middle of your feet.",
    explain: "How bent your back knee is at setup (0° is straight).",
  },
  stance: {
    name: "Feet the right width apart", short: "Stance width", view: "face", bucket: "setup", prio: 2, conf: "med", unit: "×", event: "address",
    anchors: null,  // depends on the club, see stanceAnchors()
    good: "Your stance width suits this club.",
    lo: "Your feet are too close together for this club.",
    hi: "Your feet are too wide for this club.",
    ball: "Too narrow costs balance. Too wide restricts your turn.",
    drill: "For a 7 iron, put the outsides of your feet under the outsides of your shoulders. Go a little wider for driver, narrower for wedges.",
    explain: "Distance between your ankles compared with your shoulder width.",
  },
  tempo: {
    name: "Rhythm", short: "Rhythm", view: "both", bucket: "rhythm", prio: 6, conf: "high", unit: ":1", event: "top",
    anchors: { centre: 3, tour: [2.7, 3.3], amateur: [2.5, 3.5], beginner: 1.9, beginnerHi: 4.5 },
    good: "Smooth going back, about three times quicker coming down. That is the pro rhythm.",
    lo: "You rush from the top. The downswing starts before the backswing has finished.",
    hi: "Your downswing is slow next to your backswing. Commit through the ball.",
    ball: "A rushed transition goes with over-the-top swings and thin shots.",
    drill: "Count “one-two-three” going back and “four” at the hit. Start with half swings at the same count.",
    explain: "Backswing time divided by downswing time.",
  },
  finishPos: {
    name: "Finishing on your front foot", short: "Finish", view: "face", bucket: "finish", prio: 6, conf: "high", unit: "", event: "finish",
    anchors: { centre: 0.98, tour: [0.9, 1.05], amateur: [0.8, 1.15], beginner: 0.6 },
    good: "You finished stacked on your front foot.",
    lo: "You finish with weight left on your back foot.",
    hi: "You are falling toward the target at the finish.",
    ball: "A back-foot finish usually means you hung back at the hit: fat, thin and weak slices.",
    drill: "Hold every finish for a count of three: weight on the front foot, back heel up, belt buckle facing the target.",
    explain: "Where your hips end up between your feet. 1.0 means right over your front foot.",
  },
  finishHold: {
    name: "Holding your finish", short: "Balance", view: "both", bucket: "finish", prio: 4, conf: "high", unit: "s", event: "finish",
    anchors: { centre: 3, tour: [2.5, 99], amateur: [1.6, 99], beginner: 0.7, atLeast: true },
    good: "Balanced finish you could hold. That shows control.",
    lo: "You come out of your finish straight away, usually a sign you were off balance.",
    ball: "Poor balance means inconsistent contact.",
    drill: "Hold every finish until the ball lands. If you cannot, swing at 70% until you can.",
    explain: "How long you held a still, balanced finish.",
  },
};

const BUCKETS = {
  contact: { name: "Contact", weight: 35 },
  direction: { name: "Direction", weight: 20 },
  backswing: { name: "Backswing", weight: 15 },
  setup: { name: "Setup", weight: 10 },
  rhythm: { name: "Rhythm", weight: 10 },
  finish: { name: "Finish", weight: 5 },
};

const LEVELS = [
  { name: "Beginner", min: 0, line: "Several big movement faults on most swings. Almost every new golfer starts here; it is an honest starting point." },
  { name: "Developing", min: 40, line: "The basics are showing, but at least one big contact or slice fault is still there. Typical scores 95–108." },
  { name: "Breaking 90", min: 55, line: "No red flags and contact moves are near good-amateur ranges. Around a 15–24 handicap. Only about a quarter of golfers get here." },
  { name: "Club golfer", min: 65, line: "Most moves in the good-amateur range and fairly repeatable. Around an 8–15 handicap." },
  { name: "Single figures", min: 75, line: "Moves between good amateur and tour, swing after swing. Handicap 0–9." },
  { name: "Tour", min: 87, line: "Tour reference ranges on everything measured, over at least 10 swings." },
];
const levelOf = (score) => [...LEVELS].reverse().find((l) => score >= l.min) || LEVELS[0];
const LADDER = LEVELS.slice(0, 4);   // what one camera angle can show; Single figures and Tour need more than one clip

function stanceAnchors(club) {
  const c = clubKind(club);
  const centre = c === "driver" ? 1.38 : c === "wedge" ? 1.06 : 1.22;   // ankle gap / shoulder-joint width (joint centres sit inside the shoulders)
  return { centre, tour: [centre - 0.1, centre + 0.1], amateur: [centre - 0.2, centre + 0.2], beginner: centre - 0.4, beginnerHi: centre + 0.4 };
}
/* GolfTEC tour forward bend: about 30-40° with irons, 29-35° with the driver. */
function spineAnchors(club) {
  return clubKind(club) === "driver"
    ? { centre: 33, tour: [28, 38], amateur: [25, 44], beginner: 20, beginnerHi: 52 }
    : { centre: 37.5, tour: [30, 45], amateur: [27, 48], beginner: 22, beginnerHi: 55 };
}
function anchorsFor(id, club) { return id === "stance" ? stanceAnchors(club) : id === "spineAddress" ? spineAnchors(club) : CHECKS[id].anchors; }
function clubKind(club) {
  const s = String(club || "").toLowerCase();
  if (s.includes("driver") || s.includes("wood") || s.includes("hybrid")) return "driver";
  if (s.includes("wedge")) return "wedge";
  return "iron";
}

/* Piecewise-linear score through the anchor points. One-sided checks use the beginner side only;
   two-sided checks give beginnerLo / beginnerHi for the other direction. */
function anchorScore(v, a) {
  if (!Number.isFinite(v) || !a) return NaN;
  const c = a.centre;
  const below = v < c;
  const tourEdge = below ? a.tour[0] : a.tour[1];
  const amEdge = below ? a.amateur[0] : a.amateur[1];
  let beg = below ? (a.beginner < c ? a.beginner : a.beginnerLo) : (a.beginner > c ? a.beginner : a.beginnerHi);
  if (!Number.isFinite(beg)) beg = c + 3 * (amEdge - c);          // side with no beginner data: decay past the amateur edge
  const zero = c + 2 * (beg - c);
  const pts = [[c, 100], [tourEdge, 90], [amEdge, 70], [beg, 30], [zero, 0]];
  const d = Math.abs(v - c);
  for (let i = 1; i < pts.length; i++) {
    const d0 = Math.abs(pts[i - 1][0] - c), d1 = Math.abs(pts[i][0] - c);
    if (d <= d1) return Math.round(pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * (d1 > d0 ? (d - d0) / (d1 - d0) : 1));
  }
  return 0;
}
const statusOf = (s) => !Number.isFinite(s) ? "na" : s >= 70 ? "good" : s >= 40 ? "ok" : "work";

/* ---------- measuring ---------- */
function headCentre(kp) {
  if (kp.lear.v >= 0.5 && kp.rear.v >= 0.5) return mid(kp.lear, kp.rear);
  if (kp.lear.v >= 0.5) return { ...kp.lear };
  if (kp.rear.v >= 0.5) return { ...kp.rear };
  return { ...kp.nose };
}
/* Head reference chosen once for both poses being compared, so a visibility flicker on one ear cannot
   move the "head" by half the ear spacing between poses. */
function headKeys(...poses) {
  const ok = (k) => poses.every((p) => p[k].v >= 0.5);
  return ok("lear") && ok("rear") ? ["lear", "rear"] : ok("lear") ? ["lear"] : ok("rear") ? ["rear"] : ["lear", "rear"];
}
const headAt = (kp, keys) => ({ x: mean(keys.map((k) => kp[k].x)), y: mean(keys.map((k) => kp[k].y)) });
/* Fraction of frames within ±50 ms of an event where every needed joint is visible enough. */
function visibleAround(series, i, keys, minV, slow) {
  const t0 = series[i].t;
  const win = series.filter((f) => Math.abs(f.t - t0) <= 0.05 * slow);
  if (!win.length) return 0;
  return win.filter((f) => keys.every((k) => (f.kp[k]?.v ?? 0) >= (["lhip", "rhip"].includes(k) ? Math.min(minV, 0.3) : minV))).length / win.length;
}

function computeChecks(series, ev, opts, viewInfo) {
  const { idx } = ev;
  const slow = opts.slow;
  const P = {
    address: avgPose(series, idx.address, 3), top: avgPose(series, idx.top, 1), halfDown: avgPose(series, idx.halfDown, 0),
    impact: avgPose(series, idx.impact, 1), finish: avgPose(series, idx.finish, 2),
  };
  const A = P.address, T = P.top, I = P.impact, F = P.finish;
  const lead = opts.hand === "L" ? "r" : "l", trail = lead === "l" ? "r" : "l";
  const L = (k) => lead + k, R = (k) => trail + k;
  const view = viewInfo.view;
  const out = {};
  const notes = [];

  // Scale: shin length (knee to ankle) is close to vertical and in the image plane in both views.
  const heightCm = opts.heightCm || 178;
  const shank = median(series.slice(Math.max(0, idx.address - 6), idx.address + 1).flatMap((f) => [dist(f.kp.lkne, f.kp.lank), dist(f.kp.rkne, f.kp.rank)]));
  const torsoPx = dist(mid(A.lsho, A.rsho), mid(A.lhip, A.rhip));
  let pxPerCm = shank / (0.246 * heightCm);
  if (!(pxPerCm > 0) || (view === "dtl" && Math.abs(pxPerCm - torsoPx / (0.29 * heightCm)) / pxPerCm > 0.35)) pxPerCm = torsoPx / (0.29 * heightCm);
  const cm = (px) => px / pxPerCm;

  const put = (id, value, vis, extra = {}) => {
    const d = CHECKS[id];
    if (!Number.isFinite(value)) return;
    const anchors = anchorsFor(id, opts.club);
    const measured = vis >= 0.8;
    let score = anchorScore(value, anchors);
    if (d.conf === "low") score = Math.min(85, score);
    out[id] = { value: +value.toFixed(2), score, measured, vis: +vis.toFixed(2), ...extra };
  };
  const vis = (i, keys, minV = 0.5) => visibleAround(series, i, keys, minV, slow);

  // Rhythm
  const t = ev.tempo;
  if (t.ok && ev.downFrames >= 3) {
    const plausible = t.back >= 0.45 && t.back <= 1.8 && t.down >= 0.16 && t.down <= 0.65;
    if (!plausible) notes.push("Swing timing looks off for real time (backswing " + t.back.toFixed(2) + " s, downswing " + t.down.toFixed(2) + " s). If this is slo-mo, set “Recorded at”.");
    if (opts.slowGuessed) notes.push(`This looks like slo-mo (about ×${opts.slow}). Rhythm is shown as a ratio only, and phone slo-mo that speeds up and slows down can still skew it.`);
    // Guessed slo-mo: phone slo-mo often ramps speed, so the ratio is shown but not scored.
    put("tempo", t.back / t.down, opts.slowGuessed ? 0 : ev.downFrames >= 6 || ev.audioImpact ? 1 : 0.8, { precise: !opts.slowGuessed && (ev.downFrames >= 10 || !!ev.audioImpact) });
  }
  // Balance
  if (ev.hold.measurable && !opts.slowGuessed) put("finishHold", ev.hold.secs, 1, { lowerBound: ev.hold.cut });

  // Head height (both views): positive = head rose.
  {
    const kH = headKeys(A, I);
    put("headHeight", cm(headAt(A, kH).y - headAt(I, kH).y), vis(idx.impact, kH, 0.4));
  }

  if (view === "face") {
    // Target direction from geometry: hands sit on the trail side at the top and the target side at the finish.
    const handX = (kp) => (kp.lwri.x + kp.rwri.x) / 2;
    const geoDir = Math.sign(handX(F) - handX(T)) || 1;
    const labelDir = Math.sign(A[L("sho")].x - A[R("sho")].x) || 1;
    if (geoDir !== labelDir) notes.push("Your swing direction suggests you might be " + (opts.hand === "L" ? "right" : "left") + "-handed. Check the “Plays” setting.");
    const dir = geoDir;   // +1: target is to the right of the image
    const hipA = mid(A.lhip, A.rhip), hipT = mid(T.lhip, T.rhip), hipI = mid(I.lhip, I.rhip), hipF = mid(F.lhip, F.rhip);
    const shoI = mid(I.lsho, I.rsho), shoT = mid(T.lsho, T.rsho);
    const kI = headKeys(A, I), kT = headKeys(A, T);
    const hips = ["lhip", "rhip"];
    put("weightShift", cm((hipI.x - hipA.x) * dir), vis(idx.impact, hips));
    put("stayBehind", cm((hipI.x - shoI.x) * dir), vis(idx.impact, [...hips, "lsho", "rsho"]));
    put("headImpact", cm((headAt(I, kI).x - headAt(A, kI).x) * dir), vis(idx.impact, kI, 0.4));
    put("hipSway", cm(-(hipT.x - hipA.x) * dir), vis(idx.top, hips));
    put("headSway", cm(-(headAt(T, kT).x - headAt(A, kT).x) * dir), vis(idx.top, kT, 0.4));
    put("spineTop", deg(Math.atan2((shoT.x - hipT.x) * -dir, hipT.y - shoT.y)), vis(idx.top, [...hips, "lsho", "rsho"]));
    // Lead arm, shoulder turn and hip turn are not scored: from one 2D camera, validation clips of tour players
    // read the same as amateurs (foreshortening and occlusion at the top).
    // Stance and finish use the address ankles: feet stay planted.
    const ankL = A[L("ank")], ankR = A[R("ank")];
    const sw = Math.abs(A.lsho.x - A.rsho.x);
    put("stance", Math.abs(ankL.x - ankR.x) / sw, vis(idx.address, ["lank", "rank", "lsho", "rsho"]));
    const span = ankL.x - ankR.x;
    if (Math.abs(span) > 5) put("finishPos", (hipF.x - ankR.x) / span, vis(idx.finish, [...hips]));
  } else {
    const hipA = mid(A.lhip, A.rhip), hipI = mid(I.lhip, I.rhip);
    const handA = mid(A.lwri, A.rwri);
    const dirB = Math.sign(handA.x - hipA.x) || 1;   // +1: the ball is to the right of the image
    const tilt = (kp) => { const s = mid(kp.lsho, kp.rsho), h = mid(kp.lhip, kp.rhip); return deg(Math.atan2(Math.abs(s.x - h.x), Math.abs(h.y - s.y))); };
    const trunk = ["lsho", "rsho", "lhip", "rhip"];
    put("spineAddress", tilt(A), vis(idx.address, trunk));
    // Posture: the worse of trunk angle lost and hips moving toward the ball (one fault, counted once).
    const lost = tilt(A) - tilt(I);
    const thrust = cm((hipI.x - hipA.x) * dirB);
    const sLost = anchorScore(lost, CHECKS.posture.anchors);
    const sThrust = anchorScore(thrust, { centre: 2.5, tour: [0, 5], amateur: [-5, 6.4], beginner: 11.4 });
    put("posture", lost, vis(idx.impact, trunk, 0.5), { thrustCm: +thrust.toFixed(1), thrustScore: sThrust });
    if (out.posture && sThrust < out.posture.score) { out.posture.score = sThrust; out.posture.drivenBy = "hips"; }
    // Near (trail) leg is the clearer one from behind.
    const near = A.rank.y >= A.lank.y ? "r" : "l";
    put("kneeFlex", 180 - angleAt(A[near + "hip"], A[near + "kne"], A[near + "ank"]), vis(idx.address, [near + "hip", near + "kne", near + "ank"]));
    // Over-the-top proxy: hand position as the hands pass hip height going back vs coming down.
    const crossX = (from, to) => {
      for (let j = from; j !== to; j += Math.sign(to - from)) {
        const k = j + Math.sign(to - from);
        const h0 = mid(series[j].kp.lwri, series[j].kp.rwri), h1 = mid(series[k].kp.lwri, series[k].kp.rwri);
        const y0 = mid(series[j].kp.lhip, series[j].kp.rhip).y, y1 = mid(series[k].kp.lhip, series[k].kp.rhip).y;
        if ((h0.y - y0) * (h1.y - y1) <= 0) { const f = (h0.y - y0) / ((h0.y - y0) - (h1.y - y1) || 1); return h0.x + (h1.x - h0.x) * f; }
      }
      return NaN;
    };
    const up = crossX(idx.takeaway, idx.top), down = crossX(idx.top, idx.impact);
    if (Number.isFinite(up) && Number.isFinite(down)) put("overTop", cm((down - up) * dirB), vis(idx.halfDown, ["lwri", "rwri"], 0.4));
  }

  return { view, checks: out, notes, poses: P, pxPerCm };
}

/* ---------- combining ----------
   Weighted geometric means (one big fault drags the score down), red-flag caps, and a cap for
   single-view clips. Unmeasured checks are left out; under 70% of weight measured = partial. */
function scoreSwing(checks, view) {
  const byBucket = {};
  let measuredW = 0, possibleW = 0;
  for (const [id, d] of Object.entries(CHECKS)) {
    if (d.view !== "both" && d.view !== view) continue;
    const w = d.prio * (d.conf === "low" ? 0.5 : 1);
    possibleW += w * BUCKETS[d.bucket].weight;
    const c = checks[id];
    if (!c || !c.measured) continue;
    measuredW += w * BUCKETS[d.bucket].weight;
    (byBucket[d.bucket] ||= []).push({ s: Math.max(5, c.score), w, p: d.prio });
  }
  const gmean = (arr) => Math.exp(arr.reduce((a, x) => a + x.w * Math.log(x.s), 0) / arr.reduce((a, x) => a + x.w, 0));
  // A bucket made only of estimates counts at half weight; a mixed bucket proportionally.
  const buckets = Object.entries(byBucket).map(([b, arr]) => ({ b, s: gmean(arr), w: BUCKETS[b].weight * arr.reduce((a, x) => a + x.w, 0) / arr.reduce((a, x) => a + x.p, 0) }));
  if (!buckets.length) return { score: null, partial: true, capped: null, buckets: {} };
  let score = Math.round(gmean(buckets));
  let capped = null;
  const red = (lo, hi, below) => Object.entries(checks).filter(([id, c]) => c.measured && CHECKS[id].conf !== "low" && CHECKS[id].prio >= lo && CHECKS[id].prio <= hi && c.score < below);
  const r10 = red(9, 10, 30), r8 = red(7, 8, 20);
  if (r10.length >= 2 && score > 44) { score = 44; capped = "Two big contact faults cap the score at 44."; }
  else if (r10.length === 1 && score > 54) { score = 54; capped = "A big contact fault caps the score at 54."; }
  else if (r8.length && score > 54) { score = 54; capped = "A big direction or backswing fault caps the score at 54."; }
  if (score > 74) { score = 74; capped = "One camera angle can’t confirm more than Club golfer level."; }
  const partial = measuredW < 0.7 * possibleW;
  return { score, partial, capped, buckets: Object.fromEntries(buckets.map((x) => [x.b, Math.round(x.s)])) };
}

/* The single biggest fix: the check whose improvement to "on target" would raise the score most
   (weighted loss breaks ties, e.g. under a cap). */
function pickFix(checks, view) {
  const base = view ? scoreSwing(checks, view).score ?? 0 : 0;
  let best = null;
  for (const [id, c] of Object.entries(checks)) {
    if (!c.measured || c.score >= 80) continue;
    const d = CHECKS[id];
    const loss = (100 - c.score) * d.prio * BUCKETS[d.bucket].weight * (d.conf === "low" ? 0.5 : 1);
    const gain = view ? (scoreSwing({ ...checks, [id]: { ...c, score: Math.max(c.score, 80) } }, view).score ?? 0) - base : 0;
    const key = gain * 1e6 + loss;
    if (loss > 0 && (!best || key > best.key)) best = { id, loss, gain, key, c };
  }
  return best;
}
/* The best genuine strength: a measured, high-confidence check in the good band. Never invented. */
function pickStrength(checks, view) {
  let best = null;
  const fixId = pickFix(checks, view)?.id;
  for (const [id, c] of Object.entries(checks)) {
    const d = CHECKS[id];
    if (!c.measured || c.score < 80 || d.conf === "low" || id === fixId) continue;
    const v = c.score * d.prio;
    if (!best || v > best.v) best = { id, v, c };
  }
  return best;
}
function adviceFor(id, c, club) {
  const d = CHECKS[id];
  if (c.score >= 70) return d.good;
  if (id === "posture" && c.drivenBy === "hips") return "Your hips push toward the ball through the hit, which jams your arms (early extension).";
  const a = anchorsFor(id, club);
  return c.value < a.centre ? (d.lo || d.hi) : (d.hi || d.lo);
}
function fmtCheck(id, v, c) {
  const d = CHECKS[id];
  if (!Number.isFinite(v)) return "–";
  if (id === "tempo") return (c?.precise ? v.toFixed(1) : "about " + v.toFixed(1)) + " : 1";
  if (id === "finishHold") return (c?.lowerBound ? "≥ " : "") + v.toFixed(1) + " s";
  if (id === "finishPos") return v.toFixed(2);
  if (id === "stance") return v.toFixed(2) + "×";
  if (id === "leadArm") return Math.round(v) + "°" + (c?.category ? " · " + c.category : "");
  if (id === "posture") return (v >= 0 ? v.toFixed(0) + "° lost" : Math.abs(v).toFixed(0) + "° dipped") + (c?.thrustCm != null ? " · hips " + (c.thrustCm >= 0 ? "+" : "−") + Math.abs(c.thrustCm).toFixed(0) + " cm" : "");
  if (d.unit === "cm") return (v > 0.5 ? "+" : v < -0.5 ? "−" : "") + Math.abs(v).toFixed(0) + " cm";
  if (d.unit === "°") return Math.round(v) + "°";
  return v.toFixed(1);
}
/* Bar scale for a check: the shaded band is the good-amateur-to-tour range; the ends sit past the beginner values. */
function checkScale(id, club) {
  const a = anchorsFor(id, club);
  const c = a.centre;
  const begLo = a.beginner < c ? a.beginner : a.beginnerLo, begHi = a.beginner > c ? a.beginner : a.beginnerHi;
  const lo = Number.isFinite(begLo) ? c - 1.35 * (c - begLo) : a.amateur[0] - 0.8 * (c - a.amateur[0] || 1);
  let hi = Number.isFinite(begHi) ? c + 1.35 * (begHi - c) : a.amateur[1] + 0.8 * (a.amateur[1] - c || 1);
  if (a.atLeast) hi = c * 1.25;                             // "at least" checks like balance
  const band = [Math.max(lo, a.amateur[0]), Math.min(hi, a.amateur[1])];
  return { lo, hi, band, a };
}
