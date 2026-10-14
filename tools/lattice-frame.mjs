// Frame probe for the prologue's lattice assembly.
//
//   node tools/lattice-frame.mjs --t 19.9 --out out/probe/lattice-frame.png
//
// Renders the film at one time, then draws the lattice instances' own world
// positions back over the frame through the scene's camera. If the segments
// are missing from the film but present here, the problem is the render; if
// they are absent here too, the problem is the placement.

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
const OUT = path.resolve(opt("out", "out/probe/lattice-frame.png"));
const T = Number(opt("t", 19.9));
const W = 1920, H = 1080;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
page.on("console", (m) => console.log("[console]", m.text()));
await page.goto(`http://localhost:${PORT}/?ui=0&veil=0`, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("body[data-ready='1']", { timeout: 90000, state: "attached" });

const info = await page.evaluate(async ({ t }) => {
  const [gl3d] = await Promise.all([import("/src/gl3d.js")]);
  const { project, INSTANCE_FLOATS } = gl3d;
  window.__mv.renderFrame(t, true);
  const scene = window.__mv.engine.scenes.get("prologue");
  const data = scene.bodyData || new Float32Array(0);
  const rows = [];
  for (let i = 0; i * INSTANCE_FLOATS + 8 < data.length && i < 400; i++) {
    const k = i * INSTANCE_FLOATS;
    const a = data[k + 7];
    if (a <= 0.004) continue;
    const p = project(scene.vp, [data[k], data[k + 1], data[k + 2]], 1920, 1080);
    rows.push({
      i, x: p[0], y: p[1], w: p[2], a,
      sx: data[k + 12], sy: data[k + 13],
      c: [data[k + 4], data[k + 5], data[k + 6]],
    });
  }
  const cv = document.createElement("canvas");
  cv.width = 1920; cv.height = 1080;
  cv.style.cssText = "position:fixed;inset:0;z-index:9999";
  document.body.appendChild(cv);
  const c = cv.getContext("2d");
  for (const r of rows) {
    if (r.w <= 0) continue;
    c.fillStyle = `rgba(255,80,80,0.95)`;
    c.fillRect(r.x - 2, r.y - 2, 4, 4);
    c.fillStyle = "rgba(120,255,220,0.65)";
    c.fillRect(r.x - r.sx * 20, r.y - r.sy * 20, Math.max(1, r.sx * 40), Math.max(1, r.sy * 40));
  }
  c.fillStyle = "#fff";
  c.font = "20px monospace";
  c.fillText(`instances ${rows.length} / ${data.length / INSTANCE_FLOATS}`, 40, 60);
  return {
    count: data.length / INSTANCE_FLOATS,
    live: rows.length,
    bounds: scene.bounds,
    figScreen: scene.figScreen,
    segs: scene.segs ? scene.segs.length : 0,
    sample: rows.slice(0, 6),
  };
}, { t: T });

console.log(JSON.stringify(info, null, 1));
await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: W, height: H } });
console.log("wrote", OUT);
await browser.close();
