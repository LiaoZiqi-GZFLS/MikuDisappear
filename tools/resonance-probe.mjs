// Probe: the `resonance` 16-second single take, read frame by frame.
//
//   node tools/resonance-probe.mjs                    # 41.70 -> 57.68
//   node tools/resonance-probe.mjs --to 57 --out out/probe-res
//   node tools/resonance-probe.mjs --quiet
//
// The chapter promises one shot: the lens finds a 372.7 m wire at the scale of
// a wrist, rides it down the hall, and brakes 24 m short of the collar --
// where the far anchor turns out to be a 1.70 m subject's chest. Four numbers
// have to hold for the whole 16 seconds:
//
//   1. the eye's distance to ANCHOR B falls monotonically, from ~212 m to
//      ~25 m, and never steps back;
//   2. the eye's position *along the wire* rises monotonically from ~173 m to
//      ~350 m (so the lens is really travelling the string, not zooming);
//   3. the projected subject grows through the take and is at least 110 px
//      tall before the join -- she has to be a person, not a dot, at the end;
//   4. the first rank's grid is in front of the lens and inside the frame at
//      the end: the last close-up stands in the room, not on a black card;
//   5. the film's own frame stays inside the slow budget (the move is in the
//      set, not in the shot table);
//   6. (step 59) the lens rides one trapezoid: 0 -> 14.7 m/s, a flat cruise,
//      then a brake to 0 -- no stalls at the keys;
//   7. (step 59) the 18 static gates 12 m apart are counted correctly, and the
//      count never runs backwards;
//   8. (step 59) the near-field air smears: ~0 px while the lens crawls, tens
//      of pixels at cruise -- the one speed reading a still frame can hold.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes("--" + n);
const EDGE = process.env.MV_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = opt("port", "5173");
const FROM = Number(opt("from", 41.70));
const TO = Number(opt("to", 57.68));
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
    const scene = mv.engine.scenes.get("resonance");
    const f = mv.engine.lastFrame;
    const cam = f && f.cam ? f.cam : null;
    const rp = scene.qaRankPt || null;
    return {
      t: tt,
      along: scene.qaAlong ?? null,
      distB: scene.qaDistB ?? null,
      singerH: scene.qaSingerH ?? 0,
      speed: scene.qaSpeed ?? null,
      trail: scene.qaTrail ?? null,
      gate: scene.qaGate ?? null,
      rank: rp ? [rp[0], rp[1], rp[2]] : null,
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
const nums = rows.filter((r) => r.along !== null && r.distB !== null);
const first = nums[0], last = nums[nums.length - 1];

// 1 / 2: both motions are one-way
let dBack = 0, aBack = 0;
for (let i = 1; i < nums.length; i++) {
  dBack = Math.max(dBack, nums[i].distB - nums[i - 1].distB);
  aBack = Math.max(aBack, nums[i - 1].along - nums[i].along);
}
note(dBack <= 1e-6, `distance to B stepped back by ${dBack.toFixed(4)} m`);
note(aBack <= 1e-6, `wire position stepped back by ${aBack.toFixed(4)} m`);
note(first.distB >= 190, `the take starts only ${first.distB.toFixed(1)} m from B`);
note(last.distB <= 26, `the take ends ${last.distB.toFixed(1)} m from B, not at the collar`);
note(first.along <= 180, `the lens starts at +${first.along.toFixed(1)} m along the wire`);
note(last.along >= 345, `the lens only reaches +${last.along.toFixed(1)} m along the wire`);

// 3: she grows into a person before the join
const beforeJoin = rows.filter((r) => r.t <= 57.05);
const hMax = Math.max(...beforeJoin.map((r) => r.singerH));
const early = nums.find((r) => r.t >= 49.5);
const ratio = hMax / Math.max(1e-6, early ? early.singerH : 1e-6);
note(hMax >= 110, `the subject only reaches ${hMax.toFixed(1)} px before the join`);
note(ratio >= 4, `the subject only grew ${ratio.toFixed(2)}x through the take`);

// 4: the rack is real estate behind her at the end
const rankEnd = last.rank;
note(rankEnd && rankEnd[2] > 0.25, "the first rank's rail is behind the lens at the end");
if (rankEnd && rankEnd[2] > 0.25) {
  note(rankEnd[0] >= -40 && rankEnd[0] <= 1960 && rankEnd[1] >= -40 && rankEnd[1] <= 1120,
    `the first rank's rail ends at ${rankEnd[0].toFixed(0)},${rankEnd[1].toFixed(0)} -- outside the frame`);
}

// 6 (step 59): the ride is one trapezoid, not five ease-ins. The old rig put
//    `smooth` on six keys, and smoothstep has zero slope at both ends, so the
//    lens stalled at every one of them -- measured at 19.8, 3.3, 21.6, 5.4 and
//    24.3 m/s. A hitch in a 16-second dolly is visible from the back row.
const win = (a, b) => rows.filter((r) => r.t >= a && r.t <= b && r.speed !== null);
const face = (a, b) => rows.filter((r) => r.t >= a && r.t <= b && r.trail);
const stat = (a, b, pick) => face(a, b).map(pick);
const mean = (v) => v.reduce((x, y) => x + y, 0) / Math.max(1, v.length);

const cruise = win(46.6, 53.4);
const cMin = Math.min(...cruise.map((r) => r.speed));
const cMax = Math.max(...cruise.map((r) => r.speed));
note(rows[0].speed <= 0.5, `the ride starts at ${rows[0].speed} m/s, not from rest`);
note(cMin >= 13.0, `the cruise dips to ${cMin.toFixed(1)} m/s`);
note(cMax - cMin <= 0.8, `the cruise is not flat: ${cMin.toFixed(1)} .. ${cMax.toFixed(1)} m/s`);

let accBack = 0, brakeBack = 0;
const acc = win(41.70, 46.4), brk = win(54.4, 57.05);
for (let i = 1; i < acc.length; i++) accBack = Math.max(accBack, acc[i - 1].speed - acc[i].speed);
for (let i = 1; i < brk.length; i++) brakeBack = Math.max(brakeBack, brk[i].speed - brk[i - 1].speed);
note(accBack <= 0.7, `the acceleration stepped back ${accBack.toFixed(2)} m/s`);
note(brakeBack <= 0.7, `the brake stepped back ${brakeBack.toFixed(2)} m/s`);
note(brk[brk.length - 1].speed <= 4.0,
  `the ride is still doing ${brk[brk.length - 1].speed.toFixed(1)} m/s at the collar`);

// 7 (step 59): the ruler the lens runs through. 18 static gates, 12 m apart:
//    the count has to be the distance divided by 12, and it may never fall.
let gateBack = 0, gateBad = 0;
for (let i = 0; i < rows.length; i++) {
  const g = rows[i].gate;
  if (!g || rows[i].along === null) continue;
  if (i && rows[i - 1].gate) gateBack = Math.max(gateBack, rows[i - 1].gate.n - g.n);
  const want = Math.max(0, Math.min(18, Math.floor((rows[i].along - 150) / 12) + 1));
  if (g.n !== want) gateBad++;
}
note(gateBack === 0, `the gate count fell by ${gateBack}`);
note(gateBad === 0, `${gateBad} frames disagree with their own along-wire distance`);
note(last.gate && last.gate.n === 17 && last.gate.next > 3.0,
  `the ride ends on gate ${last.gate ? last.gate.n : "?"}, ${last.gate ? last.gate.next.toFixed(1) : "?"} m short of the next`);

// 8 (step 59): the air. A mote 2 m from a lens doing 15.7 m/s smears ~30 px at
//    1/60 s; the same mote at 2.6 m/s smears ~5 px. So the streak is a speed
//    the still frame can hold -- and it has to actually say so.
const earlyP90 = stat(41.70, 43.70, (r) => r.trail.p90);
const cruiseP90 = stat(46.6, 53.4, (r) => r.trail.p90);
const peakRow = face(46.6, 53.4).reduce((a, r) => (r.trail.p90 > a.trail.p90 ? r : a));
note(Math.max(...earlyP90) <= 8, `the first two seconds already smear ${Math.max(...earlyP90).toFixed(0)} px`);
note(mean(cruiseP90) >= 10, `the cruise only averages ${mean(cruiseP90).toFixed(1)} px of trail`);
note(Math.max(...cruiseP90) >= 25, `the fastest stretch tops out at ${Math.max(...cruiseP90).toFixed(0)} px`);

// 5: the film's own frame stays inside the slow budget. The last 0.8 s are
//    the hand-over to `garble` (the engine renders both scenes there), so the
//    framing check stops before the join -- this probe measures the take, not
//    the cut out of it.
let maxDx = 0, maxDz = 0, maxDr = 0, maxShake = 0;
let atDx = 0, atDz = 0, atDr = 0;
const framing = rows.filter((r) => r.t <= 56.90);
for (let i = 0; i < framing.length; i++) {
  const c = framing[i].cam;
  if (!c) continue;
  maxShake = Math.max(maxShake, Math.hypot(c.shake[0], c.shake[1]));
  if (i > 0 && framing[i - 1].cam) {
    const p = framing[i - 1].cam;
    const dx = Math.abs(c.x - p.x), dz = Math.abs(c.z - p.z), dr = Math.abs(c.r - p.r);
    if (dx > maxDx) { maxDx = dx; atDx = framing[i].t; }
    if (dz > maxDz) { maxDz = dz; atDz = framing[i].t; }
    if (dr > maxDr) { maxDr = dr; atDr = framing[i].t; }
  }
}
note(maxDx <= 1, `film pan stepped ${maxDx.toFixed(3)} px/frame`);
note(maxDz <= 0.001, `film zoom stepped ${(maxDz * 100).toFixed(4)} %/frame`);
note(maxDr <= 0.05, `film roll stepped ${maxDr.toFixed(4)} deg/frame`);
note(maxShake <= 1e-6, `the shot breathes: max shake ${maxShake.toExponential(2)}`);

// ------------------------------------------------------------------ table
const step = Math.max(1, Math.round(rows.length / 24));
console.log("   t      along     distB   singerH   rankX   rankW    m/s   trail   gate");
for (let i = 0; i < rows.length; i += step) {
  const r = rows[i];
  if (r.along === null) continue;
  const rp = r.rank || [NaN, NaN, NaN];
  console.log(
    `${r.t.toFixed(2).padStart(7)}  ${r.along.toFixed(1).padStart(7)}  ` +
    `${r.distB.toFixed(1).padStart(7)}  ${r.singerH.toFixed(1).padStart(7)}  ` +
    `${rp[0].toFixed(1).padStart(7)}  ${rp[2].toFixed(3).padStart(6)}  ` +
    `${(r.speed ?? 0).toFixed(1).padStart(5)}  ${(r.trail ? r.trail.med : 0).toFixed(0).padStart(3)}` +
    `/${(r.trail ? r.trail.max : 0).toFixed(0).padStart(4)}  ` +
    `${r.gate ? String(r.gate.n).padStart(4) : "   ?"}`,
  );
}
console.log("");
console.log(`frames              ${rows.length}`);
console.log(`wire start -> end   +${first.along.toFixed(1)} m -> +${last.along.toFixed(1)} m`);
console.log(`B distance          ${first.distB.toFixed(1)} m -> ${last.distB.toFixed(1)} m`);
console.log(`subject height      ${(early ? early.singerH : 0).toFixed(1)} px -> ${hMax.toFixed(1)} px (${ratio.toFixed(2)}x)`);
console.log(`rank rail at end    x ${rankEnd ? rankEnd[0].toFixed(1) : "?"}, w ${rankEnd ? rankEnd[2].toFixed(3) : "?"}`);
console.log(`max pan / zoom / r  ${maxDx.toFixed(3)} px / ${(maxDz * 100).toFixed(4)} % / ${maxDr.toFixed(4)} deg`);
console.log(`  worst frames      pan ${atDx.toFixed(2)}s / zoom ${atDz.toFixed(2)}s / roll ${atDr.toFixed(2)}s`);
console.log(`max shake           ${maxShake.toExponential(2)}`);
console.log(`lens speed          0.0 -> ${cMax.toFixed(1)} m/s (cruise ${cMin.toFixed(1)}..${cMax.toFixed(1)}) -> ${brk[brk.length - 1].speed.toFixed(1)} m/s`);
console.log(`gate count          ${rows[0].gate ? rows[0].gate.n : "?"} -> ${last.gate ? last.gate.n : "?"} / 18 (${last.gate ? last.gate.next.toFixed(1) : "?"} m to the next)`);
console.log(`streak p90          ${Math.max(...earlyP90).toFixed(0)} px (start) -> ${mean(cruiseP90).toFixed(1)} px mean, ${Math.max(...cruiseP90).toFixed(0)} px peak at ${peakRow.t.toFixed(2)}s (cruise)`);
console.log(`headless errors     ${problems.length}`);
if (problems.length) console.log(problems.slice(0, 20).join("\n"));

if (fails.length) {
  console.log("\nresonance probe FAILED:");
  for (const f of fails) console.log("  - " + f);
  process.exit(1);
}
console.log("\nresonance probe ok: one take, one wire, braking at the collar");
