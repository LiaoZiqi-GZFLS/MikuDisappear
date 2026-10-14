// Rasterise an SVG (or any HTML fragment) to PNG with the browser that the
// film is rendered in. Used to turn the reference illustration into pixels
// before tools/ascii-import.py samples it.
//
//   node tools/raster.mjs assets/ref/x.svg out/refs/x.png 1500 2000

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const EDGE = process.env.MV_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";

const src = process.argv[2];
const out = process.argv[3];
const W = Number(process.argv[4] || 1500);
const H = Number(process.argv[5] || 2000);
if (!src || !out) {
  console.error("usage: node tools/raster.mjs <in.svg> <out.png> [w] [h]");
  process.exit(2);
}

const svg = fs.readFileSync(src, "utf8");
const html = `<!doctype html><meta charset="utf-8">
<style>
  html, body { margin: 0; padding: 0; background: #05070a; }
  #wrap { width: ${W}px; height: ${H}px; display: grid; place-items: center; }
  #wrap > svg { width: 100%; height: 100%; }
</style>
<div id="wrap">${svg}</div>`;

fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.setContent(html, { waitUntil: "load" });
await page.waitForTimeout(600);
await page.screenshot({ path: out });
console.log(`wrote ${out} (${W}x${H})`);
await browser.close();
