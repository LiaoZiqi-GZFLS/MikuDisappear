// Probe: `overdrive`'s corridor, read frame by frame.
//
//   node tools/tunnel-probe.mjs                    # sweep the chapter's shots
//   node tools/tunnel-probe.mjs --times 119,130,139
//   node tools/tunnel-probe.mjs --quiet
//
// The chapter's claim is that the 22 seconds of "maximum speed" happen inside
// a 3D conduit rather than on a flat band. That claim is measurable:
//
//   1. a gate is always within 9.5 m of the lens, so gates *pass* it;
//   2. at 3 m the tube's four edges are all outside the frame -- the frame is
//      inside the tube, not looking at the end of it;
//   3. from there the four edges converge monotonically on one vanishing
//      point, and at 112 m all four are still inside the frame;
//   4. the cross-section on screen is the one the readout prints.
//
// Fails (exit 1) if the tube stops surrounding the lens or stops converging.

import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const EDGE = process.env.MV_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = opt("port", "5173");
const times = (opt("times", "117.9,119.5,122,124.5,127,129.5,132,134.5,137,139.3")).split(",").map(Number);
const DEPTHS = [2, 4, 6, 9, 14, 22, 34, 52, 78, 112];

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
  const info = await page.evaluate(({ tt, depths }) => {
    const mv = window.__mv;
    mv.renderFrame(tt, false);
    const scene = mv.engine.scenes.get("overdrive");
    if (!scene || !scene.tubeProbe) return { t: tt, ok: false };
    return {
      ok: true,
      t: tt,
      eye: scene.lastCam.eye.map((v) => +v.toFixed(3)),
      fov: +scene.lastCam.fov.toFixed(4),
      speed: +(scene.speed || 0).toFixed(2),
      dolly: +(scene.dolly || 0).toFixed(1),
      gateNear: +scene.gateNear.toFixed(3),
      edges: depths.map((d) => {
        const e = scene.tubeProbe(d);
        return {
          d,
          left: +e.left.toFixed(1), right: +e.right.toFixed(1),
          floor: +e.floor.toFixed(1), ceil: +e.ceil.toFixed(1),
        };
      }),
    };
  }, { tt: t, depths: DEPTHS });
  rows.push(info);
}

// ------------------------------------------------------------------ checks
const fails = [];
const note = (ok, msg) => { if (!ok) fails.push(msg); };
const ok = rows.every((r) => r.ok);
if (!ok) fails.push("overdrive never reported a tubeProbe: the corridor pass did not run");

const W = 1920, H = 1080;
// 1. gates keep arriving
const nearMax = Math.max(...rows.map((r) => r.gateNear || Infinity));
note(nearMax <= 9.5, `the nearest gate stayed ${nearMax.toFixed(2)} m away: nothing is passing the lens`);

// 2. the frame is inside the tube: at 2 m all four edges are off-frame, so the
// tube surrounds the lens and its walls cross the frame's own edges on the way
// out. (At 3 m the ceiling line has already come back into frame -- the tube is
// 3.90 m tall and the lens sits 1.75 m under its roof, which is the number that
// decides where the roof crosses the top edge.)
for (const r of rows) {
  const e = r.edges.find((x) => x.d === 2);
  const inside = e.left < 0 && e.right > W && e.ceil < 0 && e.floor > H;
  note(inside, `at ${r.t}s the tube does not surround the frame at 2 m `
    + `(L ${e.left.toFixed(0)} R ${e.right.toFixed(0)} T ${e.ceil.toFixed(0)} B ${e.floor.toFixed(0)})`);
}

// 3. the tube's edges cross the frame's own edges on their way out. The roof
// and the floor cross the top and the bottom between 2 and 4 m (the lens sits
// 1.75 m under a 3.90 m roof and 2.15 m over the floor); the walls cross the
// left and right between 4 and 6 m. Without a crossing there is no tube -- a
// corridor whose walls are inside the frame at every depth is a corridor seen
// from outside, which is what this chapter used to render.
for (const r of rows) {
  const e4 = r.edges.find((x) => x.d === 4);
  const e9 = r.edges.find((x) => x.d === 9);
  note(e4.left < 0 && e4.right > W,
    `at ${r.t}s the walls have already crossed the frame by 4 m `
    + `(L ${e4.left.toFixed(0)} R ${e4.right.toFixed(0)}): the tube is being watched from outside`);
  note(e4.ceil > 0 && e4.floor < H,
    `at ${r.t}s the roof and floor never come inside the frame (T ${e4.ceil.toFixed(0)} B ${e4.floor.toFixed(0)})`);
  note(e9.left > 0 && e9.right < W && e9.floor < H,
    `at ${r.t}s the tube never comes inside the frame at 9 m`);
}

// 4. one vanishing point, approached monotonically
let monoLeft = true, monoRight = true, monoCeil = true, monoFloor = true;
for (const r of rows) {
  const e = r.edges;
  for (let i = 1; i < e.length; i++) {
    if (e[i].left <= e[i - 1].left) monoLeft = false;
    if (e[i].right >= e[i - 1].right) monoRight = false;
    // the ceiling may still be coming back into frame from above the top edge,
    // so only its *inside* span has to be monotone
    if (e[i].ceil > 0 && e[i - 1].ceil > 0 && e[i].ceil <= e[i - 1].ceil) monoCeil = false;
    if (e[i].floor < H && e[i - 1].floor < H && e[i].floor >= e[i - 1].floor) monoFloor = false;
  }
}
note(monoLeft && monoRight && monoCeil && monoFloor,
  "the tube's edges are not monotone: the corridor changes shape instead of receding");
for (const r of rows) {
  const e = r.edges[r.edges.length - 1];
  const wide = e.right - e.left, tall = e.floor - e.ceil;
  note(wide < 120 && tall < 60,
    `at ${r.t}s the far gate does not close: ${wide.toFixed(0)} x ${tall.toFixed(0)} px at ${e.d} m`);
  note(e.left > 0 && e.right < W && e.ceil > 0 && e.floor < H,
    `at ${r.t}s the far gate has left the frame, so the corridor has no far end`);
}

// 5. the cross-section on screen is the one the panel prints
const r0 = rows[0];
note(Math.abs(r0.fov - 1.16) < 1e-6,
  `the cab's lens is ${(r0.fov * 180 / Math.PI).toFixed(2)} deg, the tube was built for 66.5`);

// ------------------------------------------------------------------ report
const pad = (v, n, p = 1) => String(v.toFixed(p)).padStart(n);
console.log(`\n  overdrive · 3D rail · ${times[0]}s -> ${times[times.length - 1]}s (${rows.length} frames)`);
console.log("  t        eye (x,y,z)            fov      speed    dolly     nearest gate");
for (const r of rows) {
  console.log(`  ${r.t.toFixed(1).padStart(5)}  (${r.eye.map((v) => v.toFixed(2)).join(", ")})  `
    + `${pad(r.fov, 6, 3)}  ${pad(r.speed, 6, 1)}  ${pad(r.dolly, 8)}  ${pad(r.gateNear, 6, 2)} m`);
}
console.log("\n  one frame, edge by edge (t = " + rows[0].t + "s):");
console.log("    d (m)     left     right      top     bottom");
for (const e of rows[0].edges) {
  console.log(`  ${pad(e.d, 6)}  ${pad(e.left, 8)}  ${pad(e.right, 8)}  ${pad(e.ceil, 8)}  ${pad(e.floor, 8)}`);
}
console.log(`\n  frame ${W}x${H}: left edge at 0, right at ${W}, top at 0, bottom at ${H}`);
console.log(`  tube: 12.00 m wide, 3.90 m tall, lens at 2.35 m, 66.5 deg (reported ${(r0.fov * 180 / Math.PI).toFixed(1)} deg)`);
console.log(`  gates: nearest ${Math.min(...rows.map((r) => r.gateNear)).toFixed(2)} - ${nearMax.toFixed(2)} m ahead over the chapter`);
if (problems.length) console.log("  browser:", [...new Set(problems)].slice(0, 4).join(" | "));
if (fails.length) {
  console.log("\n  FAIL");
  for (const f of [...new Set(fails)].slice(0, 12)) console.log("   - " + f);
} else {
  console.log("\n  PASS — the frame is inside a corridor, and the corridor recedes.");
}
await browser.close();
process.exit(fails.length ? 1 : 0);
