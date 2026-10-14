// throwaway: render the voice-line frame with the room stripped away, so the
// trace itself can be judged (and measured) without the haze, floor and crowd.

import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d = null) => { const i = args.indexOf("--" + n); return i >= 0 ? args[i + 1] : d; };
const OUT = path.resolve(opt("out", "out/diag-line"));
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

const times = (opt("times", "247.40") + "").split(",").map(Number);
for (const t of times) {
  const info = await page.evaluate((tt) => {
    const mv = window.__mv;
    const scene = mv.engine.scenes.get("final");
    const S = scene.stadium;
    if (!S.__origFrame) {
      S.__origFrame = S.frame.bind(S);
      S.frame = (out, o) => S.__origFrame(out, {
        ...o, crowd: 0, structure: 0, beam: 0, haze: 0, stage: 0.02, lightsAlpha: (o.lightsAlpha ?? 1) * 1.4,
      });
    }
    mv.renderFrame(tt, true);
    const q = scene.qaVoice;
    return q ? { t: q.t, sweep: q.sweep, lock: q.lock, onLine: q.onLine, cols: q.columns,
      err0: q.err0, errCam: q.errCam, err02: q.err02, lift: q.lift } : null;
  }, t);
  console.log(JSON.stringify(info));
  await page.screenshot({ path: path.join(OUT, `t${t.toFixed(2).padStart(7, "0")}.png`) });
}
await browser.close();
