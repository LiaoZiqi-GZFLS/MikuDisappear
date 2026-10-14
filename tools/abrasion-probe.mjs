// Probe for `erode` shot 36 -- the abrasion bay (step 58).
//
//   node tools/abrasion-probe.mjs                 # report + gates
//   node tools/abrasion-probe.mjs --quiet         # gates only (non-zero on fail)
//   node tools/abrasion-probe.mjs --sheet out/qa-abrasion
//
// What the shot claims, and what has to be true of every rendered frame:
//   1. the read head climbs monotonically, 0.03 m -> 2.05 m;
//   2. the record written on the floor only ever grows, and ends at 48/48;
//   3. the lens travels (an arc, not a pan) and its height only rises;
//   4. she is composed: she stays on the same place in the frame;
//   5. she gets smaller on screen as the room grows -- the scale reveal;
//   6. the room has depth: the rib in front of her and the rib behind her do
//      not project to the same place;
//   7. she stays inside the frame, and the drawn cloud is the cloud.
// Every number is read back off the frame that was actually rendered, through
// the scene's own qa hook -- the probe cannot pass on a nice story in a doc.

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

const T0 = 177.69, DUR = 15.2;                  // the shot, in chapter seconds
const N = Number(opt("frames", 306));           // 30 fps over the shot

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

// The sample itself: how much of the drawing is body, and where its own zero is.
const sample = await page.evaluate(() => {
  const scene = window.__mv.engine.scenes.get("erode");
  scene.qaWantBody = true;
  const all = (scene.wallLinePts || []).concat(scene.wallFillPts || []);
  let lo = 2, hi = -2;
  for (const q of all) { lo = Math.min(lo, q[1]); hi = Math.max(hi, q[1]); }
  return {
    line: (scene.wallLinePts || []).length,
    fill: (scene.wallFillPts || []).length,
    yLo: +lo.toFixed(4),
    yHi: +hi.toFixed(4),
  };
});

const rows = [];
for (let i = 0; i < N; i++) {
  const t = T0 + (DUR * i) / (N - 1);
  rows.push(await page.evaluate((tt) => {
    const mv = window.__mv;
    mv.renderFrame(tt, false);
    const e = mv.engine;
    const entry = e.timeline.find((x) => tt >= x.t0 && tt < x.t1);
    const scene = e.scenes.get(entry.scene);
    const q = scene.qaAbrasion;
    if (!q) return { t: tt, missing: true };
    return {
      t: +tt.toFixed(3),
      head: q.head, cells: q.cells, shePx: q.shePx, sx: q.sx, ribPx: q.ribPx, eye: q.eye,
      box: scene.qaBody,
    };
  }, t));
}

const live = rows.filter((r) => !r.missing && r.box);
const first = live[0], last = live[live.length - 1];
const travel = Math.hypot(
  last.eye[0] - first.eye[0], last.eye[1] - first.eye[1], last.eye[2] - first.eye[2]);
const falls = [];
for (let i = 1; i < live.length; i++) {
  const a = live[i - 1], b = live[i];
  if (b.head < a.head - 1e-9) falls.push(`head fell at ${b.t}s`);
  if (b.cells < a.cells - 1e-9) falls.push(`record fell at ${b.t}s`);
  if (b.eye[1] < a.eye[1] - 1e-9) falls.push(`eye sank at ${b.t}s`);
}
const box = live.map((r) => r.box).reduce((acc, b) => ({
  x0: Math.min(acc.x0, b.x0), x1: Math.max(acc.x1, b.x1),
  y0: Math.min(acc.y0, b.y0), y1: Math.max(acc.y1, b.y1),
}), { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });
const outOfFrame = live.filter((r) => {
  const b = r.box;
  return b.x0 < -2 || b.x1 > 1922 || b.y0 < -2 || b.y1 > 1082;
}).length;

const report = {
  sample,
  frames: live.length,
  head: [+first.head.toFixed(3), +last.head.toFixed(3)],
  cells: [first.cells, last.cells],
  eyeTravelM: +travel.toFixed(3),
  eyeHeight: [+first.eye[1].toFixed(3), +last.eye[1].toFixed(3)],
  shePx: [first.shePx, last.shePx],
  frameX: [
    +Math.min(...live.map((r) => r.sx)).toFixed(3),
    +Math.max(...live.map((r) => r.sx)).toFixed(3),
  ],
  ribPxMin: +Math.min(...live.map((r) => r.ribPx)).toFixed(1),
  cloudBox: box,
  outOfFrame,
  falls,
};

const gates = [
  ["head climbs 0.03 -> 2.05 m", Math.abs(report.head[1] - 2.05) < 0.02 && report.head[1] > report.head[0] * 30],
  ["record ends 48 / 48", report.cells[1] === 48],
  ["nothing ever runs backwards", report.falls.length === 0],
  ["lens travels > 6 m", report.eyeTravelM > 6],
  ["lens only rises", report.eyeHeight[1] > report.eyeHeight[0] + 4],
  ["she shrinks on screen", report.shePx[1] < report.shePx[0] * 0.75],
  ["framing held (0.54 .. 0.66)", report.frameX[0] > 0.54 && report.frameX[1] < 0.66],
  ["she stays inside the frame", report.outOfFrame === 0],
  ["the room has depth (rib parallax)", report.ribPxMin > 8],
];
const failed = gates.filter(([, pass]) => !pass);

if (SHEET) {
  const dir = path.resolve(SHEET);
  fs.mkdirSync(dir, { recursive: true });
  for (const tt of [178.5, 180, 183, 186, 189, 191]) {
    await page.evaluate((x) => window.__mv.renderFrame(x, true), tt);
    await page.screenshot({ path: path.join(dir, `t${tt.toFixed(2).padStart(7, "0")}.png`) });
  }
}

if (!QUIET) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`shot 36: head ${report.head[0]} -> ${report.head[1]} m, record ${report.cells[0]} -> ${report.cells[1]}, `
    + `eye ${report.eyeTravelM} m, she ${report.shePx[0]} -> ${report.shePx[1]} px, frame x ${report.frameX.join("..")}`);
}
for (const [name, pass] of gates) {
  if (!pass || !QUIET) console.log(`${pass ? "ok  " : "FAIL"}  ${name}`);
}
if (problems.length) console.log("problems:", [...new Set(problems)].slice(0, 6));
if (failed.length) {
  console.log(`abrasion probe FAILED (${failed.length})`);
  process.exitCode = 1;
} else if (QUIET) {
  console.log("abrasion probe ok");
}
await browser.close();
