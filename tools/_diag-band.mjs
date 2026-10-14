// throwaway: which layer draws the bright band across `final`? Render one
// frame with a layer at a time switched off, measure the band, and print a
// vertical brightness profile so the band can be located.

import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const PORT = opt("port", "5173");
const T = Number(opt("t", 247.4));
const EDGE = process.env.MV_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const browser = await chromium.launch({
  executablePath: EDGE,
  headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox", "--force-device-scale-factor=1"],
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("pageerror", (e) => console.log("pageerror", e.message));
await page.goto(`http://localhost:${PORT}/?ui=0&veil=0&hud=0&scale=1`,
  { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("body[data-ready='1']", { timeout: 90000, state: "attached" });

const out = await page.evaluate(async (T) => {
  const mv = window.__mv;
  const scene = mv.engine.scenes.get("final");
  const S = scene.stadium;
  if (!S.__orig) {
    S.__orig = S.frame.bind(S);
    S.frame = (o, p) => S.__orig(o, S.__patch ? { ...p, ...S.__patch } : p);
  }
  const grab = () => {
    const src = document.getElementById("stage");
    const cv = document.createElement("canvas");
    cv.width = 1920; cv.height = 1080;
    const g = cv.getContext("2d");
    g.drawImage(src, 0, 0, 1920, 1080);
    return g.getImageData(0, 0, 1920, 1080).data;
  };
  const mean = (data, y0, y1) => {
    let s = 0, n = 0;
    for (let y = y0; y < y1; y += 4) {
      for (let x = 60; x < 1860; x += 8) {
        const i = (y * 1920 + x) * 4;
        s += (data[i] + data[i + 1] + data[i + 2]) / 3;
        n++;
      }
    }
    return +(s / n).toFixed(1);
  };

  const passDraw = scene.pass.draw.bind(scene.pass);
  const drawLayer = scene.ctx.drawLayer.bind(scene.ctx);
  const keepSeats = scene.lineSeats;
  const runs = [
    ["normal", null, false, null],
    ["pass off", null, false, "pass"],
    ["2D off", null, false, "2d"],
    ["pass+2D off", null, false, "both"],
    ["lights off", { lightsAlpha: 0, beam: 0 }, false, null],
    ["crowd off", { crowd: 0 }, false, null],
    ["room off", { structure: 0, stage: 0 }, false, null],
    ["haze off", { haze: 0, beam: 0 }, false, null],
    ["no trace", null, true, null],
  ];
  const rows = [];
  for (const [name, patch, noTrace, kill] of runs) {
    S.__patch = patch || null;
    scene.lineSeats = noTrace ? [] : keepSeats;
    scene.pass.draw = (kill === "pass" || kill === "both") ? () => {} : passDraw;
    scene.ctx.drawLayer = (kill === "2d" || kill === "both") ? () => {} : drawLayer;
    mv.renderFrame(T, true);
    const d = grab();
    rows.push({ name, band: mean(d, 360, 520), upper: mean(d, 150, 300), whole: mean(d, 0, 1080) });
    await new Promise((res) => {
      const cv = document.getElementById("stage");
      const url = cv.toDataURL("image/png");
      window.__shots = window.__shots || {};
      window.__shots[name] = url;
      res();
    });
  }
  scene.lineSeats = keepSeats;
  scene.pass.draw = passDraw;
  scene.ctx.drawLayer = drawLayer;
  S.__patch = null;
  mv.renderFrame(T, true);
  const d = grab();
  const profile = [];
  for (let y = 0; y < 1080; y += 40) profile.push(`${y}:${mean(d, y, y + 40)}`);
  return { rows, profile };
}, T);

for (const r of out.rows) {
  console.log(`${r.name.padEnd(14)} band ${String(r.band).padStart(6)}  upper ${String(r.upper).padStart(6)}  whole ${String(r.whole).padStart(6)}`);
}
console.log("profile(y:mean):", out.profile.join("  "));
const shots = await page.evaluate(() => window.__shots);
const dir = new URL("../out/diag-band/", import.meta.url);
const fs = await import("node:fs");
fs.mkdirSync(dir, { recursive: true });
for (const [name, url] of Object.entries(shots)) {
  fs.writeFileSync(new URL(name.replace(/\s+/g, "_") + ".png", dir),
    Buffer.from(url.split(",")[1], "base64"));
}
await browser.close();
