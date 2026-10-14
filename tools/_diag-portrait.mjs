// throwaway diagnostic for step 67: dump the anamorphic mask and the seat
// weights so the light field can be judged without the rest of the frame.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(opt("out", "out/diag-portrait"));
const T = Number(opt("t", 249.0));
const PORT = opt("port", "5173");

fs.mkdirSync(OUT, { recursive: true });
const EDGE = process.env.MV_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`http://localhost:${PORT}/?ui=0&veil=0&hud=0&scale=1`,
  { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("body[data-ready='1']", { timeout: 90000, state: "attached" });

const info = await page.evaluate((tt) => {
  const mv = window.__mv;
  mv.renderFrame(tt, false);
  const scene = mv.engine.scenes.get("final");
  const S = scene.stadium;
  return {
    stats: scene.portraitStats,
    rect: scene.portraitRect,
    eye: scene.portraitEye,
    at: scene.portraitAt,
    maskW: scene.portraitMask ? scene.portraitMask.length : 0,
    qa: scene.qaPortrait,
    lights: S.total,
    rows: S.rows,
  };
}, T);
console.log(JSON.stringify(info, null, 2));

// 1. the mask, upscaled, as the room is asked to hold it
await page.evaluate((tt) => {
  const scene = window.__mv.engine.scenes.get("final");
  const W = 96, H = 40;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  cv.style.cssText = "position:fixed;left:0;top:0;z-index:9999;image-rendering:pixelated;";
  cv.style.width = "960px"; cv.style.height = "400px";
  const g = cv.getContext("2d");
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = Math.round(255 * Math.min(1, scene.portraitMask[y * W + x]));
      g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(x, y, 1, 1);
    }
  }
  document.body.appendChild(cv);
  cv.id = "diag-mask";
}, T);
await page.locator("#diag-mask").screenshot({ path: path.join(OUT, "mask.png") });

// 2. what the eye sees: one dot per penlight, brightness = its weight, at the
//    exact eye and a few metres to the side
for (const dx of [0, 1, 5, 25]) {
  const seen = await page.evaluate(async ({ tt, dx }) => {
    const { camera, mat4, project } = await import("/src/gl3d.js");
    const mv = window.__mv;
    mv.renderFrame(tt, false);
    const scene = mv.engine.scenes.get("final");
    const S = scene.stadium;
    const W = 1920, H = 1080;
    const vp = mat4();
    camera(vp, {
      eye: [scene.portraitEye[0] + dx, scene.portraitEye[1], scene.portraitEye[2]],
      at: scene.portraitAt, fov: 1.14, near: 0.5, far: 900, aspect: W / H,
    });
    const cv = document.createElement("canvas");
    cv.width = 960; cv.height = 540;
    cv.style.cssText = "position:fixed;left:0;top:0;z-index:9999;background:#000;";
    const g = cv.getContext("2d");
    g.fillStyle = "#000"; g.fillRect(0, 0, 960, 540);
    let painted = 0;
    for (let r = 0; r < S.rows; r++) {
      for (let i = 0; i < S.counts[r]; i++) {
        const k = S.start[r] + i;
        if (S.aisle[k]) continue;
        const w = scene.portraitW ? scene.portraitW[k] : 0;
        const rw = scene.portraitRimW ? scene.portraitRimW[k] : 0;
        if (w <= 0.02 && rw <= 0.05) continue;
        const s = S.seat(r, i);
        const p = project(vp, [s.x + s.side * 0.22, s.y + 1.22 + 0.42, s.z], W, H);
        if (!(p[2] > 0.2)) continue;
        const a = Math.min(1, w * 1.3 + rw * 0.5);
        g.fillStyle = `rgba(180,240,255,${a.toFixed(3)})`;
        g.fillRect(p[0] / 2 - 1.5, p[1] / 2 - 1.5, 3, 3);
        painted++;
      }
    }
    document.body.appendChild(cv);
    cv.id = "diag-field";
    return painted;
  }, { tt: T, dx });
  console.log(`dx=${dx}: ${seen} lights visible`);
  await page.locator("#diag-field").screenshot({ path: path.join(OUT, `field-dx${dx}.png`) });
  await page.evaluate(() => document.getElementById("diag-field")?.remove());
}

await browser.close();
