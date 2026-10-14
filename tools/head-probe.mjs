// Probe for HEAD-01 -- the machine `birth` prints with and `erode` reads with
// (step 63).
//
//   node tools/head-probe.mjs                 # report + gates
//   node tools/head-probe.mjs --quiet         # gates only (non-zero on fail)
//   node tools/head-probe.mjs --sheet out/qa-head
//
// What the two shots claim, and what has to be true of every rendered frame:
//   1. `birth` sweeps the head DOWN, 2.050 m -> 0.030 m, in one monotone pass;
//   2. `erode` sweeps the same head UP, 0.030 m -> 2.050 m, monotone;
//   3. both write the same 48-cell record, 00 -> 48, in their own direction;
//   4. the two speeds are the ones the panels print: 1.188 m/s (a render) and
//      0.160 m/s (an abrasion);
//   5. it is the *same machine*: the two scenes' instance buffers must agree,
//      position for position, rotation for rotation, scale for scale -- the
//      only difference allowed between them is colour and alpha;
//   6. `birth`'s 2D silhouette is clipped at the projected height of the 3D
//      head, and the lens makes her 1180 px tall, matching the drawn figure.
// Every number is read back through the scenes' own qa hooks, off the frame
// that was actually rendered.

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

const B0 = 25.3, B1 = 27.4;          // birth: the FIRST RENDER insert
const NB = 72;
const E0 = 177.69, E1 = 193.0;       // erode: the abrasion bay
const NE = 180;

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

const readAt = (t) => page.evaluate((tt) => {
  const mv = window.__mv;
  mv.renderFrame(tt, false);
  const e = mv.engine;
  const entry = e.timeline.find((x) => tt >= x.t0 && tt < x.t1);
  const scene = e.scenes.get(entry.scene);
  return { t: +tt.toFixed(3), birth: scene.qaPrint || null, erode: scene.qaAbrasion || null };
}, t);

const birthRows = [];
for (let i = 0; i < NB; i++) birthRows.push(await readAt(B0 + ((B1 - B0) * i) / (NB - 1)));
const erodeRows = [];
for (let i = 0; i < NE; i++) erodeRows.push(await readAt(E0 + ((E1 - E0) * i) / (NE - 1)));

const liveBirth = birthRows.filter((r) => r.birth);
const liveErode = erodeRows.filter((r) => r.erode);

// the two drawings, straight out of the two instance buffers
const machine = await page.evaluate(() => {
  const e = window.__mv.engine.scenes;
  const b = e.get("birth"), d = e.get("erode");
  const A = b.bayData, B = d.chamberData;
  const n = A.length / 16;
  // The bay's own ring rides the head's height, so those last 36 instances are
  // compared with the head subtracted out; everything else is static.
  const STATIC = 504;
  const bh = b.qaPrint ? b.qaPrint.head : 0;
  const dh = d.qaAbrasion ? d.qaAbrasion.head : 0;
  let maxP = 0, maxR = 0, maxS = 0, colourDiff = 0;
  for (let i = 0; i < n; i++) {
    const k = i * 16;
    for (let j = 0; j < 3; j++) {
      let a = A[k + j], c = B[k + j];
      if (i >= STATIC && j === 1) { a -= bh; c -= dh; }
      maxP = Math.max(maxP, Math.abs(a - c));
      maxR = Math.max(maxR, Math.abs(A[k + 8 + j] - B[k + 8 + j]));
      maxS = Math.max(maxS, Math.abs(A[k + 12 + j] - B[k + 12 + j]));
    }
    for (let j = 4; j < 7; j++) colourDiff = Math.max(colourDiff, Math.abs(A[k + j] - B[k + j]));
  }
  return { instances: n, maxP, maxR, maxS, colourDiff, birthHead: bh, erodeHead: dh };
});

const monotone = (rows, key, dir) => {
  const bad = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1][key], b = rows[i][key];
    if (dir > 0 ? b < a - 1e-9 : b > a + 1e-9) bad.push(rows[i].t);
  }
  return bad;
};
const bHead = liveBirth.map((r) => r.birth.head);
const eHead = liveErode.map((r) => r.erode.head);
const bCells = liveBirth.map((r) => r.birth.cells);
const eCells = liveErode.map((r) => r.erode.cells);
const dtB = liveBirth[1].t - liveBirth[0].t;
const printRate = (bHead[0] - bHead[1]) / dtB;   // the head descends
// erode holds for 0.55 s before the servo starts: the rate is measured from
// the first frame the head has actually left the floor.
let eMove = liveErode.findIndex((r) => r.erode.head > 0.0305);
if (eMove < 0) eMove = 0;
let eStop = eMove;
while (eStop + 1 < eHead.length && eHead[eStop + 1] > eHead[eStop] + 1e-9) eStop++;
const readSpan = liveErode[eStop].t - liveErode[eMove].t;
const readRate = readSpan > 0 ? (eHead[eStop] - eHead[eMove]) / readSpan : 0;
const lastBirth = liveBirth[liveBirth.length - 1];
const firstBirth = liveBirth[0];
const lastErode = liveErode[liveErode.length - 1];
const firstErode = liveErode[0];

const report = {
  birth: {
    frames: liveBirth.length,
    head: [+firstBirth.birth.head.toFixed(4), +lastBirth.birth.head.toFixed(4)],
    cells: [firstBirth.birth.cells, lastBirth.birth.cells],
    rate: +printRate.toFixed(4),
    shePx: lastBirth.birth.shePx,
    barY: [+Math.min(...liveBirth.map((r) => r.birth.py)).toFixed(1),
      +Math.max(...liveBirth.map((r) => r.birth.py)).toFixed(1)],
    fallB: monotone(liveBirth, "birth", -1),
  },
  erode: {
    frames: liveErode.length,
    head: [+firstErode.erode.head.toFixed(4), +lastErode.erode.head.toFixed(4)],
    cells: [firstErode.erode.cells, lastErode.erode.cells],
    rate: +readRate.toFixed(4),
  },
  machine: {
    instances: machine.instances,
    maxDelta: {
      position: +machine.maxP.toFixed(6),
      rotation: +machine.maxR.toFixed(6),
      scale: +machine.maxS.toFixed(6),
    },
    colourDiff: +machine.colourDiff.toFixed(4),
  },
  slowDown: +(printRate / readRate).toFixed(2),
};

const gates = [
  ["birth sweeps down to 0.030 m", firstBirth.birth.head > 1.90
    && Math.abs(lastBirth.birth.head - 0.030) < 0.02],
  ["birth never runs backwards", report.birth.fallB.length === 0],
  ["erode sweeps 0.030 -> 2.050 m", Math.abs(firstErode.erode.head - 0.030) < 0.02
    && Math.abs(lastErode.erode.head - 2.050) < 0.02],
  ["erode never runs backwards", monotone(liveErode, "erode", 1).length === 0],
  ["both records end 48 / 48", bCells[bCells.length - 1] === 48 && eCells[eCells.length - 1] === 48],
  ["print runs at 1.188 m/s", Math.abs(printRate - 1.188) < 0.03],
  ["read runs at 0.160 m/s", Math.abs(readRate - 0.160) < 0.02],
  ["deletion is 7.4x slower than birth", report.slowDown > 7.0 && report.slowDown < 7.9],
  ["one machine, one drawing (540 instances, delta 0)",
    machine.instances === 540 && machine.maxP < 1e-6 && machine.maxR === 0 && machine.maxS === 0],
  ["the drawings differ only in colour", machine.colourDiff > 0.1],
  ["her 2D height is the lens's own (1180 px)", Math.abs(lastBirth.birth.shePx - 1180) < 60],
];
const failed = gates.filter(([, pass]) => !pass);

if (SHEET) {
  const dir = path.resolve(SHEET);
  fs.mkdirSync(dir, { recursive: true });
  for (const tt of [25.7, 26.1, 26.5, 26.9, 178.5, 186]) {
    await page.evaluate((x) => window.__mv.renderFrame(x, true), tt);
    await page.screenshot({ path: path.join(dir, `t${tt.toFixed(2).padStart(7, "0")}.png`) });
  }
}

if (!QUIET) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(`HEAD-01: birth ${report.birth.head[0]} -> ${report.birth.head[1]} m @ ${report.birth.rate} m/s, `
    + `erode ${report.erode.head[0]} -> ${report.erode.head[1]} m @ ${report.erode.rate} m/s, `
    + `${report.slowDown}x slower, ${machine.instances} shared instances (delta ${machine.maxP})`);
}
for (const [name, pass] of gates) {
  if (!pass || !QUIET) console.log(`${pass ? "ok  " : "FAIL"}  ${name}`);
}
if (problems.length) console.log("problems:", [...new Set(problems)].slice(0, 6));
if (failed.length) {
  console.log(`head probe FAILED (${failed.length})`);
  process.exitCode = 1;
} else if (QUIET) {
  console.log("HEAD-01 probe ok");
}
await browser.close();
