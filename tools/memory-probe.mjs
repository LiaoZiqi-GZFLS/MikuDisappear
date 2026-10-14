// Probe for `memory` (1:13.69 - 1:29.69) -- the hall, the beam, and the room
// the two of them are sitting in.
//
//   node tools/memory-probe.mjs                    # 73.70 -> 89.70
//   node tools/memory-probe.mjs --times 75,82,88   # a few frames, full report
//   node tools/memory-probe.mjs --quiet            # gates only (non-zero on fail)
//   node tools/memory-probe.mjs --sheet out/qa-memory
//
// What the chapter claims, and what has to be true of every rendered frame
// (step 60 added 1-4):
//   1. the projector is a lamp, not a gradient: the four corner edges of the
//      frustum start inside a 0.35 m gate and end on the corners of the
//      26.2 x 14.1 m screen -- so the throw and the spread are geometry;
//   2. the beam opens between the gate and the wall on screen: the gate is a
//      dot and the far cross-section is the full width of the screen;
//   3. every mote the chapter draws is *inside* the cone at the time it is
//      drawn -- dust in a beam, not dust near one;
//   4. the beam dies on "何も感じなくなって": by the end of the chapter the
//      frustum's own alpha is 0 and the readout says so;
//   5. the screen is inside the frame, and the pair is under the beam where
//      the room says they are;
//   6. the film's own frame stays inside the slow budget.

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
const T0 = 73.69, DUR = 16.0;
const N = Number(opt("frames", 481));

let times = null;
if (opt("times")) times = opt("times").split(",").map(Number);

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
const list = times || Array.from({ length: N }, (_, i) => +(T0 + (DUR * i) / (N - 1)).toFixed(4));
for (const t of list) {
  rows.push(await page.evaluate((tt) => {
    const mv = window.__mv;
    mv.renderFrame(tt, false);
    const s = mv.engine.scenes.get("memory");
    const q = s.qaBeam;
    return {
      t: tt,
      q: q ? { ...q } : null,
      screen: s.screen.map((v) => +v.toFixed(1)),
      cam: mv.engine.lastFrame && mv.engine.lastFrame.cam ? {
        x: mv.engine.lastFrame.cam.x, y: mv.engine.lastFrame.cam.y,
        r: mv.engine.lastFrame.cam.r,
      } : null,
    };
  }, t));
}

const live = rows.filter((r) => r.q);
const first = live[0], last = live[live.length - 1];
const peak = live.reduce((a, r) => (r.q.spread > a.q.spread ? r : a));

// 1: the lamp is 0.35 m and the wall is 26.2 x 14.1 m -- the table between
const apertureOk = live.every((r) => Math.abs(r.q.aperture - 0.35) < 5e-3);
const screenOk = live.every((r) => Math.abs(r.q.screenW - 26.2) < 0.05 && Math.abs(r.q.screenH - 14.1) < 0.05);
const throwOk = live.every((r) => Math.abs(r.q.throwM - 30.79) < 0.05);
const spreadOk = live.every((r) => Math.abs(r.q.spread - 74.9) < 0.2);

// 2: it opens on screen too: the gate is a dot, the far end is the wall
const nearMax = Math.max(...live.map((r) => r.q.nearPx));
const farMin = Math.min(...live.map((r) => r.q.farPx));

// 3: the dust is inside the light
const dustBad = live.filter((r) => r.q.motes > 0 && r.q.motesOut > 0).length;
const dustSeen = Math.max(...live.map((r) => r.q.motes));

// 4: the beam dies on the cold line
const coldEnd = live.filter((r) => r.t >= 87.0);
const beamEnd = Math.max(...coldEnd.map((r) => r.q.beam));
const beamStart = Math.max(...live.filter((r) => r.t <= 76.0).map((r) => r.q.beam));

// 5: the screen is inside the frame, and the picture stays still
const screenOut = live.filter((r) => {
  const [x, y, w, h] = r.screen;
  return x < -4 || y < -4 || x + w > 1924 || y + h > 1084 || w < 100;
}).length;
let maxDx = 0, maxDr = 0;
for (let i = 1; i < rows.length; i++) {
  const a = rows[i - 1].cam, b = rows[i].cam;
  if (!a || !b) continue;
  maxDx = Math.max(maxDx, Math.abs(b.x - a.x));
  maxDr = Math.max(maxDr, Math.abs(b.r - a.r));
}

const report = {
  frames: live.length,
  throwM: first.q.throwM,
  aperture: first.q.aperture,
  screen: [first.q.screenW, first.q.screenH],
  spread: first.q.spread,
  gatePx: [first.q.nearPx, nearMax],
  wallPx: [farMin, last.q.farPx],
  dust: [dustSeen, first.q.sections],
  beam: [beamStart, beamEnd],
  screenRect: first.screen,
  maxPanPx: +maxDx.toFixed(3),
  maxRollDeg: +maxDr.toFixed(4),
  screenOut,
};

const gates = [
  ["gate is 0.35 m", apertureOk],
  ["screen is 26.2 x 14.1 m", screenOk],
  ["throw is 30.8 m", throwOk],
  ["spread is x74.9", spreadOk],
  [`the gate is a dot on screen (${nearMax.toFixed(1)} px = ${(nearMax / 19.2).toFixed(1)} % of the width)`, nearMax <= 50],
  [`the wall is the screen (${farMin.toFixed(0)} px = ${(farMin / 19.2).toFixed(0)} % of the width)`, farMin >= 650],
  [`the dust is inside the cone (${dustBad} frames out)`, dustBad === 0 && dustSeen > 40],
  [`the beam starts full (${(beamStart * 100).toFixed(0)} %)`, beamStart >= 0.95],
  [`the beam dies with her (${(beamEnd * 100).toFixed(0)} %)`, beamEnd <= 0.02],
  [`the screen stays in frame (${screenOut} out)`, screenOut === 0],
  ["the lens never jumps", maxDx <= 0.6 && maxDr <= 0.01],
];
const failed = gates.filter(([, pass]) => !pass);

if (SHEET) {
  const dir = path.resolve(SHEET);
  fs.mkdirSync(dir, { recursive: true });
  for (const tt of [74.5, 77, 80, 83, 86, 88.5]) {
    await page.evaluate((x) => window.__mv.renderFrame(x, true), tt);
    await page.screenshot({ path: path.join(dir, `t${tt.toFixed(2).padStart(7, "0")}.png`) });
  }
}

if (!QUIET) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`memory: throw ${report.throwM} m, gate ${report.aperture} -> ${report.screen.join(" x ")} m `
    + `(x${report.spread}), gate ${report.gatePx[1]} px -> wall ${report.wallPx[0]} px, `
    + `dust ${report.dust[0]}, beam ${(report.beam[0] * 100).toFixed(0)} % -> ${(report.beam[1] * 100).toFixed(0)} %`);
}
for (const [name, pass] of gates) {
  if (!pass || !QUIET) console.log(`${pass ? "ok  " : "FAIL"}  ${name}`);
}
if (problems.length) console.log("problems:", [...new Set(problems)].slice(0, 6));
if (failed.length) {
  console.log(`memory probe FAILED (${failed.length})`);
  process.exitCode = 1;
} else if (QUIET) {
  console.log("memory probe ok");
}
await browser.close();
