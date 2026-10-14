// One-off probe: where does she actually land on screen during shot 44?
//   node tools/arc-probe.mjs --times 241.6,243,244.6,246.2,247
//
// Prints, per time: her screen box in pixels, the pixel size of one person in
// the front row of the house (what the crowd costs the frame), and how much of
// the picture her silhouette covers.
import { chromium } from "playwright-core";

const args = process.argv.slice(2);
const opt = (n, d = null) => {
  const i = args.indexOf("--" + n);
  return i >= 0 ? args[i + 1] : d;
};
const EDGE = process.env.MV_BROWSER ||
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const PORT = opt("port", "5173");
const times = (opt("times", "241.6,243,244.6,246.2,247")).split(",").map(Number);
const OUT = opt("out", "");

const browser = await chromium.launch({
  executablePath: EDGE, headless: true,
  args: ["--no-first-run", "--disable-gpu-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`http://localhost:${PORT}/?ui=0&veil=0&hud=0`, { waitUntil: "load", timeout: 60000 });
await page.waitForSelector("body[data-ready='1']", { timeout: 90000, state: "attached" });

for (const t of times) {
  const info = await page.evaluate(async (tt) => {
    const mv = window.__mv;
    mv.renderFrame(tt, false);
    const scene = mv.engine.scenes.get("final");
    const S = scene.stadium;
    const { project } = await import("/src/gl3d.js");
    const W = 1920, H = 1080;
    const box = scene.herBox();
    const centre = project(S.vp, [scene.her.x, scene.her.y + scene.her.h * 0.5, scene.her.z], W, H);
    const rows = [0, 1, 4, 16, 31];
    const people = rows.map((r) => {
      const a = project(S.vp, [0, S.rowY(r), S.rowZ(r)], W, H);
      const b = project(S.vp, [0.6, S.rowY(r), S.rowZ(r)], W, H);
      return +Math.abs(b[0] - a[0]).toFixed(1);
    });
    return {
      box: { x: +box.x.toFixed(0), feet: +box.feet.toFixed(0), h: +box.h.toFixed(0), w: +box.w.toFixed(0) },
      centre: [+centre[0].toFixed(0), +centre[1].toFixed(0), +centre[2].toFixed(1)],
      personPx: people,
      rowPix: rows.map((r) => +S.rowPix[r].toFixed(1)),
      litRows: S.litRows,
    };
  }, t);
  console.log(`t=${t}`, JSON.stringify(info));
  if (OUT) await page.screenshot({ path: `${OUT}/arc-${t}.png` });
}
await browser.close();
