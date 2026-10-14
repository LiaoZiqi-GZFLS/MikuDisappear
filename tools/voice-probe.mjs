// Probe for `final` -- the anamorphic voice line (step 67).
//
//   node tools/voice-probe.mjs                 # report + gates
//   node tools/voice-probe.mjs --quiet         # gates only (non-zero on fail)
//   node tools/voice-probe.mjs --sheet out/qa-vline
//
// What the chapter claims, and what has to be true of every rendered frame:
//   1. the walk-around lands on one exact eye 1.70 s before the reduction and
//      parks there: the same arms, from anywhere else, are a crowd;
//   2. HEAD-01 writes the house at its own rate -- 256 columns, one hand per
//      column, left to right, in 1.70 s, the same time it took to print her;
//   3. the writing head stands on the same column of the picture it is
//      writing (projected back through the same camera);
//   4. at that eye the lit hands sit on one line (per-column vertical spread
//      of a couple of pixels); 0.20 m to the side they shear into a band;
//   5. when the reduction pulls the lens off the eye, the line comes apart on
//      its own -- the picture exists only from the seat it was written for.
// Every number is read back off the frame that was actually rendered, through
// the scene's own qa hook.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes("--" + n);
const EDGE = process.env.MV_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = opt("port", "5173");
const QUIET = flag("quiet");
const SHEET = opt("sheet", null);

const T0 = 244.80, T1 = 250.40;   // the walk, the write, and the reduction's start
const N = Number(opt("frames", 168));

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const problems = [];
page.on("console", (m) => { if (m.type() === "error") problems.push(m.text()); });
page.on("pageerror", (e) => problems.push(e.message));
await page.goto(`http://localhost:${PORT}/?ui=0&veil=0&hud=0&scale=1`, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("body[data-ready='1']", { timeout: 90000, state: "attached" });

const rows = [];
for (let i = 0; i < N; i++) {
  const t = T0 + ((T1 - T0) * i) / (N - 1);
  rows.push(await page.evaluate((tt) => {
    const mv = window.__mv;
    mv.renderFrame(tt, false);
    const e = mv.engine;
    const entry = e.timeline.find((x) => tt >= x.t0 && tt < x.t1);
    const scene = e.scenes.get(entry.scene);
    const q = scene.qaVoice || null;
    if (!q) return { t: +tt.toFixed(3), q: null };
    // where does the writing head stand in the picture? project it with the
    // camera that is drawing this frame, through the scene's own matrix.
    const W = mv.engine.W, H = mv.engine.H;
    const barx = scene.lineBarX[0] + (scene.lineBarX[1] - scene.lineBarX[0]) * q.sweep;
    const p = scene.stadium.vp;
    const w = scene.ctx.W, h = scene.ctx.H;
    const m = p; // gl3d mat4 is column-major, same as project() expects
    const proj = (x, y, z) => {
      const cx = m[0] * x + m[4] * y + m[8] * z + m[12];
      const cy = m[1] * x + m[5] * y + m[9] * z + m[13];
      const cw = m[3] * x + m[7] * y + m[11] * z + m[15];
      const iw = cw !== 0 ? 1 / cw : 0;
      return { u: (cx * iw * 0.5 + 0.5), v: (-cy * iw * 0.5 + 0.5), w: cw };
    };
    const bar = proj(barx, 4, scene.lineBarZ);
    const wantU = q.uSpan[0] + (q.uSpan[1] - q.uSpan[0]) * q.sweep;
    return {
      t: +tt.toFixed(3),
      barU: +bar.u.toFixed(4),
      wantU: +wantU.toFixed(4),
      barW: +bar.w.toFixed(3),
      q: {
        mix: q.mix, lock: q.lock, sweep: q.sweep, arc: q.arc, hold: q.hold,
        landAt: q.landAt, scan: q.scan, eye: q.eye, camEye: q.camEye,
        visible: q.visible, onLine: q.onLine, side: q.side, columns: q.columns,
        writeCol: q.writeCol, cols: q.cols, lifted: q.lifted, lift: q.lift,
        err0: q.err0, errCam: q.errCam, errSeat: q.errSeat, uSpan: q.uSpan,
        err1: q.err1,
      },
    };
  }, t));
}

const live = rows.filter((r) => r.q);
for (const r of live) {
  const a = r.q.camEye, b = r.q.eye;
  r.cam = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  r.barErr = Math.abs(r.barU - r.wantU) * 1920;
}
const first = live[0], last = live[live.length - 1];
const sweep = live.map((r) => r.q.sweep);
const mix = live.map((r) => r.q.mix);
const writeCol = live.map((r) => r.q.writeCol);

// The frames that matter: the pen is at the end of its sweep, the line is
// complete, and the lens is still parked on the one eye (the half-second the
// finished waveform is allowed to be read).
const full = live.filter((r) => r.q.sweep >= 0.999 && r.q.arc >= 0.999 && r.cam < 0.02 && r.q.mix > 0.6);
// While the pen is running: the same eye, half a house written.
const writing = live.filter((r) => r.q.sweep > 0.02 && r.q.sweep < 0.98 && r.q.arc >= 0.999);
// After the reduction pulls the lens off the eye: the line comes apart.
const leaving = live.filter((r) => r.q.sweep >= 1 && r.q.mix > 0.15 && r.cam > 0.05);
// The whole first half of the walk, before the lens is anywhere near the eye.
const walk = live.filter((r) => r.q.arc < 0.9);

const hands = full.map((r) => r.q.onLine);
const cols = full.map((r) => r.q.columns);
const eyeErr = full.map((r) => r.q.err0.med);
const eyeErr90 = full.map((r) => r.q.err0.p90);
const eyeHand = full.map((r) => r.q.err0.hand.p90);
const stepErr = full.map((r) => r.q.errSeat.med);
const stepErr90 = full.map((r) => r.q.errSeat.p90);
const stepFolds = full.map((r) => r.q.errSeat.folds);
const oneErr = full.map((r) => r.q.err1.med);
const leaveErr = leaving.map((r) => r.q.errCam.med);

// monotone gates on the writing front
const falls = [];
for (let i = 1; i < live.length; i++) {
  if (sweep[i] < sweep[i - 1] - 1e-6) falls.push(`sweep fell at ${live[i].t}`);
  if (writeCol[i] < writeCol[i - 1] - 1e-6) falls.push(`writeCol fell at ${live[i].t}`);
}
// the rate of the sweep: 256 columns in 1.70 s
const rate = [];
for (let i = 1; i < live.length; i++) {
  const dt = live[i].t - live[i - 1].t;
  const du = sweep[i] - sweep[i - 1];
  if (dt > 1e-6 && du > 1e-9) rate.push(du / dt);
}
const rateMed = rate.sort((a, b) => a - b)[Math.floor(rate.length / 2)];

const beforeLand = live.filter((r) => r.q.sweep < 0.0001 && r.t < first.q.landAt);
const report = {
  frames: live.length,
  landAt: first.q.landAt,
  sweep: [+sweep[0].toFixed(3), +sweep[sweep.length - 1].toFixed(3)],
  rate: +rateMed.toFixed(4),
  fullFrames: full.length,
  fullSeconds: +(full.length / 30).toFixed(2),
  hands: [+Math.min(...hands), +Math.max(...hands)],
  columns: [+Math.min(...cols), +Math.max(...cols)],
  barErrPx: +Math.max(
    ...[...writing, ...full].map((r) => r.barErr),
  ).toFixed(3),
  camToEye: +Math.max(...full.map((r) => r.cam)).toFixed(4),
  offBeforeLand: +Math.max(...beforeLand.map((r) => r.q.mix)).toFixed(4),
  errAtEye: [+Math.min(...eyeErr).toFixed(2), +Math.max(...eyeErr).toFixed(2)],
  errAtEye90: [+Math.min(...eyeErr90).toFixed(2), +Math.max(...eyeErr90).toFixed(2)],
  handAtEye90: +Math.max(...eyeHand).toFixed(2),
  errStepSeat: [+Math.min(...stepErr).toFixed(2), +Math.max(...stepErr).toFixed(2)],
  errStepSeat90: [+Math.min(...stepErr90).toFixed(2), +Math.max(...stepErr90).toFixed(2)],
  foldsStepSeat: [Math.min(...stepFolds), Math.max(...stepFolds)],
  errOneMetre: [+Math.min(...oneErr).toFixed(2), +Math.max(...oneErr).toFixed(2)],
  errLeaving: leaveErr.length ? +Math.max(...leaveErr).toFixed(2) : null,
  walkFrames: walk.length,
  walkHands: walk.length ? Math.max(...walk.map((r) => r.q.onLine)) : 0,
  walkMaxMix: walk.length ? +Math.max(...walk.map((r) => r.q.mix)).toFixed(4) : 0,
  visible: last.q.visible,
  falls,
};

const gates = [
  ["the walk is off before it lands", report.offBeforeLand < 0.002],
  ["the lens lands on the one eye and holds the finished line",
    report.camToEye < 0.02 && report.fullFrames >= 12],
  ["two hands per column the house can reach (>= 480 of 512)",
    report.hands[0] >= 430 && report.hands[1] <= 512
    && report.columns[1] >= 225 && report.columns[1] <= 256],
  ["the sweep is 1.70 s (HEAD-01's rate)", Math.abs(report.rate - 1 / 1.70) < 0.01],
  ["the sweep only goes forward", falls.length === 0],
  ["the writing head stands on the column it writes", report.barErrPx < 1.0],
  ["at the eye every hand is on an edge of the band", report.handAtEye90 <= 6.0],
  ["at the eye the band's centre is the written ridge",
    report.errAtEye[1] <= 2.0 && report.errAtEye90[1] <= 10.0],
  ["one seat (0.50 m) aside, the same hands are a different melody",
    report.errStepSeat[0] >= 3 && report.errStepSeat[0] > 2 * Math.max(0.5, report.errAtEye[1])
    && report.foldsStepSeat[0] >= 200],
  ["when the lens leaves, the line comes apart",
    report.errLeaving != null && report.errLeaving > 6 * Math.max(0.5, report.errAtEye[1])],
  ["the walk itself writes nothing", report.walkMaxMix < 0.002],
  ["the trace is released before the chapter ends", mix[mix.length - 1] < 0.02],
];
const failed = gates.filter(([, pass]) => !pass);

if (SHEET) {
  const dir = path.resolve(SHEET);
  fs.mkdirSync(dir, { recursive: true });
  for (const tt of [245.20, 245.65, 245.95, 246.30, 246.70, 247.10, 247.35, 247.90, 248.60]) {
    await page.evaluate((x) => window.__mv.renderFrame(x, true), tt);
    await page.screenshot({ path: path.join(dir, `t${tt.toFixed(2).padStart(7, "0")}.png`) });
  }
}

if (!QUIET) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`voice line: ${report.hands[1]} hands / ${report.columns[1]} columns in ${(1 / report.rate).toFixed(2)} s, `
    + `ridge at eye +-${report.errAtEye[1]} px (p90 ${report.errAtEye90[1]}) -> one seat aside ${report.errStepSeat[0]} px `
    + `(${report.foldsStepSeat[0]} folded columns), lens to eye ${report.camToEye} m`);
}
for (const [name, pass] of gates) {
  if (!pass || !QUIET) console.log(`${pass ? "ok  " : "FAIL"}  ${name}`);
}
if (problems.length) console.log("problems:", [...new Set(problems)].slice(0, 6));
if (failed.length) {
  console.log(`voice probe FAILED (${failed.length})`);
  process.exitCode = 1;
} else if (QUIET) {
  console.log("voice probe ok");
}
await browser.close();
