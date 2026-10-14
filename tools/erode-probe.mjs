// Debug probe for the `erode` wall of points.
//
//   node tools/erode-probe.mjs --out out/probe/erode.png
//
// Draws, side by side: the figure as the two sampling weights draw it, and the
// sampled points plotted through the chapter's own camera. Use it before
// touching the sampling numbers -- "the wall does not read as her" has several
// possible causes and this separates them.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf("--" + n);
  return i >= 0 ? args[i + 1] : d;
};
const EDGE = process.env.MV_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = opt("port", "5173");
const OUT = path.resolve(opt("out", "out/probe/erode.png"));
const W = Number(opt("w", 1920));
const H = Number(opt("h", 1080));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(`http://localhost:${PORT}/?ui=0&veil=0`, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("body[data-ready='1']", { timeout: 90000, state: "attached" });

const err = await page.evaluate(async ({ w, h }) => {
  const [motifs, palette, gl3d] = await Promise.all([
    import("/src/motifs.js"), import("/src/palette.js"), import("/src/gl3d.js"),
  ]);
  const { css } = palette;
  const { camera, mat4, project } = gl3d;
  const mv = window.__mv;
  const scene = mv.engine.scenes.get("erode");
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  cv.style.cssText = "position:fixed;inset:0;z-index:9999";
  document.body.appendChild(cv);
  const c = cv.getContext("2d");
  c.fillStyle = css("ink");
  c.fillRect(0, 0, w, h);

  const panel = (x, y, pw, ph, title) => {
    c.strokeStyle = css("dim", 0.5);
    c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, pw, ph);
    c.fillStyle = css("ash", 0.9);
    c.font = '16px "MV Mono", monospace';
    c.fillText(title, x + 8, y - 8);
  };

  // A/B: the sampling canvas at the two stroke weights, drawn at 2x
  const sw = 250, sh = 344, scale = 1.25;
  const drawSample = (x, y, lw, title) => {
    panel(x, y, sw * scale, sh * scale, title);
    c.save();
    c.translate(x, y);
    c.scale(scale, scale);
    c.fillStyle = "#000";
    c.fillRect(0, 0, sw, sh);
    motifs.singer(c, sw / 2, sh * 0.995, sh * 0.98, {
      alpha: 1, color: "#ffffff", accent: "#ffffff", deep: "#4a4a4a",
      glow: false, lw,
    });
    c.restore();
  };
  drawSample(40, 90, Math.max(1.0, sh * 0.015), "A · line pass (lw 1.5%)");
  drawSample(40 + sw * scale + 60, 90, Math.max(1.2, sh * 0.058), "B · volume pass (lw 5.8%)");

  // C: the sampled points, plotted through the chapter's own camera
  const vp = mat4();
  camera(vp, {
    eye: [0, 0.02, 3.66], at: [-0.62, 0.02, 0],
    fov: 0.86, near: 0.1, far: 60, aspect: w / h,
  });
  // plot the whole film frame as a thumbnail inside the panel
  const bx = 40, by = 560, bw = 900, bh = 460;
  const k = Math.min(bw / w, bh / h) * 0.96;
  const ox = bx + (bw - w * k) / 2, oy = by + (bh - h * k) / 2;
  panel(bx, by, bw, bh, "C · points in frame (line bright / volume dim)");
  const plot = (pts, col, r, alpha) => {
    c.fillStyle = css(...col);
    c.globalAlpha = alpha;
    for (const q of pts) {
      const p = project(vp, [0.46 + q[0] * 1.04, -0.60 + q[1] * 1.04, 0], w, h);
      if (p[2] <= 0) continue;
      c.fillRect(ox + p[0] * k - r, oy + p[1] * k - r, r * 2, r * 2);
    }
    c.globalAlpha = 1;
  };
  plot(scene.wallFillPts || [], ["tealDeep"], 0.9, 0.75);
  plot(scene.wallLinePts || [], ["mikuHi"], 1.1, 1.0);
  c.fillStyle = css("bone", 0.9);
  c.font = '18px "MV Mono", monospace';
  c.fillText(`line ${(scene.wallLinePts || []).length} pts · volume ${(scene.wallFillPts || []).length} pts`,
    960, 580);
  return null;
}, { w: W, h: H });

if (err) console.error(err);
await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: W, height: H } });
console.log("wrote", OUT);
await browser.close();
