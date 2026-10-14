// Debug probe for the specification lattice (the prologue's assembly).
//
//   node tools/lattice-probe.mjs --out out/probe/lattice.png
//
// Left: the figure as the sampler draws it. Right: the segments the lattice
// builder keeps, coloured by kind (scan bars vs threads). Use it before
// touching the band sizes -- "the assembly does not read as her" is either a
// sampling problem or a trimming problem, and this separates them.

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
const OUT = path.resolve(opt("out", "out/probe/lattice.png"));
const W = Number(opt("w", 1920));
const H = Number(opt("h", 1080));
const MAX = Number(opt("max", 620));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
page.on("console", (m) => {
  if (m.text().startsWith("BARS") || m.text().startsWith("SCENE")) console.log(m.text());
});
await page.goto(`http://localhost:${PORT}/?ui=0&veil=0`, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("body[data-ready='1']", { timeout: 90000, state: "attached" });

const err = await page.evaluate(async ({ w, h, max }) => {
  const [lattice, motifs, palette] = await Promise.all([
    import("/src/lattice.js"), import("/src/motifs.js"), import("/src/palette.js"),
  ]);
  const { css } = palette;
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  cv.style.cssText = "position:fixed;inset:0;z-index:9999";
  document.body.appendChild(cv);
  const c = cv.getContext("2d");
  c.fillStyle = css("ink");
  c.fillRect(0, 0, w, h);

  const sw = 420, sh = 620;
  const drawFig = (x, y, weight, title) => {
    c.save();
    c.translate(x, y);
    c.fillStyle = css("ink2");
    c.fillRect(0, 0, sw, sh);
    c.translate(sw / 2, sh * 0.995);
    motifs.singer(c, 0, 0, sh * 0.98, {
      alpha: 1, color: css("miku", 0.9), accent: css("mikuHi", 0.9),
      deep: css("tealDeep", 0.9), glow: false, lw: Math.max(1, sh * weight),
    });
    c.restore();
    c.fillStyle = css("ash", 0.9);
    c.font = '17px "MV Mono", monospace';
    c.fillText(title, x, y - 12);
  };
  drawFig(80, 120, 0.019, "A - fat pass (scan bars)");
  drawFig(80 + sw + 60, 120, 0.013, "B - hairline pass (threads)");

  const raster = lattice.figureRaster({ weight: 0.013 });
  const built = lattice.buildLattice({ raster, max });
  // diagnostics: what the bar pass sees, row by row
  const diag = [];
  for (let y = 4; y < raster.h - 2; y += 33) {
    let best = 0, bestMid = -1;
    let start = -1;
    for (let x = 0; x <= raster.w; x++) {
      const on = x < raster.w && raster.lum[y * raster.w + x] > 0.015;
      if (on && start < 0) start = x;
      else if (!on && start >= 0) {
        if (x - start > best) { best = x - start; bestMid = (start + x - 1) >> 1; }
        start = -1;
      }
    }
    const a6 = bestMid >= 0 ? raster.lum[Math.max(0, y - 6) * raster.w + bestMid] : 0;
    const b6 = bestMid >= 0 ? raster.lum[Math.min(raster.h - 1, y + 6) * raster.w + bestMid] : 0;
    diag.push(`y${y} run${best}/${(raster.w * 0.13) | 0} above${a6.toFixed(2)} below${b6.toFixed(2)}`);
  }
  console.log("BARS " + diag.join(" | "));
  const scene = window.__mv?.engine?.scenes?.get("prologue");
  if (scene) {
    const kinds = (scene.segs || []).reduce((m, s) => (m[s.kind] = (m[s.kind] || 0) + 1, m), {});
    console.log(`SCENE segs ${(scene.segs || []).length} ${JSON.stringify(kinds)} bounds ${JSON.stringify(scene.bounds)}`);
  } else {
    console.log("SCENE missing");
  }
  const marks = lattice.armMark(0.31, 0.26, 0.09);
  const segs = built.segs.concat(marks);

  const bx = 80 + (sw + 60) * 2, by = 120;
  c.fillStyle = css("ink2");
  c.fillRect(bx, by, sw, sh);
  c.strokeStyle = css("dim", 0.4);
  c.strokeRect(bx + 0.5, by + 0.5, sw, sh);
  c.fillStyle = css("ash", 0.9);
  c.font = '17px "MV Mono", monospace';
  const kinds = segs.reduce((m, s) => (m[s.kind] = (m[s.kind] || 0) + 1, m), {});
  c.fillText(`C - lattice ${segs.length} segments (${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(" / ")})`, bx, by - 12);
  const k = Math.min(sw / (built.bounds.x1 - built.bounds.x0), sh / (built.bounds.y1 - built.bounds.y0)) * 0.92;
  const ox = bx + sw / 2 - (built.bounds.x0 + built.bounds.x1) / 2 * k;
  const oy = by + sh - 20 + built.bounds.y0 * k;
  c.lineCap = "round";
  for (const s of segs) {
    c.strokeStyle = s.kind === "bar" ? css("miku", 0.34)
      : s.kind === "mark" ? css("red", 0.9) : css("mikuHi", 0.95);
    c.lineWidth = s.kind === "bar" ? 2.6 : s.kind === "mark" ? 2.2 : 1.7;
    c.beginPath();
    c.moveTo(ox + s.x0 * k, oy - s.y0 * k);
    c.lineTo(ox + s.x1 * k, oy - s.y1 * k);
    c.stroke();
  }
  c.fillStyle = css("dim", 0.9);
  c.font = '15px "MV Mono", monospace';
  return null;
}, { w: W, h: H, max: MAX });

if (err) console.error(err);
await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: W, height: H } });
console.log("wrote", OUT);
await browser.close();
