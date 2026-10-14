// throwaway sweep: how much of her voice can 7,126 visible penlights draw?
// Varies the trace's height and amplitude, the arm's reach, and the stroke
// tolerance, then reports column coverage and off-axis error.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(opt("out", "out/diag-voice"));
const PORT = opt("port", "5173");
const T = Number(opt("t", 247.0));
fs.mkdirSync(OUT, { recursive: true });

const EDGE = process.env.MV_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 1600 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`http://localhost:${PORT}/?ui=0&veil=0&hud=0&scale=1`,
  { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("body[data-ready='1']", { timeout: 90000, state: "attached" });

const report = await page.evaluate(async (T) => {
  const { camera, mat4, project } = await import("/src/gl3d.js");
  const mv = window.__mv;
  mv.renderFrame(T, false);
  const scene = mv.engine.scenes.get("final");
  const S = scene.stadium, F = mv.features;
  const W = 1920, H = 1080, cols = 256;
  const eye0 = scene.portraitEye, at0 = scene.portraitAt;
  const vpOf = (dx) => {
    const vp = mat4();
    camera(vp, {
      eye: [eye0[0] + dx, eye0[1], eye0[2]], at: at0,
      fov: 1.14, near: 0.5, far: 900, aspect: W / H,
    });
    return vp;
  };
  const vp0 = vpOf(0);
  const vAt = (vp, x, y, z) => project(vp, [x, y, z], W, H);
  const seats = [];
  for (let r = 0; r < S.rows; r++) {
    for (let i = 0; i < S.counts[r]; i++) {
      const k = S.start[r] + i;
      if (S.aisle[k]) continue;
      const q = S.seat(r, i);
      const x = q.x + q.side * 0.20, z = q.z, y0 = q.y + 1.22 + 0.22;
      const p = vAt(vp0, x, y0, z);
      if (!(p[2] > 0.2)) continue;
      const u = p[0] / W;
      if (u < 0 || u > 1) continue;
      seats.push({ r, k, x, z, y0, u, v: p[1] / H, side: q.side });
    }
  }
  const { lo, hi } = F.waveSlice(T - 2.4, T, cols);
  const mid = new Float32Array(cols);
  for (let i = 0; i < cols; i++) mid[i] = 0.5 * (lo[i] + hi[i]);
  let peak = 0;
  for (let i = 0; i < cols; i++) peak = Math.max(peak, Math.abs(mid[i]));
  const col = (u) => Math.max(0, Math.min(cols - 1, Math.round(u * (cols - 1))));

  const run = ({ c, A, dy0, dy1, tol }) => {
    const target = (u) => c - (A / Math.max(0.2, peak)) * mid[col(u)];
    const pens = [];
    let reached = 0;
    for (const s of seats) {
      const t = target(s.u);
      const top = vAt(vp0, s.x, s.y0 + dy1, s.z)[1] / H;
      const bot = vAt(vp0, s.x, s.y0 + dy0, s.z)[1] / H;
      if (t < top || t > bot) continue;
      reached++;
      let y = s.y0;
      for (let it = 0; it < 3; it++) {
        const vv = vAt(vp0, s.x, y, s.z)[1] / H;
        const dvdy = (vAt(vp0, s.x, y + 0.1, s.z)[1] / H - vv) / 0.1;
        if (Math.abs(dvdy) < 1e-9) break;
        y = Math.max(s.y0 + dy0, Math.min(s.y0 + dy1, y + (t - vv) / dvdy));
      }
      const off = Math.abs(vAt(vp0, s.x, y, s.z)[1] / H - t) * H;
      if (off <= tol) pens.push({ ...s, y, t, off });
    }
    const cover = new Uint8Array(cols);
    for (const p of pens) cover[col(p.u)] = 1;
    let colCover = 0;
    for (let i = 0; i < cols; i++) colCover += cover[i];
    const errAt = (dx) => {
      const vp = vpOf(dx);
      const e = [];
      for (const p of pens) {
        const pr = vAt(vp, p.x, p.y, p.z);
        const u2 = pr[0] / W;
        if (u2 < 0 || u2 > 1) continue;
        e.push(Math.abs(pr[1] / H - target(u2)) * H);
      }
      e.sort((a, b) => a - b);
      return { med: +e[Math.floor(e.length * 0.5)].toFixed(1), p90: +e[Math.floor(e.length * 0.9)].toFixed(1) };
    };
    return { c, A, tol, reached, pens: pens.length, colCover, err: [0.2, 1, 5].map(errAt) };
  };

  const out = [];
  out.push(run({ c: 0.22, A: 0.14, dy0: -0.35, dy1: 0.85, tol: 6 }));
  out.push(run({ c: 0.22, A: 0.14, dy0: -0.35, dy1: 0.85, tol: 8 }));
  out.push(run({ c: 0.24, A: 0.12, dy0: -0.35, dy1: 0.85, tol: 6 }));
  out.push(run({ c: 0.18, A: 0.18, dy0: -0.40, dy1: 1.10, tol: 6 }));
  out.push(run({ c: 0.16, A: 0.12, dy0: -0.40, dy1: 1.10, tol: 8 }));
  return { seats: seats.length, peak: +peak.toFixed(3), hiMax: Math.max(...hi), loMin: Math.min(...lo), out };
}, T);

console.log(`visible lights ${report.seats}   wave peak |mid| ${report.peak}   hi ${report.hiMax.toFixed(2)} lo ${report.loMin.toFixed(2)}`);
for (const r of report.out) {
  console.log(`c ${r.c} A ${r.A} tol ${r.tol}px → reachable ${r.reached}, on-line ${r.pens}, columns ${r.colCover}/256  `
    + `off-axis err med/p90: ${r.err.map((e, i) => `${[0.2, 1, 5][i]}m ${e.med}/${e.p90}`).join("  ")}`);
}
await browser.close();

