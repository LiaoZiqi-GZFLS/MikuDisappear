// Preview the generated ASCII portrait on its own.
//
//   node tools/ascii-shot.mjs --out out/ascii/portrait.png
//   node tools/ascii-shot.mjs --data data/ascii/miku-face.json --out out/ascii/face.png
//   node tools/ascii-shot.mjs --data data/ascii/miku-face.json --stage 0.4 ...
//
// Loads the running page (the fonts live there), then hands the stage over to
// src/ascii.js so the portrait can be judged without the rest of the film.

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
const OUT = path.resolve(opt("out", "out/ascii/portrait.png"));
const COLS = Number(opt("cols", 96));
const STAGE = Number(opt("stage", 0));
const REVEAL = Number(opt("reveal", 1));
const W = Number(opt("w", 900));
const H = Number(opt("h", 1200));
const BG = opt("bg", "dark");
const DATA = opt("data", null);
const BOX = Number(opt("box", 0.86));

fs.mkdirSync(path.dirname(OUT), { recursive: true });

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
});
page.on("pageerror", (e) => console.error("[pageerror]", e.message));
await page.goto(`http://localhost:${PORT}/?ui=0&veil=0`, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("body[data-ready='1']", { timeout: 90000, state: "attached" });

const err = await page.evaluate(async ({ cols, stage, reveal, bg, data, box }) => {
  const mod = await import("/src/ascii.js");
  const canvas = document.createElement("canvas");
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.cssText = "position:fixed;inset:0;z-index:9999";
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (bg === "paper") {
    ctx.fillStyle = "#eef1ec";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    ctx.fillStyle = "#05070a";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  try {
    if (data) {
      const d = await mod.loadAscii("../" + data.replace(/\\/g, "/"));
      const w = canvas.width * box;
      const h = w * (d.rows / d.cols / (d.cellAspect || 0.6));
      mod.drawAscii(ctx, d, (canvas.width - w) / 2, Math.max(20, (canvas.height - h) / 2),
        w, { stage, reveal, t: 0, glow: 0.7, light: [0.4, 0.3, 1], ss: 1 });
    } else {
      mod.mikuAscii(ctx, canvas.width * 0.1, 40, canvas.width * box, {
        cols, stage, reveal, t: 0, glow: 0.8, light: [0.4, 0.3, 1],
      });
    }
  } catch (e) {
    return String(e && e.stack || e);
  }
  return null;
}, { cols: COLS, stage: STAGE, reveal: REVEAL, bg: BG, data: DATA, box: BOX });

if (err) console.error(err);
await page.screenshot({ path: OUT });
console.log("wrote", OUT);
await browser.close();
