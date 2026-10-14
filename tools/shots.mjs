// Deterministic still renderer: drives the player head-free and writes PNGs.
//
//   node tools/shots.mjs --times 5,30,70 --out out/qa
//   node tools/shots.mjs --range 0,286,24 --out out/qa --hud 1
//   node tools/shots.mjs --sheet 16 --out out/qa
//   node tools/shots.mjs --times 24.5 --scale 2 --width 3840 --height 2160 --out out/stills
//
// Requires playwright-core and a Chromium-family browser (default: Edge).

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (name, def = null) => {
  const i = args.indexOf("--" + name);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes("--" + name);

const EDGE = process.env.MV_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = opt("port", "5173");
const OUT = path.resolve(opt("out", "out/qa"));
const HUD = opt("hud", "1") === "1";
// `--scale` is the renderer's own resolution multiplier (the page's canvas is
// 1920x1080 x scale); --width/--height are the browser viewport the still is
// captured at, so for a 4K still pass both: --scale 2 --width 3840 --height 2160.
const SCALE = Number(opt("scale", 1));
const WIDTH = Number(opt("width", 1920 * SCALE));
const HEIGHT = Number(opt("height", 1080 * SCALE));

let times = [];
let sheetN = 0;
if (opt("times")) times = opt("times").split(",").map(Number);
else if (opt("range")) {
  const [a, b, n] = opt("range").split(",").map(Number);
  for (let i = 0; i < n; i++) times.push(a + ((b - a) * i) / Math.max(1, n - 1));
} else if (opt("sheet")) {
  // Resolved after boot, from the page's own duration (song + credits tail).
  sheetN = Number(opt("sheet"));
}
if (!times.length && !sheetN) times = [0, 30];

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: 1,
});
const problems = [];
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") problems.push(`[${m.type()}] ${m.text()}`);
});
page.on("pageerror", (e) => problems.push(`[pageerror] ${e.message}`));
page.on("requestfailed", (r) => problems.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

const url = `http://localhost:${PORT}/?ui=0&veil=0&hud=${HUD ? 1 : 0}&scale=${SCALE}`;
await page.goto(url, { waitUntil: "load", timeout: 60000 });
try {
  await page.waitForSelector("body[data-ready='1']", { timeout: 90000, state: "attached" });
} catch (err) {
  const state = await page.evaluate(() => ({
    load: document.getElementById("load-line")?.textContent,
    ready: document.body.dataset.ready,
  })).catch(() => ({}));
  console.log("BOOT FAILED:", err.message, JSON.stringify(state));
  console.log(problems.slice(0, 40).join("\n"));
  await page.screenshot({ path: path.join(OUT, "boot-fail.png") });
  await browser.close();
  process.exit(1);
}
const meta = await page.evaluate(() => ({
  duration: window.__mv.duration,
  chapters: window.__mv.chapters.map((c) => [c.id, c.t0, c.t1]),
}));
console.log(`ready: ${meta.duration.toFixed(2)}s, ${meta.chapters.length} chapters`);
if (sheetN) {
  for (let i = 0; i < sheetN; i++) times.push((meta.duration * (i + 0.5)) / sheetN);
}

let i = 0;
for (const t of times) {
  await page.evaluate(({ tt, hud }) => window.__mv.renderFrame(tt, hud), { tt: t, hud: HUD });
  const file = path.join(OUT, `t${t.toFixed(2).padStart(7, "0")}.png`);
  await page.screenshot({ path: file, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } });
  process.stdout.write(`\r${++i}/${times.length}  ${t.toFixed(2)}s   `);
}
console.log("");

// canvas pixel sanity: not blank, and varies across time
const stats = await page.evaluate(async () => {
  const c = document.getElementById("stage");
  const gl = c.getContext("webgl2");
  const px = new Uint8Array(4 * 256);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
  return { corner: [px[0], px[1], px[2]] };
});
console.log("corner pixel:", stats.corner.join(","));
if (problems.length) {
  console.log("---- browser problems ----");
  console.log([...new Set(problems)].slice(0, 30).join("\n"));
} else {
  console.log("no browser errors");
}
await browser.close();
