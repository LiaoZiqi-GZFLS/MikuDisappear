// Preview the figure motifs on their own, at film scale.
//
//   node tools/motif-shot.mjs --out out/motif/singer.png --h 520
//   node tools/motif-shot.mjs --which listener --out out/motif/listener.png
//
// Draws the same src/motifs.js the scenes use, on the film's own ground, so a
// face or a silhouette can be judged without exporting anything.

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
const OUT = path.resolve(opt("out", "out/motif/sheet.png"));
const WHICH = opt("which", "singer");
const H = Number(opt("h", 520));
const W = Number(opt("w", 0)) || Math.round(1920 * 0.9);
const TIME = Number(opt("t", 2.4));

fs.mkdirSync(path.dirname(OUT), { recursive: true });
const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({ viewport: { width: W, height: 900 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(`http://localhost:${PORT}/?ui=0&veil=0`, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("body[data-ready='1']", { timeout: 90000, state: "attached" });

const err = await page.evaluate(async ({ which, h, w, time }) => {
  const [motifs, palette, kit] = await Promise.all([
    import("/src/motifs.js"), import("/src/palette.js"), import("/src/kit.js"),
  ]);
  const { css } = palette;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = 900;
  canvas.style.cssText = "position:fixed;inset:0;z-index:9999";
  document.body.appendChild(canvas);
  const c = canvas.getContext("2d");
  c.fillStyle = css("ink");
  c.fillRect(0, 0, canvas.width, canvas.height);
  // the film's own ground: a faint panel + hairline, so contrast is honest
  c.fillStyle = css("tealDeep", 0.10);
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.strokeStyle = css("dim", 0.25);
  c.lineWidth = 1;
  for (let gx = 0; gx < canvas.width; gx += 120) {
    c.beginPath(); c.moveTo(gx, 0); c.lineTo(gx, canvas.height); c.stroke();
  }
  for (let gy = 0; gy < canvas.height; gy += 120) {
    c.beginPath(); c.moveTo(0, gy); c.lineTo(canvas.width, gy); c.stroke();
  }
  const base = canvas.height - 90;
  try {
    if (which === "listener") {
      const poses = [
        { eyes: "open", smile: 0.8 },
        { eyes: "happy", smile: 1 },
        { eyes: "sad", sadMouth: true },
        { eyes: "open", turnAway: true, scan: (time * 0.4) % 1 },
      ];
      poses.forEach((p, i) => {
        c.save();
        c.translate((i + 0.5) * (canvas.width / poses.length), 0);
        if (i > 0) {
          motifs.listener(c, 0, base, h, { t: time, alpha: 0.92, ...p });
        }
        c.restore();
        kit.label(c, `listener #${i}`, (i + 0.5) * (canvas.width / poses.length), 40, {
          size: 16, align: "center", color: css("ash", 0.8),
        });
      });
    } else {
      const poses = [
        { eyes: "open", mouth: 0.15 },
        { eyes: "open", mouth: 0.9, smile: 0.6 },
        { eyes: "happy", smile: 1, heart: 1 },
        { eyes: "sad", sadMouth: true, hand: "handsTogether" },
        { eyes: "closed", wave: 1, wavePhase: (time * 0.6) % 1 },
        { eyes: "open", dissolve: 0.45, crack: 0.5, heart: 0.4 },
      ];
      poses.forEach((p, i) => {
        c.save();
        c.translate((i + 0.5) * (canvas.width / poses.length), 0);
        motifs.singer(c, 0, base, h, { t: time, alpha: 0.95, ...p });
        c.restore();
        kit.label(c, Object.keys(p).join(" "), (i + 0.5) * (canvas.width / poses.length), 40, {
          size: 15, align: "center", color: css("ash", 0.8),
        });
      });
    }
  } catch (e) {
    return String((e && e.stack) || e);
  }
  return null;
}, { which: WHICH, h: H, w: W, time: TIME });

if (err) console.error(err);
await page.screenshot({ path: OUT, clip: { x: 0, y: 0, width: W, height: 900 } });
console.log("wrote", OUT);
await browser.close();
