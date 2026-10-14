// throwaway laboratory for the crowd light field (step 67).
//
// The house is not a regular grid: 8,215 penlights sit on 32 row bands whose
// vertical spacing shrinks with distance, and the whole field lives in the top
// two thirds of the frame. This script samples the singer drawing at the exact
// projected position of every light, then renders what the one eye would see,
// next to the ideal image. It also measures how many raster cells a lateral
// step shears the picture by.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(opt("out", "out/diag-masklab"));
const PORT = opt("port", "5173");
fs.mkdirSync(OUT, { recursive: true });

const EDGE = process.env.MV_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 2600 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`http://localhost:${PORT}/?ui=0&veil=0&hud=0&scale=1`,
  { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("body[data-ready='1']", { timeout: 90000, state: "attached" });

const report = await page.evaluate(async () => {
  const { camera, mat4, project } = await import("/src/gl3d.js");
  const { singer } = await import("/src/motifs.js");
  const mv = window.__mv;
  mv.renderFrame(249.0, false);
  const scene = mv.engine.scenes.get("final");
  const S = scene.stadium;
  const W = 1920, H = 1080;

  // ---- the source drawing, rasterised once ------------------------------
  const SW = 264, SH = 472;
  const cv = document.createElement("canvas");
  cv.width = SW; cv.height = SH;
  const g = cv.getContext("2d", { willReadFrequently: true });
  g.fillStyle = "#000"; g.fillRect(0, 0, SW, SH);
  singer(g, SW / 2, SH * 0.985, SH * 1.02, {
    alpha: 1, color: "#ffffff", accent: "#ffffff", deep: "#9a9a9a", lw: 1.6, glow: false,
  });
  const px = g.getImageData(0, 0, SW, SH).data;
  const src = new Float32Array(SW * SH);
  for (let i = 0; i < SW * SH; i++) {
    src[i] = (px[i * 4] + px[i * 4 + 1] + px[i * 4 + 2]) / 765;
  }
  const srcAt = (x, y) => {
    if (x < 0 || y < 0 || x > SW - 1 || y > SH - 1) return 0;
    const ix = Math.floor(x), iy = Math.floor(y);
    const jx = Math.min(SW - 1, ix + 1), jy = Math.min(SH - 1, iy + 1);
    const fx = x - ix, fy = y - iy;
    return (src[iy * SW + ix] * (1 - fx) + src[iy * SW + jx] * fx) * (1 - fy)
      + (src[jy * SW + ix] * (1 - fx) + src[jy * SW + jx] * fx) * fy;
  };
  // content box of the drawing, in source pixels
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) {
    if (src[y * SW + x] < 0.06) continue;
    x0 = Math.min(x0, x); x1 = Math.max(x1, x);
    y0 = Math.min(y0, y); y1 = Math.max(y1, y);
  }
  const sc = SH * 1.02;
  const headY = SH * 0.985 - 0.858 * sc;
  const headR = 0.098 * sc;

  const lightAt = (r, i) => {
    const q = S.seat(r, i);
    return [q.x + q.side * 0.20, q.y + 1.22 + 0.46, q.z];
  };
  const rows = [];
  for (let r = 0; r < S.rows; r++) {
    const list = [];
    for (let i = 0; i < S.counts[r]; i++) {
      const k = S.start[r] + i;
      if (S.aisle[k]) continue;
      const p = project(scene.portraitVp, lightAt(r, i), W, H);
      if (!(p[2] > 0.2)) continue;
      list.push({ k, r, x: p[0] / W, y: p[1] / H });
    }
    rows.push(list);
  }

  const variants = [
    { name: "bust .40 fullfield thick", bust: 0.40, v0: 0.055, v1: 0.63, dilate: 3, carve: 0.74 },
    { name: "bust .40 fullfield thin", bust: 0.40, v0: 0.055, v1: 0.63, dilate: 1, carve: 0.74 },
    { name: "bust .55 fullfield thick", bust: 0.55, v0: 0.055, v1: 0.63, dilate: 3, carve: 0.74 },
    { name: "bust .40 fullfield noface", bust: 0.40, v0: 0.055, v1: 0.63, dilate: 3, carve: 0.55 },
  ];
  const out = [];
  for (const v of variants) {
    const cy0 = y0, cy1 = y0 + (y1 - y0) * v.bust;
    const A = (x1 - x0) / (cy1 - cy0);
    const bandH = (v.v1 - v.v0) * H;
    const contentH = bandH, contentW = contentH * A;
    const rc = {
      u0: 0.5 - contentW / 2 / W, u1: 0.5 + contentW / 2 / W,
      v0: v.v1 - contentH / H, v1: v.v1,
    };
    const rawSample = (u, vv) => {
      const mu = (u - rc.u0) / (rc.u1 - rc.u0);
      const mv2 = (vv - rc.v0) / (rc.v1 - rc.v0);
      if (mu < 0 || mu > 1 || mv2 < 0 || mv2 > 1) return 0;
      const sx = x0 + mu * (x1 - x0);
      const sy = cy0 + mv2 * (cy1 - cy0);
      // the one hard rule: the face stays a void
      if (sy > headY - headR * 1.02 && sy < headY + headR * 1.02
        && Math.abs(sx - SW / 2) < headR * v.carve) return 0;
      return Math.min(1, Math.max(0, (srcAt(sx, sy) - 0.10) / 0.55));
    };
    // a point source throws a soft shadow: widen the strokes by the dot pitch
    const du2 = (x1 - x0) / W, dv2 = (cy1 - cy0) / H;
    const sample = (u, vv) => {
      let best = rawSample(u, vv);
      for (let k = 1; k <= v.dilate; k++) {
        const e = k * 0.4;
        best = Math.max(best,
          rawSample(u - e * du2, vv), rawSample(u + e * du2, vv),
          rawSample(u, vv - e * dv2), rawSample(u, vv + e * dv2));
      }
      return best;
    };
    // the eye's view, at 960x540
    const eye = [];
    let lit = 0, inRect = 0;
    for (const row of rows) for (const q of row) {
      const s = sample(q.x, q.y);
      const mu = (q.x - rc.u0) / (rc.u1 - rc.u0);
      const mv2 = (q.y - rc.v0) / (rc.v1 - rc.v0);
      if (mu >= 0 && mu <= 1 && mv2 >= 0 && mv2 <= 1) inRect++;
      if (s > 0.30) lit++;
      // rim: high-pass along the source
      const e = 1.2;
      const rim = Math.max(0, sample(q.x, q.y) - Math.max(
        sample(q.x - e / 960, q.y), sample(q.x + e / 960, q.y),
        sample(q.x, q.y - e / 540), sample(q.x, q.y + e / 540)));
      if (s > 0.03 || rim > 0.02) eye.push([q.x * 960, q.y * 540, s, rim, q.r]);
    }
    // anamorphic shear: how far does each row slide, in 64-column cells?
    const shear = [0.2, 1, 5, 25].map((dx) => {
      const vp = mat4();
      camera(vp, {
        eye: [scene.portraitEye[0] + dx, scene.portraitEye[1], scene.portraitEye[2]],
        at: scene.portraitAt, fov: 1.14, near: 0.5, far: 900, aspect: W / H,
      });
      const shifts = [];
      for (let r = 0; r < S.rows; r++) {
        const a = rows[r][Math.floor(rows[r].length * 0.5)];
        if (!a) continue;
        const i = Math.round((a.k - S.start[r]) / Math.max(1, S.counts[r] - 1) * (S.counts[r] - 1));
        const q = S.seat(r, i);
        const p = project(vp, [q.x + q.side * 0.20, q.y + 1.22 + 0.46, q.z], W, H);
        shifts.push((p[0] / W - a.x) / (rc.u1 - rc.u0) * 64);
      }
      shifts.sort((a, b) => a - b);
      const med = shifts[Math.floor(shifts.length / 2)] || 0;
      const max = Math.abs(shifts[shifts.length - 1] || 0);
      return { dx, med: +med.toFixed(2), max: +max.toFixed(2) };
    });
    out.push({ ...v, A: +A.toFixed(3), rc, lit, inRect, eye, shear });
    // the ideal image, laid into the same panel as the eye view
    const panel = document.createElement("canvas");
    panel.width = 720; panel.height = 270;
    const pg = panel.getContext("2d");
    pg.fillStyle = "#000"; pg.fillRect(0, 0, 720, 270);
    pg.globalAlpha = 0.85;
    pg.drawImage(cv, x0, cy0, x1 - x0, cy1 - cy0,
      rc.u0 * 720, rc.v0 * 270, (rc.u1 - rc.u0) * 720, (rc.v1 - rc.v0) * 270);
    window.__labPanels = window.__labPanels || [];
    window.__labPanels.push(panel);
  }
  return { out, panels: out.length };
});

console.log(JSON.stringify(report.out.map(({ eye, ...r }) => ({
  name: r.name, aspect: r.A, lightsInRect: r.inRect, lit: r.lit,
  shearCells: r.shear.map((s) => `${s.dx}m:med${s.med}/max${s.max}`),
})), null, 2));

await page.evaluate((data) => {
  document.body.innerHTML = "";
  document.body.style.cssText = "margin:0;background:#05080a;color:#9fd;font:12px monospace";
  const cv = document.createElement("canvas");
  cv.width = 1500; cv.height = 60 + data.length * 600;
  const g = cv.getContext("2d");
  g.fillStyle = "#05080a"; g.fillRect(0, 0, cv.width, cv.height);
  data.forEach((v, row) => {
    const y0 = 40 + row * 600;
    g.fillStyle = "#7fe";
    g.fillText(`${v.name}  A ${v.A}  lights in rect ${v.inRect}  lit ${v.lit}  `
      + v.shear.map((s) => `shear ${s.dx}m med ${s.med}/max ${s.max} cells`).join("  "), 12, y0 - 10);
    g.fillStyle = "#000"; g.fillRect(12, y0, 720, 270);
    const panel = window.__labPanels[row];
    if (panel) g.drawImage(panel, 12, y0, 720, 270);
    const dots = document.createElement("canvas");
    dots.width = 720; dots.height = 270;
    const dg = dots.getContext("2d");
    dg.fillStyle = "#000"; dg.fillRect(0, 0, 720, 270);
    for (const [x, y, s, rim] of v.eye) {
      const a = Math.min(1, s * 1.4 + rim * 0.8);
      dg.fillStyle = `rgba(120,235,255,${(a * 0.28).toFixed(3)})`;
      dg.beginPath(); dg.arc(x * 0.75, y * 0.5, 3.2, 0, 6.284); dg.fill();
      dg.fillStyle = rim > 0.25 ? `rgba(255,255,255,${a})` : `rgba(150,240,255,${a})`;
      dg.fillRect(x * 0.75 - 0.8, y * 0.5 - 0.8, 1.6, 1.6);
    }
    g.drawImage(dots, 756, y0, 720, 270);
    g.fillStyle = "#7fe"; g.fillText("ideal image (in the rect)", 12, y0 + 285);
    g.fillText("what the one eye sees", 756, y0 + 285);
  });
  document.body.appendChild(cv);
}, report.out);

await page.screenshot({ path: path.join(OUT, "masklab.png") });
await browser.close();
