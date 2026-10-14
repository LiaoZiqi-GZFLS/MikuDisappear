// Probe: the `erode` second emergency stop, read frame by frame.
//
//   node tools/depth-probe.mjs                       # 207.86 -> 209.70
//   node tools/depth-probe.mjs --from 208.0 --to 209.7 --out out/probe-depth
//   node tools/depth-probe.mjs --quiet               # table only, no frames
//
// The shot's whole claim is a mathematical one: the lens rides 8.00 m back
// along its own optical axis while tan(fov/2) falls by exactly the same
// factor, so a metre at the section keeps its size while every plane behind it
// is pulled forward. Nothing in the bay moves -- not one ring -- and the
// machine's own frame is frozen, because the *set's* camera is the only thing
// running. This tool reads all of that off the projection every frame and
// fails (exit 1) if any of it stops being true.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes("--" + n);
const EDGE = process.env.MV_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = opt("port", "5173");
const FROM = Number(opt("from", 207.86));
const TO = Number(opt("to", 209.66));
const STEP = Number(opt("step", 1 / 30));
const QUIET = flag("quiet");
const OUT = opt("out", null);

const times = [];
for (let t = FROM; t <= TO + 1e-9; t += STEP) times.push(+t.toFixed(4));

if (OUT) fs.mkdirSync(path.resolve(OUT), { recursive: true });

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
let bayHash0 = null, bayHash1 = null;
for (const t of times) {
  const info = await page.evaluate((tt) => {
    const mv = window.__mv;
    mv.renderFrame(tt, false);
    const scene = mv.engine.scenes.get("erode");
    const f = mv.engine.lastFrame;
    const cam = f && f.cam ? f.cam : null;
    // The bay's own geometry, as the instance buffer holds it: positions and
    // per-axis scales of the live instances, with colour and alpha left out
    // (the rings *do* switch on at different alphas -- that is the relay, not
    // movement). Two frames of the same room must agree byte for byte.
    const live = scene.bay ? scene.bay.count : 0;
    const geo = scene.bayData ? (() => {
      const s = [];
      for (let i = 0; i < live; i++) {
        const k = i * 16;
        for (const j of [0, 1, 2, 12, 13, 14]) s.push(scene.bayData[k + j].toFixed(4));
      }
      return s.join(",");
    })() : null;
    const chapterT0 = (mv.chapters.find((c) => c.id === "erode") || {}).t0;
    return {
      t: tt,
      cam: cam ? {
        x: cam.x, y: cam.y, z: cam.z, r: cam.r,
        shake: cam.shake ? cam.shake.map((v) => +v.toFixed(6)) : [0, 0],
      } : null,
      q: scene.qaDepth || null,
      bayOn: scene.bayOn,
      eye: scene.lastCam ? scene.lastCam.eye.slice() : null,
      axis: scene.axis ? {
        // full precision: the lens-on-axis check below has to be able to fail
        anchor: scene.axis.anchor.slice(),
        v: scene.axis.v.slice(),
        d0: scene.axis.d0,
        k: scene.axis.k,
      } : null,
      stopT: chapterT0 + scene.stopLocal,
      stopLocal: scene.stopLocal,
      local: f ? +((f.t - chapterT0)).toFixed(3) : null,
      geo,
    };
  }, t);
  rows.push(info);
  // only once the whole relay has closed: before that the rings are still
  // arriving one by one, and a shorter buffer is a relay, not a moving room
  if (info.bayOn > 0.9 && info.local > info.stopLocal + 0.44) {
    if (!bayHash0) bayHash0 = info.geo;
    bayHash1 = info.geo;
  }
  if (OUT && !QUIET) {
    await page.screenshot({ path: path.join(path.resolve(OUT), `t${t.toFixed(2).padStart(7, "0")}.png`) });
  }
}

// ------------------------------------------------------------------ checks
const fails = [];
const note = (ok, msg) => { if (!ok) fails.push(msg); };
const q0 = rows.find((r) => r.q)?.q || null;
if (!q0) fails.push("no qaDepth read out: the dolly shot never resolved");

// 1. the machine's own frame does not move -- checked from the marker onward,
// because the shot *before* the marker is allowed to keep retreating: the
// freeze is the stop's own picture, and it starts when the device fires.
const stopT = rows[0].stopT;
const held = rows.filter((r) => r.t >= stopT - 1e-9);
let maxDz = 0, maxDp = 0, maxDr = 0, maxShake = 0;
for (let i = 1; i < held.length; i++) {
  const a = held[i - 1].cam, b = held[i].cam;
  if (!a || !b) continue;
  maxDz = Math.max(maxDz, Math.abs(b.z - a.z));
  maxDp = Math.max(maxDp, Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  maxDr = Math.max(maxDr, Math.abs(b.r - a.r));
  maxShake = Math.max(maxShake, Math.abs(b.shake[0]), Math.abs(b.shake[1]));
}
note(maxDz <= 1e-9, `frame zoom moved during the stop (max |dz| = ${maxDz.toExponential(2)})`);
note(maxDp <= 1e-9, `frame panned during the stop (max |dp| = ${maxDp.toExponential(2)})`);
note(maxDr <= 1e-9, `frame rolled during the stop (max |dr| = ${maxDr.toExponential(2)})`);
note(maxShake <= 1e-9, `handheld shake during the stop (max ${maxShake.toExponential(2)})`);
note(held.length >= 40, `only ${held.length} frames were held after the marker`);

// 2. a metre at the section keeps its size
const qs = rows.map((r) => r.q).filter(Boolean);
const px = qs.map((q) => q.subjectPx);
const pxMin = Math.min(...px), pxMax = Math.max(...px);
note(pxMax - pxMin <= 0.05, `subject size drifted by ${(pxMax - pxMin).toFixed(3)} px (limit 0.050)`);

// 3. the room is pulled forward, monotonically, and by the amount the panel
// prints. A finite rail can never make a finite room exactly flat (see the
// BAY/DOLLY note in src/scenes/erode.js), so the threshold is the measured
// 40 % of depth the move actually takes -- not an aspiration of 1.000x.
let mono = true, prev = Infinity;
for (const q of qs) { if (q.parallax > prev + 1e-9) mono = false; prev = q.parallax; }
note(mono, "parallax is not monotone: the bay rang instead of collapsing");
const pA = qs[0].parallax, pB = qs[qs.length - 1].parallax;
note(pB < pA * 0.75, `near/far ratio only fell from ${pA.toFixed(3)}x to ${pB.toFixed(3)}x (< 25 %)`);
note(qs[qs.length - 1].farGain >= 0.40,
  `the far ring only grew ${(qs[qs.length - 1].farGain * 100).toFixed(1)} % (expected >= 40 %)`);
note(qs[qs.length - 1].farGain <= 0.60,
  `the far ring grew ${(qs[qs.length - 1].farGain * 100).toFixed(1)} %: the rail is overshooting the bay`);

// 4. the rail runs its full 8.00 m and no more
const d0 = rows[0].axis.d0;
const dEnd = qs.length ? qs[qs.length - 1].track : NaN;
note(Math.abs(qs[0].track - d0) < 0.05, `rail starts at ${qs[0].track} m, the shot is built on ${d0} m`);
note(Math.abs(dEnd - (d0 + 8.00)) < 0.05, `rail ends at ${dEnd.toFixed(3)} m, expected ${(d0 + 8).toFixed(2)} m`);

// 5. the lens is on the axis, not near it
let maxOff = 0;
for (const r of rows) {
  if (!r.eye || !r.q) continue;
  const d = r.q.track;
  for (let k = 0; k < 3; k++) {
    maxOff = Math.max(maxOff, Math.abs(r.eye[k] - (r.axis.anchor[k] - r.axis.v[k] * d)));
  }
}
note(maxOff < 1e-6, `the lens left the optical axis by ${maxOff.toExponential(2)} m`);

// 6. nothing in the bay was keyframed
note(!!bayHash0, "the bay never reported a closed relay: no room was ever on screen");
note(!bayHash0 || bayHash0 === bayHash1,
  "the bay's own geometry changed while it was on screen: something in the room moved");

// ------------------------------------------------------------------ report
const pad = (v, n, p = 2) => String(v.toFixed(p)).padStart(n);
console.log(`\n  erode · second emergency stop · ${FROM.toFixed(2)}s -> ${TO.toFixed(2)}s (${rows.length} frames)`);
console.log(`  the marker is at ${stopT.toFixed(2)}s: the frame below is checked frozen from there (${held.length} frames)`);
console.log("  t        rail     eye->sect   lens     scale      near     far    parallax  far ring  bay");
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  if (i % 4 !== 0 && i !== rows.length - 1) continue;
  const q = r.q;
  if (!q) { console.log(`  ${r.t.toFixed(2)}  (no dolly reading)`); continue; }
  console.log(`  ${q.local.toFixed(2).padStart(5)}  ${pad(q.rail, 5, 3)}  ${pad(q.track, 8)} m  ${pad(q.fovDeg, 5, 1)}°  ${pad(q.subjectPx, 6, 1)} px  ${pad(q.nearPx, 6, 1)}  ${pad(q.farPx, 6, 1)}  ${pad(q.parallax, 6, 3)}x  ${pad(q.farGain * 100, 7, 1)}%  ${pad(r.bayOn, 4, 2)}`);
}
console.log(`\n  frame (held): max |dz| ${maxDz.toExponential(2)}   max |dpan| ${maxDp.toExponential(2)}   max |drot| ${maxDr.toExponential(2)}   shake ${maxShake.toExponential(2)}`);
console.log(`  subject at the section: ${pxMin.toFixed(2)} -> ${pxMax.toFixed(2)} px (spread ${(pxMax - pxMin).toFixed(3)} px)`);
console.log(`  parallax: ${pA.toFixed(3)}x -> ${pB.toFixed(3)}x   far ring ${(qs[0].farGain * 100).toFixed(1)} % -> ${(qs[qs.length - 1].farGain * 100).toFixed(1)} %`);
console.log(`  rail:     ${qs.length ? qs[0].track.toFixed(2) : "?"} m -> ${dEnd.toFixed(2)} m  (d0 ${d0.toFixed(2)} m, +8.00 m)`);
console.log(`  axis:     max lens offset ${maxOff.toExponential(2)} m`);
console.log(`  bay:      geometry ${bayHash0 === bayHash1 && bayHash0 ? "constant" : "CHANGED"} while on screen`);
if (problems.length) console.log("  browser:", [...new Set(problems)].slice(0, 4).join(" | "));
if (fails.length) {
  console.log("\n  FAIL");
  for (const f of fails) console.log("   - " + f);
} else {
  console.log("\n  PASS — the room is the picture, and the picture does not move.");
}
await browser.close();
process.exit(fails.length ? 1 : 0);
