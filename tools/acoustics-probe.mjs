// Probe for `lastwords` -- the room's own answer (step 64).
//
//   node tools/acoustics-probe.mjs                 # report + gates
//   node tools/acoustics-probe.mjs --quiet         # gates only (non-zero on fail)
//   node tools/acoustics-probe.mjs --sheet out/qa-ac
//
// What the chapter claims, and what has to be true of every rendered frame:
//   1. one impulse leaves the stage and runs the hall at 343 m/s, replayed x9
//      (38.11 m/s on screen) -- monotone, constant;
//   2. every row is reached in the order of its real distance; the last row is
//      59.2 m away and the wavefront gets there in 1.55 s;
//   3. the room rings with an empty hall's RT60 (3.20 s real, 28.8 s replayed),
//      so the chapter cuts while it is still answering: the level never reaches
//      -60 dB, and it is still above -60 when the picture leaves;
//   4. the penlights are switched off *by the wavefront*, row by row, and the
//      house reads 00000 for the whole chapter;
//   5. SEAT 08192 is a record, not an audience: it lights when the front
//      reaches the last row and never decays before the cut.
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

const T0 = 256.70, T1 = 273.60;    // the chapter, in film seconds
const N = Number(opt("frames", 508));

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
    return { t: +tt.toFixed(3), q: scene.qaAcoustics || null };
  }, t));
}

const live = rows.filter((r) => r.q);
const first = live[0], last = live[live.length - 1];
const speed = live.map((r) => r.q.speed);
const front = live.map((r) => r.q.front);
const level = live.map((r) => r.q.levelDb);
const liveRows = live.map((r) => r.q.liveRows);
const seat = live.map((r) => r.q.seatA);

// monotone checks
const falls = [];
for (let i = 1; i < live.length; i++) {
  if (front[i] < front[i - 1] - 1e-6) falls.push(`front fell at ${live[i].t}`);
  // the house can only lose live rows while the front is still arriving; after
  // that a row going quiet is the reverb decaying, which is the point
  if (liveRows[i] < liveRows[i - 1] && front[i] < live[i].q.depth) {
    falls.push(`rows fell at ${live[i].t}`);
  }
  // and once the front is past the last row, the room's level may only fall
  if (level[i] > level[i - 1] + 1e-6 && front[i] > live[i].q.depth + 4) {
    falls.push(`level rose after the last row at ${live[i].t}`);
  }
}
const minSpeed = Math.min(...speed), maxSpeed = Math.max(...speed);
const occupancy = new Set(live.map((r) => r.q.occupancy));
const seatBefore = seat.filter((_, i) => front[i] < live[i].q.depth).reduce((m, v) => Math.max(m, v), 0);
const liveRowsMax = Math.max(...liveRows);
const levelMax = Math.max(...level);
const levelLast = level[level.length - 1];

const report = {
  frames: live.length,
  speed: [+minSpeed.toFixed(4), +maxSpeed.toFixed(4)],
  front: [+first.q.front.toFixed(2), +last.q.front.toFixed(2)],
  depth: +last.q.depth.toFixed(3),
  arriveLast: +last.q.arriveLast.toFixed(3),
  liveRows: [liveRows[0], liveRowsMax],
  levelDb: [+levelMax.toFixed(2), +levelLast.toFixed(2)],
  occupancy: [...occupancy],
  seat: [+seatBefore.toFixed(3), +last.q.seatA.toFixed(3)],
  falls,
};

const gates = [
  ["the front only moves forward", falls.filter((f) => f.includes("front")).length === 0],
  ["343 m/s replayed x9 (38.111 m/s)", Math.abs(minSpeed - 343 / 9) < 0.01 && Math.abs(maxSpeed - 343 / 9) < 0.01],
  ["the hall is 59 m deep", Math.abs(report.depth - 59.2) < 1.5],
  ["the last row is reached in 1.5 s", report.arriveLast > 1.45 && report.arriveLast < 1.65],
  ["the front reaches every row, in order", liveRowsMax === 32
    && falls.filter((f) => f.includes("rows")).length === 0],
  ["the room is still ringing at the cut", levelLast > -60 && levelLast < -20],
  ["the room's answer is never louder than its impulse", levelMax < 0.5],
  ["the room's level never rises after the last row", falls.filter((f) => f.includes("level")).length === 0],
  ["the house reads 00000", occupancy.size === 1 && occupancy.has(0)],
  ["SEAT 08192 is off until the front arrives, then held", seatBefore < 0.02 && last.q.seatA > 0.98],
];
const failed = gates.filter(([, pass]) => !pass);

if (SHEET) {
  const dir = path.resolve(SHEET);
  fs.mkdirSync(dir, { recursive: true });
  for (const tt of [256.95, 257.15, 257.35, 257.75, 258.2, 260, 264, 270]) {
    await page.evaluate((x) => window.__mv.renderFrame(x, true), tt);
    await page.screenshot({ path: path.join(dir, `t${tt.toFixed(2).padStart(7, "0")}.png`) });
  }
}

if (!QUIET) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`room: ${report.speed[0]} m/s x9, depth ${report.depth} m, last row at ${report.arriveLast} s, `
    + `level peak ${report.levelDb[0]} dB / ${report.levelDb[1]} dB at the cut, `
    + `occupancy ${report.occupancy.join("/")}, seat 08192 ${report.seat[1]}`);
}
for (const [name, pass] of gates) {
  if (!pass || !QUIET) console.log(`${pass ? "ok  " : "FAIL"}  ${name}`);
}
if (problems.length) console.log("problems:", [...new Set(problems)].slice(0, 6));
if (failed.length) {
  console.log(`acoustics probe FAILED (${failed.length})`);
  process.exitCode = 1;
} else if (QUIET) {
  console.log("acoustics probe ok");
}
await browser.close();
