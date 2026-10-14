// Probe: the `brake` emergency stop, read frame by frame.
//
//   node tools/brake-probe.mjs                     # 104.30 -> 115.70
//   node tools/brake-probe.mjs --from 104.3 --to 112 --out out/probe-brake
//   node tools/brake-probe.mjs --quiet             # table only, no frames
//
// The chapter's claim is one sentence: **the world stops, the lens does not.**
// This tool holds the picture to that sentence:
//
//   1. every debris position is a pure function of `stop`; after the brake is
//      fully on, the position hash must not change for one frame -- the room
//      has no keyframe left;
//   2. the scene's own camera keeps moving down the corridor, monotonically,
//      for 42 m -- and the film's framing budget (camera.js) is untouched;
//   3. the stop front runs the whole 84 m corridor and is gone by the end;
//   4. two static points 48 m apart are projected every frame: while the near
//      one is still at least 5 m in front of the lens it must sweep the frame
//      several times faster than the far one. That ratio is the only motion
//      left in the room, and it is parallax. (The 5 m gate keeps the
//      measurement away from the asymptote where the point passes the lens.)

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes("--" + n);
const EDGE = process.env.MV_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = opt("port", "5173");
const FROM = Number(opt("from", 104.30));
const TO = Number(opt("to", 115.70));
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
for (const t of times) {
  const info = await page.evaluate((tt) => {
    const mv = window.__mv;
    mv.renderFrame(tt, false);
    const scene = mv.engine.scenes.get("brake");
    const f = mv.engine.lastFrame;
    const cam = f && f.cam ? f.cam : null;
    const q = scene.qaFreeze || null;
    return {
      t: tt,
      t0: (mv.chapters.find((c) => c.id === "brake") || {}).t0 || 103.69,
      q: q ? {
        eyeZ: q.eyeZ, travel: q.travel, glide: q.glide, frontZ: q.frontZ,
        frontOn: q.frontOn, held: q.held, hash: q.hash,
        nearX: q.near[0], nearY: q.near[1], nearW: q.nearW,
        farX: q.far[0], farY: q.far[1], farW: q.farW,
      } : null,
      cam: cam ? {
        x: cam.x, y: cam.y, z: cam.z, r: cam.r,
        shake: cam.shake ? cam.shake.slice(0, 2) : [0, 0],
      } : null,
    };
  }, t);
  rows.push(info);
  if (OUT && !QUIET) {
    await page.screenshot({ path: path.join(path.resolve(OUT), `t${t.toFixed(2).padStart(7, "0")}.png`) });
  }
}
await browser.close();

// ------------------------------------------------------------------ checks
const fails = [];
const note = (ok, msg) => { if (!ok) fails.push(msg); };
const t0 = rows[0].t0;
const local = (r) => r.t - t0;

// 1. the world has no keyframe after the brake is on
const frozen = rows.filter((r) => local(r) >= 0.60 && r.q);
const hashes = new Set(frozen.map((r) => String(r.q.hash)));
note(hashes.size === 1, `freeze hash changed: ${hashes.size} distinct values`);

// 2. the lens walks one way, 42 m into the freeze
let maxBack = 0;
for (let i = 1; i < rows.length; i++) {
  if (!rows[i].q || !rows[i - 1].q) continue;
  maxBack = Math.max(maxBack, rows[i].q.eyeZ - rows[i - 1].q.eyeZ);
}
note(maxBack <= 1e-9, `scene camera stepped backwards by ${maxBack.toExponential(2)} m`);
const lastQ = rows[rows.length - 1].q;
note(lastQ && lastQ.travel >= 35, `lens travelled only ${lastQ ? lastQ.travel.toFixed(2) : "?"} m`);

// 3. the front runs the corridor
let frontBack = 0, frontLast = Infinity;
for (let i = 0; i < rows.length; i++) {
  if (!rows[i].q) continue;
  frontLast = rows[i].q.frontZ;
  if (i > 0 && rows[i - 1].q) frontBack = Math.max(frontBack, rows[i].q.frontZ - rows[i - 1].q.frontZ);
}
note(frontBack <= 1e-9, `stop front jumped backwards by ${frontBack.toFixed(4)} m`);
note(frontLast <= -80, `stop front stopped at ${frontLast.toFixed(2)} m`);

// 4. only parallax is left: near point sweeps, far point creeps
const live = rows.filter((r) => r.q && r.q.nearW > 5.0 && r.q.farW > 0.6);
const span = (key) => {
  let lo = Infinity, hi = -Infinity;
  for (const r of live) { lo = Math.min(lo, r.q[key]); hi = Math.max(hi, r.q[key]); }
  return hi - lo;
};
const nearMove = span("nearX");
const farMove = span("farX");
const ratio = nearMove / Math.max(farMove, 1e-6);
note(live.length >= 20, `only ${live.length} frames had both parallax points in front of the lens`);
note(nearMove >= 200, `near point swept only ${nearMove.toFixed(1)} px`);
note(farMove >= 0.5, `far point did not move at all (${farMove.toFixed(3)} px)`);
note(ratio >= 3, `near/far parallax ratio was only ${ratio.toFixed(2)}x`);

// 5. the film's own frame is still inside budget after the hit, and the
//    breathing stops with the transport (shot 2 onward is "no breathing")
const heldFrames = rows.filter((r) => r.t >= t0 + 1.60 && r.cam);
let maxShake = 0, maxDx = 0, maxDz = 0, maxDr = 0;
for (let i = 0; i < heldFrames.length; i++) {
  const c = heldFrames[i].cam;
  maxShake = Math.max(maxShake, Math.hypot(c.shake[0], c.shake[1]));
  if (i > 0) {
    const p = heldFrames[i - 1].cam;
    maxDx = Math.max(maxDx, Math.abs(c.x - p.x));
    maxDz = Math.max(maxDz, Math.abs(c.z - p.z));
    maxDr = Math.max(maxDr, Math.abs(c.r - p.r));
  }
}
note(maxShake <= 1e-6, `breathing did not stop: max shake ${maxShake.toExponential(2)}`);
note(maxDx <= 8, `film pan stepped ${maxDx.toFixed(2)} px/frame`);
note(maxDz <= 0.005, `film zoom stepped ${(maxDz * 100).toFixed(3)} %/frame`);
note(maxDr <= 0.25, `film roll stepped ${maxDr.toFixed(3)} deg/frame`);

// ------------------------------------------------------------------ table
const step = Math.max(1, Math.round(rows.length / 26));
console.log("   t      local   eyeZ    travel  frontZ   glide   held  hash      nearX   farX");
for (let i = 0; i < rows.length; i += step) {
  const r = rows[i], q = r.q;
  if (!q) continue;
  console.log(
    `${r.t.toFixed(2).padStart(7)}  ${local(r).toFixed(2).padStart(5)}  ` +
    `${q.eyeZ.toFixed(2).padStart(6)}  ${q.travel.toFixed(2).padStart(6)}  ` +
    `${q.frontZ.toFixed(2).padStart(7)}  ${q.glide.toFixed(3).padStart(5)}  ` +
    `${String(q.held).padStart(4)}  ${(q.hash >>> 0).toString(16).padStart(8)}  ` +
    `${q.nearX.toFixed(1).padStart(7)}  ${q.farX.toFixed(1).padStart(7)}`,
  );
}
console.log("");
console.log(`frames              ${rows.length}`);
console.log(`frozen hash values  ${hashes.size}`);
console.log(`lens travel         ${lastQ.travel.toFixed(2)} m`);
console.log(`stop front          ${frontLast.toFixed(2)} m`);
console.log(`near sweep          ${nearMove.toFixed(1)} px`);
console.log(`far sweep           ${farMove.toFixed(3)} px`);
console.log(`parallax ratio      ${ratio.toFixed(2)}x`);
console.log(`max shake (held)    ${maxShake.toExponential(2)}`);
console.log(`max pan / zoom / r  ${maxDx.toFixed(2)} px / ${(maxDz * 100).toFixed(3)} % / ${maxDr.toFixed(3)} deg`);
console.log(`headless errors     ${problems.length}`);
if (problems.length) console.log(problems.slice(0, 20).join("\n"));

if (fails.length) {
  console.log("\nbrake probe FAILED:");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log("\nbrake probe ok: world frozen, lens walking, parallax only");
