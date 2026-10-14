// throwaway: where do the 8,215 penlights actually land in the frame, seen
// from the one eye that can read the anamorphic mask?

import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const PORT = opt("port", "5173");
const EDGE = process.env.MV_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto(`http://localhost:${PORT}/?ui=0&veil=0&hud=0&scale=1`,
  { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("body[data-ready='1']", { timeout: 90000, state: "attached" });

const out = await page.evaluate(async () => {
  const { project } = await import("/src/gl3d.js");
  const mv = window.__mv;
  mv.renderFrame(249.0, false);
  const scene = mv.engine.scenes.get("final");
  const S = scene.stadium;
  const W = 1920, H = 1080;
  const us = [], vs = [], rows = [];
  const uu = [], vv = [];
  for (let r = 0; r < S.rows; r++) {
    const ru = [], rv = [];
    for (let i = 0; i < S.counts[r]; i++) {
      const k = S.start[r] + i;
      if (S.aisle[k]) continue;
      const q = S.seat(r, i);
      const p = project(scene.portraitVp, [q.x + q.side * 0.22, q.y + 1.22 + 0.42, q.z], W, H);
      if (!(p[2] > 0.2)) continue;
      us.push(p[0] / W); vs.push(p[1] / H);
      uu.push(p[0] / W); vv.push(p[1] / H);
      ru.push(p[0] / W); rv.push(p[1] / H);
    }
    ru.sort((a, b) => a - b); rv.sort((a, b) => a - b);
    if (ru.length) rows.push({
      r, n: ru.length,
      u: [+ru[0].toFixed(3), +ru[ru.length - 1].toFixed(3)],
      v: [+rv[0].toFixed(3), +rv[rv.length - 1].toFixed(3)],
    });
  }
  us.sort((a, b) => a - b); vs.sort((a, b) => a - b);
  const q = (arr, f) => +arr[Math.floor(f * (arr.length - 1))].toFixed(3);
  const BW = 96, BH = 54;
  const hist = new Array(BW * BH).fill(0);
  for (let i = 0; i < uu.length; i++) {
    const x = Math.min(BW - 1, Math.floor(uu[i] * BW));
    const y = Math.min(BH - 1, Math.floor(vv[i] * BH));
    hist[y * BW + x]++;
  }
  let art = "";
  const ramp = " .:-=+*#%@";
  for (let y = 0; y < BH; y++) {
    let line = "";
    for (let x = 0; x < BW; x++) {
      const n = hist[y * BW + x];
      line += ramp[Math.min(ramp.length - 1, Math.floor(Math.sqrt(n / 8) * ramp.length))];
    }
    art += line + "\n";
  }
  return {
    n: uu.length,
    u: [q(us, 0.005), q(us, 0.05), q(us, 0.25), q(us, 0.5), q(us, 0.75), q(us, 0.95), q(us, 0.995)],
    v: [q(vs, 0.005), q(vs, 0.05), q(vs, 0.25), q(vs, 0.5), q(vs, 0.75), q(vs, 0.95), q(vs, 0.995)],
    rows,
    art,
  };
});
console.log("lights", out.n);
console.log("u pct .5/5/25/50/75/95/99.5:", out.u.join("  "));
console.log("v pct .5/5/25/50/75/95/99.5:", out.v.join("  "));
console.log(out.art);
console.log(out.rows.map((r) => `r${String(r.r).padStart(2)} n=${String(r.n).padStart(3)} u ${r.u[0]}-${r.u[1]} v ${r.v[0]}-${r.v[1]}`).join("\n"));
await browser.close();
